import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../bin/jew-guard", import.meta.url));

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "jew-"));
  const data = join(dir, "data");
  const config = join(dir, "config.json");
  const env = {
    PATH: process.env.PATH,
    HOME: dir,
    XDG_CONFIG_HOME: join(dir, "config"),
    XDG_DATA_HOME: data,
    JEV_GUARD_CONFIG_FILE: config,
  };
  return { config, data, run: (args) => execFileSync("python3", [CLI, ...args], { env, encoding: "utf8" }) };
}

test("model set writes config.json", () => {
  const s = sandbox();
  s.run(["model", "set", "jev-1.13"]);
  assert.equal(JSON.parse(readFileSync(s.config, "utf8")).model, "jev-1.13");
});

test("auth stores the provider reference, never the key", () => {
  const s = sandbox();
  mkdirSync(join(s.data, "opencode"), { recursive: true });
  writeFileSync(join(s.data, "opencode", "auth.json"), JSON.stringify({ openrouter: { type: "api", key: "sk-or-secret" } }));
  s.run(["auth", "--endpoint", "openrouter", "--source", "auth"]);
  const config = readFileSync(s.config, "utf8");
  assert.equal(JSON.parse(config).keyProvider, "openrouter");
  assert.equal(JSON.parse(config).model, "inception/mercury-decide:free");
  assert.ok(!config.includes("sk-or-secret"));
});

test("invalid config.json is refused, not overwritten", () => {
  const s = sandbox();
  writeFileSync(s.config, "{ oops");
  assert.throws(() => s.run(["model", "set", "jev-1.13"]));
  assert.equal(readFileSync(s.config, "utf8"), "{ oops");
});

test("auth has no key source: secrets never reach argv or config.json", () => {
  const s = sandbox();
  assert.throws(() => s.run(["auth", "--endpoint", "opencode", "--source", "key", "--key", "oc_sk_live"]));
});
