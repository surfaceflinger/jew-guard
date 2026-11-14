import { createRequire } from "node:module";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

// node:sqlite is synchronous, so credential lookup stays sync; older Node throws and we treat it as no credential.
const require = createRequire(import.meta.url);

const opencodeDir = (env) =>
  join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode");

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
      const row = db
        .prepare(
          "select value from credential where integration_id = ? order by active desc limit 1",
        )
        .get(provider);
      const key = row && JSON.parse(row.value)?.key;
      if (typeof key === "string" && key.trim()) return key.trim();
    } catch {
    } finally {
      try {
        db?.close();
      } catch {}
    }
  }
  return null;
}

export function authKey(provider, env = process.env) {
  return dbKey(provider, env);
}

export function serviceKey(env = process.env) {
  return authKey("opencode-go", env) ?? authKey("opencode", env);
}

export function consoleToken(env = process.env) {
  return (
    env.OPENCODE_CONSOLE_TOKEN ||
    env.OPENCODE_API_KEY ||
    serviceKey(env) ||
    null
  );
}
