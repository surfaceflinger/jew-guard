import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isYolo, readYolo, setYolo } from "../src/yolo.js";

const file = () => join(mkdtempSync(join(tmpdir(), "jew-")), "yolo.json");

test("roundtrip + env forcing", () => {
  const f = file();
  const prevFile = process.env.JEV_GUARD_YOLO_FILE;
  const prevFlag = process.env.JEV_GUARD_YOLO;
  process.env.JEV_GUARD_YOLO_FILE = f;
  delete process.env.JEV_GUARD_YOLO;
  try {
    assert.equal(readYolo(f).on, false);
    setYolo(true, f);
    assert.equal(readYolo(f).on, true);
    setYolo(false, f);
    assert.equal(readYolo(f).on, false);
    assert.equal(isYolo({ ...process.env, JEV_GUARD_YOLO: "1" }), true);
    assert.equal(isYolo({ ...process.env }), false);
  } finally {
    if (prevFile !== undefined) process.env.JEV_GUARD_YOLO_FILE = prevFile; else delete process.env.JEV_GUARD_YOLO_FILE;
    if (prevFlag !== undefined) process.env.JEV_GUARD_YOLO = prevFlag;
  }
});

test("env forcing wins over file", () => {
  const f = file();
  setYolo(false, f);
  process.env.JEV_GUARD_YOLO_FILE = f;
  const saved = process.env.JEV_GUARD_YOLO;
  try {
    assert.equal(isYolo({}), false);
    assert.equal(isYolo({ JEV_GUARD_YOLO: "on" }), true);
  } finally {
    delete process.env.JEV_GUARD_YOLO_FILE;
    if (saved !== undefined) process.env.JEV_GUARD_YOLO = saved;
  }
});

test("resolveLevel matrix", async () => {
  const { resolveLevel, setSoft } = await import("../src/yolo.js");
  const t = (level, opts) => resolveLevel(level, opts);
  assert.equal(t("allow", {}), "allow");
  assert.equal(t("ask", {}), "ask");
  assert.equal(t("deny", {}), "deny");
  assert.equal(t(null, {}), null);
  assert.equal(t("ask", { yolo: true }), "allow");
  assert.equal(t(null, { yolo: true }), "allow");
  assert.equal(t("deny", { yolo: true }), "deny");
  assert.equal(t("deny", { soft: true }), "ask");
  assert.equal(t("deny", { yolo: true, soft: true }), "ask");
  assert.equal(t("ask", { soft: true }), "ask");
});

test("soft flag roundtrip", async () => {
  const { isSoft, setSoft } = await import("../src/yolo.js");
  const f = file();
  const prevFile = process.env.JEV_GUARD_YOLO_FILE;
  const prevFlag = process.env.JEV_GUARD_SOFT;
  process.env.JEV_GUARD_YOLO_FILE = f;
  delete process.env.JEV_GUARD_SOFT;
  try {
    setSoft(true, f);
    assert.equal(isSoft({}), true);
    setSoft(false, f);
    assert.equal(isSoft({}), false);
    assert.equal(isSoft({ JEV_GUARD_SOFT: "1" }), true);
  } finally {
    if (prevFile !== undefined) process.env.JEV_GUARD_YOLO_FILE = prevFile; else delete process.env.JEV_GUARD_YOLO_FILE;
    if (prevFlag !== undefined) process.env.JEV_GUARD_SOFT = prevFlag;
  }
});

test("readModes understands legacy and current formats", async () => {
  const { readModes } = await import("../src/yolo.js");
  const { writeFileSync } = await import("node:fs");
  const f = file();
  writeFileSync(f, JSON.stringify({ on: true }));
  assert.deepEqual([readModes(f).yolo, readModes(f).soft], [true, false]);
  writeFileSync(f, JSON.stringify({ yolo: false, soft: true }));
  assert.deepEqual([readModes(f).yolo, readModes(f).soft], [false, true]);
});
