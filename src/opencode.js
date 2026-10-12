// jew-guard: opencode-only security guard powered by Jev (TypeSafe System One).
//
// tool.execute.before throws to block; permission.ask (only fires for tools you set to "ask"
// in opencode.json) lets the guard auto-approve the safe calls and keep the prompt for the risky
// ones; tool.execute.after flags results. The /jev-workspace command (injected via the config
// hook) picks which Console workspace Jev calls are billed to; /jev-model picks the Jev model.
import { tool } from "@opencode-ai/plugin";
import { assessAction, scanContent, preview, excerpt, INSTRUCTION_FILE } from "./guard.js";
import { scanInstructionsCached } from "./skills.js";
import { buildContext, messagesFrom } from "./context.js";
import { readSession, remember } from "./session.js";
import { ask } from "./jev.js";
import { consoleToken, listWorkspaces, readSelection, resolveWorkspace, saveSelection, validateWorkspace } from "./workspace.js";
import { effectiveModel, readModel, saveModel } from "./model.js";

const WORKSPACE_COMMAND = "jev-workspace";
const WORKSPACE_TEMPLATE = `jew-guard workspace setup. Call the jew_workspace tool with action "status" to see the detected Console workspaces and the current selection. If no workspace is selected and more than one is detected, show the user the workspace names and ask them to pick the one their OpenCode Go subscription / models are billed to (the same one they chose with /connect). Then call jew_workspace with action "select" and their pick. If they are unsure, run action "test" on the pick to verify Jev answers end-to-end before confirming.`;
const MODEL_COMMAND = "jev-model";
const MODEL_TEMPLATE = `jew-guard model setup. Call the jew_model tool with action "status" to see the current Jev model and where it comes from. Known models: jev-1.13-free (free, default) and jev-1.13 (paid, needs workspace funds). To switch, call jew_model with action "set" and the model id — it fires one live test call first and only saves if Jev answers, so a paid model without funds is rejected with the 402 instead of silently breaking the guard.`;

async function workspaceStatus(env = process.env, opts = {}) {
  const hasToken = !!consoleToken(env);
  let spaces = [];
  try { spaces = hasToken ? await listWorkspaces({ env, fetchImpl: opts.fetchImpl }) : []; } catch (e) { return { hasToken, spaces, selected: null, error: e.message }; }
  const selected = await resolveWorkspace(env, opts).catch(() => null);
  return { hasToken, spaces, selected };
}

export const JewGuard = async ({ client, directory }) => {
  const toast = (message, variant = "warning") =>
    client?.tui?.showToast?.({ body: { title: "jew-guard", message, variant, duration: 8000 } }).catch(() => {});
  const failOpen = (err) => {
    toast(`jew-guard unavailable, allowing: ${err.message}`, "error");
    if (process.env.JEV_GUARD_FAIL_CLOSED) throw new Error(`jew-guard unavailable: ${err.message}`);
    return null;
  };

  // The session's messages, via the SDK; empty when the server can't be reached.
  const context = async (sessionID) => {
    const res = await client?.session?.messages?.({ path: { id: sessionID } }).catch(() => null);
    return buildContext({ sessionId: sessionID, messages: messagesFrom(res?.data ?? []) });
  };

  return {
    // Inject /jev-workspace and /jev-model so the human can pick billing target and model. No config edits needed.
    "config": async (input) => {
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
    },

    "tool.execute.before": async (input, output) => {
      const r = await assessAction({ tool: input.tool, input: output.args, cwd: directory, agent: "opencode", context: await context(input.sessionID) }).catch(failOpen);
      if (r) remember(input.sessionID, "calls", { tool: input.tool, preview: preview(output.args, 100), level: r.level });
      if (!r || r.level === "allow") return;
      if (r.level === "deny") throw new Error(r.message);
      toast(`${r.message} (set permission for ${input.tool} to "ask" in opencode.json to get a real prompt)`);
    },

    "permission.ask": async (input, output) => {
      const args = { ...(input.metadata ?? {}), pattern: input.pattern, title: input.title };
      const r = await assessAction({ tool: input.type, input: args, cwd: directory, agent: "opencode", context: await context(input.sessionID) }).catch(failOpen);
      if (!r) return;
      output.status = r.level;  // allow → no prompt, ask → prompt, deny → refused
      if (r.level !== "allow") toast(r.message);
    },

    "tool.execute.after": async (input, output) => {
      const source = input.args?.url ?? input.args?.filePath ?? input.args?.path;
      const instructions = /^skill$/i.test(input.tool ?? "") || (source && INSTRUCTION_FILE.test(source));  // skill passes {name}, no path
      const r = await (instructions
        ? scanInstructionsCached({ text: output.output, source: source ?? input.args?.name ?? input.tool })
        : scanContent({ text: output.output, tool: input.tool, source: preview(input.args, 120), task: readSession(input.sessionID).prompts.at(-1)?.text })
      ).catch(() => null);
      if (r?.flagged) remember(input.sessionID, "flags", { kind: r.kind, source, tool: input.tool, p: +r.p.toFixed(2), excerpt: excerpt(output.output), reported: true });
      if (!r?.flagged) return;
      toast(r.message);
      output.output = `[${r.message}]\n\n${output.output}`;
    },

    "tool": {
      jew_workspace: tool({
        description: "List Console workspaces and select which one jew-guard bills Jev calls to. Use with /jev-workspace.",
        args: {
          action: tool.schema.enum(["status", "list", "select", "test"]).optional().describe("status/list/select/test (default status)"),
          select: tool.schema.string().optional().describe("Workspace id or name to select (with action select)"),
        },
        async execute(args) {
          const action = args.action ?? "status";
          if (action === "list" || action === "status") {
            const s = await workspaceStatus(process.env);
            if (!s.hasToken) return "No Console credential found. Run /connect in opencode first, then retry.";
            if (s.error) return `Could not list workspaces: ${s.error}`;
            const lines = s.spaces.map((w) => `- ${w.name} (${w.id})${s.selected?.id === w.id ? " [selected]" : ""}`);
            return [`Detected Console workspaces (${s.spaces.length}):`, ...lines,
              s.selected ? `Current selection: ${s.selected.name}.` : "No workspace selected yet — ask the user to pick one, then select it.",
            ].join("\n");
          }
          if (action === "select") {
            if (!args.select) return "Pass the workspace id or name as select.";
            const spaces = await listWorkspaces().catch((e) => { throw new Error(`could not list workspaces: ${e.message}`); });
            const hit = spaces.find((w) => w.id.toLowerCase() === String(args.select).toLowerCase() || w.name.toLowerCase() === String(args.select).toLowerCase());
            if (!hit) return `Unknown workspace "${args.select}". Known: ${spaces.map((w) => w.name).join(", ")}.`;
            if (!await validateWorkspace(hit)) return `Token rejected for "${hit.name}" — not saved.`;
            saveSelection(hit);
            return `jew-guard will bill Jev calls to "${hit.name}". Saved.`;
          }
          if (action === "test") {
            const a = await ask({ probe: "jew-guard workspace test" },
              { ok: { type: "noul", instructions: "Is this a harmless self-test?", criteria: { true: "Yes.", false: "No." } } });
            return `Jev answered end-to-end (p=${(a.ok.p ?? 0).toFixed(2)}). Billing workspace resolves correctly.`;
          }
          return `Unknown action "${action}".`;
        },
      }),
      jew_model: tool({
        description: "Show or change the Jev model jew-guard queries. Use with /jev-model.",
        args: {
          action: tool.schema.enum(["status", "set", "test"]).optional().describe("status/set/test (default status)"),
          model: tool.schema.string().optional().describe("Model id to switch to (with action set)"),
        },
        async execute(args) {
          const action = args.action ?? "status";
          const eff = effectiveModel(process.env);
          if (action === "status") {
            return `Current Jev model: ${eff.model} (from ${eff.source}).` +
              (process.env.JEV_MODEL ? " JEV_MODEL is set and wins over any saved pick." : "");
          }
          if (action === "test") {
            const a = await ask({ probe: "jew-guard model test" },
              { ok: { type: "noul", instructions: "Is this a harmless self-test?", criteria: { true: "Yes.", false: "No." } } });
            return `Jev (${eff.model}) answered end-to-end (p=${(a.ok.p ?? 0).toFixed(2)}).`;
          }
          if (action === "set") {
            const want = String(args.model ?? "").trim();
            if (!want) return "Pass the model id as model, e.g. jev-1.13.";
            const prev = readModel();
            saveModel(want);  // tentatively, so the test call below uses it
            try {
              const a = await ask({ probe: "jew-guard model test" },
                { ok: { type: "noul", instructions: "Is this a harmless self-test?", criteria: { true: "Yes.", false: "No." } } });
              return `Switched to ${want} (Jev answered, p=${(a.ok.p ?? 0).toFixed(2)}). Saved.`;
            } catch (e) {
              if (prev) saveModel(prev);  // revert: the pick does not work
              throw new Error(`Jev did not answer on "${want}": ${e.message}. Previous model kept.`);
            }
          }
          return `Unknown action "${action}".`;
        },
      }),
    },
  };
};

// ponytail: no default export on purpose. OpenCode's older loader treats every export as a plugin function and
// throws on an object; the newer loader only special-cases a default export. A single named function loads in both.
