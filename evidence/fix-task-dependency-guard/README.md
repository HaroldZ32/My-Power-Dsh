# fix/task-dependency-guard — evidence index

Wave: the captain omitted `blocked_by` when assigning team work, so tasks that had to be serialized ran
in parallel. This directory keeps the reproducible record; code lives on branch
`fix/task-dependency-guard`.

## 1. Reproduction, BEFORE the fix (`evidence/repro-missing-blocked-by/`)

| probe | what it measured | verdict |
|---|---|---|
| `probe-1-claim-blocked.ts` + `.log` | `agent_teams_task {action:"claim"}` on `T2` while its declared blocker `T1` was still `pending` | **DEFECT REPRODUCED** — claim succeeded, `T2` became `in_progress` with `startedAt`; `agent_teams_dispatch` refused the very same pairing ("not ready (blocked by T1)") |
| `probe-2-no-edges.ts` + `.log` | three tasks (requirement / work / review) created with NO dependency declaration, then dispatched | **DEFECT REPRODUCED** — all three independently ready, all three paired in one pass, approval silent about dependencies |

Baseline suite before any change: `packages/mpd-team-core-plugin` `bun test` = **295 pass / 0 fail / 0 skip**.

## 2. Red-first record (R1–R14; R11 and R14 are Amendment 1 and Amendment 2)

| rule | arm(s) | red against the pre-fix code | green after |
|---|---|---|---|
| R1 (a–f) dependency answer at `create_task` | 6 arms | 6 failing (`expect(...).toBeDefined()` → undefined) | pass |
| R1 live (mid-run `create_task`) | 1 arm | failing | pass |
| R2 overlapping write scopes at `approve` | 2 arms | failing | pass |
| R3 readiness gate on `claim` | 1 arm | failing | pass |
| R11 `approve` re-validates the whole plan graph | 3 arms (unanswered / self-edge / cycle) | all 3 failed — R11 unanswered-task arm, R11 self-edge arm, R11 cycle arm (`task-dependency-guard.test.ts`) | pass |
| R5 (R10's behaviour untouched) positive controls — empty shell with its exact sentence, single task, triple, OPT-1, dangling-WARN | 10+ arms | pass by design (they redden only on over-refusal) | pass |
| R14 (Amendment 2) multi-hop path + segment boundary, both directions | 3 arms | **not red by construction** — the behaviour they pin already existed (`dependencyPath` is transitive reachability; `scopesOverlap` anchors at a segment boundary), so these are green-time coverage arms and are declared as such | pass |

Red recipe actually run by the implementing writer:
`rm -rf /tmp/red && cp -r packages /tmp/red/packages && git show HEAD:packages/mpd-team-core-plugin/src/index.ts > /tmp/red/packages/mpd-team-core-plugin/src/index.ts && (cd /tmp/red/packages/mpd-team-core-plugin && bun test test/task-dependency-guard.test.ts)`
→ **10 pass / 10 fail** for R1–R5; **21 pass / 3 fail** for the R11 arms.

## 3. Suites after the fix

- `cd packages/mpd-team-core-plugin && bun test` → **322 pass / 0 fail / 1514 expect() / 21 files**
  (baseline 295; +27 arms across the wave)
- `bun test packages` (root) → **2408 pass / 3 skip / 0 fail / 2411 tests / 144 files**
- `bun run typecheck` → exit 0 · `bun run verify:comments` → PASS (439 files, 39502 declarations)

## 4. Where the rules are written down

Frozen contract: `.mpd/plans/task-dependency-guard.md` (R1–R12 plus Amendment 2's R13–R15, both
amendments disclosed in the file).
Documentation updated by the docs writers: `AGENTS.md` §5 rules 3 and 5, §7 T-88, §12 pointer;
`agent-references/troubleshooting.md`, `agent-references/qa-discipline.md`;
`packages/mpd-team-core-plugin/README{,.zh-CN}.md`; `packages/mpd-ulw-plugin/README{,.zh-CN}.md`;
`packages/mpd-roles-plugin/personas/atlas.md` (the assigning role);
`docs/user-guide{,.zh-CN}.md` (the copy-paste example carries the dependency answer).

## 5. Declared bounds

- ~~The official plane (`spawn_teammate` + `team_task_create`) is NOT gated by mpd; the rule there is
  manual and is documented as such (R7).~~ **SUPERSEDED by the team-door wave (2026-10-23/24, contract
  Amendment 3 / R16–R18).** The official plane IS gated at the TOOL boundary now — see §9.
- `evidence/merge-20261022/` is pre-existing and unrelated to this wave.

## 6. QA real case — runner note (measured 2026-10-23)

`node skills/dsh-qa/scripts/team-dispatch-guard.ts` FAILS with
`ERR_MODULE_NOT_FOUND: .../mpd-dsh-adapter-plugin/src/index imported from .../mpd-team-core-plugin/src/index.ts`.
That is a **pre-existing runner mismatch, not a regression of this wave**: the case's own shebang and
usage block say `bun`, `scripts/run-qa-selftests.ts` spawns `bun`, and `bun run test:qa` runs it green
(17 arms). `packages/*/src` is allowed extensionless specifiers (AGENTS.md §6), so plain `node` cannot
load that module graph at all. The OPPOSITE holds for `preset-conformance`: its REAL mount fails under
bun (`error: bun is unable to write files to tempdir: EROFS`) and passes under `node`. AGENTS.md §4 now
states exactly that split — the QA-real-cases row is `bun` with the module-graph reason, the Boot-check
row is `node` for `preset-conformance`, and §11 keeps `node` for its self-test.

## 7. Gate logs in this directory

| log | what it holds |
|---|---|
| `gates.log` | first full sweep (before the repair round): 12 commands, `qa-team-guard=1` under `node` plus the trace, everything else 0 |
| `gates-postrepair.log` | after R13/R14: `preset-conformance=1` under `bun` with `EROFS`, everything else 0 |
| `gates-final2.log` | after the runner correction: **12/12 exit 0**, including `node …/preset-conformance.ts` and `bun …/team-dispatch-guard.ts` |

## 8. Independent verdicts

| loop | verdict | record |
|---|---|---|
| `loop-20261023T093358-1bb644` | **PASS** (risk LOW–MEDIUM) — R1–R12, 8 non-blocking findings | `rec-20261023T095022-1d01d1` |
| `loop-20261023T095953-f21edc` | **PASS** (risk LOW) — Amendment 2 (R13/R14/R15) + the runner correction; 6 of the 8 findings closed, 1 partial, 1 remaining | `rec-20261023T101738-ee2535` |

Both records live under `.mpd/verify/records/` (gitignored by `.mpd/`); the numbers and the cited
evidence ids are reproduced above and in the `gates-*.log` files.

## 9. Remaining, declared

- No captured RED console (only the counts above) — the recipe is given so it can be re-run.
- `evidence/dsh-qa/team-dispatch-guard/` historical directories (2026-10-14 and the three earlier
  2026-10-23 runs) ship `result.json` only; the declared `{result.json, output.log}` pair exists from
  `2026-10-23T10-19-01-361Z` onward.
- `evidence/merge-20261022/` is pre-existing and unrelated to this wave.

## 10. The team door — one front door (2026-10-23/24, Amendment 3 / R16–R18)

A `tools.guard` in `packages/mpd-team-core-plugin/src/team-door-guard.ts` REFUSES `spawn_teammate`,
`team_task_create`, `team_task_list`, `team_task_get`, `team_task_update` by whole name, with a
one-paragraph refusal naming the mpd RECORD, the three guarantees the official board lacks, and the
replacement verbs. Everything else — every doc, README twin, persona, skill and the QA contract — now
names `agent_teams_plan` / `agent_teams_task` / `agent_teams_dispatch` as the only door.

**The set was narrowed from "all nine official tools" for a MEASURED reason.** `send_message`,
`list_agents`, `wait_agent` and `interrupt_agent` are ALSO base global harness rows, mounted by this bundle's own preset
(`presets/mpd.patch.yml`), and the harness appends a "call `send_message`" instruction to every continuable
child's prompt (`dsh-subagent`). A name-based guard cannot tell the base row from the official one, so
denying them would refuse our own plumbing, and `interrupt_agent` is the only model-facing single-agent
stop. Those four (`send_message`, `list_agents`, `wait_agent`, `interrupt_agent`) stay; result delivery never depended on them (the harness's `notifySettlement` injects a
child's closing text and structured result into the parent).

Scope decision (R18): the door denies for EVERY agent and has NO preset bypass — deliberately unlike the
delegation gate. Its subject is a WORKSPACE-scoped record (one board per workspace), and the repo's own
T-92 measurement is that the deployment's top-level session carries `agentPreset:"cordis"`, so a
preset-keyed release would no-op the door exactly where it must bind.

**The declared bound (R17):** the closure is at the TOOL boundary. A ROW that calls the team SERVICE
directly (the official-executor fallback) is not a tool call and is NOT gated. No live-harness boot proves
a refusal is surfaced to a model either — the evidence is unit/registration level plus the `tools.guard`
precedent already used by five rows.

## 11. Gate logs in this wave's tail

| log | what it holds |
|---|---|
| `gates-teamdoor.log` | first sweep after the guard: `vendor=1` (the `client.js` fingerprint) and `verify:gates=1`; everything else 0 |
| `gates-teamdoor2.log` | after the fingerprint pin: 14/14 exit 0 |
| `gates-teamdoor3.log` | after the FAIL repairs + the wave's final single skills re-pin: **16/16 exit 0** |

`client.js`'s fingerprint (`0bd4c94…` → `f636bb8…`) changed because its SOURCE changed; the build was
proved deterministic first (three consecutive builds, identical sha256), and only that artifact's pin was
updated — `repin-vendor` lists build artifacts as POLICY (never rewritten) while `verify-vendor` enforces
them, so this one is a captain step, as the repo's own history shows.
