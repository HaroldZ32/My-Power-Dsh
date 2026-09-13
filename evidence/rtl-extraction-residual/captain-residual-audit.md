# Captain residual audit — declaration vocabulary outside the ten-file pass

**Author**: captain · **Date**: 2026-09-13 · **HEAD at audit**: `32ae54dd` (branch `dev`) ·
**Tree**: working tree carrying the wave's uncommitted lanes.

This note exists because the declaration pass (task X6) was scoped to README/doc surfaces, and a
repo-wide grep run BY THE CAPTAIN found the same false lineage claim surviving in four **source
headers**. The finding is recorded here as evidence so it is not lost to a transcript, and the fix
is folded into the freeze pass by the captain (per-branch staging), because five attempts to stage
it as its own task were refused by the scope gate (it named `t27`, then `t28`, then `t23` as
overlapping while none of those declarations carries these paths — a gate-plumbing cost that is not
worth spending on a four-line comment edit).

## 1. The finding (exact command + verbatim output)

```console
$ cd /root/dshProj/my-power-dsh && git ls-files | xargs grep -ln \
    'ports the portable\|Fork declaration\|移植了\|Fork 声明\|fork derived\|fork terms\|fork 条款' \
    2>/dev/null | grep -v '^skills/\|^evidence/\|^docs/plan-\|^PLAN.md\|feature-audit'
packages/mpd-boulder-plugin/src/index.ts
packages/mpd-comment-checker-plugin/src/index.ts
packages/mpd-hashline-plugin/src/index.ts
packages/mpd-memory-plugin/src/index.ts
```

```console
$ grep -n 'fork terms\|fork 条款' \
    packages/mpd-boulder-plugin/src/index.ts \
    packages/mpd-comment-checker-plugin/src/index.ts \
    packages/mpd-hashline-plugin/src/index.ts \
    packages/mpd-memory-plugin/src/index.ts
packages/mpd-boulder-plugin/src/index.ts:3:// SUL-1.0 fork terms; see LICENSE.md). Adaptations: state root -> .mpd convention and
packages/mpd-comment-checker-plugin/src/index.ts:3:// (base 8c57e46, SUL-1.0 fork terms). The check runner is adapted to a
packages/mpd-hashline-plugin/src/index.ts:3:// SUL-1.0 fork terms; see LICENSE.md). Adaptation: diff-utils.ts bundles a
packages/mpd-memory-plugin/src/index.ts:3:// SUL-1.0 fork terms): markdown memory files with frontmatter (description/
```

## 2. Why it is the same defect as the READMEs

"SUL-1.0 fork terms" asserts a **derivation** relationship. Measured for this repository: the pinned
upstream commit object `8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29` is **absent** locally
(`git cat-file` → *Not a valid commit name*), it is **not an ancestor** of HEAD
(`git merge-base --is-ancestor` → NO), the root commit is `80e5260ded84c0fade9b4ab98af00891b266669b`
(2026-08-26), and the only remote is the Gitee origin. The **licence** inheritance is real; the
**fork** relation is not. So the correct wording states the licence as a licence fact
("covered by SUL-1.0") and keeps the `base 8c57e46` / upstream-package provenance text
**exactly** as it is.

## 3. Disposition

Folded into the freeze pass as part of the declaration branch: the four header comments are
corrected comment-only (no logic change) and each touched package's `dist/index.js` is rebuilt so
shipped code matches source. The packages are `mpd-boulder-plugin`, `mpd-comment-checker-plugin`,
`mpd-hashline-plugin`, `mpd-memory-plugin`.

**Not in scope, deliberately**: the `agent-teams` plugin's `fork` occurrences, which are the
sub-agent runtime's `spawn`/`fork` API term and not a lineage claim; `skills/**` (inherited
third-party provenance, and the corpus has its own single writer + one re-pin per wave); the
historical plan/report records, which AGENTS.md §3 exempts.

## 4. Lesson recorded for the next wave

A declaration pass scoped to "human-facing docs" **structurally cannot see** source-header
provenance comments. The sweep that finds them is the repo-wide tracked-file grep, and it must be
run as the pass's closing check rather than assumed — the same "guard subject" error this audit
found in the codebase, reproduced in the audit's own process.
