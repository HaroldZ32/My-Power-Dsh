# R1 + R3 adversarial review (round 3) — record correction + dormant expiry

* Task: `t54` (review round 3), attempt 1 — `96f4d5f5-51a3-46df-baf0-fab2af0cae2e`
* Reviewer: **Architect** (read-only; no product file was modified by this review)
* Reviewed task: `t53` (repair round 3) plus the standing R1 / R3 / V1 / t44 / t37-t39 / Option A subjects
* Frozen earlier rounds: `evidence/omo-align/review-r1/`, `evidence/omo-align/review-r2/` (both untouched)
* Anchored revision: **committed `5277be0`** (`b48ffd9 fix(agent-teams): make dormant-team expiry actually resolve, and correct the record it supersedes`)
* Verdict: **pass** — all five of t53's acceptance items are delivered and independently verified; one non-blocking advisory and three open items owned by other tasks are recorded below.

---

## 1. Anchored revision, and the drift I had to work around

The worktree was **moving during this review**: two other tasks are in flight in the same checkout — `t52` (the interjection tool surface: `tools.js` 151,421 → 165,305 B, `state.js` 61,904 → 65,291 B, `mpd-deltas.js` regenerated, new `test/t52-interjection-tools.test.mjs`) and `t51` (the QA case, `skills/dsh-qa/scripts/agent-teams-messaging.mjs` modified). Neither is part of t53 or of this review.

My anchor is therefore the **committed t53 revision**, verified by hashing the commit's own bytes rather than the live tree:

| Reviewed file | bytes | sha256 (prefix) | live tree |
|---|---|---|---|
| `lib/state.js` | 64370 | `4b17c335946bf846` | moved by t52 |
| `lib/scheduler.js` | 31955 | `27cc18b923443c22` | = t53 |
| `lib/session-start.js` | 31187 | `7831f26831c7606d` | = t53 |
| `lib/mpd-deltas.js` | 107046 | `3e34091ca9d805cc` | moved by t52 |
| `lib/tools.js` | 151421 | `4babeddc7b528c1a` | moved by t52 |
| `test/r1-message-channel.test.mjs` | 18027 | `bbceac658b782370` | = t53 |
| `test/t49-send-dedup-wiring.test.mjs` | 13029 | `410185dc970b15c4` | = t53 |
| `test/t53-dormant-expiry.test.mjs` | 7040 | `b80558d6b92f6505` | = t53 |
| `evidence/omo-align/requirements/frozen-contract.json` | 39814 | `3e77e6b842553687` | = t53 |

**Pin verification:** `settled-pins.json` (the new authoritative pin file) matches the commit **9/9** — `git show 5277be0:<path>` reproduces every pinned hash. The two live mismatches I found (`tools.js`, `mpd-deltas.js`) are t52's uncommitted work, not a t53 defect; t53 never touched them.

Review-local artifacts (new directory; nothing pre-existing overwritten): `raw/probe-r3-wiring.mjs` (run twice: against the live tree and against an extracted **t53 lib** via `MPD_STATE_JS`), `raw/probe-r3-verb-ab.mjs`, `raw/measurement-reanchor.json`, `raw/qa-messaging-rerun.log`.

---

## 2. t53's acceptance items — each verified with code + evidence

| # | Item (from t50's round-2 findings) | Verdict | Code + my evidence |
|---|---|---|---|
| 1 | Escalate the tool surface; correct/supersede the t49 record so no later reader concludes the lane is reachable | **delivered** | `frozen-contract.json.openToolSurfaceEscalation` (append-only, see §3) states the question, why it was not implemented, `currentTruth` ("these three primitives still have NO production caller… Nothing may be read as saying the lane is reachable"), the recommendation and slot `t52`. `r1-wiring/result.json` gained a top-level `SUPERSEDED` block naming all three wrong claims (reachability, attribution, stale pins) and what still stands; `findings.md`, `followup-round.md`, `dead-capability-findings.md` gained supersession headers, with `dead-capability-findings.md` marked authoritative. I independently re-derived the truth on the extracted t53 lib: `enqueueInterjection` **0** call sites, `clearMailboxToWatermark` **0**, `readLiveMailbox` **0**, `decideInterjection` only two comment lines (`scheduler.js:231` and the registry mirror) — **no executable caller** for any of them; `appendMailboxDeduped`, `expireInterjections`, `expireInterjectionsEverywhere` do have callers. |
| 2 | Keep t51 as the fix; correct the cause attribution; do not cite the QA case as passing | **delivered** | The case is untouched by t53 and still **RED** — I re-ran it: `exit 1`, `interjection.positive.ok=false`, `requesterInboxAfterRepost=2`, `requester='captain'` (`raw/qa-messaging-rerun.log`). The corrected attribution (the library repost in `decideInterjection` collides with the case's own hand-written repost; the t49 arm reverted a *scheduler* line and so measured nothing) is recorded in the `SUPERSEDED` block and the three supersession headers. Nothing in t53's record cites the case as passing. |
| 3 | Re-pin the stale test-file hash / test count | **delivered** | `settled-pins.json`: 9 files hashed after a 50 s settle window, `t49PinCorrection` records recorded `44acbc827a486546` / 179 lines / "177 pass" against actual `410185dc970b15c4` / 13,029 B / "178 pass", and a three-entry `supersessionChain` explains the revisions. Verified 9/9 against the commit (§1). |
| 4 | State the expiry boundary, **or** also tick at session start | **delivered, both ways** | Boundary: `frozen-contract.json.interjectionExpiryBoundary` (events, never a timer; the dormancy consequence stated; the pre-t53 wording flagged). Implementation: `state.js:773 expireInterjectionsEverywhere` (per-team best-effort, ENOENT-tolerant) + `session-start.js:575-590 installInterjectionExpirySweep`, installed **unconditionally** at the top of `installSessionTeamPolicy` (`session-start.js:483`) so it also runs when `sessionTeamPolicy.mode` is `off`. Tests: `test/t53-dormant-expiry.test.mjs` — I ran it **6 pass / 0 fail**; it covers past-due resolution with **no scheduler kick**, the 1-ms-before-deadline negative control, absent/empty root no-op, the shipped listener itself (driven with the policy OFF), degradation to a warning with the decision preserved, and the durable ordinary-record shape. |
| 5 | Flake guidance (`--reporter=junit` capture; an in-flight write is a non-measurement) | **delivered** | Recorded in t53's evidence; nothing executable to verify. |

**Extra claim verified:** t53 asserted the contract append left every pre-existing key intact. I compared the commit's contract against `0f647f2` as parsed JSON: added keys exactly `['interjectionExpiryBoundary','openToolSurfaceEscalation']`, removed **none**, changed pre-existing keys **NONE**. The append-only discipline held.

---

## 3. Standing acceptance items (unchanged subjects, re-verified on this revision)

* **R3 / gate integrity.** `session-start.js` changed this round, so I diffed it against `0f647f2`: the only changes are the import of `expireInterjectionsEverywhere`, the unconditional `installInterjectionExpirySweep` call, and the new region at the end. All nine gate constants are **byte-identical** (`DELIVERABLE_VERB_PATTERN`, `ACTION_VERB_PATTERN`, `ENUMERATED_LINE_PATTERN`, `CLAUSE_SEPARATOR_PATTERN`, `CLAUSE_ACTION_PATTERN`, the three thresholds, `C_SUBSIGNAL_MIN`) and the trigger predicate `session-start.js:212` is identical. The fresh A/B (pre-R3 `facb2de^` vs this gate, anchored `8cfaef47`→`7831f268`) reproduces the round-1 result exactly: monotone (no verb removals), contract verbatim `true/true`, the two constructed counterexamples still flip silent→team (`Audit the ledger, build the package, verify the output.`; `重构这个模块, 迁移到新接口, 审计日志.`), and **0 flips on the 20 real prompts**. The two-sided gate case re-runs PASS (simple 3/3 silent, complex 3/3 one staged team, negative control disarmed).
* **V1 (this wave's real defect): still closed, on the t53 bytes.** Against the extracted commit `state.js` (`4b17c335`): content-less enqueue → `content:'only a summary'`, readable as pending, decidable; absent id → `does not exist`; malformed-but-present → `MALFORMED`; missing identity → `missing required field "id"`. t44's pre-repair A/B remains a sufficient falsifiability proof (reproduced in round 1; the 5 REPAIR V1 assertions re-pass — r1 file 18/18).
* **R1 mechanisms (all still verified on the t53 bytes):** fold marker transient and never persisted (one surviving row, `dupCount` incremented); a fold cannot re-open an acknowledged record (`readAt` preserved); clear-after-acknowledge → **0 unread / 0 live** with `readAt`/`deliveredAt` preserved on the tombstones; expiry flips `pending→expired` **and** appends exactly one ordinary notice; the decision vocabulary is closed and the approved body is re-posted once as `<ij>-delivery`. The scheduler's `deliverableUnread` still drops both interjections and tombstones.
* **t37/t39 + Option A — re-anchored, same answer.** t53's edit moved the gate file, which stale-anchored the wave's measurement (`probe-output.json` pinned `8cfaef47`). I re-ran the self-contained probe on the shipped gate: anchor **`7831f268`**, same prompts digest `fd43da71…`, **0 of 20 real prompts trigger** (session-start 0/5, follow-up 0/15), false-positive rate 0 → the reading survives and is now anchored on the current file. The judgement therefore carries verbatim: Option A holds formally but the measured risk is under-trigger (the richest session-start prompt produced zero signals: 1 distinct B verb vs 4, 1 distinct C2 verb vs 3), the dataset has no English prompt (rate undefined, n=0) so the bilingual claim is unsupported, and the order stays: positive stratum → English coverage → cheapest-first re-tune (C3 verb-with-object, or `ACTION_VERB_MIN` 3→2) — never the C 2-of-3 bar or `signals >= 1`.
* **Gates re-run (t53 revision):** delta `--check` → 28 regions / 6 files (26 before, +`interjection-expiry-sweep`, +`interjection-expiry-session-start`); plugin **184 pass / 0 fail** (46 files, 1200 expects — 178 before, +6); self-fix **53 pass / 0 fail** (615 expects); `tsgo --noEmit` clean; `session-start-team` PASS.

---

## 4. Advisory (non-blocking; recommend folding into the next scoped change)

**A1 — the sweep is a *per-step* sweep, while its own documentation says "session start".** `installInterjectionExpirySweep` registers on `agent/pre-step` (`session-start.js:576`) with no once-per-agent guard, and that event fires on **every model step** — the module's own gate is the proof, since it needs `settledFor` (`session-start.js:496-498`) to run only once. So the second expiry event is not "a session start in the workspace" (the wording in `interjectionExpiryBoundary.statement` and in the region's comment) but "every pre-step, the first one included". The behaviour is *eager*, idempotent and best-effort, so nothing is broken: the realistic dormancy case resolves, and the cost is a `readdir` plus one read per team on the hottest path in the agent loop. Fix (either): add a per-session guard mirroring `settledFor`, or restate the event as "every pre-step, including the session's first". Worth folding into t52's change, which already touches this area.

---

## 5. Open items — owned by other tasks, not by t53

1. **R1's lane reachability** — `t52` is *in flight* in this worktree right now (`agent_teams_interject_request` / `agent_teams_interject_decide` / `agent_teams_mailbox_clear` are registered in the uncommitted `tools.js`, calling `enqueueInterjection` / `readPendingInterjections` / `decideInterjection` / `clearMailboxToWatermark`). Uncommitted and therefore **not reviewed here**; the round-2 blocker closes when it lands with its own review/verification.
2. **The R1 QA case is still red** (`t51`, also in flight — the case file is modified in the tree). Until it lands, R1's own falsifiable experiment must not be cited as passing; nothing in this review does.
3. **Wave-level**: with the lane unwired at the reviewed revision and the case red, R1's client-facing completeness claim belongs to the integration slot (`t47`) once t51/t52 are closed.

---

## 6. Verdict

**pass.** t53 did exactly what round 2 required: it did not invent an interface inside a repair round — it escalated the decision into the frozen contract with the truth stated, corrected every wrong claim in the t49 record with an authoritative reading, re-pinned the revision (verified 9/9 against the commit), implemented the dormancy half of the expiry contract with a real test and negative controls, and stated the boundary. I could not falsify any of its five acceptance items, and the gate/R3/V1 substance survives the edit. What remains open is either another task's in-flight work (t51, t52) or a design decision the user now owns — neither is a t53 failure.

---

## 7. Commands run by this review

| Command | Result |
|---|---|
| `git show 5277be0:<9 pinned files> \| sha256sum` vs `settled-pins.json` | 9/9 match |
| `git archive 5277be0 -- …/lib` + call-site scan + `node …/probe-r3-wiring.mjs` (`MPD_STATE_JS`) | exit 0 — lane has 0 executable callers; fold/clear/expiry/decision/V1 all as expected **on the t53 bytes** |
| `node evidence/omo-align/review-r3/raw/probe-r3-verb-ab.mjs` | exit 0 — monotone, contract verbatim, 2 counterexample flips, 0/20 real flips (anchor `7831f268`) |
| `node evidence/omo-parity-rate/raw/probe.mjs --json` | exit 0 — re-anchor: `7831f268`, 0/20 triggers, FP rate 0 |
| `bun test packages/mpd-agent-teams-plugin/test/t53-dormant-expiry.test.mjs` | exit 0 — 6 pass / 0 fail |
| `bun test packages/mpd-agent-teams-plugin/test/r1-message-channel.test.mjs` | exit 0 — 18 pass / 0 fail |
| `bun test packages/mpd-agent-teams-plugin` | exit 0 — 184 pass / 0 fail |
| `bun test packages/mpd-agent-teams-plugin/self-fix-tests` | exit 0 — 53 pass / 0 fail |
| `bun run typecheck` | exit 0 |
| `node scripts/patch-agent-teams-fixes.mjs --check` | exit 0 — 28 regions / 6 files |
| `bun skills/dsh-qa/scripts/session-start-team.mjs` | exit 0 — PASS, two-sided + negative control disarmed |
| `node skills/dsh-qa/scripts/agent-teams-messaging.mjs` | **exit 1** — RED at the t53 revision (t51's fix in flight) |
| `git diff 0f647f2 -- …/session-start.js` + constant-by-constant comparison | gate code byte-identical; only the sweep was added |

Read-only git only (`log`/`show`/`diff`/`archive`/`status`); no `add`/`commit`/`checkout`/`reset`/`merge`/`branch`/`tag`, no writes outside `evidence/omo-align/review-r3/`. Earlier rounds' evidence is untouched. Evidence text is neutralised — no retired external project identifier appears.
