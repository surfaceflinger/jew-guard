import test from "node:test";
import assert from "node:assert/strict";
import { messagesFrom } from "../src/context.js";

test("messagesFrom reads v2 user text and assistant content", () => {
  const messages = messagesFrom([
    { type: "user", text: "  list the files  " },
    { type: "assistant", content: [{ type: "text", text: "  running ls " }, { type: "tool", name: "shell" }] },
    { type: "system", text: "ignore me" },
  ]);
  assert.deepEqual(messages, [
    { role: "user", text: "list the files" },
    { role: "assistant", text: "running ls" },
  ]);
});

test("messagesFrom keeps the last eight messages", () => {
  const entries = Array.from({ length: 10 }, (_, index) => ({ type: "user", text: `message ${index}` }));
  assert.deepEqual(messagesFrom(entries).map((message) => message.text), [
    "message 2", "message 3", "message 4", "message 5", "message 6", "message 7", "message 8", "message 9",
  ]);
});
