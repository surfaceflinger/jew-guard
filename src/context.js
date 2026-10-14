import { readSession } from "./session.js";

const MAX_MESSAGE_CHARS = 700;

export function buildContext({ sessionId, messages } = {}) {
  const session = readSession(sessionId);
  const prompts = (messages ?? []).filter((message) => message.role === "user").map((message) => message.text);
  const intents = (messages ?? []).filter((message) => message.role === "assistant").map((message) => message.text);
  const context = {
    user_recent_messages: dedupe(prompts).slice(-3).map(clipText),
    assistant_intent: clipText(intents.at(-1) ?? ""),
    recent_tool_calls: session.calls.slice(-6).map((call) => `${call.tool} ${call.preview}${call.level && call.level !== "allow" ? ` [${call.level}]` : ""}`),
    flagged_untrusted_content: session.flags.slice(-5).map((flag) => `${flag.kind} from ${flag.source ?? flag.tool ?? "unknown"}${flag.p ? ` (p=${flag.p})` : ""}${flag.excerpt ? `: "${flag.excerpt}"` : ""}`),
  };
  for (const key of Object.keys(context)) if (!context[key] || context[key].length === 0) delete context[key];
  return Object.keys(context).length ? context : undefined;
}

const clipText = (text) => (text.length > MAX_MESSAGE_CHARS ? text.slice(0, MAX_MESSAGE_CHARS) + "…" : text);
const dedupe = (texts) => texts.filter((text, index) => text && texts.indexOf(text) === index);

export function messagesFrom(entries) {
  const messages = [];
  for (const entry of entries ?? []) {
    const message = entry.message ?? entry;
    const role = message.role ?? entry.info?.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = textOf(message.content) || textOf(entry.parts);
    if (text) messages.push({ role, text });
  }
  return messages.slice(-8);
}

function textOf(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text.trim()).filter(Boolean).join("\n");
}
