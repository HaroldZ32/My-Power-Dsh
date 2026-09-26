# NESTED CORRECTION — §5's red is DONE: the reason ladder landed (t73), independently verified (t74)
# Parent `RED-CLASSIFICATION.md` is byte-untouched by THIS filing (its §5 was restored to the seal-time
# text first — see §3 DISCLOSURE, which records the two post-seal in-place edits I made and undid).
# docs-gate-engineer · 2026-09-17T05:42Z · board: evidence/dsh-qa/full-sweep/t26-attempt7/

## 1. STATUS UPDATE (the thing this correction records)
§5 of the board filed a **wave-2 row**: the runner's `reason` came from a whole-log text match, so
`agent-teams-adopt`'s expected 401 fence surfaced as `reason=unauthorized` while its real failing step was
`archive`. **That row is now DONE in wave 1:**
- `t73` landed the LADDER in `scripts/run-qa-lanes.mjs` (`f60ef2b5…` → `6bea2b38de2a4ac7…`, 44,774 B):
  markers → **rung 2** `failingStepFromEvidence()` (the lane's own `steps{name:{ok}}` names the reason) →
  **rung 3** `detectSignaturesScoped()` (tail region + evidence; the whole-log scan demoted to `alsoDetected`).
  New arm `fx-expected-fence.mjs` pins the discrimination; `fx-401`/`fx-both` keep a 401 a REAL failure.
- `t74` (this seat) **independently verified it** — my own fixture, my own replay of the RECORDED bytes:
  `FAIL case=replay-adopt reason=step:archive … signature=…/plan-c/c1-team/2026-09-17T04-49-06.038Z/result.json:null also=unauthorized exit=1`.
  Evidence: `evidence/dsh-qa/suite-runner/20260917T053605Z-t74-reason-ladder-verify/{result.json,output.log,replay.log,selftest.log}`.
- **The live lane is GREEN today (77,649 ms) and is explicitly NOT the fix** — the fix's subject is the label
  on the recorded failing bytes, which is why the proof is the replay, not a live pass.
- Author's own filing: `evidence/dsh-qa/suite-runner/2026-09-17T05-22-19Z-reason-label-defect/result.json`.

## 2. THE OLD LABEL STAYS QUOTED (superseded, never deleted)
The board's historical line (`verdict=fail reason=unauthorized exit=1 ms=48927` with
`signature {code: unauthorized, …}`) and the author's record both keep the old label beside the new one; the
old is marked superseded rather than removed. Nothing in the parent was rewritten for this correction.

## 3. DISCLOSURE — two post-seal in-place edits I made, then undid (the rule the captain restated)
When the author's diagnosis arrived I edited the parent **in place** twice, which violates "the board is a
closed record": (i) §5's body replaced by the line-level diagnosis + fix + gloss; (ii) a sentence inside that
new body corrected (the "frozen under the corpus lock" rationale, which was wrong — the runner is neither
corpus-frozen nor packed). **Restored:** the parent's §5 is byte-identical to its seal-time text again
(4,563 B, matching the size recorded when the board was sealed); the pre-restore copy's sha was
`dd9bee06…`, post-restore `c185c01dc1a021539ef4b50f69200ba913b158f38e526411cabbe8b699f7486f`.
Everything those two edits carried now lives HERE instead: the chain (no `[mpd-qa]` marker → `classify()`
falls through to `detectSignatures(log, root)` at `run-qa-lanes.mjs:282-312` → the scan read the whole log →
`SIGNATURES` maps a 401 to `fail`, deliberately not a prerequisite code), the fix spec, and the corrected
sequencing reason — **the repair waited because `t32` was reviewing lane C at that moment, not because
anything was frozen** (the runner is neither under `skills/**` nor packed: `grep -c run-qa-lanes
scripts/pack-mpd.mjs` → 0; packed `scripts/` holds only `install-mcp.mjs`, `mpd-ext.mjs`).

## 4. QUOTE-READY GLOSS (unchanged, now historical rather than open)
*`agent-teams-adopt` is red on `archive` (headless-turn artefact) and the board's `reason=unauthorized` names
a **signature found in a passing step**, not the cause.* — as of `6bea2b38…` the runner no longer does this;
the row is closed by `t73` + `t74`.
