# R1 + R3 adversarial review (round 1) — interjection/message channel and verb-table harmonisation

* Task: `t46` (round 1, rebuilt slot replacing the destroyed `t41`), attempt 2 — `ff68ce57-411c-4ee5-9888-43bcd7bbf813`
* Reviewer: **Architect** (read-only; no product file was modified by this review)
* Reviewed tasks: `t35` (R1+R3 implementation, pass), `t36` (skills QA case + corpus re-pin), `t37`/`t39` (false-positive measurement), `t44` (V1 closure verification, pass)
* Revision pinned by measurement: `dev` @ **`7379e28`**; worktree clean for every reviewed path (only untracked `evidence/**` present)
* Verdict: **needs_revision** — the V1 repair is genuinely closed and R3 is correctly executed, but R1's delivery-facing acceptance criteria are not satisfied by any shipped code path, and one delivered clear primitive will corrupt the scheduler's auto-delivery path the moment it is wired.

---

## 1. Anchored revision and artifacts

| Reviewed file | bytes | sha256 |
|---|---|---|
| `packages/mpd-agent-teams-plugin/lib/state.js` | 57791 | `fa7fe937f1895c472732fdfdc0b193fcb2281448133fd0b15a490f230fe0ae19` |
| `packages/mpd-agent-teams-plugin/lib/scheduler.js` | 30673 | `f9ec4a226511b420c660673ccc1838b99fa4c0ac548f4b0f19e0fcf865109011` |
| `packages/mpd-agent-teams-plugin/lib/tools.js` | 149196 | `026e2ffca86e1254005254144d4c5f4f38dce6c538777f98b0e8217f92db2dcb` |
| `packages/mpd-agent-teams-plugin/lib/session-start.js` | 28432 | `8cfaef47e9959ef7def01003640f768ff4befa50e9c202ff692a0629ca0a2aa6` |
| `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js` | 92290 | `da091a4aeb6d07fcef169a596dd76b04e9e653d949586d2eed262c00f44571dd` |
| `packages/mpd-agent-teams-plugin/test/r1-message-channel.test.mjs` | 13438 | `d6914ec0423df3cf9a7a8565793a5fae0d386fd71c9c3eca191fcb74b15c2639` |
| `packages/mpd-agent-teams-plugin/test/r3-view-parity.test.mjs` | 5952 | `2dd5028053cfa61e18d76da8892a189fe073345712b752c327df59d1cdc17729` |
| `evidence/omo-align/requirements/frozen-contract.json` | 35174 | `09949c8095d7ccd533329b114a2ef22bad1ce81bd24338240e68cfd0fd66be41` |

Pre-R3 module used for the A/B measurement: `facb2de^` → `session-start.js` 27208 B / `b79bde7c87cc2a6c899a3e4c0e9685c0b6e26fb0d3dfdc80f1383c385b5d623e`
(materialized into a temp package copy, imported side by side, copy deleted afterwards — no stale product copy is kept in evidence)

Review-local artifacts (new directory; nothing pre-existing was overwritten):

| Artifact | What it is |
|---|---|
| `raw/probe-r1-wiring.mjs` / `raw/probe-r1-wiring.out.json` | static call-site scan + shipped-module probes (dedup, tombstone, resurrection, V1, expiry) |
| `raw/probe-r3-ab.mjs` / `raw/probe-r3-ab.out.json` | pre-R3 vs shipped gate on 6 calibration + 20 real + 3 constructed prompts; verb-set transcription |
| `raw/qa-messaging-rerun.log` | my own re-run of the delivered QA case on the measured revision |

Method rule applied throughout: every claim below is a **measured observation on the shipped bytes at the hashes above**, never a restatement of the implementer's evidence. The only two things read rather than executed are `frozen-contract.json` (an authority input) and the source lines quoted with a `file:line`.

---

## 2. Verdict

**needs_revision.** Three of the R1 acceptance criteria (R1-1's end-to-end clause, R1-3, R1-4) are unmet in the shipped runtime; R1-2's "clear" is met as a primitive but carries a defect that makes it unsafe to wire. R3 and the V1 repair pass, and I found nothing that falsifies either of them.

The wave's own records are honest about part of this (`t35` lists "approval→next-step-boundary delivery not driven" and "tool authorization not wired" as unverified; `t44` repeats the delivery limitation as a residual risk). What the records do **not** say, and what this review establishes, is the size of the gap: **every R1 primitive except its own definition has zero call sites in the shipped runtime**, so no agent-facing surface can create, decide, clear or expire anything, and the shipped send path still delivers duplicates. Evidence: §4 F-1.

---

## 3. Acceptance-by-acceptance (t46 criterion → code location → evidence → status)

### R1-1 idempotent dedup — **PARTIAL (primitive PASS, shipped behaviour FAIL)**

* Code: `state.js:485` `appendMailboxDeduped` (key `state.js:473` `messageDedupKey` = `from + to + content`; window `state.js:465` = 60 s); shipped send path `tools.js:1871` (captain) and `tools.js:1887` (member) call **`appendMailbox`**, and `tools.js:15` does not import `appendMailboxDeduped` at all.
* Measured (`raw/probe-r1-wiring.out.json`): three identical `(from,to,content,ts)` sends through `appendMailbox` → **3 records, 3 unread**; the same three through `appendMailboxDeduped` → 1 record, `dupCount` 3, 1 unread.
* Negative control (different sender) and window control (outside 60 s) are genuinely correct in the shipped test (`test/r1-message-channel.test.mjs:63`, `:78`) and my re-run is 13/13 green.
* Status: the criterion's operative clause "N sends inside the window delivers AT MOST once" is **false for the shipped channel**. It is true only for a function nothing calls.

### R1-2 bounded clear (tombstone + sidecar + audit, no hard delete) — **PASS as a primitive, BLOCKED as a feature**

* Code: `state.js:508` `clearMailboxToWatermark` — archive-first write to `inbox/archive/<agent>.<watermark>.jsonl`, then in-place tombstones, and one `{kind:'mailbox-cleared'}` audit object; `state.js:544` `readLiveMailbox` filters `tombstone !== true`.
* Measured: sidecar contains the cleared bytes (246 B for 3 records), tombstone row shape `[id,from,to,content,ts,tombstone,clearedAt,clearedToWatermark,archivedTo]`, `readLiveMailbox` → 0, **no hard-delete branch exists** (the clear only ever rewrites).
* Status: **PASS** on all three clauses and on the negative control — but zero call sites (F-1), and it must not be wired before F-3 is fixed.

### R1-3 interjection requests: pending not delivered / approval delivery / TTL expiry + notify — **FAIL (2 of 3 clauses absent)**

* Code: `state.js:568` `enqueueInterjection` (own lane `state.js:469`, `kind` `state.js:471`, `status:'pending'`, `expiresAt = ts + 30 min`), `state.js:629/637/645/655` read/expire/decide; scheduler guard `scheduler.js:235` `deliverableUnread`, applied at `scheduler.js:303` and `:366`.
* **Pending is not auto-delivered — PASS at code level.** `deliverableUnread` drops `kind === INTERJECTION_KIND` on both shipped unread reads, and the delivered QA case's own negative control (same record with a spoofed `kind` becomes deliverable) shows the predicate is falsifiable. Note the production effect is nil: requests live in their own lane file, so no ordinary reader would ever see them anyway — this is defence in depth, not a live gate.
* **Delivery after approval — ABSENT.** `decideInterjection` (`state.js:655`) only rewrites `status`; nothing re-posts the request. The scheduler comment `scheduler.js:230-231` asserts that "`decideInterjection(..., 'approved')` re-posts them as an ordinary message" — that statement is **false about the shipped code**. The delivered QA case does not exercise a product re-post either: it performs the re-post itself at `skills/dsh-qa/scripts/agent-teams-messaging.mjs:419-427` (`state.appendMailbox(ijRoot, TEAM, requesterKey, {...ordinary, to: requesterKey, id: 'ij-1-delivery'})`) and then asserts the message it just wrote. Its own summary field `requesterInboxAfterRepost: 1` is therefore evidence about the QA script, not about the plugin.
* **TTL expiry + requester notification — ABSENT.** `expireInterjections` (`state.js:645`) flips `pending → expired` correctly (measured: before TTL `[]`, at TTL `['ij-ttl']`, `status:'expired'`, `from` preserved), but it has **no caller**, and nothing is written to the requester: measured requester-inbox record count after expiry = **0**. Its own docstring `state.js:643-645` claims "the requesting member is notified (status `expired`)" — the code does not notify. This is F-2.
* Status: **FAIL** — 1 of 3 clauses holds, and the two that fail are exactly the ones that make the feature usable.

### R1-4 "duplicate delivery does not double the member's actions" — **FAIL (no evidence exists)**

* `grep -rn "call count|callCount|not double|redeliver"` across `packages/mpd-agent-teams-plugin/test/`, `self-fix-tests/` and the messaging QA case → **0 hits**. Nothing asserts that a redelivery does not double an `agent_teams_update_task` call, and nothing can while dedup is unwired (F-1). See F-5.

### R3 verb-table harmonisation — **PASS**

* Code: `session-start.js:98` `ACTION_VERB_PATTERN` (C2, count anywhere) and `:114` `CLAUSE_ACTION_PATTERN` (C3, positional clause opening); thresholds untouched at `:116-122`, trigger at `:212` still `explicitFlag || signals.length >= 1`.
* Measured verb sets (`raw/probe-r3-ab.out.json`): C2 EN = 14 verbs incl. `audit`; C3 EN verb-only = the **same 14** (C3's extra tokens are the conjunctions `and|then|also`); C2 CJK = C3 CJK = the same 12. Additions vs pre-R3: C2 gained EN `audit` + CJK `对齐,重构,迁移,审计,移植,梳理,全量`; C3 gained EN `consolidate, overhaul, port`; **removals: none**. So the declared "identical verb set, only the role differs" holds, and the delta is **monotone** — on a fixed text the signal set can only grow, so R3 can add triggers and can never remove one.
* Contract transcription is exact: `frozen-contract.json` → `complexityGate.signals.C_enumeratedSteps.harmonizedVerbTables.shippedEnglish/shippedCjk` equal the shipped tables (both `true`), and the contract's C2 verb list equals the shipped C2 set; `logicRevisionNote` records Option A **and** the R3 harmonisation. One transcription gap outside the R3 acceptance scope: the contract's C1 detect string `^\s*(\d+[.)]|[-*])\s` omits the shipped `|` (table-row) alternative, and the C3 prose ("clauses that each pair an action verb with an object") describes a looser test than the shipped positional match — F-7.
* Behaviour on the calibration set is unchanged (my A/B, both arms): simple 3/3 silent, frozen complex #1 and #3 trigger on C. (`frozen-complex-2` reads `false` in this direct-call table only because `team:` is consumed into `explicitFlag` upstream of `evaluateComplexityGate`; the shipped two-sided case covers it.)

### Contract consistency (`logicRevisionNote` / `harmonizedVerbTables`) — **PASS** (see R3 above; `harmonizedVerbTables` exists as a nested object under `signals.C_enumeratedSteps`, not at the top level of `complexityGate`).

### t37/t39 measurements incorporated + Option A judgement — see §7.

---

## 4. Findings

### F-1 · **blocker** · R1 ships uncalled primitives; the delivery-facing acceptance criteria are unmet

`problem` — Every R1 primitive has a definition and unit tests but **no call site in the shipped runtime**. Static scan over `tools.js`, `scheduler.js`, `members.js`, `index.js`, `quality-gates.js`, `harness-compat.js` (`raw/probe-r1-wiring.out.json.staticWiring`):

| primitive | defined at | runtime call sites |
|---|---|---|
| `appendMailboxDeduped` | `state.js:485` | **0** |
| `clearMailboxToWatermark` | `state.js:508` | **0** |
| `readLiveMailbox` | `state.js:544` | **0** |
| `enqueueInterjection` | `state.js:568` | **0** |
| `expireInterjections` | `state.js:645` | **0** |
| `readPendingInterjections` | `state.js:637` | **0** |
| `readInterjections` | `state.js:629` | **0** |
| `decideInterjection` | `state.js:655` | 0 real (the single hit is the JSDoc line `scheduler.js:231`) |

Consequences, each measured: the shipped `agent_teams_send_message` (`tools.js:1815`) appends with `appendMailbox` (`tools.js:1871`, `:1887`) → 3 identical sends = 3 deliveries; no surface can enqueue or decide a request; the clear cannot be invoked; expiry never runs. No agent can reach any R1 capability, so R1's acceptance cannot be satisfied by the delivered system, only by its library.

`requiredFix` — Do one of these, explicitly, in this wave: **(a)** wire R1 — move `tools.js:1871/1887` to `appendMailboxDeduped`; add the interjection enqueue/decide surface with the frozen authority rule (captain may clear any mailbox, a member only its own); re-post on `approved` through the member-prompt queue seam at the next step boundary (never harness `sendMessage`-steer); call `expireInterjections` on the scheduler's idle edge; **or** **(b)** if wiring is a separate wave, record R1-1 (operative clause), R1-3 and R1-4 as **NOT MET** in the ledger and in the parent task's result, and open a new task whose `inScope` names `lib/tools.js` + `lib/scheduler.js` — do not leave them `passed`.

### F-2 · **high** · expiry has no caller and no notification, while its docstring promises one

`problem` — `expireInterjections` (`state.js:645`) is never called; its docstring (`state.js:643-645`) states "the requesting member is notified (status `expired`)" but the function only rewrites `status`/`decidedAt`. Measured: after expiry the requester's inbox holds **0** records. A member who asks for permission and never gets an answer therefore learns nothing — the frozen R1 decision `onCaptainSilence` requires "default DENY + TTL 30 minutes + notify the requesting member (status expired)".

`requiredFix` — Append an ordinary message to `record.from` inside the expiry path (or in the caller that expires), and drive `expireInterjections` from a real tick (scheduler idle edge / session start). Keep the row-level `status:'expired'` as is.

### F-3 · **high** · a clear resurrects already-acknowledged records into the scheduler's auto-delivery path

`problem` — `clearMailboxToWatermark` (`state.js:508`) replaces each cleared row with a tombstone that keeps `id/from/to/ts` but **drops `readAt`/`deliveryClaimedAt`**; `readUnreadMailbox` (`state.js:717`) filters on `readAt === undefined` and — unlike `readLiveMailbox` (`state.js:544`) — does **not** filter `tombstone !== true`; the scheduler's two delivery reads go through `readUnreadMailbox` + `deliverableUnread` (`scheduler.js:303`, `:366`), and `deliverableUnread` (`scheduler.js:235`) only drops `kind === INTERJECTION_KIND`. Measured: 2 acknowledged records (unread 0) → one clear to watermark → **2 unread, 2 deliverable**, tombstone keys `[id,from,to,content,ts,tombstone,clearedAt,clearedToWatermark,archivedTo]`; likewise 3 uncleared records → 3 deliverable empty-content tombstones. Today this is latent only because the clear has no caller (F-1); it becomes a message storm of empty prompts the moment one is added. It also means the delivered claim "after clear the read returns only the tombstone" is true of `readMailbox`/`readLiveMailbox` but false of the reader the scheduler actually uses.

`requiredFix` — Filter `tombstone !== true` inside `readUnreadMailbox` (or in `deliverableUnread`), and do not let a tombstone re-open an acknowledged record (keep `readAt`, or carry an explicit `clearedAt` exclusion). Add the regression test "after a clear: 0 unread, 0 deliverable" — this is the exact test that would have caught it.

### F-4 · **medium** · `decideInterjection` accepts any decision string and persists it as `status`

`problem` — `state.js:655` writes `status: decision` verbatim. Measured: decision `'banana'` → `status:'banana'`; the row then leaves `readPendingInterjections` (which filters `status === 'pending'`, `state.js:637`) without being approved or rejected, and a later real decision is refused with `is already banana`. This is V1's "returns a value nobody can act on" class, relocated to the decision side — and there is no tool layer (F-1) to constrain the argument.

`requiredFix` — Allow-list `{approved, rejected}` and reject anything else loudly, naming the allowed values.

### F-5 · **medium** · R1-4 has no evidence anywhere

`problem` — The frozen criterion "duplicate delivery does not double the member's actions (assert the task-update call count does not double on redelivery)" is not asserted by the shipped test, the self-fix tests or the QA case (grep: 0 hits). With dedup unwired it is also unmeasurable, so its `passed` status rests on nothing.

`requiredFix` — Once F-1(a) lands, assert it end-to-end at the tool boundary: two identical `agent_teams_send_message` calls inside the window → exactly one scheduler delivery and exactly one `agent_teams_update_task`. Record the call count, not the intent.

### F-6 · **low** · acceptance wording vs shipped record count

`problem` — The frozen acceptance text reads as "the durable JSONL still holds all N records folded with `dupCount=N`"; the shipped primitive keeps **one** record (`test/r1-message-channel.test.mjs:55` asserts `length === 1`; my probe confirms 1). The `t35` record discloses the real shape, so this is a spec-text divergence rather than a concealed one, but a later auditor reading the criterion literally will fail working code, or — worse — "fix" the primitive to keep N records and re-open the duplicate-delivery path.

`requiredFix` — Record the operative reading ("at-most-once delivery; one surviving record; N stored in `dupCount`") as a pin-only wording addendum to the requirements text. Do not change the primitive.

### F-7 · **low** · two contract-transcription gaps in the C row (not introduced by R3)

`problem` — `complexityGate.signals.C_enumeratedSteps.detect` transcribes C1 as `^\s*(\d+[.)]|[-*])\s` while the shipped pattern (`session-start.js:100`) is `^\s*(?:\d+[.)]|[-*|])\s` — the table-row `|` alternative is missing; and the C3 prose describes "clauses that each pair an action verb with an object" while the shipped test (`session-start.js:114`) is positional: a clause whose first token (optionally after `and|then|also`) is a verb. The C2/C3 **verb lists** are verbatim in both directions (measured), so the R3 acceptance item itself is met.

`requiredFix` — Transcribe C1 exactly, and restate C3 as "a clause whose FIRST token, optionally after `and|then|also`, is an action verb". Pin-only; no code change.

---

## 5. V1 closure and t44's falsifiability proof — **CLOSED, and the proof is sufficient**

Independently reproduced on the shipped revision (`state.js` `fa7fe937…`, my own driver, not the verifier's):

| call | observation |
|---|---|
| `enqueueInterjection({id,from,summary,reason,location,ts})` — **no `content`** | returns `status:'pending'`; stored content = `"only a summary"`; `readPendingInterjections` = 1; `decideInterjection(...,'approved')` → `approved` |
| `decideInterjection('nope', …)` (absent) | throws `interjection "nope" does not exist` |
| `decideInterjection('broken', …)` (row on disk, fails the shape check) | throws the `MALFORMED` message; the normal reader still sees 0 such rows |
| expiry | before TTL `[]`; at TTL `['ij-ttl']`, `status:'expired'`, `from` preserved |

The invisible-record path is closed: a content-less request is now normalized, readable and decidable, and absence is distinguishable from corruption by two different errors. **`t44`'s falsifiability method is sufficient for the V1 defect**: it runs the implementer's own 13-assertion file against the pre-repair module (8 pass / 5 fail) and against the shipped module (13 pass / 0 fail), which demonstrates defect-sensitivity of exactly the five REPAIR V1 assertions rather than asserting non-tautology; I re-ran that file on the measured revision and got **13 pass / 0 fail**.

Scope caveat (not a defect in t44's verdict): the A/B proves the five assertions are sensitive to *that* repair, not that the file covers the **class**. F-4 is a live member of the same class on the decision side and is not covered by the V1 set — so "V1 is closed" is correct, "this failure class is exhausted" is not.

---

## 6. R3 behaviour boundary — counterexamples and measured delta

A/B measurement, pre-R3 module materialized from `facb2de^` (`b79bde7c…`) and imported side by side with the shipped module:

* Frozen calibration set: **no change** — simple 3/3 silent, complex #1/#3 trigger on C in both arms.
* The 20 real bilingual prompts (`evidence/omo-parity-rate/raw/prompts.jsonl`, digest `fd43da71…`): **0 flips, 0 triggers in both arms** — the harmonisation changed nothing on the measured population, so the measured 0/20 is not an artifact of R3.
* Constructed boundary counterexamples — exactly two flips, both **silent → team** (so R3 widens the false-positive surface; nothing can narrow it, per the monotonicity measurement):

| prompt | pre-R3 | shipped | why |
|---|---|---|---|
| `Audit the ledger, build the package, verify the output.` | silent (C3 = 3 clauses, C2 = 2 distinct verbs → C not satisfied) | **team** (signals `['C']`: C2 = 3 because `audit` joined the count-anywhere table, C3 = 3) | the `audit` addition to C2 supplies the second C sub-signal |
| `重构这个模块, 迁移到新接口, 审计日志.` | silent (C3 = 3, C2 = 0 — the pre-R3 C2 CJK set held only 设计/实现/验证/改造/补充) | **team** (signals `['C']`: C2 = 3) | the 7 added CJK verbs turn the same sentence into a C2 match |

Reading: the new boundary is "three clauses that open with an action verb, where at least one distinct verb is `audit` (EN) or one of the 7 newly added CJK verbs". The EN example is an ordinary multi-step instruction list, i.e. the same accepted-cost class the contract already ledgers for `Check the test, build the package, verify the output.` (which routes in **both** arms, unchanged). The change is therefore consistent with the approved intent, and it is correctly shipped as a behaviour change with an isolated mount proof, a two-sided gate and a verbatim contract transcription.

---

## 7. Does Option A still hold? (incorporating t37/t39)

**Formally yes; empirically it is calibrated in the wrong direction, and the data to retune it does not exist yet.** The facts I am judging on (from `evidence/omo-parity-rate/result.json`, on pinned copies whose `session-start.js` `8cfaef47…` is byte-identical to the revision I measured):

1. **0 of 20 real prompts trigger** (session-start 0/5, follow-up 0/15) under the post-R3 tables — and my A/B confirms R3 contributed none of those zeros.
2. The richest session-start prompt — an explicit alignment ask that names several targets and asks for auto-invocation on complex tasks — produced **zero signals**: 1 distinct B verb against a threshold of 4, 1 distinct C2 verb against a threshold of 3. The probe's control (frozen complex #1/#3 trigger, simple 3/3 silent) rules out a broken probe, and I re-derived that control independently.
3. `latinOnly: 0` — the dataset has **no English prompts**, so the English trigger rate is undefined (n = 0) and the bilingual claim is unsupported (`team-compaction-contract.json:55` records this as the t39 F2 finding).
4. The session-start stratum is 5 samples, so its 95% false-positive bound is ≈46% — the 0/20 result cannot distinguish "gate is well calibrated" from "gate is dormant" on the positive side.

So the accepted cost of Option A (ordinary multi-clause instruction lists routing) is real but currently **unobserved**, while the measured failure is the opposite one: a genuinely complex request missed. This does not falsify Option A — it is the ratified predicate and R3/V1 did not weaken it — but it means Option A's *stated* risk is not the risk this population exhibits, and any retune would be unauditable without new data.

**Executable recommendation, in priority order (no threshold change yet):**

1. **Build a positive stratum first.** Collect ≥10 real *complex* session-start prompts (the existing sample found no positive case at all). A gate that never fires cannot be calibrated by counting false positives; today's evidence can only bound the false-positive rate from above.
2. **Fix the English coverage.** Add English prompts to the recalibration set or drop the bilingual claim (`latinOnly: 0`). Do this before any threshold comparison across languages.
3. **Only then re-tune, cheapest-change-first:** the C sub-signal most likely to match real multi-step asks is C3 (positional clause opening) — relaxing it to "verb with an object" or lowering `ACTION_VERB_MIN` from 3 to 2 raises recall on the missed class; each candidate must be re-run through the two-sided gate on **both** strata (calibration set + positive stratum) with the negative control disarmed.
4. **Do not touch** the C 2-of-3 majority or the `signals >= 1` trigger in the same pass: those are what would start routing ordinary prompts, and they carry the only measured cost.
5. **Record R3's new boundary** (the two counterexamples in §6) in the accepted-cost text, which currently names only the pre-R3 class, so the ledger describes the surface that actually ships.

---

## 8. Top regression risk

**`clearMailboxToWatermark` + the scheduler's unread path (F-3).** R1's whole point is to make the clear reachable, so the very next change will wire it — and that change turns a correct-looking primitive into repeated empty prompts to members whose messages were already read. It is exactly the kind of defect that stays invisible in headless QA: the delivered QA case asserts the clear's own contract (`readMailbox`/`readLiveMailbox`) and never asks the scheduler's reader what it would deliver.

Prevention (all three are cheap): filter `tombstone !== true` in `readUnreadMailbox`; keep or re-derive the read/claimed markers on the tombstone; and add the seam test **"cleared mailbox ⇒ `deliverableUnread(readUnreadMailbox(...))` is empty"** to `test/r1-message-channel.test.mjs` (it is a two-line assertion that fails today). Second-order risk to watch: the comments that describe unwired behaviour (`scheduler.js:230-231`, `state.js:643-645`) — they read as specifications and will mislead the next implementer into believing delivery and notification already exist. Fix the comments in the same change that fixes F-1/F-2.

---

## 9. What the delivered work got right (for the ledger)

* R3 is a clean, honest behaviour change: declared as such, monotone, verbatim in the contract, with an isolated mount proof and the threshold untouched.
* The V1 repair closed the exact defect and came with a genuine A/B falsifiability proof — the strongest evidence artifact in this wave.
* The clear is archive-first with no hard-delete branch, and my probe could not falsify that claim.
* The scheduler's `deliverableUnread` guard is wired on **both** unread reads and its negative control (spoofed `kind` → deliverable) makes it falsifiable.
* The wave's own records disclosed the delivery limitation rather than hiding it; this review's job was mainly to size it and to add the defects that the module-level tests structurally cannot see (F-3, F-4).

---

## 10. Commands run by this review

| Command | Result |
|---|---|
| `node evidence/omo-align/review-r1/raw/probe-r1-wiring.mjs` | exit 0 — wiring scan + 5 probe families (§3, §4) |
| `node evidence/omo-align/review-r1/raw/probe-r3-ab.mjs` | exit 0 — pre-R3 vs shipped A/B over 29 prompts (§6) |
| `bun test packages/mpd-agent-teams-plugin/test/r1-message-channel.test.mjs` | exit 0 — 13 pass / 0 fail |
| `bun test packages/mpd-agent-teams-plugin/test/r3-view-parity.test.mjs` | exit 0 — 4 pass / 0 fail |
| `node skills/dsh-qa/scripts/agent-teams-messaging.mjs` | exit 0 — PASS on `7379e28` (`state.js` `fa7fe937…`, `scheduler.js` `f9ec4a22…`), log at `raw/qa-messaging-rerun.log`; its repost step is performed by the script (§3 R1-3) |
| `git rev-parse --short HEAD` / `git status --porcelain` | `7379e28` / clean for all reviewed paths |
| `git show facb2de^:…/session-start.js` | pre-R3 module for the A/B (`b79bde7c…`) |

Read-only git only: no `add`/`commit`/`checkout`/`reset`/`merge`/`branch`/`tag` was run. No pre-existing evidence file was modified; every artifact above is new under `evidence/omo-align/review-r1/`.
