# t14 — F4 repair: the clean heal is now byte-faithful

Repairs the single item that failed t8 attempt 2. F1, F2 and F3 are untouched (t8 declared them
genuinely closed) and are re-verified as non-regressed below.

> **A `dsh` restart is still required for the repaired semantics to act on a live session.**
> This harness has no module hot reload: the running plugin keeps the pre-repair
> `validateCreateTask`/matcher until the process restarts. Every claim here is proven by direct
> module import, by the guard CLI, or by the isolated mounted boot (which proves registration, not
> the new semantics).

## F4 — root cause and fix

**Measured defect:** `mpd-delta create-contract-gate` was registered with an **8-space** block and
a **4-space** anchor (`    if (kind === 'review') {`). The applier inserted at the ANCHOR's indent,
so a healed `quality-gates.js` placed the create-time gate OUTSIDE `if (WRITE_KINDS.includes(kind))`
— the module still imported and still refused contradictions, so the misplacement was silent and
the healed tree differed from the canonical adoption by 22 diff lines.

**Why it could happen at all (the class):** an insert-before-anchor applier can only reproduce a
position when the anchor's indent matches the block's canonical indent. Every post-region line at
that position in the canonical file was either region-internal or repeated, so the heuristic walked
forward to the next *unique* line — which sat in a different scope.

**Two fixes, both halves of the verifier's recipe:**

1. **Structural (this instance):** the `create-contract-gate` region now wraps the WHOLE
   `if (WRITE_KINDS.includes(kind)) { … }` block, so the region is self-anchoring: block indent 4
   = anchor indent 4, and an insert reproduces the canonical position exactly. The gate can no
   longer land outside the block it belongs to.
2. **Class guard:** `effectiveInsertionIndent(delta, anchor)` returns the block's canonical indent
   whenever the anchor would place it shallower, and the applier reports every correction
   (`corrected[]` in the API result, `(indent corrected: …)` in the CLI) so a correction is never
   silent. `canonicalIndent(delta)` is exported for tests.

Additionally the registry now records `anchorMarker` (the first eligible line AFTER a region) and
resolves an insertion point by context instead of a blind occurrence index, so a repeated
structural anchor (`    }));` occurs 14 times in `tools.js`) is addressed deterministically. The
region anchors were also regenerated so no anchor lives inside another region.

## Acceptance evidence (raw in `f4/byte-fidelity.log`)

| measurement | result |
|---|---|
| regions stripped from our `packages/mpd-agent-teams-plugin/lib/quality-gates.js` | 7 |
| `--write` | applied, 7 regions inserted, 0 indent corrections |
| next `--check` | `already-applied`, exit 0 |
| **`readFileSync(healed) === readFileSync(canonical)`** | **true (byte-for-byte)** — the 22-diff-line divergence is gone |
| gate lands INSIDE `if (WRITE_KINDS.includes(kind)) {` | true |
| `create-contract-gate` anchor indent vs block indent | `"    "` vs `"    "` (equal — the F4 shape is impossible) |
| indent guard on a deliberately misindented fixture (8-space block / 4-space anchor) | `{indent: "        ", correctedFrom: "    "}` — the shallower placement is corrected and reported |

The byte-fidelity assertion is now a permanent test (`F4: stripping every region and healing
reproduces the canonical file byte-for-byte`) alongside two more: the anchor-indent check and the
misindented-fixture guard observation (`gates/self-fix-suite.log`).

## F1 / F2 / F3 non-regression (the verifier's own drivers, re-run)

| driver | result |
|---|---|
| `check1-glob` (F2's matcher) | 13/13 cases pass, `post-fix (mpd-delta scope-glob present)` — `drivers/check1-glob.post-f4.json` |
| `check2-contract` (F1) | `demandedButNotInScope: []`, `agentsMdClassificationUnderGeneratedScope: "in_scope"`, `contradictionInGeneratedScope: none`; the five prohibitions no finding requires stay forbidden — `drivers/check2-contract.post-f4.json` |
| `check4d-revendor-heal` (F3) | `passed: true`; `exit_codes {check_before_heal: 1, heal_write: 1, check_after_heal: 1}`; `file-unchanged=yes`; `pathMatchesScope_declarations: 1`; the refusal names `pathMatchesScope` and its line — `drivers/check4d-revendor-heal.post-f4.raw.json` |
| `check4-guard-failure` | `passed: true`, `live_untouched: true` (sha256 equal before/after) — `drivers/check4-guard.post-f4.log` |
| `check5-mount` | 14/14 agent-teams tools, `agent_teams_task_contract=REGISTERED`, 0 apply-crash signatures, probe DONE, both isolation counters 0 — `drivers/check5-mount.post-f4.raw.json` |

## Gates (raw logs in `gates/`)

| gate | result |
|---|---|
| `bun test packages/mpd-agent-teams-plugin` | 90 pass / 0 fail (`gates/plugin-suite.log`) |
| `bun test packages/mpd-agent-teams-plugin/self-fix-tests` | 33 pass / 0 fail (`gates/self-fix-suite.log`) |
| `bun test packages` | 343 pass / 0 fail across 38 files (`gates/full-suite.log`) |
| `bun run typecheck` | exit 0 (`gates/typecheck.log`) |
| guard `--check` on the live tree | 9 regions, already applied (`gates/guard-check.log`) |

## Known limitation (stated, not hidden)

`tools.js`'s `task-contract` region is the same class (its first line is the repeated
`    ctx.tools.register(defineTool({`), and a full strip-heal of `tools.js` currently heals it at
the next tool-registration boundary rather than at its canonical position. This does NOT affect the
acceptance criterion or the F4 instance: stripping `quality-gates.js` — the reproduction the
verifier specifies — is byte-faithful, and the live tree is unaffected (nothing is stripped in
normal operation). It is reported here as a listed follow-up rather than papered over; the
`anchorMarker` + occurrence resolution added in this repair is the groundwork for it.

## Not touched

`skills/**`, `VENDOR_LOCK.json`, `AGENTS.md`, `packages/mpd-verif-plugin/**`,
`packages/mpd-bundle/cordis.patch.yml`. `_deps/` shows 0 changes.

## Post-completion confirmation against the verifier's attempt-2 drivers

The verifier (Lead) supplied updated attempt-2 drivers after t14 was submitted; all were re-run
against the repaired tree and their raw outputs archived under `drivers-attempt2/`.

| attempt-2 driver | result |
|---|---|
| `check4e-heal-fidelity` (the F4 acceptance driver) | **`identical: true`, `diff_lines: 0`, `heal_exit: 0`, `check_exit: 0`, `passed: true`** — `check4e-heal-fidelity.raw.json`. Its own region listing confirms canonical and healed line numbers now agree (`create-contract-gate` at 410, `repair-scope` at 714, `repair-scope-fields` at 730 in BOTH). |
| `check4-guard-failure` | `passed: true`; S3 refuse, S3b restore, S3c verify, S4/S4b drift refusal, and the updated S5 (which discovers a region rather than hard-coding `scope-glob-core`) now reports `exit=1` naming the mismatch |
| `check4b-region-coverage` | `{"passed": true, "added_lines_outside_regions": 0}` — 0 of 212 added lines outside the 9 regions |
| `check4d-revendor-heal` | `passed: true`; refusal names the symbol and line 102; `exit_codes {1,1,1}`; `file-unchanged=yes`; 1 declaration |
| `check1-glob` | 13/13 cases pass, `post-fix (mpd-delta scope-glob present)` |
| `check2-contract` | `demandedButNotInScope: []`, `agentsMdClassificationUnderGeneratedScope: "in_scope"`, `contradictionInGeneratedScope: none` |
| `check5-mount` | `passed: true`; 14/14 tools, `agent_teams_task_contract=REGISTERED`, 0 apply-crash signatures, isolation attribution counters 0/0 (the updated driver attributes records to this boot's sandbox sessions, confirming the earlier `mpd-default-587132ea` count belonged to a concurrent captain session) |

The byte-fidelity assertion the verifier asked for is a permanent test:
`expect(readFileSync(file, "utf8")).toBe(canonical)` in
`self-fix-tests/scope-glob-and-contract.test.mjs` (`F4: stripping every region and healing
reproduces the canonical file byte-for-byte`).
