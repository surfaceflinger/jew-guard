// YOLO and SOFT modes: who decides what.
//
// Normal: allow → run, ask → prompt, deny → block.
// Yolo: the human leaves the loop for the uncertain calls — ask collapses
// into allow; only deny still blocks.
// Soft: denies are downgraded to approval prompts instead of blocks, for OS
// maintenance and other inherently-privileged work where the human wants the
// final call. Fail-closed still applies, injection flags still toast, and
// read-only tools Jev skips stay auto-approved under yolo.
//
// Combined: natural ask → allow (yolo), deny → prompt (soft always wins for
// denies — a soft-downgraded deny is never yolo-collapsed, otherwise soft
// would be pointless). Both off: normal.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { configDir } from "./paths.js";

const FILE = () => process.env.JEV_GUARD_YOLO_FILE ?? join(configDir(), "yolo.json");

export function readModes(file = FILE()) {
  try {
    const s = JSON.parse(readFileSync(file, "utf8"));
    return { yolo: !!s.yolo || !!s.on, soft: !!s.soft, at: s.at ?? null };
  } catch { return { yolo: false, soft: false, at: null }; }
}

// Back-compat wrappers: yolo.json historically stored {on}.
export function readYolo(file = FILE()) {
  const m = readModes(file);
  return { on: m.yolo, at: m.at };
}

function writeModes(state, file = FILE()) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(state) + "\n", { mode: 0o600 });
}

export function setYolo(on, file = FILE()) {
  const cur = readModes(file);
  writeModes({ ...cur, yolo: !!on, at: Date.now() }, file);
  return !!on;
}

export function setSoft(on, file = FILE()) {
  const cur = readModes(file);
  writeModes({ ...cur, soft: !!on, at: Date.now() }, file);
  return !!on;
}

/** Pure mapping: Jev verdict (null = skipped/unreachable-fail-open) → prompt action (null = leave). */
export function resolveLevel(level, { yolo = false, soft = false } = {}) {
  if (level === "deny") return soft ? "ask" : "deny";
  if (level === null) return yolo ? "allow" : null;
  if (level === "ask") return yolo ? "allow" : "ask";
  return "allow";
}

/** Env forcing counts: JEV_GUARD_YOLO / JEV_GUARD_SOFT = 1/on/true enable without a file. */
function envOn(v) {
  const s = String(v ?? "").toLowerCase();
  return s === "1" || s === "on" || s === "true";
}

export function isYolo(env = process.env) {
  if (envOn(env.JEV_GUARD_YOLO)) return true;
  return readModes().yolo;
}

export function isSoft(env = process.env) {
  if (envOn(env.JEV_GUARD_SOFT)) return true;
  return readModes().soft;
}
