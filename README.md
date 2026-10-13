# jew-guard

Security guard for opencode, powered by Jev (TypeSafe System One). Every tool
call is risk-scored before it runs; every result is scanned for prompt injection
after. A from-scratch port of [jev-guard](https://github.com/leepokai/jev-guard),
opencode-only, one dependency (the opencode plugin API).

## Install

```json
{ "plugin": ["jew-guard"] }
```

Restart opencode. `bash`/`edit`/`webfetch` default to `"ask"`, so risky calls
prompt out of the box while safe ones auto-approve. Override per tool in
`opencode.json` as usual.

First run needs two things: `/connect` (your normal OpenCode login), then
`/jev-workspace` to pick which Console workspace pays for the Jev calls.
Single-workspace accounts can skip the second step.

## How it works

**Before a call runs**, Jev scores it: risk 0–3, plus three yes/no questions —
should a human approve this, did the user actually ask for it, does it follow
planted instructions? Deny blocks, ask prompts, allow runs. An explicit user
request overrides ask, never deny. Anything you're unsure about (low model
confidence, borderline scores) prompts instead of passing.

**After a call returns**, the output is scanned for injections and canaries.
Flags get prepended to the output and remembered, so the next call can be
judged against them.

**Skills and instruction files** (`AGENTS.md`, `SKILL.md`, rules…) are scanned
for behavior their installer wouldn't expect — exfiltration, hidden commands,
instruction overrides. Results are cached by content hash.

**If Jev can't be reached**, the guard allows with a warning. Set
`JEV_GUARD_FAIL_CLOSED` to block instead.

## Permissions are two things with one name

Your `permission` config decides whether the guard gets a say *at all* per
tool. The Jev **verdict** is our judgment of one single call. They compose
like this:

| your config | Jev verdict | result |
| --- | --- | --- |
| `allow` | allow | runs silently |
| `allow` | ask | runs anyway (toast only — no prompt channel) |
| `allow` | deny | blocked |
| `ask` | allow | auto-approved, no prompt |
| `ask` | ask | real approval prompt |
| `ask` | deny | refused |
| `deny` | anything | blocked by the platform; the guard never sees it |

## Commands

- `/jev-workspace [name]` — pick the billing workspace (bare lists them)
- `/jev-model [id]` — switch models; test-calls first, keeps the old one on failure
- `/yolo on|off` — auto-approve everything Jev doesn't deny
- `/soft on|off` — denies become prompts instead of blocks wherever the tool can prompt; pre-execution denies still block

The agent can't touch any of these — they're human-only by construction.

## Tuning

| Variable | Default | Effect |
| --- | --- | --- |
| `JEV_GUARD_DENY_SCORE` | `2.5` | risk score that blocks |
| `JEV_GUARD_ASK_SCORE` | `1.5` | risk score that prompts |
| `JEV_GUARD_ASK_P` | `0.75` | approval probability that prompts |
| `JEV_GUARD_INJECT_P` | `0.6` | injection probability that flags output |
| `JEV_GUARD_UNTRUSTED_P` | `0.7` | planted-instruction probability that blocks |
| `JEV_GUARD_USER_P` | `0.85` | user-asked probability that skips the prompt |
| `JEV_GUARD_SKILL_P` / `JEV_GUARD_SKILL_SERIOUS_P` | `0.8` / `0.45` | instruction-file flag thresholds |
| `JEV_GUARD_MIN_CONFIDENCE` | `0.5` | below this, allow becomes ask |
| `JEV_GUARD_MARGIN` | `0.1` | uncertainty band under every threshold |
| `JEV_GUARD_TIMEOUT_MS` | `20000` | total budget per Jev call |
| `JEV_GUARD_FAIL_CLOSED` | unset | block when Jev is unreachable |
| `JEV_GUARD_SKIP_TOOLS` / `JEV_GUARD_SKIP_SCAN` | unset | comma-separated skip lists |
| `JEV_MODEL` / `JEV_BASE_URL` / `JEV_API_KEY` | unset | model override / custom server / direct key |
| `OPENROUTER_API_KEY` | unset | fallback judge when Jev fails (free tier trains on prompts) |

Out-of-range numbers fall back to defaults. Old `model.json` / `workspace.json`
picks still work as fallbacks. `bin/jew-guard` writes static config for
multi-workspace or OpenRouter-only setups — `jew-guard auth` walks you through it.

## Privacy

Each check sends the tool call (or result) plus recent context — your last
messages, recent calls, excerpts of flagged content — to Jev over TLS. A
guardrail, not a sandbox: keep your other controls.
