import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readConfig, updateConfig } from "./config.js";
import { configDir } from "./paths.js";

const CONSOLE_ORGS_URL = "https://opencode.ai/console/api/orgs";
const CONSOLE_CONFIG_URL = "https://opencode.ai/console/api/v2/config";

const legacyFile = () => process.env.JEV_GUARD_WORKSPACE_FILE ?? join(configDir(), "workspace.json");

export function consoleToken(env = process.env) {
  return env.OPENCODE_CONSOLE_TOKEN || env.OPENCODE_API_KEY || null;
}

export async function listWorkspaces({ env = process.env, fetchImpl = fetch } = {}) {
  const token = consoleToken(env);
  if (!token) throw new Error("no console credential: run /connect in opencode first");
  const response = await fetchImpl(CONSOLE_ORGS_URL, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`console HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const payload = await response.json();
  return (Array.isArray(payload) ? payload : []).map((workspace) => ({ id: String(workspace.id), name: String(workspace.name ?? workspace.id) }));
}

export function readSelection() {
  const config = readConfig();
  if (typeof config?.org === "string" && config.org) return { id: config.org, name: String(config.orgName ?? config.org) };
  try {
    const saved = JSON.parse(readFileSync(legacyFile(), "utf8"));
    if (saved && typeof saved.id === "string" && saved.id) return { id: saved.id, name: String(saved.name ?? saved.id) };
  } catch {}
  return null;
}

export function saveSelection(selection) {
  updateConfig({ org: selection.id, orgName: selection.name ?? selection.id });
}

export function matchWorkspace(workspaces, want) {
  const query = String(want ?? "").trim().toLowerCase();
  if (!query) return null;
  return workspaces.find((workspace) => workspace.id.toLowerCase() === query || workspace.name.toLowerCase() === query) ?? null;
}

export async function resolveWorkspace(env = process.env, options = {}) {
  if (!consoleToken(env)) return null;
  const spaces = options.spaces ?? await listWorkspaces({ env, fetchImpl: options.fetchImpl ?? fetch });
  if (!spaces.length) return null;
  const want = env.JEV_GUARD_WORKSPACE;
  if (want) return matchWorkspace(spaces, want);
  const saved = readSelection();
  if (saved) {
    const match = spaces.find((workspace) => workspace.id === saved.id);
    if (match) return match;
  }
  if (spaces.length === 1) return spaces[0];
  return null;
}

export async function validateWorkspace(selection, { env = process.env, fetchImpl = fetch } = {}) {
  const token = consoleToken(env);
  if (!token) return false;
  const response = await fetchImpl(CONSOLE_CONFIG_URL, {
    headers: { Authorization: `Bearer ${token}`, "x-org-id": selection.id },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  return !!response?.ok;
}
