import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchWorkspace } from "../src/workspace.js";

const SPACES = [{ id: "wrk_1", name: "sucrose" }, { id: "org_2", name: "opencode" }];

test("match by id, name, case-insensitive; blank/unknown null", () => {
  assert.deepEqual(matchWorkspace(SPACES, "wrk_1"), SPACES[0]);
  assert.deepEqual(matchWorkspace(SPACES, "SUCROSE"), SPACES[0]);
  assert.deepEqual(matchWorkspace(SPACES, "  opencode "), SPACES[1]);
  assert.equal(matchWorkspace(SPACES, "nope"), null);
  assert.equal(matchWorkspace(SPACES, ""), null);
  assert.equal(matchWorkspace(SPACES, null), null);
});

test("selection reads config.json org, then the legacy workspace.json", async () => {
  const { readSelection, saveSelection } = await import("../src/workspace.js");
  const dir = mkdtempSync(join(tmpdir(), "jew-"));
  const prev = { c: process.env.JEV_GUARD_CONFIG_FILE, w: process.env.JEV_GUARD_WORKSPACE_FILE };
  writeFileSync(join(dir, "legacy.json"), JSON.stringify({ id: "wrk_legacy", name: "old" }));
  process.env.JEV_GUARD_CONFIG_FILE = join(dir, "config.json");
  process.env.JEV_GUARD_WORKSPACE_FILE = join(dir, "legacy.json");
  try {
    assert.deepEqual(readSelection(), { id: "wrk_legacy", name: "old" });
    saveSelection({ id: "wrk_1", name: "sucrose" });
    assert.deepEqual(readSelection(), { id: "wrk_1", name: "sucrose" });
  } finally {
    if (prev.c === undefined) delete process.env.JEV_GUARD_CONFIG_FILE; else process.env.JEV_GUARD_CONFIG_FILE = prev.c;
    if (prev.w === undefined) delete process.env.JEV_GUARD_WORKSPACE_FILE; else process.env.JEV_GUARD_WORKSPACE_FILE = prev.w;
  }
});

test("console token falls back to the opencode service key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jew-"));
  mkdirSync(join(dir, "opencode"), { recursive: true });
  writeFileSync(join(dir, "opencode", "auth.json"), JSON.stringify({ "opencode-go": { key: "oc_sk_test" } }));
  const { consoleToken } = await import("../src/auth.js");
  assert.equal(consoleToken({ XDG_DATA_HOME: dir }), "oc_sk_test");
  assert.equal(consoleToken({ OPENCODE_API_KEY: "api-key" }), "api-key");
});
