// Static config written by the jew-guard CLI (bin/jew-guard): endpoint, credential
// reference, workspace and model pick. No file = zeroconf auto-detection
// (env, opencode auth.json, OpenRouter fallback).
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const configFile = (env = process.env) =>
  env.JEV_GUARD_CONFIG_FILE ?? join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "jew-guard", "config.json");

export function readConfig(env = process.env, file = configFile(env)) {
  try {
    const c = JSON.parse(readFileSync(file, "utf8"));
    return c && typeof c === "object" ? c : null;
  } catch { return null; }
}

/** Merge `patch` into config.json; undefined values delete keys. Written 0600. */
export function updateConfig(patch, env = process.env, file = configFile(env)) {
  const existing = readConfig(env, file);
  if (existing === null && existsSync(file))
    throw new Error(`jew-guard: ${file} is not valid JSON; fix or delete it`);  // don't rewrite a file we can't read
  const c = { ...(existing ?? {}), ...patch };
  for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
  if (!Object.keys(c).length) {
    try { unlinkSync(file); } catch {}  // nothing left to store: don't leave a bare {}
    return c;
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, file);
  return c;
}
