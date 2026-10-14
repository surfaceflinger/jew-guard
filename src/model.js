import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readConfig, updateConfig } from "./config.js";
import { configDir } from "./paths.js";

const legacyFile = () => process.env.JEV_GUARD_MODEL_FILE ?? join(configDir(), "model.json");
const trimmedOrNull = (model) => typeof model === "string" && model.trim() ? model.trim() : null;

export function readModel() {
  const config = readConfig();
  if (trimmedOrNull(config?.model)) return trimmedOrNull(config.model);
  try {
    const saved = JSON.parse(readFileSync(legacyFile(), "utf8"));
    if (trimmedOrNull(saved?.model)) return trimmedOrNull(saved.model);
  } catch {}
  return null;
}

export function saveModel(model) {
  updateConfig({ model });
}

export function deleteModel() {
  updateConfig({ model: undefined });
}

export function effectiveModel(env = process.env, backendKind = "console") {
  if (env.JEV_MODEL) return { model: env.JEV_MODEL, source: "JEV_MODEL" };
  const config = readConfig(env);
  const configured = trimmedOrNull(config?.model);
  if (configured) return { model: configured, source: "config" };
  const savedPick = readModel();
  if (savedPick) return { model: savedPick, source: "saved pick" };
  const defaults = { console: "jev-1.13-free", openrouter: "inception/mercury-decide:free" };
  return { model: defaults[backendKind] ?? "jev-latest", source: "default" };
}
