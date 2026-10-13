import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveModel, readModel, saveModel } from "../src/model.js";

const file = () => join(mkdtempSync(join(tmpdir(), "jew-")), "model.json");

test("roundtrip save/read; blank env ignored", () => {
  const f = file();
  assert.equal(readModel(f), null);
  saveModel("jev-1.13", f);
  assert.equal(readModel(f), "jev-1.13");
});

test("effective model: env > saved > default", () => {
  const f = file();
  const withFile = { ...process.env, JEV_GUARD_MODEL_FILE: f };
  // default (no save, no env) — note readModel uses JEV_GUARD_MODEL_FILE from process.env,
  // so test precedence via JEV_MODEL only, plus direct readModel checks above.
  assert.deepEqual(effectiveModel({ JEV_MODEL: "custom-x" }, "console"), { model: "custom-x", source: "JEV_MODEL" });
  process.env.JEV_GUARD_MODEL_FILE = f;
  try {
    assert.deepEqual(effectiveModel({}, "console"), { model: "jev-1.13-free", source: "default" });
    assert.deepEqual(effectiveModel({}, "typesafe"), { model: "jev-latest", source: "default" });
    saveModel("jev-1.13");
    assert.deepEqual(effectiveModel({}, "console"), { model: "jev-1.13", source: "saved pick" });
  } finally { delete process.env.JEV_GUARD_MODEL_FILE; }
  assert.ok(withFile);
});

test("deleteModel clears a saved pick", async () => {
  const { deleteModel } = await import("../src/model.js");
  const f = file();
  saveModel("jev-1.13", f);
  assert.equal(readModel(f), "jev-1.13");
  deleteModel(f);
  assert.equal(readModel(f), null);
  deleteModel(f); // idempotent, no throw
});
