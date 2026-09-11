# t10 — Review round 1: correctness, rule compliance and evidence quality of the B1–B6 change set

Reviewer: Reviewer (independent). Verdict: **needs_revision** (one unmet acceptance criterion of the
reviewed implementation t7 — see F1).

Reviewed tree: `dev` HEAD `98680b1fb2bbf5c10c28cfbe44419e91595e1cb7`, worktree after t12's dist repair
(4 dists rebuilt at 11:57; no src edits). Anchored at review time by the gates below; the reviewed
artifact is t7 (B1) with the cumulative t2/t3/t4/t5/t6/t7 diff judged as one change set.

## 1. t7 acceptance criteria — met / unmet (each traced to a raw artifact)

| # | Criterion (t7 contract) | Verdict | Artifact |
|---|---|---|---|
| 1 | Every workspace/state root resolves inside the SESSION workspace when it differs from process.cwd(); the four reproductions point into the repo | **UNMET (general clause)** / four reproductions MET | t8 attempt-2 raw probe list R1–R5 (`evidence/session-workspace-root/t8-verify/attempt-2/RESULT.json`); my own reproduction `repro-venv-gate.log` shows the verif LANE tools still resolve the process-cwd venv (F1) |
| 2 | No plugin resolves its root with a bare `env ?? process.cwd()`; grep returns only the single shared helper | MET | my grep over `packages/*/src`: 0 matches of the expression; the helper is `workspaceRootOf` in the adapter |
| 3 | Resolution lives in exactly one place; no plugin touches a harness seam outside `mpd-dsh-adapter-plugin` | MET | adapter diff (`workspaceRootOf`/`workspaceRootsOf`, exposed as `workspaceRoot`/`workspaceRootsAll`); grep `ctx.tools|ctx.subagents|ctx.skills|ctx.agentPresets` over `packages/*/src` → only a doc comment in `mpd-bootstrap-plugin` |
| 4 | workmate in-use gate scans the session workspace's team state, demonstrated by a controlled case | MET (tool path) | t8 W2/W3/W6/W7/W8 raw details; code: `packages/mpd-workmate-plugin/src/index.ts:682,697` pass `[dsh.workspaceRoot(exec)]`. Coverage gap for the agentless union path = F6 |
| 5 | Mounting boot 0 apply-crash signatures + preset-conformance ok:true | MET | t8 attempt-2 boot logs; my own `preset-conformance` run on this tree: `[preset-conformance] PASS`, exit 0, with its negative control (`agent-preset/invalid … $.prefix missing required value`) |
| 6 | Every touched package's dist rebuilt and consistent with source apart from the build banner | MET | my own full rebuild: 16/16 packages BYTE-IDENTICAL (`dist-consistency-full.txt`), including the 4 t12-repaired ones |
| 7 | `bun test packages`, `bun run typecheck`, `bun run test:qa` pass | MET | my own run on this tree (`gates-current-tree.log`): typecheck exit 0; 308 pass / 0 fail / 0 skip; test:qa 26 scripts, "all self-tests passed" |

## 2. Cumulative diff (t2–t7) — correctness and rule compliance

- **B2 vendor lock**: lock `treeSha ea1f001f…` / `fileCount 365` independently re-derived with the
  script's own algorithm (my recomputation matches exactly), gate `PASS` on this tree; falsifiability
  already proven by my t9 mutations. B2's own diff = `VENDOR_LOCK.json` + `scripts/verify-vendor.mjs`.
- **B3**: `licenseHint: string[] | null` in src and dist (`dist/index.js:380`), conditional spread for
  `filelistPath`/`outBinary` (`dist/index.js:578-579`); pre-fix negative control fails (t9 evidence);
  mounted calls green with a synthetic-lossy positive control (t9).
- **B4**: no array-typed schema in hashline src/dist (0 matches, two patterns); live schema is
  `oneOf:[string, array<string>]`; mount proof 0 apply-crash signatures; read + edit with `lines`
  string and array (t9). Repo-wide sweep: 0 array-typed schemas in `packages/*/{src,dist}`.
- **B5**: real `mpd_comment_check` detection + clean pass; the 3 previously skipped tests execute
  (0 skip in the full suite); README pair updated together with the language-switch links intact.
- **B6**: AGENTS.md provenance now agrees with `package.json`/`LICENSE-NOTICES`/`feature-audit`
  (`0.1.16-rc.3-mpd`); adopted upstream `README.md`/`README_ZH.md` byte-unchanged; no stale version claim.
- **Rules**: adapter seam rule holds (no plugin bypass); bundle patch untouched (no new row key);
  no `process.chdir`, no env mutation, no module-level root caching (R8 clean); agent-facing text is
  English-only (no CJK added to code/scripts); human-facing docs touched are bilingual in the same change.
- **Apply-time vs execute-time**: `ulw`/`modelchain` moved resolution into tool bodies; `config` keeps
  the documented apply-time snapshot and re-reads per call via `reload(exec)`; `codegraph` stays
  apply-time with its own env override (t1 item 14, follow-up) — consistent with the t1 record.

## 3. Findings

### F1 (high) — the cocotb IRON gate does not follow the calling session
`packages/mpd-verif-plugin/src/venv.ts:138-139` — `requireCocotbVenv(override?)` calls
`venvStatus(override)` **without exec**; its callers `sim.ts:200` and `regress.ts:135` call
`requireCocotbVenv()` with no channel for exec. `workspaceRoot(undefined)` therefore falls back to
`DSH_WORKSPACE_ROOT → process.cwd()`.

Raw reproduction (`repro-venv-gate.log`, session workspace ≠ process cwd, `DSH_WORKSPACE_ROOT` unset):
```
venvStatus_WITH_exec.ok=true
venvStatus_WITH_exec.venv=/root/dshProj/my-power-dsh/.t10-repro-ws/.venv-rtl
requireCocotbVenv.error_code=VERIF_E_NO_VENV
requireCocotbVenv.message=cocotb venv missing at /root/dshProj/.venv-rtl (iron rule: ...)
verifSim.error_code=VERIF_E_NO_VENV
verifSim.message=cocotb venv missing at /root/dshProj/.venv-rtl (iron rule: ...)
requireCocotbVenv_with_env_override=passed (/root/dshProj/my-power-dsh/.t10-repro-ws/.venv-rtl)
```
So `mpd_verif_venv info` (the tool) is fixed, but `mpd_verif_sim` / `mpd_verif_regress` still refuse in
exactly the B1 scenario. `venvCreate` has the same drop at `venv.ts:127` (it creates the venv at the
session root, then re-probes the process root and can report `ok:false`). t8's 19 checks cover
`mpd_verif_venv info` (R2) but never the lane gate — which is why this slipped through.

### F2 (medium) — hashline guard membership test uses a different base than the registry
`packages/mpd-hashline-plugin/src/index.ts:68-71`: `registered()` computes `resolve(fp)` (process.cwd()
base) while registry entries are session-resolved (`sessionPath` :56, `registryPath` :50, write :160).
With a relative `file_path` the guard silently does not fire when session ≠ process.cwd(). Pre-fix both
sides used process.cwd(), so this is an inconsistency introduced by the migration; it also deviates
from the t1 decision record §2 item 17 ("the guard's `file_path`" resolves against
`dsh.workspaceRoot(exec)`). The harness's own editor resolves relative paths session-relative
(`dsh-tool-str-replace-editor/lib/index.js:67-70`) and does not rewrite `exec.arguments.file_path`.

### F3 (low) — AGENTS.md still describes the state root as ".mpd/ under cwd"
`AGENTS.md:233` — stale after B1 (session workspace is authoritative; cwd is the last-resort fallback).

### F4 (medium, integration) — gitignored pack artifact still inlines pre-fix code
`dist/mpd-package/**` (built 10:44, gitignored) has `workspaceRootOf=0` and the pre-fix expression in
the packed verif copy (independently verified); `.qa-reloc/**` scratch trees likewise hold pre-fix
dists. t11 must re-run `npm run pack` and must not treat those paths as evidence of the current tree.

### F5 (low) — t8 prose count vs raw list
t8's prose/`verdict_reason` says "18/18" while the attempt-2 raw probe list contains 19 PASS entries.
Quote the raw list rather than the prose count in the consolidation.

### F6 (low) — the agentless union path has no live evidence
`workspaceRootsAll()` → `agentlessRoots` (`mpd-workmate-plugin/src/index.ts:388`) is exercised by no
check; all 19 checks drive the tool path or the exec-less fallback.

### F7 (low) — pre-existing hygiene strays
3 empty evidence dirs (`evidence/dsh-qa/agent-teams-dispatch/2026-09-11T01-17-12.731Z`,
`…/01-29-47.442Z`, `evidence/workmate/roles-readonly/2026-09-10T13-41-41.114Z`) and gitignored
`.qa-tmp` leftovers (`.orig` backups, a pipx lock). Their mtimes (09-10/08-31) predate this change set,
so they are not products of t2–t7, but they are the "stray/partial evidence" class flagged by this review.

## 4. Operational note (not a code defect)
The running dsh GUI process (started 10:58) still executes the pre-fix code — the fixed dists were built
at 11:24–11:29. t8 measured this ("live-deployment-evidence.md"). The fix takes effect only after a dsh
restart; integration should say so explicitly rather than citing live in-session tool output as proof.

## 5. Evidence produced by this review
`repro-venv-gate.ts` + `repro-venv-gate.log` (F1 reproduction), `gates-current-tree.log` (typecheck /
308-0 / test:qa), `preset-conformance-review.log` (PASS + negative control), `dist-consistency-full.txt`
(16/16 byte-identical), `vendor-lock-derivation.txt` (independent treeSha recomputation), plus the
hygiene/attribution checks quoted above.
