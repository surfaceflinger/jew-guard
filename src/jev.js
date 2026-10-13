// Jev access for jew-guard, opencode-only.
//
// Backends, in order:
//   1. JEV_BASE_URL — any System One server at <base>/v1/systemone
//      (e.g. a local Kev). Optional JEV_BASE_API_KEY bearer.
//   2. Console gateway — https://opencode.ai/inference/v1/systemone with
//      your existing OpenCode credential. Zero-config: the token comes from
//      OPENCODE_CONSOLE_TOKEN (present in every opencode session) or
//      OPENCODE_API_KEY, and the workspace from the /jev-workspace selection.
//      Verified live 2026-10-12: model jev-1.13-free answers 200; paid
//      jev-1.13 returns 402 without funds. Without a console session (e.g.
//      opencode-go login only), falls back to the opencode-go service key in
//      opencode's auth.json; service keys are bound to one workspace, so no
//      workspace header is needed.
//   3. JEV_API_KEY — direct TypeSafe API (https://api.typesafe.ai/v1/systemone).
//
// When 1–3 fail to answer (unfunded, rate-limited, down) and an OpenRouter key is
// connected (OPENROUTER_API_KEY or auth.json provider "openrouter"), the same
// questions go to OpenRouter's decisions endpoint, model
// inception/mercury-decide:free. Note: OpenRouter marks Inception's free
// endpoints as training on prompts.
//
// Everything else (OpenRouter, Vercel AI Gateway, OIDC, ~/.jev-guard/config.json)
// was stripped: this plugin is opencode-only and needs no key setup.

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

/** Resolved backend descriptor, or null when nothing is configured. */
export async function backend(env = process.env) {
  // config.json is authoritative when it names a backend; a file holding only
  // workspace/model picks leaves auto-detection in charge. Delete it to go back to zeroconf.
  const c = readConfig(env);
  if (c && (c.endpoint || c.key || c.keyEnv || c.keyProvider)) return fromConfig(c, env);
  if (env.JEV_BASE_URL) return { kind: "custom", key: env.JEV_BASE_API_KEY, url: systemOneUrl(env.JEV_BASE_URL) };
  const consoleKey = env.OPENCODE_CONSOLE_TOKEN || env.OPENCODE_API_KEY;
  if (consoleKey) {
    let ws = null, wsError = null;
    try { ws = await resolveWorkspace(env); } catch (e) { wsError = e; }
    if (ws) return { kind: "console", key: consoleKey, orgId: ws.id, workspaceName: ws.name };
    if (wsError) throw wsError;  // real failure (network, bad token) — propagate, don't misreport as unpicked
    return { kind: "console-unresolved", key: consoleKey };
  }
  if (env.JEV_API_KEY) return { kind: "typesafe", key: env.JEV_API_KEY };
  const go = serviceKey(env);
  if (go) return { kind: "console", key: go, orgId: null };
  return null;
}

const ENDPOINT_KIND = { opencode: "console", openrouter: "openrouter", custom: "custom" };

/** Backend from bin/jew-guard's config.json. The url is stored, so presets stay in the CLI. */
function fromConfig(c, env) {
  const kind = ENDPOINT_KIND[c.endpoint] ?? "custom";
  const url = c.url ?? { console: CONSOLE_URL, openrouter: OPENROUTER_URL }[kind];
  if (!url) throw new Error(`jew-guard config: endpoint "${c.endpoint}" needs a url; run jew-guard auth`);
  checkUrl(url, "jew-guard config url");
  const key = c.keyEnv ? env[c.keyEnv] : c.keyProvider ? authKey(c.keyProvider, env) : c.key;
  if (!key) throw new Error(`jew-guard config: ${c.keyEnv ? `env ${c.keyEnv} is not set` : `auth.json provider "${c.keyProvider}" has no key`}; run jew-guard auth`);
  return { kind, key, url, orgId: c.org ?? null };  // model stays out: effectiveModel resolves env > config > legacy > default
}

/** opencode-go service account key from opencode's auth.json. No env var carries it,
 *  and it is bound to its workspace, so orgId stays null (no x-opencode-org-id header). */
export function serviceKey(env = process.env) {
  return authKey("opencode-go", env) ?? authKey("opencode", env);
}

function authKey(provider, env) {
  try {
    const data = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
    const k = JSON.parse(readFileSync(join(data, "opencode", "auth.json"), "utf8"))?.[provider]?.key;
    if (typeof k === "string" && k.trim()) return k.trim();
  } catch {}
  return null;
}

/** https anywhere, http only to this machine or a private address. Refuses to carry a key in clear text. */
function checkUrl(url, what) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`${what} is not a URL: ${url}`); }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLocal(u.hostname)))
    throw new Error(`${what} must be https, or http on localhost or a private address: ${url}`);
}

/** `<base>/v1/systemone` for a System One server. */
export function systemOneUrl(base) {
  checkUrl(base, "JEV_BASE_URL");
  const u = new URL(base);
  u.search = ""; u.hash = "";
  return u.href.replace(/\/+$/, "") + SYSTEMONE_PATH;
}

function isLocal(host) {
  if (LOOPBACK.has(host)) return true;
  const parts = String(host).split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 127 || parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

/** @returns {Promise<Record<string, {p?: number, choice?: string, score?: number, probabilities?: Record<string, number>, confidence?: number}>>} */
export async function ask(state, questions, opts = {}) {
  const { env = process.env } = opts;
  const b = await backend(env);
  // No fallback for fail-closed users (a Jev failure must deny) or one-shot probes
  // (they test the endpoint being configured, not the fallback).
  const fallback = opts.fallback === false || env.JEV_GUARD_FAIL_CLOSED || b?.kind === "openrouter" ? null : openRouterKey(env);
  if (!b || b.kind === "console-unresolved") {
    if (fallback) return request(openRouterBackend(fallback), state, questions, opts);
    if (!b) throw new Error("no credentials: run /connect in opencode (Console workspace), or set JEV_API_KEY / JEV_BASE_URL");
    throw new Error("console workspaces unresolved: run /jev-workspace and pick your workspace");
  }
  try {
    return await request(b, state, questions, opts);
  } catch (err) {
    if (!fallback) throw err;
    // A Jev call that failed is not a verdict; when OpenRouter is connected, ask mercury-decide
    // instead. Cap the fallback at 6 s so primary + fallback stay under the host's ~30 s hook kill.
    return request(openRouterBackend(fallback), state, questions, { ...opts, timeoutMs: Math.min(opts.timeoutMs ?? +(env.JEV_GUARD_TIMEOUT_MS || 6000), 6000) });
  }
}

/** OpenRouter key: env first, then opencode's auth.json (provider "openrouter"). Free decisions model. */
export function openRouterKey(env = process.env) {
  return env.OPENROUTER_API_KEY || authKey("openrouter", env);
}

const openRouterBackend = (key) => ({ kind: "openrouter", key, url: OPENROUTER_URL, model: OPENROUTER_MODEL });

async function request(b, state, questions, { env = process.env, fetchImpl = fetch, signal, timeoutMs } = {}) {
  // One budget for the whole call, retries included: every host kills a hook at ~30 s, and a hook that dies
  // never reaches the fail-closed branch. Default 20 s leaves room for process start-up.
  const budget = AbortSignal.timeout(timeoutMs ?? +(env.JEV_GUARD_TIMEOUT_MS || 20_000));
  const abort = signal ? AbortSignal.any([signal, budget]) : budget;
  const model = b.model ?? effectiveModel(env, b.kind).model;
  const url = b.url ?? { console: CONSOLE_URL, typesafe: TYPESAFE_URL }[b.kind];
  const headers = { "Content-Type": "application/json" };
  if (b.key) headers.Authorization = `Bearer ${b.key}`;
  if (b.orgId) headers["x-opencode-org-id"] = b.orgId;
  const request = () => fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ state, model, questions }),
    signal: abort,
  });
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await request();
      if (res.ok || (res.status !== 429 && res.status < 500) || attempt === 2) break;
      await res.text().catch(() => {});  // release the socket before retrying
    } catch (err) {
      if (abort.aborted || attempt === 2) throw err;  // network blips (ECONNRESET, DNS) retry; aborts and the last attempt don't
    }
    await sleep(600 * 2 ** attempt, abort);
  }
  if (!res.ok) throw new Error(`${b.kind} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const conf = body.providerMetadata?.typesafe?.confidence ?? {};
  return mapValues(body.answers, (a, id) => ({
    p: a.noul ?? a.probability, choice: a.choice, score: a.score, probabilities: a.probabilities,
    confidence: a.confidence ?? conf[id],
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

function mapValues(obj, fn) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v, k)]));
}
