# Lane B — follow-up F3 + F4 (0.17.2). Evidence index

Contract: `.mpd/plans/vedit-p0-followup.md` (§F3, §F4). Lane B scope:
`packages/mpd-team-core-plugin/test/**`, `scripts/pack-mpd.ts`, `evidence/cellwork/vedit-p0/followup/lane-b/**`.
HEAD at the time of the run: `2230607d` (release: v0.17.1). No git writes; no delete/move outside this
subtree.

## F3 — pin the resolver's 0..1000 ceiling

**Change (test only):** `packages/mpd-team-core-plugin/test/vedit-p0-lane-b.test.ts`, a NEW arm
`the resolver's declared ceiling is INCLUSIVE: 1000 is honoured and 1001 falls back to 8`:
`mailMaxUndeliveredOf` answers `1000` for a declared `1000`, `8` (the shipped default) for `1001` and for
`10_000`, and `999` for `999` (so it is a boundary, not an off-by-one).

**Production behaviour matched the document, so NO production change was made** (F3's own rule). The
source comment on `MAIL_MAX_UNDELIVERED_CEILING` in `packages/mpd-team-core-plugin/src/mailbox-store.ts`
reads "above it a value reads as \"disabled\"" — imprecise (`0` is the documented disable; above the
ceiling the DEFAULT comes back) — but `src/**` is outside this follow-up's lane scope, so it is reported
here instead of edited; the TEST now pins the real rule (1000 honoured, 1001 → 8).

## F4 — the ROOT_FILES anchor covers the seven packed root files

**Change (packer anchor only):** `scripts/pack-mpd.ts` `ROOT_FILES` gains
`AGENTS.md`, `PLAN.md`, `VENDOR_LOCK.json`, `cordis.patch.yml`, `dsh-distribution.json`,
`dsh-plugin.json`, `icon.svg`, with a comment stating WHAT the change does and its bound. No copy-list,
manifest or other packaging behaviour changed: `ROOT_DECLARED` (derived from `package.json`'s `files`)
still drives every copy, and `ROOT_FILES` is only the closure-gate anchor reconciled at pack time.

**Observed effect:** the pack-time NOTE
`package.json declares root file(s) the closure gate's ROOT_FILES anchor omits: AGENTS.md, PLAN.md, …`
is GONE (`01-baseline-pack.log` has it once; `03-pack-after-f4.log` has zero), the pack still exits 0,
and the closure gate still PASSES at the new stamp.

Two mechanical facts measured beside the effect: the gate's own array scanner parses **16 entries** out
of the anchor (the 8 pre-existing files + the seven + the `dsh-go` directory), and the packer source is
not itself shipped (`dist/mpd-package/scripts/` carries only `install-mcp.ts` and `mpd-ext.ts`), so this
anchor edit introduces NO artifact drift by itself — the re-pack exists to prove the NOTE is gone and to
stamp the closure run.

**HONEST BOUND — the anchor does NOT make the gate byte-check the seven.** `scripts/verify-pack-closure.ts`
owns a SEPARATE named list of root entries (`EXTENSIONS-FOR-AGENTS.md`, `dsh-go`) and, by its own
comment, "derives nothing from the packer by design". Its byte loop iterates that list, not the packer's
anchor. A discriminator experiment (`09-f4-byte-check-gap.log`) proves it on a scratch copy of the real
artifact:
- mutate `PLAN.md` inside the artifact → violation count unchanged (1, the unrelated row below) — NOT byte-checked;
- mutate `dsh-plugin.json` → unchanged — NOT byte-checked;
- mutate `EXTENSIONS-FOR-AGENTS.md` → count 1 → 2, with a `ROOT-FILE` finding naming it — byte-checked.

**Remaining action for the intent, OUTSIDE lane B's scope (captain ruling):** add the seven names to
`REQUIRED_ROOT_FILES` in `scripts/verify-pack-closure.ts`. The gate's own `--self-test` seeds its
fixture root entries from the PACKER's `ROOT_FILES` (`for (const f of rootFiles) putRootEntry(…)`), so
the two lists stay in step and the fixture arms keep passing; the packed-run counter would move from
`root files 2/2` to `9/9`. Nothing was changed there by this lane.

## Commands + observed results

| command | observed |
|---|---|
| `bun test packages/mpd-team-core-plugin` | **575 pass, 0 fail**, 39 files, exit 0 (`06-tests.log`) |
| `bun run typecheck` | exit 0, **0 errors** (`07-typecheck.log`) |
| `node scripts/verify-comment-coverage.ts --file <each touched file>` | PASS for both; repo-wide run also PASS (`08-comments.log`) |
| `node scripts/pack-mpd.ts` (baseline, before the anchor edit) | exit 0, NOTE lists the seven (`01-baseline-pack.log`) |
| `node scripts/verify-pack-closure.ts` (baseline, on that pack) | exit 0, `root files 2/2`, stamp `2026-11-03T05:45:03.461Z` (`02-baseline-closure.log`) |
| `node scripts/pack-mpd.ts` (after F4) | exit 0, **NOTE count 0** (`03-pack-after-f4.log`) |
| `node scripts/verify-pack-closure.ts` (after F4, on that pack) | **exit 0**, `root files 2/2`, content 642/642 identical, completeness 540/541 + 1 exemption, stamp **`2026-11-03T05:46:11.408Z`** (`04-closure-after-f4.log`) |
| `node scripts/verify-pack-closure.ts --self-test` | **38/38 arms PASS**, exit 0 (`05-closure-self-test.log`) |

## Bounds stated, not hidden

- The packed artifact under `dist/mpd-package/` is the one staged at `2026-11-03T05:46:11.408Z`. It went
  stale immediately afterwards for ONE unrelated file because another lane edited
  `skills/dsh-qa/scripts/tui-admission.ts` (source mtime 05:47:41Z / 05:48:28Z) — visible as the single
  `CONTENT-DRIFT` row in the discriminator log. That row is NOT this lane's and NOT a pack defect; the
  captain's wave re-pack + closure sweep is the run that must be green on the settled tree.
- The wave-level gates in the contract (`verify:vendor`, `verify:gates`, `bun test packages`,
  `test:qa`, `verify:docs`, `verify:manifest`, `preset-conformance`) belong to the captain; this lane ran
  the five its task named plus the closure gate's own self-test.
- The F4 anchor edit changes NO shipped bytes by itself (it is the gate's source-side anchor), so the
  release Docker evidence stays valid; only the re-pack stamp and the closure sweep move.

---

# T21 — F4-closure: the seven are BYTE-CHECKED, and the ceiling comment is precise

The captain ruled on the gap reported above, and this row closes it.

## Changes (2 files)

- `scripts/verify-pack-closure.ts` — `REQUIRED_ROOT_FILES` gains the same seven root files
  (`AGENTS.md`, `PLAN.md`, `VENDOR_LOCK.json`, `cordis.patch.yml`, `dsh-distribution.json`,
  `dsh-plugin.json`, `icon.svg`), APPENDED so `REQUIRED_ROOT_FILES[0]` stays
  `EXTENSIONS-FOR-AGENTS.md` and no self-test fixture subject moves. That list is what the byte loop
  (rule 7d) and the presence loop (rule 5b) iterate, so the seven are now compared in both directions.
- `packages/mpd-team-core-plugin/src/mailbox-store.ts` — the `MAIL_MAX_UNDELIVERED_CEILING` comment no
  longer claims "above it a value reads as disabled": it now states the real rule (INCLUSIVE `0..1000`;
  above it the shipped DEFAULT applies; `0` is the documented disable). COMMENT ONLY — `verify-dist-fresh`
  still reports **34/34 targets fresh, exit 0** (`11-dist-fresh.log`), so no `dist/` rebuild is owed.

## Commands + observed results

| command | observed |
|---|---|
| `node scripts/pack-mpd.ts` | exit 0, NOTE count 0, artifact staged (`13-pack-t21.log`) |
| `node scripts/verify-pack-closure.ts` | **exit 0**, **`root files 9/9`**, content **649 file(s) compared, 649 identical, 0 drift**, stamp **`2026-11-03T05:53:44.970Z`** (`14-closure-t21.log`) |
| `node scripts/verify-pack-closure.ts --self-test` | **38/38 arms PASS**, exit 0 (`15-closure-self-test-t21.log`) |
| delta proof on a scratch copy of the artifact | control exit 0 `root files 9/9`; mutate `PLAN.md` → exit 1 with a `ROOT-FILE` finding naming it; mutate `icon.svg` too → 2 findings (`16-t21-byte-check-proof.log`) |
| `bun test packages/mpd-team-core-plugin` | **575 pass, 0 fail**, 39 files, exit 0 (`17-tests.log`) |
| `bun run typecheck` | exit 0, **0 errors** (`18-typecheck.log`) |
| `node scripts/verify-comment-coverage.ts --file <both touched files>` | PASS for both (`12-comments.log`) |
| `node scripts/verify-dist-fresh.ts` | exit 0, **34/34 fresh**, 1 pre-existing NOT COVERED vendored file listed (`11-dist-fresh.log`) |

The delta proof is the same method the earlier gap report used, so the two logs are directly comparable:
`09-f4-byte-check-gap.log` shows the mutations producing NO finding before this change;
`16-t21-byte-check-proof.log` shows the same mutations producing a `ROOT-FILE` finding after it. The
`root files` counter moved `2/2` → `9/9` and the content sweep `642` → `649` files compared.

## Updated bound

- The artifact under `dist/mpd-package/` is now the `2026-11-03T05:53:44.970Z` pack, taken after the other
  lanes' last write to `skills/dsh-qa/scripts/tui-admission.ts` (05:48:28Z), so this gate run measured a
  settled tree: 0 drift, 0 expected-after-pack.
- `cordis.patch.yml` is byte-identical between source and artifact in this pack (checked directly), so a
  future packer rewrite of that file WOULD now be a named `ROOT-FILE` drift rather than a silent one —
  that is the intended effect of naming it, not a regression.
- Wave-level gates remain the captain's; this row ran the packer, the closure gate + its self-test, the
  package tests, typecheck, comments and dist freshness.
