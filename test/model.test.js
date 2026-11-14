import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteModel,
  effectiveModel,
  readModel,
  saveModel,
} from "../src/model.js";

function isolate({ config } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "jew-"));
  const previous = process.env.JEV_GUARD_CONFIG_FILE;
  process.env.JEV_GUARD_CONFIG_FILE = join(dir, "config.json");
  if (config) {
    writeFileSync(process.env.JEV_GUARD_CONFIG_FILE, JSON.stringify(config));
  }
  return {
    path: process.env.JEV_GUARD_CONFIG_FILE,
    env: { JEV_GUARD_CONFIG_FILE: process.env.JEV_GUARD_CONFIG_FILE },
    restore() {
      if (previous === undefined) delete process.env.JEV_GUARD_CONFIG_FILE;
      else process.env.JEV_GUARD_CONFIG_FILE = previous;
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
  } finally {
    iso.restore();
  }
});

test("effective model: env > config > default", () => {
  const iso = isolate({ config: { model: "from-config" } });
  try {
    assert.deepEqual(
      effectiveModel({ ...iso.env, JEV_MODEL: "custom-x" }, "console"),
      { model: "custom-x", source: "JEV_MODEL" },
    );
    assert.deepEqual(effectiveModel(iso.env, "console"), {
      model: "from-config",
      source: "config",
    });
    assert.deepEqual(effectiveModel(iso.env, "openrouter"), {
      model: "from-config",
      source: "config",
    });
  } finally {
    iso.restore();
  }
  const empty = isolate();
  try {
    assert.deepEqual(effectiveModel(empty.env, "console"), {
      model: "jev-1.13-free",
      source: "default",
    });
    assert.deepEqual(effectiveModel(empty.env, "openrouter"), {
      model: "inception/mercury-decide:free",
      source: "default",
    });
    assert.deepEqual(effectiveModel(empty.env, "typesafe"), {
      model: "jev-latest",
      source: "default",
    });
  } finally {
    empty.restore();
  }
});

test("clearing the last setting removes config.json", () => {
  const iso = isolate({ config: { model: "x" } });
  try {
    deleteModel();
    assert.equal(existsSync(iso.path), false);
  } finally {
    iso.restore();
  }
});

test("deleteModel removes the pick and keeps the rest of config.json", () => {
  const iso = isolate({
    config: { endpoint: "openrouter", model: "inception/mercury-decide:free" },
  });
  try {
    deleteModel();
    assert.equal(readModel(), null);
    const config = JSON.parse(readFileSync(iso.path, "utf8"));
    assert.equal(config.model, undefined);
    assert.equal(config.endpoint, "openrouter");
  } finally {
    iso.restore();
  }
});
