import { Rpc } from "@opencode/plugin/rpc";

const textInput = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
  additionalProperties: false,
};

const emptyInput = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const messageOutput = {
  type: "object",
  properties: {
    message: { type: "string" },
    variant: { type: "string" },
  },
  required: ["message", "variant"],
  additionalProperties: false,
};

const choicesOutput = {
  type: "object",
  properties: {
    current: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id", "name"],
        additionalProperties: false,
      },
    },
    message: { type: "string" },
  },
  required: ["current", "items"],
  additionalProperties: false,
};

export const JewGuardRpc = Rpc.define({
  id: "jew-guard",
  methods: {
    yolo: { input: textInput, output: messageOutput },
    soft: { input: textInput, output: messageOutput },
    model: { input: textInput, output: messageOutput },
    workspace: { input: textInput, output: messageOutput },
    workspaces: { input: emptyInput, output: choicesOutput },
  },
  events: {},
});
