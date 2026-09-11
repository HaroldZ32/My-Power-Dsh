# Wave-3 t8 — ONE reconciled commit plan (wave 1 + wave 2 + wave 3) — **NOT EXECUTED**

Base: `dev` @ `98680b1fb2bbf5c10c28cfbe44419e91595e1cb7` — the revision every wave started from.
Recommended branch: **`fix/wave1-wave2-wave3-closeout`**, created from `dev`.
**Nothing in this plan was executed: no commit, no push, no tag, no release branch, no rebase.**

## ⚠ HEAD IS CURRENTLY BROKEN FROM A FRESH CLONE (R4 — verified independently)

**The repository's HEAD does not work from a fresh clone until this plan is executed.** Two TRACKED
files reference paths that exist only as UNTRACKED working-tree files:

- `packages/mpd-bundle/cordis.patch.yml` (tracked, lines ~50 and ~90) builds the ast-grep and
  codegraph MCP row commands as `<baseUrl>/…/packages/mpd-mcp-{astgrep,codegraph}/launch.mjs` — and
  **neither `launch.mjs` is in HEAD**, so a fresh clone's MCP rows point at files that do not exist.
- `scripts/vendor-agent-teams.mjs` (tracked, line 23) does
  `import { applyAgentTeamsFixes } from "./patch-agent-teams-fixes.mjs"` — and
  **`scripts/patch-agent-teams-fixes.mjs` is not in HEAD**, so the vendor path cannot even load.

Also untracked and required at runtime by those paths: `packages/mpd-mcp-shared/bin-resolve.mjs`
(imported by both launchers), `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js` (imported by the
applier), `skills/dsh-qa/scripts/lib/workspace-isolation.mjs` (imported by the QA cases),
`scripts/verify-rows-parity.mjs` (`npm run verify:rows`) and the wave-3 test files.

**Verified by this task:** `git cat-file -e HEAD:<path>` returns "not in HEAD" for all seven paths
while the two referencing files are tracked at HEAD. **Consequence for the plan: every one of those
paths MUST be staged in its commit (c5, c6, c7, c8 above); a commit that ships only the tracked
files would leave HEAD broken exactly as it is now.**

This supersedes `evidence/wave2/t11-integration/20260911T072333Z/commit-plan.md` (which had already
absorbed wave 1's plan). It is one plan because the tree is one cumulative uncommitted state:

1. **`VENDOR_LOCK.json` is ONE file for the whole `skills/**` tree.** Every skills edit and the
   re-pin must land in a single commit, so both waves' skills work and wave 3's re-pin share
   commit 5. Measured: `HEAD` carries skills `364 files / 29a6877c…`; wave 2's final working state
   was `366 / 5b13e920…`; the wave-3 final state is **`366 / 3259d07a613c0bb9cf4a0ae8478adcbbb6247ec8bd361fb2075c3092c1c00621`**
   — exactly ONE re-pin separates them (t6 audit, `evidence/wave3/t6-verify/20260911T090649Z/vendor-repin.result.json`).
2. **Generated dists inline several changes** (`packages/mpd-verif-plugin/dist/index.js` bundles
   B1 + B3 + R1; the adapter dist rebuilt by B1 is inlined into four dependent dists), so splitting
   them needs hunk surgery on generated files.
3. **Wave 3 changed files wave 2 already touched** (`lib/tools.js`, `lib/quality-gates.js`,
   `lib/mpd-deltas.js`, the codegraph plugin/launcher, the QA scripts, `AGENTS.md`), and a path can
   only be committed once.

## Reviewed revision this plan (and the pack) describe — do NOT move it

The ten commits below describe the tree at the revision t7/t10 REVIEWED and t8 packed — not a newer
one. The adopted-tooling files must land at these bytes:

| File | sha256 (reviewed) |
|---|---|
| `packages/mpd-agent-teams-plugin/lib/tools.js` | `406e086e19f712802b6a519f9efed998b818ab08736e4173b2885e9d2a510c85` |
| `packages/mpd-agent-teams-plugin/lib/quality-gates.js` | `4e94f7f6f60a8f49433a4cfb49833deab94ed24644949c464d4c1eb41abe0bd5` |
| `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js` | `d3a1d4adce41992b9eb7faf37dd145dbaf4df0352a1b29c8b39038e1a7285ffb` |
| `scripts/patch-agent-teams-fixes.mjs` | `fa696421135f7fb816c7a015821bdab2995996528c0fe219d105c00dc353ca8f` |
| `VENDOR_LOCK.json` | `55150c57f714bec289dcc74c24699a40db9dcc2fc087cacfb4e020dd7130ffe5` |

**Do NOT edit `scripts/patch-agent-teams-fixes.mjs` before these commits land.** Its
`driftedOrphanError` JSDoc (lines ~355-362) still overstates the drifted-orphan hazard ("would
delete that authored text"); the real hazard is a **misdiagnosis/duplicate** — the surviving body
blocks the seam, so the drop+heal path cannot succeed in that shape (it fails the `beforeContext`
assertion), and had it ever succeeded the authored lines would remain alongside a re-inserted block.
That is a **post-wave documentation fix** (`carry-forward.md` §3 item 5, low severity); editing it
now would invalidate t10's reviewed revision and force a re-verification — the moving-tree hazard
this wave enforced against from the start.

## Commits (order matters; every commit is intended green at its own HEAD)

| # | Commit message | Paths |
|---|---|---|
| 1 | `fix(adapter): resolve the workspace root from the calling session` | `packages/mpd-dsh-adapter-plugin/{src/index.ts,dist/index.js}`, `packages/mpd-bootstrap-plugin/dist/index.js`, `packages/mpd-roles-plugin/dist/index.js`, `packages/mpd-tools-plugin/dist/index.js`, `packages/mpd-qa-roles-probe/dist/index.js` (the four are dependent dist rebuilds that inline the adapter) |
| 2 | `fix(bline): follow the session workspace in boulder, config, comment-checker, memory, modelchain, ulw and workmate` | `packages/mpd-{boulder,config,comment-checker,memory,modelchain,ulw,workmate}-plugin/{src/index.ts,dist/index.js}` |
| 3 | `fix(verif): session-scoped roots, lossless backend JSON and the cocotb gate order` (B1 + B3 + R1 + R1-F1) | `packages/mpd-verif-plugin/src/**`, `packages/mpd-verif-plugin/test/**` (incl. the new `lossless.test.ts`), `packages/mpd-verif-plugin/dist/index.js`, `evidence/fix/verif-tool-lossless/**`, `evidence/wave2/r1-gate-order/**`, `evidence/wave2/r1-f1-exec-forward/**` |
| 4 | `fix(hashline): session-scoped paths and a oneOf lines schema` (B1 + B4) | `packages/mpd-hashline-plugin/{src/index.ts,dist/index.js,test/tool-schema.test.ts}`, `evidence/hashline/**` |
| 5 | `fix(qa): isolate the QA workspace, harden the harness cases and re-pin the skills fingerprint` (waves 1–3; the ONE skills+lock commit) | **all of `skills/**`** — wave 1/2: `skills/dsh-qa/SKILL.md`, `scripts/{agent-teams-sidebar,codegraph-smoke,dual-track-smoke,mcp-call,preset-conformance,preset-register,web-client-adapt,workmate-library}.mjs`, `scripts/lib/workspace-isolation.mjs`; **wave 3 (t3)**: `scripts/{preset-register,rtl-verif,mcp-call,web-client-adapt,dual-track-smoke,workmate-library,codegraph-smoke}.mjs` + `SKILL.md` — plus **`VENDOR_LOCK.json`** (skills → 366 files / `3259d07a…`), `scripts/verify-vendor.mjs`, `evidence/wave2/qa-workspace-isolation/**`, `evidence/verification/t9-b2-b6/**`, `evidence/dsh-qa/**`, `evidence/wave3/qa-harness-fidelity/**` |
| 6 | `fix(mcp): resolve the binaries inside the launchers, degrade codegraph instead of crashing, and root it at the calling session` (B8 + wave-3 F-B8-1 + O-1) | `packages/mpd-mcp-astgrep/{launch.mjs,README.md,README.zh-CN.md}`, `packages/mpd-mcp-codegraph/{launch.mjs,README.md,README.zh-CN.md}`, `packages/mpd-mcp-shared/**` (resolver + test), `packages/mpd-bundle/cordis.patch.yml`, `packages/mpd-codegraph-plugin/{src/index.ts,src/index.test.ts,dist/index.js,README.md,README.zh-CN.md}`, `scripts/pack-mpd.mjs` (ships launchers/resolver + mode normalization), `evidence/wave2/b8-binary-resolution/**`, `evidence/wave3/codegraph-degrade-and-applytime/**` |
| 7 | `fix(installer): add the mpd-verif row and a row-parity guard` (B9) | `scripts/install-profile.mjs`, `scripts/verify-rows-parity.mjs`, `package.json` (the `verify:rows` script), `evidence/wave2/b9-installer-parity/**` |
| 8 | `fix(agent-teams): scope-glob/contract gates, a context-pair delta registry, the marker-prefix fix and the update_task diagnostics` (waves 2 + 3) | `packages/mpd-agent-teams-plugin/lib/{quality-gates.js,tools.js,mpd-deltas.js}`, `packages/mpd-agent-teams-plugin/self-fix-tests/**` (incl. the new `registry-context-heal.test.mjs`), `packages/mpd-agent-teams-plugin/test/{task-contract-tool.test.mjs,update-task-diagnostics.test.mjs}`, `scripts/patch-agent-teams-fixes.mjs`, `scripts/vendor-agent-teams.mjs`, `evidence/wave2/adopted-tooling/**`, `evidence/wave2/adopted-tooling-repair/**`, `evidence/wave2/adopted-tooling-repair-f4/**`, `evidence/wave2/adopted-tooling-repair-f4-sibling/**`, `evidence/wave3/registry-redesign/**`, `evidence/wave3/t1-requirements/**` |
| 9 | `docs(agents): vendor-refresh mechanism, the adaptation list, the B8 rows and the wave-3 process notes` | `AGENTS.md` (§6 exception + A1–A6/D1–D12; §9 single-skills-writer rule; §11 VENDOR_LOCK pairing line; §12 ast-grep/codegraph rows + the four wave-3 rows: no hot reload, fresh `/tmp` per bash call, skills single writer, update_task trailing-key) |
| 10 | `test(evidence): record the wave-1/2/3 verification, review and integration evidence` | every remaining `evidence/**` path: `evidence/verification/{t10-review,t11-integration,t14-review}/**`, `evidence/session-workspace-root/**`, `evidence/agent-teams/**`, `evidence/plan-f/**`, `evidence/wave2/{t8-verification,t9-verification,t10-review,t11-integration,memory-migration}/**`, `evidence/wave3/{t2-captain-independent-verification,t5-verify,t6-verify,t7-review,t9-captain-independent-verification,integration}/**` |

## VENDOR_LOCK pairing rule (release-checklist line — verbatim)

> **`VENDOR_LOCK.json` must land in the SAME commit as every `skills/**` change that invalidates its
> `treeSha`.** The vendor gate hashes the whole `skills/**` tree, so a commit that edits skills and
> leaves the lock stale is RED at that commit; conversely the lock may not be committed before the
> skills tree reaches its final state. With the single-skills-writer rule (§9) that is exactly ONE
> re-pin per wave: in this plan the pairing is **commit 5**, which carries every `skills/**` change
> from all three waves AND the re-pinned `VENDOR_LOCK.json` (skills: 366 files,
> `treeSha 3259d07a613c0bb9cf4a0ae8478adcbbb6247ec8bd361fb2075c3092c1c00621`, from wave 2's
> `5b13e920…`; `HEAD` was `364 files / 29a6877c…`). `scripts/verify-vendor.mjs` lands there too
> because it is the gate that computes the re-pin. No other commit may touch `skills/**` or
> `VENDOR_LOCK.json`.

## Wave-3 absorption map (nothing new is needed; wave 3 extends the same ten commits)

| Wave-3 group | Task | Lands in |
|---|---|---|
| A registry redesign + marker-prefix fix | t2 (+ t9 repair, t10 review) | commit 8 |
| B `update_task` diagnostics | t2 | commit 8 |
| C QA-harness fidelity (devPatch operand, rtl-verif duplicate, deprecated pins, settings/HOME, timing flake, dual-track boot) | t3 | commit 5 (same commit as the ONE re-pin) |
| D F-B8-1 codegraph degradation, F-QA-2 flake, F-ENV-1 mcp-call HOME/settings, dual-track boot | t4/t3 | commits 6 and 5 |
| E O-1 codegraph apply-time cwd | t4 | commit 6 |
| F process/documentation notes | t8 | commit 9 (`AGENTS.md`); wave-3 evidence → commit 10 |
| G user-side actions (restart dsh, archive two team records, fix `~/.mpd/mcp.env`) | none — no agent may perform them | **no commit** (see carry-forward) |
| verification/review/integration evidence | t5/t6/t7/t8 | commits 8 and 10 |

## Untracked-path disposition

Machine-checked by `evidence/wave3/integration/20260911T094211Z/assign-paths.mjs`
(`path-disposition.json`): **1114** git-status paths (**67 modified + 1047 untracked**) → every one
is assigned to exactly one commit above; **`unassigned: []`**, `passed: true`.

Per commit: c1 6 · c2 16 · c3 62 · c4 16 · c5 215 · c6 49 · c7 13 · c8 107 · c9 1 · c10 629.
(Counts move as this evidence directory grows; re-run the checker for the current revision.)

**Explicitly NOT committable** (all confirmed ignored by `git check-ignore -v`):

| Path | .gitignore rule | Why |
|---|---|---|
| `.mpd/team/**` (e.g. `.mpd/team/mpd-wave-3/team.json`) | `.gitignore:21:.mpd/` | live team state — owned by the agent-teams plugin; the user archives the two isolation-control records in the tab |
| `.mpd/memory/**` | `.gitignore:21:.mpd/` | memory store's own git repository |
| `dist/mpd-package/**` | `.gitignore:12:dist/mpd-package/` | packed build artifact (installable tarball input), regenerated by `npm run pack` |
| `.codegraph/**` | `.gitignore:10:.codegraph/` | per-workspace codegraph index |

## git status (verbatim capture)

```
branch: dev
HEAD:   98680b1fb2bbf5c10c28cfbe44419e91595e1cb7
porcelain: 1109 entries (67 modified, 1042 untracked)   # full text: raw/git-status-porcelain.txt
diffstat:  67 files changed, 2755 insertions(+), 745 deletions(-)   # full text: raw/git-diffstat.txt
```

Largest modified areas by churn: `packages/mpd-verif-plugin` 902, `packages/mpd-codegraph-plugin`
407, `skills/dsh-qa` 285, `packages/mpd-agent-teams-plugin` 351, `packages/mpd-workmate-plugin` 197,
`AGENTS.md` 107.

## Gates on the frozen tree

The final gate sweep was executed on THIS tree (`raw/gate-*.log`, `raw/gate-exitcodes.txt`):
verify-vendor 0 · typecheck 0 · `bun test packages` 0 (376 pass / 0 fail / 82 files) · `bun run
test:qa` 0 (all self-tests passed) · preset-conformance 0 (PASS + negative control
`agent-preset/invalid … $.prefix missing required value`) · dist sweep `--clean-room` 0 (16
packages, **16 FRESH / 0 STALE**, pass1==pass2 16/16, committed==pass2 16/16).
Per-commit greenness was **not** re-executed for each of the ten commits; only the final tree was
swept, and that is what this plan claims.

## Captain execution note (added when this plan was executed)

The pin table above is CORRECT for four of its five rows and STALE for one, measured at execution time:

- `lib/tools.js` `406e086e…` OK · `lib/quality-gates.js` `4e94f7f6…` OK · `scripts/patch-agent-teams-fixes.mjs` `fa696421…` OK · `VENDOR_LOCK.json` `55150c57…` OK
- **`lib/mpd-deltas.js` is `aad87c2c…`, NOT `d3a1d4ad…`.** `d3a1d4ad…` was t2's registry, measured by t5 BEFORE the t9 repair. t9 changed the required-`attempt_id` message inside the `update-task-required-attempt-id` region block, and a region's block text is PART of its registry entry — so regenerating with `--write-registry` necessarily produced a new sha. `aad87c2c…` is t9's deterministic output (stable across a second run) and it is COHERENT with the on-disk `tools.js`: `--check` reports 12/12 regions applied, and the D15 block carries the actionable `attempt_id="<value>"` phrase. **Do NOT "restore" `d3a1d4ad…`:** that registry predates the reviewed message and would contradict the file it heals.

Executed on the branch the plan recommends, with the assignment rules of `assign-paths.mjs` re-used verbatim.
