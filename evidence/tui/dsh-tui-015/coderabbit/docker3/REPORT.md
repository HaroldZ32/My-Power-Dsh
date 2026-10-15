# docker3 — the budget chain around step `16c-owed-cases` (runner ceiling + the doc pair)

Author: Senior Engineer, wave `fix/coderabbit-pr42`. Scope of THIS directory: `docker/lib/owed-cases.ts`
and `docker/README{,.zh-CN}.md`, the only `docker/**` bytes this seat was allowed to touch. The case
side is in `../skills3/`.

No git writes. `docker/entrypoint.sh` was **read** (and `bash -n`-checked) but NOT edited — it is not in
this task's scope; the finding about its comment is below.

## What changed

| Path (symbol) | Before → after |
|---|---|
| `docker/lib/owed-cases.ts` → `LIVE_CASE_TIMEOUT_MS` | `1800000` → **`2400000`** (2400 s), with a doc comment carrying the derivation and the measurements (final file `b614ace22c26899b6bb07670838e38e317c24a447eaf8f73d73d612944ccdfdc`) |
| `docker/README.md` → the step-budget/npm-transport row | the step-16c budget story appended (floor 3600 s, runner ceiling 2400 s, the measurements) |
| `docker/README.zh-CN.md` → the same row | the same story in 简体中文 (both files changed in the same commit-shaped edit; `bun run verify:docs` PASS) |

## Why the ceiling had to rise — the rule, not the mood

A per-case ceiling is the OUTER budget of a case that carries INNER budgets of its own, and **an outer
budget smaller than the inner one it encloses turns the inner one into decoration**: the runner's
SIGTERM decides the verdict before the case's own ceiling can ever be reached.

The binding case is `qa.mcpCall` (`skills/dsh-qa/scripts/mcp-call.ts`):

* it installs the packed artifact **once per arm** under `INSTALL_TIMEOUT_MS` = **1800 s PER INSTALL**;
* it measured **2647 s** for its two arms while each paid a COLD closure install
  (`../skills2/mcp-call-real.log`) — i.e. the OLD 1800 s ceiling here, not the case, decided that run.

**2400 s = ONE install AT the case's own ceiling (1800 s) PLUS one full boot budget (600 s, the case's
own per-arm boot timeout)** — so a lane whose first install is merely slow-but-legal can no longer be
cut by this arm, while a genuinely pathological case is still timed out by the RUNNER with its own row
(instead of consuming step 16c and the other owed cases with it). It stays BELOW the step's 3600 s floor
in `docker/entrypoint.sh`.

The case got cheaper in the same wave (its two arms now share ONE warm npm cache and npm's peer
auto-install is off): **113.1 s** end to end on the FINAL frozen bytes (`lane-final.log`), and
70.8-113.1 s across the FOUR green runs on that route (`../skills3/lane-mirror.log`,
`../skills3/lane-frozen.log`, `../skills3/lane-final.log`), and 1037 s for a single cold closure install on this
host's slow DEFAULT registry (`../skills/install-links-duration.log`), against which the ceiling still
leaves the second arm and both boots room.

## The step-16c sentence (both languages)

The README pair's step-budget row now states, in EN and 简体中文: the step runs the whole owed-case table
under a **3600 s `STEP_TIMEOUT` FLOOR** (`MPD_E2E_STEP_TIMEOUT` still wins when set larger), the
ALL-CASES runner caps each live case at **2400 s**, both numbers were forced by `qa.mcpCall`'s 2647 s
measurement, and the case itself now shares one warm npm cache with npm's peer auto-install off —
naming that auto-install as the boot defect it was (a second harness-core copy + a module-local scope
symbol → the team plugin's agent-scoped `send_message` landing in the global layer).

## Gates run on the frozen bytes (logs in this directory)

| Gate | Command | Observed |
|---|---|---|
| Shell syntax | `bash -n docker/entrypoint.sh` | `BASH_N_EXIT=0` (`bash-n-entrypoint.log`) |
| Docker classification | `node scripts/docker-e2e.ts --self-test` | `[self-test] all arms passed (offline: no docker, no network)`, `EXIT=0` (`docker-e2e-selftest.log`) |
| Doc pair | `bun run verify:docs` | `pairs=47 failed=0 violations=0 … PASS`, `EXIT=0` (`verify-docs.log`) |
| Typecheck (covers `owed-cases.ts`) | `bun run typecheck` | `TYPECHECK_EXIT=0` (`../skills3/typecheck.log`) |
| QA self-tests | `bun run test:qa` | `all self-tests passed`, `EXIT=0` (`../skills3/test-qa.log`) |
| Comments | `bun run verify:comments` | `VERDICT: PASS`, `EXIT=0` (`../skills3/verify-comments.log`) |
| **The real lane** | `node skills/dsh-qa/scripts/mcp-call.ts` | **PASS**, exit 0, **113.1 s** on the final frozen bytes (`lane-final.log`; 70.8-113.1 s across four green runs) |

## Out-of-scope finding (reported, NOT edited)

`docker/entrypoint.sh`'s 16c comment (around its `OWED_CASES_TIMEOUT=3600` block) still cites the OLD
measurement as its justification — "`~1.36x the case's MEASURED wall clock here (44:07 = 2647 s for its
two arms …)`" — and it still says the runner's per-case ceiling "is unchanged" at 1800 s. Both sentences
are now stale: the case measures 113.1 s on the selected route (final frozen bytes; 70.8-113.1 s across four green runs), and the runner's ceiling is 2400 s. The
step's FLOOR itself (3600 s) still holds and is still correct (it must enclose the whole owed-case
table), but its comment needs the same refresh the README row just received. `docker/entrypoint.sh` is
outside this task's declared scope, so it is left byte-untouched.

## Honest bounds

* The ceiling's derivation is an OUTER/INNER argument plus measurements; the in-container lane was NOT
  run here (no rootless Docker on this box for this seat) — `node scripts/docker-e2e.ts --self-test`
  is the offline arm and is what was executed.
* The README pair states numbers measured on the developer host; the container's own timings are what
  step 16c will record when the lane runs there.
