// Sweep the instruction files an agent will obey — skills, plugins, rules, AGENTS.md — for behavior their
// installer would not expect. Results are cached by content hash, so a repeated sweep costs nothing until a
// file changes.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MIN_SCAN_CHARS, scanInstructions, thresholds, verdictInstructions } from "./guard.js";
import { configDir } from "./paths.js";

const CACHE = () => process.env.JEV_GUARD_SCAN_CACHE ?? join(configDir(), "scan-cache.json");
const CACHE_VERSION = 2;  // bump when the verdict logic changes so old rows get rescanned once

/** scanInstructions with the content-hash cache in front: the same text is never sent to Jev twice, and the verdict is
 *  recomputed from the cached answer (kind, p) so threshold changes apply to old scans. */
export async function scanInstructionsCached({ text, source }, opts = {}) {
  if (!text || text.length < MIN_SCAN_CHARS) return null;
  const t = thresholds(opts.env ?? process.env);
  const key = createHash("sha1").update(text).digest("hex");
  const hit = readCache()[key];
  if (hit?.v === CACHE_VERSION) {
    const a = { malicious: { p: hit.p }, kind: { choice: hit.kind, probabilities: hit.probs, confidence: hit.conf } };
    return { ...verdictInstructions(a, source, t), cached: true };
  }
  const r = await scanInstructions({ text, source }, opts);
  writeCache({ ...readCache(), [key]: { v: CACHE_VERSION, kind: r.kind, p: +r.p.toFixed(2), probs: r.probs, conf: r.confidence, at: Date.now() } });  // re-read: another hook may have written meanwhile
  return { ...r, cached: false };
}

function readCache() { try { return JSON.parse(readFileSync(CACHE(), "utf8")); } catch { return {}; } }
function writeCache(cache) {
  const entries = Object.entries(cache).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).slice(0, 5000);  // ponytail: cap, no LRU
  mkdirSync(dirname(CACHE()), { recursive: true, mode: 0o700 });
  const tmp = `${CACHE()}.tmp`;  // rename: a killed hook must not leave half a cache behind
  writeFileSync(tmp, JSON.stringify(Object.fromEntries(entries)));
  renameSync(tmp, CACHE());
}
