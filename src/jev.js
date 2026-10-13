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
//      jev-1.13 returns 402 without funds. No key files, no auth.json parsing.
//   3. JEV_API_KEY — direct TypeSafe API (https://api.typesafe.ai/v1/systemone).
//
// Everything else (OpenRouter, Vercel AI Gateway, OIDC, ~/.jev-guard/config.json)
// was stripped: this plugin is opencode-only and needs no key setup.

import { resolveWorkspace } from "./workspace.js";
import { effectiveModel } from "./model.js";

export const CONSOLE_URL = "https://opencode.ai/inference/v1/systemone";
export const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const SYSTEMONE_PATH = "/v1/systemone";

const LOOPBACK = new Set(["localhost", "[::1]"]);

/** Resolved backend descriptor, or null when nothing is configured. */
export async function backend(env = process.env) {
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
  return null;
}

/** `<base>/v1/systemone` for a System One server; https only, except plain http to this machine or a private address. */
export function systemOneUrl(base) {
  let u;
  try { u = new URL(base); } catch { throw new Error(`JEV_BASE_URL is not a URL: ${base}`); }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLocal(u.hostname)))
    throw new Error(`JEV_BASE_URL must be https, or http on localhost or a private address: ${base}`);
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
export async function ask(state, questions, { env = process.env, fetchImpl = fetch, signal, timeoutMs } = {}) {
  const b = await backend(env);
  if (!b) throw new Error("no credentials: run /connect in opencode (Console workspace), or set JEV_API_KEY / JEV_BASE_URL");
  if (b.kind === "console-unresolved")
    throw new Error("console workspaces unresolved: run /jev-workspace and pick your workspace");
  // One budget for the whole call, retries included: every host kills a hook at ~30 s, and a hook that dies
  // never reaches the fail-closed branch. Default 20 s leaves room for process start-up.
  const budget = AbortSignal.timeout(timeoutMs ?? +(env.JEV_GUARD_TIMEOUT_MS || 20_000));
  const abort = signal ? AbortSignal.any([signal, budget]) : budget;
  const model = effectiveModel(env, b.kind).model;
  const url = { console: CONSOLE_URL, typesafe: TYPESAFE_URL, custom: b.url }[b.kind];
  const headers = { "Content-Type": "application/json" };
  if (b.key) headers.Authorization = `Bearer ${b.key}`;
  if (b.kind === "console") headers["x-opencode-org-id"] = b.orgId;
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
