import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readConfig } from "./config.js";
import { resolveWorkspace } from "./workspace.js";
import { effectiveModel } from "./model.js";

export const CONSOLE_URL = "https://opencode.ai/inference/v1/systemone";
export const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
export const OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions";
const OPENROUTER_MODEL = "inception/mercury-decide:free";
const SYSTEMONE_PATH = "/v1/systemone";

const LOOPBACK = new Set(["localhost", "[::1]"]);

export async function backend(env = process.env) {
  const stored = readConfig(env);
  if (stored && (stored.endpoint || stored.key || stored.keyEnv || stored.keyProvider)) return backendFromConfig(stored, env);
  if (env.JEV_BASE_URL) return { kind: "custom", key: env.JEV_BASE_API_KEY, url: systemOneUrl(env.JEV_BASE_URL) };
  const consoleKey = env.OPENCODE_CONSOLE_TOKEN || env.OPENCODE_API_KEY;
  if (consoleKey) {
    let workspace = null, workspaceError = null;
    try { workspace = await resolveWorkspace(env); } catch (error) { workspaceError = error; }
    if (workspace) return { kind: "console", key: consoleKey, orgId: workspace.id, workspaceName: workspace.name };
    if (workspaceError) throw workspaceError;
    return { kind: "console-unresolved", key: consoleKey };
  }
  if (env.JEV_API_KEY) return { kind: "typesafe", key: env.JEV_API_KEY };
  const serviceAccount = serviceKey(env);
  if (serviceAccount) return { kind: "console", key: serviceAccount, orgId: null };
  return null;
}

const ENDPOINT_KIND = { opencode: "console", openrouter: "openrouter", custom: "custom" };

function backendFromConfig(config, env) {
  const kind = ENDPOINT_KIND[config.endpoint] ?? "custom";
  const url = config.url ?? { console: CONSOLE_URL, openrouter: OPENROUTER_URL }[kind];
  if (!url) throw new Error(`jew-guard config: endpoint "${config.endpoint}" needs a url; run jew-guard auth`);
  checkUrl(url, "jew-guard config url");
  const key = config.keyEnv ? env[config.keyEnv] : config.keyProvider ? authKey(config.keyProvider, env) : config.key;
  if (!key) throw new Error(`jew-guard config: ${config.keyEnv ? `env ${config.keyEnv} is not set` : `auth.json provider "${config.keyProvider}" has no key`}; run jew-guard auth`);
  return { kind, key, url, orgId: config.org ?? null };
}

export function serviceKey(env = process.env) {
  return authKey("opencode-go", env) ?? authKey("opencode", env);
}

function authKey(provider, env) {
  try {
    const dataDir = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
    const stored = JSON.parse(readFileSync(join(dataDir, "opencode", "auth.json"), "utf8"))?.[provider]?.key;
    if (typeof stored === "string" && stored.trim()) return stored.trim();
  } catch {}
  return null;
}

function checkUrl(url, label) {
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch { throw new Error(`${label} is not a URL: ${url}`); }
  if (parsedUrl.protocol !== "https:" && !(parsedUrl.protocol === "http:" && isLocal(parsedUrl.hostname)))
    throw new Error(`${label} must be https, or http on localhost or a private address: ${url}`);
}

export function systemOneUrl(base) {
  checkUrl(base, "JEV_BASE_URL");
  const parsedUrl = new URL(base);
  parsedUrl.search = ""; parsedUrl.hash = "";
  return parsedUrl.href.replace(/\/+$/, "") + SYSTEMONE_PATH;
}

function isLocal(host) {
  if (LOOPBACK.has(host)) return true;
  const parts = String(host).split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 127 || parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

export async function ask(state, questions, options = {}) {
  const { env = process.env } = options;
  const resolved = await backend(env);
  const fallback = options.fallback === false || env.JEV_GUARD_FAIL_CLOSED || resolved?.kind === "openrouter" ? null : openRouterKey(env);
  if (!resolved || resolved.kind === "console-unresolved") {
    if (fallback) return request(openRouterBackend(fallback), state, questions, options);
    if (!resolved) throw new Error("no credentials: run /connect in opencode (Console workspace), or set JEV_API_KEY / JEV_BASE_URL");
    throw new Error("console workspaces unresolved: run /jev-workspace and pick your workspace");
  }
  try {
    return await request(resolved, state, questions, options);
  } catch (err) {
    if (!fallback) throw err;
    return request(openRouterBackend(fallback), state, questions, { ...options, timeoutMs: Math.min(options.timeoutMs ?? +(env.JEV_GUARD_TIMEOUT_MS || 6000), 6000) });
  }
}

export function openRouterKey(env = process.env) {
  return env.OPENROUTER_API_KEY || authKey("openrouter", env);
}

const openRouterBackend = (key) => ({ kind: "openrouter", key, url: OPENROUTER_URL, model: OPENROUTER_MODEL });

async function request(target, state, questions, { env = process.env, fetchImpl = fetch, signal, timeoutMs } = {}) {
  const budget = AbortSignal.timeout(timeoutMs ?? +(env.JEV_GUARD_TIMEOUT_MS || 20_000));
  const abort = signal ? AbortSignal.any([signal, budget]) : budget;
  const model = target.model ?? effectiveModel(env, target.kind).model;
  const url = target.url ?? { console: CONSOLE_URL, typesafe: TYPESAFE_URL }[target.kind];
  const headers = { "Content-Type": "application/json" };
  if (target.key) headers.Authorization = `Bearer ${target.key}`;
  if (target.orgId) headers["x-opencode-org-id"] = target.orgId;
  const post = () => fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ state, model, questions }),
    signal: abort,
  });
  let response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await post();
      if (response.ok || (response.status !== 429 && response.status < 500) || attempt === 2) break;
      await response.text().catch(() => {});
    } catch (err) {
      if (abort.aborted || attempt === 2) throw err;
    }
    await sleep(600 * 2 ** attempt, abort);
  }
  if (!response.ok) throw new Error(`${target.kind} HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = await response.json();
  const providerConfidence = body.providerMetadata?.typesafe?.confidence ?? {};
  return mapValues(body.answers, (answer, id) => ({
    p: answer.noul ?? answer.probability, choice: answer.choice, score: answer.score, probabilities: answer.probabilities,
    confidence: answer.confidence ?? providerConfidence[id],
  }));
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(signal.reason); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function mapValues(obj, transform) {
  return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, transform(value, key)]));
}
