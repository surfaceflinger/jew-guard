import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlugin } from "./harness.js";

const ENV = ["JEV_GUARD_YOLO", "JEV_GUARD_SOFT", "JEV_GUARD_FAIL_CLOSED", "JEV_GUARD_SESSIONS",
  "JEV_GUARD_YOLO_FILE", "JEV_GUARD_CONFIG_FILE", "JEV_GUARD_MODEL_FILE", "JEV_GUARD_WORKSPACE_FILE"];

async function decide({ rule, verdict, yolo = false, soft = false, failClosed = false, tool = "shell" }) {
  const saved = {};
  for (const key of ENV) { saved[key] = process.env[key]; delete process.env[key]; }
  const dir = mkdtempSync(join(tmpdir(), "jew-"));
  process.env.JEV_GUARD_SESSIONS = join(dir, "sessions");
  process.env.JEV_GUARD_YOLO_FILE = join(dir, "yolo.json");
  if (yolo) process.env.JEV_GUARD_YOLO = "1";
  if (soft) process.env.JEV_GUARD_SOFT = "1";
  if (failClosed) process.env.JEV_GUARD_FAIL_CLOSED = "1";
  const warn = console.warn;
  const error = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    const judge = async (call) => {
      if (call.tool === "read") return null;
      if (verdict === "down") throw new Error("offline");
      return verdict === null ? null : { level: verdict, message: `jev ${verdict}` };
    };
    const plugin = await loadPlugin({ assessAction: judge });
    const call = {
      tool,
      sessionID: "ses_1",
      messageID: "msg_1",
      id: "call_1",
      input: tool === "read" ? { filePath: "a.txt" } : { command: "echo hi" },
    };
    try {
      await plugin.hooks["execute.before"](call);
    } catch {
      return "blocked";
    }
    if (rule === "deny") return "platform";
    const event = {
      action: tool === "read" ? "read" : "shell",
      resources: tool === "read" ? ["a.txt"] : ["echo hi"],
      effect: rule,
      sessionID: "ses_1",
      source: { type: "tool", messageID: "msg_1", id: "call_1" },
    };
    await plugin.hooks.evaluate(event);
    return event.effect;
  } finally {
    console.warn = warn;
    console.error = error;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// A low-confidence Jev allow is emitted as an "ask" verdict by decide(); guard.test.js covers that mapping.
// Configured deny is core-owned: a resource "*" deny removes the tool, and evaluate is not called.
// Deny cases below only check that execute.before does not turn a deny into a run.
const CASES = [
  ["allow + allow high + yolo off", { rule: "allow", verdict: "allow" }, "allow"],
  ["allow + allow high + yolo on", { rule: "allow", verdict: "allow", yolo: true }, "allow"],
  ["allow + low-confidence allow + yolo off", { rule: "allow", verdict: "ask" }, "ask"],
  ["allow + low-confidence allow + yolo on", { rule: "allow", verdict: "ask", yolo: true }, "ask"],
  ["allow + ask + yolo off", { rule: "allow", verdict: "ask" }, "ask"],
  ["allow + ask + yolo on", { rule: "allow", verdict: "ask", yolo: true }, "ask"],
  ["allow + deny + yolo off + soft off", { rule: "allow", verdict: "deny" }, "blocked"],
  ["allow + deny + yolo off + soft on", { rule: "allow", verdict: "deny", soft: true }, "blocked"],
  ["allow + deny + yolo on + soft off", { rule: "allow", verdict: "deny", yolo: true }, "blocked"],
  ["allow + deny + yolo on + soft on", { rule: "allow", verdict: "deny", yolo: true, soft: true }, "ask"],
  ["ask + allow high + yolo off", { rule: "ask", verdict: "allow" }, "ask"],
  ["ask + allow high + yolo on", { rule: "ask", verdict: "allow", yolo: true }, "allow"],
  ["ask + low-confidence allow + yolo off", { rule: "ask", verdict: "ask" }, "ask"],
  ["ask + low-confidence allow + yolo on", { rule: "ask", verdict: "ask", yolo: true }, "ask"],
  ["ask + ask + yolo off", { rule: "ask", verdict: "ask" }, "ask"],
  ["ask + ask + yolo on", { rule: "ask", verdict: "ask", yolo: true }, "ask"],
  ["ask + deny + yolo off + soft off", { rule: "ask", verdict: "deny" }, "blocked"],
  ["ask + deny + yolo off + soft on", { rule: "ask", verdict: "deny", soft: true }, "blocked"],
  ["ask + deny + yolo on + soft off", { rule: "ask", verdict: "deny", yolo: true }, "blocked"],
  ["ask + deny + yolo on + soft on", { rule: "ask", verdict: "deny", yolo: true, soft: true }, "ask"],
  ["read-only + yolo off", { rule: "allow", verdict: null, tool: "read" }, "allow"],
  ["read-only + ask rule + yolo off", { rule: "ask", verdict: null, tool: "read" }, "ask"],
  ["read-only + ask rule + yolo on", { rule: "ask", verdict: null, tool: "read", yolo: true }, "allow"],
  ["read-only + allow rule + yolo on", { rule: "allow", verdict: null, tool: "read", yolo: true }, "allow"],
  ["Jev down + allow + fail-open", { rule: "allow", verdict: "down" }, "allow"],
  ["Jev down + ask + fail-open", { rule: "ask", verdict: "down" }, "ask"],
  ["Jev down + ask + fail-open + yolo on", { rule: "ask", verdict: "down", yolo: true }, "ask"],
  ["Jev down + allow + fail-open + yolo on", { rule: "allow", verdict: "down", yolo: true }, "allow"],
  ["Jev down + allow + fail-closed", { rule: "allow", verdict: "down", failClosed: true }, "blocked"],
  ["Jev down + ask + fail-closed", { rule: "ask", verdict: "down", failClosed: true }, "blocked"],
  ["Jev down + read-only + fail-closed + yolo off", { rule: "ask", verdict: "down", failClosed: true, tool: "read" }, "ask"],
  ["Jev down + read-only + fail-closed + yolo on", { rule: "ask", verdict: "down", failClosed: true, yolo: true, tool: "read" }, "allow"],
  ["core deny (narrow) + Jev allow", { rule: "deny", verdict: "allow" }, "platform"],
  ["core deny (narrow) + Jev deny + guard blocks first", { rule: "deny", verdict: "deny" }, "blocked"],
  ["core deny (narrow) + Jev deny + yolo+soft + core blocks", { rule: "deny", verdict: "deny", yolo: true, soft: true }, "platform"],
  ["core deny (narrow) + Jev down + fail-open + core blocks", { rule: "deny", verdict: "down" }, "platform"],
  ["core deny (narrow) + Jev down + fail-closed + guard blocks first", { rule: "deny", verdict: "down", failClosed: true }, "blocked"],
];

for (const [name, input, expected] of CASES) {
  test(name, async () => {
    assert.equal(await decide(input), expected);
  });
}
