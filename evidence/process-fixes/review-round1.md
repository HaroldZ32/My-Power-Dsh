# t6 — Review gate: process-hardening wave (docs-gate link resolution, hygiene edits, troubleshooting rows)

Task `t6` (review) in team `mpd-process-hardening` / wave `w1`. Seat: Reviewer (read-only discipline:
findings and recommendations only — **no shipped file was written by this task**; the only file this
task wrote is this artifact).

Verdict: **PASS — no blocking findings.** Every acceptance item of `t3`, `t4` and the `t2` honesty
bound was re-checked against the files ON DISK and the gate's OBSERVED behaviour, never against a
task summary. Five non-blocking observations are recorded in §5 for the integration task.

---

## 0. The revision this verdict is anchored to (timestamped hashes)

Rule applied: AGENTS.md §7 "Quote a hash WITH its measurement moment".

| file | sha256 | moments read (UTC) | stable window |
|---|---|---|---|
| `scripts/verify-docs-parity.mjs` | `1cb83b1394df66e148c44d3c322bcbbf470ffdd0c959068b24af793ee5163f4e` | 11:48:27, 11:48:56, 11:50:06, 11:51:05, 11:51:10, 11:51:35, 11:51:38 | 3 m 57 s (mtime 11:47:41Z = the `t8` repair) |
| `AGENTS.md` | `62288be4a23c8ebb3fed267e2f6e6530ab6f3a279dff6721b734c43cf9146d68` | 11:51:35, 11:51:38 | (mtime 11:51:11Z = the `t10` language-policy clause) |
| `.gitignore` | `9e86dd852cdf995a8e3ae1b43b7d373cb0e2145ecbc8668110fe1aba784a212f` | 11:46:51, 11:48:56, 11:50:06, 11:51:35, 11:51:38 | 4 m 47 s |
| `agent-references/troubleshooting.md` | `af5ec159114e51a7a34d531bd1a8c62c02de7c306bbe1ee9ba55976ce9948de0` | 11:46:51, 11:48:56, 11:50:06, 11:51:35, 11:51:38 | 4 m 47 s |

**The reviewed revision MOVED twice while this review ran** — both moves are recorded rather than
smoothed over:

1. `scripts/verify-docs-parity.mjs` `c97c6520…` (`t3`'s delivered revision, and the one `t5`'s verdict
   quotes) → `1cb83b13…` at **11:47:41Z**, by the in-flight `t8` repair (t5-F1: root-relative
   targets). I read the pre-repair code at 11:46:51Z; every measurement reported below was then
   re-taken on the repaired revision (my injection demonstration at 11:47:59–11:48:02Z already ran
   the repaired bytes).
2. `AGENTS.md` `d49bb23c…` (`t4`'s and `t5`'s revision) → `62288be4…` at **11:51:11Z**, by the
   in-flight `t10` (language policy: name the root-relative class). The new clause is judged below
   against the shipped code.

Pre-existing verdicts were unchanged by both moves: the pre-`t3` script run on the CURRENT tree
(`git show HEAD:scripts/verify-docs-parity.mjs`) prints `pairs=38 failed=0 violations=0 exempt=19
derived=3 — PASS`, byte-for-byte the same pair/exempt/derived verdicts as the shipped script's run.
`git status --porcelain`: 4 modified tracked files + `?? evidence/process-fixes/` (the wave is
uncommitted; no commit was made by this review).

---

## 1. The three questions the contract demands, answered explicitly

### 1a. Can the docs gate see a dead relative link END TO END? — **YES**

Run on a COPY (`/tmp`), so no shipped document was touched. Copy built with
`tar --exclude=.git --exclude=node_modules --exclude=evidence --exclude=dist --exclude=.mpd
--exclude=.codegraph`; its baseline counters are **identical** to the shipped tree's, which is what
makes the copy representative (band files cannot hide in the excluded trees).

| step | instant | command | exit | observed |
|---|---|---|---|---|
| baseline | 11:48:02Z | `node scripts/verify-docs-parity.mjs --root /tmp/t6-inject/root` | 0 | `links=234 checked=217 resolved=210 dead=0 exemptProvenance=7 absentSite=0` … `violations=0 … PASS` |
| INJECT `[probe](./t6-injected-dead-link.md)` + `[stale]( ./architecture.md )` into the copy's `docs/design.md` | 11:48:02Z | same | **1** | `links=236 checked=219 … dead=2`, `violations=2`, `pairs=38 failed=2` |
| REMOVE (restore the copy's file from the shipped tree) | 11:48:02Z | same | 0 | `links=234 … dead=0 … PASS` |

Both FAIL lines name the **source file, the line and the resolved target**:

```
FAIL link-missing:docs/design.md:./t6-injected-dead-link.md — docs/design.md:586 links
  "./t6-injected-dead-link.md" but neither a file nor a directory exists at
  /tmp/t6-inject/root/docs/t6-injected-dead-link.md — …
FAIL link-missing:docs/design.md:./architecture.md — docs/design.md:587 links "./architecture.md"
  but neither a file nor a directory exists at /tmp/t6-inject/root/docs/architecture.md — …
```

The shipped `docs/design.md` was NEVER the injection target: its sha256 is
`62bd827a9449aa58900f0baf6df23ddf4fdfdc636641a4106b50f57d3c946228` both before and after the
demonstration, and the restored copy file is `cmp`-identical to it.

### 1b. Does the provenance exemption leave the check honest, or silently green? — **HONEST**

* The shipped run PRINTS the exempt finding instead of dropping it:
  `note packages/mpd-agent-teams-plugin/README.md — LINK: EXEMPT_PROVENANCE (…): 7 relative target(s)
  reported as EXEMPT PROVENANCE — never a pass and never a violation … for: ./docs/quality-gates.md,
  ./docs/usage.md, ./skills/dsh-plugin-development/SKILL.md, ./docs/usage.md,
  ./docs/verification-guide.md, ./docs/developing-dsh-plugins.md, ./docs/readme-writing-guide.md`
  — the same 7 targets the `t1` census lists, in the same file.
* The counters separate the two populations: `checked=217`, `resolved=210`, `skippedProvenance=7`,
  `dead=0` — and the invariant `checked = resolved + dead + skippedProvenance + absentSite` holds in
  every run I took (217 = 210+0+7+0; injected 219 = 210+2+7+0).
* The skip is FILE-scoped, not class-scoped: self-test arm 5 puts the SAME kind of dead link in a
  NON-exempt package README and it reddens (`link-missing:packages/mpd-fixture-pkg/README.md:./dead.md`,
  exactly one violation) while the verbatim file stays green.
* The exemption was REUSED, not widened: `EXEMPT_PROVENANCE` is byte-identical to HEAD
  (`git show HEAD:scripts/verify-docs-parity.mjs | grep -A2 'EXEMPT_PROVENANCE = new Map'` ==
  the shipped one, single entry, same reason string).
* Documented bound (recorded in `t3`'s evidence §10, restated here so nobody over-reads it): those 7
  targets are DETECTED but never fail the gate; a target swapped inside the verbatim file is not
  caught by this gate.

### 1c. Are the AGENTS.md sentences TRUE of the shipped gate and the shipped hooks? — **YES**

`AGENTS.md` line 12 (language policy), judged clause by clause against
`scripts/verify-docs-parity.mjs` @ `1cb83b13…`:

| clause of the shipped sentence | shipped code | verdict |
|---|---|---|
| enforces "the RESOLUTION of relative link targets across the band it discovers" | `checkLinkTargets(root, linkBand(root, pairs, exemptNotes))`, called from `verifyDocsParity` | TRUE |
| band = `docs/**` any depth, `extensions/**/README.md`, `templates/**/README.md`, `packages/*/README.md`, root README | `discoverPairs` + `linkBand` (band adds both halves of each pair plus every existing `*.md` reported as a lone-file exemption; `agent-references/**` stays out per T-28) | TRUE |
| "a `./x`, `x` or `../x` target resolves from the LINKING file's own directory" | `resolve(root, dirname(rel), filePart)` | TRUE |
| "a ROOT-relative `/x` target resolves against the REPO ROOT (`/docs/index.md` means `docs/index.md` in this tree, never the filesystem root)" (added by `t10` at 11:51:11Z) | `const rootRelative = filePart.startsWith("/")`; `cleaned = filePart.replace(/^\/+/, "")`; `base = rootRelative ? root : dirname(rel)`; `abs = resolve(root, base, cleaned)` | TRUE |
| "`#fragment` stripped first" | `const filePart = target.split("#")[0]` | TRUE |
| "a directory counts" | `exists = stat.isFile() \|\| stat.isDirectory()` | TRUE |
| "external URLs, in-page anchors and code spans are ignored" | `target.startsWith("#")` → anchorOnly; `target.startsWith("//") \|\| LINK_SCHEME.test(target)` → external; `` lines[at].replace(/`[^`]*`/g, "") `` strips code spans, fenced blocks skipped | TRUE |
| "reports … a link target that does not resolve as a violation" | `violations.push({id: 'link-missing:…'})` in the non-packed, non-provenance branch | TRUE |
| "A file kept VERBATIM as provenance is exempt … (its dead targets are reported as EXEMPT, never as passes)" | `EXEMPT_PROVENANCE.has(rel)` → `skippedProvenance` + the printed note | TRUE |
| "in a packed copy with no root `AGENTS.md` an unresolved target is a NOTE rather than a failure (T-75)" | `packedCopy = !existsSync(join(root, MANUAL_REL))` (`MANUAL_REL = "AGENTS.md"`) → note `link-absent-site:…` | TRUE (measured on the REAL packed tree, §6 row 6) |

`AGENTS.md` §9: the stale claim is gone — `grep -n "wave 3\|(t3)" AGENTS.md` returns NOTHING, and the
invariant now reads "exactly ONE re-pin per wave — landing in the same commit as the change that
invalidated that `treeSha` — is the invariant a reviewer checks" (a policy sentence, true of the
release rule in §11, with no wave number or task id a reader could mistake for current state).

`AGENTS.md` §7: the timestamped-hash bullet exists between the SETTLED-hashes bullet and the shell
caveat, and demands exactly what this review did (requirement: sha256 + read instant; verifier
sandwich with start == end after the settle window).

**"Shipped hooks"** — the platform literals quoted by `t2`'s rows were re-verified in the shipped
plugin source, not trusted from the write-up: `repair tasks require sourceTaskId and at least one
sourceFindingId` (`lib/quality-gates.js` `validateCreateTask`); the `coverageGapText` refusal shape
`(matched N of M)` (`lib/quality-gates.js:739`); the `repair-source-open-edge` region
(`lib/mpd-deltas.js`); the ownership refusal (`lib/tools.js:2128`); the terminal-immutability refusal
(`lib/tools.js:2283/2305`) and `terminalTaskChangedField`; the amend parameter block
(`lib/tools.js:2050-2072`: `additionalProperties: false`, exactly `subject`, `description`,
`dependencies`, `acceptance`, `inScope`, `outOfScope`, `verify`); `Append-or-create (never truncates);
a seat whose write/edit/bash are denied may only use evidence/**.` (`lib/tools.js:1974`);
`deliveryRoutingClass` (`lib/scheduler.js:387`) and the pre-wake recheck
(`return \`task ${ticket.taskId} became ${current.status} before its assignment could be delivered
(routing class ${routing}: …)\``, `lib/scheduler.js:749` — so the row's
`task tN became completed before its assignment could be delivered` is a faithful instance of the
shipped template); `assertTaskRearmable` (`lib/state.js:243`, region
`mpd-delta terminal-task-rearm-refusal`).

---

## 2. `t3` acceptance — checked against the file on disk and the observed behaviour

| # | criterion (abridged) | verdict | evidence (command / read) |
|---|---|---|---|
| 1 | resolves relative targets; `verify:docs` exits 0; the 7 provenance links handled by REUSING `EXEMPT_PROVENANCE` | PASS | §1b; run at 11:51:05Z exit 0, `dead=0`, `exemptProvenance=7`, note names the 7 targets; `EXEMPT_PROVENANCE` byte-identical to HEAD |
| 2 | packed/partial copy follows the T-75 discriminator (NOTE, never a failure; neither invented nor skipped) | PASS | REAL packed tree: `node scripts/verify-docs-parity.mjs --root dist/mpd-package` → exit 0, `links=230 checked=213 resolved=202 dead=0 absentSite=4`, notes `link-absent-site:docs/index.md:../AGENTS.md` and `…docs/index.zh-CN.md:../AGENTS.md`; plus self-test arm 4, reddened by mutant 2 (§6) |
| 3 | link classes follow the spec | PASS | self-test arms 1/2/3 read in source; my `./x` injection is caught; ignored classes counted (`ignoredExternal=13 ignoredAnchorOnly=4`); the `/x` class is an addition from `t8`, covered by `t10`'s policy clause (§1c) |
| 4 | `--self-test` keeps the 28 existing arms green and adds ≥3 named arms (POSITIVE, NEGATIVE, packed) | PASS | HEAD had **24** named `case: "…"` arms, shipped has **30** — **0 removed, 6 added** (POSITIVE, IGNORED, NEGATIVE, PACKED, PROVENANCE, ROOT-RELATIVE); pristine run `34/34 PASS`; a dormant-scanner mutant leaves exactly `28/34` — i.e. the 28 non-link arms stay green while all 6 link arms redden |
| 5 | unrelated gate behaviour unchanged; `verify:gates` exit 0 | PASS | `git diff` deletes only 2 import lines and the summary line (the scanners' signatures); pre-`t3` script on the current tree prints the same `pairs=38 failed=0 violations=0 exempt=19 derived=3`; `node scripts/verify-gates.mjs` → `PASS - 5/5 member gate(s) green` (11:51:05Z) |
| 6 | evidence in `evidence/process-fixes/gate-links.md` (commands, exit codes, arm names, injection demo, exempt handling shown explicitly) | PASS | file present, sha256 `6fee762614b3cb5f65685bcae697bb658f54a15f7c8c7b95582b40b45506f5de` (11:50:35Z); headings include §5 arms, §6 injected demo, §7 "never as passes", §8 packed, §10 bounds; it also records honestly that the `t1` census HEADLINE totals (89/192) are understated vs today's tree (92/217) |

## 3. `t4` acceptance

| # | criterion (abridged) | verdict | evidence |
|---|---|---|---|
| 1 | `.gitignore` uses the proven form; `git check-ignore -v …/sandbox` exits 0 and names the pattern; comment truthful | PASS | `git check-ignore -v evidence/web-card-catalog/20260918T073000Z/sandbox` → `.gitignore:56:evidence/**/sandbox` + the path, **exit 0** (11:46:51Z); real-dir control `evidence/mpd-bridge/dual-path/sandbox` → exit 0; `ls -ld` shows the path IS a symlink (`-> ../20260918T055042Z/sandbox`); scratch-repo discriminator at 11:50:35Z: OLD form `evidence/**/sandbox/` → symlink exit **1**, NEW form → exit **0**; comment lines 52–55 name the symlink case and why the slash is absent |
| 2 | §9 stale wave claim → wave-agnostic invariant | PASS | `grep -n "wave 3\|(t3)" AGENTS.md` → no match; shipped sentence names no wave/task id |
| 3 | §7 gains the TIMESTAMPED-hash rule | PASS | the bullet exists verbatim (requirement + sandwich + the measured four stale-reading rounds) |
| 4 | language policy covers link-target resolution and is TRUE of the shipped gate | PASS | clause-by-clause table in §1c, including the root-relative clause `t10` added at 11:51:11Z |
| 5 | no other AGENTS.md content changes; no renumbering; §3 tree untouched; `verify:docs` exit 0 | PASS | `git diff -U0 -- AGENTS.md` → exactly 3 hunks (`@@ -12 +12 @@`, `@@ -497,0 +498,7 @@`, `@@ -557 +564,2 @@`), re-checked AFTER `t10`'s edit; heading tree identical to HEAD (order + levels); `bun run verify:docs` exit 0 |
| 6 | evidence with before/after check-ignore, four passages quoted, both sha256 | PASS | `evidence/process-fixes/gitignore-and-manual.md` sha256 `5ec38cd1c73a2edc5824772c3702a758199cb3cc5a3b640b205b2153d28977d5` == the hash `t4` claimed; its quoted `.gitignore` `9e86dd85…` and `AGENTS.md` `d49bb23c…` match my own measurements at those revisions (the `AGENTS.md` hash has since been superseded by `t10`, which the file's own timestamped anchoring makes legitimate, not stale-passing) |

## 4. `t2` honesty on the re-dispatch row (the bound named in the review contract)

The row must not claim "no guard exists". **It does not.** Its words: *"the shipped tree already
classifies the offer (`deliveryRoutingClass` in `packages/mpd-agent-teams-plugin/lib/scheduler.js`,
region `mpd-delta terminal-dispatch-recheck`) and names it in the decline"*, and the section's scope
paragraph says *"the re-dispatch race is a platform delivery window with only a partial in-tree
guard"*. Both guards really exist — `deliveryRoutingClass` (`lib/scheduler.js:387`, region confirmed
against the registry entry whose `file:` is `packages/mpd-agent-teams-plugin/lib/scheduler.js`) and
`assertTaskRearmable` (`lib/state.js:243`). Verdict: **no over-claim, no finding required**; the row
even quotes the terminal-immutability refusal the state guard produces. Completeness nit only (O3).

All six friction literals were grep-verified in the shipped source (`(matched N of M)` via
`coverageGapText`; the repair validator; the repair failed-dependency refusal + `repair-source-open-edge`;
the ownership refusal; the 7-key closed amend schema + the row's honest note that the plan listed six
keys while the parameter block also declares `subject`; the append-or-create description).

## 4b. Findings table (verdict support)

Blocking findings: **none** — no criterion of `t3`, `t4` or the `t2` honesty bound failed, and nothing
is over-claimed, so the verdict is `pass` and the table below carries only non-blocking observations
(recommendations, ownership left to the captain).

| id | severity | status | problem (evidence) | recommended fix | owner |
|---|---|---|---|---|---|
| F-none | — | — | no blocking finding: every acceptance item re-checked against the files on disk (§2, §3) and the gate's observed behaviour (§1a–§1c) | — | — |
| O1 | low (process) | open | the artifacts moved mid-review: `t3`/`t5` anchor `c97c6520…`, now superseded by `1cb83b13…` (`t8`); `t4` anchors `AGENTS.md d49bb23c…`, now `62288be4…` (`t10`) (§0) | `t7` re-runs the released gates on the FINAL hashes and cites those; `t9` owns the final word on the two deltas | captain / `t7` |
| O2 | low (stale comment) | open (manual half CLOSED by `t10`) | the script's header block above `linkTargets` still says `each resolved from the LINKING file's own directory` and omits the root-relative normalization `checkLinkTargets` now performs; AGENTS.md line 12 was updated by `t10` at 11:51:11Z, the comment was not | add one clause to that comment (e.g. "plus a ROOT-relative `/x`, normalized against the repo root") in the next touch of the file | `t7` / next `t3`-file owner |
| O3 | low (completeness) | open | `t2`'s re-dispatch row names the T-93 guard (`deliveryRoutingClass` + region `mpd-delta terminal-dispatch-recheck`) but not the second in-tree guard `assertTaskRearmable` (`lib/state.js`, region `mpd-delta terminal-task-rearm-refusal`); "partial in-tree guard" stays true (§4) | optionally name the state-level rearm refusal in the same row | captain |
| O4 | info | declared | gate v1 bounds: reference-style `[x]: ./target` definitions and HTML `href`/`src` are not scanned; a query string is treated as part of the path — already declared in `t3`'s evidence §10 | none this wave | — |
| O5 | info | accepted | `evidence/**/sandbox` also matches a plain FILE named `sandbox` anywhere under `evidence/` — that is what makes it match the symlink; required by the accepted criterion | none | — |

---

## 5. Observations (NOT findings — nothing here blocks downstream work)

* **O1 — the reviewed artifacts moved twice mid-review.** `t3`'s evidence and `t5`'s verdict are anchored
  to `scripts/verify-docs-parity.mjs` `c97c6520…`, a revision that no longer exists on disk (superseded
  by `1cb83b13…` from the `t8` repair), and `t4`'s evidence to `AGENTS.md` `d49bb23c…` (superseded by
  `62288be4…` from `t10`). This is legitimate (both later tasks exist precisely to carry those changes,
  and each evidence file anchors its own revision with a moment), but the INTEGRATION task (`t7`) should
  re-run the released gates on the FINAL hashes and cite those, and the `t9` verification (in flight)
  owns the final word on the `t8`/`t10` delta. My verdict is anchored to the §0 table.
* **O2 — RESIDUE after `t10` closed the manual half.** The script's own header block (the "It ALSO
  resolves the relative link TARGETS" comment above `linkTargets`) still states `each resolved from
  the LINKING file's own directory` and does not mention the root-relative normalization that
  `checkLinkTargets` now performs. The AGENTS.md language policy and the code now agree; this comment
  does not. Recommended fix (one clause, e.g. `— plus a ROOT-relative `/x`, normalized against the
  repo root`), owner = whoever next touches that file (the `t8`/`t9` pair or `t7`); a comment, not
  behaviour, so it is not a blocker. This is the same stale-claim class the wave exists to fix.
* **O3 — `t2`'s re-dispatch row does not name `assertTaskRearmable`** (`lib/state.js`, T-79 region
  `mpd-delta terminal-task-rearm-refusal`), the second in-tree guard. "Partial in-tree guard" remains
  true; naming it would make the row complete. Optional.
* **O4 — documented gate bounds** (see `t3`'s evidence §10): reference-style definitions
  `[x]: ./target` and HTML `href`/`src` attributes are not scanned; a target carrying a query string
  is treated as a path. Declared, not hidden — no action needed for this wave.
* **O5 — accepted trade-off in `.gitignore`**: `evidence/**/sandbox` now also matches a plain FILE
  named `sandbox` at any depth under `evidence/` (that is what makes it match the symlink). Implied by
  the accepted criterion and by the baseline rule it replaces; worth remembering, not fixing.

## 6. Raw verification evidence (commands, exit codes, moments)

| # | command | exit | observed (abridged) |
|---|---|---|---|
| 1 | `node scripts/verify-docs-parity.mjs` @11:51:05Z (repaired rev) | 0 | `links=234 checked=217 resolved=210 dead=0 exemptProvenance=7 absentSite=0 ignoredExternal=13 ignoredAnchorOnly=4 files=92`; `pairs=38 failed=0 violations=0 exempt=19 derived=3 links=234 dead=0 — PASS` |
| 2 | `node scripts/verify-docs-parity.mjs --self-test` @11:51:05Z | 0 | `34/34 checks passed — PASS` |
| 3 | `node scripts/verify-gates.mjs` @11:51:05Z | 0 | `PASS - 5/5 member gate(s) green` (docs-parity exit=0; preset-conformance exit=0) |
| 4 | injection on a COPY (baseline / injected / restored) | 0 → **1** → 0 | §1a table |
| 5 | mutant 1 — scanner unwired (`{ target, line } of []`) | 1 | `28/34 FAIL` (the 6 link arms red, the 28 non-link arms green) |
| 6 | mutant 2 — `packedCopy = false` | 1 | `33/34 FAIL` (the PACKED arm red) |
| 7 | mutant 3 — provenance skip dropped (`if (false)`) | 1 | `33/34 FAIL` (the PROVENANCE arm red) |
| 8 | mutant 4 — `rootRelative = false` | 1 | `33/34 FAIL`; the ROOT-RELATIVE arm's own detail shows `resolvedWithTwoLiveTargets 12` (was 14) and `deadWithMissingTarget 3` (was 2) |
| 9 | `node scripts/verify-docs-parity.mjs --root dist/mpd-package` | 0 | real packed tree: `links=230 checked=213 resolved=202 dead=0 absentSite=4`, notes naming `../AGENTS.md`; `violations=0` |
| 10 | `git check-ignore -v evidence/web-card-catalog/20260918T073000Z/sandbox` | 0 | `.gitignore:56:evidence/**/sandbox` + path (symlink); real dir exit 0; scratch-repo OLD form exit 1 |
| 11 | `git show HEAD:scripts/verify-docs-parity.mjs \| …` / `--root .` | 0 | pre-`t3` script on the current tree: `pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS`; arm-name diff: 24 → 30 named arms, 0 removed |

Mutants 1–4 and the injection demonstration ran on COPIES (`/tmp`); the repository's shipped files were
read-only to this task and their hashes are unchanged from §0.

## 7. Bounds of this review (stated so the verdict is not over-read)

* The contract's verify list is `node scripts/verify-docs-parity.mjs` and `node scripts/verify-gates.mjs`;
  both were run on the settled revision by me. I did NOT run `bun test` / `bun run typecheck` (no
  package source changed in this wave) and did not re-pack.
* "Settled" here means: hash → work → re-hash with identical values across the §0 windows (shortest
  3 m 57 s for the script, which had just been repaired; 4 m 47 s for `.gitignore` and the reference).
* The `t9` verification (in flight, depends on `t8` + `t10`) is the gate that owns the final word on
  the two mid-review deltas; this review's PASS covers the on-disk revision in §0 and would need
  re-taking if either artifact moves again.

## 8. Addendum — the captain's "hold until t9" instruction, and why no re-judgement is needed

After this verdict was filed, the captain asked the review to hold until `t9` (the re-verification of
the `t8` repair) is terminal and then to judge the hash `t9` names. Recorded here so the sequence is
not misread:

* `t9` is **terminal with verdict `pass`** (evidence `evidence/process-fixes/verify-hardening-reverify.json`,
  `generatedAt 2026-09-19T11:51:20Z`). Its `revisionStatement` names the judged script hash
  `1cb83b1394df66e148c44d3c322bcbbf470ffdd0c959068b24af793ee5163f4e` — **the identical hash this review
  is anchored to in §0** — and its `judgedHashes` anchor `AGENTS.md` at `62288be4…`, also identical.
  So the revision `t9` verified and the revision this PASS judged are the same bytes; no re-judgement
  is required and no part of this verdict rests on the superseded `c97c6520…` sample.
* The two moves reported in §0 are therefore fully covered: the script's move (`c97c6520…` → `1cb83b13…`)
  is confirmed terminal by `t9`, and the `AGENTS.md` move (`d49bb23c…` → `62288be4…`) is confirmed by
  `t10` and re-verified by `t9`.
* `c97c6520…` remains in §0/§2/§6 explicitly as **the superseded sample** (`t5`'s revision, judged by
  `t5` and by this review's first read), never as the judged revision.
* Counts are judged against the GATE'S OWN counters, per the captain's note: `files=92`,
  `links=234`, `checked=217`, `resolved=210`, `dead=0`, `exemptProvenance=7`, `absentSite=0`,
  `ignoredExternal=13`, `ignoredAnchorOnly=4` — the `t1` census headline (89 / 192) understates the
  tree and is treated as understated, as §2 row 6 records.
* Residual risk if either artifact moves again after this addendum: this verdict is anchored to the
  hashes above and would have to be re-taken; `t7` (integration) must re-run and re-cite the gates at
  commit time.

## 9. Attribution of the judged bytes (captain's rule) and the declared bounds

Recorded because `t6`'s claim raced the contract amendment and `t10` could not be a dependency of
`t6`. Nothing below is a finding; it states WHICH bytes this PASS judges and which task's deliverable
each is.

| judged deliverable | file | sha256 | measurement moments (UTC) | verdict | charged to |
|---|---|---|---|---|---|
| docs-gate link resolution | `scripts/verify-docs-parity.mjs` | `1cb83b1394df66e148c44d3c322bcbbf470ffdd0c959068b24af793ee5163f4e` | 11:48:27, 11:48:56, 11:50:06, 11:51:05, 11:51:10, 11:51:35, 11:51:38, 11:52:34, 11:53:34, 11:53:36, 11:54:55, 11:55:35 (12 reads, all identical) | PASS | `t3`'s extension **as repaired by `t8`**; `t5`'s pre-repair `c97c6520…` appears in §0/§2/§6 ONLY as a superseded sample |
| sandbox-symlink ignore | `.gitignore` | `9e86dd852cdf995a8e3ae1b43b7d373cb0e2145ecbc8668110fe1aba784a212f` | 11:46:51, 11:48:56, 11:50:06, 11:51:35, 11:51:38, 11:52:34, 11:53:34, 11:53:36, 11:55:35 | PASS | `t4` only (outside `t10`'s scope) |
| §9 re-pin invariant, §7 hash+moment rule, §11 release-checklist line | `AGENTS.md` | `62288be4a23c8ebb3fed267e2f6e6530ab6f3a279dff6721b734c43cf9146d68` | 11:51:35, 11:51:38, 11:52:34, 11:53:34, 11:53:36, 11:55:35 (mtime 11:51:11Z; the earlier `d49bb23c…` reads at 11:46:51–11:50:06 are the SUPERSEDED revision) | PASS | `t4` (also inside `t9`'s judged set) |
| language-policy sentence enumerating the gate's link classes (line 12) | `AGENTS.md` | same file hash `62288be4…` | same moments | PASS, no defect | **`t10`** — judged here only because `t6` acceptance #2 requires answering whether the AGENTS.md sentences are TRUE of the shipped gate; every clause matches the code (`rootRelative`/`cleaned`/`base`), so the outcome is an observation-free pass, not a finding, and nothing is charged to `t8`, `t9` or `t4` |
| six platform frictions + re-dispatch honesty bound | `agent-references/troubleshooting.md` | `af5ec159114e51a7a34d531bd1a8c62c02de7c306bbe1ee9ba55976ce9948de0` | 11:46:51, 11:48:56, 11:50:06, 11:51:35, 11:51:38, 11:52:34, 11:53:34, 11:53:36, 11:55:35 | PASS (no over-claim) | `t2` |

**Declared bounds, kept visible rather than converted into defects**

* **`t5-F2` — fragments are stripped and never validated.** `const filePart = target.split("#")[0]`
  discards the fragment; the gate asserts the PATH exists, never the anchor. Declared bound, not a
  defect (and the AGENTS.md sentence says "with a `#fragment` stripped first", which is exactly the
  shipped behaviour).
* **Census headline understates the tree.** The `t1` fact base's 89 files / 192 links is understated;
  counts are judged against the gate's own counters (`files=92`, `links=234` = 217 relative +
  13 external + 4 anchor-only, `checked=217`, `resolved=210`, `dead=0`, `exemptProvenance=7`,
  `absentSite=0`), which read IDENTICALLY before and after the `t8` repair — so the repair moved no
  shipped counter.
* **Scanner v1 bounds** (O4): reference-style `[x]: ./target` definitions and HTML `href`/`src` are
  not scanned; a query string is treated as part of the path. Declared, not hidden.
* **`.gitignore` file-name match** (O5): `evidence/**/sandbox` also matches a plain FILE named
  `sandbox` at any depth under `evidence/` — that is what makes it match the symlink.

**Follow-on from this review (after the addendum was written):** the captain promoted observation O2
to `t11` (+ `t12` verification) — "the gate's top-of-file description must name the root-relative
class the code implements". `t11` edits `scripts/verify-docs-parity.mjs`, so the script hash WILL move
past `1cb83b13…`. This verdict stays anchored to `1cb83b13…` (the revision the `t8`→`t9` chain proved);
the FINAL revision must be anchored by `t12` and re-cited by `t7`. If `t11` is comment-only, the `t3`
authenticity evidence (arm accounting 24→30, the four mutants, the counters) carries over unchanged; if
it touches executable code, those arms must be re-run. Recommendation, not a finding.

**Measured outcome of that move (recorded 2026-09-19T11:56:08Z, after this review closed):** the
script moved as predicted — `1cb83b13…` (12 identical reads, §9 table) → `06ee71ae8fdf4cbb7ffc0b87465cd3aca99cd71dd3a5c48fb8e1610aa1a1a8b8`
(mtime **11:55:51Z**, read at 11:55:55Z / 11:56:06Z / 11:56:08Z, identical). The move is consistent
with a COMMENT-ONLY edit and every observable I sampled is unchanged: the header block now documents
the ROOT-relative class; the executable markers are all intact (`LINK_INLINE`, the
`rootRelative`/`cleaned`/`base` normalization, the `counters.checked` invariant, all six `links …`
self-test arms); the 30 named arms are unchanged; `verify:docs` exit 0 with the IDENTICAL counters
(`files=92 links=234 checked=217 resolved=210 dead=0 exemptProvenance=7 absentSite=0
ignoredExternal=13 ignoredAnchorOnly=4`); `--self-test` `34/34`; `verify:gates` `5/5 green`. Bound on
this statement: no copy of the pre-`t11` bytes was retained by this review, so the comment-only
property is evidenced by behaviour + marker fingerprints, not by a byte diff — **`t12` must assert it
from its own diff and is the anchor for the final revision**.
