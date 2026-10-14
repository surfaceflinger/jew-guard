import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MIN_SCAN_CHARS, scanInstructions, thresholds, verdictInstructions } from "./guard.js";
import { configDir } from "./paths.js";

const cacheFile = () => process.env.JEV_GUARD_SCAN_CACHE ?? join(configDir(), "scan-cache.json");
const CACHE_VERSION = 2;
const MAX_CACHE_ENTRIES = 5000;

export async function scanInstructionsCached({ text, source }, options = {}) {
  if (!text || text.length < MIN_SCAN_CHARS) return null;
  const limits = thresholds(options.env ?? process.env);
  const cacheKey = createHash("sha1").update(text).digest("hex");
  const cached = readCache()[cacheKey];
  if (cached?.v === CACHE_VERSION) {
    const cachedAnswer = { malicious: { p: cached.p }, kind: { choice: cached.kind, probabilities: cached.probs, confidence: cached.conf } };
    return { ...verdictInstructions(cachedAnswer, source, limits), cached: true };
  }
  const fresh = await scanInstructions({ text, source }, options);
  writeCache({ ...readCache(), [cacheKey]: { v: CACHE_VERSION, kind: fresh.kind, p: +fresh.p.toFixed(2), probs: fresh.probs, conf: fresh.confidence, at: Date.now() } });
  return { ...fresh, cached: false };
}

function readCache() { try { return JSON.parse(readFileSync(cacheFile(), "utf8")); } catch { return {}; } }
function writeCache(cache) {
  const entries = Object.entries(cache).sort((first, second) => (second[1].at ?? 0) - (first[1].at ?? 0)).slice(0, MAX_CACHE_ENTRIES);
  mkdirSync(dirname(cacheFile()), { recursive: true, mode: 0o700 });
  const tmp = `${cacheFile()}.tmp`;
  writeFileSync(tmp, JSON.stringify(Object.fromEntries(entries)));
  renameSync(tmp, cacheFile());
}
