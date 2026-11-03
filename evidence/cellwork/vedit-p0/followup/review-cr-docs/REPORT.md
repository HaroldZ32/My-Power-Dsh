# Review CR-docs — the T23 CodeRabbit round-1 fix (three-boot header + SKILL.md row)

**Row:** T25 (board), re-review of `T23`. **Writer:** `se-cellwork` (`99a0e207…`).
**Loop:** `loop-20261103T080819-893695` (T23). **Contract:** the CR1 findings on PR #93; `AGENTS.md` §4/§7.

**Tree judged** — pinned **08:10:57Z** (`gates/00-scope-start.sha256`): `tui-admission.ts` `2d39c5c5…`,
`SKILL.md` `f9392347…`, `surface-pin.ts` `0d883365…` (UNCHANGED), contract `3e12b6f3…` (UNCHANGED), HEAD
`88597518` (the wave commit; its `tui-admission.ts` is `0f93c004…` and its `SKILL.md` is `37b68665…` — the
exact A6-reviewed versions, so the T23 delta is precisely the uncommitted working-tree change).

**Verdict: PASS.** **Risk level: LOW.** No Blocker/High/Medium. **One Nit** (a duplicated sentence in the
SKILL.md row). Nothing is repaired by this seat.

## 1. Assessment

T23 is a documentation repair and it is exactly that, which I proved rather than accepted: I built BOTH
versions of the lane (`git show HEAD:…` and the working tree) with the pinned toolchain under `--minify`,
which strips comments and normalises whitespace and identifiers, and the two outputs are **byte-identical**
(`sha256 b2f5fa50…` on both) — the executable content did not change by a single token. The header now
states THREE boots, one per grants-file state, and every arm names the boot that produces it: BOOT 1 carries
the shipped `/plugin check` + `/plugin list`, the loader line and the chat turn; BOOT 2 carries the clone's
three grant states and the observed revocation; BOOT 3 carries the shipped manifest WITH one grant, staged
before the boot, one `/plugin check`, exactly one decision line. The factual base is real: the file makes
exactly THREE `runTuiSession` calls (`-shipped`, `-clone`, `-shipped-granted`) and a real lane directory
carries the matching `shipped/`, `clone/`, `shipped-granted/` subtrees the `Evidence ->` line now names. The
`shipped-bond` typo is gone, the `/plugins`→`/plugin` note sits directly under BOOT 1 again (it had ended up
below the third-boot paragraph), and `SKILL.md`'s row says "THREE boots — one per grants-file state" with the
third boot described and the T14-corrected shipped/clone/conditional-arm3 wording intact. All gates are
green; the only red is the expected corpus `treeSha`.

## 2. (a) the header

| # | criterion | verdict | evidence |
|---|---|---|---|
| a1 | says THREE boots, one per grants-file state | **PASS** | "therefore measure BOTH postures over **THREE boots** — one boot per grants-file state" |
| a2 | BOOT 1 named for the shipped check + list, the loader line and the chat turn | **PASS** | `(1) BOOT 1, SHIPPED POSTURE…`, `(2) BOOT 1, THE ADMISSION-LOADER LINE…`, `(4) BOOT 1, THE DRIVE REACHED A REAL CHAT TURN…` |
| a3 | BOOT 2 named for the clone's three states + revocation | **PASS** | `(3) BOOT 2, GRANT CLONE, THREE STATES…`, `(5) BOOT 2, REVOCATION (observed, never gated)…` |
| a4 | BOOT 3 named, grant staged BEFORE the boot, ONE check, exactly ONE decision line, swallowed step reddens | **PASS** | `(1b) BOOT 3, SHIPPED POSTURE WITH ONE GRANT…` — "stages the grants file … BEFORE the boot and drives ONE `/plugin check`…", "the pane must carry EXACTLY ONE decision line, and a swallowed step leaves zero and reddens" |
| a5 | `Evidence ->` includes `shipped-granted/` | **PASS** | `{result.json,output.log,admission-static.json,REVISION.json, shipped/,clone/,shipped-granted/,grant-clone/}` — matches the real lane dir |
| a6 | the `shipped-bond` typo is fixed | **PASS** | `grep -c shipped-bond` → **0**; `the shipped-with-grant lifecycle` → 1 |
| a7 | the 0.15.0 rename note is under the RIGHT item | **PASS** | it now sits immediately after item (1) BOOT 1 and BEFORE item (1b) BOOT 3 (header lines 10→14→17); before T23 it sat after the third-boot paragraph |
| a8 | the claim is TRUE of the code, not just of the prose | **PASS** | exactly three `runTuiSession({` calls with lanes `-shipped`, `-clone`, `-shipped-granted` |

## 3. (b) `SKILL.md`'s row

| # | criterion | verdict | evidence |
|---|---|---|---|
| b1 | says THREE boots and names the third | **PASS** | "LIVE, over **THREE boots — one per grants-file state**: (1) …; (2) …; (3) the SHIPPED POSTURE WITH ONE GRANT in a THIRD, fresh boot — the clone's row staged in the grants file BEFORE the boot, ONE `/plugin check` … EXACTLY ONE decision line … a swallowed step leaves zero and reddens" |
| b2 | the T14-corrected wording is intact | **PASS** | the STATIC sentence and the clone sentence are unchanged; `structuredClone`, the string `inapplicable`, "never reports that arm as a pass" and the revocation clause all still present |
| b3 | the row still parses | **PASS** | 5 pipes (the 4-column shape), identical to its neighbours |
| b4 | no other row changed | **PASS** | the `SKILL.md` diff is ONE hunk, one line |

## 4. (c) comment/documentation only — proved structurally

`git show HEAD:skills/dsh-qa/scripts/tui-admission.ts` (= `0f93c004…`, the A6-reviewed version) and the
working-tree file were each built with the pinned toolchain
(`.toolchain/node_modules/.bin/bun build <file> --target node --format esm --minify`). `--minify` removes
comments and normalises whitespace/identifiers, so identical output means identical executable content:

```
head.min.js  b2f5fa5085defade07d92e60d3fd831dad9fddf3bf186a51e8098ba275099bc7
now.min.js   b2f5fa5085defade07d92e60d3fd831dad9fddf3bf186a51e8098ba275099bc7
MINIFIED BYTES IDENTICAL
```

The full diff agrees: 3 hunks in `tui-admission.ts`, every changed line a `//` or `/** */` comment, and they
sit at header line 18 (the boot block), header line 85 (the `Evidence` line) and line 1184 (the typo). No
code line, no arm, no predicate, no evidence field moved.

## 5. (d) gates (this seat)

| gate | id | observed |
|---|---|---|
| `tests` | `ev-20261103T081212-a0b984` | exit 0 — 3488 tests, 232 files, **0 fail**, 6 skip |
| `typecheck` | `ev-20261103T081201-cc024f` | exit 0 (`tsgo --noEmit`) |
| `comments` | `ev-20261103T081202-bcf7e7` | exit 0 — VERDICT: PASS |

Beyond the frozen table: `gates/20-tui-self-static.log` (`--self-test` **0**, `--static-only` **0**),
`gates/22-test-qa.log` (`all self-tests passed`, **0**), `gates/23-vendor-expected-red.log` (**exit 1**, ONE
reason: `asset skills treeSha mismatch` — the expected red, pending the captain's second re-pin).

## 6. Finding

**CR-F1 — Nit (documentation redundancy, NON-BLOCKING) — the row now describes the third boot twice.**
Where: `skills/dsh-qa/SKILL.md`, the `tui-admission` row.
What: the STATIC sentence's closing clause still describes the live third boot in full — "measured twice: the
static `negotiate` on both grant sets, and a live `/plugin check` of the SHIPPED manifest in a boot of its
OWN, with the clone's row staged in the grants file BEFORE the boot: the arm requires EXACTLY ONE decision
line, so a swallowed step reddens rather than re-reading a neighbour's verdict" — while the NEW LIVE item
(3) says the same thing again in almost the same words.
Why it matters: a reader counting the boots sees "THREE boots" and then the third boot described twice, under
two different headings (STATIC and LIVE); the row is the canonical description of what the case proves, and
this is the same doc-drift class the last three rounds kept repairing. It is accurate, only redundant —
hence a Nit, not a repair.
Direction: keep LIVE item (3) as the canonical description and reduce the STATIC clause's live half to a
pointer ("… and the live boot 3, below"), or drop the repeated mechanism detail from the STATIC clause.

Not a finding: the writer's claim that the live lane was not re-run — a comment-only change and the
byte-identical minified build make a re-run unnecessary; I verified the executable content directly instead.

## 7. Declined to judge

- Lane B's in-flight `packages/mpd-team-core-plugin/**` (three modified files + a new `codereview-cr1.test.ts`)
  — outside this row; the package suite is green in the `tests` gate above.
- `verify:docs` — `skills/**` is not in that gate's discovery band (agent-facing, English-only); the row was
  checked for shape and content here instead.
- The wording "BOTH postures over THREE boots" — "postures" counts the permission-less vs granted posture,
  while the boots count the grants-file states; it reads correctly once item (1b) is reached. Declined.

## 8. Bounds

- The live lane was NOT re-run (declared; a comment-only change, proven structurally).
- `surface-pin.ts` and the contract are untouched (hashes unchanged).
- No repository file was written by this seat; the build scratch files live under the gitignored
  `.mpd/recon/qa/rev-crd/` and are deleted after the review.

## 9. Evidence in this directory

```
00-criteria.md                      the captain's criteria, transcribed before any read
gates/00-scope-start.sha256         the pinned tree
gates/10-diff-tui.diff              3 comment-only hunks
gates/11-diff-skill.diff            one row, one line
gates/20-tui-self-static.log        self-test 0 / static-only 0
gates/22-test-qa.log                0
gates/23-vendor-expected-red.log    exit 1 — ONLY the skills treeSha
```
