# t8 — Verify B1: workspace roots resolve into the session workspace (verification report)

Member: Lead · attempt `169c8615-4e7e-42fa-83aa-3e5096a56818` · 2026-09-11

## Verdict: **FAILED** — one required check unmet (stale dists), everything else verified

The B1 fix itself is **verified**: in a fresh boot whose process cwd (`/root/dshProj`) is deliberately
different from every session workspace (`/root/dshProj/my-power-dsh` + two controlled workspaces),
**19/19 checks PASS**, the four captain reproductions all resolve inside the session workspace, the
mounting boot has **0 apply-crash signatures**, preset-conformance is `ok:true` with its negative
control, and the workmate in-use gate sees the real team state while staying read-only.

The task fails on required check 6 (dist/source consistency): **4 package dists in this change set are
stale** — they still inline the pre-fix adapter.

## Required checks

| # | Check | Status | Evidence |
|---|---|---|---|
| 1 | Four reproductions re-run in the original shape | **PASS** | `R1` hashline → `<repo>/.mpd/hashline-files.json`; `R2` verif → `workspace/venv/work` in repo; `R3` memory → `<repo>/.mpd/memory/agents/agent-my-power-dsh`; `R4` boulder plans → `["<repo>/.mpd/plans/workmate-rename-delete-contract.md"]` (count=1). Boot child `/proc/<pid>/cwd = /root/dshProj` ≠ session workspace. |
| 2 | Mounting boot, isolated DSH_HOME + sandbox HOME, 0 apply-crash signatures, no `--dump-config` cited | **PASS** | `applyCrashSignatures=[]`, probe reached `[t8-probe] DONE`, adapter row + served skill corpus in `boot.log`. `--dump-config` was never run in this verification. |
| 3 | `preset-conformance` ok:true incl. negative control | **PASS** | `ok=true`; sessionCreate/sessionHeader/bootLog ok; negative control `agent-preset/invalid` + `$.prefix missing required value`; `--self-test` ok (30 rows); `bundle-lifecycle` PASS. |
| 4 | Workmate in-use gate: controlled case, sees the session workspace's team records, read-only | **PASS** | `W1–W8` PASS (controlled fixture refused with `blocking-team/t8wm1`; the LIVE repo records refused with `mpd-default-7332aba4/Lead` and `mpd-default-7332aba4/Architect`; unrelated/clean keys allowed); `X1` all three `.mpd/team` trees byte-identical before/after. |
| 5 | Grep `packages/*/src`: bare expression only in the shared helper, every hit justified | **PASS** | Only code hit outside the helper is `mpd-codegraph-plugin/src/index.ts:76` (different expression, apply-time, explicit override). All other hits are doc comments. See `grep-root-resolution.txt`. |
| 6 | Each dist matches its source apart from the build banner | **FAIL** | 18/22 identical (or banner-only); **4 stale**: `mpd-bootstrap-plugin`, `mpd-qa-roles-probe`, `mpd-roles-plugin`, `mpd-tools-plugin`. |

## Blocking finding F1 (medium) — 4 stale dists

A fresh `bun build <pkg>/src/index.ts --target node --format esm --outfile …` differs from the committed
dist by exactly the new adapter helper (`sessionCwdOf` / `workspaceRootOf` / `workspaceRootsOf` + the
row's `workspaceRoot` / `workspaceRootsAll`). The committed dists match a build of **HEAD (pre-fix)**
sources — t7's adapter change is what drifted them. None of the four calls the new helpers, so there is
no behaviour change today, but the packed bundle would ship 4 plugin rows carrying a pre-fix inlined
adapter copy, and commit `94c6ab0` (which introduced the adapter) shows the repo convention: every
dependent dist is rebuilt in the same commit.

**Repair:**
```
bun build packages/mpd-tools-plugin/src/index.ts     --target node --format esm --outfile packages/mpd-tools-plugin/dist/index.js
bun build packages/mpd-roles-plugin/src/index.ts     --target node --format esm --outfile packages/mpd-roles-plugin/dist/index.js
bun build packages/mpd-bootstrap-plugin/src/index.ts --target node --format esm --outfile packages/mpd-bootstrap-plugin/dist/index.js
bun build packages/mpd-qa-roles-probe/src/index.ts   --target node --format esm --outfile packages/mpd-qa-roles-probe/dist/index.js
```
then re-run the dist check (`evidence/session-workspace-root/t8-verify/dist-consistency.txt` method).

## Acceptance criteria (contract) — all PASS

1. Four reproductions re-run independently, resolving INSIDE the session workspace — PASS (`R1–R4`).
2. Mounting boot with 0 apply-crash signatures; no `--dump-config` cited as load evidence — PASS.
3. `preset-conformance` ok:true including its negative control — PASS.
4. Workmate in-use gate exercised, sees the session workspace's team records, writes nothing — PASS.
5. Grep shows the bare expression only in the single shared helper — PASS.
6. Unreproducible criteria reported as failure with raw evidence (not waved through) — PASS: required
   check 6 is reported failed with the fresh-build diff, and the live process's pre-fix behaviour is
   reported raw instead of being assumed fixed.

## Commands run (all in `gates/`)

| Command | Exit | Result |
|---|---|---|
| `bun run typecheck` | 0 | `tsgo --noEmit` clean |
| `node skills/dsh-qa/scripts/preset-conformance.mjs` | 0 | `ok=true` + negative control ok → PASS |
| `node skills/dsh-qa/scripts/preset-conformance.mjs --self-test` | 0 | 30 rows conform, row parity 31/31 |
| `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` | 0 | install/boot/no-residue/uninstall all ok → PASS |
| `bun test packages` | 0 | 308 pass / 0 fail / 2025 expects / 35 files |
| `bun run test:qa` | 0 | `[test:qa] all self-tests passed` |
| `grep -rn 'DSH_WORKSPACE_ROOT\|process.cwd()' packages/*/src` | 0 | 13 hits, all classified |
| `node evidence/.../run-toolcall-proof.mjs` | 0 | 19/19 checks PASS, 0 crash signatures |

## Notes / observations

- **O1 (info)** — the *running* GUI process still resolves `/root/dshProj` (raw outputs in
  `live-deployment-evidence.md` §A): it loaded the pre-fix dists before they were rebuilt at 11:24–11:29.
  Its member sessions **do** carry `session.header.cwd` = the repo (§B, all 11 members, `delegationDepth=1`),
  so the anomaly is stale module code, not a member-session gap — **a dsh restart picks the fix up**.
- **O2 (low)** — `mpd-codegraph-plugin/src/index.ts:76` keeps an apply-time `MPD_CODEGRAPH_PROJECT_CWD || process.cwd()`
  (explicit override wins; no exec exists at apply time). Same class as the documented mpd-config apply-time
  form, outside t7's migrated call-site set.
- **Method note** — the sandbox has no LLM credential (`MISSING_CREDENTIAL`; no `DEEPSEEK_API_KEY` in the
  tool environment and `$DSH_HOME/.credentials.yaml` holds only the browser-session secret), so the
  model-turn variant of the proof cannot run inside an isolated sandbox. The tool calls were therefore
  issued through the harness tool runtime carrying each session's **live agent** (`tools.execute` — the
  same runtime entry a model-initiated call uses); the probe prints each agent's `session.header.cwd`, so
  the exec identity is measured, never synthetic.
