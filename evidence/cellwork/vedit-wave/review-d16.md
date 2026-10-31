# R1 review — D16: the team mailbox undelivered bound

**Task:** board T11 (`kind=review`, blockedBy T10) — judge D16 against the FROZEN T10 wording and the
repository documentation, never against the writer's narrative.
**Reviewer:** R1 `reviewer-cellwork` (this seat). **Writes nothing but this file and `d16/`.**
**Branch:** `fix/cellwork-vedit-wave` (no git write command was run).

## Object under review, pinned by hash (AGENTS.md §7: quote a hash with its measurement moment)

The D16 behaviour lives in two files plus the lane's tests. Hashes were read, the whole probe/gate pass
was run against them, and they were re-read after a settle window. **The tree was being edited
concurrently** (T12/D16b by `team-mail`, other lanes), so the exact bytes are named here:

| file | sha256 | measured (UTC) |
|---|---|---|
| `packages/mpd-team-core-plugin/src/mailbox-store.ts` | `55a3a93b546e9d4520043884bcced93bfb5c3867565cf1cb75c414bad2cd3c2a` | 2026-10-31T05:16:13Z, re-read 05:17:14Z (unchanged) |
| `packages/mpd-team-core-plugin/src/index.ts` | `94f2f5ade58d428bbdcae18a71c6239c0a61f84179d925bc90774d8f5b160525` | same instants (unchanged) |
| `packages/mpd-team-core-plugin/test/mailbox-store.test.ts` | `eb93ff9dd21430c764168e1421dcac33f94fea8e250f2c7f6b8bfb27645c9d88` | same instants (unchanged) |

Raw logs: `d16/source-hashes-before.txt`, `d16/source-hashes-after.txt`, `d16/gate-test-settled.log`,
`d16/gate-comments-settled.log`, `d16/probe-settled.log`, `d16/red-first.log`.
The first pass at 05:14:58Z saw a different `mailbox-store.ts` (`55a3a93b…` is the settled one; the
inline per-team filter had already been refactored into `scopeToTeam` between the two reads). The
predicate is the same in both spellings; the probe below is the settled evidence.

## Acceptance checklist (written from the T10 wording FIRST, then executed)

Proof column names the command and what it printed; every arm is my own probe
(`d16/probe-d16.ts`, temp workspaces under `$TMPDIR`, **never** this repo's `.mpd/team`), not the lane's
tests. `PROBE_EXIT=1` is expected because arm C1 is the unmet item.

| # | acceptance item (T10 wording) | verdict | proving command → observed |
|---|---|---|---|
| 1 | the undelivered count that gates a send is computed from rows of the CALLING team only (`scopeToTeam` on `mailbox-store.ts::send`) | **PASS** | `bun d16/probe-d16.ts` → `PASS A1 retired backlog ignored by the bound — unscoped(prefix)=8, fresh send ok=true` |
| 2 | an UNSTAMPED legacy row belongs to no current team and is NOT counted | **PASS** | same probe → `PASS D1 an unstamped row blocks no team (bound) — first ok=true`; `PASS D2 the team's own row still fills its bound — second ok=false reason=backlog-full`; `PASS E2 no-team caller keeps the unscoped fold — unscoped=7, expected=7` |
| 3 | 8 undelivered rows in the CURRENT team make the 9th send refuse with the SAME message | **PASS** | same probe → `PASS B1 … ok=false reason=backlog-full`, `PASS B2 refusal sentence and bound value 8 unchanged — detail="M4" already has 8 undelivered message(s) (bound 8) — it is not keeping up` |
| 4 | a read/ack of one of them frees exactly one slot | **FAIL** | same probe → `FAIL C1 read/ack frees exactly one slot — before.ok=false, moved=1, afterReadSend.ok=false detail="M4" already has 8 undelivered message(s) (bound 8) — it is not keeping up`; `PASS C2 an ack records readAt and leaves deliveredAt untouched`; control `PASS C3 delivery frees exactly one slot — afterDelivery.ok=true` |
| 5 | the bound value stays 8 | **PASS** | `PASS B2 … (bound 8) …`; the refusal sentence carries the cap verbatim |
| 6 | delivery semantics unchanged (`sent → delivered → read` stay separate facts; a send stamps its team) | **PASS** | `PASS A3 a send stamps the teamId onto its row — stored teamId=team-fresh`; `PASS F1 delivery does not acknowledge (readAt stays absent)`; `PASS F2 an ack does not fabricate delivery (deliveredAt preserved)` |
| 7 | the lane adds the contract's test reproducing the live case (retired 8 → fresh send succeeds; current 8 → 9th refuses; **read/ack frees one**) | **FAIL (partial)** | the two new arms are real and RED pre-fix: `bun test d16/prefix/test/mailbox-store.test.ts` (pre-fix source `git show dev:…` hash `43fd8c76…`) → `18 pass / 2 fail`, failing exactly `(fail) the bound is PER TEAM …` and `(fail) an UNSTAMPED row …`. But they scale `maxUndelivered` to 2, never exercise the live 8/9 shape or the exact sentence, and **no arm covers the read/ack leg** — the clause the implementation fails |
| 8 | summary and the bound agree about which rows count | **PASS** | `PASS E1 summary and bound agree per member — bound=3, summary=3, expected=3` |
| 9 | gates the task names | **PASS** | `.toolchain/node_modules/.bin/bun test packages/mpd-team-core-plugin` → exit 0, `398 pass / 0 fail`; `node scripts/verify-comment-coverage.ts` → exit 0, `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature` |

The live incident's premise re-derived read-only from this workspace's `.mpd/team/mailbox.jsonl`:
876 records, 442 sends, 82 to `M4`, **8 undelivered, all stamped `teamId: "team-20261026105056350-z559-00a"`**
— exactly the retired-backlog shape, and the pre-fix predicate would count 8 (probe A2), which is the
refusal the defect reported.

## Findings (ranked; path + SYMBOL, never a line number)

### H1 — High — a read/ack does NOT release the undelivered bound (frozen acceptance item unmet)
- **What:** the send bound counts only messages with `deliveredAt === undefined`
  (`mailbox-store.ts::undeliveredOf` consumed by `mailbox-store.ts::send`), while
  `mailbox-store.ts::markRead` appends a `read` record and `mailbox-store.ts::fold` sets ONLY `readAt`
  for it. An acknowledged-but-undelivered row therefore keeps occupying a bound slot forever.
- **Where:** `packages/mpd-team-core-plugin/src/mailbox-store.ts` — `undeliveredOf`, `send`, `markRead`,
  `fold`.
- **Why it matters:** T10 EXPECTED says "`read`/`ack` rows still clear a row" and T10 DO says "a
  read/ack of one of them frees exactly one slot". The frozen acceptance for this defect explicitly
  includes that release path; without it a captain's only unblock is transport delivery, so a member
  whose transport keeps failing stays mail-blocked even after it has seen and acknowledged the mail —
  the same wedge D16 exists to remove, one layer down. My probe C1 is the contract's own scenario and
  it refuses the next send.
- **Expected per contract:** 8 current-team undelivered rows → 9th refused → one `markRead` → the next
  send succeeds (exactly one slot freed).
- **Direction of fix (described, not applied):** make the backlog predicate count team rows that are
  NEITHER delivered NOR acknowledged (one shared helper), and use that same predicate for the bound,
  `summary`'s `undelivered` and the `unread` branch, so the three answers cannot drift; leave
  `deliveredAt`/`readAt` as the separate facts they are (do not fabricate delivery on ack). Add the
  contract's four-leg arm. Because T12/D16b is in flight over the same file and already owns the shared
  filter, this is cheapest folded into T12 rather than a second concurrent repair task.

### M1 — Medium — the lane's tests do not pin the acceptance shape the contract asked for
- **What:** `packages/mpd-team-core-plugin/test/mailbox-store.test.ts` adds two arms, both at
  `maxUndelivered: 2`; neither reaches the live 8/9 shape, neither asserts the exact refusal sentence,
  and neither covers read/ack freeing a slot (the arms that exist are the ones my probe had to supply).
- **Where:** `packages/mpd-team-core-plugin/test/mailbox-store.test.ts`, the arms "the bound is PER
  TEAM …" and "an UNSTAMPED row predates the team field …".
- **Why it matters:** the items the frozen DO names as the reproduction are exactly what a future edit
  would silently break; a scaled arm cannot fail when the default cap moves or the sentence changes.
  Red-first is genuine (18 pass / 2 fail on the pre-fix source), so this is coverage, not a fake pin.
- **Expected per contract:** the four-leg live-shape arm (retired 8 + fresh `M4` send succeeds; current
  8 → 9th refuses with the same message; one ack frees exactly one slot).
- **Direction:** extend the existing suite (no parallel file) with the live-shape arm; keep the scaled
  arms if desired.

### N1 — Nit — a THIRD spelling of the team predicate remains in `summary`
- **What:** `index.ts`'s `agent_teams_mail` summary arm still filters inline
  (`state.messages.filter((message) => message.teamId === mailTeam.teamId)`) while `send` and the
  `unread` branch go through `mailbox-store.ts::scopeToTeam`. T10's wording asked to reuse the same
  helper rather than write a second filter; the rule now has two spellings, which is the drift class
  that produced D16 and D16b.
- **Why it matters:** a future change to "which rows count" (e.g. claiming unstamped rows) must touch
  both spellings, and the summary is the answer the captain reads.
- **Direction:** route the summary arm's filter through `scopeToTeam` so ONE predicate governs the
  bound, the summary and the unread branch.

### Build note (not a finding against T10) — src/dist drift will follow
`packages/mpd-team-core-plugin/dist/index.js` contains no `scopeToTeam` marker and still carries the
pre-fix bound path, so the committed dist is stale against src. T10 was instructed NOT to rebuild, so
this is expected; the captain's integration step must rebuild the package with the pinned toolchain
(`.toolchain/node_modules/.bin/bun build …`) before the dist gate. No other package imports
`mpd-team-core-plugin`, so no adapter fan-out applies to it.

## Declined to judge (each with the reason on the same line)

- **D16b (`unread`/`total`/`undelivered` counts) as a T10 failure** — the captain carved it out to T12
  (in flight, same file); judged here only as context, never as T10's acceptance.
- **The `D16b` arms in `test/pr42-review-repairs.test.ts`** — they belong to T12 and encode its wording,
  not T10's; not read as proof here.
- **Whether `read` should imply `delivered` in the FOLD globally** — a real design choice, but H1's fix
  can stay inside the backlog predicate; rewriting the fold would change the meaning of `deliveredAt`,
  which T10 forbids touching. Declined as out of the minimal-fix direction.
- **`scopeToTeam` with `teamId === ""`** — a direct store caller gets the unscoped fold while its row is
  stamped unstamped (symmetric with `fold` dropping empty stamps, so it is coherent); unreachable
  through `agent_teams_mail` because a resolved team's id is never empty. Weighed and set aside.
- **`maxUndelivered <= 0` disabling the bound** — pre-existing, unchanged by this diff, not in T10's
  wording.
- **README/zh-CN wording of the bound** — `packages/mpd-team-core-plugin/README.md` says the undelivered
  backlog is bounded and names no scope, so the fix contradicts no sentence; documenting the per-team
  rule is the bilingual-docs lane's (F) task, not T10's.
- **Other lanes' edits sharing this tree** (`mpd-cellwork-plugin/**`, `mpd-roles-plugin/**`, the
  `pr42-review-repairs.test.ts` D16b arms) — not D16, not read as evidence, not judged.
- **Live mounted-tool behaviour** — I drove the store exactly as `agent_teams_mail` does (the tool's
  send arm passes `teamId` straight from the resolved record and returns `result.detail` verbatim); I
  did not boot a dsh session to call the tool through the harness.
- **Transport retry / `markDelivered` idempotence / mail durability** — unchanged by the diff and
  covered by pre-existing arms; not re-judged.

## Verdict

**REQUEST CHANGES (FAIL).** The primary D16 defect is genuinely and correctly fixed — a retired team's
backlog no longer refuses a fresh team, an unstamped row blocks nobody, the current team's own bound
still fires at 8 with its exact sentence, delivery still frees a slot, and the summary agrees with the
bound (checklist 1,2,3,5,6,8,9 all PASS with my own probes) — but the frozen acceptance's read/ack
release clause is NOT implemented and not tested (H1), so the item cannot be marked done as written.

**Bounds of this review:** I read the T10/T11/T12 board wording, the wave contract, `AGENTS.md`, this
package's README and mail plane only — no lane A/C (or B/D/E) implementation; I ran the package suite and
the comments gate only (not typecheck, docs, dist or a mounted boot); I did not rebuild dist; the tree
was concurrently edited, so the verdict is anchored to the three hashes above and would need a re-read if
they move; T12's completeness and every other member's work are outside this seat.

> **Evidence hygiene (§7 R9, added 2026-10-31):** the red-first source copy this report cites was REMOVED
> from the checkout after its log was recorded (`d16/red-first.log` keeps the failing arms); a future
> re-derivation uses `mktemp -d`, never a runnable copy under `evidence/`.
