import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanInstructionsCached } from "../src/skills.js";

const res = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body), json: async () => body });

test("cached verdict keeps probabilities: contested clean flags the same on re-read", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jew-"));
  const prevCache = process.env.JEV_GUARD_SCAN_CACHE;
  process.env.JEV_GUARD_SCAN_CACHE = join(dir, "scan-cache.json");
  let calls = 0;
  const opts = {
    env: { JEV_BASE_URL: "https://kev.example", XDG_CONFIG_HOME: dir, XDG_DATA_HOME: dir },
    fetchImpl: async () => {
      calls++;
      return res(200, { answers: {
        malicious: { noul: 0.4 },
        kind: { choice: "clean", confidence: 0.5, probabilities: { clean: 0.55, exfiltration: 0.45, covert_execution: 0, instruction_override: 0, canary: 0, unrelated_side_effects: 0 } },
      } });
    },
  };
  try {
    const text = "a helpful skill file, long enough to pass the length floor, nothing else";
    const first = await scanInstructionsCached({ text, source: "SKILL.md" }, opts);
    assert.equal(first.flagged, true);
    assert.equal(first.kind, "exfiltration");
    assert.equal(first.cached, false);
    const second = await scanInstructionsCached({ text, source: "SKILL.md" }, opts);
    assert.equal(calls, 1);
    assert.equal(second.cached, true);
    assert.equal(second.flagged, true);
    assert.equal(second.kind, "exfiltration");
  } finally {
    if (prevCache === undefined) delete process.env.JEV_GUARD_SCAN_CACHE;
    else process.env.JEV_GUARD_SCAN_CACHE = prevCache;
  }
});
