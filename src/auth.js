import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function authKey(provider, env = process.env) {
  try {
    const dataDir = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
    const stored = JSON.parse(readFileSync(join(dataDir, "opencode", "auth.json"), "utf8"))?.[provider]?.key;
    if (typeof stored === "string" && stored.trim()) return stored.trim();
  } catch {}
  return null;
}

export function serviceKey(env = process.env) {
  return authKey("opencode-go", env) ?? authKey("opencode", env);
}

export function consoleToken(env = process.env) {
  return env.OPENCODE_CONSOLE_TOKEN || env.OPENCODE_API_KEY || serviceKey(env) || null;
}
