# CORRECTION (nested beside the sealed t12 evidence) — clean-form readings and the copy audit

**Task:** t12 (review-A) · **Reviewer:** code-reviewer · **Written:** 2026-09-17T08:2xZ (after the captain's T-89 heads-up)
**Rule being applied:** `bun test <positional-arg>` is a **SUBSTRING FILTER**, not a path. A leading `./` makes it a PATH.
Nothing in `result.json` was edited; this page is the correction BESIDE it.

## 1. The audit — which t12 readings were at risk

| reading | command form | copies matching the filter at that moment? | verdict |
|---|---|---|---|
| arm runs (T-61/T-79/T-81 pristine + reverted) | absolute path **of my copy** (`$S/T61-pkg/…/strict-task-arguments.test.mjs`) | none — the filter is the COPY's path, which is not a substring of any real file's path | clean (6 tests = the arm's own count, not 12) |
| T-62 mirror runs (pristine / seeded / pre-fix) | absolute path **of the mirror** | none — same argument | clean (17 / 16+1 / 15 = the mirror's counts) |
| `bun test packages/mpd-agent-teams-plugin/self-fix-tests/` at ~08:07Z | **substring form** while `…/revert/T62-full/packages/…/self-fix-tests/` existed | YES — the copy matched and ran | **POLLUTED: 331 tests, 164 fail, 324 errors.** Already disclosed as observation O4 in `result.json` and kept as `suites.out`; superseded in-flight by the rename + re-run below |
| the post-rename clean runs (107/0, 21/0, 17/0, 264/0) | substring form, but **after** the matching copies were renamed (`T62-full/packages` → `pkgs`, `self-fix-tests` → `arms-hidden`) and `T62-root` deleted | no | clean — and now CONFIRMED by the PATH-form re-take below |
| t14's lane readings (139/0, 12/0) | substring form taken **before** the t14 mirror existed | no | clean — and confirmed by the PATH-form re-take in `../t14…/CORRECTION-clean-form-readings.md` |

## 2. The clean-form readings (PATH form, re-taken with NO copies in the tree)

```
bun test ./packages/mpd-agent-teams-plugin/self-fix-tests/                 -> 107 pass / 0 fail, exit 0, 15 files
bun test ./packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs -> 21 pass / 0 fail, exit 0, 1 file
bun test ./packages/mpd-roles-plugin/test/adapter-identity.test.ts ./packages/mpd-ext-plugin/test/adapter-identity.test.ts -> 17 pass / 0 fail, exit 0, 2 files
bun test ./packages/mpd-agent-teams-plugin                                -> 264 pass / 0 fail, exit 0, 39 files
```
Raw: `CORRECTION-clean-form.out`. The discovered file count is the anchor: **15 / 1 / 2 / 39** — a set, not an accumulation.

## 3. The copies — already deleted, and why

The captain's instruction not to delete on his account arrived AFTER my cleanup, so nothing here was removed on his account:

* t12's package copies (`revert/T61-pkg`, `T79-pkg`, `T81-pkg`, `T62-full`, `reg-mirror`) and the tiny `T62-gate-mirror` were deleted **during my own review**, as soon as I caught the pollution myself and disclosed it (48 MB → 668 KB, keeping every `.out`).
* t14's 16 MB mirror was deleted after its revert runs.
* a leftover t15 corpus scratch (4.2 MB, 323 files, 7 `*.test.ts`) was found and deleted after lane A's heads-up, keeping its derived readings (`my-corpus-*.json`, `my-tree-fold.py`, `result.json`).

Consequence: `find evidence/review -name '*.test.*'` is empty — no scratch of mine can be discovered by anyone's substring filter or by a bare `bun test`.

**Reconstructible if wanted:** every revert recipe is recorded (exact anchor strings + asserted occurrence counts in the t12/t14 `commandsRun`), and the copies were plain `cp -r packages <dest>` mirrors; a reader can rebuild them byte-for-byte from the pinned hashes in `PIN-1`/`PIN-2` and the repository history. I did not rebuild them for this correction because the PATH-form readings above make them unnecessary.
