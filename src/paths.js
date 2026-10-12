// Single home for jew-guard state: ~/.config/jew-guard (or $XDG_CONFIG_HOME/jew-guard).
// Holds only non-secret state: session memory, scan cache, workspace pick, model pick. Never keys.
import { homedir } from "node:os";
import { join } from "node:path";

export const configDir = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "jew-guard");
