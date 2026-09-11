# wave-3 t2 + t9 evidence — registry redesign, marker prefix fix, `update_task` diagnostics

Task: `t2` (Group A + B, original implementation) and `t9` (repair round 2 from the t7 review).
Scope: `packages/mpd-agent-teams-plugin/lib`, `packages/mpd-agent-teams-plugin/self-fix-tests`,
`packages/mpd-agent-teams-plugin/test`, `scripts/patch-agent-teams-fixes.mjs`,
`scripts/vendor-agent-teams.mjs`, `evidence/wave3/registry-redesign`.

No `--dump-config` result is cited as load evidence anywhere below. The mounted boot in
`check5-mount.raw.json` reads the LIVE tool registry through a registration probe after a settle
window; the heal-fidelity drivers run the real guard on sandbox copies and compare bytes.

## Headline numbers

| Measurement | wave 2 | wave 3 (this evidence) |
|---|---|---|
| `tools.js` strip-heal vs canonical | 60 diff lines, `mpd-delta task-contract` re-inserted at line 1970 | **0 diff lines, byte-identical** (`check4f`, `check4g`) |
| `quality-gates.js` strip-heal vs canonical | 0 diff lines | **0 diff lines, byte-identical** (unchanged, `check4e`, `check4g`) |
| strip BOTH adopted files in one state, one heal | not attempted (the case that defeated every wave-2 attempt) | **0 diff lines for BOTH** (`check4g`) |

Line-number note: canonical `mpd-delta task-contract` now sits at line **1757**, not 1733, because
the wave-3 `update_task` regions were added ABOVE it. The healed file resolves to the SAME line
1757 (`check4g` prints both), which is the property that matters: the region lands at its canonical
position instead of drifting.

## The canon row table (t9 acceptance item 2)

One fixture per row, all in `packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs`.
`orphan` in `findRegion` names the MISSING marker: `"begin"` = the end marker survived,
`"end"` = the begin marker survived.

| Row | Shape | Behaviour (as ruled) | Fixture |
|---|---|---|---|
| R1 | both markers present, `end < begin` | `half-open marker pair` FAIL — the ONLY row allowed to say it | `t9 R1` (inverted `scope-glob`) |
| R2 | begin present + end absent + body byte-equal | re-bracket in place at the surviving marker's indent → byte-identical | `t9 R2` (all three colliding pairs) |
| R3 | begin present + end absent + body DRIFTED | FAIL naming the region AND the begin marker's line, with the remedy | `t9 R3` (drifted body line) |
| R4 | end present + begin absent + body byte-equal | re-bracket in place → byte-identical | `t9 R4` (all three colliding pairs) |
| R5 | end present + begin absent + nothing survived | drop the single orphan end marker line, then heal from context → byte-identical | `t9 R5` |

R3's refusal (both `--check` and `--write`) reads:
`delta "<id>" in <file>: the begin marker at line N has no end marker and the surviving lines are
NOT the registered block — the delta was edited without regenerating lib/mpd-deltas.js; restore the
marked region, or fix it and run: node scripts/patch-agent-teams-fixes.mjs --write-registry`.

Scope of this repair, per t7's binding precision: it closes the ROW and its DIAGNOSIS, **not** a
data-loss path. Measured across ALL 12 regions (driver `check4k`): R3 refuses without writing —
file byte-untouched, exit 1 — in 12/12 regions, and names the region + the begin marker's line +
the remedy in 12/12; R5 drops the orphan line and heals byte-identically in 12/12; and the
precondition for a silent relocation does not exist (0/12 block bodies have a tail equal to their
own `beforeContext`). No claim that the pre-repair code deleted authored text is made here, because
the measurement does not support it.

The drifted-SITE refusals (both `locateSeam` paths) now carry the approved remedy tail:
`— the adopted file drifted; restore the marked file, or re-establish the region's site and
re-run --write-registry — the applier never guesses an insertion site`.

## OLD-format registry guard (t9 acceptance item 1)

`assertRegistryFormat()` refuses a pre-wave-3 registry: every `MPD_DELTAS` entry must carry array
`beforeContext`/`afterContext` and no `anchor`/`anchorOccurrence`/`anchorMarker`, failing with

```
[patch-agent-teams-fixes] FAIL: lib/mpd-deltas.js is in the OLD anchor format — run: node scripts/patch-agent-teams-fixes.mjs --write-registry (one-time migration)
```

and there is deliberately NO fallback to the line-keyed rule. It is called at the TOP of
`applyAgentTeamsFixes` and **not** at module load, because `--write-registry` IS the one-time
migration and needs only `delta.file` from the old registry — a load-time guard would make the
migration impossible. Fixtures: `t9 (A)` (unit, exact message) and `t9 (A): the CLI …`
(child process: `--check`/`--write` exit 1 with the named message and NO bare `TypeError`;
`--write-registry` then exits 0 and `--check` passes afterwards). Driver: `check4j`.

## ADDITIVE vs REPLACEMENT-shaped regions (measured, documented)

Of the three new `update_task` regions, only `update-task-required-attempt-id` is ADDITIVE;
`update-task-contract` and `update-task-required-status-param` are REPLACEMENT-shaped (the upstream
`description:` line and the upstream `status` property were removed and now live inside the region
blocks). Consequence, measured: after a re-materialize those two regions are **not self-healable** —
the upstream twin sits between the recorded `beforeContext` and the after-window, so the pair no
longer brackets the seam and the applier REFUSES before inserting anything (`check4i` class and the
two `t9` replacement fixtures). There is therefore no duplicate-key "last one wins" shape shift and
no silent deletion: the file stays byte-untouched and the operator must restore the marked file or
re-establish the site and re-run `--write-registry`. This is the same class as `scope-glob`'s F3
refusal.

Second, measurement-only confirmation: HEAD `tools.js` (0 mpd markers) has a 2280-line skeleton, the
current file has a 2274-line skeleton — the skeleton SHRANK by exactly 6 lines, and those 6 are the
removed upstream `description:` line plus the 5-line upstream `status` property. A skeleton can only
shrink by deleting upstream text, which only a replacement-shaped adoption does.

Fixtures: `t9: a re-materialized tools.js is REFUSED, byte-untouched, with key counts unchanged`
(full upstream restore) and `t9: the targeted re-materialize shape (upstream twins restored at the
literal) is REFUSED too`.

## Shared-seam coverage

Exactly ONE seam is shared (`quality-gates.js` skeleton seam 149 = `scope-overlap` +
`scope-overlap-normalize`); the three `update_task` seams are distinct (1425 / 1427 / 1518), as are
all others (101 / 155 / 189 / 475 / 483 / 1726 / 2223). Every one of the 12 regions' before/after
windows occurs exactly once in its file's skeleton. Fixture: `t9: all four states of the ONLY shared
seam heal byte-identically` (both present / earlier missing / later missing / both missing).

## Comment checker (C4) — recorded wording, not a verdict

The adopted `lib/**` tree is comment-checker-flagged from upstream materialize; the wave-3 additions
sit inside an already-flagged file. Control: the pre-wave-3 `HEAD` copy of `tools.js` is flagged too
(203 output lines) versus the current file (245 output lines), so there is **no wave-3 regression**.
C4 is an opt-in post-edit hook, not one of AGENTS.md §4's gates.
Tool-usage trap (do not repeat): `mpd_comment_check` must be called with an ABSOLUTE path (or an
explicit `content` string) — a workspace-relative path lands in the un-flagged branch and renders as
`clean`, because the plugin only reads the file when `existsSync(path)` succeeds and its renderer
prints the reason only for flagged results.

## Drivers

All drivers sandbox their work under `/tmp`; the live tree is never modified. `check4e` / `check4f`
are the wave-2 drivers from `evidence/wave2/t8-verification/20260911T061046Z/attempt3/drivers/`
re-run with the SAME measurement logic, and exactly three documented adjustments:

1. the repo-root hop (`evidence/wave3/registry-redesign/<stamp>/drivers` is one level shallower
   than the wave-2 location) — `cd "$(dirname "$0")/../../../../.."`;
2. the evidence destination is parameterised (`EV="${EV_OUT:-…}"`) so nothing is written back into
   the wave-2 evidence directory (this task's inScope is `evidence/wave3/registry-redesign`);
3. `passed` additionally requires `heal_exit == 0 and check_exit == 0` (the wave-2 parser accepted
   `byte-identical-to-canonical=yes` alone, which a missing-file run could satisfy).

`check4g` (new, the decisive case), `check4h` (new, the colliding-pair fixtures), `check4i`
(new, the F3 refusal) and `check4j` (new in t9, the OLD-registry guard + migration) are wave-3
additions. Wave-2 evidence scripts that import the registry
(`evidence/wave2/t10-review/20260911T063000Z/guard-copy.mjs`, `guard-fullstrip.mjs`) are historical
process records and were deliberately left UNPATCHED; they are expected to fail against the new
format.

| Driver | What it proves |
|---|---|
| `check4e-heal-fidelity.sh` | every region stripped from `quality-gates.js` alone, `--write` heal → byte-identical, `--check` clean |
| `check4f-tools-heal-fidelity.sh` | the same for `tools.js` → byte-identical (the wave-2 60-line gap is closed) |
| `check4g-strip-both-heal-fidelity.sh` | **both** adopted files stripped in the SAME state, ONE heal → 0 diff lines for each; prints the healed and canonical `task-contract` line numbers |
| `check4h-marker-prefix-fixtures.sh` | one fixture per colliding pair (`scope-overlap`, `repair-scope`, `task-contract`), both dangling shapes: `--check` exits 1 with a `MISSING from` diagnostic and NEVER the `half-open` wording, `--write` exits 0 and restores the file byte-identically; intact control resolves all three spans to the independently grepped line numbers |
| `check4i-f3-refusal.sh` | a re-materialized upstream `quality-gates.js` is REFUSED (exit 1, redeclaration message) and left untouched — the F3 guarantee |
| `check4j-old-registry-guard.sh` | pre-migration registry: `--check`/`--write` exit 1 with the NAMED migration message and no bare `TypeError`, adopted files untouched; `--write-registry` still migrates (12 entries with the pair, 0 residual old keys) and the migrated tree verifies |
| `check4k-orphan-rows-all-regions.mjs` | the orphan rows across ALL 12 regions: 0/12 body-tail/`beforeContext` collisions (the silent-relocation precondition does not exist), R3 refuses naming region + line + remedy with the file byte-untouched in 12/12, R5 heals byte-identically in 12/12 |
| `check5-mount.sh` | isolated `DSH_HOME` + `HOME` + workspace: install, mounted boot with the registration probe → `AGENT_TEAMS_TOOLS_PRESENT=14/14`, 0 apply-crash signatures, 0 isolation leaks |

All eight drivers report `passed: true` in their `*.raw.json` (check4k prints its own JSON, copied
to `check4k-orphan-rows-all-regions.raw.json`).

## Gates run

| Gate | Result |
|---|---|
| `bun test packages/mpd-agent-teams-plugin` | **116 pass / 0 fail** (`check5-plugin-suite.log`) |
| `bun test packages` | **376 pass / 0 fail** |
| `bun run typecheck` | exit 0 |
| `bun run test:qa` | exit 0, "all self-tests passed" (`test-qa.log`) |
| mounted boot | 14/14 tools, 0 apply-crash signatures, probe DONE, isolation 0/0 (`check5-mount.raw.json`) |
| guard on the real tree | `node scripts/patch-agent-teams-fixes.mjs --check` → all 12 regions applied |
| registry honesty | `--write-registry` is the only writer; re-running it is deterministic |

## Deltas (t2 + t9)

- `scripts/patch-agent-teams-fixes.mjs`: region resolution by whole-line marker comparison;
  registry entries carry `beforeContext` / `afterContext` (computed on the region-stripped
  skeleton, cap k=6, uniqueness required at emit AND heal time); heal inserts verbatim at the
  seam, walking back over already-healed region blocks and honouring registry order for
  same-seam siblings; the five canon rows above; `assertRegistryFormat()` guard; remedy tails on
  both drifted-site refusals; `selectAnchor` / `effectiveInsertionIndent` gone with the line keys;
  `findRegion` and `assertRegistryFormat` exported for the fixtures.
- `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js`: regenerated (`--write-registry`), 12 regions.
- `packages/mpd-agent-teams-plugin/lib/tools.js`: `status` is a REQUIRED parameter of
  `agent_teams_update_task` (`update-task-required-status-param`), the tool description carries the
  field-proven shape (`update-task-contract`), and an OMITTED `attempt_id` is reported as required
  with the actionable recovery (`… then repeat this update with attempt_id="<value>"`) instead of as
  stale ownership (`update-task-required-attempt-id`).
- Tests: `self-fix-tests/registry-context-heal.test.mjs` (21 tests: strip-both byte identity,
  per-file byte fidelity, partial insertion histories, colliding-pair fixtures, the five canon rows,
  the registry-format guard, the shared-seam matrix, the two replacement-shape refusals),
  `self-fix-tests/scope-glob-and-contract.test.mjs` (F4 test rewritten onto the context registry),
  `test/update-task-diagnostics.test.mjs` (6 tests).

## Boundary, stated explicitly

`agent_teams_update_task`'s oversized-payload drop is NOT transport or size handling: the wave-2
measurement showed the raw provider fragment stream is byte-identical to the assembled arguments
and the harness parse is key-lossless, i.e. the trailing key was never emitted (a model-side
omission). The plugin-side guard is therefore a CONTRACT guard — `status` is required at the tool
boundary — plus the `attempt_id` diagnostic. A model-side omission of `output` / `changedPaths` /
`acceptanceResults` / `commandsRun` is not detectable by the plugin and is not claimed to be.

## Restart required

The repaired semantics act only on a NEW dsh process: the adopted plugin module is loaded once per
process and there is no plugin-module hot reload, so a live session keeps the pre-fix
`update_task` diagnostics until dsh is restarted. (The registry guard itself is a build/vendor-time
tool and needs no session.)
