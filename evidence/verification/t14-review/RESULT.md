# t14 — Review round 2: B1–B6 change set after repair t13

Reviewer: Reviewer (independent). **Verdict: pass.**
Reviewed tree: `dev` HEAD `98680b1fb2bbf5c10c28cfbe44419e91595e1cb7` + t12 (dist repair) + t13 (repair round 2).
Reviewed task: **t13**. Round-1 findings F1–F7 are all verified resolved; t7's acceptance criteria are
now all met. Every statement below is from raw output I produced on this tree (files under
`evidence/verification/t14-review/`).

## 1. t13 repairs — verified independently, with falsifiability

| Finding | Verdict | My raw proof |
|---|---|---|
| **F1 (blocking) cocotb gate root** | **RESOLVED** | Code: `venv.ts:140` `requireCocotbVenv(override?, exec?)` → `venvStatus(override, exec)`; `venvCreate` re-probe `venv.ts:127`; `sim.ts:200` / `regress.ts:135` pass `undefined, exec`. My reproduction (`repro-f1-fixed.log`, session ws ≠ host cwd, `DSH_WORKSPACE_ROOT` unset): `venvStatus(exec)` ok at `<ws>/.venv-rtl`; `requireCocotbVenv(undefined, exec)` **PASSED**; `verifSim`/`verifRegress` **got past the gate** (`VERIF_E_RUN` later, i.e. no longer `VERIF_E_NO_VENV`); no-exec control still refuses with the host root (documented fallback preserved). **Falsifiability**: in an isolated copy with the pre-fix line restored → `requireCocotbVenv(undefined, exec)` THREW `VERIF_E_NO_VENV cocotb venv missing at /root/dshProj/.venv-rtl` and `verifSim` → `VERIF_E_NO_VENV` |
| **F2 (medium) hashline guard base** | **RESOLVED** | `index.ts:74` `const target = sessionPath(fp, dsh, exec)` (and the stored candidates likewise). Fixed tree: `tool-schema.test.ts` 5/5 pass, including "the guard resolves a RELATIVE file_path against the session workspace, not process.cwd()". **Falsifiability**: isolated copy with `resolve(fp)` restored → 4 pass / 1 fail, failing exactly that case (line 130). Legacy callers unaffected (`venvStatus()` / `requireCocotbVenv()` still valid — optional params; 309 tests green) |
| **F3 (low) AGENTS.md state root** | **RESOLVED** | `AGENTS.md:233` now names the session-workspace precedence + the agentless union + per-call/no-cache/no-chdir + the explicit overrides; `AGENTS.md:375` documents the `mpd-codegraph` apply-time exception. No new CJK added (the only 2 CJK lines are the pre-existing language-policy text) |
| **F4 (medium) packed artifacts** | **RESOLVED** | `dist/mpd-package/**` refreshed (mtime 12:15 > committed dists 12:10): packed verif carries `requireCocotbVenv(undefined, exec)`×2 / `venvStatus(override, exec)`×3 / `workspaceRootOf`×3, packed hashline carries `sessionPath(fp, dsh, exec)`×1, and each packed file is **byte-identical to its committed dist**. No verification/review step cites `dist/mpd-package/**` or `.qa-reloc/**` as current-tree evidence |
| **F6 (low) agentless path** | **RESOLVED** | My own unit proof (`repro-f6-agentless.log`): `workspaceRootsOf` returns the deduped union of live session roots and `[]` without a registry; `busyTeams(key,[A,B])` finds the record in both workspaces, a single root only its own, unrelated keys only theirs; no-roots falls back to the host root. Code assertions: service `rename`/`delete` use `roots ?? agentlessRoots(dsh)`, the tool path passes `[dsh.workspaceRoot(exec)]`. t13's live G1–G4 (isolation = sandbox HOME+DSH_HOME) agrees |
| **F5 (low) t8 counts** | **RESOLVED** | `probe_checks_pass_count=19 / probe_checks_total=19` in both t8 RESULT.json files; the surviving "18/18" strings are the explicit `count_correction` notes |
| **F7 (low) hygiene** | **RESOLVED** | `find evidence -type d -empty` → nothing; `.qa-tmp/**` carries a recorded KEEP decision (gitignored QA scratch) |

## 2. t7 acceptance criteria — all MET on this tree

1. Session-workspace root for every state root + the four reproductions — **MET** (t8 R1–R5; the F1 gap that made this unmet in round 1 is closed, proven above).
2. No plugin resolves its root with a bare `env ?? process.cwd()` — **MET** (grep: 0 matches outside the helper).
3. One resolution site, no harness-seam bypass — **MET** (`workspaceRootOf`/`workspaceRootsOf` in the adapter; no `ctx.tools|subagents|skills|agentPresets` use in plugin src).
4. workmate in-use gate scans the session team state — **MET** for both paths (tool: t8 W2–W8; agentless/service: my F6 unit proof + t13 G1–G4).
5. Mounting boot 0 apply-crash signatures + preset-conformance ok — **MET** (my own fresh boot on this tree: 0 signatures, probe ran to `DONE=ok`, 4/4 tools registered; my own `preset-conformance` PASS incl. its negative control).
6. Every touched dist consistent with its source — **MET** (my own rebuild: **16/16 byte-identical**).
7. `bun test packages`, `bun run typecheck`, `bun run test:qa` — **MET** (typecheck 0; **309 pass / 0 fail**; all 26 QA self-tests passed; vendor gate PASS).

## 3. Cumulative change set (t2–t7 + t12 + t13)

- B2: `VENDOR_LOCK` treeSha independently re-derived with the script's own algorithm (match), gate PASS, falsifiable (round-1 mutations; the failing asset no longer prints `asset OK`).
- B3/B4: fixes present in src **and** dist; negative controls reproduced (pre-fix source fails; pre-fix guard line fails; synthetic-lossy control reproduces the harness rejection in round 1). No array-typed schema anywhere in `packages/*/{src,dist}`.
- B5: real `mpd_comment_check` detection + clean pass; 0 skipped tests; bilingual README pair updated together with language-switch links.
- B6: provenance consistent with `package.json`/`LICENSE-NOTICES`/`feature-audit`; adopted upstream READMEs byte-unchanged.
- Rules: adapter seam holds; bundle patch/preset untouched; R8 clean (no `chdir`, no env mutation, no module-level root cache); agent-facing text English-only; human-facing docs bilingual in the same change.
- Residual intentional exceptions (documented, out of scope): `mpd-config` apply-time snapshot; `mpd-codegraph` apply-time root (env override available; AGENTS.md now documents it); MCP children are separate processes.

## 4. Non-blocking operational notes

- The running GUI process (started 10:58) still executes the pre-fix code: a **dsh restart is required** before in-session tool output can serve as proof of this fix.
- `dist/mpd-package/**` is gitignored and currently equals the committed dists; if t11 changes any dist, it must re-run `npm run pack` (already carried as an integration instruction).
- My mount runner's marker grep expected `[t14-probe]` while the copied probe prints `[t9-probe]`; the boot itself ran the full probe (0 crash signatures, `DONE=ok`). Corrected parse: `mount-boot-corrected-parse.txt` — a harness cosmetic issue in my own review tooling, not a product defect.

## 5. Review evidence index (all verifier-produced)
`gates-post-t13.log`, `repro-f1-fixed.{ts,log}`, `repro-f6-agentless.{ts,log}`, `f4-f6-f5-f7-checks.txt`,
`cumulative-rules-hygiene.txt`, `residual-checks.txt`, `final-exec-less-scan.txt`,
`preset-conformance-t14.log`, `mount/` (boot log + corrected parse), plus the round-1 tree under
`evidence/verification/t10-review/`.
