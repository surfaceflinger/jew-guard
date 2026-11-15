# jew-guard

Security guard for opencode, powered by a decision model (TypeSafe System
One, OpenRouter decisions, or any compatible endpoint). Every tool call is
risk-scored before it runs; every result is scanned for prompt injection
after. A from-scratch port of [jev-guard](https://github.com/leepokai/jev-guard),
opencode-only, one dependency (the opencode v2 plugin API).

## Install

```json
{ "plugins": ["jew-guard"] }
```

Restart opencode. Risky calls prompt out of the box while safe ones
auto-approve. Override the `permissions` rules in `opencode.json` as usual.

First run needs two things: `/connect` (your normal OpenCode login), then
`/jew-workspace` to pick which Console workspace pays for the decision calls.
Single-workspace accounts can skip the second step.

## How it works

**Before a call runs**, the decision model scores it: risk 0–3, plus three
yes/no questions — should a human approve this, did the user actually ask
for it, does it follow planted instructions? Deny blocks, ask needs
approval, allow leaves the call to your rules. An explicit user request
overrides ask inside the model's verdict, never deny. Anything you're unsure
about (low model confidence, borderline scores) prompts instead of passing.

**After a call returns**, the output is scanned for injections and canaries.
Failed calls are scanned too: their error text is treated as tool output. Large
results are scanned in windows of 60k chars; anything beyond four windows is
marked partially scanned. If the scan itself fails,
the result is marked untrusted and logged. Flags get prepended to the output
and remembered, so the next call can be judged against them.

**Warnings** go to the opencode logs. Server plugins cannot show toasts, so
fail-open notices and flagged results appear there; flagged tool results also
carry the warning in their content.

**Skills and instruction files** (`AGENTS.md`, `SKILL.md`, rules…) are scanned
for behavior their installer wouldn't expect — exfiltration, hidden commands,
instruction overrides. Results are cached by content and model for 7 days.

**If the decision model can't be reached**, the guard gets out of the way:
it logs a warning and your opencode `permissions` rules decide, exactly as
without the plugin. That means the V2 default may let the call run. Set
`JEW_GUARD_FAIL_CLOSED` to block instead. See [your rules and the model's
verdict](#your-rules-and-the-models-verdict).

## Your rules and the model's verdict

opencode applies your `permissions` rules first; the **verdict** is our
judgment of one single call. Read-only tools (`read`, `grep`, `glob`,
`websearch`, `skill`, the guard's own status tools) skip the decision model
and follow your rules. Everything else — `shell`, `edit`/`write`/`patch`,
`webfetch`, MCP tools — is judged. Permission prompts that are not tied to a
tool call (for example `external_directory`) are left to your rules; the
decision model does not judge them.

Rules use V2 action names, and the last matching rule wins:

```jsonc
"permissions": [
  { "action": "shell", "resource": "*", "effect": "ask" },
  { "action": "shell", "resource": "git status *", "effect": "allow" },
  { "action": "shell", "resource": "git push *", "effect": "deny" }
]
```

### Decision table

The decision model is reachable. `high` means confidence at or above
`JEW_GUARD_MIN_CONFIDENCE` (default `0.5`); `low` means below it.

| your rule | model verdict | confidence | `/soft` | `/yolo` | result |
| --- | --- | --- | --- | --- | --- |
| `allow` | `allow` | high | any | any | runs silently |
| `allow` | `allow` | low | any | any | approval prompt (allow becomes ask) |
| `allow` | `ask` | any | any | any | approval prompt |
| `ask` | `allow` | high | any | off | approval prompt |
| `ask` | `allow` | high | any | on | runs silently |
| `ask` | `allow` | low | any | any | approval prompt |
| `ask` | `ask` | any | any | any | approval prompt |
| `allow` or `ask` | `deny` | any | any | off | blocked (`/soft` has no effect) |
| `allow` or `ask` | `deny` | any | off | on | blocked |
| `allow` or `ask` | `deny` | any | on | on | approval prompt; approving runs |
| read-only or skipped | not judged | — | any | off | your rules decide |
| read-only or skipped | not judged | — | any | on | prompts are auto-approved |

Confidence is independent of `/yolo`: a low-confidence `allow` becomes an
`ask` and prompts. A model `ask` also always prompts, with or without `/yolo`.
For judged tools, `/yolo` only auto-approves a platform `ask` rule when the
model says `allow` with high confidence. Read-only and skipped-tool prompts
are auto-approved. Non-tool checks such as `external_directory` are left to
your rules and are not auto-approved. `/soft` works only together with
`/yolo`; a yolo deny then becomes an approval prompt. Without `/yolo`,
`/soft` does nothing.

The decision model is unreachable:

| your rules | `JEW_GUARD_FAIL_CLOSED` | `/soft` | `/yolo` | result |
| --- | --- | --- | --- | --- |
| `allow` | unset | any | any | runs, like plain opencode |
| `ask` | unset | any | any | approval prompt |
| `allow` or `ask` | set | any | any | blocked |
| read-only or skipped | any | any | off | your rules decide |
| read-only or skipped | any | any | on | prompts are auto-approved |
| `deny` | any | any | any | blocked by opencode |

`/soft` has no effect while the model is down because there is no deny
verdict to downgrade. A narrow configured deny may still be sent to the model
before the platform blocks it.

Configured `deny` is final and does not depend on the model:

| your rule | model | result |
| --- | --- | --- |
| `resource: "*"` | not called | tool is removed and never offered |
| narrower resource | may be called | opencode blocks the call; the guard may block first |

If a third-party plugin tool never calls `permission.assert`, no prompt can be
shown; an `ask` verdict runs without one.

Every non-read-only call is judged, even one your rules allow. The verdict
is reused by the permission prompt, so each guarded tool call normally costs
one decision request. An ambiguous or stale verdict (concurrent Code Mode
calls) asks instead of reusing it. Code Mode nested calls count separately.

## Commands

- `/jew-workspace [name]` — pick the billing workspace (bare opens the picker when there is more than one)
- `/jew-model [id]` — pick a model from the live decision catalog, or switch by id; test-calls first, keeps the old one on failure
- `/yolo on|off` — auto-approve platform prompts when the model confidently allows
- `/soft on|off` — with yolo, deny verdicts become prompts instead of blocks

The agent can't touch any of these — they're human-only by construction.

In the TUI, a bundled TUI part handles the same four commands: results appear
as toasts, and bare `/jew-workspace` and `/jew-model` open selectable lists
(workspaces, and decision models grouped by provider). It calls the server
through an RPC, so the guard state is the same as with the server commands.
Desktop, web, and headless clients keep the server commands, where text can
only surface as a command error.

There is no default model: pick one before the guard can call the endpoint.

## Tuning

| Variable | Default | Effect |
| --- | --- | --- |
| `JEW_GUARD_DENY_SCORE` | `2.5` | risk score that blocks |
| `JEW_GUARD_ASK_SCORE` | `1.5` | risk score that prompts |
| `JEW_GUARD_ASK_P` | `0.75` | approval probability that prompts |
| `JEW_GUARD_INJECT_P` | `0.6` | injection probability that flags output |
| `JEW_GUARD_UNTRUSTED_P` | `0.7` | planted-instruction probability that blocks |
| `JEW_GUARD_USER_P` | `0.85` | user-asked probability that skips the prompt |
| `JEW_GUARD_SKILL_P` / `JEW_GUARD_SKILL_SERIOUS_P` | `0.8` / `0.45` | instruction-file flag thresholds |
| `JEW_GUARD_MIN_CONFIDENCE` | `0.5` | below this, allow becomes ask |
| `JEW_GUARD_MARGIN` | `0.1` | uncertainty band under every threshold |
| `JEW_GUARD_TIMEOUT_MS` | `20000` | total budget per decision call |
| `JEW_GUARD_FAIL_CLOSED` | unset | block when the model is unreachable |
| `JEW_GUARD_SKIP_TOOLS` / `JEW_GUARD_SKIP_SCAN` | unset | comma-separated skip lists |

Out-of-range numbers fall back to defaults. The skip lists use V2 action
names (`shell`, not `bash`). `bin/jew-guard` writes static config for
multi-workspace or OpenRouter-only setups — `jew-guard auth` walks you through it.

## Privacy

Each check sends the tool call (or result) plus recent context — your last
messages, recent calls, excerpts of flagged content — to the configured
decision endpoint over TLS. A guardrail, not a sandbox: keep your other
controls.
