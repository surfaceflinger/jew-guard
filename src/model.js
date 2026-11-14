import { readConfig, updateConfig } from "./config.js";

const trimmedOrNull = (model) =>
  typeof model === "string" && model.trim() ? model.trim() : null;

function savedModel(env = process.env) {
  const configured = trimmedOrNull(readConfig(env)?.model);
  return configured ? { model: configured, source: "config" } : null;
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
  const defaults = {
    console: "jev-1.13-free",
    openrouter: "inception/mercury-decide:free",
  };
  return { model: defaults[backendKind] ?? "jev-latest", source: "default" };
}
