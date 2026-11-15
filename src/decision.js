import { readConfig } from "./config.js";
import { resolveWorkspace } from "./workspace.js";
import { effectiveModel } from "./model.js";
import { authKey, consoleToken, serviceKey } from "./auth.js";

export const CONSOLE_URL = "https://opencode.ai/inference/v1/systemone";
export const OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions";

const LOOPBACK = new Set(["localhost", "[::1]"]);

export async function backend(env = process.env) {
  const stored = readConfig(env);
  if (stored && (stored.endpoint || stored.key || stored.keyProvider))
    return backendFromConfig(stored, env);
  const consoleKey = env.OPENCODE_CONSOLE_TOKEN || env.OPENCODE_API_KEY;
  if (consoleKey) {
    let workspace = null,
      workspaceError = null;
    try {
      workspace = await resolveWorkspace(env);
    } catch (error) {
      workspaceError = error;
    }
    if (workspace)
      return {
        kind: "console",
        key: consoleKey,
        orgId: workspace.id,
        workspaceName: workspace.name,
      };
    if (workspaceError) throw workspaceError;
    return { kind: "console-unresolved", key: consoleKey };
  }
  const service = serviceKey(env);
  if (service) return { kind: "console", key: service, orgId: null };
  return null;
}

const ENDPOINT_KIND = {
  opencode: "console",
  openrouter: "openrouter",
  custom: "custom",
};

function backendFromConfig(config, env) {
  const kind = ENDPOINT_KIND[config.endpoint] ?? "custom";
  const url =
    config.url ?? { console: CONSOLE_URL, openrouter: OPENROUTER_URL }[kind];
  if (!url)
    throw new Error(
      `jew-guard config: endpoint "${config.endpoint}" needs a url; run jew-guard auth`,
    );
  checkUrl(url, "jew-guard config url");
  const key = config.keyProvider
    ? authKey(config.keyProvider, env)
    : (config.key ?? (kind === "console" ? consoleToken(env) : undefined));
  if (!key)
    throw new Error(
      `jew-guard config: no credential${config.keyProvider ? ` for provider "${config.keyProvider}" in opencode.db` : ""}; run jew-guard auth`,
    );
  return { kind, key, url, orgId: config.org ?? null };
}

function checkUrl(url, label) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`${label} is not a URL: ${url}`);
  }
  if (
    parsedUrl.protocol !== "https:" &&
    !(parsedUrl.protocol === "http:" && isLocal(parsedUrl.hostname))
  )
    throw new Error(
      `${label} must be https, or http on localhost or a private address: ${url}`,
    );
}

function isLocal(host) {
  if (LOOPBACK.has(host)) return true;
  const parts = String(host).split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return false;
  return (
    parts[0] === 127 ||
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

export async function ask(state, questions, options = {}) {
  const { env = process.env } = options;
  const resolved = await backend(env);
  if (!resolved || resolved.kind === "console-unresolved") {
    if (!resolved)
      throw new Error(
        "no credentials: run /connect in opencode, or configure a key with jew-guard auth",
      );
    throw new Error(
      "console workspaces unresolved: run /jew-workspace and pick your workspace",
    );
  }
  return request(
    options.model ? { ...resolved, model: options.model } : resolved,
    state,
    questions,
    options,
  );
}

async function request(
  target,
  state,
  questions,
  { env = process.env, fetchImpl = fetch, signal, timeoutMs } = {},
) {
  const budget = AbortSignal.timeout(
    timeoutMs ?? +(env.JEW_GUARD_TIMEOUT_MS || 20_000),
  );
  const abort = signal ? AbortSignal.any([signal, budget]) : budget;
  const model = target.model ?? effectiveModel(env)?.model;
  if (!model)
    throw new Error(
      "no model configured: run /jew-model or jew-guard model set <id>",
    );
  const url = target.url ?? CONSOLE_URL;
  const headers = { "Content-Type": "application/json" };
  if (target.key) headers.Authorization = `Bearer ${target.key}`;
  if (target.orgId) headers["x-opencode-org-id"] = target.orgId;
  const post = () =>
    fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ state, model, questions }),
      signal: abort,
    });
  let response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await post();
      if (
        response.ok ||
        (response.status !== 429 && response.status < 500) ||
        attempt === 2
      )
        break;
      await response.text().catch(() => {});
    } catch (err) {
      if (abort.aborted || attempt === 2) throw err;
    }
    await sleep(600 * 2 ** attempt, abort);
  }
  if (!response.ok)
    throw new Error(
      `${target.kind} HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  const body = await response.json();
  const providerConfidence = body.providerMetadata?.typesafe?.confidence ?? {};
  return mapValues(body.answers ?? {}, (answer, id) => ({
    p: finiteNumber(answer?.noul ?? answer?.probability),
    choice: typeof answer?.choice === "string" ? answer.choice : undefined,
    score: finiteNumber(answer?.score),
    probabilities: probabilityMap(answer?.probabilities),
    confidence: finiteNumber(answer?.confidence ?? providerConfidence?.[id]),
  }));
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const finiteNumber = (value) => {
  const number = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(number) ? number : undefined;
};

const probabilityMap = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, probability]) => [key, finiteNumber(probability)])
      .filter(([, probability]) => probability !== undefined),
  );
};

function mapValues(obj, transform) {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [key, transform(value, key)]),
  );
}
