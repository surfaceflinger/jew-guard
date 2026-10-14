import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JewGuard } from "../src/opencode.js";
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

const client = (replies) => ({
  tui: { showToast: async () => {} },
  session: { messages: async () => ({ data: [] }) },
  postSessionIdPermissionsPermissionId: async (o) => { replies.push(o); return { data: {}, error: undefined }; },
});

test("yolo does not auto-reply permission.asked when Jev cannot answer", async () => {
  const restore = setup();
  const replies = [];
  try {
    const plugin = await JewGuard({ client: client(replies), directory: "/tmp" });
    await plugin.event({ event: { type: "permission.asked", properties: { id: "per_1", sessionID: "ses_1", permission: "bash", patterns: ["rm -rf /"] } } });
    assert.equal(replies.length, 0);
  } finally { restore(); }
});

test("yolo leaves the permission prompt to the human when Jev cannot answer", async () => {
  const restore = setup();
  try {
    const plugin = await JewGuard({ client: client([]), directory: "/tmp" });
    const output = {};
    await plugin["permission.ask"]({ type: "bash", pattern: "rm -rf /", metadata: {}, sessionID: "ses_1" }, output);
    assert.equal(output.status, undefined);
  } finally { restore(); }
});

test("yolo blocks a call it could not judge when Jev cannot answer", async () => {
  const restore = setup();
  try {
    const plugin = await JewGuard({ client: client([]), directory: "/tmp" });
    await assert.rejects(
      plugin["tool.execute.before"]({ tool: "bash", sessionID: "ses_1" }, { args: { command: "rm -rf /" } }),
      /yolo mode never runs unjudged calls/,
    );
  } finally { restore(); }
});
