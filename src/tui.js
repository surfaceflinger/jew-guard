import { Plugin } from "@opencode/plugin/tui";
import { JewGuardRpc } from "./rpc.js";

const show = (context, result) => {
  if (!result?.message) return;
  context.ui.toast.show({
    title: "jew-guard",
    message: result.message,
    variant: result.variant ?? "info",
  });
};

const attempt = async (context, run) => {
  try {
    show(context, await run());
  } catch (error) {
    show(context, {
      message: String(error?.message ?? error),
      variant: "error",
    });
  }
};

const pickWorkspace = (context, guard) =>
  attempt(context, async () => {
    const { current, items, message } = await guard.workspaces({});
    if (!items?.length)
      return { message: message ?? "no workspaces found", variant: "warning" };
    const picked = await context.ui.dialog.select({
      title: "jew-guard: billing workspace",
      current: current || undefined,
      options: items.map((workspace) => ({
        title: workspace.name,
        value: workspace.id,
        description: workspace.id,
      })),
    });
    return picked ? guard.workspace({ text: picked }) : null;
  });

export default Plugin.define({
  id: "jew-guard.tui",
  setup(context) {
    const guard = context.client.rpc(JewGuardRpc);
    const run = (method) => (input) =>
      attempt(context, () => guard[method]({ text: input ?? "" }));
    context.keymap.layer(() => ({
      commands: [
        {
          id: "jew-guard.yolo",
          title: "Toggle jew-guard yolo mode",
          slash: { name: "yolo", arguments: true },
          run: run("yolo"),
        },
        {
          id: "jew-guard.soft",
          title: "Toggle jew-guard soft mode",
          slash: { name: "soft", arguments: true },
          run: run("soft"),
        },
        {
          id: "jew-guard.model",
          title: "Show or switch the jew-guard model",
          slash: { name: "jev-model", arguments: true },
          run: run("model"),
        },
        {
          id: "jew-guard.workspace",
          title: "Show or pick the jew-guard billing workspace",
          slash: { name: "jev-workspace", arguments: true },
          run: (input) =>
            input
              ? attempt(context, () => guard.workspace({ text: input }))
              : pickWorkspace(context, guard),
        },
      ],
    }));
  },
});
