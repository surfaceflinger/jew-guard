import { readConfig, updateConfig } from "./config.js";

const catalogUrl =
  "https://openrouter.ai/api/v1/models?output_modalities=decisions";

const trimmedOrNull = (model) =>
  typeof model === "string" && model.trim() ? model.trim() : null;

export function readModel(env = process.env) {
  return trimmedOrNull(readConfig(env)?.model);
}

export function saveModel(model) {
  updateConfig({ model });
}

export function deleteModel() {
  updateConfig({ model: undefined });
}

export function effectiveModel(env = process.env) {
  const model = readModel(env);
  return model ? { model, source: "config" } : null;
}

export async function decisionModels({ fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl(catalogUrl, {
    signal: signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`decision model catalog HTTP ${response.status}`);
  const payload = await response.json();
  return (payload.data ?? [])
    .map((entry) => {
      const id = String(entry.id);
      return {
        id,
        name: String(entry.name ?? id),
        vendor: id.replace(/^~/, "").split("/")[0],
      };
    })
    .sort(
      (a, b) =>
        a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name),
    );
}
