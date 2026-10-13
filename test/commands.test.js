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
  process.env.JEV_GUARD_CONFIG_FILE = join(dir, "config.json");
  process.env.JEV_GUARD_SESSIONS = join(dir, "sessions");
  return () => {
    delete process.env.JEV_GUARD_YOLO_FILE;
    delete process.env.JEV_GUARD_MODEL_FILE;
    delete process.env.JEV_GUARD_WORKSPACE_FILE;
    delete process.env.JEV_GUARD_CONFIG_FILE;
    delete process.env.JEV_GUARD_SESSIONS;
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

test("config hook defaults bash/edit/webfetch to ask without overriding", async () => {
  const cleanup = setup();
  try {
    const plugin = await JewGuard({ client, directory: "/tmp" });
    const input = {};
    await plugin.config(input);
    assert.equal(input.permission.bash, "ask");
    assert.equal(input.permission.edit, "ask");
    assert.equal(input.permission.write, "ask");
    assert.equal(input.permission.webfetch, "ask");
    assert.ok(input.command["yolo"]);
    const custom = { permission: { bash: "allow", edit: { "*": "ask" } } };
    await plugin.config(custom);
    assert.equal(custom.permission.bash, "allow");
    assert.deepEqual(custom.permission.edit, { "*": "ask" });
    assert.equal(custom.permission.webfetch, "ask");
    const global = { permission: "allow" };
    await plugin.config(global);
    assert.equal(global.permission, "allow");
  } finally { cleanup(); }
});

test("before-hook blocks deny even in soft mode; permission.ask turns soft deny into a prompt", async () => {
  const cleanup = setup();
  const prevSoft = process.env.JEV_GUARD_SOFT;
  process.env.JEV_GUARD_SOFT = "1";
  try {
    const deny = { level: "deny", message: "jew-guard blocked this call (risk 3.0/3): bash rm -rf /" };
    const plugin = await JewGuard({ client, directory: "/tmp" }, { assessAction: async () => deny });
    await assert.rejects(
      plugin["tool.execute.before"]({ tool: "bash", sessionID: "s" }, { args: { command: "rm -rf /" } }),
      /blocked this call/,
    );
    const output = {};
    await plugin["permission.ask"]({ type: "bash", pattern: "rm -rf /", metadata: {}, sessionID: "s" }, output);
    assert.equal(output.status, "ask");
    const pluginAllow = await JewGuard({ client, directory: "/tmp" }, { assessAction: async () => ({ level: "allow", message: "ok" }) });
    const outAllow = {};
    await pluginAllow["permission.ask"]({ type: "read", pattern: "f", metadata: {}, sessionID: "s" }, outAllow);
    assert.equal(outAllow.status, "allow");
  } finally {
    if (prevSoft === undefined) delete process.env.JEV_GUARD_SOFT;
    else process.env.JEV_GUARD_SOFT = prevSoft;
    cleanup();
  }
});

test("after-hook prepends the flag to tainted output", async () => {
  const cleanup = setup();
  try {
    const flagged = { flagged: true, kind: "injection", p: 0.9, message: "jew-guard: the webfetch result contains text aimed at AI agents" };
    const plugin = await JewGuard({ client, directory: "/tmp" }, { scanContent: async () => flagged });
    const output = { output: "here is the page body, long enough to matter" };
    await plugin["tool.execute.after"]({ tool: "webfetch", args: { url: "https://evil.example" } }, output);
    assert.match(output.output, /^\[jew-guard: the webfetch result/);
  } finally { cleanup(); }
});

test("jew_yolo tool is read-only status", async () => {
  const cleanup = setup();
  try {
    const plugin = await JewGuard({ client, directory: "/tmp" });
    assert.match(await plugin.tool.jew_yolo.execute({}), /yolo mode is OFF/);
  } finally { cleanup(); }
});
