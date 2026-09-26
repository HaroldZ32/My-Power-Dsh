# t10 — language policy: the ROOT-relative link class is now named in the manual

Seat: Junior Engineer. Task `t10` (attempt 1, `attempt_id 5ae03a1f-8dc3-45c7-bd39-d0fb0e4d54c8` — provenance, read while present).
Window: 2026-09-19T11:50Z – 11:53Z (UTC). Input: t8's repair of the root-relative false positive (side effect of t5's finding F1).

## 1. The change, in one sentence

The language-policy bullet that enumerates what `bun run verify:docs` enforces already named the
`./x` / `x` / `../x` class (added by t4) but not the class t8 repaired — a target beginning with `/`.
It now names it, with the resolution rule spelled out.

### BEFORE (the shipped bullet, verbatim — `AGENTS.md` sha256 `d49bb23c8d9c6eab26281e3194e3df6179543c879a0f53fd9867c174076f266b`)

```
- The policy is executable: `bun run verify:docs` (`scripts/verify-docs-parity.mjs`) enforces the pair, the switch link, the heading tree, real CJK content and the RESOLUTION of relative link targets across the band it discovers — every `*.md` under `docs/` at any depth, `extensions/**/README.md`, `templates/**/README.md`, `packages/*/README.md` and the root README — where a `./x`, `x` or `../x` target resolves from the LINKING file's own directory with a `#fragment` stripped (a directory counts; external URLs, in-page anchors and code spans are ignored); it reports a zh-CN document with no EN twin, a non-exempt package with no README or a link target that does not resolve as a violation, and prints the documented exemptions (see §4). A file kept VERBATIM as provenance is exempt from the link check too (its dead targets are reported as EXEMPT, never as passes), and in a packed copy with no root `AGENTS.md` an unresolved target is a NOTE rather than a failure (T-75). Classification is DECLARED, not directory-sensitive: a `*.md` carrying `<!-- docs-parity: doc -->` is a doc wherever it lives, so a misplaced doc reddens instead of escaping.
```

### AFTER (the shipped bullet now — `AGENTS.md` sha256 `62288be4a23c8ebb3fed267e2f6e6530ab6f3a279dff6721b734c43cf9146d68`)

```
- The policy is executable: `bun run verify:docs` (`scripts/verify-docs-parity.mjs`) enforces the pair, the switch link, the heading tree, real CJK content and the RESOLUTION of relative link targets across the band it discovers — every `*.md` under `docs/` at any depth, `extensions/**/README.md`, `templates/**/README.md`, `packages/*/README.md` and the root README — where a `./x`, `x` or `../x` target resolves from the LINKING file's own directory and a ROOT-relative `/x` target resolves against the REPO ROOT (`/docs/index.md` means `docs/index.md` in this tree, never the filesystem root), with a `#fragment` stripped first (a directory counts; external URLs, in-page anchors and code spans are ignored); it reports a zh-CN document with no EN twin, a non-exempt package with no README or a link target that does not resolve as a violation, and prints the documented exemptions (see §4). A file kept VERBATIM as provenance is exempt from the link check too (its dead targets are reported as EXEMPT, never as passes), and in a packed copy with no root `AGENTS.md` an unresolved target is a NOTE rather than a failure (T-75). Classification is DECLARED, not directory-sensitive: a `*.md` carrying `<!-- docs-parity: doc -->` is a doc wherever it lives, so a misplaced doc reddens instead of escaping.
```

The single textual delta:

```
- …resolves from the LINKING file's own directory with a `#fragment` stripped …
+ …resolves from the LINKING file's own directory and a ROOT-relative `/x` target resolves against
+  the REPO ROOT (`/docs/index.md` means `docs/index.md` in this tree, never the filesystem root),
+  with a `#fragment` stripped first …
```

Every pre-existing clause is retained: `./x` / `x` / `../x` resolution from the linking file's own
directory, `#fragment` stripping, directories counting, external URLs / in-page anchors / code spans
ignored, the violation for a dead target, the verbatim-provenance EXEMPTION clause and the T-75
packed-copy NOTE clause.

## 2. Checked against the SHIPPED script by SYMBOL (before writing the sentence)

Script: `scripts/verify-docs-parity.mjs`, sha256 `1cb83b1394df66e148c44d3c322bcbbf470ffdd0c959068b24af793ee5163f4e`
(the t8-frozen revision), read at 11:50:42Z and re-hashed at 11:50:53Z and 11:52:18Z.

- **Symbol `checkLinkTargets`** (the loop over a file's targets) — the class order the sentence describes,
  observed in this order in the shipped code:
  1. `target.startsWith("#")` → `counters.anchorOnly += 1; continue;` (in-page anchors ignored);
  2. `target.startsWith("//") || LINK_SCHEME.test(target)` → `counters.external += 1; continue;`
     (external URLs ignored — a protocol-relative `//host` never reaches the root-relative branch);
  3. `const filePart = target.split("#")[0];` (fragment stripped) and empty ⇒ anchor-only;
  4. **the ROOT-relative branch the sentence names**:
     `const rootRelative = filePart.startsWith("/");`
     `const cleaned = rootRelative ? filePart.replace(/^\/+/, "") : filePart;`
     `const base = rootRelative ? root : dirname(rel);`
     `const abs = resolve(root, base, cleaned);`
     — the leading slash is stripped BEFORE the join and the base becomes the repo root, so
     `/docs/index.md` resolves to `<root>/docs/index.md`; the in-source comment states the reason
     (`resolve(root, dirname(rel), "/x")` escapes to the filesystem root and reports a target that
     exists in this tree as dead — the t5-F1 measurement);
  5. `statSync(abs)` with `isFile() || isDirectory()` (a directory counts); a miss then hits
     `EXEMPT_PROVENANCE` (skipped, reported as EXEMPT) and the `packedCopy` NOTE branch — both of which
     the sentence's last clauses describe.
- **The corresponding self-test arm, OBSERVED RUNNING** (`node scripts/verify-docs-parity.mjs --self-test`,
  11:50:53Z, exit 0):
  `ok   links ROOT-RELATIVE: a `/`-prefixed target resolves against the REPO ROOT (existing file + directory count as RESOLVED), while a missing one still REDDENS with its id — {"resolvedBefore":12,"resolvedWithTwoLiveTargets":14,"deadBefore":1,"deadWithMissingTarget":2,"finding":"link-missing:docs/root-relative.md:/nowhere/absent.md"}`
  and `[verify-docs-parity self-test] 34/34 checks passed — PASS`.
- **Live counters on the shipped tree** (same revision): `links=234 checked=217 resolved=210 dead=0 exemptProvenance=7 absentSite=0 ignoredExternal=13 ignoredAnchorOnly=4 files=92` — no root-relative target currently exists in the band, so this clause documents a class the checker resolves rather than one the tree exercises today.

## 3. Minimal-delta proof (the diff is EXACTLY that clause)

`AGENTS.md` at the start of this task was `d49bb23c…`. Reversing ONLY the new clause in the current
bytes reproduces those bytes exactly:

```
$ node -e '… replace(NEW_CLAUSE, OLD_CLAUSE) …' > /tmp/jr-t10-pre.txt
$ sha256sum /tmp/jr-t10-pre.txt
  d49bb23c8d9c6eab26281e3194e3df6179543c879a0f53fd9867c174076f266b   <-- byte-identical to the pre-t10 hash
```

So the t10 delta is exactly one clause on one line; nothing else in the file moved. Corroborating
scope checks against `HEAD` (which necessarily still shows the t4 hunks already verified by t5):

```
$ git diff -U0 -- AGENTS.md | grep "^@@"
  @@ -12 +12 @@     <- the language-policy paragraph (t4's wording + this clause)
  @@ -497,0 +498,7 @@   <- t4's §7 bullet (verified by t5, untouched here)
  @@ -557 +564,2 @@     <- t4's §9 sentence (verified by t5, untouched here)
$ diff <(git show HEAD:AGENTS.md | grep "^#\{1,3\} ") <(grep "^#\{1,3\} " AGENTS.md)   # empty
  headings-identical=yes
$ git diff -- AGENTS.md | grep -c "mpd-dsh/"    # 0   (§3 tree untouched)
```

## 4. Verification and the settled hash (with its moment)

| Read | Moment (UTC) | Value |
|---|---|---|
| sandwich start | 11:51:28Z | `62288be4a23c8ebb3fed267e2f6e6530ab6f3a279dff6721b734c43cf9146d68` |
| sandwich end | 11:52:18Z | `62288be4a23c8ebb3fed267e2f6e6530ab6f3a279dff6721b734c43cf9146d68` — SETTLED (start == end) |
| post-verify re-read | 11:52:18Z | identical |

`bun run verify:docs` (the contract command) exited **0** on those settled bytes — twice, at 11:51:23Z
and again at 11:52:18Z (script `1cb83b13…` both times):

```
[verify-docs-parity] root=/root/dshProj/my-power-dsh pairs=38 failed=0 violations=0 exempt=19 derived=3 links=234 dead=0 — PASS
```

**New `AGENTS.md` sha256: `62288be4a23c8ebb3fed267e2f6e6530ab6f3a279dff6721b734c43cf9146d68`, measured at
11:52:18Z** (settled; unchanged since 11:51:23Z except for the settling window itself).

Self-test of the same revision, for completeness: `34/34 checks passed — PASS` (11:50:53Z).

## 5. Bounds

- **This task described the checker; it did not change it.** `scripts/verify-docs-parity.mjs` is out of
  scope and unmodified by t10 (it remains at t8's `1cb83b13…`).
- If the script is edited again in this wave, the sentence must be re-read against the new revision — the
  hash above identifies exactly which revision the sentence was verified against.
- No `git add`/commit was run (one git writer per working tree, §5); the captain commits.
