import { homedir } from "node:os";
import { join } from "node:path";

export const configDir = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "jew-guard");
