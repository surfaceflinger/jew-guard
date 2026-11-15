import test from "node:test";
import assert from "node:assert/strict";
import tui from "../src/tui.js";
import { JewGuardRpc } from "../src/rpc.js";

const command = (commands, name) =>
  commands.find((entry) => entry.slash?.name === name);

function load(overrides = {}, selection = "wrk_2") {
  const calls = [];
  const toasts = [];
  const dialogs = [];
  const commands = [];
  const guard = {
    yolo: async (input) => {
      calls.push(["yolo", input]);
      return { message: "yolo ON", variant: "success" };
    },
    soft: async (input) => {
      calls.push(["soft", input]);
      return { message: "soft ON", variant: "success" };
    },
    model: async (input) => {
      calls.push(["model", input]);
      return { message: "model set", variant: "success" };
    },
    models: async () => {
      calls.push(["models"]);
      return {
        current: "vendor/model-a",
        items: [
          {
            id: "vendor/model-a",
            name: "Model A",
            vendor: "typesafe",
          },
        ],
      };
    },
    workspace: async (input) => {
      calls.push(["workspace", input]);
      return { message: "saved", variant: "success" };
    },
    workspaces: async () => {
      calls.push(["workspaces"]);
      return {
        current: "wrk_1",
        items: [
          { id: "wrk_1", name: "one" },
          { id: "wrk_2", name: "two" },
        ],
      };
    },
    ...overrides,
  };
  const context = {
    client: {
      rpc: (definition) => {
        assert.equal(definition, JewGuardRpc);
        return guard;
      },
    },
    keymap: {
      layer: (factory) => {
        commands.push(...factory().commands);
      },
    },
    ui: {
      toast: { show: (options) => toasts.push(options) },
      dialog: {
        select: async (options) => {
          dialogs.push(options);
          return selection;
        },
      },
    },
  };
  tui.setup(context);
  return { calls, toasts, dialogs, commands };
}

test("tui part registers the four slash commands", () => {
  const { commands } = load();
  assert.deepEqual(commands.map((entry) => entry.slash.name).sort(), [
    "jew-model",
    "jew-workspace",
    "soft",
    "yolo",
  ]);
});

test("tui slash commands call the rpc and toast the result", async () => {
  const { calls, toasts, commands } = load();
  await command(commands, "yolo").run("on");
  assert.deepEqual(calls.at(-1), ["yolo", { text: "on" }]);
  assert.equal(toasts.at(-1).message, "yolo ON");
  assert.equal(toasts.at(-1).variant, "success");
  await command(commands, "jew-model").run("direct-model");
  assert.deepEqual(calls.at(-1), ["model", { text: "direct-model" }]);
});

test("bare jew-model opens the decision catalog picker", async () => {
  const { calls, dialogs, commands } = load({}, "vendor/model-a");
  await command(commands, "jew-model").run("");
  assert.equal(dialogs[0].options[0].value, "vendor/model-a");
  assert.equal(dialogs[0].options[0].category, "typesafe");
  assert.deepEqual(calls.at(-1), ["model", { text: "vendor/model-a" }]);
});

test("a single workspace is saved without a picker", async () => {
  const { calls, dialogs, commands } = load({
    workspaces: async () => ({
      current: "",
      items: [{ id: "wrk_1", name: "one" }],
    }),
  });
  await command(commands, "jew-workspace").run("");
  assert.equal(dialogs.length, 0);
  assert.deepEqual(calls.at(-1), ["workspace", { text: "wrk_1" }]);
});

test("bare jew-workspace opens a picker and saves the choice", async () => {
  const { calls, toasts, dialogs, commands } = load();
  await command(commands, "jew-workspace").run("");
  assert.equal(dialogs[0].options.length, 2);
  assert.deepEqual(calls.at(-1), ["workspace", { text: "wrk_2" }]);
  assert.equal(toasts.at(-1).message, "saved");
});

test("jew-workspace with an argument skips the picker", async () => {
  const { calls, dialogs, commands } = load();
  await command(commands, "jew-workspace").run("two");
  assert.equal(dialogs.length, 0);
  assert.deepEqual(calls.at(-1), ["workspace", { text: "two" }]);
});

test("rpc failures become error toasts", async () => {
  const { toasts, commands } = load({
    soft: async () => {
      throw new Error("offline");
    },
  });
  await command(commands, "soft").run("on");
  assert.equal(toasts.at(-1).variant, "error");
  assert.match(toasts.at(-1).message, /offline/);
});
