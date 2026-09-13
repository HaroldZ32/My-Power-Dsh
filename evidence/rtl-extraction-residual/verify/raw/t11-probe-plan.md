# t11 executable probe plan (Reviewer)

Merged from: the captain's consolidated spec, my own corrections (V1/V3/V4, C-criteria defects), the
Architect's two traps, `captain-rulings.md` R7.12/R7.13/R7.15, and the pre-final snapshots recorded in
this directory. **Re-measure everything on the SETTLED final bytes** — every number below is a
snapshot baseline, not t11 evidence.

## 0. Settle protocol (before any probe)

1. `git rev-parse HEAD`; `git status --porcelain`; record whether the repair is **staged, committed, or
   both** (`git diff` vs `git diff --cached` differ — at the pre-final snapshot the repair was STAGED with
   HEAD still `32ae54dd`, 62 porcelain entries).
2. Hash every subject file; re-hash after a ≥50 s settle window and only proceed if identical.
3. Confirm `t8` is terminal and `repair/report.md` exists — read it as INPUT, never as evidence.
4. **Say it explicitly in the verdict**: the tree is a *staged tree, hashed at this revision* — never
   "clean tree" — and mark every number that comes from a staged path. `git diff` (worktree vs index) can
   be empty while `git diff --cached` carries the entire repair; reading only the former produces the
   false "no uncommitted diff" note this audit already made once.

## 1. Gates (quote each exit code; no inherited greens)

| Gate | Command | Pre-final snapshot |
|---|---|---|
| Vendor | `node scripts/verify-vendor.mjs` | 0 |
| Rows parity | `node scripts/verify-rows-parity.mjs` | 0 (21 ids) |
| RTL refs | `node scripts/verify-rtl-references.mjs` | 0 (13 invariant subjects, 35 resolved, 8 pending, disclosure `mpd-side cases: 0`) |
| Boot/MOUNT | `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` | 0 (was 1) |
| Tests | `bun test packages` | 0 (298 pass / 0 fail; was 295/3) |
| Typecheck | `bun run typecheck` | 0 |
| QA corpus | `bun run test:qa` | NOT yet re-run post-repair — run it, quote the exit code, and see §1.1 |
| Pack | `node scripts/pack-mpd.mjs` | 0 (repacked) |

### 1.1 `relocate-smoke` precondition (verified real, undocumented)

`skills/dsh-qa/scripts/relocate-smoke.mjs:20` hard-fails `--self-test` when
`dist/mpd-package/package.json` is absent ("run node scripts/pack-mpd.mjs first", `exit(1)`), and
`package.json:29` runs every `scripts/*.mjs --self-test` → **`test:qa` requires a prior pack**, and
`dist/mpd-package/` is gitignored. `test:qa` on a fresh clone fails there until packed. Report it as a
documented precondition (or a SKIP-with-reason), not a flake; t9's `standard.md` never mentions it.

### 1.2 R7.15 falsifiability probes (on COPIES under my evidence dir — never edit the repo)

`verify-rows-parity.mjs` evaluates the zero-subject guard **before** the mismatch comparison and with
`||`, so FOUR directions must be distinguished (patch-only / installer-only / both / one-row delta);
"exit 1" alone cannot tell the guard from the comparison. Expected strings:
`"the bundle patch declares no '- insert:' row ids"`, `"the installer declares no row ids"`, the joined
`"A and B"` form, and — only when both sets are non-empty — `"installer vs bundle patch row ids differ"`.
`verify-vendor.mjs`: empty `assets` → `"zero-subject run: VENDOR_LOCK.json declares no vendored assets to
fingerprint - refusing to report PASS"`; `assets` with only `_`-prefixed keys → the missing-fingerprint
path; real pair → exit 0 with the asset count.

## 2. Anchor rename — two-sided (R7.12/A15)

`build-mcp.mjs:41` declares `BUILTIN_BUILD_ANCHOR = "mpd-lsp-overlay-v1"`; both overlay files carry it at
`:2`; trip points `:59-60` and `:74`. Prove (a) the build SUCCEEDS with it and (b) a negative-control copy
with the anchor removed still FAILS loudly. Success alone is half the proof.

## 3. Carrier hook (A7 / R5.3) — behaviour, never `--dump-config`

The hook consults **no env var** (0 hits for `process.env`/`MPD_SILICON_ROOT` in `lib/index.js`).
Candidates, quoted from `lib/index.js:117-164`: `require.resolve("@mpd-dsh/silicon/presets/rtl-ip.profile.json")`,
then an 8-level bundle-relative walk-up of `node_modules/@mpd-dsh/silicon/presets/rtl-ip.profile.json`.
First readable object wins; corrupt → counted, one warning, `{}`; all-missing → `{}` silently; then
`config.profiles = { ...silicon, ...(config.profiles ?? {}) }`.

* **Present direction (the hard side):** needs a sandbox where `@mpd-dsh/silicon` is genuinely resolvable
  (pre-final measurement: it is NOT resolvable anywhere in the checkout — `MODULE_NOT_FOUND`), with the
  sibling's `presets/rtl-ip.profile.json` (10 327 B) as source. Assert `rtl-ip` appears in the agent-teams
  row's `config.profiles` **and** `profiles.mpd` still holds the full mpd roster.
* **Absent direction:** boots silently with `{}`, no per-boot warning.
* **Hook resolution matrix — RULED, IMPLEMENTED, and VERIFIED BY ME on the live bytes (08:23:37Z,
  `lib/index.js` mtime 16:22:32, sha `fd436f0f…`, staged 48+/0-).** Semantics: **presence decides, not
  parseability** — the FIRST candidate that exists ends the search, so a nearer copy is never silently
  superseded by a farther one. `ENOENT` = absent → continue silently (mpd-only install is normal);
  any other read error → warn naming path **and error code**, then `{}`; unparseable JSON → warn naming
  path, then `{}`; non-object (incl. `null`, arrays) → warn naming path, then `{}`; valid object → merge.
  No counter survives; the loop's only silent exit is the post-loop `{}` (all-absent).

  **t11 asserts (mounting boot, sandbox) — assert warning COUNTS exactly, not mere presence:**
  (a) corrupt nearest + valid farther → **no** `rtl-ip`, exactly **one** warning naming the corrupt path,
      farther copy **demonstrably not merged**;
  (a2) unreadable-but-existing nearest + valid farther → **no** `rtl-ip`, exactly **one** warning naming
      the path **and the error code**. **MECHANISM (measured, 08:24:56Z, uid 0): `chmod 000` does NOT
      work — root's DAC override makes the read succeed (`READ OK len=2`), so the branch never fires.**
      Use a non-ENOENT trigger that is uid-independent. Three measured options, best first:
      **`ELOOP`** (symlink loop: `ln -s a b; ln -s b a; ln -s a <candidate>` → throws `ELOOP`,
      measured 08:26:55Z) is the closest analogue to the ruling's case, because the candidate path is
      regular-file-shaped and resolves nowhere; **`EISDIR`** (directory in the candidate slot) and
      **`ENOTDIR`** (candidate's parent is a file) are wrong-type cases that also throw. A dangling
      symlink yields `ENOENT`, not a usable trigger (see below).
  (a3) all unreadable → `{}` + exactly **one** warning (the first unreadable candidate stops the walk);
  (b) all corrupt → `{}` + exactly **one** warning (the first corrupt candidate stops);
  (c) all absent → `{}` + **zero** warnings — a silent `{}` is correct ONLY in this direction, which is
      why (a3)/(b) must be distinguished from it by warning count;
  (d) valid nearest → `rtl-ip` present **and** `profiles.mpd` intact.

  Any walk-past is a FAIL even if the final merged set looks right.

  **Unifying statement (use this wording, and reject the near-miss):** the FIRST candidate that is
  **not ENOENT-absent** decides — read error other than ENOENT, invalid JSON, non-object, or valid all
  end the search. "First candidate that READS SUCCESSFULLY decides" is subtly wrong: an unreadable
  (EACCES/ELOOP/EISDIR/ENOTDIR) candidate also decides, by stopping with a warning. That is what makes
  the warning count provably **one** rather than one per candidate. **Quote the code's own comment as the
  semantic anchor** — `lib/index.js`: "Presence decides, not parseability: the FIRST candidate that
  EXISTS ends the search" — it is the ruling written into the code and survives line drift.

  **Named residual (accepted unless covered):** a **dangling symlink** at a candidate path yields
  `ENOENT` (measured 08:24:56Z), so an installed-but-dead link reads as *absent* under the ENOENT-only
  rule — i.e. as a normal mpd-only install, silently. Covering it needs `lstat`-then-read, and `lstat`
  was measured to work on such a path (`isSymbolicLink=true`), so the cover is available if the captain
  wants it. If accepted, t11 asserts `ENOENT` semantics for a dangling link and records the gap
  explicitly rather than leaving it as an oversight. Verified implementation facts:
  `catch (err) { if (err?.code === "ENOENT") continue; console.warn(… cannot read … (code)); return {} }`,
  the three named warnings, and the post-loop `return {}` with **no** warning. Registry independently
  re-checked by me: `node scripts/patch-agent-teams-fixes.mjs --check` → `already applied: 13 mpd delta
  region(s) across 3 adopted file(s)`, exit 0. Pre-edit copy preserved at
  `repair/raw/index.js-pre-captain-hook-fix.bak` (33 981 B).

  *One precision note for the record:* the five-rule text lives in the NEW in-function block, while the
  header comment (`:118-126`) keeps its older two-rule form — still accurate for the cases it names
  (absent → silent; corrupt/non-object → one warning + `{}`), but it does not mention the unreadable
  branch. Not a contradiction; recorded so the record is exact.

  *Pre-fix snapshot, kept for the audit trail:* at 08:22:19Z (mtime 16:01:21) the bytes still had the
  fall-through (loop continued past `corrupt += 1`, early `return parsed`, unnamed post-loop warning) —
  that was **V-hook-corrupt-fallthrough**, reported and ruled.
* All hook directions need a MOUNTING boot (registration instrumentation), never `--dump-config`.

## 4. Freshness chain — by REPRODUCIBILITY, never by mtime ranking

**Method (adopted after a proved false alarm):** mtime ordering is NOT evidence of staleness. The
captain's pre-final flag (overlay 16:14:57 > `dist/cli.js` 15:58:21 > pack 16:12:13) was disproved by
rebuilding from the current tree (`MPD_UPSTREAM_ROOT=… node scripts/build-mcp.mjs`, exit 0) and finding
the output **byte-identical** to the shipped artifact (234 827 B, sha256 `9f41d425…`). The mtime bump was
caused by a probe re-applying `overlay/lsp/language-mappings.ts` with identical content — so the entry
point is the byte comparison, not a timestamp.

*Re-confirm on settled bytes (my own run, not the relayed one):* the captain has already run the
rebuild-compare — `MPD_UPSTREAM_ROOT=<repo>/.mpd-dsh/upstream node scripts/build-mcp.mjs` → exit 0,
`234827 bytes`, `PASS`, output byte-identical to the shipped `cli.js` (`9f41d425…`). t11 re-runs it (or
cites that run explicitly as the captain's) and then packs and compares the packed copy.

**Pack LIST assertion (a hash match on `cli.js` does not prove the directory listing is clean).**
Pre-final, mine, 08:21:38Z: pack files total **1119**; exact-name assertions all **absent**
(`rtl-verif.mjs`, `rtl-ip-profile.mjs`, `references/verilog/README.md`,
`references/systemverilog/README.md`, `packages/mpd-verif-plugin/dist/index.js`); pack `dsh-qa/scripts`
= **24** cases including `software-smoke.mjs` and `readonly-deny.mjs`, no RTL case; `lsp-setup/references`
= 20 language dirs, no HDL. Full-path sweep hits **1** — `skills/lsp-setup/scripts/verify-lsp.ts`, which is
a **regex-precision false positive** (`verif` matching the *prefix* of `verify-lsp.ts`), not a residual:
another reason to pair pattern sweeps with exact-name assertions and to say which is which.
Raw: `raw/pack-listing.txt` (full listing), `raw/t11-pack-listing-assertion.txt`.

**Known trap to record:** `build-mcp.mjs` applies the overlay **in place**, so merely running the anchor
negative-control touches `overlay/lsp/*.ts` mtimes even when the bytes are unchanged. That will trip any
future mtime-based freshness check and makes `git status` look dirty without a content change.

Pre-final measurements (mine, 08:20:57Z) — all consistent:
`work cli.js` = `pack cli.js` = `VENDOR_LOCK` pin = `9f41d4258c204aca959de98a5bea59a7459f9e298885f187cfc0268e1d18ce69` (234 827 B; was 235 271 B / `04b49f8c…` pre-repair).
Pack dissection: retired cases `0`, HDL reference pages `0`, HDL strings in the packed `cli.js` `0`,
`overlay/` not shipped (build input only), pack `skills/*` dirs = 19 = work tree, RTL-named `dsh-qa`
scripts in the pack `0`. t11 re-runs the dissection on the settled pack; the scratch-pack-to-a-new-location
variant writes `dist/`, which is why it belongs to t11 and not to a read-only pass.

## 5. C1–C10 with R7.13's corrections applied (not the original text)

C7 row check must be the strict anchored form (`grep -c '^| rtl-verif '` → 0), never the vacuous escaped
form; C7's case clause stays SUPERSEDED by R3; C6 has two halves (hook per §3 **and** the README pointer
note — assert `README.md` AND `README.zh-CN.md`, both 2 silicon lines at the pre-final snapshot, up from
0 pre-repair). C9 stays UNVERIFIABLE for me (silicon-side). C10's ledger equation is not independently
reproducible — say so rather than passing it.

## 6b. Rebrand hazard on `build-mcp.mjs` rebuilds (captain-reported; mechanism verified by me)

**What to assert (t11):** for `packages/mpd-mcp-{astgrep,gitbash}/dist/cli.js` — `OMO_PROVISION_HINT`,
`omo-git-bash` and `platformFromOptions` count **0**, the MPD spellings present, work = pack =
`VENDOR_LOCK`, `git status` clean for those paths, and `node scripts/verify-vendor.mjs` **exit 0**.
Pre-final measurement (08:27:52Z): astgrep `f06bba31…` / gitbash `cb9ce8f3…`, OMO 0, MPD 2 each,
work = pack = lock, `git status` 0 entries, `verify-vendor` exit 0. ✅

**Mechanism (read-only trace, so the report states it exactly):** `build-mcp.mjs:168-203` builds **every**
server in `SERVERS` (ast-grep, git-bash, lsp) and then applies `applyMpdScrub(s.name, …)` (`:195`) — a
**targeted key list** (`MPD_SCRUB`, `:104-136`) over the bundled text, followed by per-server `residual`
assertions that `process.exit(1)` loudly (`:140-152`). The gaps are therefore **list coverage**, not the
absence of a scrub:
* `git-bash`'s only replacement is `omo-git-bash-run-` (`:133`) and its only residual is the same string
  (`:134`), so the upstream `"Usage: omo-git-bash [mcp]"` (`git-bash-mcp/src/cli.ts:12`) and the
  `platformFromOptions` identifier (5 upstream lines) are **outside both the replace list and the residual
  check** → their revert on a rebuild is **silent**;
* `ast-grep`'s usage string is covered (`["omo-ast-grep","mpd-ast-grep"]` at `:127` + the residual at
  `:129`), so that one would fail loudly rather than ship;
* precision note — `OMO_PROVISION_HINT` and the prose "Start an OMO session" are **0 hits** in
  `.mpd-dsh/upstream/packages/{ast-grep-mcp,git-bash-mcp}/src`, so the report should attribute the
  observed revert to the *uncovered* spellings it can point at (usage string, `platformFromOptions`,
  prose built from CORE packages), not to that identifier specifically.

**Consequence for the report:** the rebuild path has no brand guard; the only thing that catches a
reverted rebrand is the `VENDOR_LOCK` fingerprint going red, which is exactly what happened. A follow-up
(own scoped pass, not this wave) would widen the residual patterns to brand-shaped checks
(`Usage: omo`, `OMO `-in-prose) and add prose/identifier entries; do **not** add it mid-freeze.

## 6. Evidence layout

`evidence/rtl-extraction-residual/repair-verify/{verdict.md,false-negative-probes.md,raw/}` unless the
t11 contract names another path; raw logs named per probe; ownership notes kept out of frozen files.
