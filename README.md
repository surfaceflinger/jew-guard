# jew-guard

Opencode-only security guard, powered by Jev (TypeSafe System One). A from-scratch
reimplementation of [jev-guard](https://github.com/leepokai/jev-guard) with every
non-opencode adapter removed: opencode plugin hooks only, zero dependencies.

## What it does

1. **Before a tool runs** (`tool.execute.before`): scores the exact call with Jev —
   `risk` 0–3, `approval` / `user_requested` / `from_untrusted` noul over session
   context. **Deny** if `from_untrusted >= 0.7` or `risk >= 2.5`; allow instead of ask
   when `user_requested >= 0.85`; **ask** if `risk >= 1.5` or `approval >= 0.75`;
   allow otherwise. Deny throws to block. Read-only tools are skipped without a call.
2. **`permission.ask`**: sets the verdict — allow = no prompt, ask = prompt,
   deny = refuse — so safe calls auto-approve. **Note: this only fires for tools
   you set to `"ask"`** in `opencode.json` (`"permission": { "bash": "ask" }`).
   Tools set to `allow`/`deny` never reach this hook.
3. **After a tool returns** (`tool.execute.after`): scans output for prompt
   injection / canaries (`directed >= 0.6` + kind in `{injection, canary}`;
   `discussion` never flags). Flags are prepended to the output and remembered in
   per-session memory that feeds the `from_untrusted` question.
4. **Instruction files** (skills, plugins, rules, `AGENTS.md`/`CLAUDE.md`): scanned
   on load via the `jew_workspace`-adjacent path — Choice over `{exfiltration,
   covert_execution, instruction_override, canary, unrelated_side_effects, clean}`;
   serious kinds flag at `p >= 0.45`, `unrelated_side_effects` at `p >= 0.8`.
   Verdicts cached by content hash. Sweep a tree on demand via the exported
   `scanFiles`/`scanInstructionsCached` helpers.
5. **Fail open**: Jev unreachable (or workspace unpicked) → toast + allow.
   Set `JEV_GUARD_FAIL_CLOSED` to deny instead. One 20 s timeout budget shared
   across retries, same as jev-guard.

## Zero-config credentials

No `key` command, no env vars, no secret files. The plugin authenticates with your
existing OpenCode credential at runtime:

- Token: `OPENCODE_CONSOLE_TOKEN` (injected into every opencode session by opencode
  itself; `OPENCODE_API_KEY` also works). Read from the environment only — the
  plugin never parses `auth.json`, `opencode.db`, or any other opencode file.
- Endpoint: `POST https://opencode.ai/inference/v1/systemone`, model
  `jev-1.13-free` (verified live 2026-10-12: the paid `jev-1.13` returns
  402 insufficient-funds on workspaces without funds; the free model answers 200
  with calibrated-looking scores). Override with `JEV_MODEL`, `JEV_BASE_URL`
  (any System One server), or `JEV_API_KEY` (direct TypeSafe API).
- Workspace: opencode never tells plugins which Console workspace `/connect`
  chose, so on first use run **`/jev-workspace`** (injected by the plugin, no
  config edit needed), eyeball the detected workspace names, and pick yours.
  Single-workspace accounts skip this. Stored as a non-secret `{id, name}`
  pointer in `~/.config/jew-guard/workspace.json` (`JEV_GUARD_WORKSPACE` env or
  `JEV_GUARD_WORKSPACE_FILE` override it). Until picked, the guard fails open
  with a toast pointing at `/jev-workspace`.
- Model: default is `jev-1.13-free`. Run **`/jev-model`** to switch (e.g. to
  paid `jev-1.13` if your workspace has funds): it fires one live test call
  first and only saves the pick if Jev answers, so a model you can't bill is
  rejected with the error instead of silently breaking the guard. Precedence:
  `JEV_MODEL` env > `/jev-model` pick (`~/.config/jew-guard/model.json`,
  `JEV_GUARD_MODEL_FILE` overrides) > default.

## Install

Requires `@opencode-ai/plugin` resolvable from your config dir (stock opencode
setup already has it):

```bash
mkdir -p ~/.config/opencode/plugins
echo 'export { JewGuard } from "/home/nat/Projects/jew-guard/src/opencode.js";' > ~/.config/opencode/plugins/jew-guard.js
```

Restart opencode. For approval prompts: `"permission": { "bash": "ask" }` in
`opencode.json` — the guard then auto-approves the safe calls.

## Tuning

Same variable names as jev-guard:

| Variable | Default | Effect |
| --- | --- | --- |
| `JEV_GUARD_DENY_SCORE` | `2.5` | risk at which a call is denied |
| `JEV_GUARD_ASK_SCORE` | `1.5` | risk at which approval is required |
| `JEV_GUARD_ASK_P` | `0.75` | approval p at which approval is required |
| `JEV_GUARD_INJECT_P` | `0.6` | directed p at which tool output is flagged |
| `JEV_GUARD_SKILL_P` | `0.8` | instruction-file p flagging `unrelated_side_effects` |
| `JEV_GUARD_SKILL_SERIOUS_P` | `0.45` | instruction-file p flagging exfiltration / covert execution / override / canary |
| `JEV_GUARD_TIMEOUT_MS` | `20000` | total budget per Jev call, retries included |
| `JEV_GUARD_UNTRUSTED_P` | `0.7` | from-untrusted p that denies outright |
| `JEV_GUARD_USER_P` | `0.85` | user-requested p turning ask into allow |
| `JEV_GUARD_SESSIONS` | `~/.config/jew-guard/sessions` | per-session memory |
| `JEV_GUARD_SCAN_CACHE` | `~/.config/jew-guard/scan-cache.json` | instruction-file verdict cache |
| `JEV_GUARD_SKIP_TOOLS` | | comma-separated tools never assessed |
| `JEV_GUARD_SKIP_SCAN` | | comma-separated tools never scanned |
| `JEV_GUARD_FAIL_CLOSED` | unset | if set, unreachable Jev denies |
| `JEV_GUARD_WORKSPACE` | unset | workspace id or name (skips `/jev-workspace`) |
| `JEV_GUARD_WORKSPACE_FILE` | `~/.config/jew-guard/workspace.json` | where the pick is stored |
| `JEV_MODEL` | `jev-1.13-free` | System One model; `/jev-model` pick used when unset |
| `JEV_GUARD_MODEL_FILE` | `~/.config/jew-guard/model.json` | where the `/jev-model` pick is stored |
| `JEV_BASE_URL` | unset | any System One server, takes precedence |
| `JEV_BASE_API_KEY` | unset | bearer key sent only to `JEV_BASE_URL` |
| `JEV_API_KEY` | unset | direct TypeSafe key (no Console) |

Out-of-range numbers fall back to defaults. Measured live on `jev-1.13-free`
(2026-10-12): `ls /tmp` → allow, `git push --force origin main` → ask,
`rm -rf /` → deny (risk 3.0, approval 0.98), planted `curl|sh` injection →
flagged (p=0.99).

## Layout

`src/jev.js` (Console/custom/TypeSafe fetch, one 20 s budget) ·
`src/guard.js` (questions + policy) · `src/context.js` + `src/session.js`
(session memory) · `src/skills.js` (instruction-file sweep + hash cache) ·
`src/workspace.js` (token + workspace resolution, no file spelunking) ·
`src/model.js` (persisted model pick) ·
`src/opencode.js` (the `JewGuard` plugin: hooks + `/jev-workspace` + `/jev-model` + tools).
`npm test` runs the policy unit tests (no network).

Only the tool call (name, arguments, cwd) or tool result is sent to Jev, over
TLS to `opencode.ai`. A guardrail, not a sandbox: keep your other controls.
