# T5 verification — wave `dsh-022rc2-tui-020`

Verifier seat: `963bd1f8-bb9e-46d1-8870-775694273871`, loop `loop-20261114T025059-3f5ed1`.
Verdict: **FAIL** (recorded blind, before any implementation read), repair `rep-20261114T030829-148045`.
Reviewer's basis: the frozen contract `.mpd/plans/adapt-dsh-022rc2-tui-020.md` (§3, §4, §5, §6, §7b,
§7d), the shipped docs (`docs/compatibility.md`, `docs/tui-admission.md`, `docs/tui.md` §11.15,
`CHANGELOG.md` 0.19.0), the tests and the QA scripts. No implementation diff was read before the verdict.

## Gate results (logs/ holds every transcript)

| Gate | Exit | Result |
|---|---|---|
| `bun run verify:gates` (rc.2 on PATH, `MPD_DSHGO_KIT`, `MPD_DSH_TUI_HOST`=0.20.0) | 1 | 10/11 members PASS; **preset-conformance red** |
| `bun test packages` | 1 | 4158 pass / 6 skip / **4 fail** (watchdog r6 real-engine arms) |
| `bun run typecheck` | 0 | PASS |
| `node scripts/verify-no-host-override.ts` | 0 | PASS |
| `node scripts/verify-manual-paths.ts` | 0 | PASS |
| `node scripts/verify-vendor.ts` | 0 | PASS |
| `node scripts/verify-dist-fresh.ts` | 0 | 35/35 fresh, 1 declared NOT-COVERED |
| `node scripts/verify-dshgo-standard.ts` (`MPD_DSHGO_KIT`) | 0 | LEGAL, five lanes PASS |
| `tui-admission` (inside verify:gates, host 0.20.0) | 0 | 49 arms, 1 allowed deviation, 5 bounds; `H.chain` negotiated both manifests `compatible` |
| `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | 1 | red on rc.2 (persona schema unresolved in the hoisted staging install); also red on rc.1/ambient for the three rc2 rows |

## Mount arms — the decisive finding

`probe/mount-shipped.sh` runs the SHIPPED bundle through the documented one-command flow
(`dsh plugin --profile t5 add <checkout>`) in an isolated `DSH_HOME` + sandbox `HOME` + sandbox cwd.

| Arm | `plugin add` | Cause printed by the harness |
|---|---|---|
| rc.2 (0.2.2-rc.2) | **exit 1 — installation rejected, rolled back** | `@deepseek-ai/dsh-experimental-agent-team@0.2.2-rc.1` (and the tool/ui twins) incompatible with `dsh 0.2.2-rc.2` |
| rc.1 (0.2.2-rc.1) | **exit 1 — installation rejected, rolled back** | `@deepseek-ai/dsh-agent-team@0.2.2-rc.2` (and tool twin) incompatible with `dsh 0.2.2-rc.1` |
| HEAD (0.18.1) on rc.1 — falsifier | exit 0 | installs clean; no rejection line |

Because the install is rejected, the boot after it composes the STOCK profile (97–99 rows, no
`mpd-*` rows, no guard log). Those boots are therefore not evidence about the bundle and are not
claimed as such. The install rejection IS the evidence: the bundle cannot be installed on either
supported host, so neither mount arm can be demonstrated from this tree — a SKIP is never a pass.

Rows 1–2 of the wave's own T1 overlay are a separate story: the SHIPPED `cordis.patch.yml` six-row
guards evaluate CORRECTLY on both arms (`probe/eval-guards3.mjs`, `logs/guard-eval-both.log`):
rc.2 → old three disabled / new three enabled; rc.1 → old three enabled / new three disabled.
T1's overlay composes rows 1–2 differently and reports its two NEW rows disabled on rc.2 — an
ARTEFACT OF T1's `composeTuiAndGeneration`, not of the shipped patch. The shipped patch itself is
sound here; it never gets to run because the install is refused.

## Root cause of the 4 suite failures (post-verdict diagnosis)

`packages/mpd-team-watchdog-plugin/test/tool-inflight.test.ts` (real-engine arms) passes 13/13 on a
`git archive HEAD` export and fails in this tree. The adapter's `teamLiveTeams` now gates the TASK read
on `surface.taskBoard` — `TEAM_TASK_METHODS.every(...)`, i.e. all four of
`createTask/getTask/listTasks/updateTask`. The watchdog fixture (`provideTeamsOn`) exposes the READ
surface only (`tryMembership`/`listMembers`/`listTasks`), so the new predicate classifies it
`taskBoard:false` and the folded view carries `tasks: []`; `readTeams` → `currentTask` → `taskId:null`,
and every downstream assertion (warn, escalate, incident file) fails in turn. HEAD gated on
`typeof listTasks === "function"`, so the same fixture reported its board. This is a task-board path
change, which contract §2b and D6 declare must be unchanged.

## Bounds (not checked, or checked and set aside)

- **Docker real-machine lane — NOT run.** A rootless daemon is present (`docker info` reports
  `name=rootless`), but the lane is the release sweep's LAST step and the verdict was already FAIL.
  Exact command: `bun run verify:docker` (both stamps), per AGENTS §4/§11.
- **Live TTY capture of 0.20.0 — NOT run.** `docs/tui.md` §11.15 and `docs/tui-admission.md` declare it
  as a bound; the 0.20.0 admission NEGOTIATION did run (gate `tui-admission`), so those two docs'
  "not re-run yet" wording is stale (Nit).
- **Service-row ACTIVATION in a session — NOT proven.** With the install refused, no session boot
  exists to observe it; this is the wave's own unproven claim, not a bound of this lane alone.
- **0.2.1-rc.5** — outside this lane's two required arms.
- Declined to judge: the wording of individual row comments, the `README` table rows, and the
  `docker/` pin edits (no arm exercised them).
