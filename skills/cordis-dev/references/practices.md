# Plugin practices (harness mechanisms)

Confirm every Service method, Event name and dispatch mode named here with `cordis_inspect_query`
(`Service`, `Event`) before relying on it — the installed harness is the authority.

## Principles

1. **The session log is the only source of truth.** Anything the model sees must be reconstructable
   from committed session events; fork, resume and replay derive from the log. Plugin memory is a
   derived cache.
2. **Registrations are effects owned by a context.** Plugin unload, agent disposal, slot collapse and
   profile patches remove what was registered on the corresponding context — so choose the owning
   context. A registration on another context (such as `agent.ctx`) has two owners: keep its disposer
   in your plugin's own effect too, so either teardown removes it.
3. **The framework drives; the plugin computes.** Session projections, Conversation assembly and slot
   rendering subscribe, cache and publish for you. A plugin that subscribes, rescans or writes DOM
   itself bypasses that incremental machinery.
4. **Extension points are shared: use the weakest mechanism that suffices.** From weakest to
   strongest: `ctx.tools.restrict()` (can only remove tools) → `ctx.tools.guard()` (can only deny) →
   waterfall listeners (can rewrite, and depend on registration order) → `system-prompt/assemble`
   (replaces the whole assembly). The stronger the mechanism, the more of other plugins'
   contributions you must preserve.
5. **Other plugins and other harness versions read your data.** Declare compatibility with the
   envelope fields and versions the harness provides.
6. **Plugin UI is part of the harness UI** (see `ui-plugin.md`): one application, host theme tokens,
   host locale, host layout. Choose the rendering surface BEFORE writing a view; styling inside the
   wrong surface cannot recover consistency.

## Stability

- A waterfall listener (`agent/pre-step`, `agent/request`, `llm/stream`, `tools/pre-execute`,
  `tools/execute`, `tools/post-execute`) that does not own the decision must return `next()`. When
  rewriting an `agent/pre-step` decision, SPREAD it (`{ ...decision, messages }`) so fields such as
  `startsRequestSeries` survive.
- A denial that must hold regardless of order is `ctx.tools.guard()`; a guard is synchronous, so a
  decision that must await something (asking the user) returns `ask` from `tools/pre-execute`.
  Hiding tools from ONE agent is `ctx.tools.restrict()` on that agent's context — it keeps schema
  presentation, lookup and execution aligned. Observe final outcomes on `tools/result`; use
  `tools/post-execute` only to transform a result. Never listen to `system-prompt/assemble` to add or
  remove tools or text.
- Add prompt text with `ctx.systemPrompt.section()`. Add per-agent context with `agent.inject()`
  (logged as `agent/inbox/spliced` at call time, entering the next admitted step); `agent/request`
  listeners cannot change request messages.
- Register per-agent behaviour on `agent.ctx` (obtained in an `agent/created` listener) inside ONE
  `agent.ctx.effect()`, and keep that disposer keyed by agent in your plugin's own effect — unloading
  the plugin does not dispose `agent.ctx` registrations by itself.
- Put optional services in `inject` or `ctx.inject([...], …)` so the plugin stays inactive in
  profiles without them instead of throwing.
- **Do not append session events with a new `type`.** Readers accept an unknown stored event only
  when its envelope carries `ignorable: true`, and a live `Session.append()` cannot set that marker,
  so the session would refuse to reopen. Derive state from existing events, or keep plugin-owned data
  in a storage service found through inspection.
- Put tunable values in the plugin's `Config` so users change them in the patch layer, which survives
  upgrades. (In this bundle `mpd.jsonc` is the runtime layer for values a row reads per call.)

## Performance

- Keep per-session state derived from the log in a `ctx.sessionProjections` unit instead of
  subscribing to `session/event` and rescanning `session.events`. `apply(state, event)` is pure and
  synchronous and returns the SAME reference for events it ignores; read with `stateOf()`, and let
  `view()` suppress publication by returning the same reference when its value is unchanged.
- Keep projection state plain JSON and bump `stateVersion` when fields or fold semantics change: the
  cache then checkpoints it, cold reads replay only the tail, and stale checkpoints are discarded.
- Wait on durable events (`turn/end`, `assistant/message`, `tool/result`); render live tokens from
  `agent/assistant-stream`; do not poll `agent/status`. `whenIdle()` does not mean one follow-up
  finished — several inputs can share one running interval.
- A timer that starts work calls `agent.followup()`, which wakes the agent; `agent.inject()` does NOT
  wake it, so injected context can wait in the inbox until other input arrives. Clear the timer in the
  owning effect.

## Writing tool definitions (and skills)

- **Start with minimal context:** purpose, available actions and constraints first; load detail on
  demand (`references/`), with a clear description and a reliable way to retrieve it.
- **Keep critical constraints visible:** permissions, destructive effects and required validation
  appear BEFORE the relevant action.
- **Prefer bounded outputs:** return concise results with identifiers or paths for retrieving
  details; never dump whole logs or documents. Mark omissions and truncation explicitly.
- **Use locality:** include a bounded amount of likely-needed adjacent context with a result.
- **Evaluate total work:** saving context is useful only if it does not cause more searches, repeated
  reads or mistakes.
- **Delete obvious constraints.** Omit rules the model learns from the call result (a missing file
  failing to read, a failed send not delivered).
- **Describe behaviour, not implementation.** State what the tool does and returns; omit internal
  mechanisms and enforcement details.
- **Put parameter rules on the parameter** (defaults, ranges, pairing, when-to-set). A description
  that varies with configuration usually means the varying part belongs to a parameter.
- **Say each fact once.** Do not repeat the tool definition in a prompt section, a parameter rule in
  the tool description, or one tool's rules in another.
- **Measure the change** where a tool-definition edit is meant to save context: compare first-turn
  prompt tokens before and after.
