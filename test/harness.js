import { createJewGuard } from "../src/opencode.js";

export async function loadPlugin(deps = {}, overrides = {}) {
  const hooks = {};
  const tools = {};
  const commands = {};
  const ctx = {
    location: { directory: "/tmp" },
    session: { context: async () => [] },
    tool: {
      hook: async (name, callback) => { hooks[name] = callback; },
      transform: async (callback) => { callback({ add: (definition) => { tools[definition.name] = definition; } }); },
    },
    command: {
      transform: async (callback) => { callback({ add: (definition) => { commands[definition.name] = definition; } }); },
    },
    permission: {
      hook: async (name, callback) => { hooks[name] = callback; },
    },
    ...overrides,
  };
  await createJewGuard(deps).setup(ctx);
  return { hooks, tools, commands, ctx };
}
