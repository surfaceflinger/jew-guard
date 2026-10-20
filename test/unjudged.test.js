import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlugin } from "./harness.js";
import { setYolo } from "../src/yolo.js";

const CLEAR = ["JEV_BASE_URL", "JEV_BASE_API_KEY", "OPENCODE_CONSOLE_TOKEN", "OPENCODE_API_KEY", "JEV_API_KEY", "OPENROUTER_API_KEY",
  "JEV_GUARD_YOLO", "JEV_GUARD_SOFT", "JEV_GUARD_FAIL_CLOSED", "JEV_GUARD_YOLO_FILE", "JEV_GUARD_CONFIG_FILE",
  "XDG_DATA_HOME", "XDG_CONFIG_HOME"];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "jew-"));
  const yoloFile = join(dir, "yolo.json");
  const saved = {};
  for (const k of CLEAR) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.JEV_GUARD_YOLO_FILE = yoloFile;
  process.env.XDG_DATA_HOME = dir;
  process.env.XDG_CONFIG_HOME = dir;
  setYolo(true, yoloFile);
  return () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
}

test("yolo falls back to the configured rule when Jev cannot answer", async () => {
  const restore = setup();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const plugin = await loadPlugin({ assessAction: async () => { throw new Error("offline"); } });
    const call = { tool: "shell", sessionID: "ses_1", messageID: "msg_1", id: "call_1", input: { command: "rm -rf /" } };
    await plugin.hooks["execute.before"](call);
    const event = { action: "shell", resources: ["rm -rf /"], effect: "ask", sessionID: "ses_1", source: { type: "tool", messageID: "msg_1", id: "call_1" } };
    await plugin.hooks.evaluate(event);
    assert.equal(event.effect, "ask");
  } finally {
    console.warn = warn;
    restore();
  }
});

test("without yolo an unjudgeable call fails open", async () => {
  const restore = setup();
  try {
    setYolo(false, process.env.JEV_GUARD_YOLO_FILE);
    const plugin = await loadPlugin({ assessAction: async () => { throw new Error("offline"); } });
    const warn = console.warn;
    console.warn = () => {};
    try {
      await plugin.hooks["execute.before"]({ tool: "shell", sessionID: "ses_1", input: { command: "echo hi" } });
    } finally { console.warn = warn; }
  } finally { restore(); }
});
