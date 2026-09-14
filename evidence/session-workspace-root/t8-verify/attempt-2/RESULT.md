# t8 (attempt 2) — Verify B1: workspace roots resolve into the session workspace — **PASSED**

Member: Lead · attempt `45e01c27-73b3-4bcc-934f-67d11ed9f8fe` · 2026-09-11
(replaces the attempt-1 report, which failed on required check 6 only)

## Verdict: **PASSED** on the current tree (after repair task t12)

All six acceptance criteria and all six required checks pass. Every check was **re-run on the current
tree**, not carried over from attempt 1 (the tree changed: 4 dists rebuilt by t12 + t12's evidence tree
+ `mpd-roles-plugin`'s banner normalized).

| # | Required check | Status | Evidence (current tree) |
|---|---|---|---|
| 1 | Four captain reproductions in the original shape | **PASS** | Fresh boot, child `/proc/<pid>/cwd = /root/dshProj` ≠ session workspace; `R1` `path=/root/dshProj/my-power-dsh/.mpd/hashline-files.json`; `R2` `workspace=<repo> venv=<repo>/.venv-rtl work=<repo>/.mpd/verif`; `R3` `root=<repo>/.mpd/memory/agents/agent-my-power-dsh`; `R4` `count=1 [<repo>/.mpd/plans/workmate-rename-delete-contract.md]`; `R5` `stateFile=<repo>/.mpd/boulder.json` |
| 2 | Mounting boot, isolated DSH_HOME + sandbox HOME, 0 apply-crash signatures, no `--dump-config` | **PASS** | `applyCrashSignatures=[]`, probe reached `[t8-probe] DONE`, three real gateway sessions in one boot; `--dump-config` was never run or cited |
| 3 | `preset-conformance` ok:true + negative control | **PASS** | `ok=true`; conformance 30 checked / parity 31/31; sessionCreate ok; sessionHeader ok; bootLog signatures `[]`; negative control `agent-preset/invalid` + `$.prefix missing required value`; `--self-test` ok; `bundle-lifecycle` PASS |
| 4 | Workmate in-use gate: controlled case, live team records, read-only | **PASS** | `W1–W8` PASS (controlled fixture refused `blocking-team/t8wm1`; repo records refused — `mpd-default-7332aba4/Lead`, `…/Architect`; unrelated/clean keys allowed); `X1` all three `.mpd/team` trees byte-identical before/after |
| 5 | grep `packages/*/src` | **PASS** | Only the adapter helper (`mpd-dsh-adapter-plugin/src/index.ts:203-205`); the lone other code hit is `mpd-codegraph-plugin/src/index.ts:76` (different expression, apply-time, explicit override) — low observation, unchanged |
| 6 | Each dist matches its source apart from the build banner | **PASS** | **16/16 byte-identical** to a fresh build with the same documented method; stale=0, banner-only=0 (was 12 fresh / 4 stale) |

## Required check 6 — the attempt-1 failure, re-measured

Method (identical to `…/t8-verify/dist-consistency.txt`): for every `packages/*/dist/index.js`,
`bun build packages/<p>/src/index.ts --target node --format esm --outfile <tmp>` from the repo root,
then compare committed bytes; if different, compare again with build-banner comment lines
(`^// .*\.ts$`) stripped.

```
mpd-bootstrap-plugin: IDENTICAL (sha256 c817928406387c07)     ← repaired (was STALE f48553d0131a883d)
mpd-qa-roles-probe:   IDENTICAL (sha256 37d0693a8b7f76e7)     ← repaired
mpd-roles-plugin:     IDENTICAL (sha256 741605f62225fb41)     ← repaired (banner also normalized)
mpd-tools-plugin:     IDENTICAL (sha256 07c539987450e064)     ← repaired
… 12 previously-fresh packages identical with UNCHANGED sha prefixes
   (boulder a15872148b34caee, hashline 7152de89783e4018, verif 2958504a65f4603d, workmate e10a87fcf2fe3096, …)
--- packages checked: 16; byte-identical=16 banner-only=0 REAL-DIFF(stale)=0; fail=0
```

All four repaired dists now contain `workspaceRootOf` (2 hits each, was 0). t12's deviation — the
repo-root build form — is judged **correct**: my documented method passes the repo-relative source
path, so the leading banner and the inlined-adapter banner both reproduce; the committed bytes now
match exactly, including `mpd-roles-plugin`, whose outlier banner was normalized as a side effect.
That banner-only difference is accounted for, not unexplained.

## Commands (all current tree; raw logs in `attempt-2/gates/`)

| Command | Exit | Result |
|---|---|---|
| `node skills/dsh-qa/scripts/preset-conformance.mjs` | 0 | `ok=true` + negative control ok → PASS |
| `node skills/dsh-qa/scripts/preset-conformance.mjs --self-test` | 0 | 30 rows conform, parity 31/31 |
| `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` | 0 | all steps ok → PASS |
| `bun test packages` | 0 | 308 pass / 0 fail / 2025 expects / 35 files |
| `bun run test:qa` | 0 | `[test:qa] all self-tests passed` |
| `bun run typecheck` | 0 | `tsgo --noEmit` clean |
| `grep -rn 'DSH_WORKSPACE_ROOT\|process.cwd()' packages/*/src` | 0 | 13 hits, all classified |
| `run-toolcall-proof.mjs` (fresh boot) | 0 | 19/19 checks PASS, 0 crash signatures |

## Falsifiability controls re-confirmed on this tree

- `N1`: without an agent the same call collapses to `workspace=/root/dshProj` (host cwd) — the
  resolution is session-driven, not constant.
- `N2`/`N3`: without an agent, `mpd_boulder_plans` returns 0 plans and `mpd_hashline_read` fails with
  `file not found: /root/dshProj/.mpd/hashline-files.json`.
- `S1`/`S2`: two other sessions in the same process resolve their own workspaces and do not see the
  repo plan.
- `X1`: the workmate gate reads but never writes `.mpd/team` (byte-identical trees).

## Artifacts

`evidence/session-workspace-root/t8-verify/attempt-2/{RESULT.json,RESULT.md,dist-consistency-attempt2.txt,
grep-root-resolution-attempt2.txt,gates/,toolcall-proof/{result.json,boot.log}}`;
attempt-1 failure record kept at `…/t8-verify/{RESULT.json,RESULT.md,dist-consistency.txt}`;
repair evidence `evidence/session-workspace-root/dist-repair/`.
