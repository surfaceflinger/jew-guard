import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readConfig, updateConfig } from "./config.js";
import { configDir } from "./paths.js";

const legacyFile = (env = process.env) => env.JEV_GUARD_MODEL_FILE ?? join(configDir(env), "model.json");
const trimmedOrNull = (model) => typeof model === "string" && model.trim() ? model.trim() : null;

function savedModel(env = process.env) {
  const configured = trimmedOrNull(readConfig(env)?.model);
  if (configured) return { model: configured, source: "config" };
  try {
    const saved = JSON.parse(readFileSync(legacyFile(env), "utf8"));
    const model = trimmedOrNull(saved?.model);
    if (model) return { model, source: "saved pick" };
  } catch {}
  return null;
}

export function readModel(env = process.env) {
  return savedModel(env)?.model ?? null;
}

export function saveModel(model) {
  updateConfig({ model });
}

export function deleteModel() {
  updateConfig({ model: undefined });
}

export function effectiveModel(env = process.env, backendKind = "console") {
  if (env.JEV_MODEL) return { model: env.JEV_MODEL, source: "JEV_MODEL" };
  const saved = savedModel(env);
  if (saved) return saved;
  const defaults = { console: "jev-1.13-free", openrouter: "inception/mercury-decide:free" };
  return { model: defaults[backendKind] ?? "jev-latest", source: "default" };
}
