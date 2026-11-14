import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchWorkspace } from "../src/workspace.js";

const SPACES = [
  { id: "wrk_1", name: "sucrose" },
  { id: "org_2", name: "opencode" },
];

test("match by id, name, case-insensitive; blank/unknown null", () => {
  assert.deepEqual(matchWorkspace(SPACES, "wrk_1"), SPACES[0]);
  assert.deepEqual(matchWorkspace(SPACES, "SUCROSE"), SPACES[0]);
  assert.deepEqual(matchWorkspace(SPACES, "  opencode "), SPACES[1]);
  assert.equal(matchWorkspace(SPACES, "nope"), null);
  assert.equal(matchWorkspace(SPACES, ""), null);
  assert.equal(matchWorkspace(SPACES, null), null);
});

test("selection reads and writes the config.json org", async () => {
  const { readSelection, saveSelection } = await import("../src/workspace.js");
  const dir = mkdtempSync(join(tmpdir(), "jew-"));
  const previous = process.env.JEV_GUARD_CONFIG_FILE;
  process.env.JEV_GUARD_CONFIG_FILE = join(dir, "config.json");
  try {
    assert.equal(readSelection(), null);
    saveSelection({ id: "wrk_1", name: "sucrose" });
    assert.deepEqual(readSelection(), { id: "wrk_1", name: "sucrose" });
  } finally {
    if (previous === undefined) delete process.env.JEV_GUARD_CONFIG_FILE;
    else process.env.JEV_GUARD_CONFIG_FILE = previous;
  }
});

test("console token comes from the environment", async () => {
  const { consoleToken } = await import("../src/auth.js");
  assert.equal(consoleToken({ OPENCODE_API_KEY: "api-key" }), "api-key");
});
