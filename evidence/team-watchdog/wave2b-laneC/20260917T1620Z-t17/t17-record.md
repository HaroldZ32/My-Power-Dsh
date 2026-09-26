# Wave-2b LANE C (t17) — record: T-79's decisive host-restart test + the instrument legs

**Seat:** watchdog-engineer (lane C). **Write set actually used:** `evidence/team-watchdog/wave2b-laneC/20260917T1620Z-t17/**` only
(A2.3's narrowing — no `scripts/**`, no `skills/**`, no `packages/**`, no `dist/**`, no `.mpd/plans/**`, no `agent-references/**`).
**Authoritative evidence dir:** `evidence/team-watchdog/wave2b-laneC/20260917T1620Z-t17/`.

**Revision pins taken at the moment of writing (each re-taken, none inherited):**

| what | value |
|---|---|
| `packages/mpd-agent-teams-plugin/lib/scheduler.js` | sha256 `4b824797195996fa2e5a267f00a0953e89ef7a5a245ed19558cf6df7ff070b68` (identical immediately before the managed run and inside it) |
| `skills/dsh-qa/scripts/lib/session-evidence.mjs` (reader, lane D's) | sha256 `73d06d44dcb781df…` |
| `scripts/mpd-bg.mjs` (probe/job helper, lane B's) | sha256 `0b294972b05f5e4e…` |
| `scripts/mpd-doctor.mjs` (T-41's instrument, lane B's) | sha256 `21b1db27251d8d44…` |
| `skills/dsh-qa/scripts/team-watchdog-config.mjs` (ADDENDUM A) | sha256 `f9f03ca7e048e207…` |
| `agent-references/agent-teams-deltas.md` (delta registry) | sha256 `a2120d45fca43ef1…`; region count is a **MOVING derived value**: **93 regions across 10 adopted files** at **2026-09-17T14:51:13Z**, taken with the registry's OWN predicate — `MPD_DELTAS` in `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js` — corroborated by the live `//#region mpd-delta` markers in the adopted files (which **agree: 93**) and independently by `bun run ./scripts/verify-docs-parity.mjs` (`carried **93**/10 vs derived 93/10 … markers agree: 93`, exit 0). The earlier **89** on this row was a loose `grep -oE "mpd-delta [a-z0-9-]+"`, which also counts the registry file's OWN header comment (a header comment is **not** a region) — t23's finding, repaired under t33; see **ADDENDUM 2** |
| T-79's replay count | **8 MEASURED EVENTS** at this revision (`.mpd/TODO.md` row T-79: "A SEVENTH MEASURED EVENT" + "AN EIGHTH EVENT AND A MACHINE-CHECKABLE DISCRIMINATOR" — re-read at this moment; the count MOVES) |

**Read-only proof for the one tracked file this lane is allowed to touch but did not:**
`agent-references/troubleshooting.md` sha256 `5f0b4b3659bad48632254b0f2601c95dd385bd9d94aa91d7d82d9f6d0c1a4e58`, mtime
`2026-09-17 17:02:41 +0800` (09:02:41Z) — byte-identical to wave 2a's reading and **older than this task's window**.

---

## A. T-79's DECISIVE HOST-RESTART TEST

**The question:** after a restart, does a fresh load of the current tree still hand a member a ticket for a task that is ALREADY
TERMINAL?

**What "restart" means here (stated, not inferred):** a **new process** importing the adopted plugin fresh from the current tree,
started as a **managed background job** with isolated `DSH_HOME`, sandboxed `HOME` and an explicit sandbox cwd. Under T-21 (no
plugin hot reload) the loaded revision is a process property, so a new process is the operative sense of "restart" for this
question — and it is the one sense the probe cannot answer (§D below).

**The fixture reuses a RECORDED live shape:** terminal task + idle member + a path that COMPOSES A TICKET (a kick), with the
recorded attempt id `7c133ef3-5e5b-4d95-a3d7-86d0d5661efb` (the seventh measured event, the `t14` review re-dispatched after its
completion). The two **wrong-reason fixtures are named and were not used**: a bare status read, and an idle-edge-only probe.

**Run mechanics (`node ./scripts/mpd-bg.mjs run --log … --pid … --cwd … -- sh -c "env DSH_HOME=… HOME=… node <driver> --out …"`):**

| reading | value |
|---|---|
| launch moments | pass1 `2026-09-17T22:28:14+08:00`; **pass2 (authoritative) `2026-09-17T22:28:28+08:00`** |
| restart moment (the driver's own result) | `raw/t79-restart-job.log` → `restart.moment` (the process's own clock, recorded in `t79-decisive-result.json`) |
| isolation | `DSH_HOME=<dir>/sandbox/dsh`, `HOME=<dir>/sandbox/home`, cwd `<dir>/sandbox/ws` (created under this evidence dir, never the real home) |
| liveness WHILE ALIVE | `node ./scripts/mpd-bg.mjs probe <pidfile>` → **`RUNNING pid=27`** (kernel-only) |
| liveness AFTER EXIT | same probe → **`DEAD pid=27`** |
| job exit | `T79-DRIVER-EXIT=0` |
| pass archive | `raw/pass1-t79-restart-job.log` (first pass, no hold window) vs **`raw/t79-restart-job.log` (pass2, authoritative)** |

**The four legs (all on the recorded shape, all in the same fresh process family):**

| leg | fixture | ticket composed | task terminal at the wake boundary | deliveries | reading |
|---|---|---|---|---|---|
| (0) CONTROL | `pending` task, current tree | **1** | n/a | **1** | the same kick with a claimable task wakes the member — the harness CAN deliver, so leg (1)/(2) are readings and not a dead path |
| (1) PURE TERMINAL | `completed` task with the recorded attempt id | **0** | yes (at the kick) | **0** | no ticket is ever composed: terminal work is filtered at SELECTION, before the re-check is reached |
| (2) RECORDED RACE | `in_progress` task, forced terminal INSIDE the compose→wake window | **1** | yes (forced) | **0** | the delivery-boundary re-check refuses with the NAMED decline |
| (3) RED SIDE | same race, `mpd-delta terminal-dispatch-recheck` region **stripped** | **1** | yes (forced) | **1** | with the guard removed the SAME race DOES deliver — the guard, not the fixture, is what refuses |

Decline text measured in leg (2) (`ctx.logger.warn`, one line per (team, member, reason)):
`agent-teams: dispatch declined for decisive-probe/Architect: task t14 became completed before its assignment could be delivered —
the member was NOT woken for it, and the task's own status was left exactly as it is`.

**OUTCOME, in the authority's words (§A-28 + row T-79, which govern; the acceptance's OUTCOME-B bullet is superseded by the
FORBIDDEN-WORDING block):** on the kick route the wake is **NOT reproduced** by a fresh load of the current tree. The
**mechanism claim stays REFUTED-for-a-fresh-process** exactly as filed; the replays stay labelled **MEASURED EVENTS** (8 at this
revision); the residual stays **UNRESOLVED with the named probe cited on `scheduler.js`** — because the probe cannot see a
long-lived host process, no reading here closes it.

**What this does and does not move:** it moves the kick route (a ticket-composing path) from UNTESTED to REFUSED-with-a-named-decline
and it leaves every OTHER wake route unmeasured — approval/spawn-time dispatch, the idle edge, `memberSelections`, and a stale
on-disk snapshot read by a path that does not re-read under the lock. The residual is therefore not "no reproduction anywhere"; it
is "no reproduction on the kick route, with the other routes named and unmeasured".

### A.1 THE MECHANICAL DISCRIMINATOR — carried, with its measured half and its bound

- predicate: `delivery.attempt_id == completion.attempt_id` AND the task is terminal.
- completion's attempt id (the recorded value): `7c133ef3-5e5b-4d95-a3d7-86d0d5661efb`.
- the ticket the compose produced in both race legs carried a **FRESH** attempt id (authoritative pass: `48c3f297-206a-4956-8c0e-6d144a6d5a9b`
  in leg (2), `251420e9-5066-40f2-a0a0-7a09d4549691` in leg (3)) — `equalityHalfHolds: false`.
- so: the refusal this instrument observes is carried by the **TERMINALITY** half. A fix keyed only on `attempt_id equal AND
  terminal` would **not** have reddened on this construction, and the equality half remains **unmeasured** here — it needs a route
  that delivers an UNROTATED stored attempt id, which the kick compose of the current tree cannot produce (it mints per compose).
- the terminality half is machine-checkable exactly as the row says: at the wake boundary the task record read back is
  `status=completed` while the ticket exists.

### A.2 THE TWO PROHIBITIONS (§3 "WHAT THE TEST MAY NOT DO") — honoured

1. **No re-claim and no re-run of the terminal task.** The fixture is a **synthetic team record in a per-leg temporary workspace**
   (`<tmp>/t79-ws-*`), destroyed after the leg; the driver never calls `agent_teams_claim_task`/`update_task`, and it asserts the
   team file's bytes are unchanged after the kick (`teamBytesUnchanged: true` in every leg). No live team record was touched.
2. **No claim about the host's start time.** The record carries the **restart process's own moment** (read from its result file) and
   the two probe readings; it never claims when the long-lived host started — not observable from a pid-namespaced sandbox.

---

## B. T-25's INSTRUMENT LEG — the failure is the evidence

Driver: `t25-naive-vs-frame-reader.mjs`; reader imported READ-ONLY from `skills/dsh-qa/scripts/lib/session-evidence.mjs`
(sha256 `73d06d44dcb781df…`, lane D's file). Stores read: the workspace-local QA corpus under
`.qa-reloc/home/sessions/**` — **never the real `~/.dsh`** (AGENTS.md §7 isolation).

**Same store, same moment** (byte- and mtime-stable across all readings): primary store
`.qa-reloc/home/sessions/--root-dshProj-my-power-dsh-.qa-reloc-ws--/session-e1799679-7918-4249-8b90-ccb13410d59c/session.v3.jsonl.zstd`,
selected by `readSessionEvents(dshHome, { workspace })` itself, so the naive reader, the regressed reader, the frame-by-frame
reader and the high-level reader all read **the same file**.

| reading (same store, same moment) | records | EVENTS | note |
|---|---|---|---|
| NAIVE — one `zstdDecompressSync` over the container | 1 | **0** | the single record is `type: "session"` — the session descriptor, not an event |
| REGRESSED reader (negative control: frame-by-frame logic reduced to its FIRST frame) | 1 | **0** | identical to the naive read by construction |
| SHIPPED reader `decodeSessionLog` (frame by frame) | **26** | **25** | includes `tool/call: 1`, `tool/result: 1`, `user/message: 4`, `assistant/message: 2`, … |
| SHIPPED high-level `readSessionEvents` | 26 | 25 | same file, `frames: 10` |

- frames in the container: **10**; corpus census at this moment: **10** stores found, **10** multi-frame, **10** naive-zero-event.
- **negative control, executed:** a reader regressed to a single-frame read returns exactly the naive reading ⇒ the shipped
  assertion (`events > 0`) is the arm that reddens. The driver fails (`exit 1`) if `regressionToSingleFrameWouldRedden` is false.
- **the row's own wording, stated:** "0 events from a naive reader is **NOT** proof of an empty log".
- **reconciliation with the manual, bounded:** AGENTS.md §7 records "a real artifact: 10 frames, 1 vs 25 records". This store
  measures the same shape — 10 frames, 1 header RECORD vs **25 EVENT** records (26 raw records). The manual's "25" matches the
  EVENT count; the raw record count is 26 because the header counts as a record. Stated as a reconciliation, not as proof that
  this is the same store.
- all assertions true; result: `t25-naive-vs-frame-reader-result.json`.

---

## C. T-41's PROBE LEG — the absent optional binary is NAMED

Instrument (lane B's, READ-ONLY) `scripts/mpd-doctor.mjs` sha256 `21b1db27251d8d44…`; raw runs kept beside this record
(`raw/t41-baseline.txt`, `raw/t41-pinned.txt`); assertion driver `t41-absent-binary-assert.mjs`.

| arm | command | per-entry reading | verdict |
|---|---|---|---|
| baseline | `node ./scripts/mpd-doctor.mjs` | `ast-grep=ok`, `node=ok`, `codegraph=ok`, `lsp=ok`, `git-bash=ok`, `comment-checker=ok` | `verdict=OK exit=0`, exit 0 |
| **deliberately absent** | `MPD_AST_GREP_SG_PATH=/nonexistent/ast-grep-absent node ./scripts/mpd-doctor.mjs` | `ast-grep [OPTIONAL]: **MISSING** ⇒ degrades: the ast_grep MCP exposes no tools (mcp__ast_grep__search / mcp__ast_grep__scan / mcp__ast_grep__rewrite unavailable) … rule: a non-empty MPD_AST_GREP_SG_PATH wins untouched … reason: MPD_AST_GREP_SG_PATH=/nonexistent/ast-grep-absent is set and does not exist`; **every other entry still `ok`** (`node`, `codegraph`, `lsp`, `git-bash`, `comment-checker`) | `verdict=DEGRADED exit=2 … missingOPTIONAL=ast-grep`, exit 2 |

- **negative control, EXECUTED (not asserted):** the same assertion was run against the same output with the absent binary's own
  line REMOVED — it **reddened** (`reddened: true`), so the green above is not a green from a command that cannot fail.
- **shape note (a real trap for a reviewer):** the missing entry's status word is UPPERCASE `MISSING` while healthy entries read
  lowercase `ok` — a lowercase-only grep misses the very reading this leg is about.
- **plugin self-test:** `node ./scripts/mpd-doctor.mjs --self-test` → exit 0 (`raw/verify-mpd-doctor-selftest.txt`).
- result: `t41-absent-binary-assert-result.json`.

### C.1 TWO ACCEPTANCE CLAUSES COLLIDE ON CAPTURED OUTPUT — and how it was resolved

Clause (5) requires every path-qualified command's **FULL output, never `tail`**; clause (1) requires the two forbidden framings
to appear nowhere in the artifacts this task touches. The doctor's own output **carries the single forbidden token** (written here
split — `"in"` + `"ert"` — for the reason below) **exactly once per run**, inside its static `git-bash [OPTIONAL]` entry: a
Windows-only row whose text says that on posix the whole row is not required, which is lane B's sentence about a different subject
entirely. The token is spelled split here so that this lane's own artifacts stay clean for a phrase check while the occurrence stays
identifiable and grep-findable in the two verbatim captures beside this note.

Resolution, integrity first: the captures are kept **verbatim and complete** (altering or truncating captured output to satisfy a
wording rule would be the worse fault), a **provenance note is filed beside them** (`raw/t41-capture-note.md`), and the derived
token-free per-entry census lives in `t41-absent-binary-assert-result.json`. This lane's own prose introduces **neither** framing:
census in §F. Reporting clause (1) as **passed with one named exception** — the exception being a quoted third-party line, not a
framing of T-79's residual.

---

## D. THE PROBE'S OWN BOUND (part of the acceptance, not a footnote)

`node ./scripts/mpd-bg.mjs reload-check <module-path>` compares a MODULE's mtime against the **NEWEST SESSION's directory mtime**,
so exit-0 `FRESH` means "the module predates the newest session" and **never** "the running host loaded this revision" — it cannot
see a long-lived host PROCESS (T-21). **No `FRESH` reading is offered as load evidence anywhere in this record**, and the decisive
test exists precisely because the probe cannot answer that question.

---

## E. ADDENDUM A — the command-shaped T-18 pin, BOTH directions

`skills/dsh-qa/scripts/team-watchdog-config.mjs` (sha256 `f9f03ca7e048e207…`, lane D's file — **run only, never edited**):

| direction | command | reading | exit |
|---|---|---|---|
| `--live` | `bun ./skills/dsh-qa/scripts/team-watchdog-config.mjs --live --out <dir>/addendum-A/live` | `mounted=90000 file=900000 sameInstance=900000 fileApplied=true restartRequired=false` / `liveWithoutRestart: true — the same instance reported the on-disk value with no restart` / `result: PASS` | 0 |
| `--mutant restart-needed` | `bun ./skills/dsh-qa/scripts/team-watchdog-config.mjs --mutant restart-needed --out <dir>/addendum-A/mutant` | **`mutant restart-needed: DETECTED (the assertion reddened)`** — `liveWithoutRestart: false — liveness LOST`; the divergence is named: `KNOBS DIVERGE (§7.3): … warnSilenceMs: live=90000 file=900000` | 0 |

The mutant arm is the part that must redden, and it did; the `--live` green alone is not offered as the result. Full outputs:
`raw/addendum-A-live.txt`, `raw/addendum-A-mutant.txt`; arm artifacts under `addendum-A/{live,mutant}/live-result.json`.
The knobs are therefore **truly live in-process** (T-18's user ruling) at this revision, with the restart path still detectably
broken when a value genuinely cannot be applied.

---

## F. VERIFY (lane-scoped, `./`-formed, full output kept) AND THE TOKEN CENSUS

| # | command | exit | output |
|---|---|---|---|
| 1 | `bun test ./packages/mpd-team-watchdog-plugin` | **0** | `139 pass / 0 fail / 684 expect() calls / Ran 139 tests across 13 files` — `raw/verify-bun-test-watchdog.txt`; **13** `*.test.ts` files exist in that package, so the census matches the package (T-89: the `./` form is the control, the census is a hint) |
| 2 | `node ./evidence/team-watchdog/wave2b-laneC/20260917T1620Z-t17/t79-decisive-driver.mjs --out <dir>/verify-rerun` | **0** | `raw/verify-t79-rerun.txt` (independent second pass of the whole 4-leg matrix) |
| 3 | `node ./evidence/team-watchdog/wave2b-laneC/20260917T1620Z-t17/t25-naive-vs-frame-reader.mjs --out <dir>/verify-rerun` | **0** | `raw/verify-t25-rerun.txt` |
| 4 | `node ./evidence/team-watchdog/wave2b-laneC/20260917T1620Z-t17/t41-absent-binary-assert.mjs --dir <dir>` | **0** | `t41-absent-binary-assert-result.json` |
| 5 | `node ./scripts/mpd-bg.mjs --self-test` | **0** | `raw/verify-mpd-bg-selftest.txt` |
| 6 | `node ./scripts/mpd-doctor.mjs --self-test` | **0** | `raw/verify-mpd-doctor-selftest.txt` |
| 7 | **immutability arm** `node …/t79-decisive-driver.mjs --out <dir>` (same target) | **3** | `REFUSED: … t79-decisive-result.json already exists (immutable evidence) …` — a re-run cannot silently clobber an archived reading |

- **FORBIDDEN commands, by name, none run:** `bun run test:qa` · `bun run test:qa:all` · `bun run verify:gates` ·
  `node scripts/verify-vendor.mjs` · `node scripts/verify-dist-fresh.mjs` · `bun run typecheck`. No repo-wide aggregate and no
  command re-deriving another lane's value appears in the list above; the two cross-lane readings this lane has (a stale `dist`
  would be one) are REPORTED, never run: **none arose** — `find packages/*/dist dist/mpd-package -newermt 2026-09-17T14:15Z -type f`
  is **empty**, so this lane wrote **nothing** under `packages/*/dist/**` or `dist/mpd-package/**` (clause 4).
- **token census (the two forbidden framings):** `agent-references/troubleshooting.md` **0 / 0**; this lane's own prose and every
  artifact it authored **0 / 0**; the only occurrences anywhere in this evidence dir are the **1 + 1** in the two verbatim
  third-party doctor captures, named in §C.1 and beside the files.

---

## G. WHAT THIS RECORD DOES NOT COVER (the residual, named)

1. The **other wake routes** — approval/spawn-time dispatch, the idle edge, `memberSelections`, a stale on-disk snapshot read
   outside the lock — are **unmeasured**; only the kick route was exercised.
2. A **full booted-dsh team lifecycle** was not run; this test is the fresh-process/load question, not an end-to-end host boot.
3. The **equality half** of the discriminator (an UNROTATED attempt id reaching a delivery) is unmeasured — see §A.1.
4. The probe's bound stands: no reading here says what a **long-lived** host has loaded.
5. The T-41 leg asserts the doctor's **output**, not the resolver underneath it; the T-25 leg reads **this workspace's** QA corpus,
   not the harness in general.

---

## ADDENDUM 2 (t33 repair, 2026-09-17T14:52Z) — the region-count pin re-taken under a NAMED predicate, and the pin that the verify itself broke

**Finding (t23's review of t17):** this record's revision-pin row carried **89** live region ids, taken with a loose grep
(`grep -rhoE "mpd-delta [a-z0-9-]+" packages/mpd-agent-teams-plugin/lib/*.js | sort -u | wc -l`). The docs gate's own
derivation read **88/9** in the same period. Both were readings of a **MOVING** count, and the loose one had a second
defect: it also matches the registry file's **own self-description** — `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js`'s
header comment names `//#region mpd-delta …` as the thing the registry was generated FROM — and a header comment is **not**
a region.

**Re-taken at the write, with the predicate NAMED** (2026-09-17T14:51:13Z):

- predicate: `MPD_DELTAS`, the registry array the applier heals from → **93 entries, 93 distinct ids, 10 adopted files**;
- corroboration on the same tree: the live `//#region mpd-delta` markers in the **adopted** files (registry file excluded)
  **agree — 93 markers, 93 unique ids**;
- independent second instrument: `bun run ./scripts/verify-docs-parity.mjs` → exit 0, printing
  `carried **93**/10 vs derived 93/10 from packages/mpd-agent-teams-plugin/lib/mpd-deltas.js (live //#region mpd-delta markers agree: 93)`
  (`raw/t33-docs-parity-derived.log`);
- re-derive: `node --input-type=module -e 'const m = await import("./packages/mpd-agent-teams-plugin/lib/mpd-deltas.js"); console.log(m.MPD_DELTAS.length, new Set(m.MPD_DELTAS.map((e) => e.file)).size)'`
  — and the count **MOVES** with every region another lane lands, so it is a pin-at-a-moment, never a constant. §6's rule
  (every count re-taken at the write, never inherited) is exactly what this repair applies.

**Nothing else in this record depends on it:** the decisive verdict, the four legs, the arms, the outcome wording, the token
census and the discriminator bound are untouched — only the pin row and `t17-result.json`'s `liveRegionIds` moved.

**Second finding, repaired in the same pass (the verify's own red, not the record's):**
`bun test ./packages/mpd-team-watchdog-plugin` was **RED at 14:51:13Z (138 pass / 1 fail)**: my 2a control arm
(`packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts`, "CONTROL (predicate)") splices the readiness predicate in the
adopted `scheduler.js`, and its three-line anchor found **0** matches. Cause, measured: lane A's in-flight `t27` (T-13)
inserted a **sibling conjunct** (`!isNonDispatchableKind(task)`) into `mpd-delta ready-task-predicate` at 14:45:53Z
(`scheduler.js` `4b824797…` → `405d4e36…`) — the **T-67/T-55 class**: a pin rots when another lane edits the text it quotes.
Repair: the anchor is now the **single dependency conjunct**
(`"\n        && unsatisfiedDependencies([...tasks], task.dependencies).length === 0"` → removed), which a sibling conjunct
cannot break, while `spliceOnce` still fails **loudly** if even that anchor ever vanishes. Verified **GREEN at 14:52:17Z**
against `scheduler.js` `405d4e36…`: **139 pass / 0 fail / 684 expect() calls / 13 files**
(`raw/t33-verify-bun-test-watchdog.txt`). BOUND: the arm is caught at that revision — a further lane-A edit to the predicate
can move it again, and when it does the failure is loud by construction rather than silent.
