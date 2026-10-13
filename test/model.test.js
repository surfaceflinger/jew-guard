import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveModel, readModel, saveModel } from "../src/model.js";

// config.json and legacy model.json both live in temp dirs; the plugin reads the
// real ~/.config/jew-guard/* by default, so every test isolates both paths.
function isolate({ config, legacy } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "jew-"));
  const prev = { c: process.env.JEV_GUARD_CONFIG_FILE, m: process.env.JEV_GUARD_MODEL_FILE };
  process.env.JEV_GUARD_CONFIG_FILE = join(dir, "config.json");
  process.env.JEV_GUARD_MODEL_FILE = join(dir, "model.json");
  if (config) writeFileSync(process.env.JEV_GUARD_CONFIG_FILE, JSON.stringify(config));
  if (legacy) writeFileSync(process.env.JEV_GUARD_MODEL_FILE, JSON.stringify(legacy));
  return {
    path: process.env.JEV_GUARD_CONFIG_FILE,
    env: { JEV_GUARD_CONFIG_FILE: process.env.JEV_GUARD_CONFIG_FILE, JEV_GUARD_MODEL_FILE: process.env.JEV_GUARD_MODEL_FILE },
    restore() {
      for (const [k, v] of [["JEV_GUARD_CONFIG_FILE", prev.c], ["JEV_GUARD_MODEL_FILE", prev.m]]) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    },
  };
}

test("save writes config.json; read reads it back", () => {
  const iso = isolate();
  try {
    assert.equal(readModel(), null);
    saveModel("jev-1.13");
    assert.equal(readModel(), "jev-1.13");
    assert.equal(JSON.parse(readFileSync(iso.path, "utf8")).model, "jev-1.13");
  } finally { iso.restore(); }
});

test("effective model: env > config > legacy > default", () => {
  const iso = isolate({ config: { model: "from-config" }, legacy: { model: "from-legacy" } });
  try {
    assert.deepEqual(effectiveModel({ ...iso.env, JEV_MODEL: "custom-x" }, "console"), { model: "custom-x", source: "JEV_MODEL" });
    assert.deepEqual(effectiveModel(iso.env, "console"), { model: "from-config", source: "config" });
    assert.deepEqual(effectiveModel(iso.env, "openrouter"), { model: "from-config", source: "config" });
  } finally { iso.restore(); }
  const legacyOnly = isolate({ legacy: { model: "from-legacy" } });
  try {
    assert.deepEqual(effectiveModel(legacyOnly.env, "console"), { model: "from-legacy", source: "saved pick" });
  } finally { legacyOnly.restore(); }
  const empty = isolate();
  try {
    assert.deepEqual(effectiveModel(empty.env, "console"), { model: "jev-1.13-free", source: "default" });
    assert.deepEqual(effectiveModel(empty.env, "openrouter"), { model: "inception/mercury-decide:free", source: "default" });
    assert.deepEqual(effectiveModel(empty.env, "typesafe"), { model: "jev-latest", source: "default" });
  } finally { empty.restore(); }
});

test("clearing the last setting removes config.json", async () => {
  const iso = isolate({ config: { model: "x" } });
  try {
    const { deleteModel } = await import("../src/model.js");
    deleteModel();
    assert.equal(existsSync(iso.path), false);
  } finally { iso.restore(); }
});

test("deleteModel removes the pick and keeps the rest of config.json", async () => {
  const iso = isolate({ config: { endpoint: "openrouter", model: "inception/mercury-decide:free" }, legacy: { model: "from-legacy" } });
  try {
    const { deleteModel } = await import("../src/model.js");
    deleteModel();
    assert.equal(readModel(), "from-legacy");  // config cleared → legacy fallback shows again
    const config = JSON.parse(readFileSync(iso.path, "utf8"));
    assert.equal(config.model, undefined);
    assert.equal(config.endpoint, "openrouter");
    deleteModel(); // idempotent, no throw
  } finally { iso.restore(); }
});
