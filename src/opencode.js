// jew-guard: opencode-only security guard powered by Jev (TypeSafe System One).
//
// tool.execute.before throws to block; permission.ask lets the guard auto-approve the safe calls
// and keep the prompt for the risky ones (the config hook defaults bash/edit/webfetch to "ask"
// so the prompt channel exists; explicit user rules always win); tool.execute.after flags results.
// Injected commands pick billing workspace (/jev-workspace),
// Jev model (/jev-model), yolo mode (/yolo), and soft mode (/soft) — all handled inline.
import { tool } from "@opencode-ai/plugin";
import { assessAction, scanContent, preview, excerpt, INSTRUCTION_FILE } from "./guard.js";
import { scanInstructionsCached } from "./skills.js";
import { buildContext, messagesFrom } from "./context.js";
import { remember } from "./session.js";
import { ask } from "./jev.js";
import { consoleToken, listWorkspaces, matchWorkspace, resolveWorkspace, saveSelection, validateWorkspace } from "./workspace.js";
import { effectiveModel, deleteModel, readModel, saveModel } from "./model.js";
import { isSoft, isYolo, resolveLevel, setSoft, setYolo } from "./yolo.js";

const WORKSPACE_COMMAND = "jev-workspace";
const WORKSPACE_TEMPLATE = `jew-guard workspace setup. The plugin hook handles this command inline and stops the turn, so this prompt never runs — no action needed.`;
const MODEL_COMMAND = "jev-model";
const MODEL_TEMPLATE = `jew-guard model setup. The plugin hook handles this command inline and stops the turn, so this prompt never runs — no action needed.`;
const YOLO_COMMAND = "yolo";
const YOLO_TEMPLATE = `jew-guard yolo toggle. The plugin hook handles this command inline and stops the turn, so this prompt never runs — no action needed.`;
const SOFT_COMMAND = "soft";
const SOFT_TEMPLATE = `jew-guard soft toggle. The plugin hook handles this command inline and stops the turn, so this prompt never runs — no action needed.`;

// permission.ask only fires for tools set to "ask", so without these defaults an ask
// verdict is a toast and the call runs. Fill gaps only: explicit user rules (strings,
// granular objects, or a global "allow"/"deny") are never overridden. Names are explicit:
// opencode's permission mapping is its own, so write is listed next to edit, not assumed covered.
const ASK_BY_DEFAULT = ["bash", "edit", "write", "webfetch"];

async function workspaceStatus(env = process.env, opts = {}) {
  const hasToken = !!consoleToken(env);
  let spaces = [];
  try { spaces = hasToken ? await listWorkspaces({ env, fetchImpl: opts.fetchImpl }) : []; } catch (e) { return { hasToken, spaces, selected: null, error: e.message }; }
  const selected = await resolveWorkspace(env, { ...opts, spaces }).catch(() => null);
  return { hasToken, spaces, selected };
}

/** One live roundtrip on the configured backend; resolves p or throws. Probe, never the fallback:
 *  the point is to test the endpoint/model the human is choosing, not OpenRouter. */
async function probeModel() {
  const a = await ask({ probe: "jew-guard model test" },
    { ok: { type: "noul", instructions: "Is this a harmless self-test?", criteria: { true: "Yes.", false: "No." } } },
    { fallback: false });
  return a.ok.p ?? 0;
}

export const JewGuard = async ({ client, directory }, deps = {}) => {
  // Seams for tests: production uses the real judge/scan; tests inject stubs.
  const judge = deps.assessAction ?? assessAction;
  const scanCached = deps.scanInstructionsCached ?? scanInstructionsCached;
  const scanOut = deps.scanContent ?? scanContent;
  const toast = (message, variant = "warning") =>
    client?.tui?.showToast?.({ body: { title: "jew-guard", message, variant, duration: 8000 } }).catch(() => {});
  const failOpen = (err) => {
    toast(`jew-guard unavailable, allowing: ${err.message}`, "error");
    if (process.env.JEV_GUARD_FAIL_CLOSED) throw new Error(`jew-guard unavailable: ${err.message}`);
    return null;
  };
  // yolo delegates the decision to Jev, so a Jev call that failed is not an "allow":
  // prompts stay for the human and calls with no prompt channel are blocked, until
  // /yolo off or Jev answers again (e.g. after paying). Fail-closed keeps denying.
  const unjudgedYolo = () => isYolo() && !process.env.JEV_GUARD_FAIL_CLOSED;

  // The session's messages, via the SDK; empty when the server can't be reached.
  const context = async (sessionID) => {
    const res = await client?.session?.messages?.({ path: { id: sessionID } }).catch(() => null);
    return buildContext({ sessionId: sessionID, messages: messagesFrom(res?.data ?? []) });
  };

  return {
    // Belt and braces for yolo: answer permission dialogs directly through the
    // reply API, not just the permission.ask hook. If the hook ever doesn't
    // fire (or its verdict is dropped), the dialog would otherwise sit until a
    // human answers — exactly what yolo mode promises to eliminate.
    "event": async ({ event }) => {
      try {
        if (!event || event.type !== "permission.asked" || !isYolo()) return;
        const p = event.properties ?? {};
        const sessionID = p.sessionID, requestID = p.id ?? p.requestID;
        if (!sessionID || !requestID) return;
        const patterns = Array.isArray(p.patterns) ? p.patterns : [];
        let allow = true;
        try {
          const r = await judge({ tool: p.permission ?? "unknown", input: { permission: p.permission, patterns }, cwd: directory, agent: "opencode", context: await context(sessionID) });
          const level = resolveLevel(r?.level ?? null, { yolo: true, soft: isSoft() });
          if (level === "ask") return;  // soft-downgraded deny: leave the prompt standing
          allow = level !== "deny";
          if (r) remember(sessionID, "calls", { tool: String(p.permission ?? "unknown"), preview: preview(patterns.join("; "), 100), level: allow ? "allow" : r.level });
        } catch (err) {
          if (unjudgedYolo()) {
            toast(`jew-guard could not judge this permission, leaving it to you: ${err.message}`, "error");
            return;  // no verdict: do not auto-approve
          }
          allow = !process.env.JEV_GUARD_FAIL_CLOSED;  // fail open; fail-closed denies
        }
        const response = allow ? "once" : "reject";
        // NOTE: the reply method lives on the top-level client, NOT client.session.
        const send = (query) => client?.postSessionIdPermissionsPermissionId?.({ path: { id: sessionID, permissionID: requestID }, body: { response }, ...(query ? { query } : {}) })?.catch(() => null);
        const res = await send();
        if (!res || res.error) await send({ directory }).catch(() => null);  // already answered → 404, ignore
      } catch {}
    },

    // Inject /jev-workspace and /jev-model so the human can pick billing target and model. No config edits needed.
    "config": async (input) => {
      if (input.permission === undefined) input.permission = {};
      if (input.permission && typeof input.permission === "object")
        for (const t of ASK_BY_DEFAULT) input.permission[t] ??= "ask";
      input.command ??= {};
      if (!input.command[WORKSPACE_COMMAND]) {
        input.command[WORKSPACE_COMMAND] = {
          description: "Pick the Console workspace jew-guard bills Jev calls to",
          template: WORKSPACE_TEMPLATE,
        };
      }
      if (!input.command[MODEL_COMMAND]) {
        input.command[MODEL_COMMAND] = {
          description: "Pick the Jev model jew-guard queries (free vs paid)",
          template: MODEL_TEMPLATE,
        };
      }
      if (!input.command[YOLO_COMMAND]) {
        input.command[YOLO_COMMAND] = {
          description: "Toggle yolo mode: Jev auto-approves everything it doesn't deny",
          template: YOLO_TEMPLATE,
        };
      }
      if (!input.command[SOFT_COMMAND]) {
        input.command[SOFT_COMMAND] = {
          description: "Toggle soft mode: Jev denies become approval prompts instead of blocks",
          template: SOFT_TEMPLATE,
        };
      }
    },

    "command.execute.before": async (input, output) => {
      // Handle our own commands inline and STOP the turn: opencode runs its
      // `prompt()` only if this hook returns, so throwing here means NOTHING
      // reaches the LLM — no relay turn, no chatter, no cost. The message is
      // shown to the human as the command result (same mechanism as deny).
      // Only human slash commands reach this hook, which is also what makes
      // guard mutations human-only: the agent cannot run slash commands, and
      // the jew_* tools below are read-only, so the agent can never enable
      // yolo, switch models, or move billing by itself.
      const name = String(input.command ?? "").replace(/^\//, "").toLowerCase();
      if (name !== WORKSPACE_COMMAND && name !== MODEL_COMMAND && name !== YOLO_COMMAND && name !== SOFT_COMMAND) return;
      const arg = String(input.arguments ?? "").trim();
      const done = (text) => { throw new Error(`jew-guard: ${text}`); };
      if (name === YOLO_COMMAND || name === SOFT_COMMAND) {
        const isSoftCmd = name === SOFT_COMMAND;
        const state = () => isSoftCmd ? isSoft() : isYolo();
        const set = (on) => isSoftCmd ? setSoft(on) : setYolo(on);
        const label = isSoftCmd ? "soft" : "yolo";
        const want = arg.toLowerCase();
        if (!arg) { done(`${label} mode is ${state() ? "ON" : "OFF"}. Run /${label} on|off.`); }
        if (want !== "on" && want !== "off") { done(`usage: /${label} on|off (currently ${state() ? "on" : "off"}).`); }
        set(want === "on");
        toast(`${label} mode ${want === "on" ? "enabled" : "disabled"}`);
        done(`${label} mode ${want === "on" ? "ON" : "OFF"}.` + (isSoftCmd && want === "on" ? " Jev denies now prompt instead of blocking." : ""));
      }
      if (name === WORKSPACE_COMMAND) {
        const s = await workspaceStatus(process.env);
        if (!s.hasToken) done("no Console credential — run /connect first.");
        if (s.error) done(`workspace lookup failed: ${s.error}`);
        if (!arg) done(s.spaces.map((w) => `- ${w.name}${s.selected?.id === w.id ? " [selected]" : ""}`).join("\n") +
          (s.selected ? "" : "\nRe-run as /jev-workspace <name> to pick."));
        const hit = matchWorkspace(s.spaces, arg);
        if (!hit) done(`unknown workspace "${arg}". Known: ${s.spaces.map((w) => w.name).join(", ")}.`);
        if (!await validateWorkspace(hit)) done(`token rejected for "${hit.name}" — not saved.`);
        saveSelection(hit);
        done(`Jev calls will bill to "${hit.name}". Saved.`);
      }
      const eff = effectiveModel(process.env);
      if (!arg) done(`model: ${eff.model} (from ${eff.source}). Re-run as /jev-model <id> to switch; known: jev-1.13-free, jev-1.13.`);
      const prev = readModel();
      saveModel(arg);
      try {
        const p = await probeModel();
        done(`switched to ${arg} (Jev answered, p=${p.toFixed(2)}). Saved.`);
      } catch (e) {
        if (prev) saveModel(prev); else deleteModel();  // revert, or leave no pick behind
        done(`Jev did not answer on "${arg}": ${e.message} Previous model kept.`);
      }
    },

    "tool.execute.before": async (input, output) => {
      let r;
      try {
        r = await judge({ tool: input.tool, input: output.args, cwd: directory, agent: "opencode", context: await context(input.sessionID) });
      } catch (err) {
        if (!unjudgedYolo()) return failOpen(err);
        throw new Error(`jew-guard could not judge this call (${err.message}); yolo mode never runs unjudged calls. Fix Jev (pay for the model / /jev-workspace) or run /yolo off.`);
      }
      if (r) remember(input.sessionID, "calls", { tool: input.tool, preview: preview(output.args, 100), level: r.level });
      if (!r || r.level === "allow") return;
      if (r.level === "deny") throw new Error(r.message);  // soft deny→ask happens in permission.ask, where a prompt exists; here there is none, so block
      if (isYolo()) return;  // Jev didn't deny: run silently, no toast
      // Always toast: the prompt hook judges thinner input and may disagree silently.
      toast(`${r.message} (set permission for ${input.tool} to "ask" in opencode.json to get a real prompt)`);
    },

    "permission.ask": async (input, output) => {
      const args = { ...(input.metadata ?? {}), pattern: input.pattern, title: input.title };
      let r;
      try {
        r = await judge({ tool: input.type, input: args, cwd: directory, agent: "opencode", context: await context(input.sessionID) });
      } catch (err) {
        if (!unjudgedYolo()) return failOpen(err);
        toast(`jew-guard could not judge this prompt, leaving it to you: ${err.message}`, "error");
        return;  // no verdict: the prompt stands until the human answers it
      }
      const level = resolveLevel(r?.level ?? null, { yolo: isYolo(), soft: isSoft() });
      if (level === null) return;  // skipped and no yolo: leave the prompt standing
      output.status = level;  // allow → no prompt, ask → prompt, deny → refused
      if (level !== "allow") toast(r?.message ?? `jew-guard: ${level}`);
    },

    "tool.execute.after": async (input, output) => {
      const source = input.args?.url ?? input.args?.filePath ?? input.args?.path;
      const instructions = /^skill$/i.test(input.tool ?? "") || (source && INSTRUCTION_FILE.test(source));  // skill passes {name}, no path
      const r = await (instructions
        ? scanCached({ text: output.output, source: source ?? input.args?.name ?? input.tool })
        : scanOut({ text: output.output, tool: input.tool, source: preview(input.args, 120) })
      ).catch(() => null);
      if (r?.flagged) remember(input.sessionID, "flags", { kind: r.kind, source, tool: input.tool, p: +r.p.toFixed(2), excerpt: excerpt(output.output) });
      if (!r?.flagged) return;
      toast(r.message);
      output.output = `[${r.message}]\n\n${output.output}`;
    },

    "tool": {
      jew_workspace: tool({
        description: "Read-only: list Console workspaces and show which one jew-guard bills Jev calls to. Changing it requires the human command /jev-workspace.",
        args: {
          action: tool.schema.enum(["status", "list", "test"]).optional().describe("status/list/test (default status)"),
        },
        async execute(args) {
          const action = args.action ?? "status";
          if (action === "test") {
            const p = await probeModel();
            return `Jev answered end-to-end (p=${p.toFixed(2)}). Billing workspace resolves correctly.`;
          }
          const s = await workspaceStatus(process.env);
          if (!s.hasToken) return "No Console credential found. Run /connect in opencode first, then retry.";
          if (s.error) return `Could not list workspaces: ${s.error}`;
          const lines = s.spaces.map((w) => `- ${w.name} (${w.id})${s.selected?.id === w.id ? " [selected]" : ""}`);
          return [`Detected Console workspaces (${s.spaces.length}):`, ...lines,
            s.selected ? `Current selection: ${s.selected.name}.` : "No workspace selected yet — the human picks one with /jev-workspace.",
          ].join("\n");
        },
      }),
      jew_model: tool({
        description: "Read-only: show the Jev model jew-guard queries, or test it. Changing it requires the human command /jev-model.",
        args: {
          action: tool.schema.enum(["status", "test"]).optional().describe("status/test (default status)"),
        },
        async execute(args) {
          const action = args.action ?? "status";
          const eff = effectiveModel(process.env);
          if (action === "test") {
            const p = await probeModel();
            return `Jev (${eff.model}) answered end-to-end (p=${p.toFixed(2)}).`;
          }
          return `Current Jev model: ${eff.model} (from ${eff.source}).` +
            (process.env.JEV_MODEL ? " JEV_MODEL is set and wins over any saved pick." : "");
        },
      }),
      jew_yolo: tool({
        description: "Read-only: report yolo/soft mode state. Changing either requires the human commands /yolo and /soft.",
        args: {},
        async execute() {
          return `yolo mode is ${isYolo() ? "ON" : "OFF"}; soft mode is ${isSoft() ? "ON" : "OFF"}.`;
        },
      }),
    },
  };
};

// ponytail: no default export on purpose. OpenCode's older loader treats every export as a plugin function and
// throws on an object; the newer loader only special-cases a default export. A single named function loads in both.
