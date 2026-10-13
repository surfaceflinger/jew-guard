// Persisted Jev model pick (non-secret). JEV_MODEL env always wins when set;
// otherwise the /jev-model choice; otherwise the backend default
// (jev-1.13-free on the Console gateway, jev-latest elsewhere).
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { configDir } from "./paths.js";

const FILE = () => process.env.JEV_GUARD_MODEL_FILE ?? join(configDir(), "model.json");

export function readModel(file = FILE()) {
  try {
    const s = JSON.parse(readFileSync(file, "utf8"));
    if (s && typeof s.model === "string" && s.model.trim()) return s.model.trim();
  } catch {}
  return null;
}

export function saveModel(model, file = FILE()) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ model, at: Date.now() }) + "\n", { mode: 0o600 });
}

/** Remove a saved pick (e.g. a failed tentative switch with nothing to revert to). */
export function deleteModel(file = FILE()) {
  try { unlinkSync(file); } catch {}
}

/** Effective model: env > saved pick > backend default. Returns {model, source}. */
export function effectiveModel(env = process.env, backendKind = "console") {
  if (env.JEV_MODEL) return { model: env.JEV_MODEL, source: "JEV_MODEL" };
  const saved = readModel();
  if (saved) return { model: saved, source: "saved pick" };
  return { model: backendKind === "console" ? "jev-1.13-free" : "jev-latest", source: "default" };
}
