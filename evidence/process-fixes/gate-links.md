# t3 — docs gate resolves relative link TARGETS (the class that hid the dead `architecture.md` links)

Task: `t3` (implementation) in team `mpd-process-hardening` / wave `w1`. Seat: Senior Engineer.
In-scope files: `scripts/verify-docs-parity.mjs`, `evidence/process-fixes/gate-links.md`. Nothing else in
the repository was written by this task.
AMENDED by `t8` (repair, same seat, same two in-scope files): §0b and §12 record the ROOT-relative
target fix for the t5-F1 finding. The t3 sections below stay as the record of the revision they were
measured on; §12 carries the CURRENT revision's hashes, commands and exit codes.

## 0a. Settle sandwich — t3 revision (historical record)

| instant (UTC) | `scripts/verify-docs-parity.mjs` sha256 |
|---|---|
| start `2026-09-19T11:38:46Z` | `c97c6520f92b85630acaaa8f1e4b4f919ba730540cb796f514ed850e23d59453` |
| interim read `2026-09-19T11:39:21Z` (35 s) | `c97c6520f92b85630acaaa8f1e4b4f919ba730540cb796f514ed850e23d59453` |
| end `2026-09-19T11:39:53Z` (67 s — past the wave's 50 s settle window) | `c97c6520f92b85630acaaa8f1e4b4f919ba730540cb796f514ed850e23d59453` |

IDENTICAL across the whole 67 s window, so the readings in §3–§8 are SETTLED, not a mid-write snapshot.
No edit to the script landed between the reads (the file was frozen before the first command in §3 ran;
the commands themselves only READ it).
Pre-edit baseline for reference: `2bbe584a5906537460138adb2f5997bf573ceccf50fda8488c91a7ebe428ce6e`
(the hash t1's fact base recorded at `2026-09-19T11:27:54Z == 11:28:44Z`). An earlier revision of the
implementation (`3706603e…`, 11:37:00Z–11:37:59Z) carried the same measured behaviour; the only delta
to `c97c6520…` is a comment reflow plus comment wording, and EVERY command below was re-run on
`c97c6520…` after that edit.

## 0b. Settle sandwich — t8 repaired revision (CURRENT)

| instant (UTC) | `scripts/verify-docs-parity.mjs` sha256 |
|---|---|
| start `2026-09-19T11:48:14Z` | `1cb83b1394df66e148c44d3c322bcbbf470ffdd0c959068b24af793ee5163f4e` |
| end `2026-09-19T11:49:09Z` (55 s — past the wave's 50 s settle window) | `1cb83b1394df66e148c44d3c322bcbbf470ffdd0c959068b24af793ee5163f4e` |

IDENTICAL across the 55 s window. §12's commands were run on this revision AFTER `11:48:14Z` and the
script was not edited again; the two mutations below were applied to COPIES in `/tmp`, never to the
repository file (the shipped bytes are exactly `1cb83b13…`).

## 0c. Settle sandwich — every t3 verdict below is anchored to a TIMESTAMPED hash

## 1. What changed (cited by SYMBOL, never by line number — T-55)

One file, `scripts/verify-docs-parity.mjs` (+302 / −3 lines), with these additions:

- `linkTargets(text)` — the scanner. Walks the file line by line with the SAME fence tracker
  `headingTree` already uses, strips inline code spans, and extracts `[text](target)` /
  `![alt](target)` targets (optional `"title"` and `<...>` forms handled). Returns
  `{target, line}` per occurrence.
- `linkBand(root, pairs, exemptNotes)` — the file set, and it invents NO discovery: both halves of
  every pair `discoverPairs` already found, PLUS every existing `*.md` it already reports as a
  lone-file exemption. `agent-references/**` stays out (T-28), and the two ANTICIPATORY paths are
  dropped by existence.
- `checkLinkTargets(root, band)` — classification + resolution: external schemes / protocol-relative /
  in-page anchors / empty targets are counted and IGNORED; everything else resolves from
  `dirname(source)` against the tree root with the `#fragment` stripped, `statSync`-ed, and a
  DIRECTORY counts as existing. Returns `{violations, notes, counters}`.
- `MANUAL_REL` (`AGENTS.md`) is reused as the packed-copy DISCRIMINATOR (the T-75 rule the file
  already applies to the derived-value sites): absent ⇒ an unresolved target is a NOTE.
- `EXEMPT_PROVENANCE` is reused as the second, INDEPENDENT skip: an absent target in a file kept
  VERBATIM is reported as EXEMPT PROVENANCE — never a violation, and never a pass.
- Report surface: `verifyDocsParity` now returns `linkNotes: [{path, reason}]` and
  `linkChecks: {files, links, checked, resolved, dead, skippedProvenance, absentSite, external,
  anchorOnly}`; `printReport` prints `note <path> — LINK: <reason>` lines and a counter line, and the
  summary line gains `links=<links> dead=<dead>`. Link violations go through the existing
  `violations` array, so `ok` / `failed` / exit-code arithmetic is untouched.
- `selfTestLinks()` — 5 new arms, called from `selfTest()` next to `selfTestDerivedValues()`.

Counter invariants (asserted by construction, not by documentation):
`links = checked + external + anchorOnly` and `checked = resolved + dead + skippedProvenance +
absentSite` — every discovered occurrence lands in exactly one bucket.

## 2. Link classes — the decided spec, as implemented

| class | example | treatment |
|---|---|---|
| `./x`, bare `x`, `../x`, nested | `./README.zh-CN.md`, `tui.md`, `../AGENTS.md` | RESOLVED from `dirname(source)` against the tree root |
| fragment | `docs/design.md#anchor` | file part resolved, fragment NEVER checked (v1) |
| directory target | `../extensions/mpd-ext-example` | EXISTS (a DANGLING symlink is therefore dead) |
| link title / angle form | `[x](../AGENTS.md "t")`, `[x](<../AGENTS.md>)` | the TITLE is stripped, the path resolved |
| absolute URL / protocol-relative | `https://…`, `mailto:…`, `tel:…`, `data:…`, `//host` | counted `external`, never resolved |
| in-page anchor / empty | `#section`, `[]()` | counted `anchorOnly`, never resolved |
| fenced block / inline code span | `` `[decoy](./decoy.md)` ``, a fenced template | NOT a link at all (not counted) |
| duplicate `(source, target)` | `./docs/usage.md` twice in one file | ONE violation (`dead` counts occurrences, the violation list collapses the duplicate) |

## 3. Commands run, with exit codes

Run from the repo root on the settled revision `c97c6520…`:

| # | command | exit | observed |
|---|---|---|---|
| 1 | `node scripts/verify-docs-parity.mjs` | **0** | `pairs=38 failed=0 violations=0 exempt=19 derived=3 links=234 dead=0 — PASS` |
| 2 | `node scripts/verify-docs-parity.mjs --self-test` | **0** | `33/33 checks passed — PASS` (28 pre-existing + 5 new arms) |
| 3 | `node scripts/verify-gates.mjs` (`bun run verify:gates`) | **0** | `PASS - 5/5 member gate(s) green` (docs-parity member `exit=0 PASS - 98ms`, preset-conformance green) |
| 4 | `node scripts/verify-docs-parity.mjs --root /tmp/mpd-link-demo` (injected dead link, §6) | **1** | one `FAIL link-missing:…` line, `dead=1` |

Full counter line of run 1 (verbatim):

```
[verify-docs-parity] links=234 checked=217 resolved=210 dead=0 exemptProvenance=7 absentSite=0 ignoredExternal=13 ignoredAnchorOnly=4 files=92
[verify-docs-parity] root=/root/dshProj/my-power-dsh pairs=38 failed=0 violations=0 exempt=19 derived=3 links=234 dead=0 — PASS
```

## 4. Unrelated gate behaviour is unchanged (acceptance item 5)

The pair / switch-link / heading-tree / CJK verdicts and their arms are untouched — no code path of
theirs was edited, and the two measurements agree EXACTLY with the pre-change baseline t1 recorded:

| measurement | t1 baseline (pre-change) | this run (post-change) |
|---|---|---|
| real run surface | `pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS` | `pairs=38 failed=0 violations=0 exempt=19 derived=3 links=234 dead=0 — PASS` |
| self-test | `28/28 checks passed — PASS` | `33/33 checks passed — PASS` (the same 28 cases, all still `ok`, plus 5) |
| `--self-test` negative controls | missing switch link / re-levelled heading / pure-ASCII zh / mis-pointed nested switch link each redden | identical verdicts (all four arms still `ok`) |
| aggregate | — | `verify:gates` `5/5 member gate(s) green` |

## 5. The 5 new self-test arms (named, printed by `--self-test`)

1. `links POSITIVE: an existing relative target resolves and the checker RAN` — asserts
   `ok === true`, `checked >= 1` (**load-bearing**: a checker that is not wired in leaves the counters
   absent/zero and FAILS this arm even though `ok` is true), `dead === 0`, `resolved >= 5`,
   `external >= 2`, `anchorOnly >= 1`.
2. `links IGNORED: external, protocol-relative, mailto, anchor, empty, code-span and fenced targets are
   counted but never resolved` — the fixture carries `./code-span.md` and `./fenced.md` decoys that do
   NOT exist, so a scanner that resolved them would redden; asserts `ok === true`,
   no `link-missing:*` violation, `external >= 3`, `anchorOnly >= 3`.
3. `links NEGATIVE: a link to a missing file REDDENS and NAMES source + target` — the mandatory
   negative control: appends `[missing](./does-not-exist.md)` to `docs/guide.md` and asserts
   `ok === false` AND the specific id `link-missing:docs/guide.md:./does-not-exist.md` AND
   `dead >= 1`. A checker that never ran yields `ok === true`, no such violation and a zero counter —
   all three clauses fail. The fixture is restored in the same arm (the arms share one root).
4. `links PACKED: no AGENTS.md -> an absent target is a LINK NOTE (not a failure) while a present target
   is still checked` — the T-75 arm: asserts `ok === true`, no `link-missing:*`, a note with
   `link-absent-site` naming `docs/guide.md` and `AGENTS.md`, `resolved >= 1` **and** `absentSite >= 1`
   (so packed mode did not disable resolution wholesale).
5. `links PROVENANCE: a dead link in the VERBATIM file stays green and is REPORTED as EXEMPT, while the
   SAME dead link in a non-exempt README reddens (the skip is FILE-scoped)` — asserts exactly ONE link
   violation, id `link-missing:packages/mpd-fixture-pkg/README.md:./dead.md`, plus
   `skippedProvenance === 1` and a provenance note carrying `EXEMPT_PROVENANCE`. Half (b) is the
   control that stops the skip from becoming "ignore every package README".

Printed arm lines from run 2 (abridged to the new arms):

```
ok   links POSITIVE: an existing relative target resolves and the checker RAN — {"files":6,"links":13,"checked":10,"resolved":10,"dead":0,"skippedProvenance":0,"absentSite":0,"external":2,"anchorOnly":1}
ok   links IGNORED: … — {"files":7,"links":17,"checked":10,"resolved":10,"dead":0,…,  "external":5,"anchorOnly":3}
ok   links NEGATIVE: a link to a missing file REDDENS and NAMES source + target — FAIL link-missing:docs/guide.md:./does-not-exist.md — docs/guide.md:17 links "./does-not-exist.md" but neither a file nor a directory exists at /tmp/…/full/docs/does-not-exist.md — …
ok   links PACKED: no AGENTS.md -> an absent target is a LINK NOTE (not a failure) while a present target is still checked — {"counters":{"files":6,"links":13,"checked":10,"resolved":7,"dead":0,"skippedProvenance":0,"absentSite":3,…},"notes":[{"path":"docs/guide.md","reason":"link-absent-site:docs/guide.md:../AGENTS.md — target not present in this root (packed artifact / partial copy); link target not resolved"}]}
ok   links PROVENANCE: … — {"violations":["link-missing:packages/mpd-fixture-pkg/README.md:./dead.md"],"counters":{"files":9,"links":22,…,"dead":1,"skippedProvenance":1,…},"provenanceNote":{"path":"packages/mpd-agent-teams-plugin/README.md","reason":"EXEMPT_PROVENANCE (…): 1 relative target(s) reported as EXEMPT PROVENANCE — never a pass and never a violation, …"}}

[verify-docs-parity self-test] 33/33 checks passed — PASS
```

Arm count is DERIVED from the case array (28 → 33), never hard-coded (T-101).

### 5b. Falsifiability — the 5 new arms FAIL when the scanner is unwired (run on a COPY, repo untouched)

A one-token mutation on a copy in `/tmp` (`for (const { target, line } of linkTargets(""))` — the
scanner not wired in) turns the new arms RED while the 28 pre-existing arms stay green:

```
$ cp scripts/verify-docs-parity.mjs /tmp/mutant-unwired.mjs
$ sed -i 's/of linkTargets(text))/of linkTargets(""))/' /tmp/mutant-unwired.mjs
$ node /tmp/mutant-unwired.mjs --self-test            # exit 1
FAIL links POSITIVE: … — {"files":6,"links":0,"checked":0,"resolved":0,"dead":0,…}
FAIL links IGNORED: … — {"files":7,"links":0,"checked":0,…}
FAIL links NEGATIVE: a link to a missing file REDDENS and NAMES source + target — []
FAIL links PACKED: … — {"counters":{"files":6,"links":0,…},"notes":[]}
FAIL links PROVENANCE: … — {"violations":[],"counters":{"files":9,"links":0,…},"provenanceNote":null}
[verify-docs-parity self-test] 28/33 checks passed — FAIL
```

So each new arm is falsifiable, the arms do not share a single point of failure with the old ones, and
none of them can be satisfied by a checker that never runs. The repository copy was NOT mutated.
Re-run identically on the settled revision `c97c6520…`: `grep -cE '^FAIL links '` → **5**.

### 5c. Result surface (machine-readable)

`node scripts/verify-docs-parity.mjs --json /tmp/out.json` → exit 0 (the file lands outside the
repository; `--json` writes only where it is told):

```
ok: true
linkChecks: {"files":92,"links":234,"checked":217,"resolved":210,"dead":0,"skippedProvenance":7,"absentSite":0,"external":13,"anchorOnly":4}
linkNotes: 1   # the EXEMPT_PROVENANCE note naming the 7 absent targets
```

## 6. Demonstration — an injected dead link and the FAIL line it produced

No repository file was touched: a scratch FULL-checkout fixture root (AGENTS.md present, so the
fixture is not in packed mode) was generated in `/tmp` with one injected dead link to the retired
`docs/architecture.md`, and the REAL gate binary was run against it with `--root`.

Fixture generator (deterministic, `/tmp`-only): writes the minimal T-75-clean skeleton (manual +
deltas doc + registry + index + marker file) and the pair `docs/guide.md` (+ its zh twin) whose body
carries:

```markdown
See the [retired architecture doc](./architecture.md) for the old layout.
```

Real output of `node scripts/verify-docs-parity.mjs --root /tmp/mpd-link-demo` (exit **1**):

```
ok   docs/guide.md
FAIL link-missing:docs/guide.md:./architecture.md — docs/guide.md:7 links "./architecture.md" but neither a file nor a directory exists at /tmp/mpd-link-demo/docs/architecture.md — this gate resolves relative link TARGETS (two rounds of dead links to the retired docs/architecture.md passed it green BEFORE this row); fix the link or retire the target in the same change
skip packages/mpd-agent-teams-plugin/README.md — EXEMPT: adopted upstream main code, kept VERBATIM as provenance — its bytes cannot carry a marker
note AGENTS.md — DERIVED: 1 delta-range claim(s) A1–D2 checked against "A1–D2" derived from agent-references/agent-teams-deltas.md
note agent-references/index.md — DERIVED: …
note agent-references/agent-teams-deltas.md — DERIVED: …
[verify-docs-parity] links=3 checked=3 resolved=2 dead=1 exemptProvenance=0 absentSite=0 ignoredExternal=0 ignoredAnchorOnly=0 files=3
[verify-docs-parity] root=/tmp/mpd-link-demo pairs=1 failed=1 violations=1 exempt=3 derived=3 links=3 dead=1 — FAIL
```

That is the class this task closes: before the change the SAME fixture exited 0 (`docs/guide.md`
passed, because the only link logic was the twin-basename spelling test).

## 7. The exempt file — the 7 dead links reported as EXEMPT PROVENANCE, never as passes (acceptance item 1)

`packages/mpd-agent-teams-plugin/README.md` is the tree's ONLY file with dead relative links (adopted
upstream main code kept VERBATIM; the targets are upstream repository paths that were deliberately not
vendored). It is exempted by the script's existing `EXEMPT_PROVENANCE` map — the same map that already
covers it for the missing-twin rule — and the run PRINTS the finding instead of passing it:

```
note packages/mpd-agent-teams-plugin/README.md — LINK: EXEMPT_PROVENANCE (adopted upstream main code, kept VERBATIM as provenance — its bytes cannot carry a marker): 7 relative target(s) reported as EXEMPT PROVENANCE — never a pass and never a violation, because these bytes cannot change; no target exists in this root for: ./docs/quality-gates.md, ./docs/usage.md, ./skills/dsh-plugin-development/SKILL.md, ./docs/usage.md, ./docs/verification-guide.md, ./docs/developing-dsh-plugins.md, ./docs/readme-writing-guide.md
```

The 7 targets are exactly the 7 the independent census in `evidence/process-fixes/fact-base.md` §9
found, in the same file and in the same order (`./docs/usage.md` appears twice — the counter reports
occurrences, the violation list would collapse the duplicate). No file was edited to make this pass:
the exemption is the code table that was already there, and `--self-test` arm 5 proves the skip is
FILE-scoped (the same kind of dead link reddens in a non-exempt README).

## 8. Packed / partial copy — the T-75 discriminator (acceptance item 2)

`dist/mpd-package/` ships no `AGENTS.md` while `docs/index.md` links `../AGENTS.md`
(measured packed layout: `evidence/process-fixes/fact-base.md` §8(d)). Measured behaviour on the
packed-shaped fixture (`MANUAL_REL` absent):

- the unresolved `../AGENTS.md` target becomes `link-absent-site:…` NOTES (3 occurrences, deduped to
  one note per `(source, target)`), `ok` stays **true**, `dead === 0`, `absentSite === 3`;
- the targets that ARE present (`../agent-references/index.md`, `../agent-references`, the switch
  links) are still resolved — `resolved === 7`, so the check is not silently skipped in packed mode;
- a target anywhere else that is unresolved in a packed root is a NOTE too, and the notes are printed
  AND present in the JSON result (`--json`), so the run is honest about what it could not check.

The arm is a FIXTURE root by design, not a real `--root dist/mpd-package` run: a real packed root would
also have to satisfy every other rule (pairs, exemptions, the T-75 sites) and its outcome would no
longer isolate the property under test.

REAL packed root, corroborating the fixture (this workspace ships one: `dist/mpd-package/`, and
`dist/mpd-package/AGENTS.md` does not exist — measured). `node scripts/verify-docs-parity.mjs --root
dist/mpd-package` → exit **0**:

```
note README.md — LINK: link-absent-site:README.md:./AGENTS.md — target not present in this root (packed artifact / partial copy); link target not resolved
note README.zh-CN.md — LINK: link-absent-site:README.zh-CN.md:./AGENTS.md — target not present in this root (packed artifact / partial copy); link target not resolved
note docs/index.md — LINK: link-absent-site:docs/index.md:../AGENTS.md — target not present in this root (packed artifact / partial copy); link target not resolved
note docs/index.zh-CN.md — LINK: link-absent-site:docs/index.zh-CN.md:../AGENTS.md — target not present in this root (packed artifact / partial copy); link target not resolved
note packages/mpd-agent-teams-plugin/README.md — LINK: EXEMPT_PROVENANCE (…): 7 relative target(s) reported as EXEMPT PROVENANCE — never a pass and never a violation, … for: ./docs/quality-gates.md, ./docs/usage.md, ./skills/dsh-plugin-development/SKILL.md, ./docs/usage.md, ./docs/verification-guide.md, ./docs/developing-dsh-plugins.md, ./docs/readme-writing-guide.md
[verify-docs-parity] links=230 checked=213 resolved=202 dead=0 exemptProvenance=7 absentSite=4 ignoredExternal=13 ignoredAnchorOnly=4 files=88
[verify-docs-parity] root=dist/mpd-package pairs=36 failed=0 violations=0 exempt=19 derived=3 links=230 dead=0 — PASS
```

Read honestly: the pack is a PRE-EXISTING artifact snapshot (it ships no `scripts/verify-docs-parity.mjs`,
per `evidence/process-fixes/fact-base.md` §11 item 2), so this is the CHECKOUT's gate binary run against
the packed ROOT — which is exactly the property under test. It invents NO failures (`violations=0`) and
does NOT skip silently: `checked=213` with `resolved=202` proves the resolution ran, and the 4
unresolvable `AGENTS.md` targets are printed as NOTES instead of being either invented as failures or
silently skipped.

## 9. Independent cross-check against t1's census — what agrees, and one headline number that does not

The census (`evidence/process-fixes/fact-base.md` §9) is the independent evidence cited by the task
contract. Reproducing it per file against the settled revision, with the gate's own band rule:

| comparison | result |
|---|---|
| per-file link counts, for every file the census lists EXPLICITLY (29 files, 147 links) | **0 disagreements** — e.g. `docs/index.md` 20, `docs/index.zh-CN.md` 19, `README.md` 19, `docs/user-guide.md` 11, `docs/extension-authoring-guide.md` 12, `packages/mpd-agent-teams-plugin/README.md` 8 (7 absent + 1 resolving) |
| the 7 dead links and their file | **reproduced exactly**, same 7 targets, same file |
| census headline: 89 band files / 192 relative links / 185 resolved / 7 dead | the gate on the same tree: **92 band files / 217 relative link occurrences** (+13 external +4 anchor-only = the gate's `links=234`) / `resolved=210` / `dead=0` / `skippedProvenance=7` |

The 3-file difference is the census's lone-file exemption list (it counted 13 existing exempt `*.md`
files; the gate derives 16: the extra three are `docs/plan-team-watchdog.md`,
`docs/plan-team-watchdog-report.md`, `docs/plan-tui-team-surface.md`, all present in the tree since
2026-09-15/16 and all link-free, so they move the FILE count only). The 25-link difference is in the
census's COMPRESSED groups (e.g. `packages/<each other package>/README.md + .zh-CN.md [1 + 1]`, and the
zh halves of rows it prints once): summing its own per-file numbers over the gate's band gives 217, not
192, with zero per-file disagreement — so the headline total is understated relative to the tree, while
its material claim (the 7 dead links, all inside the exempt file) holds exactly. RECORDED AS A
DISCREPANCY, not smoothed over: the gate's numbers are the ones a reviewer should cite.

Reproduction recipe (no dependency; run from the repo root). The band/total the gate reports is
`node scripts/verify-docs-parity.mjs`, whose counter line carries every number above; the per-file
profile was produced by a ~50-line replica of `linkTargets` + the band rule that counts, per file,
targets that are not external / protocol-relative / anchor-only and whose file part is non-empty:

```
node scripts/verify-docs-parity.mjs | tail -2        # files=, links=, checked=, resolved=, dead=, exemptProvenance=, absentSite=, ignoredExternal=, ignoredAnchorOnly=
```

## 10. Bounds and deliberate v1 limits (so a reader is not misled)

- NOT checked: HTML `href`/`src` attributes (the band's only instances are inside the exempt
  provenance README, which is skipped anyway), reference-style definitions `[x]: ./target` (none in
  the band today), and anchor/fragment EXISTENCE (a `#fragment` is stripped, never resolved).
- `agent-references/**` is NOT in the band — the gate does not discover that tree (T-28). Its own
  relative links are therefore not policed; the manual's policy sentence therefore needed the
  one-line amendment the hygiene lane landed in the SAME wave (AGENTS.md now describes the resolution
  and the two bounds).
- The packed-copy rule is deliberately PER RUN, not per link: `AGENTS.md` absence means "this root is
  a packed artifact or partial copy", which is exactly the T-75 discriminator the file already uses.
- No new import beyond `statSync` (`node:fs`) and `resolve` (`node:path`): no new dependency, no new
  script, no new gate row. `scripts/verify-docs-parity.mjs` is NOT copied into the packed artifact, so
  this edit raises no `verify-pack-closure` freshness question
  (`evidence/process-fixes/fact-base.md` §11 item 2).

## 11. Files changed by this task

| path | what |
|---|---|
| `scripts/verify-docs-parity.mjs` | the implementation (§1) — `c97c6520…` at all three sandwich instants |
| `evidence/process-fixes/gate-links.md` | this artifact |

No `docs/**`, README, `AGENTS.md`, `.gitignore` or `packages/**` file was written by t3 (out of scope).
`git status --porcelain` at the end shows `scripts/verify-docs-parity.mjs` under ` M`, plus the other
lanes' concurrent edits (`.gitignore`, `AGENTS.md`, `agent-references/troubleshooting.md`) and the
untracked `evidence/process-fixes/` — the captain is the single git writer (§5).

## 12. t8 repair — ROOT-relative targets resolve against the REPO ROOT (t5-F1)

### 12.1 The finding

t5's independent verification measured the class: a link target that begins with `/` (e.g.
`[x](/docs/index.md)`) was joined by `resolve(root, dirname(rel), filePart)`; a leading `/` makes the
path ABSOLUTE for `path.resolve`, so the target escaped to the FILESYSTEM root and a target that EXISTS
in the tree was reported DEAD — a false positive that would redden the first doc that used one.

PRE-FIX reproduction (the old line restored on a COPY; the repository file was never in this state):
fixture `/tmp/mpd-rootrel-demo` = a minimal full-checkout tree in which `docs/guide.md` EXISTS and
`docs/rootrelative.md` links `[the guide](/docs/guide.md)`.

```
$ cp scripts/verify-docs-parity.mjs /tmp/prefix-rootrel.mjs
$ sed -i 's|const abs = resolve(root, base, cleaned);|const abs = resolve(root, dirname(rel), filePart);|' /tmp/prefix-rootrel.mjs
$ node /tmp/prefix-rootrel.mjs --root /tmp/mpd-rootrel-demo          # exit 1
FAIL link-missing:docs/rootrelative.md:/docs/guide.md — docs/rootrelative.md:4 links "/docs/guide.md" but neither a file nor a directory exists at /docs/guide.md — this gate resolves relative link TARGETS (two rounds of dead links to the retired docs/architecture.md passed it green BEFORE this row); fix the link or retire the target in the same change
[verify-docs-parity] links=3 checked=3 resolved=2 dead=1 exemptProvenance=0 absentSite=0 ignoredExternal=0 ignoredAnchorOnly=0 files=4
[verify-docs-parity] root=/tmp/mpd-rootrel-demo pairs=1 failed=1 violations=1 exempt=4 derived=3 links=3 dead=1 — FAIL
```

`… exists at /docs/guide.md` is the measured escape: the resolver looked at the FILESYSTEM root, not
the tree.

### 12.2 The fix (explicit normalization, not a fallback)

In `checkLinkTargets`, the leading slash is STRIPPED before the target is joined and the join BASE
becomes the repo root:

```js
const rootRelative = filePart.startsWith("/");
const cleaned = rootRelative ? filePart.replace(/^\/+/, "") : filePart;
const base = rootRelative ? root : dirname(rel);
const abs = resolve(root, base, cleaned);
```

There is deliberately NO `existsSync` retry and no filesystem-root probe: a genuinely wrong path
cannot be silently accepted, and the `#fragment` split still happens BEFORE this block. AFTER the fix,
the SAME fixture:

```
$ node scripts/verify-docs-parity.mjs --root /tmp/mpd-rootrel-demo   # exit 0
[verify-docs-parity] links=3 checked=3 resolved=3 dead=0 exemptProvenance=0 absentSite=0 ignoredExternal=0 ignoredAnchorOnly=0 files=4
[verify-docs-parity] root=/tmp/mpd-rootrel-demo pairs=1 failed=0 violations=0 exempt=4 derived=3 links=3 dead=0 — PASS
```

A `/`-prefixed target that does NOT exist still reddens — the normalization is not "ignore anything
starting with `/`" (asserted by the arm below, id
`link-missing:docs/root-relative.md:/nowhere/absent.md`).

### 12.3 The new self-test arm (34th)

`links ROOT-RELATIVE: a `/`-prefixed target resolves against the REPO ROOT (existing file + directory
count as RESOLVED), while a missing one still REDDENS with its id`

The fixture is a doc carrying `/docs/guide.md` (a FILE) and `/packages` (a DIRECTORY); counters are
compared against a baseline taken on the spot, then the doc is rewritten with a MISSING root-relative
target. Printed line:

```
ok   links ROOT-RELATIVE: a `/`-prefixed target resolves against the REPO ROOT (existing file + directory count as RESOLVED), while a missing one still REDDENS with its id — {"resolvedBefore":12,"resolvedWithTwoLiveTargets":14,"deadBefore":1,"deadWithMissingTarget":2,"finding":"link-missing:docs/root-relative.md:/nowhere/absent.md"}
```

`resolved +2` for the two live targets and `dead` unchanged is the part a broken normalization cannot
fake; the missing target then moves `dead` by exactly +1.

### 12.4 Falsifiability — ONE TOKEN reddens exactly this arm

```
$ cp scripts/verify-docs-parity.mjs /tmp/mutant-rootrel.mjs
$ sed -i 's/const base = rootRelative ? root : dirname(rel);/const base = false ? root : dirname(rel);/' /tmp/mutant-rootrel.mjs
$ node /tmp/mutant-rootrel.mjs --self-test                           # exit 1
FAIL links ROOT-RELATIVE: a `/`-prefixed target resolves against the REPO ROOT (existing file + directory count as RESOLVED), while a missing one still REDDENS with its id — {"resolvedBefore":12,"resolvedWithTwoLiveTargets":12,"deadBefore":1,"deadWithMissingTarget":3,"finding":"link-missing:docs/root-relative.md:/nowhere/absent.md"}
[verify-docs-parity self-test] 33/34 checks passed — FAIL
```

The mutation is literally ONE token (`rootRelative` → `false`); exactly ONE arm goes red (the new one)
and the other 33 stay green. Applied to a COPY — the shipped bytes keep the root base.

### 12.5 Commands, exit codes and counters on the repaired revision

Revision `1cb83b1394df66e148c44d3c322bcbbf470ffdd0c959068b24af793ee5163f4e` (@ `11:48:14Z`, re-read
unchanged @ `11:49:09Z`):

| # | command | exit | observed |
|---|---|---|---|
| 1 | `node scripts/verify-docs-parity.mjs` | **0** | `pairs=38 failed=0 violations=0 exempt=19 derived=3 links=234 dead=0 — PASS`; counters `links=234 checked=217 resolved=210 dead=0 exemptProvenance=7 absentSite=0 ignoredExternal=13 ignoredAnchorOnly=4 files=92` — **IDENTICAL to the t3 revision, no counter moved** |
| 2 | `node scripts/verify-docs-parity.mjs --self-test` | **0** | `34/34 checks passed — PASS` (the 33 arms of §5 + the new ROOT-RELATIVE arm) |
| 3 | `node scripts/verify-gates.mjs` | **0** | `PASS - 5/5 member gate(s) green` |
| 4 | fixed gate on the `/`-prefixed fixture (§12.2) | **0** | `resolved=3 dead=0` — the pre-fix run of the same fixture was exit 1 |
| 5 | one-token mutant self-test (§12.4) | **1** | `33/34`, exactly the new arm red |

WHY NO COUNTER MOVED ON THE SHIPPED TREE (measured, not assumed): the shipped band carries NO
`/`-prefixed relative target today —

```
$ grep -rn '](/' README.md README.zh-CN.md docs extensions templates packages/*/README.md packages/*/README.zh-CN.md | grep -v '](//'
(no match)
```

so the fix cannot move `links` / `resolved` / `dead` / `exemptProvenance` / `absentSite` here; it
closes a false-positive class that would have reddened the FIRST doc that uses such a link. Any counter
movement would have been a regression signal, and none occurred.

### 12.6 The t5-F2 bound is untouched

Fragments are still STRIPPED, never validated as anchors: `linkTargets` keeps the target verbatim, the
classifier treats a pure `#anchor` as `anchorOnly` (counted, never resolved), and
`filePart = target.split("#")[0]` splits the fragment off BEFORE the ROOT-relative block, so
`/docs/guide.md#section` resolves the file and ignores the anchor. NO anchor/fragment validation was
added by this task, and the policy text already declares the bound.

### 12.7 Files changed by t8

| path | what |
|---|---|
| `scripts/verify-docs-parity.mjs` | the ROOT-relative fix (§12.2) + the 34th arm (§12.3) — `1cb83b13…` at both §0b instants |
| `evidence/process-fixes/gate-links.md` | this section |

No `docs/**`, README, `AGENTS.md`, `.gitignore`, `agent-references/**` or `packages/**` file was
written by t8 (out of scope).

OBSERVATION for the captain (NOT actioned here — `AGENTS.md` is outside this task's scope): the
language policy enumerates "a `./x`, `x` or `../x` target resolves from the LINKING file's own
directory" and does not name the `/`-rooted class. The sentence is not WRONG (it does not claim to be
exhaustive), but naming the root-relative class there would make the policy complete — one line, for
the hygiene lane or a follow-up.

> CLOSED LATER, in two steps: the `AGENTS.md` policy sentence was completed by t10 (sha256
> `62288be4…`, 11:52:18Z) and this file's own TOP-OF-FILE paragraph — the O2 item of the review gate —
> by t11 (§13 below).

---

## 13. t11 — O2: the top-of-file paragraph now names the ROOT-relative class (COMMENT-ONLY)

### 13.1 The finding (O2, from `evidence/process-fixes/review-round1.md`)

The script's own description (the "It ALSO resolves the relative link TARGETS …" paragraph, lines
29–43) still said every form is "resolved from the LINKING file's own directory", while the code —
and the scanner-local comment above `linkTargets` — also resolves a leading-`/` target against the
REPO ROOT. The file under-described itself by one class.

### 13.2 The clause, before and after (ONE clause; every other sentence byte-identical)

BEFORE (the sentence as shipped at `1cb83b13…`):

```
// It ALSO resolves the relative link TARGETS of the band it discovers (the class that hid the dead
// `architecture.md` links): `[x](./y.md)`, `![x](y.png)`, `../AGENTS.md`, a DIRECTORY target — each
// resolved from the LINKING file's own directory, with a `#fragment` stripped, while external
```

AFTER (now — the two inserted lines carry the class):

```
// It ALSO resolves the relative link TARGETS of the band it discovers (the class that hid the dead
// `architecture.md` links): `[x](./y.md)`, `![x](y.png)`, `../AGENTS.md`, a DIRECTORY target — each
// resolved from the LINKING file's own directory, and a ROOT-relative target (a leading `/`, e.g.
// `/docs/index.md`) resolved against the REPO ROOT with that leading slash stripped explicitly —
// never the filesystem root (t5-F1) — with a `#fragment` stripped, while external
```

The paragraph's other sentences — the discovery list, the `switchLinkUnderTitle` rationale, the
"Two bounds reuse existing machinery …" sentence (T-75 packed-copy NOTE + `EXEMPT_PROVENANCE`), and
the DERIVED-values paragraph below it — are byte-unchanged.

### 13.3 Checked against the CODE before writing (not against a summary)

Both read by symbol on the shipped revision `1cb83b13…`:

- `checkLinkTargets` — the branch the clause describes:
  `const rootRelative = filePart.startsWith("/");`
  `const cleaned = rootRelative ? filePart.replace(/^\/+/, "") : filePart;`
  `const base = rootRelative ? root : dirname(rel);`
  `const abs = resolve(root, base, cleaned);`
  — the leading slash is stripped EXPLICITLY before the join and the base becomes the repo root, which
  is what the clause says; no fallback/retry exists in that branch.
- the scanner-local comment above `linkTargets` — already states the same class and its reason
  ("a ROOT-relative target (a leading `/`, e.g. `/docs/index.md`) resolves against the REPO ROOT too —
  the leading slash is stripped explicitly, because passing it through would escape to the FILESYSTEM
  root and report a target that exists in the tree as dead (t5-F1)").
- The clause does not contradict either; it repeats neither a claim they do not make nor an ordering
  they do not implement (fragment split first, then the root-relative branch, then `statSync`).

### 13.4 COMMENT-ONLY, proved mechanically

```
$ node -e '… replace the 4-line NEW comment block with the 2-line OLD one …' > /tmp/pre.mjs
$ sha256sum /tmp/pre.mjs
  1cb83b1394df66e148c44d3c322bcbbf470ffdd0c959068b24af793ee5163f4e   <-- byte-identical to the
                                                                   pre-t11 (t8) revision
$ node --check scripts/verify-docs-parity.mjs
  syntax-ok
$ diff <(sed 's://.*::' /tmp/pre.mjs | …) <(sed 's://.*::' scripts/verify-docs-parity.mjs | …)
  (empty)  -> code-identical-after-comment-strip=yes
```

Reversing ONLY the inserted comment block reproduces the previous revision byte-for-byte, so the
t11 delta is exactly those two comment lines.

### 13.5 The three contract commands, before vs after (run in ONE call, both revisions)

Because a bash call gets a fresh `/tmp`, the pre-revision copy was rebuilt and both revisions were run
inside a single call; `--root` points the copy at this tree (`root` is `join(HERE, "..")`, so a
`/tmp` copy needs the explicit root).

| command | PRE (`1cb83b13…`) | POST (`06ee71ae…`) | output diff |
|---|---|---|---|
| `node scripts/verify-docs-parity.mjs` | exit 0 | exit 0 | **byte-identical** (incl. `pairs=38 failed=0 violations=0 exempt=19 derived=3 links=234 dead=0 — PASS` and `links=234 checked=217 resolved=210 dead=0 exemptProvenance=7 absentSite=0 ignoredExternal=13 ignoredAnchorOnly=4 files=92`) |
| `node scripts/verify-docs-parity.mjs --self-test` | exit 0, `34/34 checks passed — PASS` | exit 0, `34/34 checks passed — PASS` | identical modulo the per-run fixture temp dir (`mpd-docs-links-selftest-<rand>` normalized) |
| `node scripts/verify-gates.mjs` | exit 0, `PASS - 5/5 member gate(s) green` | exit 0, `PASS - 5/5 member gate(s) green` | the member gate's output is provably unchanged (row 1); the aggregate is a function of it |

Final runs on the SETTLED revision (`06ee71ae…`, 11:57:33Z): gate exit 0 with the identical summary,
`--self-test` exit 0 `34/34`, `verify-gates` exit 0 `5/5 member gate(s) green`.

### 13.6 Hash and files changed

| read | moment (UTC) | value |
|---|---|---|
| sandwich start | 11:56:42Z | `06ee71ae8fdf4cbb7ffc0b87465cd3aca99cd71dd3a5c48fb8e1610aa1a1a8b8` |
| sandwich end | 11:57:33Z | identical — SETTLED |

| path | what |
|---|---|
| `scripts/verify-docs-parity.mjs` | the one-clause top-of-file fix (§13.2) — NEW sha256 `06ee71ae…` @11:57:33Z |
| `evidence/process-fixes/gate-links.md` | this section |

No `AGENTS.md`, `.gitignore`, `agent-references/**`, `docs/**`, README or `packages/**` file was
written by t11 (out of scope); the behaviour and counters of the script are unchanged.


