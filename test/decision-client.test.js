import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ask, backend, OPENROUTER_URL } from "../src/decision.js";

const tmp = () => mkdtempSync(join(tmpdir(), "jew-"));
const sqlite = (() => {
  try {
    return createRequire(import.meta.url)("node:sqlite");
  } catch {
    return null;
  }
})();
const res = (status, body) => ({
  ok: status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});
const env = (extra = {}) => ({
  XDG_DATA_HOME: tmp(),
  XDG_CONFIG_HOME: tmp(),
  ...extra,
});
const withConfig = (config, extra = {}) => {
  const dir = tmp();
  writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  return env({ JEW_GUARD_CONFIG_FILE: join(dir, "config.json"), ...extra });
};

function seedDb(dir, provider, key) {
  mkdirSync(join(dir, "opencode"), { recursive: true });
  const db = new sqlite.DatabaseSync(join(dir, "opencode", "opencode.db"));
  db.exec(
    "create table credential (id text primary key, integration_id text, label text not null, value text not null, active integer)",
  );
  db.prepare(
    "insert into credential (id, integration_id, label, value, active) values (?, ?, ?, ?, 1)",
  ).run("c1", provider, provider, JSON.stringify({ type: "key", key }));
  db.close();
}

const QUESTIONS = { risk: { type: "score" }, approval: { type: "noul" } };
const ANSWERS = {
  answers: {
    risk: { type: "score", score: 0.4 },
    approval: { type: "noul", noul: 0.2 },
  },
};

test("backend ignores auth.json", async () => {
  const dir = tmp();
  mkdirSync(join(dir, "opencode"), { recursive: true });
  writeFileSync(
    join(dir, "opencode", "auth.json"),
    JSON.stringify({
      "opencode-go": { type: "api", key: "oc_sk_test" },
    }),
  );
  assert.equal(await backend(env({ XDG_DATA_HOME: dir })), null);
});

test(
  "backend reads the service key from opencode.db",
  { skip: !sqlite && "node:sqlite unavailable" },
  async () => {
    const dir = tmp();
    seedDb(dir, "opencode-go", "oc_sk_db");
    assert.deepEqual(await backend(env({ XDG_DATA_HOME: dir })), {
      kind: "console",
      key: "oc_sk_db",
      orgId: null,
    });
  },
);

test("backend without any credential returns null", async () => {
  assert.equal(await backend(env()), null);
});

test("backend from config.json: literal key, workspace", async () => {
  const b = await backend(
    withConfig({
      endpoint: "opencode",
      url: "https://example.test/v1/systemone",
      key: "st_test",
      org: "wrk_1",
      model: "test-model",
    }),
  );
  assert.deepEqual(b, {
    kind: "console",
    key: "st_test",
    url: "https://example.test/v1/systemone",
    orgId: "wrk_1",
  });
});

test("backend from config.json: console falls back to the injected token", async () => {
  const b = await backend(
    withConfig(
      {
        endpoint: "opencode",
        url: "https://example.test/v1/systemone",
        model: "test-model",
      },
      { OPENCODE_API_KEY: "api-key" },
    ),
  );
  assert.deepEqual(b, {
    kind: "console",
    key: "api-key",
    url: "https://example.test/v1/systemone",
    orgId: null,
  });
});

test("backend from config.json: custom endpoint", async () => {
  const b = await backend(
    withConfig({
      endpoint: "custom",
      url: "https://kev.example/v1/systemone",
      key: "secret",
      model: "test-model",
    }),
  );
  assert.deepEqual(b, {
    kind: "custom",
    key: "secret",
    url: "https://kev.example/v1/systemone",
    orgId: null,
  });
});

test("config url must be https or local http", async () => {
  await assert.rejects(
    backend(
      withConfig({ endpoint: "custom", url: "http://evil.example", key: "k" }),
    ),
    /must be https/,
  );
});

test(
  "backend from config.json: opencode.db provider",
  { skip: !sqlite && "node:sqlite unavailable" },
  async () => {
    const dir = tmp();
    seedDb(dir, "openrouter", "sk-or-test");
    const b = await backend(
      withConfig(
        {
          endpoint: "openrouter",
          url: OPENROUTER_URL,
          keyProvider: "openrouter",
          model: "test-model",
        },
        { XDG_DATA_HOME: dir },
      ),
    );
    assert.deepEqual(b, {
      kind: "openrouter",
      key: "sk-or-test",
      url: OPENROUTER_URL,
      orgId: null,
    });
  },
);

test("backend from config.json: missing credential throws with a pointer", async () => {
  await assert.rejects(
    backend(
      withConfig({
        endpoint: "opencode",
        url: "https://example.test",
        keyProvider: "nope",
      }),
    ),
    /no credential for provider "nope" in opencode\.db.*jew-guard auth/,
  );
});

test("ask uses the configured backend", async () => {
  const calls = [];
  const e = withConfig({
    endpoint: "openrouter",
    url: OPENROUTER_URL,
    key: "or-config",
    model: "test-model",
  });
  const a = await ask({ tool: "bash" }, QUESTIONS, {
    env: e,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return res(200, ANSWERS);
    },
  });
  assert.deepEqual(calls, [OPENROUTER_URL]);
  assert.equal(a.risk.score, 0.4);
  assert.equal(a.approval.p, 0.2);
});

test("ask refuses to run without a configured model", async () => {
  const e = withConfig({
    endpoint: "openrouter",
    url: OPENROUTER_URL,
    key: "or-config",
  });
  await assert.rejects(
    ask({ q: 1 }, QUESTIONS, {
      env: e,
      fetchImpl: async () => res(200, ANSWERS),
    }),
    /no model configured/,
  );
});

test("ask refuses to run without credentials", async () => {
  await assert.rejects(
    ask({ q: 1 }, QUESTIONS, {
      env: env(),
      fetchImpl: async () => res(200, ANSWERS),
    }),
    /no credentials/,
  );
});

test("answer numbers are normalized and missing fields stay missing", async () => {
  const body = {
    answers: {
      risk: { score: "0.4" },
      approval: { noul: "0.2" },
      user_requested: {},
      from_untrusted: { noul: null },
    },
  };
  const a = await ask({ q: 1 }, QUESTIONS, {
    env: withConfig({
      endpoint: "custom",
      url: "https://kev.example/v1/systemone",
      key: "secret",
      model: "test-model",
    }),
    fetchImpl: async () => res(200, body),
  });
  assert.equal(a.risk.score, 0.4);
  assert.equal(a.approval.p, 0.2);
  assert.equal(a.risk.p, undefined);
  assert.equal(a.user_requested.p, undefined);
  assert.equal(a.from_untrusted.p, undefined);
});

test("ask model option overrides the configured model", async () => {
  let body;
  const e = withConfig({
    endpoint: "opencode",
    url: "https://example.test/v1/systemone",
    key: "st_test",
    model: "from-config",
  });
  await ask({ q: 1 }, QUESTIONS, {
    env: e,
    model: "candidate",
    fetchImpl: async (url, init) => {
      body = JSON.parse(init.body);
      return res(200, ANSWERS);
    },
  });
  assert.equal(body.model, "candidate");
});

test("config.json with only workspace/model picks leaves auto-detection in charge", async () => {
  assert.equal(
    await backend(withConfig({ model: "test-model", org: "wrk_1" })),
    null,
  );
});
