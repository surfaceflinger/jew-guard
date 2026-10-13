import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JewGuard } from "../src/opencode.js";
import { setYolo } from "../src/yolo.js";

const tmp = () => mkdtempSync(join(tmpdir(), "jew-"));
const client = { tui: { showToast: async () => {} }, session: { messages: async () => ({ data: [] }) } };
const setup = () => {
  const dir = tmp();
  process.env.JEV_GUARD_YOLO_FILE = join(dir, "yolo.json");
  process.env.JEV_GUARD_MODEL_FILE = join(dir, "model.json");
  process.env.JEV_GUARD_WORKSPACE_FILE = join(dir, "workspace.json");
  return () => {
    delete process.env.JEV_GUARD_YOLO_FILE;
    delete process.env.JEV_GUARD_MODEL_FILE;
    delete process.env.JEV_GUARD_WORKSPACE_FILE;
  };
};

test("command hook throws (stops the turn) for ours, passes others through", async () => {
  const cleanup = setup();
  try {
    const plugin = await JewGuard({ client, directory: "/tmp" });
    const hook = plugin["command.execute.before"];
    // unrelated command: no throw, no parts
    const untouched = {};
    await hook({ command: "init", sessionID: "s", arguments: "" }, untouched);
    assert.equal(untouched.parts ?? null, null);
    // bare /yolo: throws with state, no network
    setYolo(true, process.env.JEV_GUARD_YOLO_FILE);
    await assert.rejects(hook({ command: "/yolo", sessionID: "s", arguments: "" }, {}), /jew-guard: yolo mode is ON/);
    setYolo(false, process.env.JEV_GUARD_YOLO_FILE);
    await assert.rejects(hook({ command: "yolo", sessionID: "s", arguments: "" }, {}), /jew-guard: yolo mode is OFF/);
    await assert.rejects(hook({ command: "yolo", sessionID: "s", arguments: "maybe" }, {}), /usage: \/yolo on\|off/);
    // /yolo off via hook actually flips state
    await assert.rejects(hook({ command: "yolo", sessionID: "s", arguments: "on" }, {}), /jew-guard: yolo mode ON/);
    // bare /jev-model: throws with default, no network
    await assert.rejects(hook({ command: "/jev-model", sessionID: "s", arguments: "" }, {}), /jew-guard: model: jev-1.13-free \(from default\)/);
  } finally { cleanup(); }
});

test("jew_yolo tool is read-only status", async () => {
  const cleanup = setup();
  try {
    const plugin = await JewGuard({ client, directory: "/tmp" });
    assert.match(await plugin.tool.jew_yolo.execute({}), /yolo mode is OFF/);
  } finally { cleanup(); }
});
