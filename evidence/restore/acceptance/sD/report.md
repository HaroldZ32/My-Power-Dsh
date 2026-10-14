# S-D — the Security Policy removal (T4)

**Writer:** `docs-writer` (Junior Engineer) · **Contract:** `.mpd/plans/restore-acceptance-fix.md` §4 S-D
**Loop:** `loop-20261009T115806-6f91f7` (verifier `lane-verifier`)
**Revision pinned:** branch `fix/restore-wave-acceptance`, HEAD `477baa5bebe6499b0c586fe2b3135020748f7d77`,
read at **2026-10-09T12:02:07Z**, re-read after a 58 s settle window at **2026-10-09T12:03:05Z** — HEAD and
all seven path hashes identical at both reads (start == end). Every write and gate run in `output.log`
happened BEFORE the start pin.

Every claim below is quoted from `evidence/restore/acceptance/sD/output.log`, a raw on-disk transcript of
the commands that produced it. Nothing here rests on prose alone.

## What changed

| Path | State | sha256 | Change |
|---|---|---|---|
| `SECURITY.md` | **DELETED** | — | file removed |
| `SECURITY.zh-CN.md` | **DELETED** | — | file removed |
| `package.json` | modified | `fee35b7f…5bd98` | the two entries out of the `files` array |
| `scripts/pack-mpd.ts` | modified | `f69c1778…90c0e` | the two entries out of `ROOT_FILES` |
| `CONTRIBUTING.md` | modified | `a7492e1a…6a71a` | the `SECURITY.md` sentence dropped; the Security-tab guidance kept |
| `docs/index.md` | modified | `90b8912d…24840` | reading-path item 6 + the index row (2 deletions) |
| `docs/index.zh-CN.md` | modified | `0247a4a4…0f41c` | the same two edits, same commit (2 deletions) |

`.github/ISSUE_TEMPLATE/config.yml` and `.github/ISSUE_TEMPLATE/bug_report.yml` are **untouched** — they
never named the file and already point at GitHub's Security tab
(`https://github.com/HaroldZ32/My-Power-Dsh/security/advisories/new`).

## Criterion walk

1. **Two deletions** — `git status --short -- SECURITY.md SECURITY.zh-CN.md` → ` D SECURITY.md` / ` D SECURITY.zh-CN.md`.
   `sha256sum SECURITY.md SECURITY.zh-CN.md` → two `No such file or directory` lines, exit 1.
2. **No dangling reference** — the live surface is CLEAN: `git grep -c -i -e 'SECURITY' -- package.json
   scripts/pack-mpd.ts docs/index.md docs/index.zh-CN.md CONTRIBUTING.md` prints only `CONTRIBUTING.md:3`
   (the retained Security-tab guidance). Surviving mentions of the two FILE NAMES, outside `evidence/`:
   exactly one — `CHANGELOG.md:560`, a release note, retained **and declared**. The `evidence/**` hits are
   immutable QA/provenance records of moments when the files really existed (plus third-party seed trees
   that name OTHER repositories' `SECURITY.md`); rewriting them would falsify the record.
3. **Manifest + packer lists** — both clean (`git grep -c` prints no line for either file). The contract's
   parenthetical "(a listed-but-missing file is a manifest red)" is **measurably false** — see F-SD-1.
4. **The bilingual pair moved together** — same `git diff` invocation, same `git status`, item 6 removed
   from each, lists stay 1..5, one index row removed from each; `verify:docs` accepts the pair
   (`pairs=47 failed=0`).
5. **Private reporting stays on GitHub's Security tab** — verified for all three files by `cat`/`sed`/`grep`
   in the log.
6. **Three gates** — `bun run verify:docs` exit 0 · `bun run verify:manifest` exit 0 ·
   `node scripts/verify-pack-closure.ts --self-test` exit 0 (`34/34 arms`).

## Falsifiers

- **F1 (shown):** the deleted `docs/index.md` link planted back → `bun run verify:docs` **exit 1**,
  `FAIL link-missing:docs/index.md:../SECURITY.md … links=431 dead=1 — FAIL`. Restored; `git diff --stat`
  reads `1 file changed, 2 deletions(-)`.
- **F2 (NOT shown → FINDING F-SD-1):** `"SECURITY.md"` planted back into `files[]` with the file absent
  → `bun run verify:manifest` **exit 0, VERDICT: PASS**. The `files-allowlist` arm is a superset test
  (`notAdmitted = mustShip.filter(… not admitted)`), so a LISTED-but-absent pattern cannot fail;
  `packed-content` grades npm's own dry-run list, which silently omits a missing path. The protection
  lives in `scripts/verify-pack-closure.ts` against the **packed** manifest
  ("the packed manifest lists `X` but \<packed\>/X is absent — listed but absent is a closure failure"),
  i.e. it fires at §7's re-pack, not here. `scripts/verify-plugin-manifest.ts` is outside §4 S-D's write
  scope, so this is reported, not fixed. The S-D removal remains the correct edit.

## Bounds

- `dist/mpd-package/SECURITY.md` and `…/SECURITY.zh-CN.md` still exist (1791 B, mtime 2026-10-09 08:07) —
  the regenerated, gitignored artifact; contract §4's Note says the §7 re-pack clears them.
- `verify:docs` does not discover `agent-references/**`, so it cannot police the S-C row (stated in the S-C
  packet too); for S-D it covers both index files and their pair.
- `AGENTS.md` was **not** edited in either stream: no manual sentence is contradicted. §12 line 592 already
  lists "agent-teams dispatch defects" among what `troubleshooting.md` covers, so §4 S-C criterion 3's
  instruction-budget re-measure is genuinely not owed — a judgement, recorded so its absence does not read
  as an omission.
- No git write command was run by this writer (AGENTS.md §5).
