import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

// node:sqlite is synchronous, so credential lookup stays sync; older Node throws and we fall back.
const require = createRequire(import.meta.url);

const opencodeDir = (env) => join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode");

function fileKey(provider, env) {
  try {
    const stored = JSON.parse(readFileSync(join(opencodeDir(env), "auth.json"), "utf8"))?.[provider]?.key;
    if (typeof stored === "string" && stored.trim()) return stored.trim();
  } catch {}
  return null;
}

// opencode v2 stores provider keys in opencode.db; auth.json is only the legacy fallback.
function dbKey(provider, env) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch {
    return null;
  }
  const dir = opencodeDir(env);
  const override = env.OPENCODE_DB;
  const candidates = [
    override && (isAbsolute(override) ? override : join(dir, override)),
    join(dir, "opencode.db"),
    join(dir, "opencode-stable.db"),
  ];
  for (const path of candidates) {
    if (!path) continue;
    let db;
    try {
      db = new DatabaseSync(path, { readOnly: true });
      const row = db.prepare("select value from credential where integration_id = ? order by active desc limit 1").get(provider);
      const key = row && JSON.parse(row.value)?.key;
      if (typeof key === "string" && key.trim()) return key.trim();
    } catch {
    } finally {
      try { db?.close(); } catch {}
    }
  }
  return null;
}

export function authKey(provider, env = process.env) {
  return dbKey(provider, env) ?? fileKey(provider, env);
}

export function serviceKey(env = process.env) {
  return authKey("opencode-go", env) ?? authKey("opencode", env);
}

export function consoleToken(env = process.env) {
  return env.OPENCODE_CONSOLE_TOKEN || env.OPENCODE_API_KEY || serviceKey(env) || null;
}
