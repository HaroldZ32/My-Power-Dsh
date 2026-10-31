# R1 review — the mail family: D16b (team-scoped `unread`), D16c (self identity), R7/H1 (an ack frees exactly one slot)

**Task:** board T14 (`kind=review`, blockedBy T12 + T13), with the captain's addendum: my own T11 finding
H1 is the third item to verify, and it must not be softened.
**Reviewer:** R1 `reviewer-cellwork`. **Writes:** this file and `mail/` only; no src/test/docs/gate edit,
no git write command.

## Object under review, pinned by hash (quote the hash WITH its measurement moment)

| file | sha256 | read (UTC) |
|---|---|---|
| `packages/mpd-team-core-plugin/src/mailbox-store.ts` | `dba5ed53f113975c4cdcfc4aa019bc4680594f97bfb7c3f9c0ef36009a3446e1` | 05:29:17Z, re-read 05:33:43Z and 05:34:38Z — unchanged |
| `packages/mpd-team-core-plugin/src/index.ts` | `cecf5e7d42ea22e4562ef1e27ab956ced581629bdd7646c8e5ef3dc23a10e21b` | same instants — unchanged |
| `packages/mpd-team-core-plugin/test/mailbox-store.test.ts` | `ce36bf53ef29614bdbb3eba8543f1b70d7af52e5ebb1f28aaa0ee89b3c92f5bd` | same instants — unchanged |
| `packages/mpd-team-core-plugin/test/pr42-review-repairs.test.ts` | `529233ac458b1d85ea57bd8b18a84db4fd65ee94a1327dc477d25e49579f642f` | same instants — unchanged |

`mail/source-hashes-before.txt` / `source-hashes-after.txt` are the two measurements. The tree is shared
with other lanes; these four files did not move during the review. `packages/mpd-team-core-plugin/dist/index.js`
was rebuilt at 05:30:24Z by another step and already carries the three semantics below (see the build note).

## Method and the commands actually run

Every checklist item is proven by **my own probe** (`mail/probe-mail.ts`, 28 PASS arms + 2 observation
lines), which drives the REAL registered tools through a stub composition and the REAL mailbox-store
functions in my own temp workspaces; the lane's test arms are read for the tool surface only and are
never cited as proof. Red-first is re-derived by ME from a reverted source copy.

```
.toolchain/node_modules/.bin/bun evidence/cellwork/vedit-wave/mail/probe-mail.ts      → exit 0, 28 PASS, "ALL ARMS PASS"
.toolchain/node_modules/.bin/bun test packages/mpd-team-core-plugin                     → exit 0, 404 pass / 0 fail (27 files, 1807 expect)
node scripts/verify-comment-coverage.ts                                                → exit 0, "VERDICT: PASS — every declaration in the family carries a precise comment and a full signature."
node_modules/.bin/tsgo --noEmit -p evidence/cellwork/vedit-wave/mail/tsconfig.scoped.json → exit 0, 0 diagnostics (this package's src + test)
node_modules/.bin/tsgo --noEmit                                                        → exit 0, 0 diagnostics (repo-wide, observed GREEN at 05:31Z — nothing to attribute to sibling lanes; see bounds)
```

Red-first re-derivation: I copied the source trees to `mail/prefix-family/` and restored the three
PRE-FIX predicates in the COPY only (unread unscoped, self keyed on the session id, `isOutstanding`
counting `deliveredAt` only), then ran the two family test files there:

```
bun test prefix-family/packages/mpd-team-core-plugin/test/{pr42-review-repairs,mailbox-store}.test.ts
  → exit 1, 40 pass / 5 fail. The five failures are EXACTLY:
    (fail) D16b … a stale row addressed to ANOTHER team's M1 is excluded from unread, undelivered and total
    (fail) D16c … a member reading with no `member` argument sees the mail addressed to its own member row
    (fail) H1 … 8 outstanding rows refuse the ninth, one `read` frees exactly one, and `summary` agrees
    (fail) sending > the LIVE shape: bound 8, and an ACK frees exactly one slot — the operator's release valve
    (fail) sending > the summary's `undelivered` counts the SAME set the bound does — one ack drops both by one
  every other arm — including the negative controls — passed.
```

## Acceptance checklist (written from the frozen wordings FIRST, then executed)

### T12 — D16b acceptance line

| # | item | verdict | proving arm → observed |
|---|---|---|---|
| 1 | a retired team's backlog is invisible to a fresh team's `M4` in `unread` (list, total, undelivered) | **PASS** | `W0` the fresh team minted its own `M4` (planner.id=M4); `W1a` subjects=`["ours"]`; `W1b` total=1, undelivered=1 |
| 2 | the current team's own undelivered rows are still reported | **PASS** | `W1b`; `W2a` subjects=`["own-mail"]`; `W2b`/`W2c` `["reviewer-mail"]` |
| 3 | an unstamped row is invisible to both | **PASS** | `W1e` (team-scoped unread: subjects=`["ours"]`, total=1, the planted `legacy` row absent); `W3a` (a caller in NO team reads the whole fold: `["unstamped-mail","stamped-mail"]`, total=2) |
| 4 | the send bound and the report agree about which rows count | **PASS** | `W4i` isOutstanding=6, summary=6, undeliveredOf=6; `W1c` the retired backlog does not block the fresh send (refused=undefined) |
| 5 | `read`/`ack` semantics, the bound VALUE 8 and the delivery path stay untouched | **PASS** | `W4b` exact sentence with “(bound 8)”; `W5b` an ack sets `readAt` and `deliveredAt` stays undefined; `W4j` delivery frees one |

### T13 — D16c acceptance line

| # | item | verdict | proving arm → observed |
|---|---|---|---|
| 6 | `unread` with NO `member` resolves the caller to its own ROSTER member id | **PASS** | `W2a` the member's own session (the recorded `executorRef`) gets subjects=`["own-mail"]`, memberName=`Senior Engineer` — without the fix it reads an empty inbox by session id (red-first failure above) |
| 7 | it lists exactly the rows addressed to that member in the calling team | **PASS** | `W2a` excludes the colleague's row; `W1d` excludes the retired wave's rows |
| 8 | the spellings still work: explicit member by NAME and by MINTED MEMBER ID | **PASS** | `W2b` member=`"Reviewer"` → `["reviewer-mail"]`; `W2c` member=reviewer id → `["reviewer-mail"]`; `W2f` naming ITSELF by id → `["own-mail"]` |
| 9 | **an explicit `member` must not lose to the self identity** (captain's strictness point 2) | **PASS** | `W2d`/`W2e`: the member caller asks for the colleague's inbox BY NAME and BY MEMBER ID and gets `["reviewer-mail"]`, never its own `own-mail` |
| 10 | a non-member caller keeps today's behaviour, says so, and does not throw | **PASS** | `W2g` the Lead (not on the roster) → messages=0, total=0, memberName=`lead-session-1`, no throw, no invented member |
| 11 | a caller in NO team still reads the whole fold | **PASS** | `W3a` total=2, undelivered=2 (the unstamped row included) |

### R7 / H1 — the captain's frozen addendum (my T11 FAIL, now the third item)

| # | item | verdict | proving arm → observed |
|---|---|---|---|
| 12 | bound + `summary`'s `undelivered` + `unread` count team-scoped rows that are NEITHER delivered NOR acknowledged, through ONE predicate | **PASS** | source: `mailbox-store.ts::isOutstanding` consumed by `undeliveredOf` and `summarise`; `W4i` three consumers equal (6/6/6) |
| 13 | a full CURRENT inbox still refuses at the bound value 8 with the EXACT same sentence | **PASS** | `W4b` `"Senior Engineer" already has 8 undelivered message(s) (bound 8) — it is not keeping up` |
| 14 | **an ack frees EXACTLY one slot per acked row — not “at least one”, not all** | **PASS** | `W4d` moved exactly one; `W4e` summary 8→7; `W4f` the next send is ACCEPTED; `W4g` ONE refilled outstanding row returns the bound to 8 and refuses (had the ack freed two, it would have passed); `W4h`/`W4h2` 8→7→6, one per ack; `W5a` store level: after the ack accepted, the send after it refused |
| 15 | delivery frees exactly one slot | **PASS** | `W4j` the summary drops 6→5 after exactly one `markDelivered` |
| 16 | an unstamped legacy row counts for nobody; a retired team's rows count for nobody | **PASS** | `W1e`; `W1a`/`W1b`; `W3a` (a no-team caller is the documented exception and still sees them) |
| 17 | **H1 is CLOSED** | **PASS — CLOSED** | the unchanged T11 scenario at the store level: `W5a` `before.ok=false, moved=1, afterAck.ok=true, afterAgain.ok=false`; `W5b` `readAt` set with `deliveredAt` still undefined; `W5c` the acked row leaves the outstanding set. The same arm FAILED against a pre-fix copy (red-first above), so the fix — not a wording change — is what closes it |

### T14's own instruction

| # | item | verdict | observed |
|---|---|---|---|
| 18 | note the `summary` inline team-filter copy as a Nit **unless the copies disagree** (a disagreement is High) | **PASS — copy GONE** | `index.ts`'s summary arm now narrows through `scopeToTeam`; the only `message.teamId ===` comparison left is inside `scopeToTeam` itself; three call sites (send bound, summary, unread) share it. My probe finds NO disagreement (`W4i`), so there is no High finding to file |

## Findings

**No Blocker, High or Medium.** One Nit, one process note.

### N1 — Nit (non-blocking) — an explicit `member` given a SESSION id silently falls back to the self identity
- **What:** `index.ts`'s mail-tool `resolve` helper matches only the minted member id or the display name.
  A caller that passes a colleague's SESSION id as `member` gets no resolution, and the branch then falls
  back to `wanted?.id ?? ownMember?.id ?? callerId` — so a MEMBER caller silently receives its OWN inbox
  and a non-member caller silently receives an empty one.
- **Observed (my probe, observation arms only):**
  `OBS O1 member caller, member=<colleague session id> — subjects=["own-mail"], memberName=Senior Engineer`;
  `OBS O2 lead caller, member=<member session id> — subjects=[], total=0`.
- **Why it is NOT a FAIL of the frozen wording:** T13's TEST pins the explicit spellings to the member id
  and the name, and the tool's documented `member` input is “whose inbox”; the T13 EXPECTED sentence's
  “session id” spelling is satisfied by the SELF path (`W2a`), where the caller's session id resolves to
  its roster row. I record it because a captain that addresses people by session id would read the wrong
  inbox silently, which is the failure family this wave is about.
- **Direction (described, not applied):** resolve `member` through the same identity resolver the self path
  uses (id + name + `executorRef`), or answer a refusal when a supplied `member` resolves nothing instead of
  substituting the caller. A tiny separate task if the captain wants it.

### Process note (not a finding) — lane notes do not state red-first
The T12/T13 report notes quote green gates but do not state an observed RED for their own arms, which
wave §4 §4 asks for when the defect is unit-testable. I did not take that on faith either: my reverted
copy produces exactly the five expected failures, so the red-first substance holds. Recorded for the
captain's report register, not as a defect.

### Build note — dist
`packages/mpd-team-core-plugin/dist/index.js` (rebuilt at 05:30:24Z) already contains the R7 predicate
(`message.deliveredAt === undefined && message.readAt === undefined`), the D16c self-identity line
(`wanted?.id ?? ownMember?.id ?? callerId`) and the scoped unread branch — so no SEMANTIC dist drift
follows for these items. Byte-level freshness is the captain's `node scripts/verify-dist-fresh.ts` step;
I did not rebuild anything.

## Declined to judge (each with its reason on the same line)

- **The lane's test arms as proof** — read to learn the tool surface; every checklist verdict above rests on my probe and the gates, never on them.
- **A global “read implies delivered” fold change** — R7 is satisfied inside the outstanding predicate; rewriting `deliveredAt` would blur the two facts my `W5b` pins, and T12 forbids touching delivery semantics.
- **Team-scoping of the `read` (ack) action's ids** — `read` is id-addressed and T12 says ack semantics stay untouched; a caller could ack another team's row by id. Weighed, set aside as out of the frozen scope (hardening, not a regression).
- **A session id as an explicit `member` spelling** — recorded as N1, not a FAIL, for the reason stated there.
- **Self resolution by session TITLE only** — `callerIdentity` keeps that fallback, but a session that is not on the roster resolves no team first; the reachable spellings are proven in W2a/W2b/W2c. Not probed beyond that.
- **Repo-wide typecheck attribution** — my run observed exit 0 / 0 diagnostics at 05:31Z, so T12's earlier “red on other lanes” had settled and there is nothing to attribute either way.
- **A live dsh / dsh-tui boot and the real transport** — not run; my stub composition drives the real registered `execute`, and the transport delivery path is untouched by these diffs.
- **Any file outside the mail plane** (cellwork, roles, other lanes' in-flight files) — not read as evidence, not judged.
- **The repo's own `.mpd/team/mailbox.jsonl`** — not written and not re-read for this review; every fixture is a `mkdtemp` workspace.
- **Byte-level dist freshness / other gates** (docs, manifest, rows, pack) — outside this task; the captain's sweep owns them.

## Verdict

**APPROVE.** Every frozen acceptance item of T12 and T13 passes under my own probes, the three consumers
now share ONE outstanding predicate and ONE team filter, and **my T11 High finding H1 is CLOSED** — proven
by re-running my unchanged scenario against the current tree (accepted send after the ack, and the send
after that refused again) and by an independent red-first run in which exactly that arm fails against the
pre-fix predicates. The only open item is a non-blocking Nit (an explicit `member` given a session id
falls back silently), outside the frozen TEST's spellings.

**Bounds of this review:** anchored to the four hashes above (05:29:17Z → 05:34:38Z, unchanged); the tool
surface was driven through a stub composition, not a mounted dsh session; no Docker lane, no dist
rebuild, no git write; the repo-wide typecheck was green at its measurement moment and may move with
sibling lanes; I read the mail plane, the T12/T13 wordings, the wave contract (including §7 R7),
`AGENTS.md` and this package's README mail section — nothing else was judged.

> **Evidence hygiene (§7 R9, added 2026-10-31):** the red-first source copy this report cites was REMOVED
> from the checkout after its log was recorded (`mail/red-first-family.log` keeps the five failing arms);
> a future re-derivation uses `mktemp -d`, never a runnable copy under `evidence/`.
