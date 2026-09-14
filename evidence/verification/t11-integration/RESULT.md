# t11 — Integration: B7 team-record audit, evidence consolidation, final gates, commit plan

Member: Lead · attempt `07545b85-c395-454e-ad50-3fa72b08ddb1` · 2026-09-11

## Verdict: **PASS** (integration complete; nothing pushed, nothing tagged, no release branch)

Frozen tree: `dev` @ `98680b1fb2bbf5c10c28cfbe44419e91595e1cb7` (working tree = 40 tracked modified +
23 untracked paths, all listed verbatim in `git-status-verbatim.txt`).

---

## Part 1 — B7 `.mpd/team` audit (READ-ONLY)

Full inventory + operator procedure: `evidence/verification/t11-integration/b7-team-inventory.md`
(machine-readable: `b7-team-audit.json`).

- **19 non-archived records** (captain measured 18; the +1 is explained below), **6 archived dirs**.
- **READ-ONLY PROOF**: the whole `.mpd/team` tree hashed before and after the scan — 99 files,
  sha256 `f2a0f57a3e4f93d4b310624ce1ffeb5bf73b946a6b2e00d057f155934943e8e5` → identical, `unchanged=true`.
  Nothing under `.mpd/team` was created, modified, moved or deleted by this task.
- Breakdown: **1 ACTIVE** (`mpd-default-7332aba4`, this delivery's own team — do not archive) ·
  **1 STUCK** (`agent-teams-sidebar-migration`, `phase: running`, 10 tasks / 1 open, created
  2026-09-10, no live member sessions) · **1 STALE-WITH-OPEN-TASKS** (`mpd-default-84e50f06`, staged,
  8 pending, never ran) · **16 STALE-EMPTY** staged drafts with 0 tasks.
- **The +1 vs the captain's measurement**: `mpd-default-e35e7807` (staged, 0 tasks, created
  2026-09-11T03:51:32) was auto-provisioned by the session-start team policy when the **t8 verifier's**
  isolated probe boot started a turn in a session whose *workspace* is this repo (isolated `DSH_HOME`
  does not isolate `.mpd/team` — that follows the session workspace). Disclosed here; not deleted.
- **Why this matters**: the workmate in-use gate (`busyTeams()`) scans exactly these records
  (`<workspace>/.mpd/team/*/team.json`; `archive/**` has no `team.json` and is skipped), so every
  non-archived record whose `members[].name` sanitizes to a workmate key blocks
  `mpd_workmate_rename`/`mpd_workmate_delete` for that key. Measured in t8: a `lead` workmate rename was
  refused with 18 blocking `<teamId>/Lead` entries; archiving the stale records frees the roster keys.
- **Operator procedure (AgentTeams surface only — never edit `.mpd/team` by hand)**:
  1. Web GUI → **AgentTeams** tab; every record above is listed (archived ones only in the archived section).
  2. For the STUCK record: use the captain-chat **Stop team** control (`teamStopButton` in the shipped
     client) to cancel its unfinished task and stop member activations, then end/archive it.
  3. For the 16 STALE-EMPTY drafts and `mpd-default-84e50f06`: end/archive each team. The captain tool is
     `agent_teams_delete` — "End and archive your team: interrupts members and moves the current tasks and
     mailboxes out of active state for later inspection"; a same-name archive replaces its previous generation.
  4. Alternative: **retire** members (`agent_teams_remove_member` → ids recorded in
     `.mpd/team/retired-members.json`, dropped from `team.json`) — that also unblocks those keys while the
     record stays for inspection.
  5. Do **not** archive `mpd-default-7332aba4` while this delivery is running.

## Part 2 — Evidence consolidation

Full audit: `evidence-consolidation.md`. Every in-scope case directory for t2–t9 (plus t12/t13/t14) is
**COMPLETE** (result file + raw outputs): `evidence/hashline/schema-union-fix`,
`evidence/fix/verif-tool-lossless/20260911T030646Z`,
`evidence/agent-teams/provenance-version-align/20260911T032030Z`,
`evidence/session-workspace-root/{b1-resolution,dist-repair,t8-verify,attempt-2,attempt-2/repair-t13}`,
`evidence/verification/{t9-b2-b6/20260911T033622Z,t14-review}` and both captain-named
`evidence/dsh-qa/preset-conformance/2026-09-11T03-0*` dirs. Whole-tree scan: **0 empty directories**.

- **F-cons-1 (info)**: **t2 and t5 wrote no standalone evidence directory.** Their proof survives in their
  task completion outputs (team record) and in t9's independent re-derivation
  (`evidence/verification/t9-b2-b6/20260911T033622Z/{b2-verify-vendor.log,b2-mutation-fresh.log,b2-mutation-raw.log,b5-preprovision-skip.log}`).
  Reported, not patched — no artifact was created or removed.
- **F-cons-2 (info)**: `evidence/fix/typecheck-baseline/2026-08-27T13-14-57.802330615Z` has a result but no
  raw log, and `evidence/agent-teams/sidebar-migration/final-2026-09-10T06-21-45Z/live-gui` is a supporting
  sub-tree of a complete case. Both predate this delivery and are outside t2–t9 scope.
- The captain's deliberately removed partial dir (`…/preset-conformance/2026-09-11T02-51-22.844Z`) is absent
  as intended — **not** reported as missing.

## Part 3 — Final gate sweep on the frozen tree (raw in `gates/`)

| Gate | Exit | Raw result |
|---|---|---|
| `node scripts/verify-vendor.mjs` | 0 | `[verify-vendor] commit OK: 8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29`; `version OK: 5.0.0-beta.20`; `stats OK: 9131 files / 1470231 loc`; `asset OK: skills 365 files`; `asset OK: packages/mpd-agent-teams-plugin/_deps 635 files`; 4× MCP dist assets OK; **PASS** |
| `bun run typecheck` | 0 | `tsgo --noEmit` clean |
| `bun test packages` | 0 | **309 pass / 0 fail**, 2032 expect() calls, 35 files (12.94s) |
| `bun run test:qa` | 0 | `[test:qa] all self-tests passed` |
| `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` | 0 | install/composed/boot/noHomeCopy/layerDurability/uninstall all ok → **PASS** |
| `node skills/dsh-qa/scripts/preset-conformance.mjs` | 0 | `ok=true`, sessionCreate ok, sessionHeader ok, bootLog signatures `[]`, negative control ok → **PASS** |
| mounting boot (`run-toolcall-proof.mjs`, isolated DSH_HOME+HOME, launch cwd `/root/dshProj` ≠ session workspace) | 0 | **19/19 checks PASS (18 probe markers + the driver's `X1_TEAM_STATE_READ_ONLY`), 0 apply-crash signatures**, probe DONE, evidence `evidence/session-workspace-root/t8-verify/2026-09-11T04-27-19Z-toolcall/` |

### Addendum — final green snapshot, re-derived (not cited) after t14 PASSED

Raw: `final-green-snapshot.txt` (tree `98680b1`, branch `dev`).

| Check | My re-derived result |
|---|---|
| `node scripts/verify-vendor.mjs` | exit 0 — commit/version/stats OK, `asset OK: skills 365 files`, `_deps` 635 files, 4× MCP dist assets OK, **PASS** |
| `bun run typecheck` | exit 0 (`tsgo --noEmit`) |
| `bun test packages` | **309 pass / 0 fail**, 2032 expects, 35 files (12.50s) |
| 16-package dist sweep (my documented method) | **FRESH=16, STALE=0** — all byte-identical to a fresh build |
| t8 attempt-2 probe | **19/19 checks PASS**, 0 apply-crash signatures, `probeReachedFinalMarker=true` |
| empty evidence dirs | **0** |

Two sha256 shifts vs my attempt-2 report are explained and benign: `mpd-hashline-plugin` dist
`7152de89783e4018 → 8359fc944661ff03` and `mpd-verif-plugin` dist `2958504a65f4603d → b4b702c5cbd9847a`,
because t13 changed those two sources afterwards (hashline `registered()` base, verif cocotb-gate exec
threading) and rebuilt them. Both still sweep as FRESH, i.e. dist == source; not drift.

## Part 4 — Commit plan

Full plan (file-by-file grouping, order, hard rules, non-committed artifacts):
`evidence/verification/t11-integration/commit-plan.md`.

Recommended branch **`fix/bline-b1-b6`** from `dev`, 8 atomic commits, `<type>(<scope>): <summary>`:
1. `fix(adapter): resolve the workspace root from the calling session`
2. `fix(bline): follow the session workspace in boulder, config, comment-checker, memory, modelchain, ulw and workmate` (+ the four dependent dist rebuilds + `evidence/session-workspace-root/**`)
3. `fix(verif): session-scoped roots and lossless backend JSON` (B1 verif + B3, one package/one dist)
4. `fix(hashline): session-scoped paths and a oneOf lines schema` (B1 hashline + B4)
5. `fix(vendor): derive the skills re-pin and stop reporting a failing asset as OK` — **`scripts/verify-vendor.mjs` + `VENDOR_LOCK.json` + `skills/dsh-qa/scripts/workmate-library.mjs` + `evidence/verification/t9-b2-b6/**` in ONE commit**
6. `docs(comment-checker): document the sanctioned .toolchain provisioning` (B5 README pair)
7. `docs(agent-teams): pin the adopted provenance version and document the session-root rule` (AGENTS.md)
8. `test(qa): record the B1-B6 verification and integration evidence`

Nothing was pushed, no tag, no release branch; no commit was created (plan only).
`git status` verbatim (HEAD, branch, porcelain, human form, diffstat): `git-status-verbatim.txt`.

## Carry-forward findings (none fixed here)

- **B8 (open)**: ast-grep and codegraph MCPs are unusable in this deployment — `MPD_AST_GREP_SG_PATH` is
  unset (it lives in `/root/.mpd/mcp.env`, needing a manual `source`), and the patch fallback
  `<profile>/node_modules/.bin/sg` does not exist for a `link:` install → live `BINARY_NOT_FOUND`.
- **B9 (open)**: `scripts/install-profile.mjs` declares 21 row ids vs the bundle patch's 22; the only
  difference is `mpd-verif`, so a legacy-installer profile mounts no `mpd_verif_*` tool (t9 F4 confirmed).
- **Contract matcher (tooling, adopted-plugin territory)**: the update gate does not expand `**`, so
  `changedPaths` was incomplete for t3, t4 and t7 (declared-but-unmatched lists recorded in those outputs).
  Report only — do not patch.
- **Split-brain memory store (open, user decision)**: plugins now write the correct
  `agent-my-power-dsh` root; the 7 entries under `/root/dshProj/.mpd/memory/agents/agent-dshproj` are
  orphaned. Migration deliberately NOT done (user data).
- **Release checklist**: (a) any `skills/**` edit needs its own re-pin + gate evidence in the same commit;
  (b) the B5 `.toolchain` binary is gitignored, so a fresh clone silently skips 3 comment-checker tests
  instead of failing.
- **Pack artifact (closed, corrected state)**: when the brief was written `dist/mpd-package/` held pre-fix
  bytes; **t13 re-ran `npm run pack` as part of its acceptance**, so the gitignored tree is now current.
  My own spot-check confirms 8/8 sampled packed dists byte-identical to the committed ones and carrying
  the repaired adapter (`workspaceRootOf` present), and t14 additionally verified the packed verif dist
  carries `workspaceRootOf` + `requireCocotbBenv(undefined, exec)` and the packed hashline carries
  `sessionPath(fp, dsh, exec)`. **No pack re-run was needed during integration** (no dist changed);
  re-run `npm run pack` only if a dist changes afterwards. No pre-fix bytes were restored anywhere.
- **Contract-generation defect (tooling, open)**: the repair task's auto-generated contract listed
  `AGENTS.md` in BOTH its inScope and its out-of-scope list; the update gate then rejected that edit as
  `out_of_scope` while the same contract's acceptance text REQUIRED it. Same family as the `**` matcher gap.
- **Captain cannot read a running task's contract (tooling, open)**: no tool exposes it, which is the
  structural root of this wave's four "declared-but-unmatched" completions (t3, t4, t7, t13). One-line
  tooling gap with real auditability cost.
- **R1 (low, open, deliberately unscheduled)**: `packages/mpd-verif-plugin/src/regress.ts` creates its
  regress work dir BEFORE the cocotb iron gate, so a NO-SESSION `mpd_verif_regress` surfaces a host-root
  `ENOENT mkdir` under `VERIF_E_RUN` instead of the actionable `VERIF_E_NO_VENV`. Session-scoped calls are
  unaffected. Not fixed during t14 to avoid moving the tree under the reviewer; no task was scheduled.
- **O-1 (low, from t8)**: `packages/mpd-codegraph-plugin/src/index.ts:76` keeps its apply-time
  `MPD_CODEGRAPH_PROJECT_CWD || process.cwd()`; now documented in AGENTS.md §12 as a listed follow-up.
- **Live-process caveat (restated)**: the running GUI process still executes PRE-FIX code (it loaded the
  old dists at boot). Every proof above comes from isolated boots; in-session tool output is only the
  "before" control until `dsh` is restarted (restart required before citing any live tool output as proof).
