import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./paths.js";

const sessionDir = () => process.env.JEV_GUARD_SESSIONS ?? join(configDir(), "sessions");
const KEEP_LAST = { calls: 12, flags: 10 };
const MAX_SESSION_FILES = 200;
const SESSION_TTL_MS = 7 * 86_400_000;
const emptySession = () => ({ calls: [], flags: [] });

export function sessionFile(id) {
  return join(sessionDir(), createHash("sha1").update(String(id)).digest("hex").slice(0, 16) + ".json");
}

export function readSession(id) {
  if (!id) return emptySession();
  try { return { ...emptySession(), ...JSON.parse(readFileSync(sessionFile(id), "utf8")) }; } catch { return emptySession(); }
}

export function remember(id, list, item) {
  if (!id || !item) return;
  const session = readSession(id);
  session[list] = [...session[list], { ...item, at: Date.now() }].slice(-KEEP_LAST[list]);
  session.updated = Date.now();
  mkdirSync(sessionDir(), { recursive: true, mode: 0o700 });
  const file = sessionFile(id), tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(session), { mode: 0o600 });
  renameSync(tmp, file);
  prune();
}

function prune() {
  let files;
  try { files = readdirSync(sessionDir()); } catch { return; }
  if (files.length < MAX_SESSION_FILES) return;
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const fileName of files) {
    const entry = join(sessionDir(), fileName);
    try { if (statSync(entry).mtimeMs < cutoff) unlinkSync(entry); } catch {}
  }
}
