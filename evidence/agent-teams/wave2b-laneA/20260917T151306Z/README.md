# t43 — T-92 alone: the absence-pin half, closed with COMMENTS-STRIPPED matching (+ the audit re-taken)

**Task:** `t43` (impl-A/4a, attempt 2, attempt_id `85242078-f22c-4176-9fec-a74b426d4cbb`).
**Verify (contract):** `bun test ./packages/mpd-agent-teams-plugin` → **269 pass / 0 fail / 2380 expect()
calls / 40 files, exit 0**.

*Attempt-id note, measured:* the dispatch carried attempt 1 `33f83ae9…`; the claim minted **attempt 2**
`85242078…`. Updates use the id the CLAIM returned (the platform's live capability); the dispatch's id was
already superseded when it was generated.

## 1. The defect, reproduced end-to-end (RED), then closed (GREEN) — both readings on disk

| reading | seed | result |
|---|---|---|
| **RED, before the fix** | a COMMENT appended to `lib/tools.js`: `// … this COMMENT mentions watchdogHoldOf and mpd-delta watchdog-hold-reader` | `(fail) D2: the two tool-boundary guards and tools.js's reader copy are gone; scheduler keeps its own` — **prose alone reddened the pin** (`red-seed-comment-before.out.txt`) |
| **GREEN, after the fix** | the SAME comment seed | **exit 0** — the pin stays green on prose (`green-seed-comment.out.txt`) |
| **NEGATIVE CONTROL** | a CODE seed: `const watchdogHoldOf = 1;` | **exit 1**, and the failure names the pin (`expect(toolsCode).not.toContain("watchdogHoldOf")`) — a "fix" that stripped code as well would pass here, so the control is real (`control-seed-code.out.txt`) |

`lib/tools.js` was restored byte-identical after EVERY seed (`39d77fe6…` before, during and after —
verified by sha256 inside the same script), so the seeds cannot hide in the delivered tree.

## 2. The sweep, and its exact reach (what was changed, and what the fix could not hide)

- **5 file-text absence pins**, in 2 files, all under `self-fix-tests/`:
  `tool-boundary-hold-and-contract-seat.test.mjs` — 4 pins against `lib/tools.js`
  (`watchdogHoldOf`, `mpd-delta watchdog-hold-reader`, `watchdog-hold-reader`, and the `${id}`
  region-id loop pin); `pool-capability-guard.test.mjs` — 1 pin against the materialized copy of
  `lib/scheduler.js`.
- **The fix:** `self-fix-tests/lib-absence.mjs` (NEW) exports `stripComments()`/`codeOf()`; the absence
  pins read the subject's **comment-stripped** view (`toolsCode = codeOf(tools)`,
  `codeOf(materialized)`), while PRESENCE pins keep the raw text. String literals are kept (a literal is
  code); `//` and `/* … */` are removed with quoted strings skipped.
- **The `test/**` half under the bounded grant:** the `test/**` corpus was scanned READ-ONLY (17 of the
  42 occurrences) and **no pin there is in the class** — every one asserts against a VALUE (an array, a
  string, a parsed record), where comments do not exist. That is the reading, not a skip.
- **A bound, named not smoothed:** the audit's AUTOMATIC subject-scoped set is **3** (it follows
  `const X = readFileSync(join(libDir, …))` and then `const Y = codeOf(X)`); the BROADENED manual scan
  found the other two (the `${id}` loop pin, whose literal is a variable, and the `materialized` copy,
  whose subject is a `readFileSync(...).replace(...)` expression). All five were swept; the instrument
  sees three automatically, and that gap is declared here rather than implied.

## 3. The audit, REUSED then re-taken (`audit.mjs`, §8's scope rule)

`evidence/agent-teams/wave2b-notes/20260917T091500Z/2b-refinements.md` §8 is the instrument
("an absence assertion must be evaluated against the file its SUBJECT came from, not against the tree");
`audit.mjs` in this directory re-implements that rule and RE-TAKES its readings at this revision.

| reading | BEFORE the fix | AFTER the fix |
|---|---|---|
| `not.toContain(` occurrences (no file-type assumption) | **42** (25 `self-fix-tests` + 17 `test`) | **42** (25 + 17) |
| literal-bearing arms parsed | 28 | 27 |
| subject-scoped over module sources (automatic) | 3 | 3 |
| reddened on the FULL text | 0 | 0 |
| reddened on CODE-only | 0 | 0 |
| comment-only hits | 0 | 0 |

**BOTH matcher-error directions, re-derived on lane A's OWN corpus (never inherited):**
- **over-report:** testing the literal-bearing arms tree-wide (subject binding ignored) covers 27–28 arms
  where only **3** are subject-scoped — §8's trap 1, re-measured in this task's own unit (arms, not
  "reddened": the wave-2a note's `16` was measured in a different unit and is NOT quoted as mine).
- **under-report:** a `*.mjs`-only glob reads **32** occurrences over 34 files, against **42** over 41 with
  no extension assumption — §8's trap 2 reproduced exactly, including its 32/42 pair.

**One self-application, recorded:** the audit's raw occurrence counter counts a mention inside a COMMENT.
The first wording of `lib-absence.mjs`'s own header contained the literal `not.toContain(`, which moved
the corpus reading 42 → 43. The wording was reworked (not the counter) so the row's unit keeps its clean
value, and the instance is kept in this record because it is T-92's own class appearing in the audit's
unit — a count of occurrences is a TEXT count and must say so.

## 4. Registry placement rules and the cross-lane reading

- **No registered region was touched** (the sweep is `self-fix-tests/**` only) — stated as the vacuity it
  is. The baseline readings are therefore the evidence: `--check` **exit 0** at **96 regions / 10 adopted
  files** (registry `464610bcad077c85aaeb98469a45c399fd08dd38ce9004e7bae45c59ad8d66c0`, unchanged), and
  the **strip/heal suite 21 pass / 0 fail** (`heal-after.log`) — `--check` alone is NOT registry health,
  which is why both are here. `--write-registry` was NOT run (nothing to register), and the deltas doc's
  count sentence did not move because the count did not.
- **Cross-lane reading (a READING, not a verify):** `bun test ./packages/mpd-team-watchdog-plugin` →
  **139 pass / 0 fail / 684 expect() calls / 13 files, exit 0** (`cross-lane-watchdog-reading.log`) — no
  break to report, and lane C's anchor file `lib/scheduler.js` is untouched (`405d4e36…` as t27 left it).

## 5. Bounds

- No repo-wide aggregate was run (the forbidden five; also not `verify-vendor`/`verify-pack-closure`).
- Every path-qualified command used the `./` form with its discovered count reported (269 tests/40 files;
  15 tests/2 files; 21 tests/1 file; 139 tests/13 files).
- `packages/*/dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json`, `.mpd/plans/**` and `skills/**`
  untouched; T-06/T-93/T-42 are NOT started here (their own tasks), and the T-93 row text is not authored
  here either (it belongs to T-93's task; `.mpd/TODO.md` is the integration's path).

## 6. Files and revisions

| artefact | revision |
|---|---|
| `self-fix-tests/lib-absence.mjs` (NEW) | `10006e4370ed7d16cfc027a2c3b83d4de6b07669e015c44b43f96a3f8913f6c4` |
| `self-fix-tests/tool-boundary-hold-and-contract-seat.test.mjs` | `2ef6f0864a7835bb9dbde0f9d40ba7871d601fe04ab33e5f1b8b8fccb66ce864` |
| `self-fix-tests/pool-capability-guard.test.mjs` | `b3d20b26128a999ce3d43b14c6347234c23de7318665227eff6c1e42fe269806` |
| `lib/tools.js` (subject; unchanged by the fix) | `39d77fe6826d19375ea682dfc21aeb42995f1ff818aeb5d1e0ac96b1c1455ea1` |

Evidence in this directory: `audit.mjs`, `audit-before.out.json`, `audit-after.out.json`,
`red-seed-comment-before.out.txt`, `green-seed-comment.out.txt`, `control-seed-code.out.txt`,
`swept-files-after.out.txt`, `suite-plugin-after.log`, `heal-after.log`, `registry-check.log`,
`cross-lane-watchdog-reading.log`, `cross-lane-status-check.log` (the B2 status verification).


---

# AMENDMENT (contract revision 5) — the mailbox-cleanup directive, added to this task

Read from the LIVE contract after the completion gate refused a 5-item payload: the task was amended to
SEVEN items, and items 1–3 are the user's Priority-1 mailbox directive. Appended rather than rewritten
(the T-92 record above stands as delivered).

## P1 — the clear tool's return was broken, and the clear had ALREADY EXECUTED (**DELIVERED**)

Measured (the captain's own call, quoted in the acceptance): `cleared: manifest.cleared.map((record) =>
record.id)` mapped an ALREADY-ID array, so every element became `undefined` and the harness refused the
value (`invalid output: value is not lossless JSON`) — while the tombstone had executed. An EMPTY
mailbox returned `[]` and therefore "worked": it worked only when there was nothing to clean.

Fixed: `cleared: [...manifest.cleared]`; every return of all THREE interjection tools goes through a
`lossless()` wrapper (inside the existing `mpd-delta interjection-tools` region — deliberately NOT its
own marker, because a nested marker is invisible to the writer, t27's rule met again); the request tool's
`expires_at` is pinned to a number so an `undefined` cannot be dropped by the harness's round trip.
ARM (`self-fix-tests/t43-mailbox-clear-guard.test.mjs`): the pre-fix expression is asserted **NOT**
lossless on the real manifest shape and the shipped one IS — with the honest note that my FIRST wording
of that arm compared two SERIALIZATIONS, the very check that passed the broken value for the captain's
first probe; the arm now deep-equals the value against its own round trip, and the mistake is recorded
rather than smoothed.

## P1c — the watermark guard (**DELIVERED**)

`clearMailboxToWatermark` now PROTECTS any record that is undelivered or unread (`deliveredAt ===
undefined || readAt === undefined`) unless the caller passes `force: true`, and REPORTS the split
(`skipped_unread` + `audit.skippedUnreadCount`) so a caller sees what it was about to lose. The tool
gained the `force` parameter (schema + description) and carries `skipped_unread` in its return.
ARM: default clear tombstones the delivered+read record, SKIPS the unread one and names it; `force: true`
tombstones it; the sidecar holds the cleared bytes byte-for-byte. **FIVE existing `test/**` call sites
were updated to opt in with `force: true`** (`test/r1-message-channel.test.mjs` ×4,
`test/t49-send-dedup-wiring.test.mjs` ×1) because their fixtures are deliberately unread and their
subject is the ARCHIVE-FIRST/marker machinery, not the guard. **GRANT NOTE, declared not hidden:** the
bounded `test/**` hop was written for T-92's absence pins; the revision-5 amendment made the guard this
task's, and without those five opt-ins the guard cannot land. `test/**` is inside this task's declared
inScope and the packer excludes `test|self-fix-tests`, so the change has no pack-closure consequence —
the same rationale that justified the grant.

## F1 (t30's finding, closed here) — the cycle note must not over-claim (**DELIVERED**)

One condition: the note fires only while `dependencyStates(tasks, dependencies).blocking` is non-empty.
A FAILED member does not block (OPT-1), so a failed cycle leaves the task CLAIMABLE and the note is
silent; same for an all-COMPLETED cycle. `renderStatus` appends the note to EVERY task line, so the
over-claim was not cosmetic. ARM: PENDING cycle → `cycle c2→c1→c2`; FAILED and COMPLETED cycles →
`""` with `blocking` asserted empty.

## P1b — the automatic retention prune (**NOT DELIVERED — the uncovered half, named**)

The bounded, archive-first retention prune on the DELIVERY path is NOT implemented: no prune, no
`retention` config knob (disabled = 0), and none of its five arms (stale acknowledged pruned · unread
NOT · leased NOT · sidecar byte-for-byte · a cleared record keeps id/ts/from/to + its read/delivery
markers). The acceptance's own measurements for it stand (one production caller of
`clearMailboxToWatermark`, 116 inbox files / 3,302 records, the largest at 1.0 MB) — the design is:
prune on the delivery path (no timer, deterministic), a record prunable only when delivered AND
acknowledged AND older than the window AND not leased, reusing the sidecar machinery. This is the
honest PARTIAL the task's own acceptance blesses; P1 and P1c — the breakage and the safety half — are
delivered and armed.

## Readings on the final revision

`bun test ./packages/mpd-agent-teams-plugin` → **272 pass / 0 fail / 2398 expect() calls / 41 files,
exit 0** (the instrument t30's reviewer identified). Heal suite **21/0**; `--check` exit 0 at **96
regions / 10 adopted files** (registry `9df9ccd812311ab2…`); `verify:docs` **PASS**; cross-lane reading
`bun test ./packages/mpd-team-watchdog-plugin` → **139/0/13 files**, no break. Arms both sides:
`arm-after.out.txt` 3/3 pass; `arm-before-head.out.txt` (HEAD lib mirror) 1 pass / 2 fail — the P1c and
F1 arms RED, the P1 expression falsifier green on both sides BY DESIGN (it is a pure-expression arm).
Revisions: `lib/state.js` `28f741371af13ec1…`, `lib/tools.js` `8f239b40469850e7…`,
`lib/mpd-deltas.js` `9df9ccd812311ab2…`, the new arm `a75b86d85e3ba6fa…`.
