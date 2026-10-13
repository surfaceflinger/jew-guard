// Per-session memory shared by hook invocations, which are separate processes on most hosts.
// One small JSON file per session under ~/.config/jew-guard/sessions: recent decisions and
// every flagged piece of untrusted content — so a later tool call can be judged against them.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./paths.js";

const DIR = () => process.env.JEV_GUARD_SESSIONS ?? join(configDir(), "sessions");
const CAPS = { calls: 12, flags: 10 };
const EMPTY = () => ({ calls: [], flags: [] });

export function sessionFile(id) {
  return join(DIR(), createHash("sha1").update(String(id)).digest("hex").slice(0, 16) + ".json");
}

export function readSession(id) {
  if (!id) return EMPTY();
  try { return { ...EMPTY(), ...JSON.parse(readFileSync(sessionFile(id), "utf8")) }; } catch { return EMPTY(); }
}

/** Append `item` to one of the lists; oldest entries fall off. No-op without a session id. */
export function remember(id, key, item) {
  if (!id || !item) return;
  const s = readSession(id);
  s[key] = [...s[key], { ...item, at: Date.now() }].slice(-CAPS[key]);
  s.updated = Date.now();
  mkdirSync(DIR(), { recursive: true, mode: 0o700 });
  const file = sessionFile(id), tmp = `${file}.tmp`;  // rename: a hook killed mid-write must not corrupt memory
  writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
  renameSync(tmp, file);
  prune();
}

// ponytail: sweep sessions older than 7 days once the directory passes 200 files; no scheduler.
function prune() {
  let files;
  try { files = readdirSync(DIR()); } catch { return; }
  if (files.length < 200) return;
  const cutoff = Date.now() - 7 * 86_400_000;
  for (const f of files) {
    const p = join(DIR(), f);
    try { if (statSync(p).mtimeMs < cutoff) unlinkSync(p); } catch {}
  }
}
