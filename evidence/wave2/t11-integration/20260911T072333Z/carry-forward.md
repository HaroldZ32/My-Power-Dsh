# Wave-2 t11 — carry-forward list (what is still open after this wave)

Each item names its severity, why it was not fixed in wave 2, and what the next wave must do.
Nothing here is silently dropped; several are deliberate deferrals with the captain's ruling recorded.

## A. Adopted agent-teams tooling (the delta/registry machinery)

1. **F4-class `tools.js` heal fidelity — medium — DEFERRED BY CAPTAIN RULING (wave 3 owns the redesign).**
   A full strip-heal of `packages/mpd-agent-teams-plugin/lib/tools.js` does not reproduce the canonical
   file: `mpd-delta task-contract` heals at line 1970 instead of 1733 (60 diff lines) while both guard
   passes exit 0. `quality-gates.js` IS byte-faithful (`check4e identical:true, diff_lines:0`), which is
   what t8 attempt 3 verified under the captain's re-scope.
   **Measured cause (Senior Engineer, t15):** the region block carries a copy of its own anchor line,
   so after an insertion the recorded occurrence resolves to the wrong copy and every later insert
   shifts the counts the next region was registered against — ANY line-keyed rule (unique text,
   occurrence index, marker) is therefore order-dependent. Four approaches were measured and failed
   (self-anchoring wrap; last-unique-line anchor → half-open marker pair; verbatim mint; emitter
   storing the picker's occurrence).
   **Fix:** a REGISTRY FORMAT change, not a repair — key insertion on a before/after context PAIR
   unique in both directions, or content-anchor on `name: 'agent_teams_task_contract',` and walk
   outward to the enclosing register/close pair. Analysis + raw runs:
   `evidence/wave2/adopted-tooling-repair-f4-sibling/README.md`.
   Unreachable in normal operation (nothing strips regions day to day) and it cannot affect the live
   tree — which is why the captain re-scoped it out of wave 2's verdict rather than blocking the close.
2. **Guard marker search is prefix-ambiguous for 3 delta pairs — medium (NEW, t10 review F1).**
   `scope-overlap` ⊂ `scope-overlap-normalize`, `repair-scope` ⊂ `repair-scope-fields`,
   `task-contract` ⊂ `task-contract-render`: a partial strip of the OUTER region yields a misdiagnosed
   `half-open marker pair` and refuses to heal. Fix: whole-line marker comparison + one fixture per pair.
3. **`agent_teams_setup` onboarding + roster provenance — low.** Upstream's `setTaskPlanning`/`setup`
   surface is unused by our profile wiring; recorded in `evidence/agent-teams/provenance-version-align/`.
4. **`inherited gitignore` inside `_deps/**` — low.** The vendored closure still carries its own
   `.gitignore`, which hides files from `git status` inside the adopted tree.

## B. `update_task` diagnostics (adopted plugin; t4's area is terminal)

5. **A missing `attempt_id` is reported as STALE ownership — medium, actively misleading.**
   `lib/tools.js:1525-1526`: `if (task.attemptId !== undefined && args.attempt_id !== task.attemptId)`
   → an OMITTED id (undefined) also compares unequal and prints "stale attempt for task <id> … stop work
   and request fresh assignment". Measured on t6 (its own note records obeying the message while the
   state was current) and it cost the captain a reassign cycle. Fix: branch on
   `args.attempt_id === undefined` first and say "attempt_id is required"; keep the stale wording for a
   genuine mismatch. The check is member-only, so a captain never hits it.
6. **An oversized `update_task` call silently drops the trailing parameters — medium-high (silent).**
   The completion call carried `acceptanceResults + changedPaths + commandsRun + output + task_id +
   attempt_id + status`; everything except `status` persisted and the tool returned `→ in_progress`
   with the payload written. The gate falls back to the persisted payload
   (`quality-gates.js:588/596/604`, `update.X ?? task.X`), so a minimal follow-up completed it cleanly —
   but a member can believe it completed while the task stays `in_progress` and a scheduler waiting on
   that terminal state never fires. The plugin's handler does no size handling, so the trigger is
   upstream of the tool (harness argument serialization is the prime suspect) and needs root-causing.

## C. QA-harness fidelity under `skills/**` (deliberately NOT fixed in wave 2)

7. **`preset-register.mjs` devPatch keeps the `/node_modules/` operand — medium.**
   `devPatch()` rewrites `@mpd-dsh/mpd/` to an absolute checkout path but leaves the
   `+ "/node_modules/"` operand, so rewritten MCP row args become
   `<baseUrl>/node_modules/<checkout>/packages/mpd-mcp-astgrep/launch.mjs`. It resolves only because
   `mcpEnv()` pre-sets `MPD_DSH_ASTGREP_CLI` / `MPD_DSH_CODEGRAPH_CLI`.
8. **`rtl-verif.mjs:69-77` duplicates that devPatch (two-site defect) — medium.**
   Same defect, second independent source of the same false red; its own `mcpEnv()` pins only the four
   `MPD_DSH_*_CLI` keys.
9. **`preset-register.mjs:43-45` still pre-pins the two keys B8 removed — medium.**
   `MPD_AST_GREP_SG_PATH=<repo>/.toolchain/node_modules/.bin/sg` — the DEPRECATED wrapper that fails
   `--version` (exit 1; `ast-grep --version` exits 0 printing `ast-grep 0.45.3`) — plus
   `MPD_CODEGRAPH_BIN`. Under the new launcher's caller-pin-wins rule a dev boot never exercises B8's
   real resolution chain. Single-site (defect 3), while 7/8 are a two-site duplication of one helper.
10. **`codegraph-smoke.mjs:36` pre-sets `MPD_CODEGRAPH_BIN` — documentation gap only.**
    ADJACENT, not a defect (captain ruling): that case exists to exercise the codegraph binary, so
    pinning it is legitimate — the case must SAY SO IN ITS OWN DOCS so its green is not read as proof
    that the bundle's resolution chain works. The distinction: pinning a thing you are testing is fine;
    pinning the thing you are testing INSTEAD of testing it is the defect.
11. **Why this group was deferred:** the `skills/**` owner (t7) is terminal and any further edit would
    have invalidated the VENDOR_LOCK re-pin t11 performed. Next wave fixes 7–10 TOGETHER WITH their own
    `VENDOR_LOCK.json` re-pin. **Systemic theme worth one line in the report:** several gates here were
    manufacturing their own pass — wave 1's `gate-sweep.mjs` driving a shipped artifact, t7's unmasked
    `mcp-call.mjs`, and these devPatch/pin sites.

## D. Runtime / environment defects found while verifying

12. **F-B8-1: codegraph dies with an uncaught `ENOENT: mkdir '<home>/.mpd/codegraph'` — medium.**
    With codegraph unresolvable (packed `file:` install, no `.toolchain`, not on PATH) AND
    `$HOME/.mpd` unwritable, the adopted provisioning path throws instead of degrading to
    "unavailable". NEWLY REACHABLE after B8 removed the patch's `MPD_CODEGRAPH_BIN` pin, which used to
    short-circuit that path. Reproduced live at t11: the fresh pack's
    `dist/mpd-package/packages/mpd-mcp-codegraph/launch.mjs:27` → `serve.js` `acquireLock` →
    `mkdir '/root/.mpd/codegraph'` ENOENT (7 occurrences in the frozen-tree mcp-call log), and the
    sandbox's `/root/.mpd` is genuinely read-only (`touch` → "Read-only file system"). Fix next wave:
    the adopted path degrades instead of throwing + QA HOME isolation. Pointer:
    `evidence/wave2/t9-verification/20260911T061339Z/t9-RESULT.json` findings[1].
13. **F-QA-2: `web-client-adapt` is timing-sensitive — low.** A hard 60 s deadline for the boot to
    print its auth token (`web-client-adapt.mjs:154 bootDeadline`). Under concurrent load the token
    arrived at ~69 s → red twice (06:21:10Z, 06:30:49Z, identical 5-line boot log); solo re-run at
    06:33:32Z PASSED. Not a wave-2 regression; needs a longer/adaptive deadline or a load-aware retry.
14. **F-ENV-1: `mcp-call` spawns dsh with the REAL HOME — low (half the cause fixed at t11).**
    The case copied only `.credentials.yaml`; t11 added the `settings.yaml` copy (§7 requirement). The
    HOME half remains: the spawn inherits the real `HOME`, and the case's `DSH_HOME` sandbox does not
    bound everything a HOME-resolved path can touch (the workmate library is the documented HOME
    consumer). Next wave: give the spawn a sandbox HOME too.
15. **`dual-track-smoke.mjs` still cannot boot — medium (pre-existing).** `ERR_MODULE_NOT_FOUND
    @mpd-dsh/mpd`: it passes the committed patch without staging the package, so t7's isolation fix is
    INERT there until that boot is repaired. Do not read its red as an isolation failure.

## E. Wave-1 items carried in and now closed by wave 2 (for the record)

16. **CLOSED:** the `**` matcher defect (t4/t13/t14, verified by t8 attempt 3 + t10 review); the
    contract-generation contradiction (same lineage); B8 binary resolution (t6 + t9's 20/20 gate);
    B9 installer row parity (t2 + `verify:rows`); R1 gate ordering (t3 + t12); QA workspace isolation
    (t7 + t9's control); the 7-entry memory migration (t5 + t9).
17. **Still open from wave 1:** **O-1** — `mpd-codegraph` resolves its project root at APPLY time from
    `process.cwd()`/`MPD_CODEGRAPH_PROJECT_CWD`, not from the calling session's workspace (§6 State,
    §12 codegraph row). t6 touched the neighbouring `.toolchain` candidate but deliberately did NOT
    route the root through `dsh.workspaceRoot()`; it remains a listed follow-up
    (`evidence/session-workspace-root/t8-verify/attempt-2/repair-t13/`). Severity: medium.

## F. Process notes (cost the wave real time; recorded so the next wave does not rediscover them)

18. **Each bash call gets a FRESH `/tmp`** — a path written in one call does not exist in the next.
19. **A plugin-module edit is NOT picked up by an already-loaded process** (no hot reload): every
    repaired adopted-tooling semantic needs a **dsh restart** before it acts on a live session. All
    wave-2 claims about that code are module-level or mounted-boot results, never live-gate results.
20. **"Reverted" is not instantaneous.** t11's first verification pass ran while the t15 revert was
    still in flight and measured a half-open-marker failure on an intermediate revision; the results
    were discarded and the whole contract re-run on the settled hashes after a 50 s stability check.
    A verification started 30 s earlier would have measured a broken tree.

## G. User actions (not code work)

21. **Archive two real team records** in the AgentTeams tab: `mpd-default-0bc1738e` (t7's isolation
    negative control, captain `session-13638987-…`) and `mpd-default-587132ea` (t9's isolation negative
    control, captain `session-8954c880-…`). Both are 11-member boot-style records with 0 tasks; they
    are the controls that PROVED the isolation defect was real, left in place on purpose.
22. **A dsh restart** is required for anything in this wave that touches adopted plugin code
    (agent-teams deltas) to act on a live session; see §19.
