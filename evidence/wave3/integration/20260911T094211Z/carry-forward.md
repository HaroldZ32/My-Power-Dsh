# Wave-3 t8 — carry-forward list (what is still open after wave 3)

Every wave-2 item is accounted for below (closed / still open / user-side), plus the wave-3 items
that surfaced during implementation, review and integration. Nothing is silently dropped.

## 1. Wave-2 items closed by wave 3 (22-item list, all accounted for)

| # | Wave-2 item | Severity | Status | Closed by |
|---|---|---|---|---|
| 1 | F4-class `tools.js` strip-heal fidelity (60 diff lines) | medium | **CLOSED** | t2 registry redesign (context pair); verified independently by t5 (strip BOTH files, one heal, 0 diff lines each) and t10 round 2 |
| 2 | Guard marker search prefix-ambiguous for 3 delta pairs | medium | **CLOSED** | t2 whole-line marker comparison + one fixture per colliding pair (t5: 12/12 checks) |
| 3 | `agent_teams_setup` onboarding + roster provenance unused | low | **STILL OPEN** | not in the wave-3 groups (analysis only); recorded at `evidence/agent-teams/provenance-version-align/` |
| 4 | Inherited `.gitignore` inside `_deps/**` hides files from `git status` | low | **STILL OPEN** | not in the wave-3 groups; cosmetic (the closure is vendored and excluded by the lock) |
| 5 | Missing `attempt_id` misreported as stale ownership | medium | **CLOSED** | t2 (branch on omission first); t5 behavioural repro through the real tool |
| 6 | Oversized payload silently dropped the trailing parameter | medium-high | **CLOSED AS A CONTRACT GUARD** | root-caused MODEL-SIDE (t1, re-derived by t5 from the persisted raw fragment streams); `status` is now REQUIRED so the omission is loud. Residual below |
| 7 | `preset-register.mjs` devPatch keeps the `/node_modules/` operand | medium | **CLOSED** | t3 |
| 8 | `rtl-verif.mjs:69-77` duplicates that devPatch | medium | **CLOSED** | t3 (single shared helper) |
| 9 | `preset-register.mjs` pre-pins the two keys B8 removed (`.bin/sg` wrapper) | medium | **CLOSED** | t3 (caller-pin removed from the QA harness) |
| 10 | `codegraph-smoke.mjs` pins `MPD_CODEGRAPH_BIN` — documentation gap | low | **CLOSED** | t3 (the case now says in its own docs that it pins the binary on purpose) |
| 11 | Skills re-pin coupling (group deferred so the re-pin happens once) | medium | **CLOSED** | t3: exactly ONE re-pin for wave 3 (`skills` 366 files / `3259d07a…`, from wave 2's `5b13e920…`), audited by t6 |
| 12 | F-B8-1 codegraph dies with uncaught `ENOENT: mkdir '<home>/.mpd/codegraph'` | medium | **CLOSED** | t4: the adopted provisioning path degrades to "unavailable" instead of throwing (mount + launcher evidence in `evidence/wave3/codegraph-degrade-and-applytime/`) |
| 13 | F-QA-2 `web-client-adapt` 60 s boot deadline too tight | low | **CLOSED** | t3 (adaptive/load-aware deadline; `bun run test:qa` green on the frozen tree) |
| 14 | F-ENV-1 `mcp-call` spawns dsh with the REAL HOME | low | **CLOSED** | t3 (sandbox HOME for the spawn, on top of wave 2's `settings.yaml` copy) |
| 15 | `dual-track-smoke.mjs` could not boot (`ERR_MODULE_NOT_FOUND @mpd-dsh/mpd`) | medium | **CLOSED** | t3 (boot repaired; `bun run test:qa` green) |
| 16 | Wave-1 items closed in wave 2 | — | n/a | for the record only |
| 17 | O-1: `mpd-codegraph` resolves its project root at APPLY time from `process.cwd()` | medium | **CLOSED** | t4 (project root routed so an explicit override still wins; apply-time boot evidence in the wave-3 codegraph directory) |
| 18 | Process: each bash call gets a FRESH `/tmp` | low (process) | **CLOSED** | t8: `AGENTS.md` §12 row |
| 19 | Process: a plugin-module edit is NOT hot-reloaded into a loaded process | low (process) | **CLOSED** | t8: `AGENTS.md` §12 row (+ the measured wave-3 instance) |
| 20 | Process: "reverted" is not instantaneous — verify on settled hashes | low (process) | **CLOSED** | t8: `AGENTS.md` §7 bullet |
| 21 | USER ACTION: archive two isolation-control team records | user-side | **OPEN — USER MUST ACT** | `mpd-default-0bc1738e` (captain `session-13638987-…`) and `mpd-default-587132ea` (captain `session-8954c880-…`) in the AgentTeams tab; no agent may perform it (writing `.mpd/team` is forbidden) |
| 22 | USER ACTION: restart `dsh` for adopted-plugin semantics | user-side | **OPEN — USER MUST ACT** | a live session keeps the module it loaded; the new `update_task` diagnostics and every adopted-plugin change act only after a restart (t5 measured the stale-live-session case) |

## 2. Wave-3 items that remain open

1. **USER ACTION — `~/.mpd/mcp.env` may still bypass B8's resolution chain. — medium.**
   If that file is sourced by the user's shell, it pins `MPD_AST_GREP_SG_PATH` to the deprecated
   `.bin/sg` wrapper, and the launcher's caller-pin-wins rule then SKIPS B8's own chain (which
   correctly rejects the wrapper because `--version` exits 1). The QA harness no longer pins it
   (t3), but a user profile can. Fix by editing the user's own file to point at an `ast-grep`
   binary (or removing the line); no agent may edit a file outside the repository.
2. **Residual of DEFECT 6: a model-side omission of `output`/`changedPaths` stays
   undetectable by the plugin. — low, stated not hidden.**
   The REQUIRED `status` parameter makes the trailing-key loss loud, and the tool description tells
   the caller to split a large payload and end with a minimal
   `{task_id, status, attempt_id[, verdict]}` call; nothing inside the plugin can size-check a
   payload that was never emitted (t5's raw-stream repro). Bound by splitting, not fixable in code.
3. **`agent_teams_setup` onboarding + roster provenance — low** (wave-2 item 3, still open).
4. **Inherited `.gitignore` inside `_deps/**` — low** (wave-2 item 4, still open).
5. **`check5-mount.sh` driver convention — low (informational, t10).** The mount driver resolves its
   probe from `$EV/drivers`, so re-running it with a bare `EV_OUT` fails loudly; stage a `drivers/`
   copy when re-running (t5's driver in `evidence/wave3/t5-verify/…/drivers/` follows the same
   convention and documents it).
6. **Widen R1's packed-artifact assertion to the launchers + `skills/dsh-qa` scripts — low (t10
   informational).** The packed-artifact gate currently asserts the plugin dists; the pack now also
   normalizes modes and ships `launch.mjs`/`bin-resolve.mjs` (verified byte-identical and 644/755 by
   t8's pack check) — a permanent assertion in the R1 sweep would lock that in.
7. **Two cosmetic empty directories under t4's evidence** —
   `evidence/wave3/codegraph-degrade-and-applytime/20260911T081649Z/mcp-run/{home/.mpd,project}`.
   Reported, not deleted (another agent's artifact).
8. **The whole three-wave layer is still UNCOMMITTED.** The reconciled plan
   (`commit-plan.md`) assigns every path; nothing is staged/committed/pushed by this task. Whoever
   executes the plan must also stage the untracked layer (`lib/mpd-deltas.js`,
   `scripts/patch-agent-teams-fixes.mjs`, the new tests, `skills/dsh-qa/scripts/lib/workspace-isolation.mjs`,
   `packages/mpd-mcp-*/launch.mjs`, `packages/mpd-mcp-shared/**`) — the byte-fidelity guarantee is
   permanent only once committed.
9. **`AGENTS.md` §6's "9 regions" paragraph** was stale (the registry now holds 12 with the wave-3
   regions); corrected by t8 in the same documentation change.

## 3. Post-wave-3 items and later-measured defects (from t6/t7/t10 + the captain's brief)

1. **R2 — legacy installer bypasses B8 and re-pins the deprecated wrapper. — medium.**
   `scripts/install-profile.mjs:62-63,82-83,94-96` still writes profile rows that call the MCP
   servers directly (no launcher) and pre-pins `MPD_AST_GREP_SG_PATH` to the deprecated
   `.bin/sg` wrapper plus `MPD_CODEGRAPH_BIN`. The legacy flow therefore reproduces the exact
   condition B8 removed. Not fixed in wave 3 (out of its groups); the primary `dsh plugin add`
   flow and the packed install are unaffected.
2. **R3 — the live-LLM lanes are an EVIDENCE GAP, not a green. — medium (honesty item).**
   This box has no LLM credential (`llm-deepseek: {}`, no env var, and the credentials file holds
   only a browser-session record), so the live-LLM lanes of `dual-track-smoke`, `mcp-call` and
   `codegraph-smoke` could not run here. Their offline `--self-test` legs pass inside `bun run
   test:qa`; the live lanes must be re-run on a credentialed machine and must never be reported as
   green from this environment.
3. **R5 — `dsh.hasTool` returns false for a working MCP tool at apply time. — medium (trap).**
   Never gate MCP registration on `dsh.hasTool`; registration is decided by the tool registry that
   is still being composed. (The wave-3 mount probes read the live registry after a settle window,
   which is why they can see all 14 adopted tools.)
4. **The reconciled commit plan is unexecuted (R4 above).** Until it lands, HEAD stays broken from a
   fresh clone for the MCP rows and the vendor path, and the byte-fidelity guarantee stays
   uncommitted.
5. **N1 — the applier's own docstring overstates the drifted-orphan hazard. — low, DOCUMENTATION
   ONLY, and it must NOT be fixed before the commits land.**
   `scripts/patch-agent-teams-fixes.mjs` lines ~355-362 (the `driftedOrphanError` JSDoc, t10 cited
   355-361) still says that dropping the orphan begin marker and healing from context "would delete
   that authored text". That is the same overstated claim wave 3 already corrected elsewhere
   (evidence README + result.json). t10's mechanism is sharper: the surviving body BLOCKS the seam,
   so the drop+heal path cannot succeed in that shape at all — it fails the `beforeContext`
   assertion — and had it ever succeeded, the authored lines would REMAIN alongside a re-inserted
   block, i.e. the hazard is a **misdiagnosis/duplicate, not deletion**.
   **Why it must not be fixed now:** `scripts/patch-agent-teams-fixes.mjs` is a file t10 REVIEWED and
   PASSED (reviewed revision sha256 `fa696421135f7fb816c7a015821bdab2995996528c0fe219d105c00dc353ca8f`).
   Editing it would invalidate that review's revision and force a re-verification — the moving-tree
   hazard this wave enforced against from the start (wave 2 lost a whole verification pass to it).
   The pack and the commit plan therefore describe the REVIEWED revision. Fix it in a later,
   separately reviewed change (the script is development-only and is NOT part of the packed
   artifact).
6. **`mpd-comment-checker-plugin` false-clean — reproduced by the captain.** `mpd_comment_check`
   returned `clean` for a NONEXISTENT path; its own suite cannot catch it because every case passes
   explicit `content` and `skipIf` hides a missing binary. Needs its own scoped fix + mount proof
   (standing rule: record it, do not fold it into an unrelated change).
7. **`agent_teams_create_task` refuses a legitimate repair — reproduced twice.** A `kind=repair`
    task on its own source task's paths was refused with `inScope overlaps t4 at …` although t4's
    inScope is codegraph-only and every non-terminal task had `inScope: null`; the suggested
    serialization cannot produce a correct schedule here. The review gate's automatic repair loop
    was the only workable mechanism; never work around it by editing `.mpd/team`.
8. **Pending user-requested model-route standardization — user-driven, not started.** Checkpoint §9:
    specialists on `deepseek-flash` + `reasoning_effort: max`.
