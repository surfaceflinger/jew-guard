import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const configFile = (env = process.env) =>
  env.JEV_GUARD_CONFIG_FILE ?? join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "jew-guard", "config.json");

export function readConfig(env = process.env, file = configFile(env)) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch { return null; }
}

export function updateConfig(patch, env = process.env, file = configFile(env)) {
  const existing = readConfig(env, file);
  if (existing === null && existsSync(file))
    throw new Error(`jew-guard: ${file} is not valid JSON; fix or delete it`);
  const merged = { ...(existing ?? {}), ...patch };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  if (!Object.keys(merged).length) {
    try { unlinkSync(file); } catch {}
    return merged;
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, file);
  return merged;
}
