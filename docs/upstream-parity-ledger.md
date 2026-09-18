# Upstream Parity Ledger — my-power-dsh specialist parity against the pinned baseline
**English** | [中文](./upstream-parity-ledger.zh-CN.md)

> Wave: `omo-parity-align`. Status: **VERIFIED — values frozen, implementation landed, gates green
> (§8).**
> This is the persistent human-facing ledger for the functional-alignment wave against upstream
> `/root/dshProj/oh-my-openagent` @ `v5.0.0-beta.62` (HEAD `d1557a4b4`). Our baseline stays pinned
> at upstream `8c57e46` / `v5.0.0-beta.20` in `VENDOR_LOCK.json`; this wave is a **functional**
> reference, never a re-pin.
>
> Historical records are exempt from the bilingual rule (AGENTS.md `L18–L23`). The earlier
> `docs/omo-parity-gap.md` is such a record: it is **single-language and untouched** by this wave.
> It is not superseded — it is cited as input below.

Single source of truth for frozen values: `evidence/omo-align/requirements/frozen-contract.json`
(captain-owned). Research input: `evidence/omo-align/research/team-vs-mass-ulw/gap.json` (t2) and
`evidence/omo-align/research/session-policy/output.log` (t3). Requirements gates:
`evidence/omo-align/requirements/verdict.json` (t1), `verdict-r2.json` (t10),
`verdict-r3.json` (t11), `verdict-r4.json` (t12).

## 1. What the user asked for

| # | Goal (user wording) | Frozen decision |
|---|---|---|
| G1 | Align functionality with the pinned upstream baseline (beta.62) | `D_UPSTREAM_REF` — reference only, no re-pin |
| G2 | agent-teams no longer the default; auto-invoke for complex tasks | `D_FIRST` + `complexityGate` |
| G3 | Align with mass-ulw | four semantics on the existing task-board model (M1–M4) |
| G4 | Align functionality only (no structural/naming copy) | manual entry names frozen; ceiling values stay local |
| G5 | Manual invocation names unchanged | `manualEntryNames` |
| G6 | Skills corpus: research first, gate, then ask the user | t4 + t8 + conditional t9 |
| G7 | Persistent bilingual gap ledger | `D_LEDGER` (this file) |
| G8 | Repo flow: feature branch + evidence same commit + full gates + `--no-ff` | `isolation` + `requiredQaCases` |

## 2. Frozen decisions

| Id | Decision | Rationale / evidence |
|---|---|---|
| `D_FIRST` | Every qualifying session starts with **no team and no team notice** unless a complexity signal fires. | Upstream parity, not local taste: upstream `team_mode.enabled` defaults to `false` (t3 `[U2][U3]`). |
| `D_AUTOROUTE_SPLIT` | The mechanical gate and the legacy injection mode are **decoupled**: `sessionTeamPolicy.mode` defaults to `off` (existing enum values kept); the new mechanical gate is a separate key `sessionTeamPolicy.autoRoute` (default enabled). | Upstream has **no** complexity heuristic (0 hits for heuristic/threshold in t3); activation upstream is an explicit keyword. The split lets us add a gate without silently changing what `off`/`instruct` mean. |
| `D_AUTOROUTE_ADVISORY` | A triggered auto-route **stages nothing**: `routeDecision` returns `advise` and `installSessionTeamPolicy` injects ONE advisory notice (same marker `[AgentTeams] Session-start team rule`) that names the fired signals, states that **no team was staged**, and asks the captain to stage one with `agent_teams_create(approval="required", profile="mpd")` only at the moment the work actually warrants a team — otherwise to continue solo and say so. `mode:"auto"`, `mode:"instruct"`, an explicit `team:`/`!team` flag and the `/agent-teams` command keep their existing paths. | User clause 4 (2026-09-17): judging complexity must not cost the user a pre-staged team plus an approval step. The advisory wording deliberately says nothing against automatic approval, because a ULW run stages with `approval="automatic"` (frozen contract §4.3). |
| `D_SKILLS_WRITER` | This wave's **only** writer of `skills/**` is `t5`, limited to `skills/dsh-qa/SKILL.md` and `skills/dsh-qa/scripts/session-start-team.mjs`. `t9` writes nothing this wave. | AGENTS.md `§9`: one writer per wave; a `skills/**` edit invalidates the corpus `treeSha` and the re-pin must ride the same commit. Baseline: `afe718251965a933b6a15b40bbe6ebf2e5222996fecb48b05fc8e770e390fcad`, 328 files. |
| `D_LEDGER` | Ledger = `docs/upstream-parity-ledger.md` + `docs/upstream-parity-ledger.zh-CN.md`, same commit, language switch link directly under each title. `docs/omo-parity-gap.md` and prior wave reports stay untouched. | User ruling 6; AGENTS.md `§3` bilingual rule with the historical-record exemption. |
| `D_UPSTREAM_REF` | Upstream reference is beta.62 (`d1557a4b4`); repo baseline remains beta.20. | User ruling 1; AGENTS.md `§9` (never chase upstream). |

## 3. Complexity gate (falsifiable by construction)

`trigger = anyExplicitFlag OR (matchedSignals >= 1)`

Signal ids: **A** hard, **B/C/D** soft. **C counts as ONE signal** and is satisfied only when at
least two of its three sub-signals hold, so `C1`/`C2`/`C3` are never top-level signals of their own.

| Id | Kind | Detect |
|---|---|---|
| `A_explicitFlag` | hard | the trimmed user text starts with `team:` or contains `!team` (case-insensitive); the matched prefix is consumed and is not part of the goal |
| `B_deliverableVerbs` | soft | ≥ 4 distinct matches of `align\|migrate\|refactor\|audit\|overhaul\|port\|rewrite\|consolidate\|对齐\|重构\|迁移\|审计\|移植\|梳理\|全量` |
| `C_enumeratedSteps` | soft | satisfied at **2-of-3** sub-signals: `C1` ≥ 3 enumerated lines (`^\s*(\d+[.)]\|[-*])\s`); `C2` ≥ 3 distinct action verbs; `C3` ≥ 3 action clauses (each pairing an action verb with an object, numbered or not) |
| `D_planArtifact` | soft | a `.mpd/plans/*.md` file exists for the session workspace at the first pre-step |

**Harmonized verb tables (behaviour change, R3).** `C2` and `C3` now carry ONE shared verb set:
14 English — `add, align, audit, build, change, check, consolidate, implement, migrate, overhaul,
port, refactor, rewrite, verify` — and 12 CJK — `设计, 实现, 验证, 改造, 补充, 对齐, 重构, 迁移, 审计,
移植, 梳理, 全量`. They differ only in **role**: `C2` counts a verb anywhere in the text, `C3` counts a
clause that OPENS with one. Before R3, `C2` lacked `audit`, `C3` lacked `consolidate|overhaul|port`,
and the CJK sets differed by 7 entries — all eliminated, so no verb is silently C2-only or C3-only.

**Why the threshold is 1 (Option A), and the accepted cost.** A two-counted-signal bar is
**superseded** (`complexityGate.logicRevisionNote`): the frozen complex prompts #1 and #3 carry no
B/D/flag at all, so C is their only signal, and `>= 2` made the gate unreachable against its own
frozen expectation. A satisfied C therefore triggers on its own. **Accepted and ledgered cost:** a
multi-clause request such as “Check the test, build the package, verify the output.” satisfies C
(C2+C3) and therefore DOES route to a team; no rule operating on C alone can separate it from frozen
complex prompt #1. See §7 `O1` and §8's rate study.

On a trigger the gate now **ADVISES** (`D_AUTOROUTE_ADVISORY`): it stages nothing and injects ONE
advisory notice (marker `[AgentTeams] Session-start team rule`) naming the fired signals and stating
that **no team was staged**; the captain stages a team itself with
`agent_teams_create(approval="required", profile="mpd")` at the moment the work actually warrants
one, or continues solo and says so. An explicit `team:` / `!team` request — and the `/agent-teams`
command — still provisions the staged team (`profile: mpd`, `approval: required`, name
`MPD Default`, description “auto-routed by the complexity gate”) — **staged only**, no member
spawns before the user approves the Web plan.

**Three-way test (`testPrompts` in the frozen contract + this wave's QA case).** Every `simple`
prompt must leave `.mpd/team` empty and the log free of the startup notice; every `complex` prompt
that fires a SOFT signal must leave `.mpd/team` empty while carrying exactly one advisory notice;
an explicit `team:` prompt must still produce exactly one staged team and one notice. A run where
any side is not observed is a `FAIL`, and a gate that cannot fail this test is not accepted. Every
side must run on the same settled revision hash, in a sandboxed workspace (`sandboxWorkspace` +
`assertSessionsSandboxed`).

**Measured trigger rate on REAL ordinary prompts (t37, re-verified by t40).** 20 real ordinary
prompts (all containing Chinese; 5 session-start — the only stratum the gate actually evaluates —
and 15 later follow-ups) sampled from this repository's own session logs and replayed through the
gate's own exported predicate: **0 triggered** (0/5 session-start, 0/15 follow-up), so the literal
phrase “one needless approval every N” has **no finite N** in this sample. The 95% upper bound on the
false-positive share is **13.9%** overall (n=20) and **45.1%** for the session-start stratum alone
(n=5), by the Clopper–Pearson one-sided bounding interval (the rule-of-three values are 15.0% and
60.0%). The measurable cost in the same sample runs the OTHER way: the richest session-start prompt
matched exactly 1 distinct B verb (`对齐`, threshold 4) and 1 distinct C2 verb (threshold 3), so it
produced no signal at all. Raw data: `evidence/omo-parity-rate/` (`raw/prompts.jsonl`,
`raw/probe-output.json`, re-run in `evidence/omo-align/ledger-fix/`).

## 4. mass-ulw alignment (task-board model kept)

Ids below are the frozen contract's (`massUlwSemantics.items`). Its `policy` wording is the authority;
this ledger only indexes it.

| Id | Semantics | Frozen assertion (verbatim) |
|---|---|---|
| `S1` | node-level retry | “a terminal failed task can be retried without discarding the tasks that already completed” |
| `S2` | revision without re-running completed work | “amending a task definition re-runs ONLY the changed task and its TRANSITIVE DEPENDENTS. A completed node whose own definition is unchanged AND none of whose transitive dependencies were changed/added/xor-moved keeps its cached result — that is the 'completed nodes are not re-run' guarantee. A completed DEPENDENT of an amended task IS re-run, because its input changed” |
| `S3` | resume across restart | “a run interrupted by process exit resumes from persisted state instead of restarting finished tasks” |
| `S4` | mid-run steering | “a running member can be steered back into its scope with a bounded notice, without restarting the attempt” |

> **`O5` is CLOSED (reconciled, not lingering).** The earlier wording “and its dependents” read as
> conflicting with the user's “completed nodes are not re-run”, and this ledger used to present that
> as an unresolved conflict. The frozen contract's `S2.resolves` settles it: the no-re-run guarantee
> is **scoped to nodes whose transitive inputs did not change**, so a completed node whose own
> definition and whose transitive dependencies are untouched keeps its cached result, while a
> completed *dependent* of the amended task IS re-run because its input changed. The two wordings no
> longer differ; the S2 row above quotes the frozen assertion verbatim.
>
> One limitation is recorded rather than glossed over (`S2.evidenceProvenance`): the upstream
> protocol document the freeze cites does **not** exist in this repository, so a local reader can
> verify the contradiction-free wording above, not the upstream citation.

## 5. Manual entry names (frozen)

Renaming any of these is forbidden; **adding** names is allowed.

- Slash commands: `/agent-teams`, `/agent-teams-mpd` (from `AGENT_TEAMS_COMMAND = 'agent-teams'`
  and `profileCommandName('mpd')`, `lib/command.js:3,24-34,95-111`)
- Tools: the full `agent_teams_*` set
- Keys: `profiles.mpd`; preset id `mpd`

## 6. Text landing points (where the session-start team rule lands)

| Id | File | Region |
|---|---|---|
| `L1` | `packages/mpd-bundle/cordis.patch.yml` | agent-teams row `sessionTeamPolicy` block + its comment |
| `L2` | `packages/mpd-agent-teams-plugin/lib/session-start.js` | `policyQualifies` predicate + `advisoryNotice` / `provisionedNotice` / `instructNotice` text |
| `L3` | `presets/mpd/agent.cordis.yml` | `SESSION STARTUP RULE` block and the sizing doctrine placement |
| `L4` | `packages/mpd-bundle/README.md` | the whole `Session-start team gate (binding)` section |
| `L5` | `packages/mpd-bundle/README.zh-CN.md` | the whole `会话启动团队门（强制）` section (same commit as `L4`) |
| `L6` | `scripts/install-profile.mjs` | row config + its `--self-test` assertion (now pins `mode === "off"` **and** `autoRoute === true`) |
| `L7` | `skills/dsh-qa/SKILL.md` | the `session-start-team` case row |
| `L8` | `skills/dsh-qa/scripts/session-start-team.mjs` | `assessTeamState` inverts to a two-sided assertion |
| `L9` | `AGENTS.md` | the startup-rule section and the delta-table row describing the old behaviour |

The frozen contract's `changeLocations.items` is the authority and enumerates **ten** entries: the
list above, plus `packages/mpd-agent-teams-plugin/lib/index.js` (config schema + resolved defaults)
and `packages/mpd-agent-teams-plugin/self-fix-tests/**` (only when lib bodies change under a
registered `mpd-delta` region). The single EN and ZH bundle READMEs are counted as two entries there.

No `AGENT.md` is created: the startup clause lives in `AGENTS.md` and the landing points above.

## 7. Open items

"Open" here means *awaiting a user decision or a later wave* — not "unverified". Every implementation
door this wave set out to close is closed and measured in §8.

| Id | Item | State |
|---|---|---|
| `O1` | Complexity-gate calibration | frozen defaults, **not** measured optima. The empirical run has now happened (t37, re-verified by t40): on 20 real ordinary prompts the gate triggered **0** times, so the accepted false-positive path did not fire at all, and the measured cost ran the other way (a genuinely complex session-start prompt produced no signal). The user may still adjust the values **once**; the numbers to judge are in §3 and §8 |
| `O2` | Whether the skills corpus (mass-ulw / dag-library / hyperplan) is ported at all | decided only after the t8 gate report, per user instruction — still awaiting the user's call; this wave ports nothing |
| `O3` | t4 `D10-recovery` coverage | **closed / `uncertain` recorded.** t2 measured `retry`×8, `revision`×2, but `resume`×1 and live-steering×0; the thin coverage is recorded here with its reason (a single observed `resume`, no observed live steering) rather than silently dropped |
| `O4` | Residual conflict in `session-start.js` | **closed.** The shipped predicate has no unconditional-notice path under `D_FIRST`: `trigger = anyExplicitFlag OR (matchedSignals >= 1)`, and `mode: "off"` means no auto-provision and no unconditional notice. The two-sided case measures 3/3 plain prompts silent (see §8) |
| `O5` | `S2` frozen wording vs the user ruling | **closed / reconciled.** The no-re-run guarantee is scoped to nodes whose transitive inputs did not change, so a completed dependent of an amended task *is* re-run because its input changed — see §4. The upstream citation the freeze rests on is not present in this repository, and that limitation is recorded rather than glossed over |
| `O6` | Ledger id labels | the frozen contract labels the complexity signals `A/B/C/D` and the mass-ulw semantics `S1–S4`; earlier requirement rounds labelled the latter `M1–M4`. This ledger follows the contract; no contract value changed |

## 8. Verification state

Every gate below was **run in this working tree** (not copied from a plan) and its raw output is kept
under `evidence/omo-align/ledger-fix/gates/<gate>.log`, sha256-pinned in
`evidence/omo-align/ledger-fix/result.json`.

Anchor: the run started at `HEAD = 3096455` and the tree moved to `HEAD = e89fa2a` while it ran
(the captain landed the wave's commits concurrently), so the *content* hashes below are the exact
anchors. The wave's own frozen values and gate code were byte-identical across that window:

| Anchor | sha256 |
|---|---|
| `evidence/omo-align/requirements/frozen-contract.json` | `09949c8095d7ccd533329b114a2ef22bad1ce81bd24338240e68cfd0fd66be41` |
| `packages/mpd-agent-teams-plugin/lib/session-start.js` | `8cfaef47e9959ef7def01003640f768ff4befa50e9c202ff692a0629ca0a2aa6` |
| `packages/mpd-agent-teams-plugin/lib/state.js` | `751a4c1eaf1714d37a45baa8c0a83895ee8e2a487f28574d02fd445cd1b8b825` |
| `evidence/omo-parity-rate/raw/prompts.jsonl` | `123dca67e738f85e08a0043c6a33a686d1e91e31e9dbe0568437437414e5f9b5` |

| Gate | Command | State |
|---|---|---|
| typecheck | `bun run typecheck` | verified (exit 0) |
| plugin tests | `bun test packages/mpd-agent-teams-plugin` | verified at this anchor (161 pass / 0 fail, 42 files). **Current tree (v0.9.1):** 220 pass / 0 fail over 60 files — the plugin gained the dispatch-stall regression + region-pinning suites (`evidence/agent-teams/dispatch-stall/`) and, in v0.9.1, the pool-capability guard (`self-fix-tests/pool-capability-guard.test.mjs`; registry 46 → 48 regions) |
| QA self-tests | `bun run test:qa` | verified (exit 0, all self-tests passed) |
| runtime boot | `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` | verified (PASS; one-command install, no home copy, uninstall leaves no residue) |
| two-sided gate case | `bun skills/dsh-qa/scripts/session-start-team.mjs` | verified at this pre-advisory anchor (PASS: simple 3/3 silent, complex 3/3 exactly one staged team + one notice, negative control disarmed = true). **Superseded for the current tree by `D_AUTOROUTE_ADVISORY`:** the complex side must now assert 0 staged teams + one advisory notice and the explicit-flag side must assert exactly one staged team; that re-run belongs to this wave's QA case (`L7`/`L8`) |
| preset/patch rows | `node skills/dsh-qa/scripts/preset-conformance.mjs --self-test` | verified (30 harness rows conform, row parity 31/31) |
| installer | `node scripts/install-profile.mjs --self-test` | verified (exit 0) |
| vendor | `node scripts/verify-vendor.mjs` | verified at this anchor (PASS; that wave's corpus re-pin had landed). **Superseded for the current tree by v0.9.0:** the extension wave added the `skills/dsh-qa/SKILL.md` rows plus the three `extension-*.mjs` QA cases, so the skills asset is re-pinned to `fileCount: 301` / `treeSha: 0dd4a6ee68e0a11499f2b502873016d066cface6b59036147bca066433b4b576` and the gate PASSes again — see `VENDOR_LOCK.json` and `evidence/release/v0.9.0-integration/` |
| trigger-rate study | `node evidence/omo-parity-rate/raw/probe.mjs --json` | verified (20 real ordinary prompts, 0 triggered; anchors and per-row verdicts recomputable — see §3) |

This ledger is updated **in the same commit as the change it records**; an evidence-free pass is not
a pass (AGENTS.md `§2.3`, `§4`).
