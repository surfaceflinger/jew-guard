// Model pick (non-secret), stored in config.json next to endpoint/workspace.
// Precedence: JEV_MODEL env > config.json > legacy model.json (read-only, for
// picks made before config.json existed) > backend default.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readConfig, updateConfig } from "./config.js";
import { configDir } from "./paths.js";

const LEGACY = () => process.env.JEV_GUARD_MODEL_FILE ?? join(configDir(), "model.json");
const valid = (m) => typeof m === "string" && m.trim() ? m.trim() : null;

export function readModel() {
  const config = readConfig();
  if (valid(config?.model)) return valid(config.model);
  try {
    const s = JSON.parse(readFileSync(LEGACY(), "utf8"));
    if (valid(s?.model)) return valid(s.model);
  } catch {}
  return null;
}

export function saveModel(model) {
  updateConfig({ model });
}

/** Remove the pick (e.g. a failed tentative switch with nothing to revert to). */
export function deleteModel() {
  updateConfig({ model: undefined });
}

/** Effective model: env > config.json > legacy pick > backend default. Returns {model, source}. */
export function effectiveModel(env = process.env, backendKind = "console") {
  if (env.JEV_MODEL) return { model: env.JEV_MODEL, source: "JEV_MODEL" };
  const config = readConfig(env);
  if (valid(config?.model)) return { model: valid(config.model), source: "config" };
  const saved = readModel();
  if (saved) return { model: saved, source: "saved pick" };
  const defaults = { console: "jev-1.13-free", openrouter: "inception/mercury-decide:free" };
  return { model: defaults[backendKind] ?? "jev-latest", source: "default" };
}
