import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { configDir } from "./paths.js";

const modeFile = () => process.env.JEV_GUARD_YOLO_FILE ?? join(configDir(), "yolo.json");

export function readModes(file = modeFile()) {
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    return { yolo: !!saved.yolo || !!saved.on, soft: !!saved.soft, at: saved.at ?? null };
  } catch { return { yolo: false, soft: false, at: null }; }
}

export function readYolo(file = modeFile()) {
  const modes = readModes(file);
  return { on: modes.yolo, at: modes.at };
}

function writeModes(state, file = modeFile()) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(state) + "\n", { mode: 0o600 });
}

export function setYolo(enabled, file = modeFile()) {
  const current = readModes(file);
  writeModes({ ...current, yolo: !!enabled, at: Date.now() }, file);
  return !!enabled;
}

export function setSoft(enabled, file = modeFile()) {
  const current = readModes(file);
  writeModes({ ...current, soft: !!enabled, at: Date.now() }, file);
  return !!enabled;
}

export function resolveLevel(level, { yolo = false, soft = false } = {}) {
  if (level === "deny") return soft ? "ask" : "deny";
  if (level === null) return yolo ? "allow" : null;
  if (level === "ask") return yolo ? "allow" : "ask";
  return "allow";
}

function isEnvOn(value) {
  const flag = String(value ?? "").toLowerCase();
  return flag === "1" || flag === "on" || flag === "true";
}

export function isYolo(env = process.env) {
  if (isEnvOn(env.JEV_GUARD_YOLO)) return true;
  return readModes().yolo;
}

export function isSoft(env = process.env) {
  if (isEnvOn(env.JEV_GUARD_SOFT)) return true;
  return readModes().soft;
}
