// Console workspace resolution for jew-guard.
//
// The Console token is already in our environment (opencode injects
// OPENCODE_CONSOLE_TOKEN into every session; OPENCODE_API_KEY works too).
// What opencode never tells a plugin is *which* workspace /connect chose,
// so when the account has more than one we ask the human once via
// /jev-workspace and remember a non-secret {id, name} pointer — never a key.
//
// Nothing here reads auth.json, opencode.db, or any other opencode file.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readConfig, updateConfig } from "./config.js";
import { configDir } from "./paths.js";

// Console org listing. (Deliberately not imported from jev.js: that module
// imports resolveWorkspace from here, so sharing the constant would be a cycle.)
const CONSOLE_ORGS_URL = "https://opencode.ai/console/api/orgs";

// Picks made before config.json existed live here; read-only, migrated on the next save.
const LEGACY = () => process.env.JEV_GUARD_WORKSPACE_FILE ?? join(configDir(), "workspace.json");

export function consoleToken(env = process.env) {
  return env.OPENCODE_CONSOLE_TOKEN || env.OPENCODE_API_KEY || null;
}

/** @returns {Promise<Array<{id: string, name: string}>>} */
export async function listWorkspaces({ env = process.env, fetchImpl = fetch } = {}) {
  const token = consoleToken(env);
  if (!token) throw new Error("no console credential: run /connect in opencode first");
  const res = await fetchImpl(CONSOLE_ORGS_URL, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`console HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : []).map((w) => ({ id: String(w.id), name: String(w.name ?? w.id) }));
}

export function readSelection() {
  const c = readConfig();
  if (typeof c?.org === "string" && c.org) return { id: c.org, name: String(c.orgName ?? c.org) };
  try {
    const s = JSON.parse(readFileSync(LEGACY(), "utf8"));
    if (s && typeof s.id === "string" && s.id) return { id: s.id, name: String(s.name ?? s.id) };
  } catch {}
  return null;
}

/** Persists a non-secret workspace pointer (id + name only, never any key). */
export function saveSelection(sel) {
  updateConfig({ org: sel.id, orgName: sel.name ?? sel.id });
}

/** Find a workspace by id or name (case-insensitive). Pure; also used by the /jev-workspace fast path. */
export function matchWorkspace(spaces, want) {
  const w = String(want ?? "").trim().toLowerCase();
  if (!w) return null;
  return spaces.find((ws) => ws.id.toLowerCase() === w || ws.name.toLowerCase() === w) ?? null;
}

/**
 * Resolve the workspace to bill Jev calls to, or null when the human must pick.
 * Order: JEV_GUARD_WORKSPACE (id or name) > saved selection (if still valid)
 * > single workspace auto-select. Multiple workspaces with no selection → null.
 */
export async function resolveWorkspace(env = process.env, opts = {}) {
  if (!consoleToken(env)) return null;
  const spaces = opts.spaces ?? await listWorkspaces({ env, fetchImpl: opts.fetchImpl ?? fetch });
  if (!spaces.length) return null;
  const want = env.JEV_GUARD_WORKSPACE;
  if (want) return matchWorkspace(spaces, want);
  const saved = readSelection();
  if (saved) {
    const hit = spaces.find((w) => w.id === saved.id);
    if (hit) return hit;
  }
  if (spaces.length === 1) return spaces[0];
  return null;
}

/** True when `sel` still exists and the token is accepted for it. */
export async function validateWorkspace(sel, { env = process.env, fetchImpl = fetch } = {}) {
  const token = consoleToken(env);
  if (!token) return false;
  // NOTE: this Console endpoint takes `x-org-id`; inference endpoints take
  // `x-opencode-org-id`. Both verified live — do not "unify" them.
  const res = await fetchImpl("https://opencode.ai/console/api/v2/config", {
    headers: { Authorization: `Bearer ${token}`, "x-org-id": sel.id },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  return !!res?.ok;
}
