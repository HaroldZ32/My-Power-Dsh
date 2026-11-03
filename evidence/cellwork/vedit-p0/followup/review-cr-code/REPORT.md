# Review CR-code — the CR1 fixes (T22): end-journal containment + recorded-Lead title exclusion

- Reviewer: `rev-consume` (Reviewer) · row **T24** · wave 0.17.2 team · CodeRabbit round 1 on PR #93
- Loop: `loop-20261103T080819-5165ba` — record **PASS** `rec-20261103T081535-698d12`
- Contract: `.mpd/plans/vedit-p0-followup.md` (frozen) + the captain's T24 brief
- Repair evidence: `evidence/cellwork/vedit-p0/followup/codereview/t22-identity-and-journal/`
  (REPORT, `cr1-probe.ts`, gate logs, diff)
- My evidence: this directory (`01`..`07`)
- No code was edited; the only writes are this directory and the loop record.

## Assessment

**Risk level: LOW.** Both CR1 findings were valid and are properly fixed. The journal append now sits inside
a try/catch AFTER the terminal record has landed, so a disk failure can no longer turn a completed ending
into a failed reply, and the failure is reported rather than swallowed — on a sink that is total by contract
(`rowLogLine` never throws), so the containment cannot be defeated by the diagnostic path itself. The
recorded-Lead exclusion is exact: `memberIdentityOf` checks `recordNamesLead` (current `leadSessionId` AND
`leadHistory`) before the title arm, so a captain persona that happens to contain a roster role can never
hand the Lead a member row or a member mailbox address. My own re-runs reproduce both: the CR1 probe shows
the EISDIR shape with `ok:true/changed:true`, the ended record, ONE exact diagnostic line, and a
`changed:false` retry with the first reason/instant and no second line; the identity unit/tool arms cover
both Lead spellings plus the control, and the probe's inline recomputation of the OLD arm-3 returns `M1`
(the arm is not vacuous). The suite is 603 pass / 0 fail, the 14 identity + 13 end + 1 CR1 arms are 28 pass,
and my earlier auth and edge probes still pass — no weakening. The bounds are honest.

## Judgment on each item the captain named

- **(a) END-JOURNAL CONTAINMENT — YES.** `team-actions.ts#endTeam` appends the `team-ended` row inside
  `try { … } catch (error) { deps.log(…) }` only when `outcome.changed`, i.e. after `endTeamRecord` landed
  the terminal write; the reply is still `{ok:true, changed:true, endedAt, reason}`. `deps.log` is a
  required `TeamActionDeps` field wired in production to `rowLogLine` (adapter), whose own contract is
  totality ("never throw and never print") — so a broken journal cannot escape via the sink either. The
  new `test/codereview-cr1.test.ts` drives the REAL `endTeam` with the row's seams injected (no module
  mocking), makes `.mpd/team/journal.jsonl` a DIRECTORY so `appendFileSync` raises `EISDIR`, and asserts:
  the end is `ok:true`/`changed:true`, the record is `phase:"ended"` with the stamped `endedAt`, exactly ONE
  log line containing `team <id> ended but its journal row was not written:` plus the append's own refusal,
  and the retry is `changed:false` with the FIRST reason/instant and no second line. My run of
  `cr1-probe.ts` reproduces the same JSON end-to-end.
- **(b) RECORDED-LEAD TITLE EXCLUSION — YES.** `memberIdentityOf` runs
  `if (sessionId !== "" && recordNamesLead(record, [sessionId])) return { named: false }` after ARM 1/2 and
  before ARM 3; `recordNamesLead` reads the current `leadSessionId` and every `leadHistory` entry. The unit
  arm pins both spellings (`sess-lead` and a churned `lead-fork-2`) to `{named:false, member:undefined}` and
  the CONTROL (the same title on a non-Lead session) still names the seat; the tool arm pins the consequence:
  the recorded Lead's `agent_teams_mail {action:"unread"}` reply carries the LEAD session id as `memberName`,
  not the member's name. The probe's non-vacuity measurement is a genuine inline recomputation of the OLD
  arm-3 decision on the same record (`oldArmThreeWouldName: "M1"`), and the probe itself fails if that
  recomputation does not reproduce the pre-fix match.
- **(c) T12/T16 identity arms + the 13 team-end arms stay green; no weakening.** Package **603 pass / 0 fail**
  (2905 expect, 42 files); the touch-point set identity-plane (14) + team-end (13) + codereview-cr1 (1) is
  **28 pass / 0 fail** (148 expect); my ORIGINAL T12 auth probe and the T16 edge probe, re-run on this tree,
  both still PASS (the containment and the Lead guard did not disturb the resumed-member protections).
- **(d) The bounds are honest, with one imprecise sentence (N1 below).** (i) The missing journal row cannot
  be re-created by a retry — the retry is the documented no-op, and a re-append/repair verb would be a
  separate feature; the ending itself is correct and reported. (ii) A FORKED Lead's new session id is
  recorded only when `healLeadBinding` writes `leadHistory`, and the heal SKIPS any session the identity
  plane names as a member — so a fork whose title names a seat is read as that seat and is **never healed**
  on that record (it stays seat-blocked until its title/session changes), not merely "until the heal records
  it". The substance matches the T12 residual and is stated at the arm; the report's closing phrase is the
  imprecision N1 records.

## Findings

### Nit

**N1 — the fork bound's closing phrase is self-contradictory.** The repair REPORT's Bounds say a seat-naming
fork "is read as that seat until the heal records it", but the same paragraph (and the code) says the heal
is skipped for any session the identity plane names as a member — so such a fork is **never** healed and
stays seat-blocked on that record. The consequence is fail-closed (no authority leak) and the arm's own
comment states it correctly; only the sentence is loose. *Direction:* replace "until the heal records it"
with "and is never healed (the heal skips a `named` session), so it cannot act as Lead on that record until
its title or session id changes" — in the REPORT and in the N6 wording it feeds (the N6 clause says "still
read as that seat", which is fine; keep it consistent with the permanence).

None beyond that. Both CR1 items are fixed, the fixes are the right shape, and I found no defect or
regression in the delta.

## Declined to judge (weighed and set aside)

- **The CR1 arm's retry resolves through the test's stubbed `resolveTeam`** rather than the real bound-index
  path. That is deliberate (the arm's subject is the log/no-second-line behaviour); the real default-target
  repeat is covered by team-end's M1 arm. Not judged.
- **A poisoned `leadHistory` entry** — a member handle promoted by the pre-fix heal — would now be treated as
  a RECORDED Lead (the guard trusts record facts by design). The pre-fix build was never released, and I
  scanned the workspace's own `.mpd/team/teams/*.json`: no record carries a member handle in `leadHistory`.
  Not judged; worth remembering if a user ever reports it.
- **The "exact log sentence" assertion is a `toContain` of the contract prefix plus the append refusal**, not
  a full-string equality; the probe records the complete line. Sufficient for the contract. Not judged.
- The recorder flattens severities to `minor`; this report's ranking is authoritative.

## Verdict

**Approve.** Both CodeRabbit CR1 findings were valid and are fixed at the right layer with non-vacuous,
no-mock arms; the ending can no longer be reported as failed after it landed, and the recorded Lead can no
longer be addressed as a member; no weakening and no new finding.

## Bounds of this review

- **No dist build** (the captain integrates): `packages/mpd-team-core-plugin/dist/index.js` still lacks
  `end`/the identity narrowing, so the released artifact does not carry these fixes yet; this verdict is
  source/test-level.
- **No live harness mount**: verification is the real plugin + real store over a stub executor, the direct
  `endTeam` arm with injected seams, and the store-level predicate probe. I did not observe a live session
  title or a live journal failure.
- I read the repair REPORT, its diff, the `endTeam` containment, `memberIdentityOf`'s guard, `refusalOf`,
  `deps.log`'s wiring and `rowLogLine`, the new CR1 test file, the two new identity arms and the probe; I did
  not re-read unrelated packages or the whole working-tree diff.
- No credentials, tokens or connection strings were encountered.

## Evidence index (this directory)

| file | what it proves |
|---|---|
| `01-cr1-probe.log` | the CR1 probe: recorded-Lead `named:false` (both spellings), old arm-3 would name `M1`, control still names the seat; EISDIR journal → ok/changed:true, ended record, one exact log line, retry changed:false with the first reason/instant — CR1 PROBE PASS |
| `02-auth-probe-regression.log` | my original T12 auth probe on this tree — PROBE PASS (no identity regression) |
| `03-edge-probe-regression.log` | my T16 edge probe on this tree — EDGE PROBE PASS (longest match / stored-name rule intact) |
| `04-package-tests.log` | `bun test packages/mpd-team-core-plugin` — 603 pass / 0 fail / 2905 expect / 42 files |
| `05-touchpoint-arms.log` | identity-plane + team-end + codereview-cr1 — 28 pass / 0 fail / 148 expect |
| `06-typecheck.log` | `bun run typecheck` — exit 0 |
| `07-comments.log` | `bun run verify:comments` — VERDICT PASS, exit 0 |
