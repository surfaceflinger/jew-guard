import { homedir } from "node:os";
import { join } from "node:path";

export const configDir = (env = process.env) => join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "jew-guard");
