import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JewGuard } from "../src/opencode.js";

const file = () => join(mkdtempSync(join(tmpdir(), "jew-")), "yolo.json");
const fakeClient = (replies = []) => ({
  tui: { showToast: async () => {} },
  session: { messages: async () => ({ data: [] }) },
  // NOTE: reply method is top-level on the client, NOT under session.
  postSessionIdPermissionsPermissionId: async (opts) => { replies.push(opts); return { data: {}, error: undefined }; },
});

test("event hook ignores non-asked events and yolo-off (no network, no reply)", async () => {
  const replies = [];
  const plugin = await JewGuard({ client: fakeClient(replies), directory: "/tmp" });
  const f = file();
  process.env.JEV_GUARD_YOLO_FILE = f;
  try {
    await plugin.event({ event: { type: "session.idle", properties: {} } });
    await plugin.event({ event: { type: "permission.asked", properties: { id: "per_1", sessionID: "ses_1", permission: "bash", patterns: ["echo hi"] } } });
    assert.equal(replies.length, 0);
  } finally { delete process.env.JEV_GUARD_YOLO_FILE; }
});

test("event hook ignores asked events missing ids", async () => {
  const replies = [];
  const plugin = await JewGuard({ client: fakeClient(replies), directory: "/tmp" });
  const f = file();
  const { setYolo } = await import("../src/yolo.js");
  process.env.JEV_GUARD_YOLO_FILE = f;
  try {
    setYolo(true, f);
    await plugin.event({ event: { type: "permission.asked", properties: {} } });
    assert.equal(replies.length, 0);
  } finally { delete process.env.JEV_GUARD_YOLO_FILE; }
});
