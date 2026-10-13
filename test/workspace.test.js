import test from "node:test";
import assert from "node:assert/strict";
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
