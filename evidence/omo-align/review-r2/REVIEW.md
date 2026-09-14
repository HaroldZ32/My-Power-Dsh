# R1 + R3 adversarial review (round 2) — the wired message channel

* Task: `t50` (review round 2), attempt 1 — `9012bb97-e231-4312-b11c-577a1c82163f`
* Reviewer: **Architect** (read-only; no product file was modified by this review)
* Reviewed task: `t49` (repair round 2 — "R1 is WIRED"), plus the standing round-1 subjects (R1, R3, V1, t44, t37/t39, Option A)
* Round-1 review (frozen, not overwritten): `evidence/omo-align/review-r1/`
* Settled revision: `dev` @ **`0f647f2`** — all four repair/sweep commits are landed and the worktree is **clean** (round 1 measured a dirty tree, so this round is the first one anchored on committed bytes)
* Verdict: **needs_revision** — the dedup wiring, the tombstone fix, the expiry notice and the decision vocabulary are all real and independently reproduced, but R1's interjection **lane** still has no agent-facing surface (write, decide or clear) and the R1 QA case is **red** at the settled revision; the t49 completion payload claims the opposite of what the shipped code does.

---

## 1. Anchored revision

`git log 7379e28..0f647f2`: `aaa54d7 fix(agent-teams): wire R1 into the shipped path…` → merge `62d0db3` → `50e6497 test(agent-teams): prove the dedup guard on the SHIPPED path, and sweep for dead capability` → merge `0f647f2`. Worktree clean.

| Reviewed file | bytes | sha256 |
|---|---|---|
| `packages/mpd-agent-teams-plugin/lib/state.js` | 61904 | `004efcfd27d424a6d4ad6a5432269bd555ccc27a5b935b8a1d58591679ccdf67` |
| `packages/mpd-agent-teams-plugin/lib/scheduler.js` | 31955 | `27cc18b923443c22b160ed202485499b980cceb22f43e63855bf42e6cd6550a2` |
| `packages/mpd-agent-teams-plugin/lib/tools.js` | 151421 | `4babeddc7b528c1a…` |
| `packages/mpd-agent-teams-plugin/lib/session-start.js` | 28432 | `8cfaef47e9959ef7def01003640f768ff4befa50e9c202ff692a0629ca0a2aa6` (UNCHANGED — R3 untouched) |
| `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js` | 100922 | `87fd502b09dac90e…` |
| `packages/mpd-agent-teams-plugin/test/r1-message-channel.test.mjs` | 18027 | `bbceac658b782370…` |
| `packages/mpd-agent-teams-plugin/test/t49-send-dedup-wiring.test.mjs` | 13029 | `410185dc970b15c4…` |
| `evidence/omo-align/requirements/frozen-contract.json` | 36401 | `19dc0c6779f8a479…` |

Pre-repair arm for the A/B measurement: `7379e28` → `state.js` 57791 B / `fa7fe937…` (the round-1 anchor; materialized into a temp package copy and deleted afterwards).

Review-local artifacts (new directory; nothing pre-existing overwritten):

| Artifact | What it is |
|---|---|
| `raw/probe-r2-wiring.mjs` / `.out.json` / `.err.txt` | shipped-module probes: transient fold marker, acknowledged-then-folded, clear-after-ack, expiry notice, decision vocabulary + repost, V1 field contract, and the pre-repair A/B |
| `raw/qa-messaging-rerun.log` | my own run of the delivered QA case on the settled revision (RED, exit 1) |

---

## 2. What t49 genuinely closed (independently reproduced)

| Round-1 finding | Status | My evidence (not the implementer's) |
|---|---|---|
| F-1 (dedup clause) | **CLOSED** | `tools.js:1876` (captain) and `:1895` (member) now call `appendMailboxDeduped`; the fold guard `tools.js:1919-1926` returns `delivered:'duplicate'` **before** any live delivery. Probe: 3 identical key+window sends → one row, `dupCount` 2→3, `_folded` returned to the caller and **never written** (`markerPersisted:false`, row keys `[id,from,to,content,ts,dupCount]`). |
| F-2 (expiry notice) | **CLOSED** | `state.js:662-684` flips `pending→expired` and appends an ORDINARY notice; tick `scheduler.js:295-307` at the top of `kickMember`. Probe: requester inbox holds exactly one record `interjection-expired-ij-ttl`, `from:'captain'`, `kind:null`, body says EXPIRED. |
| F-3 (tombstone resurrection) | **CLOSED** | `readUnreadMailbox` (`state.js:778-786`) and `deliverableUnread` (`scheduler.js:241`) both drop `tombstone !== true`; `clearMailboxToWatermark` now preserves `readAt`/`deliveredAt`/`dupCount` (`state.js:543-547`); the fold preserves them too (`state.js:498-500`). Probe: 3 acknowledged records → clear → **0 unread, 0 live**, tombstone keys include `readAt`+`deliveredAt`; a fold against an acknowledged row leaves `readAt` intact and unread 0. |
| F-4 (decision vocabulary) | **CLOSED** | `state.js:708-713`. Probe: `'banana'` → `invalid interjection decision "banana"; allowed values are: approved, rejected`, and the row **stays `pending`** (nothing is lost). A second decision is refused with `is already approved`. |
| F-5 (no call-count evidence) | **CLOSED** | `test/t49-send-dedup-wiring.test.mjs` drives the REAL tool and the REAL scheduler (`installTeamScheduler` → `runtime.kickMember`) and counts `subagents.prompt` deliveries: 0 before the idle edge, exactly 1 after, still 1 after a second kick; with live delivery forced to fail, `first.delivered='mailbox'`, `second.delivered='duplicate'`, then exactly one scheduler delivery. I ran the file: **7 pass / 0 fail**. |
| F-6 (operative wording) | **CLOSED** | `frozen-contract.json.messagingOperativeReading` records "AT-MOST-ONCE delivery; ONE surviving record … dupCount=N". |
| F-7 (C1/C3 transcription) | **CLOSED** | C1 is now byte-identical to `ENUMERATED_LINE_PATTERN` (`^\s*(?:\d+[.)]|[-*|])\s`); the old "pair an action verb with an object" phrasing is gone (0 occurrences) and C3 is restated positionally; `harmonizedVerbTables` intact (2 occurrences). |
| V1 (this wave's real defect) | **STILL CLOSED on the new hash** | Probe on `state.js 004efcfd`: content-less enqueue → `content:'only a summary'`, readable as pending, decidable; absent id → `does not exist`; malformed-but-present → `MALFORMED`; missing identity → `missing required field "id"`. |
| t44 falsifiability method | **still sufficient** | Unchanged verdict; the 5 REPAIR V1 assertions re-pass (r1 file 18/18 on the settled revision) and the pre-repair A/B recipe was reproduced by me in round 1. |
| R3 | **unchanged, verdict carries** | `session-start.js` is byte-identical to round 1 (`8cfaef47…`), so the round-1 counterexamples stand: `Audit the ledger, build the package, verify the output.` and `重构这个模块, 迁移到新接口, 审计日志.` were silent pre-R3 and route now; the delta is monotone (no verb removals). |
| Option A / t37-t39 | **unchanged, judgement carries** | The measured gate input is unchanged (`probe-output.json` anchors `session-start.js 8cfaef47…` = the settled file), so the round-1 reading stands: 0/20 real triggers, 0 English prompts (rate undefined), the richest session-start prompt a zero-signal MISS. Recommendation order unchanged: positive stratum → English coverage → cheapest-first re-tune (C3 or `ACTION_VERB_MIN` 3→2), and do not touch the C 2-of-3 bar or `signals >= 1`. |

**Gates I re-ran on the settled revision** (all green): `patch-agent-teams-fixes --check` → 26 regions / 6 files; `bun test packages/mpd-agent-teams-plugin` → **178 pass / 0 fail** (9 consecutive runs); `self-fix-tests` → 53 pass / 0 fail; `bun run typecheck` → clean; `session-start-team.mjs` → PASS (simple 3/3 silent, complex 3/3 one staged team, negative control disarmed).

Rounding note: t49's record says "177 pass / 0 fail"; the settled revision has **178** tests because the follow-up commit `50e6497` added the shipped-path test after t49's evidence was written. The lib pins in t49's record all match the settled revision — only the test-file pin and the count are one revision behind (see R2-F3).

---

## 3. Findings (round 2)

### R2-F1 · **high** · the interjection lane still has no agent-facing surface — and the t49 record claims it does

`problem` — Measured call sites on the settled revision (whole `lib/`, excluding the definitions in `state.js`):

| Symbol | Production caller |
|---|---|
| `appendMailboxDeduped` | `tools.js:1876`, `tools.js:1895` — **wired** |
| `expireInterjections` | `scheduler.js:300` (kick tick) — **wired** |
| `enqueueInterjection` | **none** |
| `decideInterjection` | **none** (the only non-definition hit in `lib/` is the JSDoc line `scheduler.js:231`) |
| `clearMailboxToWatermark` | **none** |
| `readLiveMailbox` | **none** |

So no agent can ask for an interjection, the captain cannot approve or reject one, and no surface can clear a mailbox — the frozen R1 intent ("a member must be able to ASK the captain for permission to interject so errors are caught in time") and the frozen clear-authority rule ("captain may clear any mailbox; a member may clear only its own") are still unimplemented at the tool boundary. The lane is reachable only from tests and the QA script.

`requiredFix` — Decide and implement the tool surface (which tool exposes `enqueueInterjection` / `decideInterjection` / `clearMailboxToWatermark`, and to whom each is authorized) — a design decision, not a mechanical repair. **Correct the record**: `t49`'s completion payload says "R1 is now consumed at the tool boundary; no R1 criterion rests on an unreferenced export" and `evidence/omo-align/messaging/r1-wiring/result.json` repeats it, while the same directory's `dead-capability-findings.md` (written two minutes later) documents the truth. One of the two must be marked superseded so a later reader is not misled into thinking the lane is reachable.

### R2-F2 · **high** · the R1 QA case is RED at the settled revision, caused by the new repost

`problem` — `node skills/dsh-qa/scripts/agent-teams-messaging.mjs` exits **1** on `0f647f2` (`raw/qa-messaging-rerun.log`): `interjection.positive.ok=false`, `requesterInboxAfterRepost:2` (assertion wants 1), `requester:"captain"`. Cause: the new library repost `state.js:721-732` writes `id '<ij>-delivery'` into the requester's inbox, and the case ALSO writes its own repost under the same id (`skills/dsh-qa/scripts/agent-teams-messaging.mjs:419-427`) before asserting `length === 1`.

A/B measured by me: the pre-repair module (`7379e28`) leaves the requester inbox at **0** after `decideInterjection(...,'approved')`; the shipped module leaves **1**. The same case **passed** on the pre-repair revision in round 1 (`evidence/omo-align/review-r1/raw/qa-messaging-rerun.log`, 01:06:38Z). So the case went red **because of this repair**; the case itself is fragile by construction (it writes the very record it then counts), and t49's attribution — "a PRE-EXISTING case defect … A/B measured: identical failure with the only scheduler edit here reverted" — is not supported by an arm that reverts a *scheduler* edit: the repost lives in `state.js`, so that arm cannot change the outcome. `skills/**` really is out of t49's scope, and the fix is already scoped as **t51** — no new slot is needed.

`requiredFix` — Keep t51 as the fix (update the case to assert the **library's own** delivery record rather than writing one, plus the root-cause comment and the `VENDOR_LOCK.json` re-pin in the same commit per §9). Correct t49's cause attribution in its record. Until t51 lands, R1's own falsifiable experiment is red and must not be cited as passing.

### R2-F3 · **medium** · stale settled-hash pin in t49's record (and a stale test count)

`problem` — `evidence/omo-align/messaging/r1-wiring/result.json` pins `test/t49-send-dedup-wiring.test.mjs` at `44acbc827a486546` / 179 lines, but the settled file is `410185dc970b15c4` / 13,029 B — the follow-up commit `50e6497` rewrote it after the record was written. The verify claim "177 pass / 0 fail" likewise describes the pre-`50e6497` suite (now 178 tests, 178/0). Every **lib** pin in that record matches the settled revision, so the substance stands; this is the §7 "verify on settled hashes" slip, on the one file the repair added.

`requiredFix` — Re-pin the test file (or mark the entry superseded by the sweep commit) so a third party comparing hashes is not sent to a revision that no longer exists.

### R2-F4 · **low** · the TTL is bound to idle edges, not to wall-clock

`problem` — The expiry tick lives at the top of `kickMember` (`scheduler.js:293-307`), so it runs on any member's idle edge — but a team that never kicks again after a request leaves the row `pending` past its TTL indefinitely, and the requester is never told. The shipped wording ("TTL 30 minutes", "onCaptainSilence") reads as wall-clock. This matches the accepted fix text ("call `expireInterjections` on the scheduler's idle edge"), so it is a boundary rather than a defect.

`requiredFix` — State the boundary explicitly in the contract/ledger (expiry is evaluated at idle edges, not by a timer), or also tick it once at session start so a dormant team still resolves past-due requests.

### R2-F5 · **low** · one non-reproducible suite failure while the wave was still writing

`problem` — My first `bun test packages/mpd-agent-teams-plugin` run reported **177 pass / 1 fail** (1154 `expect()` calls vs 1156 clean) while the t49 test file was being rewritten by a concurrent writer (mtime `01:35:07Z`, the failing run's window). Nine subsequent runs on the settled revision are 178/0. I could not name the test because that run's log was not preserved; per §7 a run that overlaps a write is not a measurement.

`requiredFix` — None now. If it recurs, capture with `bun test … --reporter=junit --reporter-outfile=…` so the flaky test is named; treat a failure measured during an in-flight write as a non-measurement, exactly as recorded here.

---

## 4. Verdict and recommendation

**needs_revision.** The repair is real and well-evidenced where it landed — the dedup guard, the tombstone/read-marker fix, the expiry notice, the closed decision vocabulary and the call-count proof are all reproduced against the shipped bytes, and the delivery-guard work found and fixed three genuine defects (`R1W-D1..D3`) that no earlier pass had exercised. What keeps this from a pass is scope, not craft: R1's interjection lane still cannot be entered, decided or cleared by any agent, R1's own QA case is red at the settled revision, and the completion payload asserts the opposite of the shipped truth.

Recommended disposition (to avoid burning another slot, and to respect the team's escalated state):

1. **t51 already covers R2-F2** — no new task; just correct t49's cause attribution.
2. **R2-F1 is a tool-surface decision**, not a mechanical repair: escalate it to the user together with the loop-ceiling escalation (which tool exposes ask/decide/clear, and who may clear). Once decided, one implementation slot wires it; R1's round-1 F-1 then closes completely.
3. **R2-F3/F4/F5 are record/wording-level** — no slot, no code.
4. Because a `failed` review slot pins its dependents, release `t47`/`t48` from `t50` the same way `t46` was released (re-create them against the new follow-up slot + a closure verification), or retire this slot after the record correction.

If the captain instead decides to accept R1's lane as a documented, user-visible partial (dedup + expiry + clear discipline delivered and verified; ask/approve wiring deferred by user decision), then the honest form is a new slot that records R1's remaining client-facing clauses as NOT MET — not a re-reading of the criteria.

---

## 5. Commands run by this review

| Command | Result |
|---|---|
| `node evidence/omo-align/review-r2/raw/probe-r2-wiring.mjs` | exit 0 — fold marker / ack-fold / clear-after-ack / expiry notice / decision + repost / V1 / pre-repair A/B |
| `node skills/dsh-qa/scripts/agent-teams-messaging.mjs` | **exit 1** — RED at `0f647f2` (R2-F2); log at `raw/qa-messaging-rerun.log` |
| `bun test packages/mpd-agent-teams-plugin` | exit 0 — 178 pass / 0 fail (9 runs; one earlier 177/1 overlapped a concurrent write, R2-F5) |
| `bun test packages/mpd-agent-teams-plugin/test/t49-send-dedup-wiring.test.mjs` | exit 0 — 7 pass / 0 fail |
| `bun test packages/mpd-agent-teams-plugin/test/r1-message-channel.test.mjs` | exit 0 — 18 pass / 0 fail |
| `bun test packages/mpd-agent-teams-plugin/self-fix-tests` | exit 0 — 53 pass / 0 fail |
| `bun run typecheck` | exit 0 |
| `node scripts/patch-agent-teams-fixes.mjs --check` | exit 0 — 26 regions / 6 files |
| `node skills/dsh-qa/scripts/session-start-team.mjs` | exit 0 — PASS, two-sided + negative control disarmed |
| `git log 7379e28..0f647f2` / `git status --porcelain` | four repair/sweep commits; worktree clean |

Read-only git only: no `add`/`commit`/`checkout`/`reset`/`merge`/`branch`/`tag`. No pre-existing evidence was modified; every artifact above is new under `evidence/omo-align/review-r2/` (round 1's `evidence/omo-align/review-r1/` is untouched). Evidence text is neutralised — no retired external project identifier appears.
