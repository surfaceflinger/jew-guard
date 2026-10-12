// What Jev gets to see besides the tool call itself: the user's recent words, the agent's stated intent,
// the last few decisions, and anything flagged as untrusted earlier in the session.
// Sources: the session store plus whatever the plugin reads back via client.session.messages().
import { readSession } from "./session.js";

const MAX_TEXT = 700;

export function buildContext({ sessionId, intent, messages } = {}) {
  const s = readSession(sessionId);
  let prompts = s.prompts.map((p) => p.text);
  let intents = s.intents.map((i) => i.text);
  if (messages) {
    prompts = [...prompts, ...messages.filter((m) => m.role === "user").map((m) => m.text)];
    intents = [...intents, ...messages.filter((m) => m.role === "assistant").map((m) => m.text)];
  }
  if (intent) intents.push(intent);
  const ctx = {
    user_recent_messages: dedupe(prompts).slice(-3).map(clip),
    assistant_intent: clip(intents.at(-1) ?? ""),
    recent_tool_calls: s.calls.slice(-6).map((c) => `${c.tool} ${c.preview}${c.level && c.level !== "allow" ? ` [${c.level}]` : ""}`),
    flagged_untrusted_content: s.flags.slice(-5).map((f) => `${f.kind} from ${f.source ?? f.tool ?? "unknown"}${f.p ? ` (p=${f.p})` : ""}${f.excerpt ? `: "${f.excerpt}"` : ""}`),
  };
  for (const k of Object.keys(ctx)) if (!ctx[k] || ctx[k].length === 0) delete ctx[k];
  return Object.keys(ctx).length ? ctx : undefined;
}

const clip = (s) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + "…" : s);
const dedupe = (arr) => arr.filter((x, i) => x && arr.indexOf(x) === i);

/** Text of every user/assistant message from opencode's session.messages() ({info:{role}, parts:[{type,text}]}) or pi-style entries. */
export function messagesFrom(entries) {
  const out = [];
  for (const e of entries ?? []) {
    const m = e.message ?? e;
    const role = m.role ?? e.info?.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = textOf(m.content) || textOf(e.parts);
    if (text) out.push({ role, text });
  }
  return out.slice(-8);
}

function textOf(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text.trim()).filter(Boolean).join("\n");
}
