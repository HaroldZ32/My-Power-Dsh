# t20 handover (from `agent-teams-engineer`, 2026-09-17) — for `watchdog-engineer`

Written at the captain's request. I claimed `t20` (attempt 2, `2a1afa81`) and then reported a
capacity bound BEFORE editing: this session had already carried t9 + t14 + t19 end-to-end. **I
touched no file for t20**; the tree is green as of the handover (suite 233/0, `--check` 65 regions
clean, typecheck 0). The captain moved t20 to you; I am not touching it again.

## The five lines

1. **In-scope files:** `lib/tools.js`, `lib/quality-gates.js`, `lib/state.js`, `lib/mpd-deltas.js`
   (plus `self-fix-tests/**` and `evidence/agent-teams/ownership/**`). NOT in scope and therefore
   NOT available for a new tool: `lib/tool-names.js` and `lib/capabilities.js` — a brand-new
   `agent_teams_*` tool cannot be registered from this task. **Extend an existing tool instead:**
   `agent_teams_status` is registered with `parameters: {}`, so an optional `path` parameter (the
   preflight `who owns <path>` surface) is purely additive, and it is the natural captain/member
   read surface.
2. **The overlap refusal anchor:** `lib/quality-gates.js` — the refusal text `inScope overlaps <id>
   … serialize these tasks or split the paths` lives in the caller of `pathMatchesScope` (the
   `:493-510` window the contract cites). It already NAMES the owning task; what it does not do is
   name the REPAIR. Add the repair to the message and the acceptance's first row is satisfied.
3. **The repair primitive already exists (from t14):** `agent_teams_update_task` with
   `amend: { inScope: [...] }` moves a path on an EXISTING task — it keeps the task id, needs no
   remove+re-add, and (since t14) works on a member-owned in-flight task without a takeover. So
   T-01's remaining work is *discoverability* (query before create + the refusal naming the repair),
   plus a test that proves the move; not a new verb.
4. **The `--write-registry` trap (I tripped it once, the heal suite caught it):** ANY edit to a
   region body — even one line — leaves `lib/mpd-deltas.js` stale until
   `node scripts/patch-agent-teams-fixes.mjs --write-registry`; then `--check` must be clean. Also
   measured: **two regions with the SAME id in ONE file break the applier's per-id lookup**
   (`--check` reports the region as drifted) — use distinct ids in-file; duplicate ids are only
   intended ACROSS files.
5. **My `t36` pre-recon lives in two places:** `.mpd/plans/friction-p1-wave.md` §8 **L20** (the
   accepted diagnosis, captain-recorded) and my message record; the route is
   `scheduler.js:557` (ownedOpenTask, correct at the instant) → `:574-575` `recoverOwned` →
   `:581-585` (the owned branch SHORT-CIRCUITS `nextCapableTask`/`isTaskReady`) → `:598`
   `beginTaskAttempt` → `state.js:167-176` `activateTaskAttempt`, which mints a fresh attempt **and
   clears `task.output`** (the second deliverable-loss vector I reported in t19; it makes T-46's
   guarantee depend on t36).

## Two extras that will save you time

- **Assert a tool call's effect on its RETURN value**, not on the disk record: the tool's own
  post-lock `kickTeam` can re-dispatch the task afterwards (`recoverOwned`) and clear fields.
  Likewise re-read the live `attempt_id` between calls instead of a fixture literal.
- **Test fixtures that call these tools:** the member agent's live `status` decides whether the
  kick re-dispatches; a `busy` member makes the kick decline ("running the turn of an attempt it
  already owns"), which isolates your edit's own effect.

Anchors of the current green state: `evidence/agent-teams/deliverables/20260917T015207Z/settled-hashes.txt`
(tools.js `b0547996…`, members.js `b1b1ac53…`, mpd-deltas.js `0e8cb8c4…`) and `gates.json`.
