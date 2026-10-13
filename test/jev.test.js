import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ask, backend, OPENROUTER_URL } from "../src/jev.js";

const tmp = () => mkdtempSync(join(tmpdir(), "jew-"));
const res = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body), json: async () => body });
// env for every test: no real auth.json, no real config.json.
const env = (extra = {}) => ({ XDG_DATA_HOME: tmp(), XDG_CONFIG_HOME: tmp(), ...extra });
const withConfig = (config, extra = {}) => {
  const dir = tmp();
  writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  return env({ JEV_GUARD_CONFIG_FILE: join(dir, "config.json"), ...extra });
};

const QUESTIONS = { risk: { type: "score" }, approval: { type: "noul" } };
const ANSWERS = { answers: { risk: { type: "score", score: 0.4 }, approval: { type: "noul", noul: 0.2 } } };

test("backend falls back to the opencode-go service key in auth.json", async () => {
  const dir = tmp();
  mkdirSync(join(dir, "opencode"), { recursive: true });
  writeFileSync(join(dir, "opencode", "auth.json"), JSON.stringify({
    "opencode-go": { type: "api", key: "oc_sk_test" },
  }));
  const b = await backend(env({ XDG_DATA_HOME: dir }));
  assert.deepEqual(b, { kind: "console", key: "oc_sk_test", orgId: null });
});

test("backend without any credential returns null", async () => {
  assert.equal(await backend(env()), null);
});

test("backend from config.json: literal key, workspace", async () => {
  const b = await backend(withConfig({ endpoint: "opencode", url: "https://example.test/v1/systemone", key: "st_test", org: "wrk_1", model: "jev-1.13" }));
  assert.deepEqual(b, { kind: "console", key: "st_test", url: "https://example.test/v1/systemone", orgId: "wrk_1" });
});

test("config url must be https or local http", async () => {
  await assert.rejects(backend(withConfig({ endpoint: "custom", url: "http://evil.example", key: "k" })), /must be https/);
});

test("backend from config.json: auth.json provider", async () => {
  const dir = tmp();
  mkdirSync(join(dir, "opencode"), { recursive: true });
  writeFileSync(join(dir, "opencode", "auth.json"), JSON.stringify({ openrouter: { type: "api", key: "sk-or-test" } }));
  const b = await backend(withConfig({ endpoint: "openrouter", url: OPENROUTER_URL, keyProvider: "openrouter" }, { XDG_DATA_HOME: dir }));
  assert.deepEqual(b, { kind: "openrouter", key: "sk-or-test", url: OPENROUTER_URL, orgId: null });
});

test("backend from config.json: missing credential throws with a pointer", async () => {
  await assert.rejects(backend(withConfig({ endpoint: "opencode", url: "https://example.test", keyEnv: "NOPE_TOKEN" })), /env NOPE_TOKEN is not set.*jew-guard auth/);
});

test("ask calls OpenRouter decisions when the Jev backend errors", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return calls.length === 1 ? res(402, { error: "insufficient funds" }) : res(200, ANSWERS);
  };
  const e = env({ JEV_BASE_URL: "https://kev.example", OPENROUTER_API_KEY: "or-test" });
  const a = await ask({ tool: "bash" }, QUESTIONS, { env: e, fetchImpl });
  assert.deepEqual(calls, ["https://kev.example/v1/systemone", OPENROUTER_URL]);
  assert.equal(a.risk.score, 0.4);
  assert.equal(a.approval.p, 0.2);
});

test("ask does not call OpenRouter when Jev answers", async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(String(url)); return res(200, ANSWERS); };
  await ask({ tool: "bash" }, QUESTIONS, { env: env({ JEV_BASE_URL: "https://kev.example", OPENROUTER_API_KEY: "or-test" }), fetchImpl });
  assert.equal(calls.length, 1);
});

test("ask uses OpenRouter directly when no Jev backend exists", async () => {
  const calls = [];
  const e = env({ OPENROUTER_API_KEY: "or-test" });
  const a = await ask({ tool: "bash" }, QUESTIONS, { env: e, fetchImpl: async (url) => { calls.push(String(url)); return res(200, ANSWERS); } });
  assert.deepEqual(calls, [OPENROUTER_URL]);
  assert.equal(a.risk.score, 0.4);
});

test("ask uses the configured OpenRouter backend without re-falling back", async () => {
  const calls = [];
  const e = withConfig({ endpoint: "openrouter", url: OPENROUTER_URL, key: "or-config", model: "inception/mercury-decide:free" });
  await ask({ tool: "bash" }, QUESTIONS, { env: e, fetchImpl: async (url) => { calls.push(String(url)); return res(200, ANSWERS); } });
  assert.deepEqual(calls, [OPENROUTER_URL]);
});

test("ask with fallback:false or FAIL_CLOSED never calls OpenRouter", async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(String(url)); return res(402, { error: "insufficient funds" }); };
  const base = { JEV_BASE_URL: "https://kev.example", OPENROUTER_API_KEY: "or-test" };
  await assert.rejects(ask({ q: 1 }, QUESTIONS, { env: env({ ...base, JEV_GUARD_FAIL_CLOSED: "1" }), fetchImpl }), /HTTP 402/);
  await assert.rejects(ask({ q: 1 }, QUESTIONS, { env: env(base), fetchImpl, fallback: false }), /HTTP 402/);
  assert.deepEqual(calls, ["https://kev.example/v1/systemone", "https://kev.example/v1/systemone"]);
});

test("JEV_MODEL env wins over the config.json model", async () => {
  let body;
  const e = withConfig({ endpoint: "opencode", url: "https://example.test/v1/systemone", key: "st_test", model: "from-config" }, { JEV_MODEL: "from-env" });
  await ask({ q: 1 }, QUESTIONS, { env: e, fetchImpl: async (url, init) => { body = JSON.parse(init.body); return res(200, ANSWERS); } });
  assert.equal(body.model, "from-env");
});

test("config.json with only workspace/model picks leaves auto-detection in charge", async () => {
  assert.equal(await backend(withConfig({ model: "jev-1.13", org: "wrk_1" })), null);
});
