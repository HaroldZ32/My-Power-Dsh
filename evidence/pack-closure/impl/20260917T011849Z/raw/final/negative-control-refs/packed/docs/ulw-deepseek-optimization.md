# ULW deep-optimization for DeepSeek V4 + DSH (2026-08-27)

What was changed in the ultrawork loop stack (mpd-ulw-plugin + ulw-plan/ulw-execute/ulw-research
skills) to match DeepSeek V4 model properties and DSH harness architecture.

## Fixes

1. **Role personas now actually reach the child.** `PERSONAS.*` texts were passed as the spawn
   `persona` field, but DSH treats that field as a preset id — the role definitions were silently
   dropped. They are now folded into the child prompt head (byte-stable per role), and the spawn
   never sets `persona`. Verified by unit contract test.
2. **Foreign host layer removed from skills.** ulw-execute/ulw-research carried a whole
   "Codex Harness Tool Compatibility" section (`multi_agent_v1.spawn_agent`, `lazycodex-*`
   agent types, `fork_context`, `~/.codex/agents`, `codex:<session_id>`). Replaced with the DSH
   layer: `subagent`/`subagent_fork`, `job_output`, `send_message`, `job_kill`/`interrupt_agent`,
   `mpd_team_spawn`, preset ids as `persona`, and `dsh:<session_id>` (matching the boulder vendor
   normalization). ulw-plan's `$ulw-execute` references reworded to the DSH trigger phrasing.

## DeepSeek V4 optimizations

3. **Tiered model routing completed.** Planner, adversarial hyperplan wave, plan reviewer,
   verification (momus) and final quality gate all spawn with `deepseek-v4-pro`; execution rounds
   stay on `deepseek-v4-flash`. Pro carries the high-reasoning load where correctness is gated;
   flash (cheap, 2500 concurrency) carries exploration/implementation.
4. **Prefix-cache discipline.** The `DIRECTIVE` policy block remains the byte-stable prompt head
   for every execution round (DeepSeek V4 caches on prefix match); all mutable state moved to the
   prompt tail, and the durable state/ledger are referenced by path (`.mpd/ulw/<id>/state.json`)
   instead of being pasted — 1M context makes the file read cheap, and the cache stays warm.
5. **Compact handoff.** The per-round handoff is the last-3 round summaries instead of the whole
   recap (`reportText` removed); verification prompts reuse the same compact recaps.

## DSH architecture notes (kept/recorded)

- Fresh child per round via `subagents.start("spawn", ...)` (no parent history) — matches the
  DSH subagent seam; continuation of one child would use `send_message`.
- Hyperplan adversarial categories already run in parallel (`Promise.all`) — matches DSH
  background-job parallelism; no change needed.
- reasoning_content round-trip and thinking effort live in the `dsh-llm-deepseek` adapter layer,
  not in this plugin; per-request reasoning-effort tuning (e.g. low effort on flash execution
  rounds) is a host-side follow-up, not implemented here.
- Optional future: register ulw runs in the boulder ledger for cross-tool visibility
  (currently a self-contained `.mpd/ulw/<id>` state + ledger).
