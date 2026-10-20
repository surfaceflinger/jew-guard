import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSession, remember, sessionFile } from "../src/session.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "jew-"));
  const previous = process.env.JEV_GUARD_SESSIONS;
  process.env.JEV_GUARD_SESSIONS = dir;
  return {
    dir,
    restore: () => {
      if (previous === undefined) delete process.env.JEV_GUARD_SESSIONS;
      else process.env.JEV_GUARD_SESSIONS = previous;
    },
  };
}

test("malformed session arrays are replaced and writes keep working", () => {
  const { dir, restore } = setup();
  const warn = console.warn;
  console.warn = () => {};
  try {
    writeFileSync(sessionFile("s"), JSON.stringify({ calls: null, flags: null }));
    assert.deepEqual(readSession("s"), { calls: [], flags: [] });
    assert.doesNotThrow(() => remember("s", "calls", { tool: "shell" }));
    assert.equal(readSession("s").calls.length, 1);
    assert.ok(readdirSync(dir).length >= 1);
  } finally {
    console.warn = warn;
    restore();
  }
});

test("session write failures do not throw", () => {
  const { dir, restore } = setup();
  const warn = console.warn;
  console.warn = () => {};
  try {
    writeFileSync(join(dir, "blocked"), "not a directory");
    process.env.JEV_GUARD_SESSIONS = join(dir, "blocked");
    assert.doesNotThrow(() => remember("s", "calls", { tool: "shell" }));
  } finally {
    console.warn = warn;
    restore();
  }
});

test("prune keeps the session directory at the configured cap", () => {
  const { dir, restore } = setup();
  try {
    for (let index = 0; index < 205; index++) writeFileSync(join(dir, `${index}.json`), "{}");
    remember("s", "calls", { tool: "shell" });
    assert.ok(readdirSync(dir).length <= 200);
  } finally { restore(); }
});
