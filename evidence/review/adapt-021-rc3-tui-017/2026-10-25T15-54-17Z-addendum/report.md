# Addendum review — T3 truth fixes, T4 stale pin, the captain's single vendor re-pin

Reviewer: reviewer (team M2, task T5, `kind: review`). Subject: the delta that landed AFTER my T2
verdict. Delta window proven by mtime, not by claim: exactly six tracked files changed after 23:41
(+08:00) — `VENDOR_LOCK.json`, `packages/mpd-tui-adapter-plugin/src/index.ts`,
`packages/mpd-tui-plugin/README{.md,.zh-CN.md}`, `packages/mpd-better-sidebar-host/README{.md,.zh-CN.md}`.
No `skills/**` file changed after my T2 review; nothing was committed (HEAD is still `faa273f5`).
Findings only — no reviewed file was edited.

## Per-subject judgement (the three things T5 asked)

### 1. T3 — adapter docblock + two plugin READMEs + the dist fan-out: CORRECT

- **The reworded comment is now TRUE and does both jobs.** Above `PANEL_CSV_HOST_OWNED_SINCE` it frames
  0.16.1 as the release that INTRODUCED host-owned enable lists — so the constant is a permanent floor —
  and names admission as a *different fact* declared in `dsh-plugin.json` `compat.hosts` ("0.17.0 since
  v0.15.5"). Both halves check against the tree: `compat.hosts` names `@deepseek-harness-tui/dsh-tui@0.17.0`,
  and the `v0.15.4` tag's `compat.hosts` names 0.16.1, so "since v0.15.5" is exact, not approximate.
- **No behaviour-bearing line changed.** The diff is docblock-only; `PANEL_CSV_HOST_OWNED_SINCE`,
  `PANEL_CSV_SELF_HEAL_SINCE`, `hostOwnsPanelCsv`, `hostSelfHealsPanelCsv` and every `hostVersion` fixture
  are untouched. Corroborated three independent ways: no `packages/*/dist/**` path appears in
  `git status` at all; `verify-dist-fresh` reports **33/33 targets fresh, each rebuilt twice byte-identical**
  from the pinned toolchain (`bun 1.4.0` from `.toolchain`); the full suite passes **2460 / 0 fail**.
- **The "comment-only edit leaves every committed dist byte-identical" claim is TRUE here** — I re-derived
  it rather than accepting it. The strongest proof is the negative one: a behaviour edit *must* change the
  adapter's inlined dist bytes (the documented 12-of-24 fan-out), and none changed.
- **The two README cells moved the TARGET only.** `0.13.0+` stays (the seam's arrival), the dated
  `0.12.0` / `0.14.0` "measured on …" sentences stay, and EN/zh carry the same edit; the docs gate's
  heading-tree and link rules still pass.

### 2. T4 — better-sidebar-host README pair: CORRECT, and it was a current-pin claim

- **The sentence is a CURRENT-pin claim, so moving it was right.** "…on harness **0.2.1-rc.1+** — this
  repository pins `0.2.1-rc.2`, so the row mounts on every supported composition": the `0.2.1-rc.1+` half
  is the host requirement (stays), the "this repository pins" half is the repo's live pin (moves). `0.2.1-rc.3`
  is the correct literal, and the conclusion still follows because rc.3 is above the rc.1 floor.
- **Both languages are in step**, same meaning, same one-line edit; `verify:docs` PASS.
- **Its other survivor classifications hold.** I re-read both it named: `packages/mpd-bundle/README.md`'s
  "harness 0.2.1-rc.2's schema no longer declares it" is a schema attribution, and
  `packages/mpd-dsh-adapter-plugin/README.md`'s "Honest bound on harness 0.2.1-rc.2" is a version-scoped
  measurement. Both are history, not current-pin claims — correctly left.
- **But its sweep was `*.md`-only, and the tree still carries one** — see finding 3.

### 3. The captain's vendor re-pin: CORRECT and minimal

- **Exactly one field, exactly one re-pin.** The whole `VENDOR_LOCK.json` diff is one line: the skills
  asset's `treeSha` `bd6b06e7…` → `4a7e6ed2…`. No other asset, no identity/provenance field, no `_note`
  touched.
- **It matches the wave's `skills/**` changes and the FINAL tree.** No `skills/**` file has an mtime later
  than the re-pin, and `verify-vendor` recomputes **PASS — 7 shipped asset(s) fingerprinted**, so the value
  is the derived hash of the shipped tree rather than a hand-softened number.
- **The §9 pairing rule is satisfied in the working tree**: `VENDOR_LOCK.json` and the nine `skills/**`
  carriers are both dirty and must land in the SAME commit (the captain's).
- Note the ordering is safe: the re-pin (23:46:05) precedes T3/T4's edits (23:46:58 / 23:51:04), and those
  touched no `skills/**` file, so the hash is still the tree's hash — which the green gate confirms.

## Findings (ranked)

### 1. Medium — the v0.15.5 CHANGELOG entry no longer matches the wave it announces

**What.** `CHANGELOG.md`, the `## v0.15.5` entry: its opening paragraph states "A pin-and-documents wave:
**no plugin source changed**", and its `**Changed — docs.**` bullet enumerates AGENTS §8, the user guide,
development, `docs/tui.md` and the README badges — omitting all three package-level truth fixes that landed
after it (the adapter docblock, the tui-plugin README adaptation target, the better-sidebar-host README pin).

**Why it matters.** Both statements were true when T1 wrote them and are not true of the tree now: a plugin
source file *did* change (comment-only), and the wave's doc surface is larger than the bullet says. This is
a human-facing release note, and the repo's own standard is that a shipped claim matches the code.

**Direction.** Extend the docs bullet with the three package-level fixes and soften the categorical line to
"**no plugin behaviour changed** (one adapter docblock reworded)". Two lines; no other entry changes.

### 2. Medium (process) — T3 was dispatched to two members, and its board row was created after the spawn

**What.** Member `M3` (junior-engineer) was spawned at `15:46:12Z`; the T3 row was created at
`15:46:17Z` naming `senior-engineer` as owner and started at `15:46:20Z`; `M1`'s three edits landed at
`15:46:58Z`. `M3`'s two `edit` attempts were refused ("file changed since it was read"), so `M3` authored
none of the edits and re-verified them instead — its own report records this and asks the captain to close
one of the two.

**Why it matters.** No content damage: the read-before-edit guard prevented a lost update, the tree holds
one coherent version, and my gates confirm it. But it is a real near-miss on the wave's disjoint-scope /
one-owner discipline, it burned a member activation, and the board attributes T3 to one member while two
worked its scope — which matters for attribution (AGENTS §5 forbids attributing by author field, so the
record is the evidence).

**Direction.** Create the row before spawning (or dispatch through the board) and keep ONE owner per write
scope; keep BOTH evidence directories — they are honest and complementary, and the second one's disclosure
is what made this reconstructable.

### 3. Low — one stale current-pin claim survives, missed because the survivor sweep was doc-band only

**What.** `packages/mpd-better-sidebar-host/src/index.ts`, the header comment's `connection` rationale:
"`connection` … provided by `@deepseek-ai/dsh-client-connection`, i.e. by harness 0.2.1-rc.1+ (the host's
peer floor and this bundle's pinned 0.2.1-rc.2 both satisfy it)". The bundle's pin is now 0.2.1-rc.3, so the
literal is false — the same class T4 fixed one file over.

**Why it matters.** T4's brief covered exactly this ("if you find a stale claim that is NOT a one-line README
fix, report it instead of fixing it"), but its sweep was `git ls-files '*.md'`, so it never saw a source
comment, and its report's "No survivor is a current-pin claim" is true only inside the band it scanned.
A maintainer reading the shim's arming rationale concludes the bundle pins rc.2.

**Direction.** Reword to name the policy rather than the literal — "both the host's peer floor and this
bundle's pin satisfy it" — so it cannot rot again. It is a one-line `src` edit; that package has exactly one
dist target built from this file (`packages/mpd-better-sidebar-host/dist/index.js`, FRESH in my run), and the
T3 precedent proves this toolchain strips `//` comments, so the rebuild is expected byte-identical — confirm
with `verify-dist-fresh` afterwards.

## Declined to judge

- The README version-correspondence TABLE content: cleared in T2; T5 excludes it.
- The Docker lanes: the captain is running them; not judged here (this is where my T2 High item closes).
- The packed artifact `dist/mpd-package/**`: correctly stale until the captain re-packs; not flagged, per T5.
- `packages/mpd-better-sidebar-host/test/host-contract.test.ts`'s "harness 0.2.1-rc.2 provides no `webRuntime` at all": a version-scoped attribution, history — correct to leave.
- `packages/mpd-better-sidebar-host/src/index.ts`'s OTHER rc.2 mention ("0.2.1-rc.2 provides no `webRuntime`") and the same sentence on the test side: history, same class as the declined test comment.
- `mpd-bundle` / `mpd-dsh-adapter` README survivors, `scripts/verify-plugin-manifest.ts`'s mutant, `dsh-plugin.json`'s `x-mpd-tui-surfaces.note` "(version 0.15.1)" (already stale at 0.15.4), `AGENTS.md` §8's "LIVE on the registry at 0.15.4" (a PUBLISHED-version measurement), `docs/tui.md` §11.8: all classified in T2 and unchanged by this delta.
- The two T3 evidence directories disagreeing on authorship: I judge the TREE, not the reports; the timeline above is corroborated by independent mtimes and by the board's own timestamps.
- The dist gate's one NOT COVERED file (`packages/mpd-mcp-codegraph/dist/serve.js`, a sha-pinned prebuilt): untouched by this wave, outside T5's subjects.
- Whether `dsh-better-sidebar@0.28.0`'s real peer range admits rc.3: registry unreachable from this sandbox; the claim rests on the repo's existing statement, not on my measurement.

## Gates I re-ran myself (all in this directory)

| Gate | Exit | Observed |
|---|---|---|
| `verify:docs` | 0 | `pairs=50 failed=0 violations=0 exempt=24 derived=3 links=453 dead=0 — PASS` |
| `verify:comments` | 0 | `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature` |
| `verify-dist-fresh` | 0 | `ok: 33/33 targets fresh (each rebuilt twice, byte-identical)`; toolchain `bun 1.4.0` from `.toolchain`; 1 NOT COVERED (prebuilt) |
| `verify:manifest` | 0 | `component-ref-version: 6 self-urn ref(s) compared against distribution.version 0.15.5, 0 stale`; `VERDICT: PASS` |
| `verify-vendor` | 0 | `PASS - 7 shipped asset(s) fingerprinted` (was exit 1 with the skills treeSha mismatch before the re-pin) |
| `bun test packages` (FULL) | 0 | `2460 pass, 6 skip, 0 fail, 40700 expect() calls, Ran 2466 tests across 148 files [29.99s]` |
| `bun run typecheck` | 0 | `tsgo --noEmit`, no diagnostics |

Writer-claim comparison: T3 claimed 33/33 dist fresh, comments PASS, docs PASS, typecheck 0, and
2460/6/0 on the full suite — every one matches my independent observation exactly. T4 claimed docs PASS
and a clean survivor sweep — the gate matches; the sweep is correct inside its `*.md` band (finding 3).
The captain's re-pin claim (one hash, vendor green) matches.

## Bounds of this review

- **Not run**: the Docker lanes (captain's), any host boot/PTY, the pack, and a registry lookup of
  `dsh-better-sidebar@0.28.0`'s peer range — the registry is unreachable from this sandbox.
- **Not read**: the three writers' transcripts (only their reports and their logs), and `dist/mpd-package/**`.
- **Not judged**: anything T5 excluded (the README table content, the Docker lanes, the pack artifact), and
  the two artifacts that are the captain's to produce (the commit and the PR body).
- I did not verify HOW the re-pin was produced (which command), only that the resulting hash is the derived
  hash of the shipped tree and that no other field moved.

## Verdict

**REQUEST CHANGES** — T3, T4 and the captain's single vendor re-pin are all correct, minimal and
independently confirmed (no writer repair is owed for their content); but two text items should be settled
before the captain's commit: the `## v0.15.5` CHANGELOG entry that now says "no plugin source changed" and
omits the three package-level fixes (finding 1), and the one surviving stale current-pin comment in
`packages/mpd-better-sidebar-host/src/index.ts` (finding 3). Finding 2 should be recorded in the wave's
honest bounds rather than fixed.
