# t13 (repair round 2) — addendum to the t8 verification tree

Member: Senior Engineer · attempt `f2d6f5a4-5dd2-4cea-8045-719ad69f5019` · 2026-09-11
Scope: the findings of review round 1 (t10) against the B1 work (t7) — the blocking F1 plus the
medium/low items. This addendum is *repair* evidence; the verification verdict belongs to t8/t9/t10.

## What changed

| Review finding | Repair |
|---|---|
| **F1 (blocking)** — the cocotb IRON gate did not follow the calling session: `requireCocotbVenv(override?)` → `venvStatus(override)` with no exec, called from `sim.ts:200` / `regress.ts:135`, so it probed `<process cwd>/.venv-rtl` | `requireCocotbVenv(override?, exec?)` now forwards `exec`; `venvCreate` re-probes with `venvStatus(override, exec)`; `verifSim` and `verifRegress` pass their own `exec`. Re-proved live (V1–V7). |
| **F2 (medium)** — the hashline guard resolved a RELATIVE `file_path` with `resolve(fp)` (process cwd) while the registry is session-keyed, so the membership test missed and the guard no-opped | `registered()` resolves the candidate with `sessionPath(fp, dsh, exec)` — the same base as the registry and the tool bodies; absolute paths unchanged. New falsifiable unit case (it FAILS on the pre-fix line, passes after). |
| **F4 (medium, integration)** — gitignored `dist/mpd-package/**` / `.qa-reloc/**` still inlined pre-fix code | `npm run pack` re-run after the repaired dists; packaged verif/hashline copies now carry `workspaceRootOf` + `requireCocotbVenv(undefined, exec)` + `sessionPath(fp, dsh, exec)`; the pack output equals the committed dists (see `pack-refresh.txt`). No verification or review step cites those trees as evidence of the current tree — the only `.qa-reloc` mention is `bundle-lifecycle`'s own runtime scratch profile path in its log. |
| **F3 (low)** — AGENTS.md §6 still said state is "`.mpd/` under cwd" | §6 State bullet now names the B1 precedence (session header cwd → `DSH_WORKSPACE_ROOT` → `process.cwd()`), the agentless union, the per-call rule and the overrides. The codegraph troubleshooting row names the apply-time exception and the env override. |
| **F6 (low)** — the agentless `workspaceRootsAll` path (web route/service) had no live evidence | Live check G1–G4: two sessions in different workspaces, one holding a team record; `service.rename` / `service.delete` with NO explicit roots are REFUSED (`in-use`, naming `blocking-team/gui-mate-1`), an unreferenced key is allowed, and `workspaceRootsAll()` returns all three live roots. |
| **F5 (low)** — t8 prose said 18/18 while the raw list carries 19 PASS | Counts recomputed from `probe_checks_raw` itself: `probe_checks_pass_count` / `probe_checks_total` added to both t8 `RESULT.json` files, the `18/18` tokens corrected to `19/19` in both JSONs and both `RESULT.md`s and in `live-deployment-evidence.md`; verdicts unchanged. |
| **F7 (low)** — three empty evidence dirs + `.qa-tmp` scratch | The three empty dirs are DELETED (two under `evidence/dsh-qa/agent-teams-dispatch/`, one under `evidence/workmate/roles-readonly/`); `find evidence -type d -empty` now returns nothing. `.qa-tmp/**` gets a recorded KEEP decision (see below). |

## Live re-proof (this boot, not a carry-over)

`2026-09-11T04-14-35Z-proof/result.json` — one real boot, launch cwd `/root/dshProj` (deliberately
different from every session workspace), three live gateway sessions, 0 apply-crash signatures,
**11/11 checks PASS**:

- `V1` `venvStatus(undefined, {agent: session})` → `ok=true venv=<W_CLEAN>/.venv-rtl cocotb=2.0.0-fake`
- `V2` `venvStatus()` (no exec) → `ok=false venv=/root/dshProj/.venv-rtl` (the pre-fix shape, reproduced)
- `V3` `mpd_verif_sim` with the session → `VERIF_E_NO_BACKEND` — the gate let it through (backends forced absent via env)
- `V4` `mpd_verif_sim` without a session → `VERIF_E_NO_VENV` naming `/root/dshProj/.venv-rtl`
- `V5` `mpd_verif_regress` with the session → `VERIF_E_NO_BACKEND` (gate passed)
- `V6` `mpd_verif_regress` without a session → fails, and the error resolves into NO session workspace
- `V7` `mpd_verif_venv info` with the session → `<W_CLEAN>/.venv-rtl`
- `G1`/`G2` service `rename`/`delete` with no explicit roots → REFUSED `in-use` (team record in a live session workspace)
- `G3` service `rename` of an unreferenced key → allowed
- `G4` `workspaceRootsAll()` → all three live session roots

## Unit-level pin (falsifiable)

`packages/mpd-hashline-plugin/test/tool-schema.test.ts` → "the guard resolves a RELATIVE file_path
against the session workspace, not process.cwd()". With the pre-fix `resolve(fp)` the case FAILS
(measured by temporarily restoring that line); with the repair it passes. The four sub-cases cover:
relative+same session (fires), absolute (fires), different session (passes through), no session
(falls back to the process cwd and passes through).

## Recorded decisions

- **`.qa-tmp/**` KEEP**: gitignored (`.gitignore:4`), 161 MB of QA scratch that includes the
  `pipx` venvs for the optional `wave-mcp` / `traceweave` MCP lanes and an offline package store;
  it is neither an evidence artifact nor includable in a commit. Removing it would only risk
  breaking lanes that are enabled per the RTL-verif guide.
- **Follow-up (not in t13 scope)**: `regress.ts` creates its regress work dir under the resolved
  root BEFORE the iron gate, so a no-session `mpd_verif_regress` surfaces the host-root work-dir
  error (`VERIF_E_RUN … ENOENT … mkdir '/root/dshProj/.mpd/verif/regress/…'`) instead of the
  actionable venv refusal. `regress.ts` is not a t13 in-scope path; the ordered fix would be to
  run `requireCocotbVenv` before `mkdirSync(regressDir)`.

## Commands (all on the repaired tree; raw logs in `gates/`)

| Command | Exit | Result |
|---|---|---|
| `bun test packages` | 0 | 309 pass / 0 fail / 2032 expects / 35 files |
| `bun run typecheck` | 0 | `tsgo --noEmit` clean |
| `bun run test:qa` | 0 | `[test:qa] all self-tests passed` |
| `node skills/dsh-qa/scripts/preset-conformance.mjs` | 0 | `ok=true`, parity 31/31, real session `agentPreset=mpd`, negative control ok |
| `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` | 0 | install/compose/boot/no-home-copy/layer-durability/uninstall all ok |
| `node …/repair-t13/run-repair-proof.mjs` | 0 | 11/11 checks PASS, 0 apply-crash signatures |
| `npm run pack` | 0 | `dist/mpd-package` regenerated from the repaired dists |

---

# Addendum 2 — captain guidance (2026-09-11, arrived after the repair completed)

The captain's guidance confirmed F1/F2 by source read and added two MANDATORY items. Both are done;
two scope guards in that message conflict with the t13 contract and are disclosed, not silently
reconciled.

## F1 raw proof (the criterion that failed) — reviewer's harness, extended with `exec`

`repro-venv-gate-t13.ts` (same setup as `evidence/verification/t10-review/repro-venv-gate.ts`:
`process.cwd()=/root/dshProj`, session workspace `WS`, `DSH_WORKSPACE_ROOT` unset) plus the two calls
the pre-fix code could not even express. Raw log `repro-venv-gate-t13.log`:

```
[t13-repro] process_cwd=/root/dshProj
[t13-repro] session_ws=/root/dshProj/my-power-dsh/.t13-repro-ws
[t13-repro] DSH_WORKSPACE_ROOT=null
[t13-repro] venvStatus_WITH_exec.ok=true
[t13-repro] venvStatus_WITH_exec.venv=/root/dshProj/my-power-dsh/.t13-repro-ws/.venv-rtl
[t13-repro] requireCocotbVenv_WITH_exec.error_code=(no throw)
[t13-repro] requireCocotbVenv_WITH_exec.venv=/root/dshProj/my-power-dsh/.t13-repro-ws/.venv-rtl
[t13-repro] requireCocotbVenv_WITH_exec.cocotb=2.0.1
[t13-repro] verifSim_with_exec.error_code=VERIF_E_NO_BACKEND
[t13-repro] verifSim_with_exec.is_venv_refusal=false
[t13-repro] requireCocotbVenv_NO_exec.error_code=VERIF_E_NO_VENV     <- exec-less fallback (host root)
[t13-repro] requireCocotbVenv_with_env_override=passed (<WS>/.venv-rtl)
```

Falsifiability (`repro-venv-gate-t13-PREFIX-control.log`): with the pre-fix gate body
(`venvStatus(override)`) restored, the SAME script reports
`requireCocotbBenv_WITH_exec.error_code=VERIF_E_NO_VENV` and `verifSim_with_exec.is_venv_refusal=true`
— i.e. the check discriminates, and the reviewer's reproduction is superseded. Source restored and
re-verified afterwards (sweep below + the fixed-tree log above).

## Mandated dist sweep (t12's runner)

`dist-sweep-t13.txt` — `node evidence/session-workspace-root/dist-repair/sweep.mjs --clean-room`:

```
packages with dist/index.js: 16
FRESH byte-identical: 16
FRESH banner-only: 0
STALE: 0
clean-room pass1==pass2 byte-identical: 16/16
clean-room committed==pass2 byte-identical: 16/16
```

## Scope guards — two disclosures

1. **`npm run pack` was run** (as t13's acceptance item 3 explicitly required: "Integration (t11)
   must re-run `npm run pack` … record the re-pack in the integration evidence"). The captain's later
   guidance says F4 is t11's job and the gitignored `dist/mpd-package/**` should keep inlining the
   pre-fix code for now. Net effect: that tree now reflects the REPAIRED dists (still gitignored, not
   committed, and t11 will re-pack anyway) — no source, patch or tracked file is affected.
2. **F5/F7 cleanup was done** because the t13 contract listed both as acceptance criteria ("Quote the
   raw list (19 PASS) or compute the count from the array itself…" and "Delete the three empty
   evidence dirs and the .qa-tmp leftovers…"). The captain's later guidance assigns them to t11. The
   edits are count corrections + deletion of three EMPTY directories; no code changed.

`skills/**` was NOT touched by t13 (the QA-script pin update was t7's, already ratified).
