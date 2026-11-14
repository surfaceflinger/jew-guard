import { createJewGuard } from "../src/opencode.js";

export async function loadPlugin(deps = {}, overrides = {}) {
  const hooks = {};
  const tools = {};
  const commands = {};
  let rpc;
  const ctx = {
    location: { directory: "/tmp" },
    session: { context: async () => [] },
    tool: {
      hook: async (name, callback) => {
        hooks[name] = callback;
      },
      transform: async (callback) => {
        callback({
          add: (definition) => {
            tools[definition.name] = definition;
          },
        });
      },
    },
    command: {
      transform: async (callback) => {
        callback({
          add: (definition) => {
            commands[definition.name] = definition;
          },
        });
      },
    },
    permission: {
      hook: async (name, callback) => {
        hooks[name] = callback;
      },
    },
    rpc: {
      register: async (definition, handlers) => {
        rpc = { definition, handlers };
        return { events: { emit: async () => {} } };
      },
    },
    ...overrides,
  };
  await createJewGuard(deps).setup(ctx);
  return { hooks, tools, commands, rpc, ctx };
}
