# W3-C — team approve auto-binds workmates + `mpd_workmate_optimize` / `/workmate-optimize`

Lane: Senior Engineer (board row T12). Contract: `.mpd/plans/autoproject-refactor.md` §4.6
(requirement 4: a large project's team pulls DURABLE workmates instead of always raising fresh
members, and the user gets ONE command to merge/optimise the library).

## 1. Deliverable A — deterministic binding at `approveTeam`

`packages/mpd-team-core-plugin/src/team-actions.ts`. The pass runs **after the `dry_run` preview and
before the first record write**, because a REUSE gives the seat the workmate's OWN name and a member
name is seat identity on this board.

| step | condition | result |
|---|---|---|
| 0 | `workmates.mode === "none"` | plain seat, `mode:"none"`, reason `config`; the tool seam is never resolved |
| 1 | the member names an explicit workmate | bind it — or **REFUSE the whole approval** (never a silent downgrade) |
| 2 | otherwise | `mpd_workmate_match {task: "<description> <role>"}` |
| 3 | score ≥ the match threshold AND the name is FREE ON THIS TEAM | **REUSE**: the seat takes the workmate's name, prompt head = persona + note + memory tail, `mode:"reuse"` |
| 4 | else `workmates.autoInit` AND library size < `workmates.max` | **INIT** `<role-slug>-<smallest free n>` through `mpd_workmate_init`, `mode:"init"` |
| 5 | else | plain seat, `mode:"none"`, reason `cap` / `no-role` / `auto-init-off` / `no-seam` / `no-library` / `init-refused` / `binding-failed` |

Implementation notes that a verifier should check against the contract:
- **The seam is a TOOL CALL** (`mpd_workmate_list|match|init`) through the mounted adapter's
  `executeTool`, resolved from the `mpdDsh` service per approval; the persona/note/memory head comes
  from the `mpdWorkmate` service's own `read` because no tool projects file content. **No cross-package
  import was added** (C1).
- **The name-free rule is mandatory and enforced against the plan's own roster** (a member name is seat
  identity, so a blind bind would merge two seats).
- **A renamed member takes its board references with it**: the plan's `tasks[].owner` follows the rename,
  and the approval builds the record from a rewritten `buildPlan` while the STAGED plan stays as staged.
- **Any throw is NON-FATAL**: one `deps.log` line and every seat stays plain. A missing adapter logs
  once; a library that cannot be READ is treated as "no library row mounted" and logs nothing (that is a
  normal composition, not a degradation).
- **Knobs are read through `mpdConfig` only** — `workmates.mode|autoInit|max` stay OUT of
  `SETTINGS_KNOBS`, whose count is untouched at 47 (C5).
- The decision table is reported in `TeamApprovePayload.bindings` (`{member, mode, workmate?, reason?}`),
  which flows into the tool reply because the tool spreads the payload.

**Recorded tension (reported, not silently resolved):** the contract says "persist the binding on the
team record (…`workmate`) **plus mode**". The record's `mode` field is the SEAT mode
(`"member" | "checkpoint"`, W1-A), so writing `"reuse"`/`"init"`/`"none"` there is impossible without a
type change in `src/team-store.ts` — OUTSIDE this lane's write scope. What ships: `workmate` (the bound
instance) IS persisted per seat, and the mode/reason are the approval answer's `bindings`. A durable
per-seat binding mode is a 4-line additive change to `team-store.ts` + `team-actions.ts` for the
team-core owner.

## 2. Deliverable B — `mpd_workmate_optimize` + `/workmate-optimize`

`packages/mpd-workmate-plugin/src/index.ts` (+ `test/optimize.test.ts`).

**Merge predicate** (a pair may merge iff ALL of these hold):
1. both instances exist; 2. `from !== into`; 3. same `meta.baseName`; 4. equal `readonly`;
5. neither has an archive copy under `.archive/`; 6. neither is busy in ANY live team
(`busyTeams` over the given roots) and neither has an in-flight spawn;
7. `noteScore >= mergeThreshold` (default **0.6**) **OR** `tagJaccard >= 0.5`.

`noteScore` = the library's own `scoreMatch` of the SOURCE note against the target's corpus.
`tagJaccard` = Jaccard over the distinct `tokenize(note + baseName)` sets (the same tokenizer the
matcher uses — the library has no free-form tag field, stated here rather than invented).

**Auto proposal rule**: inside one `baseName` group ordered by `(uses desc, name asc)`, the first
instance is the survivor and every other member is proposed INTO it (so an optimize collapses a fork
back into its most-used instance). An explicit `pairs` list replaces the proposal entirely.

**Preserved on merge**: memory blocks concatenated (target first) **deduped by sha256**, capped at
`MEMORY_CAP` by evicting the OLDEST blocks; persona = the LONGER body, capped at `PERSONA_CAP`, plus ONE
`merged-from: <source>` line; `uses` summed; `renamedFrom` accumulates the source and its own history
(capped 10); `note.md` regenerated through `autoNote`.

**Archive path shape**: `~/.mpd/workmate/.archive/<from>-merged-<into>-<compactUtcStampZ>/`
(a numeric suffix disambiguates a same-second repeat) containing the source's untouched bytes plus
`merge.json = {version:1, from, into, at, memoryShas:[sha256 per source memory block], personaSha}`.
**This path cannot purge**: optimize has no purge parameter, and `delete` cannot reach `.archive/`
(its key is sanitized, so a leading dot never survives).

**Confirmation**: dry-run BY DEFAULT. `applied` is non-empty only when `confirm === true` AND
`dryRun !== true`; a pair refused for live-team use skips ONLY that pair. The in-use gate is RE-READ
inside the same synchronous block as the mutation.

**Tool params**: `{dryRun?, confirm?, pairs?:[{from,into}], mergeThreshold?}` →
`{plan, applied, skipped}`. `/workmate-optimize` with no args prints the plan table; the single argument
`confirm` applies it (same renderer as the tool, so the two surfaces cannot drift).

## 3. Observed results

| command | result |
|---|---|
| `bun test packages/mpd-workmate-plugin` | **exit 0 — 69 pass, 0 fail** (7 files) — `workmate-tests.log` |
| `bun test packages/mpd-team-core-plugin` | **exit 0 — 521 pass, 0 fail** (34 files) — `team-core-tests.log` |
| `bun run verify:comments` | **PASS** — every declaration documented, full signatures — `verify-comments.log` |
| `bun run typecheck` | exit 1 with **7 errors, ALL in `packages/mpd-memory-plugin/src/index.ts`** (W3-D's in-flight lane); **zero in this lane's files** — `typecheck.log` |

New arms (all green):
- **A-(a)** explicit-but-absent workmate → the WHOLE approval is refused, nothing written, no init.
- **A-(a2)** explicit + present → seat renamed, persona+memory head in the prompt, `workmate` on the
  record, the task's `owner` followed the rename.
- **A-(b)** strong match → reuse + rename; weak match → init `senior-engineer-1` from the role slug.
- **A-(c)** at `workmates.max:2` with an empty library and 3 members → 2 inits, the third `mode:"none"`
  `reason:"cap"`, and the capped seat keeps its staged name.
- **A-d** `workmates.mode:"none"` → every seat plain, zero tool calls; **A-e** no tool seam → every seat
  plain with exactly ONE log line and no throw.
- **B-(d)** a workmate busy in a LIVE team is never merged (and a SETTLED member does not hold it);
  base/readonly/similarity gates each refuse with their own reason; the auto rule picks the most-used
  survivor.
- **B-(e)** dry run writes nothing (bytes verified), `confirm:true` archives the source with `merge.json`,
  the survivor keeps memory-deduped + longer-persona + summed uses + accumulated history, and the note
  is regenerated; **B-command** `/workmate-optimize` prints DRY RUN, `confirm` applies.

## 4. What I could not prove / did not do

1. **No durable per-seat binding MODE** (see §1's recorded tension) — `workmate` is persisted, the mode
   is reported in the approval answer, because `TeamMemberRecord.mode` is the seat mode and
   `team-store.ts` is outside this lane's write scope.
2. **No real MOUNT boot.** The new tool's schema and the command registration are exercised through the
   plugin's own `apply` in tests, not by a boot that mounts the row.
3. **The approve tool's output SCHEMA does not declare `bindings`** (it has no
   `additionalProperties: false`, so the field passes validation and reaches the reply), and the tool's
   `render` does not print it — both live in `src/index.ts`, outside this lane's write scope.
4. **`skills/**` untouched** (the SKILL.md case table still lists the old workmate description), and
   **docs untouched**: `packages/mpd-workmate-plugin/README*.md` and the QA skill corpus are wave W5's.
5. **No dist rebuild, no git** — the integration task rebuilds `packages/*/dist/**` with the pinned
   toolchain (T-88).
