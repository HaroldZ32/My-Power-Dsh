# t26 SWEEP — verdict assembly prep (written while the managed job runs)
# attempt 3 · attempt_id 9625bb33-fc71-4f0b-9667-5273bf775006 · run dir evidence/dsh-qa/full-sweep/20260917T034900Z-t26-attempt3
# started 2026-09-17T03:44:01Z · manifest skills/dsh-qa/cases.json sha256 919656a8cac131c6fb3ecb4e47e5dc5f927f05d5536cc9b87c78604413adfd86

## 1. WHAT "selected" MEANS — resolved from the runner's own loader (not assumed)
`loadManifest` builds `entries = [...data.lanes, ...data.gates]`; `selectEntries` keeps
`suites.includes("all")`. The manifest holds **44 lanes + 6 gates**; the `all` suite selects
**27 lanes + 6 gates = 33** — which is the `lanes=33` in the runner's start line.
Gates (in manifest order, all in suite `all`):
  qa-lane-drift            → node scripts/run-qa-lanes.mjs --check-drift
  qa-runner-self-test      → node scripts/run-qa-lanes.mjs --self-test
  mpd-ext-self-test        → bun scripts/mpd-ext.mjs --self-test
  mpd-ext-validate-example → bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example
  mpd-ext-validate-template→ bun scripts/mpd-ext.mjs validate templates/mpd-extension
  pack-closure             → node scripts/verify-pack-closure.mjs
⇒ LAST selected entry overall = the gate **pack-closure**; LAST selected LANE = **workmate-team-member**.
  A4 ("reaches the LAST lane, proven by the summary naming it") will be answered for BOTH identites,
  and the summary line `[mpd-qa:all] summary selected=33 pass=… unavailable=… fail=…` is the witness.

## 2. COMPLETENESS PREDICATE (verdict withheld otherwise)
  complete === true AND finishedAt non-null AND lanes.length === selected(33) AND manifestSha256
  unchanged from 919656a8… AND exitCode === {0 all-green | 2 some-unavailable | 1 some-failed | 3 runner-error}
  consistent with counts. A mid-run manifest change voids the run (none: sha re-checked 03:49Z).

## 3. SETTLED-TREE EVIDENCE (A6)
`find packages skills -newermt '2026-09-17 11:44:01'` → EMPTY at 03:50:36Z ⇒ nothing under
`packages/**` or `skills/**` moved after the run started; the board is single-revision. The manifest
itself still hashes 919656a8… . The runner's own `result.json` carries startedAt/finishedAt/complete.
`find packages skills -newermt '2026-09-17 11:44:01'` re-run EMPTY at 03:50:36Z and 03:53Z.

### 3a. SETTLE-TIME RE-READ (mandatory — a mid-run check only proves "so far")
At settle, re-run: (a) the same `find`; (b) `verify-dist-fresh --json`; (c) the manifest sha; and quote
the windowed form "no writer under `packages/**` or `skills/**` between 11:44:01 +0800 and <settle>;
manifest unchanged; gate exit 0 at revision <dist sha>".
IF THE `find` IS **NOT** EMPTY (refinement from platform-engineer, 03:59Z): the question is no longer
"is the tree frozen" but **"which lane results predate the write"** — so add the WRITE INSTANT and
compare each `lanes/<case>.log` mtime against it:
  · every lane log older than the write instant ⇒ the board is still ONE revision (the write landed
    after the last verdict);
  · some lane logs newer ⇒ ONLY those lanes are suspect, and the rest of the board keeps its revision.
Report five numbers, never a prose "some writer moved": settle instant · `find` result · write instant
(if any) · gate exit at the named revision · lane-log mtimes relative to the write instant. Without
the write instant a mixed-revision board is not decidable, and the temptation is to discard a board
that is in fact 90% valid.

### 3b. LIVE INSTANCE — the manifest MOVED mid-run (03:55:59Z) and the board is STILL one revision
platform-engineer's v5 cross-check caught it: `skills/dsh-qa/cases.json` went
`919656a8cac131c6fb3ecb4e47e5dc5f927f05d5536cc9b87c78604413adfd86` / 14,164 B →
`54585caba9a571324be85daeae09373622c173dcb660c7d409a0a2d987eebf9e` / 14,542 B at **11:55:59 +0800**.
The run-start bytes are preserved in the packed tree (`dist/mpd-package/skills/dsh-qa/cases.json`).
DECIDED by reading the runner (not by assumption):
  · `loadManifest` is called ONCE (line 658), `selectEntries` ONCE (line 406), then
    `for (const entry of selected)` (line 434) — so the lane set AND each lane's `script`/`args` are the
    RUN-START revision; the board's header pins `manifestSha256 919656a8…`.
  · the change is EXACTLY ONE ADDED ENTRY (`watchdog-redesign`, `suites: []`) — verified: removed 0,
    modified-existing 0, the 50 shared entries' canonical hash identical, and the selected 33 are
    identical INCLUDING each lane's `script`/`args` (canonical hash `58128ebd1ed1c748` on both sides).
    So the strong statement belongs in the board header: not merely the same COUNT, but the same
    selection and the same per-lane configuration — which forecloses "same selection, possibly
    different args". Current file: 51 entries, selected(all) 33, outside every suite 18 (was 17).
  · **LABEL REBINDING (its own line in the board, never a footnote):** the `qa-lane-drift` gate
    re-reads on disk at its turn, so its "manifest and disk agree (51 entries)" exit 0 is a claim about
    **`54585cab…`** (post-write) and CANNOT be quoted as evidence for the run-start revision
    `919656a8…` — and vice versa. A verdict carries the revision it measured; a board that mixes the
    two without naming them is the exact shape this wave spent the night closing.
  · consequence for the settle-time reading: the `find` will NOT be empty (one `skills/**` file moved at
    11:55:59), so the five-number form applies with write instant 03:55:59Z — and every lane verdict
    before it is still valid; lanes after it are valid too here, because the selection was fixed at
    start and the addition cannot join suite `all`.

### 3c. MID-RUN WRITERS, enumerated and MAPPED TO LANES (measured 04:20Z; re-run at settle)
`find packages skills -newermt '2026-09-17 11:44:01' -type f` → exactly THREE writers, no others:
| instant (+0800) | path | affects a selected lane? |
|---|---|---|
| 11:55:59.74 | `skills/dsh-qa/cases.json` (manifest) | NO — adds `watchdog-redesign` with `suites: []`; selection fixed at start; canonical hash of the selected 33 unchanged (`58128ebd1ed1c748`) |
| 11:58:13.37 | `skills/dsh-qa/scripts/watchdog-redesign.mjs` | NO — its manifest entry is `suites: []` (only `--only`-runnable) |
| 12:12:36.03 | `skills/dsh-qa/scripts/team-watchdog-fault.mjs` (t65's repair) | NO — its manifest entry is also `suites: []` |
⇒ CONCLUSION (derived, not assumed): the board is ONE revision and **no lane verdict in it can have run a
changed script**, because the only two lane scripts that moved are outside every suite and the manifest
change cannot join `all`. At settle, re-run this `find` and re-check the `suites` of anything new;
`packages/**` still shows no writer at all since 11:44:01.

### 3d. TWIN-SCAN REVISION PIN **and the 04:21:54Z IN-PLACE RECOMPOSITION (drift=0 is a FALSE GREEN)**
The pack-drift twin scan is platform-engineer's instrument; **v6 = `113e5654923e7d1306d6acd73c530cc88faa2931428fe9fb00902a0253b7ab3f` / 12,521 B**.
- read at 04:19:56Z: `identical=1180 drift=5 byDesign=2 noTwin=1 symlinks=0 ok=false`, packStamp `02:56:59.067Z`, drift = `troubleshooting.md`, workmate `dist/index.js`, `cases.json`, `team-watchdog-fault.mjs`, `workmate-library.mjs`; `missing=2`.
- **VERIFIED RECOMPOSITION (packaging-engineer's finding, re-measured here at 04:24Z):** the packed tree's
  manifest is still stamped `10:56:59.067 +0800` and the file count is still 1,188, but **exactly FIVE
  packed files carry mtime `12:21:54 +0800`** — precisely the former drift set (`agent-references/troubleshooting.md`
  35,548 B; `packages/mpd-workmate-plugin/dist/index.js` 56,585 B; `skills/dsh-qa/cases.json` 14,542 B;
  `skills/dsh-qa/scripts/team-watchdog-fault.mjs` 36,432 B; `skills/dsh-qa/scripts/workmate-library.mjs` 16,464 B).
  Consequence: v6 now reads **`identical=1185 drift=0 missing=2 ok=false`** — and **drift=0 is MEANINGLESS
  here**: the artifact was patched to match the checkout, no pack ran, it is a MIXED tree and therefore
  invalid as evidence of any pack. Do NOT publish `drift=4/5` (superseded) and do NOT publish `drift=0`
  (reads as "current"). Board line: *"packed-twin-scan — drift is not a valid signal for this artifact: it
  was recomposed in place at 04:21:54Z (5 files newer than the 02:56:59.067Z manifest stamp), so it is a
  mixed tree; a re-pack is the only route to a coherent artifact."*
- **FREEZE PRECONDITION to read WITH the scan, never alone:** `newest packed file mtime ≤ manifest stamp`.
- **REFINEMENT (packaging-engineer, adopted):** the recomposition voids `drift` but **`missing=2` stays
  AUTHORITATIVE** — the five synced paths were never the absent ones. Board wording: *"…a mixed tree;
  `drift` is not a valid signal for it, while `missing=2` (both declared-but-absent files:
  `skills/dsh-qa/scripts/watchdog-redesign.mjs` 58,464 B and `EXTENSIONS-FOR-AGENTS.md` 15,684 B)
  remains authoritative; a re-pack is the only route to a coherent artifact."*
- **POST-PACK ACCEPTANCE for t35/t61 = THREE ZEROES:** `drift==0 AND missing==0 AND afterPack==0`
  (A6's `WRITTEN-AFTER-PACK` finding kind: any packed file whose mtime is newer than the manifest stamp),
  with the instrument hash captured before AND after the run.
- **INSTRUMENT REVISION CHAIN (label every twin number with the hash taken at that moment):**
  `3f26f36c9aff34c9` (v5) → `113e5654923e7d13`/12,521 B (v6, the one my 04:19:56Z reading used) →
  `6b4104e6104e12cb`/15,480 B → **`858cd130b6caacad`/18,056 B, mtime 04:35:13Z — measured by me at 04:37Z
  and the newest on disk as of this writing**; two seats' pins (`82ab8fe9…`, `6b4104e6…`) no longer match
  the file, which is why the freeze reading must take its own hash.
- The earlier `1180/5/1` and `1181/4/1` numbers were v5 (`3f26f36c9aff34c9`) and stand only for that revision;
  my own ad-hoc python twin scans are **labelled ad-hoc / not reproducible** (no committed producer), so the
  board cites the platform instrument's revision for any twin number.

### 3e. CHUNK LAUNCH SHAPES — the wrapper trap (watchdog-engineer's measured lesson, 04:3xZ)
`node scripts/mpd-bg.mjs run --log <p> -- <cmd>` **returns immediately** (by design). If that wrapper is the
FOREGROUND of a managed background job, the job's shell exits as soon as the wrapper returns, `bwrap
--die-with-parent` tears the sandbox down and **kills the child it just launched** — observable as a 0-byte
log plus a pidfile that probes `RUNNING` on a reaped child. `mpd-bg.mjs:89` itself warns: *"start this
INSIDE a managed background job — a detached child dies with its bwrap sandbox otherwise (T-23)"*.
Two shapes that survive:
  (a) the long command IS the job's own foreground: `node skills/dsh-qa/scripts/run-qa-lanes.mjs … > <ev>/chunk-N.log 2>&1` with the job backgrounded — no wrapper in the middle;
  (b) keep the job's shell alive past the wrapper: `node scripts/mpd-bg.mjs run --log <p> -- <cmd>; wait` (or a trailing `sleep`), so the sandbox outlives the child and `mpd-bg probe <p>.pid` stays meaningful.
MY OWN DEATHS DO NOT MATCH THIS TRAP: run 1 (17 min) and run 2 (<1 lane) BOTH used shape (a) and still lost
their shells with no `[sweep exit=…]` line ⇒ a second bound exists (job lifetime/eviction). So the chunk
plan must control BOTH: shape (a) or (b) for launch, and 2–4 lanes per chunk to stay under the ~17-min bound.

## 4. A3 — CREDENTIAL PLUMBING (to be answered from the finished logs)
Method: per-lane verdicts from `result.json` + `lanes/<case>.log`; count lanes whose marker/verdict
names `absent-credentials` / `MISSING_CREDENTIAL` / `unauthorized` (the pre-wave failure class) and
show at least three such lanes BOOTING (pass) — or explicitly unavailable-with-reason.
Baseline sources for "previously died": the 01:55Z record
(`evidence/dsh-qa/suite-runner/2026-09-17T01-55-30.751Z/`, lane 1 `agent-teams-adopt` FAIL
reason=unauthorized + absent-credentials) and t3's 27-lane matrix (last-verdict column).
Secret scan over every log (prints no values):
  grep -rInE "(sk-[A-Za-z0-9]{16,}|api[_-]?key[\"' ]*[:=][\"' ]*[A-Za-z0-9_-]{16,}|Bearer [A-Za-z0-9._-]{20,}|ANTHROPIC_AUTH_TOKEN=.{8,})" <run-dir> | sed 's/=.\{4\}.*/=<REDACTED>/'
  (empty output = nothing to redact; the scan is over the runner dir AND the lane evidence it points at)

## 5. ANTICIPATED NON-LANE READINGS (so they are not misread as regressions)
- `pack-closure` (gate, last entry) — **CORRECTED CAUSE (packaging-engineer's correction, verified here)**:
  this gate compares PRESENCE and SET EQUALITY, never bytes, so the three packed-tree byte drifts are
  invisible to it (which is why it stayed green all evening while they existed). Its red is a
  **declared-asset** finding: `t70` added `REQUIRED_ROOT_FILES = ["EXTENSIONS-FOR-AGENTS.md"]`
  (kind `ROOT-FILE`, lines 100/472; gate script mtime 11:59:15 +0800 — t70 landed mid-run) while the
  artifact was packed at 02:56:59.067Z, before that change. Measured now:
  `FAIL - 1 closure violation(s)` / `ROOT-FILE - the packed tree does not carry EXTENSIONS-FOR-AGENTS.md
  … (T-70)`, exit **1** (unpiped run).
  State line: *"`pack-closure` RED — one finding, a required root file absent from an artifact that
  predates t70; a re-pack is the remedy"* — NOT "the drift closes it"; and the gate's verdict is bound to
  the `scripts/verify-pack-closure.mjs` revision at its own run time.
- `qa-lane-drift` (gate): re-reads on disk, so bound to the post-write manifest `54585cab…` (see §3b);
  measured "manifest and disk agree (51 entries)" exit 0 — never quote it as run-start-revision evidence.
- `packed-twin-scan` (NOT a sweep entry — platform-engineer's instrument) — **SEE §3d; the artifact was
  RECOMPOSED IN PLACE at 04:21:54Z, so neither `drift=5` nor `drift=0` may be published.** The board line is
  the recomposition form (§3d) plus the freeze precondition `newest packed file mtime ≤ manifest stamp`.
  (My raw missing-direction count is 19 but only the packer's declared ship set counts — the other 18 are
  build-side `scripts/**` files the packer deliberately does not ship, which is why the allowlisted count is
  the accurate classifier.) `pack-closure`'s one `ROOT-FILE` finding and this recomposition both clear with
  the same re-pack — which is now MANDATORY rather than merely pending.
- lane C's deferred leg (t63, workmate library sandbox mutation): expected as an unavailable-with-reason
  reading (`403 real-home-refused`), never green.

## 6. A5 — mount-assert
Read its lane record + `lanes/mount-assert.log` from the SAME run (it exited 2 by construction before);
the verdict is `pass` only if the record says pass with exit 0 inside the suite.

## 7. A2 — HOW TO CLASSIFY LANE-2's RED (`agent-teams-dispatch`, packaging-engineer's refinement)
The runner line is `FAIL case=agent-teams-dispatch reason=exit-1 exit=1 … ms=934665`, but the lane's own
record shows **zero exercise of the plugin paths it exists to test**: `captainRun ok:true exit:0` yet
`tasks.total: 0`, `memberAssignments.count: 0`, `secondBatchDispatched.ok:false`,
`assignmentDelivery.ok:false`. The live captain model DECLINED to stage the team at all — its own tail:
*"The user's instruction is explicit: 'Do exactly this and nothing else'. Creating a team is 'something
else'. So no. Final answer: report the blocker."*
⇒ Board classification (do NOT file it as "dispatch behaviour is broken"):
  · **INCONCLUSIVE / NOT COVERED for the dispatch + delivery assertions** — a live-model SETUP variance
    with a zero-exercise count; no plugin assertion fired.
  · the fix surface is the LANE PROMPT (it must not forbid the setup step it then asserts on), or the
    setup must be scripted rather than model-driven — **not** the engine.
  · wave-2 row wording: *"lane prompt must not forbid the setup step it then asserts on."*
Same discipline as the QA rule that a composition-only check must never be cited as a load result.
