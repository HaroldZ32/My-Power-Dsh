# Review B2 — the N3 team-end verb + the re-review of T16 (F3/F4) and T21 (F4-closure)

- Reviewer: `rev-consume` (Reviewer) · row **T5** · wave 0.17.2 team
- Loops: N3 `loop-20261103T061032-b0639d` · T16 `loop-20261103T054327-fdbe3c` · T21 `loop-20261103T055513-0bda53`
- Contract: `.mpd/plans/vedit-p0-followup.md` (frozen) + the captain's N3 brief; the shipped contract for the
  team plane is `packages/mpd-team-core-plugin/README.md`
- Evidence: this directory (`01`..`13`), plus the writer's `../team-end/` and the lane-B `../lane-b/`
- No code was edited; the only writes are this directory and the verify-loop records.

## Assessment

**Risk level: HIGH.** The N3 verb is structurally right in every mechanical respect the brief named: the
terminal stamp goes through `writeTeam` (so the change feed and every observer see it), idempotency is
owned by the record (`endTeamRecord` returns `changed:false` without rewriting), the liveness filter in
`team-lifecycle.ts#isLiveTeam` is what closes resolution (the test proves `activeTeamId` still names the
team while `mpdTeams.active()` answers undefined for both seats), the tool description no longer points
at `delete`, the surface measures exactly **6,390** characters (the comment's number, verified), and the
six new arms cover live→ended, both refusals, the sentinel, the default reason and the unknown id. But
its authorization is **weaker than every sibling Lead-only check**: `endTeam` authorizes with the raw
`[caller.sessionId, ...caller.lineage]`, so a roster member whose session records the Lead as
`parentSession` — the exact F-B/CWE-863 shape this repository already fixed with `callerIdentity` —
passes the Lead check and can end the team, with **no supported way back**. Second, the "reported no-op"
exists only when the caller names `team_id`; the natural repeat of the same default-target call throws a
misleading refusal. T16 and T21 are sound: I reproduced the ceiling arm, the anchor NOTE's disappearance,
the byte-check discriminator, `root files 9/9` and **0 drift / 0 expected-after-pack** on my own fresh
packs, and the closure gate's self-test at 38/38.

## Findings (ranked; the loop record flattens severities to `minor`, this list is authoritative)

### Blocker

**B1 — a roster member carrying the Lead as `parentSession` can end the team.**
*Where:* `packages/mpd-team-core-plugin/src/team-actions.ts#endTeam` (the `spellings` array built from
`caller.sessionId` + `caller.lineage`, then `recordNamesLead`), with the caller produced by `where()` in
`packages/mpd-team-core-plugin/src/index.ts`. Contrast `callerIdentity` in the same `index.ts`, which every
other Lead-only check uses (live-roster append, live-board append, `claim`/`complete`/`depend`/mail): a
caller the roster names as a member borrows **no ancestry**.
*Why it matters:* ending is terminal and irreversible through this bundle — `isLiveTeam`/`resolveTeamRecord`
filter the record out, so no tool, route or panel can ever find the team again; only a hand edit of
`.mpd/team/teams/<id>.json` undoes it. `pr42-review-repairs.test.ts` pins the rule this verb skips:
"a member that also records the LEAD as parentSession is refused all the same" (the F-B repair, CWE-863).
The narrowing exists because a spawned member's session names the Lead as its parent — exactly the session
shape `where()` only drops when the harness also stamped `origin:"subagent"` or `delegationDepth >= 1`,
which the F-B arm deliberately does not assume.
*Evidence:* `11-auth-probe.log` — driven through the REAL tool and store: the member handle
`child-senior-engineer-1` with `{parentSession:"sess-lead"}` (no origin, no depth) returned `changed:true`
and stamped `phase:"ended"` + `endedAt` + the default reason; the identical call with `origin:"subagent"`
or `delegationDepth:1` was refused with "… is a member, not the Lead" and left the record `active`.
*Direction of a fix (described, not applied):* inside `endTeam`, narrow exactly as `callerIdentity` does —
if `memberNamedBy(record, [caller.sessionId])` names the caller, pass no ancestry — and add the F-B arm plus
the `origin`/`depth` controls to `team-end.test.ts`. Do NOT simply drop lineage: a forked/resumed Lead (not
on the roster) must still be able to end its own team, which both `recordNamesLead`'s `leadHistory` arm and
my probe arm 4 confirm.

### Medium

**M1 — the default-target repeat is refused instead of reported as a no-op.**
*Where:* `endTeam`'s `declared === ""` arm → `deps.resolveTeam` → `team-lifecycle.ts#resolveTeamRecord`
(live candidates only).
*Why it matters:* the brief requires idempotent **and reported**; the writer's REPORT claims "an
already-ended team answers `{ok:true, changed:false, …}`". That holds only for a declared `team_id`: a
second `end` with the SAME arguments throws `no team record in this workspace — approve a plan first`, which
is misleading (a plan was approved; the team was ended) and leaves the Lead unable to confirm the ending
through the verb. *Evidence:* `10-probe.log` — default end succeeded; the identical retry threw; the same
retry with `team_id` answered `changed:false`.
*Direction of a fix:* when no id is declared, fall back to the caller's bound index entry
(`activeTeamId` → `readTeam`) for an already-ended record whose Lead names the caller and return the no-op;
or state this bound explicitly and cover it with an arm.

### Nits

- **N1 — the terminal verb leaves no team-journal row.** `endTeam` writes none, while `setMemberFence`,
  `writeMemberHandoff`, `cancelTasks` and the dispatch reassign path all call `appendTeamJournal`
  (`packages/mpd-team-core-plugin/src/team-actions.ts`). Probe: `journal.jsonl` rows 0 → 0 across an end.
  Direction: append one `{event:"team-ended", teamId, at, reason}` row when `changed` is true, never on the
  idempotent repeat.
- **N2 — a workspace halt survives the end.** `placeHold` writes the workspace-wide `.mpd/team/hold.json`;
  halt → end leaves it in place (`10-probe.log` arm C), so a LATER team in the same workspace inherits the
  pause until `resume`. Direction: decide and document (clear on end, or state the interaction in the
  control description and the package README's Known limits).
- **N3 — the repair-target authority is not discriminated by any arm.** The report claims a declared
  `team_id` lets a Lead end a team "from any session", but every arm ends as the bound Lead; a regression to
  session-id-only matching would stay green. Probe: `unbindActiveTeam` then declared id → success. Direction:
  add the unbound-Lead arm plus the negative control (non-bound non-Lead still refused).
- **N4 (T16 nit) — the packer's NOTE sentence is false about byte-checking.** In `scripts/pack-mpd.ts`, the
  NOTE printed for a declared-but-unanchored root file says "extend the anchor in `scripts/pack-mpd.ts` so
  the gate byte-checks them too". The gate derives nothing from the packer by design
  (`scripts/verify-pack-closure.ts#REQUIRED_ROOT_FILES` is its own list; T21 had to add the seven there
  separately). The NOTE is currently unreachable (all declared root files are anchored, so it never prints),
  but it is the same misleading-instruction shape T21 repaired in the gate comment. Direction: reword to
  "so the gate's presence check knows it; the byte rule lives in `verify-pack-closure.ts#REQUIRED_ROOT_FILES`".

## Re-review of T16 and T21 (the previous reviewer failed mid-report; its durable logs `../review-b/` agree)

**T16 — PASS.** (a) F3: the ceiling arm in `test/vedit-p0-lane-b.test.ts` passes (16/16 in that file) and
discriminates `1000` honoured / `1001 → 8` / `10_000 → 8` / `999 → 999` against `mailMaxUndeliveredOf`;
production matched the document, so no production change was owed — correct per F3's own rule. (b) F4: the
packer's `ROOT_FILES` names all seven; my frozen `pack` gate run exits 0 with **zero** "NOTE: package.json
declares root file(s) … omits" lines, and my independent `--out` scratch pack also has 0 NOTE lines and
exit 0. (c) No packaging behaviour moved: the diff is an append-only addition to the anchor, and
`ROOT_DECLARED` (derived from `package.json`'s `files`) still drives every copy. The lane-B report's honest
bound ("the anchor alone does not byte-check them") was correct, and T21 is the row that closed it.

**T21 — PASS.** (a) `REQUIRED_ROOT_FILES` now holds 9 entries, appended so `[0]` stays
`EXTENSIONS-FOR-AGENTS.md` and the self-test subjects do not move; the self-test still passes **38/38 arms**.
(b) The byte-check is real on MY OWN artifact: a fresh scratch pack (stamp `2026-11-03T06:25:13.860Z`) gives
`root files 9/9`, `649/649 identical, 0 drift, 0 expected-after-pack`; mutating `PLAN.md` produces ONE named
`ROOT-FILE` finding (exit 1), mutating `PLAN.md` + `icon.svg` produces TWO, and removing `dsh-plugin.json`
produces the presence finding (`07-discriminator.log`). (c) `root files 9/9` and **0 drift / 0 expected**
re-measured again at stamp `2026-11-03T06:35:14.751Z` after the frozen pack gate
(`13-closure-t16-bound.log`). (d) No weakening: the change adds names to a list, removes no rule, and the
packer→gate direction (`REQUIRED_ROOT_FILES ⊆` the packer anchor) still holds. (e) The mailbox comment now
states the real rule (inclusive `0..1000`, above it the shipped default, `0` disables), pinned by the F3 arm.

## Declined to judge (weighed and set aside, so nothing disappears silently)

- **Ending a STAGED team** leaves the staged plan in `.mpd/team/staging`, so the Lead could still approve it
  into a new team. The plan `delete` action is the documented close for a staged plan, and the brief speaks
  about a live team — not judged.
- **A record with `phase:"ended"` but no `endedAt`** is re-stamped by `endTeamRecord` (and `reapReapedTeams`
  does the same). Legacy shape, pre-existing terminal rule, not introduced by this change.
- **The tool schema's `refused` output property is never produced** (refusals throw). Pre-existing across
  this surface, unchanged by N3.
- **The verify recorder stored my findings with severity `minor`** (Blocker/Medium/Nit flattened). I did not
  judge the verify tool; the authoritative ranking is this report and my message to the Lead.
- **`verify-dist-fresh` is RED for `packages/mpd-team-core-plugin/dist/index.js`** because N3 changed `src`
  without a rebuild (`09-dist-fresh.log`). This is the writer's declared bound and the captain's integration
  step, not a defect of the verb; no released artifact carries `end` yet.
- **README wording** still lists `halt, resume` and "a halt is not an ending" without the `end` clause —
  N6's row per the brief and the writer's report.

## Verdict

**Request changes.** The authorization check must be narrowed to this repository's own F-B rule before the
verb ships — a member who can end the team is a worse failure than any of the mechanical gaps, and the fix is
small and local — while the rest of N3 is sound and T16/T21 are approved.

Loop records written: N3 **FAIL** `rec-20261103T063352-a18065` → repair `rep-20261103T063352-ac3216`;
T16 **PASS** `rec-20261103T063527-bbbdd9`; T21 **PASS** `rec-20261103T063543-a75f7a`.

## Bounds of this review (what I did not read, what I could not run)

- **No live harness mount / real `dsh` boot** for the end verb: the probes drive the REAL plugin, tool
  registry and store in-process with a stub executor (the writer's own basis). I did not observe a real
  teammate session's header; that is why B1 is reported with both the reachable code path and the exact
  session shape the repository's own F-B test declares real, rather than as a live-harness measurement.
- **T21's exact stamp `2026-11-03T05:53:44.970Z` is not re-measurable**: later lanes re-staged
  `dist/mpd-package` (`05:59:45.011Z`, then my own `06:25`/`06:32`/`06:35` packs). I verified the claim at my
  own settled stamps; the lane-B log's reading is accepted as its measurement moment.
- **No dist rebuild and no re-pack for release.** I ran the frozen `pack` gate (which re-stages the derived
  `dist/mpd-package/`, gitignored) but did not build any `dist/`; the shipped dist therefore still lacks
  `end`, and `verify-dist-fresh` is red for team-core until the captain's integration rebuild.
- I did not review the web/panel surface (`mpdTeamActions` does not expose `end` — stated bound), the docs
  lane (N6), or the other packages' diffs; I read the two lanes' reports and ALL their logs, the contract,
  the package README, the changed source files and tests, and the prior reviewer's partial `../review-b/`
  logs.
- No credentials, tokens or connection strings were encountered in the material reviewed.

## Evidence index (this directory)

| file | what it proves |
|---|---|
| `01-package-tests.log` | `bun test packages/mpd-team-core-plugin` — 581 pass / 0 fail / 40 files |
| `02-typecheck.log` | `bun run typecheck` — exit 0 |
| `03-closure-current.log` | closure on the then-current artifact — 9/9 root files, 0 drift, 1 expected (post-pack writer) |
| `04-closure-self-test.log` | closure gate self-test — 38/38 arms PASS |
| `05-pack-scratch.log` | my scratch `--out` pack — exit 0, 0 NOTE lines |
| `06-closure-scratch.log` | closure on the scratch pack — 9/9, 649/649, 0 drift, 0 expected, stamp 06:24:44.724Z |
| `07-discriminator.log` | control exit 0; PLAN.md mutation → named ROOT-FILE; +icon.svg → 2; dsh-plugin.json removal → presence finding |
| `08-lane-b-test.log` | `vedit-p0-lane-b.test.ts` — 16 pass / 0 fail (the F3 ceiling arm) |
| `09-dist-fresh.log` | `verify-dist-fresh` — 1 STALE (`mpd-team-core-plugin/dist/index.js`, N3's unbuilt src) |
| `10-probe.log` | surface 6,390; default end + retry-refusal + sentinel no-op; unbind repair target; halt survives end; no journal row |
| `11-auth-probe.log` | B1: member `{parentSession: lead}` ends the team; `origin`/`depth` controls refused |
| `12-closure-post-gate-pack.log` | closure after the first frozen pack gate — 9/9, 649/649, 0 drift, stamp 06:32:28.274Z |
| `13-closure-t16-bound.log` | closure after the second frozen pack gate — 9/9, 649/649, 0 drift, stamp 06:35:14.751Z |
