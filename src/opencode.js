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

const COMMANDS = [
  [WORKSPACE_COMMAND, "Pick the Console workspace jew-guard bills Jev calls to", WORKSPACE_TEMPLATE],
  [MODEL_COMMAND, "Pick the Jev model jew-guard queries (free vs paid)", MODEL_TEMPLATE],
  [YOLO_COMMAND, "Toggle yolo mode: Jev auto-approves everything it doesn't deny", YOLO_TEMPLATE],
  [SOFT_COMMAND, "Toggle soft mode: Jev denies become approval prompts instead of blocks", SOFT_TEMPLATE],
];

const ASK_BY_DEFAULT = ["bash", "edit", "write", "webfetch"];

async function workspaceStatus(env = process.env, options = {}) {
  const hasToken = !!consoleToken(env);
  let spaces = [];
  try { spaces = hasToken ? await listWorkspaces({ env, fetchImpl: options.fetchImpl }) : []; } catch (error) { return { hasToken, spaces, selected: null, error: error.message }; }
  const selected = await resolveWorkspace(env, { ...options, spaces }).catch(() => null);
  return { hasToken, spaces, selected };
}

async function probeModel() {
  const answer = await ask({ probe: "jew-guard model test" },
    { ok: { type: "noul", instructions: "Is this a harmless self-test?", criteria: { true: "Yes.", false: "No." } } },
    { fallback: false });
  return answer.ok.p ?? 0;
}

export const JewGuard = async ({ client, directory }, deps = {}) => {
  const judge = deps.assessAction ?? assessAction;
  const scanCached = deps.scanInstructionsCached ?? scanInstructionsCached;
  const scanOutput = deps.scanContent ?? scanContent;
  const toast = (message, variant = "warning") =>
    client?.tui?.showToast?.({ body: { title: "jew-guard", message, variant, duration: 8000 } }).catch(() => {});
  const failOpen = (err) => {
    toast(`jew-guard unavailable, allowing: ${err.message}`, "error");
    if (process.env.JEV_GUARD_FAIL_CLOSED) throw new Error(`jew-guard unavailable: ${err.message}`);
    return null;
  };
  const unjudgedYolo = () => isYolo() && !process.env.JEV_GUARD_FAIL_CLOSED;
  const stopWith = (text) => { throw new Error(`jew-guard: ${text}`); };

  const toggleMode = async (name, arg) => {
    const softCommand = name === SOFT_COMMAND;
    const modeOn = () => softCommand ? isSoft() : isYolo();
    const setMode = (on) => softCommand ? setSoft(on) : setYolo(on);
    const label = softCommand ? "soft" : "yolo";
    const want = arg.toLowerCase();
    if (!arg) { stopWith(`${label} mode is ${modeOn() ? "ON" : "OFF"}. Run /${label} on|off.`); }
    if (want !== "on" && want !== "off") { stopWith(`usage: /${label} on|off (currently ${modeOn() ? "on" : "off"}).`); }
    setMode(want === "on");
    toast(`${label} mode ${want === "on" ? "enabled" : "disabled"}`);
    stopWith(`${label} mode ${want === "on" ? "ON" : "OFF"}.` + (softCommand && want === "on" ? " Jev denies now prompt instead of blocking." : ""));
  };
  const pickWorkspace = async (arg) => {
    const status = await workspaceStatus(process.env);
    if (!status.hasToken) stopWith("no Console credential — run /connect first.");
    if (status.error) stopWith(`workspace lookup failed: ${status.error}`);
    if (!arg) stopWith(status.spaces.map((workspace) => `- ${workspace.name}${status.selected?.id === workspace.id ? " [selected]" : ""}`).join("\n") +
      (status.selected ? "" : "\nRe-run as /jev-workspace <name> to pick."));
    const match = matchWorkspace(status.spaces, arg);
    if (!match) stopWith(`unknown workspace "${arg}". Known: ${status.spaces.map((workspace) => workspace.name).join(", ")}.`);
    if (!await validateWorkspace(match)) stopWith(`token rejected for "${match.name}" — not saved.`);
    saveSelection(match);
    stopWith(`Jev calls will bill to "${match.name}". Saved.`);
  };
  const pickModel = async (arg) => {
    const current = effectiveModel(process.env);
    if (!arg) stopWith(`model: ${current.model} (from ${current.source}). Re-run as /jev-model <id> to switch; known: jev-1.13-free, jev-1.13.`);
    const previousModel = readModel();
    saveModel(arg);
    try {
      const probability = await probeModel();
      stopWith(`switched to ${arg} (Jev answered, p=${probability.toFixed(2)}). Saved.`);
    } catch (error) {
      if (previousModel) saveModel(previousModel); else deleteModel();
      stopWith(`Jev did not answer on "${arg}": ${error.message} Previous model kept.`);
    }
  };

  const context = async (sessionID) => {
    const response = await client?.session?.messages?.({ path: { id: sessionID } }).catch(() => null);
    return buildContext({ sessionId: sessionID, messages: messagesFrom(response?.data ?? []) });
  };

  const answerPermissionDialog = async (sessionID, requestID, props) => {
    const patterns = Array.isArray(props.patterns) ? props.patterns : [];
    let allow = true;
    try {
      const verdict = await judge({
        tool: props.permission ?? "unknown",
        input: { permission: props.permission, patterns },
        cwd: directory, agent: "opencode",
        context: await context(sessionID),
      });
      const level = resolveLevel(verdict?.level ?? null, { yolo: true, soft: isSoft() });
      if (level === "ask") return;
      allow = level !== "deny";
      if (verdict) remember(sessionID, "calls", {
        tool: String(props.permission ?? "unknown"),
        preview: preview(patterns.join("; "), 100),
        level: allow ? "allow" : verdict.level,
      });
    } catch (err) {
      if (unjudgedYolo()) {
        toast(`jew-guard could not judge this permission, leaving it to you: ${err.message}`, "error");
        return;
      }
      allow = !process.env.JEV_GUARD_FAIL_CLOSED;
    }
    const response = allow ? "once" : "reject";
    const send = (query) => client?.postSessionIdPermissionsPermissionId?.({ path: { id: sessionID, permissionID: requestID }, body: { response }, ...(query ? { query } : {}) })?.catch(() => null);
    const reply = await send();
    if (!reply || reply.error) await send({ directory }).catch(() => null);
  };

  return {
    "event": async ({ event }) => {
      try {
        if (!event || event.type !== "permission.asked" || !isYolo()) return;
        const props = event.properties ?? {};
        const sessionID = props.sessionID, requestID = props.id ?? props.requestID;
        if (!sessionID || !requestID) return;
        await answerPermissionDialog(sessionID, requestID, props);
      } catch {}
    },

    "config": async (input) => {
      if (input.permission === undefined) input.permission = {};
      if (input.permission && typeof input.permission === "object")
        for (const toolName of ASK_BY_DEFAULT) input.permission[toolName] ??= "ask";
      input.command ??= {};
      for (const [name, description, template] of COMMANDS) if (!input.command[name]) input.command[name] = { description, template };
    },

    "command.execute.before": async (input, output) => {
      const name = String(input.command ?? "").replace(/^\//, "").toLowerCase();
      if (name !== WORKSPACE_COMMAND && name !== MODEL_COMMAND && name !== YOLO_COMMAND && name !== SOFT_COMMAND) return;
      const arg = String(input.arguments ?? "").trim();
      if (name === YOLO_COMMAND || name === SOFT_COMMAND) return toggleMode(name, arg);
      if (name === WORKSPACE_COMMAND) return pickWorkspace(arg);
      return pickModel(arg);
    },

    "tool.execute.before": async (input, output) => {
      let verdict;
      try {
        verdict = await judge({
          tool: input.tool,
          input: output.args,
          cwd: directory, agent: "opencode",
          context: await context(input.sessionID),
        });
      } catch (err) {
        if (!unjudgedYolo()) return failOpen(err);
        throw new Error(`jew-guard could not judge this call (${err.message}); yolo mode never runs unjudged calls. Fix Jev (pay for the model / /jev-workspace) or run /yolo off.`);
      }
      if (verdict) remember(input.sessionID, "calls", {
        tool: input.tool,
        preview: preview(output.args, 100),
        level: verdict.level,
      });
      if (!verdict || verdict.level === "allow") return;
      if (verdict.level === "deny") throw new Error(verdict.message);
      if (isYolo()) return;
      toast(`${verdict.message} (set permission for ${input.tool} to "ask" in opencode.json to get a real prompt)`);
    },

    "permission.ask": async (input, output) => {
      const callInput = { ...(input.metadata ?? {}), pattern: input.pattern, title: input.title };
      let verdict;
      try {
        verdict = await judge({
          tool: input.type,
          input: callInput,
          cwd: directory, agent: "opencode",
          context: await context(input.sessionID),
        });
      } catch (err) {
        if (!unjudgedYolo()) return failOpen(err);
        toast(`jew-guard could not judge this prompt, leaving it to you: ${err.message}`, "error");
        return;
      }
      const level = resolveLevel(verdict?.level ?? null, { yolo: isYolo(), soft: isSoft() });
      if (level === null) return;
      output.status = level;
      if (level !== "allow") toast(verdict?.message ?? `jew-guard: ${level}`);
    },

    "tool.execute.after": async (input, output) => {
      const source = input.args?.url ?? input.args?.filePath ?? input.args?.path;
      const isInstructionFile = /^skill$/i.test(input.tool ?? "") || (source && INSTRUCTION_FILE.test(source));
      const verdict = await (isInstructionFile
        ? scanCached({ text: output.output, source: source ?? input.args?.name ?? input.tool })
        : scanOutput({ text: output.output, tool: input.tool, source: preview(input.args, 120) })
      ).catch(() => null);
      if (verdict?.flagged) remember(input.sessionID, "flags", {
        kind: verdict.kind,
        source, tool: input.tool,
        p: +verdict.p.toFixed(2),
        excerpt: excerpt(output.output),
      });
      if (!verdict?.flagged) return;
      toast(verdict.message);
      output.output = `[${verdict.message}]\n\n${output.output}`;
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
            const probability = await probeModel();
            return `Jev answered end-to-end (p=${probability.toFixed(2)}). Billing workspace resolves correctly.`;
          }
          const status = await workspaceStatus(process.env);
          if (!status.hasToken) return "No Console credential found. Run /connect in opencode first, then retry.";
          if (status.error) return `Could not list workspaces: ${status.error}`;
          const lines = status.spaces.map((workspace) => `- ${workspace.name} (${workspace.id})${status.selected?.id === workspace.id ? " [selected]" : ""}`);
          return [`Detected Console workspaces (${status.spaces.length}):`, ...lines,
            status.selected ? `Current selection: ${status.selected.name}.` : "No workspace selected yet — the human picks one with /jev-workspace.",
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
          const current = effectiveModel(process.env);
          if (action === "test") {
            const probability = await probeModel();
            return `Jev (${current.model}) answered end-to-end (p=${probability.toFixed(2)}).`;
          }
          return `Current Jev model: ${current.model} (from ${current.source}).` +
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

