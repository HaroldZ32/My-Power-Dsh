# cell-work capability spike — 2026-10-26T07:30:00Z

Read-only reconnaissance against the installed harness **0.2.1-rc.3**
(`/home/haroldzhao/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh`)
and this repository. No file was executed; every claim is a source read with the path and symbol
recorded below. Two consults produced this record; the machine-readable table is `result.json`.

## F1 — nesting depth

- `SubagentStartRequest` declares `readonly maxDepth?: number`.
- `SubagentRuntime.startActivation` runs `assertSubagentMaxDepth(spec.request.maxDepth)` →
  `assertCapabilities(provider, {...spec.request, signal})` → `startLocal(spec)`.
- `resolveChildDepth(parent, maxDepth)` computes `delegationDepthOf(parent) + 1` and throws
  `SubagentDepthError` only when `childDepth > maxDepth` — `maxDepth` is an ABSOLUTE cap on the
  child's own depth, not a remaining-levels budget.
- `dsh-subagent-spawn-in-process` declares
  `capabilities = { agentOptions: true, agentPreset: true, outputSchema: true, depthLimit: true }`.
  Therefore `assertCapabilities` never refuses `maxDepth` on the default provider.
- The service `maxDepth` config (default 1) is read ONLY by `SubagentRuntime.resolveMaxDepth`, whose
  sole external caller is `dsh-tool-subagent`; `startActivation` never consults it.

**Verdict: 3-level subcaptains are real, but only through a DIRECT start path that passes an explicit
absolute `request.maxDepth`.** The `subagent` tool path refuses depth 2 at the default config. The
repo adapter already forwards `spec.maxDepth` on both start arms; the team executor does not.

## F2 — event routing to child sessions

- `dsh-agent-loop` dispatches `agent/pre-step` as a waterfall with
  `{messages, ...position, signal}`, and `agent/turn-stopping` as a serial event.
- `agentEvents` fuses the live agent into the payload (`{...payload, agent}`) and routes through
  `scopeTarget`, whose documented rule is: admits UNTAGGED listeners globally, events flow UP the
  chain, never down.
- Shipped precedent: `mpd-team-watchdog` (a host-plane row) subscribes `agent/pre-step`,
  `agent/session-start`, `agent/turn-stopping` and stamps per-member heartbeats; the patch comments
  say "HOST plane on purpose: a preset row's listeners are scoped to one agent".

**Verdict: a host-plane row sees child sessions' step events and can inject a message into a child's
step through `{kind: 'enter', messages}`. Compaction cannot run there (an open turn is `busy`).**

## F3 — live context occupancy

- `dsh-token-meter` registers `contextPressure`, `contextBreakdown`, `tokenUsage`. There is **no**
  `usedTokens` field anywhere.
- `contextPressure` state: `{contextWindow?, pressureTokens?, surfaceTokens, sampledSurfaceTokens?,
  claim?}`; wire view `{contextWindow?, pressureTokens?, projectedTokens?}` with
  `projectedTokens = max(0, pressureTokens + surfaceTokens - sampledSurfaceTokens)`; units are raw
  tokens; `pressureTokens = inputTokens + cacheReadTokens + cacheWriteTokens`.
- It updates from `request/context` (window) and assistant usage samples (pressure + surface deltas).
- Read API: `sessionProjections.stateOf(session, key)` / `snapshot(session, keys)` — **a Session
  object, not an id**.
- The row is a root row of `@deepseek-ai/dsh-base`; `presets/mpd.patch.yml` deliberately keeps the
  meter on the HOST plane.

**Verdict: a host-plane row can read a child's live occupancy and the OBSERVED model window. The
window is therefore read from the model at runtime, not configured.**

## F4 — tool guard

- `DshAdapter.guardTool((exec: DshToolExec) => string | undefined): () => void`.
- `DshToolExec = {name?, arguments?, agent?, signal?}`; the caller session is `agent.session.id`.
- A returned string becomes an `isError` tool result and the call never dispatches; the first denial
  wins.
- Shipped templates: `installTeamDoorGuard` (mpd-team-core) and `installDelegationGate` (mpd-roles),
  the latter with the pure `delegationGateDecision({toolName, mode, rank})` and the
  `sessionRank` / `sessionIsMpdCaptain` predicates.

**Verdict: implementable today. Bounds: process-wide, dispatch-time only, blind to service-plane
calls.**

## F5 — compaction of a child

- A child's engine is `agent.ctx.get('compaction')`; it is NOT the same object as the host-plane
  engine (`evidence/omo-align/compact-hinge/result.json`, `sameObject: false`).
- `compactNow(agent, signal, sourceCommandId?) : Promise<CompactionResult | null>`; it runs inside
  `agent.runMaintenance(...)`, so the agent must be idle with no open turn. `null` means no safe
  useful range (the repo's `no-safe-range`).
- Reseed = `activation.dispose()` then a NEW `startActivation` whose prompt carries the handoff; there
  is no single "restart with handoff" API.
- **Defect found in this repository**: `packages/mpd-team-compact-plugin/src/index.ts` calls
  `engine.compactNow(entry.agent, undefined)`. `compactNow`'s first statement is
  `signal.throwIfAborted()` (outside its try), so `undefined` throws a raw TypeError that escapes the
  `ManualCompactionError` classification. Typecheck cannot see it because the engine is cast to
  `{compactNow?: (...args: unknown[]) => unknown}`.

**Verdict: the mechanism is real and correct; drive it at the turn boundary with a real AbortSignal.**

## Repository facts used by the plan

- `mpdTeams` is a READ-ONLY service; all mutations live in the five `agent_teams_*` tool bodies, so
  cellwork drives the board through `dsh.executeTool` to inherit every write-time guard.
- The native `TeamExecutor` is the default; its spawn builds the spec WITHOUT `maxDepth` today.
- A team member's label is `"<name> · <teamId>"`, which the child-persona seam cannot resolve, so team
  members receive neither roster persona nor the read-only deny list; cellwork must inject persona
  TEXT into the member prompt.
- `llmCatalog()` calls `resolveModelInfo` but projects only `{id, name, description, efforts,
  defaultEffort}` — `context.contextWindow` is dropped. Wave 1 fixes that projection.
- The mailbox roster is the team's members; the LEAD session is not a member, so a member cannot
  address the captain through `agent_teams_mail`. cellwork needs its own cell-aware addressing.
