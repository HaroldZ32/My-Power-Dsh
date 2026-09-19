# t4 — hygiene lane: the `sandbox` symlink ignore, the wave-agnostic re-pin invariant, the timestamped-hash rule, the gate description

Seat: Junior Engineer. Task `t4` (attempt 1, `attempt_id 2a441035-4114-44d8-85d0-0915a3d095e7` — provenance, read while present).
Window: 2026-09-19T11:31Z – 11:36Z (UTC). Authoritative input: `evidence/process-fixes/fact-base.md` (§3 P2, §4 P3, §5 P4).

**Four shipped passages changed, in three files.** `.gitignore` (one pattern + its comment), `AGENTS.md`
(three passages: the language-policy bullet, the §7 SETTLED-hashes neighbourhood, the §9 single-writer
sentence). Nothing else: `git diff -U0 -- AGENTS.md` prints exactly THREE hunk headers, the `##`/`###`
heading list is byte-identical to `HEAD`, and no line of the §3 tree changed.

## 0. Settled hashes, WITH the moment each was measured

The rule this lane adds is applied to this lane's own artifact first: every hash below carries the
instant it was read, and the two edited files were sandwiched (hash → work → re-hash, start == end).

| File | sha256 at `HEAD` (before) | sha256 now (after) | measured |
|---|---|---|---|
| `.gitignore` | `83baa5404c2030254e42168fb3bb591cb0d067d7d1e561f3fb5fc2f798450a28` | `9e86dd852cdf995a8e3ae1b43b7d373cb0e2145ecbc8668110fe1aba784a212f` | 11:34:34Z / 11:35:30Z |
| `AGENTS.md` | `d74a934d6653265083453d937fdd3d6eb1c77e79b3093cfe9d3878c290fee50a` | `d49bb23c8d9c6eab26281e3194e3df6179543c879a0f53fd9867c174076f266b` | 11:34:34Z / 11:35:30Z |

Sandwich: `sha256sum .gitignore AGENTS.md` at **11:34:40Z** and again at **11:35:30Z** — the two lines are
identical at both instants, so the pair is SETTLED (an edit still landing would have moved a hash between
the two reads).

`scripts/verify-docs-parity.mjs` belongs to the t3 lane and is still moving (it is quoted here only as the
shipped gate the language-policy sentence was checked against, never as this lane's edit):
`2bbe584a…` @11:32:21Z (pre-extension, no link logic) → `5e715ef9…` @11:34:07Z (first extended) →
`2d3bf2f7…` @11:34:34Z → `1c98b20c…` @11:35:37Z → `6751f151…` @11:36:18Z, where the three checked
semantics are all still present (the violation `detail` string, the `EXEMPT PROVENANCE` reason, the
packed-copy `reported NOTE` branch).

## 1. P2 — `.gitignore`: the pattern must match the SYMLINK as well as the directory

### Before (the shipped bytes, quoted from `HEAD`)

```
# Sandbox WORKING AREAS that lanes create inside their own evidence dir. They hold an isolated
# DSH home, a sandbox HOME, the fixture workspace and a package store — machine-generated
# hundreds of MB that a lane regenerates on every run (measured 2026-09-15: 291 MB / 5308 files
# under evidence/mpd-bridge/dual-path/sandbox alone). The EVIDENCE is REPORT.md + raw/ beside it,
# never this: committing a store snapshot would bloat the repository for no information.
evidence/**/sandbox/
```

Measured on the untouched tree (run immediately before the edit, 11:31Z–11:32Z):

```
$ git check-ignore -v evidence/web-card-catalog/20260918T073000Z/sandbox
   (no output)
$ echo $?
   1
$ git status --porcelain
   ?? evidence/web-card-catalog/20260918T073000Z/sandbox
```

### After (the shipped bytes now)

```
# under evidence/mpd-bridge/dual-path/sandbox alone). The EVIDENCE is REPORT.md + raw/ beside it,
# never this: committing a store snapshot would bloat the repository for no information.
# NO trailing slash, on purpose: a `sandbox` that is a SYMLINK (measured 2026-09-19:
# evidence/web-card-catalog/20260918T073000Z/sandbox -> ../20260918T055042Z/sandbox) is not a
# directory to git, so the directory-only `evidence/**/sandbox/` left it untracked and one
# `git add -A` would have committed a link into machine state that is itself ignored.
evidence/**/sandbox
```

The comment is not decoration: it records WHY the trailing slash is absent, which is the only thing that
stops a future tidier from "fixing" the pattern back to the broken form. (The file already carries the
same lesson for the QA scratch roots: a directory-only `/.qa-*/` "left every stamp file visible, which is
why the pattern carries no trailing slash".)

### Measured AFTER (11:32:16Z; re-confirmed 11:35:37Z)

```
$ git check-ignore -v evidence/web-card-catalog/20260918T073000Z/sandbox
   .gitignore:56:evidence/**/sandbox	evidence/web-card-catalog/20260918T073000Z/sandbox
$ echo $?
   0
$ git check-ignore -v evidence/mpd-bridge/dual-path/sandbox      # the REAL directory — still covered
   .gitignore:56:evidence/**/sandbox	evidence/mpd-bridge/dual-path/sandbox
$ echo $?
   0
$ git status --porcelain
    M .gitignore
    M AGENTS.md
    M agent-references/troubleshooting.md
    M scripts/verify-docs-parity.mjs
   ?? evidence/process-fixes/
```

The `?? …/sandbox` row is GONE; nothing else changed state.

### Independent control, in a scratch repo (moment: 2026-09-19T11:35:49Z)

`git check-ignore` on the real tree proves only the AFTER state, so the discriminator was reproduced in a
throwaway repo with the same shape (`evidence/a/sandbox` a real dir, `evidence/b/sandbox` a symlink to it):

```
pattern: evidence/**/sandbox/   (directory-only, the OLD form)
evidence/a/sandbox       exit=0  .gitignore:1:evidence/**/sandbox/	evidence/a/sandbox
evidence/b/sandbox       exit=1  (no match)          <-- the symlink escapes, exactly as measured

pattern: evidence/**/sandbox    (the FIX)
evidence/a/sandbox       exit=0  .gitignore:1:evidence/**/sandbox	evidence/a/sandbox
evidence/b/sandbox       exit=0  .gitignore:1:evidence/**/sandbox	evidence/b/sandbox
$ git status --porcelain
   ?? .gitignore                                     <-- the symlink is quiet
```

## 2. P3 — the §9 single-writer rule no longer pins a HISTORICAL wave

### Before (`HEAD`, §9)

```
  Serialize all `skills/**` edits of a wave through a single writer and re-pin exactly once;
  wave 3 has exactly one re-pin (t3), and that is the invariant a reviewer checks.
```

A wave number and a task id fused to the general rule by a semicolon: the current wave is `w1` of a new
team and task ids restart, so a future `t3` would silently "confirm" a claim about a closed wave.

### After (now, §9)

```
  Serialize all `skills/**` edits of a wave through a single writer and re-pin exactly once;
  exactly ONE re-pin per wave — landing in the same commit as the change that invalidated that
  `treeSha` — is the invariant a reviewer checks.
```

Wave-agnostic, no wave number, no task id; the invariant is the one §11 already carries (one re-pin per
wave, in the same commit as the invalidating change), so no cross-reference changed.

## 3. P4 — the TIMESTAMPED-hash rule (§7)

### Before — the SETTLED-hashes bullet ended the rule at "hashes you measured"

```
- **Verify on SETTLED hashes.** An edit/revert still landing is measurable: wave 2's first
  verification pass ran while a revert was in flight and measured a half-reverted tree (a failure
  that no longer existed minutes later). Pin the revision by hash, re-check it after a short settle
  window (wave 2 used 50 s), then run the contract — and anchor every verdict to the hashes you measured.
```

### After — the new bullet, inserted verbatim between that bullet and the "Shell caveat" bullet

```
- **Quote a hash WITH its measurement moment.** A bare `sha256` is provenance that cannot be
  re-anchored: a citation or verdict that quotes one also states the instant it was read (UTC,
  second precision), and a verifier SANDWICHES its read — hash → work → re-hash, with start == end
  after the settle window — so "settled" is distinguishable from "another lane edited the file
  while I sampled". The cost of omitting the moment is measured: four "stale reading" rounds in
  the docs wave, where a lane and the captain sampled the same moving file at different instants
  (`evidence/docs-overhaul/SUMMARY.md`, "Process notes worth carrying").
```

Both halves of the drafted rule are present: (a) a hash is quoted WITH its moment, (b) a "settled" claim
is a start == end SANDWICH. The existing bullet was not reworded. §0 of this file is the rule applied to
itself (before/after hashes each with a moment; the sandwich 11:34:40Z → 11:35:30Z).

## 4. Language policy — the gate description now covers link-target resolution

### Before (`HEAD`, the "policy is executable" bullet)

```
- The policy is executable: `bun run verify:docs` (`scripts/verify-docs-parity.mjs`) enforces the pair, the switch link, the heading tree and real CJK content for every pair it discovers — every `*.md` under `docs/` at any depth, `extensions/**/README.md`, `templates/**/README.md`, `packages/*/README.md` and the root README — reports a zh-CN document with no EN twin or a non-exempt package with no README as a violation, and prints the documented exemptions (see §4). Classification is DECLARED, not directory-sensitive: a `*.md` carrying `<!-- docs-parity: doc -->` is a doc wherever it lives, so a misplaced doc reddens instead of escaping.
```

### After (now)

```
- The policy is executable: `bun run verify:docs` (`scripts/verify-docs-parity.mjs`) enforces the pair, the switch link, the heading tree, real CJK content and the RESOLUTION of relative link targets across the band it discovers — every `*.md` under `docs/` at any depth, `extensions/**/README.md`, `templates/**/README.md`, `packages/*/README.md` and the root README — where a `./x`, `x` or `../x` target resolves from the LINKING file's own directory with a `#fragment` stripped (a directory counts; external URLs, in-page anchors and code spans are ignored); it reports a zh-CN document with no EN twin, a non-exempt package with no README or a link target that does not resolve as a violation, and prints the documented exemptions (see §4). A file kept VERBATIM as provenance is exempt from the link check too (its dead targets are reported as EXEMPT, never as passes), and in a packed copy with no root `AGENTS.md` an unresolved target is a NOTE rather than a failure (T-75). Classification is DECLARED, not directory-sensitive: a `*.md` carrying `<!-- docs-parity: doc -->` is a doc wherever it lives, so a misplaced doc reddens instead of escaping.
```

**The sentence was written AFTER t3's link check landed, and checked against the SHIPPED script — not
against a hoped-for state.** At 11:32:21Z the file still had no link logic (`2bbe584a…`, zero
`linkTarget|deadLink|resolveLink` matches); it gained the check at 11:34:07Z. Every clause of the
sentence is grounded in the shipped bytes of `1c98b20c…` (read at 11:35:37Z), by symbol, not by line:

| clause in the sentence | shipped evidence in `scripts/verify-docs-parity.mjs` |
|---|---|
| resolves `./x`, `x`, `../x` from the linking file's own directory | the header comment's link paragraph ("resolved from the LINKING file's own directory, with a `#fragment` stripped") |
| external URLs / in-page anchors / code spans ignored | same paragraph: `http(s):`, `mailto:`, `tel:`, `data:`, `//host`, in-page anchors, empty targets, fenced blocks and inline code spans |
| a dead target is a violation naming source and target | the finding `detail`: `` `${rel}:${line} links "${target}" but neither a file nor a directory exists at ${abs} …` `` |
| provenance file exempt, reported as EXEMPT (never a pass) | the `EXEMPT_PROVENANCE (…): N relative target(s) reported as EXEMPT PROVENANCE — never a pass and never a violation` reason |
| packed copy without a root `AGENTS.md` ⇒ NOTE | the comment at the absent-site branch ("so an unresolved target there is a reported NOTE") + `--self-test` arm *"links PACKED: no AGENTS.md -> an absent target is a LINK NOTE"* |

The gate's own report line proves the check RUNS on this tree (11:35:37Z, script `1c98b20c…`):

```
[verify-docs-parity] links=234 checked=217 resolved=210 dead=0 exemptProvenance=7 absentSite=0 ignoredExternal=13 ignoredAnchorOnly=4 files=92
```

## 5. Verification (contract order)

| # | Command | Moment | Exit | Observed |
|---|---|---|---|---|
| 1 | `bun run verify:docs` | 11:34:34Z (script `2d3bf2f7…`) | 0 | `pairs=38 failed=0 violations=0 exempt=19 derived=3 links=234 dead=0 — PASS` |
| 1′ | `bun run verify:docs` (re-run against the later script) | 11:35:37Z (script `1c98b20c…`) | 0 | identical PASS line — the manual's new sentence is true of the gate as shipped |
| 2 | `git check-ignore -v evidence/web-card-catalog/20260918T073000Z/sandbox` | 11:32:16Z, re-confirmed 11:35:37Z | 0 | `.gitignore:56:evidence/**/sandbox	evidence/web-card-catalog/20260918T073000Z/sandbox` (was exit 1, no output, before) |

Scope proof for acceptance 5 (no other `AGENTS.md` content changes):

```
$ git diff -U0 -- AGENTS.md | grep "^@@"
@@ -12 +12 @@          <- the language-policy bullet
@@ -497,0 +498,7 @@     <- the inserted timestamped-hash bullet
@@ -557 +564,2 @@       <- the re-pin sentence
$ diff <(git show HEAD:AGENTS.md | grep "^#\{1,3\} ") <(grep "^#\{1,3\} " AGENTS.md)   # empty
$ git diff -- AGENTS.md | grep -c "mpd-dsh/"   # 0  (§3 tree untouched)
```

## 6. Bounds, honestly stated

- **No `git add` was run.** One git writer per working tree (§5): this lane measured
  `git check-ignore` and `git status`, and the captain commits. The claim is therefore "the symlink is
  NOW ignored", not "a commit was made".
- **The t3 gate script moved while this lane ran.** Five hashes were observed after the pre-extension
  read (`2bbe584a…`, `5e715ef9…`, `2d3bf2f7…`, `1c98b20c…`, `6751f151…`). The language-policy sentence
  describes SEMANTICS (resolution, exemption, packed NOTE) verified against `1c98b20c…` and re-checked
  against `6751f151…`; a later t3 rework that changed those semantics would make it stale, which is why
  each hash is recorded here with its moment.
- **The BEFORE output of `git check-ignore` on the real tree carries no printed timestamp** (it was run
  in the command immediately preceding the edit, 11:31Z–11:32Z). The stamped discriminator is the
  scratch-repo control at 11:35:49Z, which reproduces the same exit-1-on-symlink result from the same
  pattern shape.
