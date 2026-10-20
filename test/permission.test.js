import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlugin } from "./harness.js";
import { setYolo } from "../src/yolo.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "jew-"));
  const yoloFile = join(dir, "yolo.json");
  process.env.JEV_GUARD_YOLO_FILE = yoloFile;
  process.env.JEV_GUARD_SESSIONS = join(dir, "sessions");
  return {
    yoloFile,
    cleanup: () => {
      delete process.env.JEV_GUARD_YOLO_FILE;
      delete process.env.JEV_GUARD_SESSIONS;
    },
  };
}

const call = { tool: "shell", sessionID: "ses_1", messageID: "msg_1", id: "call_1", input: { command: "echo hi" } };
const askEvent = () => ({
  action: "shell", resources: ["echo hi"], effect: "ask", sessionID: "ses_1",
  source: { type: "tool", messageID: "msg_1", id: "call_1" },
});

test("evaluate hook escalates an allowed decision to a real prompt", async () => {
  const { cleanup } = setup();
  try {
    const plugin = await loadPlugin({ assessAction: async () => ({ level: "ask", message: "needs approval" }) });
    await plugin.hooks["execute.before"](call);
    const event = { ...askEvent(), effect: "allow" };
    await plugin.hooks.evaluate(event);
    assert.equal(event.effect, "ask");
    assert.equal(event.message, "needs approval");
  } finally { cleanup(); }
});

test("evaluate hook reuses the verdict judged before the call", async () => {
  let judged = 0;
  const { cleanup } = setup();
  try {
    const plugin = await loadPlugin({ assessAction: async () => { judged += 1; return { level: "ask", message: "needs approval" }; } });
    await plugin.hooks["execute.before"](call);
    await plugin.hooks.evaluate(askEvent());
    assert.equal(judged, 1);
  } finally { cleanup(); }
});

test("yolo does not auto-approve a Jev ask", async () => {
  const { yoloFile, cleanup } = setup();
  try {
    setYolo(true, yoloFile);
    const plugin = await loadPlugin({ assessAction: async () => ({ level: "ask", message: "needs approval" }) });
    await plugin.hooks["execute.before"](call);
    const event = askEvent();
    await plugin.hooks.evaluate(event);
    assert.equal(event.effect, "ask");
    assert.equal(event.message, "needs approval");
  } finally { cleanup(); }
});

test("evaluate hook turns a yolo+soft deny into a prompt with the reason", async () => {
  const { cleanup } = setup();
  const prevYolo = process.env.JEV_GUARD_YOLO;
  const prevSoft = process.env.JEV_GUARD_SOFT;
  process.env.JEV_GUARD_YOLO = "1";
  process.env.JEV_GUARD_SOFT = "1";
  try {
    const message = "jew-guard blocked this call (risk 3.0/3): shell rm -rf /";
    const plugin = await loadPlugin({ assessAction: async () => ({ level: "deny", message }) });
    await plugin.hooks["execute.before"](call);
    const event = askEvent();
    await plugin.hooks.evaluate(event);
    assert.equal(event.effect, "ask");
    assert.equal(event.message, message);
  } finally {
    if (prevYolo === undefined) delete process.env.JEV_GUARD_YOLO;
    else process.env.JEV_GUARD_YOLO = prevYolo;
    if (prevSoft === undefined) delete process.env.JEV_GUARD_SOFT;
    else process.env.JEV_GUARD_SOFT = prevSoft;
    cleanup();
  }
});

test("evaluate keeps a config ask when Jev allows and yolo is off", async () => {
  const { cleanup } = setup();
  try {
    const plugin = await loadPlugin({ assessAction: async () => ({ level: "allow", message: "ok" }) });
    await plugin.hooks["execute.before"](call);
    const event = { ...askEvent(), effect: "ask" };
    await plugin.hooks.evaluate(event);
    assert.equal(event.effect, "ask");
  } finally { cleanup(); }
});

test("yolo auto-approves a config ask when Jev allows", async () => {
  const { yoloFile, cleanup } = setup();
  try {
    setYolo(true, yoloFile);
    const plugin = await loadPlugin({ assessAction: async () => ({ level: "allow", message: "ok" }) });
    await plugin.hooks["execute.before"](call);
    const event = { ...askEvent(), effect: "ask" };
    await plugin.hooks.evaluate(event);
    assert.equal(event.effect, "allow");
  } finally { cleanup(); }
});

test("evaluate hook leaves non-tool permission sources alone", async () => {
  const { cleanup } = setup();
  try {
    const plugin = await loadPlugin({ assessAction: async () => ({ level: "deny", message: "blocked" }) });
    const event = { action: "external_directory", resources: ["/tmp"], effect: "allow", sessionID: "ses_1" };
    await plugin.hooks.evaluate(event);
    assert.equal(event.effect, "allow");
    assert.equal(event.message, undefined);
  } finally { cleanup(); }
});

test("external_directory checks do not consume the tool verdict", async () => {
  let judged = 0;
  const { cleanup } = setup();
  try {
    const plugin = await loadPlugin({ assessAction: async () => { judged += 1; return { level: "ask", message: "needs approval" }; } });
    await plugin.hooks["execute.before"](call);
    const external = { ...askEvent(), action: "external_directory", resources: ["/tmp"], effect: "allow" };
    await plugin.hooks.evaluate(external);
    assert.equal(external.effect, "allow");
    const event = askEvent();
    await plugin.hooks.evaluate(event);
    assert.equal(event.effect, "ask");
    assert.equal(judged, 1);
  } finally { cleanup(); }
});

test("ambiguous verdicts are re-judged instead of reused", async () => {
  let judged = 0;
  const { cleanup } = setup();
  try {
    const plugin = await loadPlugin({ assessAction: async () => { judged += 1; return judged <= 2 ? { level: "allow", message: "cached" } : { level: "deny", message: "fallback" }; } });
    await plugin.hooks["execute.before"](call);
    await plugin.hooks["execute.before"](call);
    const event = askEvent();
    await plugin.hooks.evaluate(event);
    assert.equal(event.effect, "deny");
    assert.equal(event.message, "fallback");
    assert.equal(judged, 3);
  } finally { cleanup(); }
});

test("evaluate judges when no pre-execution verdict exists", async () => {
  let judged = 0;
  const { cleanup } = setup();
  try {
    const plugin = await loadPlugin({ assessAction: async () => { judged += 1; return { level: "ask", message: "fallback ask" }; } });
    const event = askEvent();
    await plugin.hooks.evaluate(event);
    assert.equal(event.effect, "ask");
    assert.equal(event.message, "fallback ask");
    assert.equal(judged, 1);
  } finally { cleanup(); }
});

test("fail-open leaves the platform decision alone", async () => {
  const { cleanup } = setup();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const plugin = await loadPlugin({ assessAction: async () => { throw new Error("offline"); } });
    await plugin.hooks["execute.before"](call);
    const event = { ...askEvent(), effect: "ask" };
    await plugin.hooks.evaluate(event);
    assert.equal(event.effect, "ask");
  } finally {
    console.warn = warn;
    cleanup();
  }
});

test("write and patch map to the edit action", async () => {
  const { cleanup } = setup();
  try {
    const plugin = await loadPlugin({ assessAction: async () => ({ level: "ask", message: "edit ask" }) });
    for (const tool of ["write", "patch"]) {
      const id = `call_${tool}`;
      await plugin.hooks["execute.before"]({ tool, sessionID: "ses_1", messageID: "msg_2", id, input: { filePath: "a.txt" } });
      const event = { action: "edit", resources: ["a.txt"], effect: "allow", sessionID: "ses_1", source: { type: "tool", messageID: "msg_2", id } };
      await plugin.hooks.evaluate(event);
      assert.equal(event.effect, "ask");
      assert.equal(event.message, "edit ask");
    }
  } finally { cleanup(); }
});

test("session context is fetched once per assistant message", async () => {
  const { cleanup } = setup();
  let fetched = 0;
  try {
    const plugin = await loadPlugin(
      { assessAction: async () => ({ level: "allow", message: "ok" }) },
      { session: { context: async () => { fetched += 1; return []; } } },
    );
    await plugin.hooks["execute.before"]({ ...call, agent: "build", messageID: "msg_a", id: "call_a1" });
    await plugin.hooks["execute.before"]({ ...call, agent: "build", messageID: "msg_a", id: "call_a2" });
    assert.equal(fetched, 1);
    await plugin.hooks["execute.before"]({ ...call, agent: "build", messageID: "msg_b", id: "call_b1" });
    assert.equal(fetched, 2);
  } finally { cleanup(); }
});

test("context failures fail open without judging", async () => {
  const { cleanup } = setup();
  const previous = process.env.JEV_GUARD_FAIL_CLOSED;
  delete process.env.JEV_GUARD_FAIL_CLOSED;
  const error = console.error;
  console.error = () => {};
  let judged = false;
  try {
    const plugin = await loadPlugin(
      { assessAction: async () => { judged = true; return { level: "allow", message: "ok" }; } },
      { session: { context: async () => { throw new Error("context down"); } } },
    );
    await plugin.hooks["execute.before"]({ ...call, agent: "build" });
    assert.equal(judged, false);
  } finally {
    console.error = error;
    if (previous === undefined) delete process.env.JEV_GUARD_FAIL_CLOSED;
    else process.env.JEV_GUARD_FAIL_CLOSED = previous;
    cleanup();
  }
});

test("judge receives the v2 agent id", async () => {
  const { cleanup } = setup();
  const seen = [];
  try {
    const plugin = await loadPlugin({ assessAction: async (input) => {
      seen.push(input.agent);
      return { level: "allow", message: "ok" };
    } });
    await plugin.hooks["execute.before"]({ ...call, agent: "build" });
    const event = {
      ...askEvent(), effect: "allow", agent: "plan",
      source: { type: "tool", messageID: "msg_9", id: "call_9" },
    };
    await plugin.hooks.evaluate(event);
    assert.deepEqual(seen, ["build", "plan"]);
  } finally { cleanup(); }
});
