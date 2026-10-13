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
   `discussion` never flags). Text under 16 characters is skipped. Flags are
   prepended to the output and remembered in
   per-session memory that feeds the `from_untrusted` question.
4. **Instruction files** (skills, plugins, rules, `AGENTS.md`/`CLAUDE.md`): scanned
   on load via the `jew_workspace`-adjacent path — Choice over `{exfiltration,
   covert_execution, instruction_override, canary, unrelated_side_effects, clean}`;
   serious kinds flag at `p >= 0.45`, `unrelated_side_effects` at `p >= 0.8`.
   Verdicts cached by content hash. Sweep a tree on demand via the exported
   `scanFiles`/`scanInstructionsCached` helpers.
5. **Fail open**: Jev unreachable (or workspace unpicked) → toast + allow,
   unless the OpenRouter fallback answers (see credentials). Set
   `JEV_GUARD_FAIL_CLOSED` to deny instead — it also skips the fallback so a
   failed Jev call always denies. In yolo mode a failed Jev call
   is never an allow (see Yolo mode). One 20 s timeout budget shared
   across retries, same as jev-guard, plus up to 6 s for the fallback.

## Zero-config credentials

No `key` command, no env vars, no secret files. The plugin authenticates with your
existing OpenCode credential at runtime:

- Token: `OPENCODE_CONSOLE_TOKEN` (injected into every opencode session by opencode
  itself; `OPENCODE_API_KEY` also works). Without a Console session — e.g. an
  `opencode-go`-only login — the plugin falls back to the `opencode-go` service
  key in `~/.local/share/opencode/auth.json`; that key is bound to its workspace,
  so no workspace header is used. Nothing else in `auth.json` or `opencode.db`
  is read.
- Endpoint: `POST https://opencode.ai/inference/v1/systemone`, model
  `jev-1.13-free` (verified live 2026-10-12: the paid `jev-1.13` returns
  402 insufficient-funds on workspaces without funds; the free model answers 200
  with calibrated-looking scores). Override with `JEV_MODEL`, `JEV_BASE_URL`
  (any System One server), or `JEV_API_KEY` (direct TypeSafe API).
- Workspace: opencode never tells plugins which Console workspace `/connect`
  chose, so on first use run **`/jev-workspace`** (injected by the plugin, no
  config edit needed) and pick yours: `/jev-workspace <name>` validates and
  saves in one step. Bare `/jev-workspace` lists detected names to eyeball
  against your `/connect` choice.
  Single-workspace accounts skip this. The pick is a non-secret `{org, orgName}`
  pointer in `~/.config/jew-guard/config.json` (`JEV_GUARD_WORKSPACE` env
  still wins over it). Until picked, the guard fails open with a toast
  pointing at `/jev-workspace`.
- OpenRouter fallback: when the Jev call fails (unfunded, rate-limited,
  unreachable) and an OpenRouter key is connected — `OPENROUTER_API_KEY` or
  `auth.json` provider `openrouter` — the same questions go to
  `POST https://openrouter.ai/api/alpha/decisions` with
  `inception/mercury-decide:free` (same typed answers, ~1 s). OpenRouter marks
  this free endpoint as training on prompts, unlike Jev, and its free tier is
  rate-limited: when the quota runs out the guard behaves as if Jev is down
  (yolo blocks, normal mode fails open).
- Model: default is `jev-1.13-free` (`inception/mercury-decide:free` on the
  OpenRouter endpoint). Run **`/jev-model`** to switch (e.g. to paid `jev-1.13`
  if your workspace has funds): `/jev-model <id>` fires one live test call first
  and only saves the pick if Jev answers, so a model you can't bill is rejected
  with the error instead of silently breaking the guard. Stored in
  `config.json`; precedence `JEV_MODEL` env > `config.json` > default.

## Static config (jew-guard CLI)

Zeroconf stays the default. When auto-detection is not enough — a stale Console
login, several workspaces, an OpenRouter-only setup — `bin/jew-guard` writes
`~/.config/jew-guard/config.json`: endpoint, credential *reference*, workspace
and model. The plugin treats a file that names a backend as authoritative;
delete `config.json` to go back to zero-config. Run the CLI from the npm
package (`jew-guard`, needs `nix-shell` on PATH) or from a checkout
(`python3 bin/jew-guard`).

```bash
jew-guard auth                      # interactive: endpoint, credential, workspace, model
jew-guard auth --endpoint opencode --source auth --provider opencode-go
jew-guard auth --endpoint opencode --source db --workspace sucrose
jew-guard auth --endpoint openrouter --source auth
jew-guard auth --endpoint https://kev.local --source key --key ...
jew-guard model                    # effective model + endpoint
jew-guard model ls                 # known models for the endpoint (live list on Console)
jew-guard model set jev-1.13
```

- **Endpoints**: `opencode` (Console gateway), `openrouter` (decisions API), or
  any URL (System One shape). Presets supply the URL and default model.
- **Credentials**: `env` (stores the env var name; the plugin reads it at call
  time), `auth` (stores an `auth.json` provider name like `opencode-go` or
  `openrouter`), `db` (uses the `opencode.db` login to resolve and validate the
  workspace, then stores `keyEnv: OPENCODE_CONSOLE_TOKEN` — the token itself
  stays in `opencode.db`, opencode injects it at runtime), or `key` (prompts,
  stores the key literally, 0600).
- **Workspace**: user tokens need one; the CLI lists Console orgs and validates
  the pick, falling back to the active org in `opencode.db` or a saved pick.
  `oc_sk_…` service keys are workspace-bound, so no workspace is stored.
- Precedence: model pick `JEV_MODEL` env > `config.json` > legacy `model.json` >
  default. Workspace: `JEV_GUARD_WORKSPACE` env > `config.json` > legacy
  `workspace.json` in zeroconf mode; a `config.json` that names a backend pins
  its workspace and URL — `JEV_GUARD_WORKSPACE`, `JEV_BASE_URL` and
  `JEV_API_KEY` are zeroconf-only then. The pinned workspace is not re-checked
  at runtime: after switching Console accounts or orgs, rerun `jew-guard auth`.

Commands never reach the LLM: the `command.execute.before` hook handles
`/jev-workspace`, `/jev-model` and `/yolo` inline and then throws, which stops
opencode's follow-up agent turn before it starts — the thrown message is shown
as the command result. Instant, free, no relay chatter. This also makes guard
mutations human-only by construction: an agent cannot run slash commands, and
the `jew_workspace` / `jew_model` / `jew_yolo` tools are strictly read-only
(status/test), so the agent can never enable yolo, switch models, or move
billing by itself. If the error-styled output bothers you, that throw is one
line in `src/opencode.js` (`done`).

## Yolo mode

`/yolo on` hands the final call to Jev: `permission.ask` maps Jev `allow`
**and** `ask` verdicts to auto-approve, and only `deny` still blocks (plus
fail-closed and injection flags, which always apply). `/yolo off` restores
per-call prompts; bare `/yolo` reports state. Handled inline with zero tool
calls, like the other commands. State is a non-secret flag in
`~/.config/jew-guard/yolo.json` (`JEV_GUARD_YOLO=1` forces it on without a file).

Robustness note: yolo doesn't trust the `permission.ask` hook alone. It also
watches `permission.asked` events and answers them directly through the reply
API (`once` for anything Jev doesn't deny, `reject` on deny) — so even if the
hook ever fails to fire, a yolo dialog auto-resolves instead of sitting until
a human answers. Replies already handled come back 404 and are ignored.

A Jev call that fails (insufficient funds, bad model or workspace, network) is
never treated as an allow in yolo: permission prompts stay standing for the
human and mutating calls are blocked with an error until Jev answers again or
you run `/yolo off` — unless the OpenRouter fallback (see Zero-config
credentials) answers, in which case its verdict is used.
`JEV_GUARD_FAIL_CLOSED` still denies outright.

## Soft mode

`/soft on` downgrades Jev denies to approval prompts instead of blocks — for
OS maintenance and other inherently-privileged work where a deny is usually
wrong but running blind is worse. `ask` still prompts, `allow` still runs.
Yolo and soft compose: natural `ask` verdicts auto-approve (yolo) while denies
prompt (soft always wins for denies — a soft-downgraded deny is never
yolo-collapsed). One wrinkle: `tool.execute.before` has no prompt channel, so
for tools configured to `allow` a soft deny only toasts a warning and runs;
where the tool is set to `"ask"`, `permission.ask` still produces the real
prompt. State lives next to the yolo flag (`JEV_GUARD_SOFT=1` forces it).

## Install

From npm (recommended) — add to `opencode.json` and restart opencode:

```json
{ "plugin": ["jew-guard"] }
```

Or install + register in one step:

```bash
opencode plugin jew-guard
```

From a checkout, symlink a shim instead (requires `@opencode-ai/plugin`
resolvable from your config dir — stock opencode setups already have it):

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
| `JEV_GUARD_WORKSPACE` | unset | workspace id or name; zeroconf mode (skips `/jev-workspace`) |
| `JEV_GUARD_CONFIG_FILE` | `~/.config/jew-guard/config.json` | static config: endpoint, auth, workspace, model |
| `JEV_GUARD_WORKSPACE_FILE` | `~/.config/jew-guard/workspace.json` | legacy workspace pick, read-only fallback |
| `JEV_GUARD_YOLO` | unset | `1` forces yolo mode on |
| `JEV_GUARD_SOFT` | unset | `1` forces soft mode on |
| `JEV_GUARD_YOLO_FILE` | `~/.config/jew-guard/yolo.json` | where yolo/soft state lives |
| `JEV_MODEL` | `jev-1.13-free` | System One model, wins over any pick |
| `JEV_GUARD_MODEL_FILE` | `~/.config/jew-guard/model.json` | legacy model pick, read-only fallback |
| `OPENROUTER_API_KEY` | unset | OpenRouter decisions fallback key |
| `JEV_BASE_URL` | unset | any System One server; zeroconf mode (`config.json` wins) |
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
`src/config.js` (static config.json) · `src/model.js` (model pick) ·
`src/paths.js` (single state dir) ·
`src/yolo.js` (yolo/soft modes + verdict mapping) ·
`src/opencode.js` (the `JewGuard` plugin: hooks + `/jev-workspace` + `/jev-model` + `/yolo` + `/soft` + tools) ·
`bin/jew-guard` (Python CLI for static config).
`npm test` runs the policy unit tests (no network).

The tool call (name, arguments, cwd) or tool result leaves the machine, over
TLS: to Jev at `opencode.ai`, or to the OpenRouter fallback when it answers.
With it goes session context — your last few messages, the assistant's stated
intent, recent call previews, and excerpts of anything flagged as untrusted.
A guardrail, not a sandbox: keep your other controls.
