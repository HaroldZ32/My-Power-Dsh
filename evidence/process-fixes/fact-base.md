# Fact base + gate-extension design spec — wave w1 process fixes (task t1, Architect, read-only)

Scope: evidence and design constraints ONLY. No shipped file was edited by this task. Every claim below was
produced by a command or by reading a named symbol; raw readings are quoted at the point of use.

## 0. Method and settled-hash stamp

Cited bytes are pinned by sha256 measured at TWO instants 50 s apart (the `start == end` sandwich the wave's
process notes call for — see P4). Start `2026-09-19T11:27:54Z`, end `2026-09-19T11:28:44Z`: all eight files
IDENTICAL across the window, so the readings below are SETTLED, not mid-write snapshots.

| file | sha256 (T0 == T1) |
|---|---|
| `scripts/verify-docs-parity.mjs` | `2bbe584a5906537460138adb2f5997bf573ceccf50fda8488c91a7ebe428ce6e` |
| `.gitignore` | `83baa5404c2030254e42168fb3bb591cb0d067d7d1e561f3fb5fc2f798450a28` |
| `AGENTS.md` | `d74a934d6653265083453d937fdd3d6eb1c77e79b3093cfe9d3878c290fee50a` |
| `agent-references/troubleshooting.md` | `af5ec159114e51a7a34d531bd1a8c62c02de7c306bbe1ee9ba55976ce9948de0` |
| `packages/mpd-agent-teams-plugin/README.md` | `c534fa529289df7133030cfd34342762ab4074e5a958edb54a64bd1cd2993a66` |
| `docs/design.md` | `62bd827a9449aa58900f0baf6df23ddf4fdfdc636641a4106b50f57d3c946228` |
| `docs/index.md` | `9a824fe66982a3554906bc6085a68ca1cbebd060a61881b995ebb3ca7bf22089` |
| `README.md` | `9d58873d602a94259ea5777e2524edfc45ba3294c41e084dcc0303ff2767e8db` |

Cross-corroboration with the finished docs wave's ledger (`evidence/docs-overhaul/hash-ledger.md`): `AGENTS.md`
`d74a934d…` and `docs/design.md` `62bd827a…` are the SAME hashes that ledger recorded — the tree has not moved
since that wave's close-out.

Baseline gate state measured today (before any change):

- `node scripts/verify-docs-parity.mjs` -> exit 0, `pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS`.
- `node scripts/verify-docs-parity.mjs --self-test` -> exit 0, `28/28 checks passed — PASS`.
- `git status --porcelain` (relevant line only): `?? evidence/web-card-catalog/20260918T073000Z/sandbox`.

## 1. Problem inventory — how "six" resolves

The wave goal names four defects AND a batch of frictions; the two task contracts the captain authored name the
frictions as SIX and require the re-dispatch pattern recorded separately. The six rows below are the complete set
the four wave tasks fix, each mapped to the task that owns it:

| id | problem | in-repo? | owning task |
|---|---|---|---|
| P1 | the docs gate never resolves a link TARGET, so dead links pass green | fixable in-repo | gate task (`scripts/verify-docs-parity.mjs`) |
| P2 | `.gitignore`'s directory-only `evidence/**/sandbox/` cannot see the `sandbox` SYMLINK | fixable in-repo | hygiene task (`.gitignore`) |
| P3 | `AGENTS.md` §9 pins a binding rule to a HISTORICAL wave ("wave 3 … (t3)") | fixable in-repo | hygiene task (`AGENTS.md`) |
| P4 | `AGENTS.md` has no TIMESTAMPED-HASH rule (a hash must be quoted with its measurement moment) | fixable in-repo | hygiene task (`AGENTS.md`) |
| P5 | SIX measured platform frictions (F1–F6) are undocumented in `agent-references/troubleshooting.md` | document-only | troubleshooting task |
| P6 | the terminal-task RE-DISPATCH pattern (six wakes in one wave) is undocumented | document-only | troubleshooting task |

Observation for the captain (not a finding, no action required from me): the goal sentence says "six process
problems" and then ALSO says "six platform frictions"; under the two task contracts it issued, "six frictions"
is P5's internal list (F1–F6) and the process-problem set is P1–P6 above. If the goal text is quoted anywhere in
the close-out, use this table so the two sixes cannot be conflated.

## 2. P1 — the docs gate is blind to link targets (exact symbol evidence)

**Symbol: `switchLinkUnderTitle` (`scripts/verify-docs-parity.mjs`).** Its whole body is
`^#\s+\S` heading check plus `new RegExp(`\\]\\(` + twinBase + `\\)`).test(head)` — it tests the SWITCH LINK's
SPELLING against the twin's basename and returns a boolean. It never `stat`s, never `existsSync`s and never even
CAPTURES the link text as a path; the matched group is discarded. It is called at exactly two sites
(`verifyDocsParity`, `if (!switchLinkUnderTitle(enText, zhBase)) failed.push("EN switch link missing/not under the
head title")` and the zh mirror).

Proof that no OTHER link logic exists in the file: the only `existsSync`/`readdirSync` uses are DISCOVERY and
file-existence checks for the files the gate already knows by name — root README pair, `walkFiles` over
`docs/`/`extensions/`/`templates/`, `packages/*/README.md` and their twins, the `EXEMPT_*` tables, and the T-75
sites. There is no markdown-link extractor anywhere in the script: a full search for a link-shaped pattern finds
only the twin-name RegExp above. So the gate validates the PAIR, the SWITCH LINK and CJK content (its own header,
lines 20–24) and nothing about where any link points.

**Measured cost of the gap (why this matters):** the finished docs wave produced two rounds of dead links to the
retired `docs/architecture.md`, and the gate was GREEN on both — the dead links were found by hand-written
per-lane sweeps, not by the gate. The wave evidence records both the defect and the workaround:
`evidence/docs-overhaul/SUMMARY.md` "Problems found and fixed" row 3 (four orphaned live references after the
rename) and its clause table row 2, which counts the ad-hoc checkers (`t6` "48 links, 0 dead", `t9`, `t7`,
`t15` "30/30 relative link targets resolve") — each lane wrote its OWN link checker because the gate has none
(`evidence/docs-overhaul/verify-readme.mjs` is one of them).

**Consequence for the implementer:** the new check must live in this ONE file (the gate task's `inScope` is
`scripts/verify-docs-parity.mjs`), and it must land GREEN on today's tree — see §5: the tree is NOT clean, and the
single existing exemption that makes it green is the already-declared `EXEMPT_PROVENANCE` set.

## 3. P2 — `.gitignore` misses the `sandbox` SYMLINK (exact reproduction)

`.gitignore` line **52** is, verbatim:

```
evidence/**/sandbox/
```

It sits under the comment block at lines 47–51 whose own wording claims it covers "Sandbox WORKING AREAS that
lanes create inside their own evidence dir". The trailing slash makes the pattern DIRECTORY-ONLY: git does not
apply it to a symlink (or any non-directory).

Reproduction (read-only, measured in this worktree):

```
$ ls -la evidence/web-card-catalog/20260918T073000Z/
  lrwxrwxrwx sandbox -> ../20260918T055042Z/sandbox
$ git check-ignore -v evidence/web-card-catalog/20260918T073000Z/sandbox
  (no output)
$ echo $?
  1
$ git status --porcelain
  ?? evidence/web-card-catalog/20260918T073000Z/sandbox
```

`git status` therefore shows it as untracked, and any `git add -A` / `git add .` would sweep the symlink into a
commit — the hazard the wave's own report records (`evidence/docs-overhaul/SUMMARY.md`, "Deliberately NOT claimed"
item 4: the symlink "is a pre-existing untracked symlink that `.gitignore`'s directory-only
`evidence/**/sandbox/` rule cannot cover").

**Fix pattern proven in a scratch repo** (not in this worktree — nothing here was modified). With the SAME
directory-only control pattern the symlink is not ignored; with the trailing slash REMOVED
(`evidence/**/sandbox`) the symlink matches, the real directory still matches, and `git status` goes quiet:

```
# control: evidence/**/sandbox/  ->  git check-ignore -v <symlink> : exit 1 (no match)
# fix:     evidence/**/sandbox   ->  .gitignore:1:evidence/**/sandbox  <symlink>   : exit 0
# same fix on the real DIR      ->  .gitignore:1:evidence/**/sandbox  evidence/a/sandbox : exit 0
# git status after the fix      ->  only the untracked .gitignore of the scratch repo
```

This is the SAME class (and the same remedy) the file already records for the QA scratch roots: `.gitignore`
lines 73–87 state that a directory-only `/.qa-*/` "left every stamp file visible, which is why the pattern
carries no trailing slash" — the sandbox row is that lesson not yet applied to its own neighbor. Minimal-diff
recommendation: change line 52's pattern to `evidence/**/sandbox` (keep the comment; if the reviewer wants the
comment to name the symlink case, that is a one-line addition, not a rewrite).


## 4. P3 — `AGENTS.md` §9 pins a binding rule to a HISTORICAL wave

`AGENTS.md` line **557**, inside the binding `skills/**` single-writer rule (§9), reads verbatim:

```
  Serialize all `skills/**` edits of a wave through a single writer and re-pin exactly once;
  wave 3 has exactly one re-pin (t3), and that is the invariant a reviewer checks.
```

Why it is stale: the surviving text is a WAVE-SPECIFIC measurement (`wave 3`, task id `t3`) fused into the
general rule by a semicolon, so the rule a reviewer applies now reads as a claim about a wave that closed long
ago (the current wave is `w1` of a NEW team, task ids restart, and there is no `t3` in it). The wave-agnostic
invariant that must survive is exactly ONE re-pin per wave, landing in the SAME commit that invalidated the
corpus `treeSha` — which the same section already states three lines above. The stale half also loses meaning
under task-id reuse: a future `t3` would silently "confirm" it.

Minimal-diff recommendation: drop the wave-specific clause (or reword it as a past measurement with its date),
keeping the sentence's invariant: `…re-pin exactly once; exactly one re-pin per wave is the invariant a reviewer
checks.` Both halves of §9/§11 keep their force (`AGENTS.md` line 573 and lines 577–583 already carry the
one-re-pin-per-wave rule, so no cross-reference needs to change).

## 5. P4 — the manual has no TIMESTAMPED-HASH rule

`AGENTS.md` lines 494–497, the closest existing bullet (§7 QA discipline), reads verbatim:

```
- **Verify on SETTLED hashes.** An edit/revert still landing is measurable: wave 2's first
  verification pass ran while a revert was in flight and measured a half-reverted tree (a failure
  that no longer existed minutes later). Pin the revision by hash, re-check it after a short settle
  window (wave 2 used 50 s), then run the contract — and anchor every verdict to the hashes you measured.
```

It requires a SETTLE RE-CHECK but says nothing about TIMESTAMPING the reading. The docs wave paid for
that omission four times: `evidence/docs-overhaul/SUMMARY.md`, "Process notes worth carrying", bullet 2 records
"**Quote a hash with its measurement moment.** Four \"stale reading\" rounds happened because a lane and the
captain sampled the same moving file at different instants. The timestamped `start == end` sandwich is what
distinguishes \"settled\" from \"another lane edited it while I sampled\"." The wave's own seats hit it directly —
one lane's message says the hash its reviewer quoted was the §12-era bytes while the live pair was `62bd827a…`
/ `e964888b…`, and the Reviewer's independent re-measurement had to publish its two sampling instants to prove
its window overlapped another seat's.

Missing rule, stated so it can be inserted verbatim: **a hash is quoted WITH its measurement moment, and a
"settled" claim carries TWO instants (start == end after the settle window).** A bare hash is provenance you
cannot re-anchor; a hash plus its moment can be checked against another seat's window. This is also what makes the
§0 stamp at the top of this file auditable.

## 6. P5 — the six measured PLATFORM frictions (F1–F6), each with its LITERAL string

Each row gives the literal string as the platform emits it (or, where the string is assembled in code, the exact
assembly site), the code symbol that produces it, and the response a seat must use. Everything here was observed
in the FINISHED docs wave of this session; the wave's own records are named where they exist, and the wave's task
contracts (authored by the captain in this session) restate the same six items verbatim.

### F1 — a completion is refused because `acceptanceResults` did not match the contract criteria

- Literal shape (assembled in `packages/mpd-agent-teams-plugin/lib/quality-gates.js`, region
  `coverage-gap-text`, T-87): the refusal ends with
  `` — <parts> (matched <n> of <m>) ``, e.g. `matched 0 of 5`, and the parts name the offenders:
  `no entry for <criterion>`, `nearest provided: "<name>"`, `not passed: <criterion>`. Measured on the wave's own
  integration task: the captain's completion was refused because the payload's criterion strings did not match the
  contract's verbatim.
- Correct response: quote every criterion VERBATIM from `agent_teams_task_contract` (or the assignment prompt)
  into `acceptanceResults[].criterion` — never paraphrase, never re-word, never reorder into your own phrasing.
- Why it costs turns: the refusal is a failed update in the MIDDLE of a completion, so the seat re-reads the
  contract and re-sends — measured twice on one task in the docs wave (once for this class).

### F2 — a repair without provenance is refused

- Literal: `repair tasks require sourceTaskId and at least one sourceFindingId` —
  `packages/mpd-agent-teams-plugin/lib/quality-gates.js:523`.
- Correct response: a `kind=repair` task must cite `sourceTaskId` (the task whose defect it repairs) and at least
  one `sourceFindingIds` entry (the finding id from the review/verification that named the defect).

### F3 — a repair may not depend on a FAILED task

- Literal: `repair must not depend on failed task "<id>"` — the guard is the regression control inside the
  mpd-delta region `repair-source-open-edge` (`packages/mpd-agent-teams-plugin/lib/tools.js`; the generated block
  is visible in `lib/mpd-deltas.js:100`, whose comment names the refusal verbatim).
- Correct response: when a verification FAILS, do not wire its repair to that failed task. File the fix as
  `kind=work` against the upstream work task (or cite a PASSING source), and re-verify with a NEW verification
  task. The failing task stays terminal — its failure is history, not a blocker (the wave's t8 stayed `failed` by
  design while t17/t18 repaired and re-verified).

### F4 — a captain takeover drops back to the member pool when the captain's turn ends

- Literal: `task <id> is owned by member "<name>"; call agent_teams_reassign_task with assignee="captain" before
  takeover` — `packages/mpd-agent-teams-plugin/lib/tools.js`, region `update-task-amend-owned-task`; and the
  reassign tool's own contract states the pool rule: "an unfinished takeover returns to the member pool when the
  captain becomes idle" (`lib/tools.js`, the `agent_teams_reassign_task` description).
- Measured in the docs wave: after a captain takeover of the integration task, the task was re-dispatched to a
  member (this seat) instead of staying with the captain.
- Correct response: complete a takeover to a TERMINAL status in the SAME turn, or re-take it — never leave a
  captain-owned task open across a turn boundary.

### F5 — `amend` cannot change `objective` or `kind`

- Literal shape (the accepted key set, `packages/mpd-agent-teams-plugin/lib/tools.js`, the `amend` object in the
  `agent_teams_update_task` schema): `subject`, `description`, `dependencies`, `acceptance`, `inScope`,
  `outOfScope`, `verify`. NOTE the precise list — `subject` IS amendable; `objective` and `kind` are NOT, so a
  stale objective or a wrong kind CANNOT be corrected by any amend call.
- Correct response: express the corrected intent in `acceptance` (the criterion a reviewer actually judges),
  and RECORD the objective's staleness in the completion payload instead of paraphrasing the objective.

### F6 — the artifact surface is APPEND-ONLY, so a re-verdict concatenates two JSON documents

- Literal (the read-only seat's channel guard): `a READ-ONLY seat (write/edit/bash denied) may write artifacts
  only under evidence/** — its sanctioned append-only channel; got "<path>"` —
  `packages/mpd-agent-teams-plugin/lib/tools.js`.
- Measured shape of the consequence: `evidence/docs-overhaul/verify-design.json` (30,488 bytes) is TWO JSON
  documents back to back — `JSON.parse` throws `Unexpected non-whitespace character after JSON at position 19213`.
  A reviewer who reads only the first document misses the second verdict.
- Correct response: a RE-verdict must be written to a NEW artifact path (e.g. `…-reverify.json`), never appended
  to the file the first verdict occupies; and a consumer of an existing artifact must expect the concatenated
  shape (parse incrementally, or take the LAST document as the live one).

## 7. P6 — the terminal-task RE-DISPATCH pattern (measured, with the correct seat response)

- The pattern, as the wave recorded it (`evidence/docs-overhaul/SUMMARY.md`, "Process notes worth carrying",
  bullet 1): "**The re-dispatch loop cost real turns**: six automatic re-dispatches of already-terminal tasks
  (t13 ×2, t3, t15 ×2, t16), each waking a seat for unclaimable work. Every seat refused correctly; the fix is
  platform-side, and the discipline that kept it harmless was \"a terminal payload is the answer\"."
- The LITERAL refusal the woken seat sees on `agent_teams_claim_task`: `task status cannot move from "completed"
  to "claimed"` — assembled in `packages/mpd-agent-teams-plugin/lib/quality-gates.js:773` as
  `` task status cannot move from "${task.status}" to "${nextStatus}" ``.
- Correct seat response (which the wave's seats all used): refuse the claim, re-read the task contract, verify the
  acceptance ON DISK, and never redo or re-file a terminal result — a terminal payload is the answer.
- HONESTY BOUND for the writing task: the platform already carries guard machinery for two halves of this class,
  so the row must NOT claim "the platform has no guard". Present and measured:
  * `lib/mpd-deltas.js` region `terminal-task-rearm-refusal` -> `assertTaskRearmable()` refuses the attempt
    ROTATION for terminal work with `task <id> is <status>: the attempt rotation is REFUSED for terminal work — a
    terminal task is never re-armed (the record was left untouched)…`;
  * regions `terminal-dispatch-recheck` + `reoffer-terminal-route` (T-93) DECLINE a stale delivery with
    `task <id> became <status> before its assignment could be delivered (routing class reoffer: …)` and, per their
    own comment, "the member was NOT woken for it".
  Six wakes still reached seats in the docs wave, so the row should say exactly that: the guard exists, the wakes
  were still measured, and the seat-side discipline above is what keeps them cheap.


## 8. DESIGN SPEC — how the docs gate must resolve link targets

Decisions, not questions. Every decision is grounded in a measurement above or in a precedent already in
`scripts/verify-docs-parity.mjs`.

### (a) Forms that must be RESOLVED

1. **Inline markdown links `[text](target)` AND images `![alt](target)`** — one scanner for both; an image target
   is a relative target like any other. Strip an optional link title (`(x.md "T")`) and angle brackets (`(<x.md>)`).
2. **With and without a leading `./`, bare names, and subdirectories** — all resolved against `dirname(source)` via
   `path.resolve(root, dirname(source), filePart)`. Today's band uses all three (`./README.zh-CN.md` ×27, bare
   `tui.md` ×6, `guides/nested.md`).
3. **Paths that ESCAPE the doc band** (`../AGENTS.md`, `../../docs/x.md`) — resolved against the ROOT tree (any
   path under root), NOT confined to the band. 25 of today's 192 relative links escape their own directory, and
   `../AGENTS.md` / `../LICENSE-NOTICES.md` are legitimate live targets.
4. **Repeated references** — memoize per (dirname(source), filePart): ONE `stat` per unique resolved path per
   source file; each occurrence is still reported, but duplicate (source, target) pairs collapse into ONE
   violation, so `./docs/usage.md` twice in one file cannot redden twice.
5. **Directory targets count as EXISTING** — `statSync` (which follows symlinks) and accept
   `isFile() || isDirectory()`. 5 such links exist today (`../extensions/mpd-ext-example`,
   `../templates/mpd-extension`, …). A DANGLING symlink is therefore DEAD (stat throws), which is the intended
   strictness.

### (b) Forms that must be IGNORED (counted, never resolved)

- Absolute URLs of ANY scheme (`http:`, `https:`, `mailto:`, `tel:`, `data:`) and protocol-relative `//host` —
  8 such links exist today.
- Pure in-page anchors `#section` (4 today) and empty targets `[]()`.
- **Text inside fenced code blocks and inside INLINE code spans** — the "code-span/template text that is not a
  real link" class. Mirror the fence tracker `headingTree` already uses, and strip inline code spans before
  matching. This is not cosmetic: docs carry copy-paste markdown templates in code blocks.
- Stated boundary (OUT of v1, so it is a decision rather than an omission): HTML `href`/`src` attributes (the
  band's only instances are inside the provenance-exempt README, which is skipped anyway), reference-style link
  definitions `[x]: ./target` (none in the band today), and links inside `EXEMPT_PROVENANCE` files (see (d2)).

### (c) Fragments

Split the target at the FIRST `#`; resolve the FILE part only; never check fragment existence (no anchor checking
in v1). `docs/design.md#anchor` checks `docs/design.md`. A target that is only a fragment is ignored by (b).

### (d) When the target's SITE is absent — the T-75 precedent, applied per link

The same script already answers "what does an absent site mean", and the new check must reuse that answer rather
than invent a mode flag:

- **Discriminator = `AGENTS.md` at the root** (`MANUAL_REL`). The gate's own T-75 comment says a site file
  "ABSENT from a root (the packed artifact ships no AGENTS.md) is a reported note".
- **Full checkout (`AGENTS.md` present): an unresolved relative target is a VIOLATION**, id
  `link-missing:<source-rel>:<target-as-written>`, detail naming the resolved absolute path it looked for.
- **Packed / partial copy (`AGENTS.md` absent): unresolved targets become NOTES**, reason
  `link-absent-site:<source-rel>:<target-as-written> — target not present in this root (packed artifact / partial
  copy); link target not resolved`. `ok` stays true; the notes are PRINTED and present in the JSON result, so the
  run is honest about what it could not check instead of silently passing or falsely reddening.
- Measured packed shape (why this is required, not theoretical): `dist/mpd-package/` ships `agent-references/`,
  `docs/`, `extensions/`, `packages/`, `presets/`, `scripts/`, `skills/`, `templates/`, the README pair and the
  licence files — and ships **no `AGENTS.md`**. `docs/index.md` links `../AGENTS.md` (live in the repo, absent in
  the pack), so a packed run without the note rule would go RED on a legitimate link.
- **(d2) The second, independent skip — `EXEMPT_PROVENANCE`.** That map is already declared in the file with the
  reason "adopted upstream main code, kept VERBATIM as provenance — its bytes cannot carry a marker", and it
  already exempts `packages/mpd-agent-teams-plugin/README.md` from the missing-twin rule. Link resolution must
  reuse it: those files are NOT link-checked, and the run prints a note naming the file plus the number of
  relative targets skipped. Reason it is mandatory: that README holds the tree's ONLY 7 dead relative links
  (`./docs/quality-gates.md`, `./docs/usage.md` ×2, `./skills/dsh-plugin-development/SKILL.md`,
  `./docs/verification-guide.md`, `./docs/developing-dsh-plugins.md`, `./docs/readme-writing-guide.md`) — upstream
  repository paths deliberately not vendored — and its bytes must stay verbatim. WITHOUT this skip the new check
  lands RED on the shipped tree; with it the gate lands GREEN (measured, §9).

### Report surface and counters (decided)

- The result gains `linkNotes: [{path, reason}]` and `linkChecks: {files, links, resolved, dead,
  skippedProvenance, external, anchorOnly}`. Do NOT push link notes into `derivedNotes`: that array is T-75's, and
  its print line is prefixed `DERIVED:`; a link note is not a derived value and the two must stay distinguishable.
- `printReport` gains `note <path> — LINK: <reason>` for each link note, and the summary line gains a link counter
  (`links=<links> dead=<dead>`), so a consumer can assert the check RAN without parsing per-link output.
- Each violation is added through the existing `add(violation.id, …)` path, so `ok` / `failed` / exit-code
  arithmetic is unchanged.
- No new imports beyond `node:fs` / `node:path` already present; no new dependency, no new script, no new gate row
  (the gate is already in `verify:gates` and in `AGENTS.md` §4 as `bun run verify:docs`).

## 9. CENSUS — every relative link in the doc band, produced by a COMMAND

Method (node, no dependency; run from the repo root): mirror the gate's `discoverPairs` discovery set (root README
pair, every `*.md` under `docs/` at any depth, `extensions/` + `templates/` README.md files and marker-promoted
docs, `packages/*/README.md` + twins), strip fenced blocks and inline code spans, extract `[..](target)` /
`![..](target)`, skip external/anchor targets, then `statSync` the path resolved from `dirname(source)`.

```
# doc band = 89 files | relative links = 192 (resolved 185, DEAD 7) | external skipped = 8 | anchor-only skipped = 4
```

VERDICT SUMMARY: the tree is **NOT clean** — 185/192 resolve, and all 7 dead links live inside the ONE file the
gate already exempts as VERBATIM PROVENANCE (`packages/mpd-agent-teams-plugin/README.md`). With the two skips this
spec decides (the provenance skip (d2) and the packed-copy note rule (d)) the extended gate lands GREEN on
today's tree; without the provenance skip it lands RED on 7 links.

Per-link verdicts, complete (one line per relative link; `OK` resolved, `EXEMPT-PROV` absent inside the
provenance-exempt file, `OK-PROV` resolved inside that file):

```
README.md [19]
  OK   ./README.zh-CN.md
  OK   ./docs/tui-parity.md
  OK   ./docs/tui.md
  OK   ./docs/user-guide.md
  OK   ./agent-references/troubleshooting.md
  OK   ./docs/user-guide.md
  OK   ./docs/design.md
  OK   ./docs/tui.md
  OK   ./docs/extension-authoring-guide.md
  OK   ./docs/extensions.md
  OK   ./EXTENSIONS-FOR-AGENTS.md
  OK   ./docs/development.md
  OK   ./docs/index.md
  OK   ./AGENTS.md
  OK   ./docs/design.md
  OK   ./docs/design.zh-CN.md
  OK   ./LICENSE-NOTICES.md
  OK   ./LICENSE.md
  OK   ./LICENSE-NOTICES.md
docs/design.md [4]
  OK   design.zh-CN.md
  OK   ../README.md
  OK   user-guide.md
  OK   ../LICENSE-NOTICES.md
docs/design.zh-CN.md [4]
  OK   design.md
  OK   ../README.zh-CN.md
  OK   user-guide.zh-CN.md
  OK   ../LICENSE-NOTICES.md
docs/development.md [1]
  OK   development.zh-CN.md
docs/development.zh-CN.md [1]
  OK   development.md
docs/extension-adaptation-report.md [1]
  OK   ./extension-adaptation-report.zh-CN.md
docs/extension-adaptation-report.zh-CN.md [1]
  OK   ./extension-adaptation-report.md
docs/extension-authoring-guide.md [12]
  OK   ./extension-authoring-guide.zh-CN.md
  OK   ./extensions.md
  OK   ../packages/mpd-ext-plugin/README.md
  OK   ../EXTENSIONS-FOR-AGENTS.md
  OK   ./extensions.md
  OK   ./extension-adaptation-report.md
  OK   ../templates/mpd-extension
  OK   ./extensions.md
  OK   ../packages/mpd-ext-plugin/README.md
  OK   ../extensions/README.md
  OK   ../templates/mpd-extension/README.md
  OK   ../EXTENSIONS-FOR-AGENTS.md
docs/extension-authoring-guide.zh-CN.md [12]
  OK   ./extension-authoring-guide.md
  OK   ./extensions.md
  OK   ../packages/mpd-ext-plugin/README.md
  OK   ../EXTENSIONS-FOR-AGENTS.md
  OK   ./extensions.md
  OK   ./extension-adaptation-report.zh-CN.md
  OK   ../templates/mpd-extension
  OK   ./extensions.md
  OK   ../packages/mpd-ext-plugin/README.md
  OK   ../extensions/README.md
  OK   ../templates/mpd-extension/README.md
  OK   ../EXTENSIONS-FOR-AGENTS.md
docs/extensions.md [1]
  OK   ./extensions.zh-CN.md
docs/extensions.zh-CN.md [1]
  OK   ./extensions.md
docs/feature-audit.md [1]
  OK   ./feature-audit.zh-CN.md
docs/feature-audit.zh-CN.md [1]
  OK   ./feature-audit.md
docs/index.md [20]
  OK   index.zh-CN.md
  OK   ../README.md
  OK   ../README.md
  OK   user-guide.md
  OK   extensions.md
  OK   extension-authoring-guide.md
  OK   ../EXTENSIONS-FOR-AGENTS.md
  OK   extension-adaptation-report.md
  OK   tui.md
  OK   design.md
  OK   development.md
  OK   ../AGENTS.md
  OK   ../extensions/README.md
  OK   feature-audit.md
  OK   upstream-parity-ledger.md
  OK   upstream-parity-ledger.zh-CN.md
  OK   ../extensions/README.md
  OK   ../extensions/mpd-ext-example
  OK   ../scripts/mpd-ext.mjs
  OK   ../skills/dsh-qa/SKILL.md
docs/index.zh-CN.md [19]
  OK   index.md
  OK   ../README.zh-CN.md
  OK   ../README.zh-CN.md
  OK   user-guide.zh-CN.md
  OK   extensions.zh-CN.md
  OK   extension-authoring-guide.zh-CN.md
  OK   ../EXTENSIONS-FOR-AGENTS.md
  OK   extension-adaptation-report.zh-CN.md
  OK   tui.zh-CN.md
  OK   design.zh-CN.md
  OK   development.zh-CN.md
  OK   ../AGENTS.md
  OK   ../extensions/README.zh-CN.md
  OK   feature-audit.zh-CN.md
  OK   upstream-parity-ledger.zh-CN.md
  OK   ../extensions/README.zh-CN.md
  OK   ../extensions/mpd-ext-example
  OK   ../scripts/mpd-ext.mjs
  OK   ../skills/dsh-qa/SKILL.md
docs/tui-parity.md [1]        OK   ./tui-parity.zh-CN.md
docs/tui-parity.zh-CN.md [1]  OK   ./tui-parity.md
docs/tui.md [1]              OK   ./tui.zh-CN.md
docs/tui.zh-CN.md [1]        OK   ./tui.md
docs/upstream-parity-ledger.md [1]        OK   ./upstream-parity-ledger.zh-CN.md
docs/upstream-parity-ledger.zh-CN.md [1]  OK   ./upstream-parity-ledger.md
docs/user-guide.md [11] (all OK): user-guide.zh-CN.md, ../README.md, design.md, ./tui.md, tui.md ×5, extensions.md, ../LICENSE-NOTICES.md
docs/user-guide.zh-CN.md [11] (all OK): user-guide.md, ../README.zh-CN.md, design.zh-CN.md, ./tui.zh-CN.md, tui.zh-CN.md ×5, extensions.zh-CN.md, ../LICENSE-NOTICES.md
extensions/README.md [5] (all OK): ./README.zh-CN.md, ./mpd-ext-example (DIR), ./mpd-ext-example/server.mjs, ../packages/mpd-ext-plugin/README.md, ../docs/extensions.md
packages/mpd-agent-teams-plugin/README.md [8]
  EXEMPT-PROV ./docs/quality-gates.md -> absent (packages/mpd-agent-teams-plugin/docs/quality-gates.md)
  EXEMPT-PROV ./docs/usage.md -> absent (packages/mpd-agent-teams-plugin/docs/usage.md)
  EXEMPT-PROV ./skills/dsh-plugin-development/SKILL.md -> absent (packages/mpd-agent-teams-plugin/skills/dsh-plugin-development/SKILL.md)
  EXEMPT-PROV ./docs/usage.md -> absent (packages/mpd-agent-teams-plugin/docs/usage.md)
  EXEMPT-PROV ./docs/verification-guide.md -> absent (packages/mpd-agent-teams-plugin/docs/verification-guide.md)
  EXEMPT-PROV ./docs/developing-dsh-plugins.md -> absent (packages/mpd-agent-teams-plugin/docs/developing-dsh-plugins.md)
  EXEMPT-PROV ./docs/readme-writing-guide.md -> absent (packages/mpd-agent-teams-plugin/docs/readme-writing-guide.md)
  OK-PROV ./LICENSE
packages/mpd-team-compact-plugin/README.md [3]
  OK   ./README.zh-CN.md
  OK   ../../docs/user-guide.md
  OK   ../mpd-agent-teams-plugin/README.md
packages/mpd-team-compact-plugin/README.zh-CN.md [3]
  OK   ./README.md
  OK   ../../docs/user-guide.zh-CN.md
  OK   ../mpd-agent-teams-plugin/README.md
packages/<each other package>/README.md + .zh-CN.md [1 + 1]  OK   switch link to the twin (every one resolves)
templates/mpd-extension/README.md [1]  OK   ./README.zh-CN.md
```

(The last three groups are the complete remainder of the 89-file band: 27 packages × 2 files with exactly one
resolving switch link apiece, plus the template pair. The reproduction command is the census script described
above; no link was classified by hand.)


## 10. SELF-TEST ARMS to add to `--self-test` (four; the negative control is mandatory)

Today `--self-test` reports `28/28 checks passed`. All four arms below go into the existing case array (the
temp-fixture style of `selfTest()` / `selfTestDerivedValues()`), so the printed total is DERIVED from the array
(28 -> 32) and must never be hard-coded (T-101).

### Arm 1 — POSITIVE CONTROL: an existing relative target resolves, and the checker is proven to RUN

```js
const clean = verifyDocsParity(sandbox); // the fixture selfTest() already seeds
cases.push({
  case: 'links POSITIVE: an existing relative target resolves and the checker RAN',
  ok: clean.ok === true && clean.linkChecks.checked >= 1 && clean.linkChecks.dead === 0,
  detail: JSON.stringify(clean.linkChecks),
});
```

Anti-vacuity: the `checked >= 1` clause is load-bearing. An implementation that never runs the scanner leaves
`linkChecks` undefined/zero and FAILS this arm even though `ok` is true.

### Arm 2 — NEGATIVE CONTROL (mandatory): a link to a missing file must FAIL, and must NAME the pair

```js
const before = readFileSync(join(sandbox, 'docs/guide.md'), 'utf8');
writeFileSync(join(sandbox, 'docs/guide.md'), before + '\n[missing](./does-not-exist.md)\n');
const bad = verifyDocsParity(sandbox);
cases.push({
  case: 'links NEGATIVE: a link to a missing file REDDENS and NAMES source + target',
  ok: bad.ok === false
    && bad.violations.some((v) => v.id === 'link-missing:docs/guide.md:./does-not-exist.md')
    && bad.linkChecks.checked >= 1 && bad.linkChecks.dead >= 1,
  detail: JSON.stringify(bad.violations.filter((v) => v.id.startsWith('link-missing'))),
});
writeFileSync(join(sandbox, 'docs/guide.md'), before); // restore for the arms that follow
```

WHY IT CANNOT BE SATISFIED BY AN ARM THAT NEVER RUNS: it asserts a NEGATIVE gate result AND the specific
violation id AND a non-zero `dead` counter. A checker that is not wired in produces `ok === true`, no
`link-missing:*` violation and a zero/absent `linkChecks` — all three clauses fail. It must NOT be implemented as
'a note is absent' or as 'ok is unchanged': those pass precisely when nothing runs. The restore line matters too:
the arms share one sandbox, so a leaked dead link would redden every later arm.

### Arm 3 — T-75-STYLE PACKED-COPY ARM: absent site file is a NOTE, and a PRESENT target is still checked

```js
// packed-shaped fixture: the doc band plus AGENTS.md, then the marker removed (the T-75 discriminator)
rmSync(join(packed, 'AGENTS.md'), { force: true });
// docs/guide.md links ../AGENTS.md (absent in this root) and ./guide.zh-CN.md (present)
const packedResult = verifyDocsParity(packed);
cases.push({
  case: 'links PACKED: no AGENTS.md -> absent target is a LINK NOTE (not a failure); present target still checked',
  ok: packedResult.ok === true
    && packedResult.linkNotes.some((n) => n.path === 'docs/guide.md' && n.reason.includes('link-absent-site') && n.reason.includes('AGENTS.md'))
    && packedResult.linkChecks.resolved >= 1,
  detail: JSON.stringify(packedResult.linkNotes),
});
```

Anti-vacuity: `ok === true` alone is satisfiable by a dead scanner; the arm therefore REQUIRES the note (naming
the source and the absent target) AND `resolved >= 1` in the same mode, which proves the packed mode did not
disable resolution wholesale. Build this as a FIXTURE root (as `selfTestDerivedValues()` does), not as a real
`--root dist/mpd-package` run: a real packed root would also have to satisfy every other rule (pairs, exemptions,
T-75 sites), and its outcome would no longer isolate the property under test.

### Arm 4 — PROVENANCE ARM (keeps the REAL tree green, and proves the skip is FILE-SCOPED)

Two halves in one case:

```js
// (a) the EXEMPT_PROVENANCE path with a dead link -> still green, reported as a skip
write(packed, 'packages/mpd-agent-teams-plugin/README.md', '# Upstream\n\n[dead](./docs/usage.md)\n');
// (b) the SAME dead link in a NON-provenance package README (with its zh twin, so the pair rule is satisfied)
write(packed, 'packages/mpd-fixture-pkg/README.md', '# Pkg\n\n[中文](./README.zh-CN.md)\n\n[dead](./dead.md)\n');
write(packed, 'packages/mpd-fixture-pkg/README.zh-CN.md', '# Pkg\n\n[English](./README.md)\n\n正文\n');
const provResult = verifyDocsParity(packed);
// expected: ok === false (half b), with exactly ONE link violation whose id is
// link-missing:packages/mpd-fixture-pkg/README.md:./dead.md, and a link note for the provenance path whose
// reason includes VERBATIM plus linkChecks.skippedProvenance === 1
```

Anti-vacuity: half (b) is the control that stops the skip from being implemented as 'ignore every
packages/*/README.md' — the same dead link reddens the moment it sits in a non-exempt file.

## 11. Risks, landmines and hand-offs for the implementer

1. **`AGENTS.md` line 12 (Language policy) enumerates this gate's checks** — 'enforces the pair, the switch link,
   the heading tree and real CJK content for every pair it discovers'. After the extension that sentence is
   INCOMPLETE, and `AGENTS.md` is NOT in the gate task's `inScope` (the hygiene task owns `AGENTS.md`).
   RECOMMENDATION to the captain: fold a one-line amendment into the hygiene task (or create a follow-up) so the
   manual does not under-describe a gate it tells reviewers to run.
2. **No packed-copy staleness**: `scripts/verify-docs-parity.mjs` is NOT copied into the packed artifact
   (measured: `dist/mpd-package/scripts/` holds only `install-mcp.mjs` and `mpd-ext.mjs`), so this edit raises no
   `verify-pack-closure` freshness question.
3. **Never add a `docs-parity: exempt` marker to the provenance README.** Its bytes must stay verbatim — that is
   exactly why `EXEMPT_PROVENANCE` is a code table rather than an in-file marker. A marker would destroy the
   property that earns the exemption.
4. **No `skills/**` edit is involved**, so this change does NOT invalidate the corpus `treeSha`: the wave's single
   `VENDOR_LOCK.json` re-pin (if any) stays tied to whatever else moves `skills/**`.
5. **The REAL run is part of verification, not only `--self-test`**: the self-test runs on a temp fixture and
   cannot see the tree's 7 provenance links, so the gate task's evidence must include
   `bun run verify:docs` exit 0 on SETTLED bytes plus the new counters (today: `pairs=38 failed=0 violations=0
   exempt=19 derived=3`) — and a reviewer must check the printed `links=<links> dead=<dead>` counter, because
   `dead` counts only NON-exempt links.
6. **Read-only-seat boundary**: this fact base was written through the task's `artifact` channel
   (`evidence/**` only) — no shipped file was touched, and neither the gate, `.gitignore`, `AGENTS.md` nor
   `agent-references/troubleshooting.md` was modified by t1.

## 12. Acceptance checklist for this task

| t1 acceptance item | where it is satisfied |
|---|---|
| fact base at `evidence/process-fixes/fact-base.md` covering all six problems with exact evidence | §1 inventory P1–P6; P1 §2, P2 §3, P3 §4, P4 §5, P5 §6 (F1–F6 with literal strings), P6 §7 |
| the literal refusal/error string for the frictions | §6 F1–F6 and §7 (each quoted, with the code symbol or assembly site that produces it) |
| the file + symbol proving link targets are never resolved | §2: `switchLinkUnderTitle` in `scripts/verify-docs-parity.mjs` (spelling-only RegExp; no stat/existsSync on any link target; no link extractor in the file) |
| `.gitignore` line number + the command showing `git check-ignore` exits 1 | §3: line 52 `evidence/**/sandbox/`; `git check-ignore -v <symlink>` -> exit 1 with no output; `git status --porcelain` -> `?? …/sandbox` |
| DESIGN SPEC with a decision for (a)–(e) | §8 (a) resolved forms, (b) ignored forms, (c) fragments, (d) absent site = T-75 NOTE + (d2) provenance skip, (e) directory counts as existing |
| census of every relative link in the doc band, by command, verdict per link | §9 (89 files, 192 links, 185 resolved / 7 dead, per-link verdict list, reproduction method) |
| at least three self-test arms incl. the mandatory negative control | §10 (4 arms; Arm 2 is the negative control and carries the anti-vacuity clauses) |
| no shipped file modified | §11 item 6 |
