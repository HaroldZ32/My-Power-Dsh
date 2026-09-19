# t16 — Bridge review: the landed F1 fix, arm parity, and the facade's property set

Task t16 (kind=work, round 1) · seat Architect (read-only) · wave w1 · team agent-teams-adapter-wiring.
Method: source reading only (no bash, no write/edit; this note is the task artifact). Every claim names file + symbol;
citations are SYMBOL-anchored, never line-anchored (T-55) — the acceptance text's line numbers (`index.js:387`, `members.js:235`,
`tools.js:655`) are PRE-LANDING projections that drifted when the F2 regions landed; each is identified below by symbol instead.

## 0. What was read (and what was NOT executed)

- Bridge: `packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js` (`createAgentTeamsCtx`, `seam`, `seamMethod`, `probeMpdDsh`,
  `capabilitiesOf`, `scopeShapeFrom`, `readScopeMember`, `isUsableScope`, `agentScopeOf`, `subagentRuntimeOf`, `liveAgentOf`,
  `ADAPTER_WITNESS`, `WITNESS_STATE`, `CAPABILITY_SNAPSHOT`).
- Bridged adopted files: `lib/index.js` (`apply` facade construction; the approval-notice route), `lib/capabilities.js`
  (`installTeamCapabilities`), `lib/harness-compat.js` (`installContinuableMemberSetup`, `queueMemberPrompt`,
  `guardSubagentDelivery`), `lib/members.js` (`steerCaptainReport` + its caller, `installMemberSelectionRuntime`'s child setup,
  `spawnMember`, `interruptMember`, the delivery call), `lib/command.js` (`registerAgentTeamsCommand`), `lib/tools.js`
  (`registerAgentTeamsTools`, `haltTeamWork`, `stopTeamMemberActivations`, `waitForMemberIdle`, `continueStagedPlanning`,
  `discardStagedTeam`).
- Adapter: `packages/mpd-dsh-adapter-plugin/src/index.ts` (`scopeOfAgentContext`, `agentScope`, `steerAgentTurn`,
  `injectAgentMessage`, `startAgentTurn`, `cancelAgentTurn`, `subagentRuntime`, `registerHostTool`, `registerPromptSection`,
  `registerCommand`, `llmListModels`, `llmResolveCallConfig`, `DshCapabilities.agentTurnSteer/agentTurnInject`).
- Instruments read (for the F7/Class-B claims): `test/adapter-routing.test.mjs` (`throwingRawCtx`, the F7 arm, the negative
  control), `test/adapter-facade.test.mjs` (the three-arm F1 test), `test/adapter-bypass-inventory.test.mjs` (`BYPASS_RULES`,
  `inventory`, the whenIdle exact-set arm).
- **NOT executed**: this seat runs no commands. Every statement below is a property of the CODE AS WRITTEN; "the suite is green"
  is the bridge lane's report, not my measurement.

## 1. F1 — VERIFIED (one shape in every arm, identity-preserving context, no helper-induced throw)

| arm | code path (symbol) | shape | `context` |
|---|---|---|---|
| MOUNTED + usable adapter scope | `agentScopeOf` -> `ctx.agentScope(agent)` -> `seam('agentScope','agentScope')` -> `isUsableScope(provided)` true -> returns `provided` | the adapter's `{context,tools,on,effect}` (`scopeOfAgentContext`) | the raw `agent.ctx` the adapter captured |
| MOUNTED + unusable adapter result | same, `isUsableScope` false -> `scopeShapeFrom(agent?.ctx)` | built shape | `agent.ctx` (identity) |
| PENDING / ABSENT | `seam` returns `undefined` (no adapter) -> `scopeShapeFrom(agent?.ctx)` | built shape | `agent.ctx` (identity) |
| no facade at all (plain-object ctx, every pre-existing unit test) | `typeof ctx?.agentScope === 'function'` false -> `scopeShapeFrom(agent?.ctx)` | built shape | `agent.ctx` (identity) |

- **ONE shape**: `scopeShapeFrom` returns exactly `{context, tools, on, effect}` and `isUsableScope` admits only an object carrying
  all four members with callable `tools.restrict`/`on`/`effect`, so NO arm can return a raw cordis ctx in place of the shape — the
  pre-F1 defect (`: agent?.ctx`) is gone. Both writers of the shape (`agentScopeOf`, and `createAgentTeamsCtx`'s `agentScope`
  property) end in `scopeShapeFrom`, so there is exactly one builder.
- **Identity**: `context: scoped` where `scoped` is the value read from `agent.ctx`; `readScopeMember` never reads a `context`
  member (the pre-F1 failure mode), so `scope.context` is `agent.ctx` itself. `lib/harness-compat.js`'s setup region calls
  `setup(scope.context, agent)`, which is therefore byte-for-byte today's `setup(agent.ctx, agent)` in EVERY arm.
- **No all-or-nothing probe**: `readScopeMember(scoped, name)` wraps each read in `try/catch` and returns `undefined` on failure;
  `tools` degrades to `{restrict: () => DISPOSE_NOTHING}`, `on`/`effect` degrade per CALL to a no-op disposer. One hostile member
  cannot discard the others.
- **No throw path** for a throwing cordis agent-scoped proxy: the reads the helper performs on that proxy are exactly
  `tools`/`on`/`effect` through `readScopeMember`; `context` is stored, never read; `agent?.ctx` is a plain data read on the raw
  handle (D8). `test/adapter-facade.test.mjs` proves this with a Proxy that throws for every prop but `tools`.
- **The failure-listener park is no longer reachable THROUGH this helper.** It remains reachable for a genuinely hostile HOST ctx
  (`setup(scope.context, agent)` then passes that same proxy to `members.js`'s setup, whose `childCtx.on(...)` throws) — but that is
  exactly today's behaviour for the same ctx (parity), not a regression: the pre-F1 park was caused by the helper handing over
  `undefined`, and that cause is gone. Stated plainly because the acceptance asks for it: the helper no longer CREATES the park.
- **Receiver discipline on the built shape** (the t3 §3 requirement): `tools` is returned as the SAME object read from `agent.ctx`, so
  `scope.tools.restrict(f)` is a method call on that object and the cordis shadow wrapper rebinds `this.ctx` to a child of `agent.ctx`
  (`createShadowMethod` rebinds only when `thisArg === outer`); `on`/`effect` are `on.apply(scoped, args)` / `effect.apply(scoped, args)`
  over values that are ALREADY bound accessors (`.apply`'s thisArg cannot re-bind them), so the listener stays agent-scope-tagged and the
  effect stays on the agent scope fiber. Both are today's semantics.

## 2. Criterion 3 — property-set completeness against the LANDED code

Sweep: every `ctx.<prop>` occurrence in the ten server files (`index, tools, members, scheduler, capabilities, command,
harness-compat, session-start, snapshot, events`) — the client bundle is out of scope by D7 and is the only place the sweep found
properties outside the set (`ctx.slots`, `ctx.locale`, `ctx.sessions`, `ctx.modelDirectories` in `lib/client.js`/`lib/client/index.js`).

| property read (file · symbol) | route |
|---|---|
| `ctx.tools.register` (tools.js, 21 sites) | adapter `registerHostTool` (verbatim) / fallback `targetCtx.tools.register` |
| `ctx.agents.get` (tools, members, scheduler, index, events) | adapter `liveAgent` / `targetCtx.agents.get` |
| `ctx.agents.list` (capabilities) | adapter `liveAgents` / `targetCtx.agents.list` |
| `ctx.subagents.getProvider`/`list`/`startContinuable`/`interrupt` (members) | adapter `subagentProvider(s)`/`startContinuableAgent`/`interruptAgent` / raw |
| `ctx.subagents` as the delivery runtime (members `queueMemberPrompt` call, tools `stopTeamMemberActivations`, harness-compat both installers) | `subagentRuntimeOf(ctx)` -> adapter `subagentRuntime()` / `targetCtx.subagents` — the facade's projection is deliberately never used for the ladder or the drain |
| `ctx.commands.register` (command, 2 sites) | adapter `registerCommand` / raw |
| `ctx.systemPrompt.section` (capabilities) | adapter `registerPromptSection` / raw |
| `ctx.llm.listModels` / `resolveCallConfig` (members) | adapter `llmListModels` / `llmResolveCallConfig` / raw |
| `ctx.on` (index, capabilities, command, session-start ×2, scheduler, harness-compat) | adapter `onEvent` / raw `targetCtx.on(event, handler, ...listenerOptions)` |
| `ctx.effect` (index ×5, capabilities, harness-compat ×3, command) | pass-through bound to `targetCtx` |
| `ctx.get` (index web routes, scheduler `WATCHDOG_HOLD_SERVICE, false`, tools `mpdConfig`/`PRESERVING_HOLD_SERVICE, false`) | pass-through bound to `targetCtx`, BOTH arguments forwarded |
| `ctx.inject` (index, `['commands']`) | pass-through with the callback WRAPPED in a scoped facade |
| `ctx.logger` (all ten) | pass-through, the same object |

Partition: adapter-backed (Class A) = tools/agents/subagents/commands/systemPrompt/llm/on; pass-through-bound (cordis core) = effect/get/inject/logger;
Class B residuals recorded = `whenIdle` (see below) and the host-handed `childCtx` in `members.js` (`childCtx.on('agent/error')`,
`childCtx.on('agent/request-error')`, `childCtx.agent`, `installModelSelection(childCtx, …)`) — untouched, correctly, because those listeners must
carry the CHILD's scope. **No landed server file reads a ctx property the facade does not provide, and no landed server file reaches a harness
seam on a receiver the facade cannot cover** (the second claim is also machine-asserted by the AC15 `BYPASS_RULES` scanner, which I read and
traced: it skips hits inside regions, treats a `ctx`-suffixed receiver as facade-covered, and explicitly does NOT exempt `ctx.subagents` value
uses — the class that hid tools.js's halt drain).

**F2 routing present, at the SYMBOL the acceptance names** (line numbers drifted): `lib/index.js` `apply`'s approval-notice route ->
`ctx.steerAgentTurn`; `lib/members.js` `steerCaptainReport` -> `ctx.steerAgentTurn` (its two callers, `members.js`'s report path and
`lib/tools.js`'s `agent_teams_send_message` path, now thread the plugin ctx in); `lib/tools.js` `discardStagedTeam` -> `ctx.injectAgentMessage`.
The throw is preserved at all three: each sits inside the caller's own `try/catch` that pre-existed (index.js: warn and still return 200;
members.js `steerCaptainReport`: `false`; tools.js: warn and continue), and the adapter's `steerAgentTurn`/`injectAgentMessage` are THROWING
verbatim receiver-bound forwarders gated on `capabilities().agentTurnSteer/.agentTurnInject` — flag names match the bridge's `seam` calls.
The Facade's fallback arm for both is the raw expression returned verbatim (`agent.steer(message)` / `agent.inject(message)`), so the
no-adapter behaviour is today's, throw included. The D8 pair is also present: `startAgentTurn` (tools.js `continueStagedPlanning`,
command.js ×2) and `cancelAgentTurn` (tools.js `haltTeamWork` ×2, `continueStagedPlanning`, `discardStagedTeam`).

**`whenIdle` Class B — the ruling is implemented and RECORDED**: two direct sites only (`members.js` the child-drain await,
`tools.js` `waitForMemberIdle`'s `Promise.race([live.whenIdle(), aborted])`); contract §2 carries the Class B row with its reason and
`test/adapter-bypass-inventory.test.mjs` asserts the EXACT two-line set, so a third site reddens. Per-agent host ctxs stay exempt: the
instrument (`throwingRawCtx`) arms only the plugin ctx, and the F7 arm hands a member a per-agent ctx that throws on every read, asserts the
ADAPTER scope was the path taken (`agentScope` + `scope.tools.restrict` recorded) and that `rawHits` stayed empty — with a negative control
proving the detector is armed.

## 3. Criterion 4 — fallback-arm parity: checked per property, ONE divergence

Checked and clean: every facade property's fallback executes today's expression with today's receiver — `targetCtx.tools.register(def)`,
`targetCtx.agents.get/list()`, `targetCtx.subagents.<method>(...)`, `targetCtx.subagents` (the runtime VALUE, not a copy),
`targetCtx.commands.register(def)`, `targetCtx.systemPrompt.section(sec)`, `targetCtx.llm.<method>(...)`, `targetCtx.on(...)`,
`targetCtx.effect(fn, label)`, `targetCtx.get(name, strict)` — while `agent.followup/cancel/steer/inject` are called ON THE AGENT handle
(receiver-bound, values returned verbatim). The R4 tolerances present are the recorded ones (`liveAgent`/`liveAgents`/`onEvent`
swallow-and-degrade; `registerCommand` returning a no-op disposer for a missing registry; `on` always answering a function) plus one NEW one —
BR-1 below.

The plain-object-ctx path (the "30+ tests" constraint) was traced on two real fixtures rather than asserted: `installTeamCapabilities` with
`capCtx` + a fake `memberAgent.ctx = {tools:{restrict}, effect}` walks `agentScopeOf(capCtx, memberAgent)` -> `scopeShapeFrom` (capCtx has no
`agentScope`) -> `scope.tools.restrict({deny})` reaches the fixture's own `restrict` (a plain arrow: the `.`-call receiver is irrelevant) and
`scope.effect(...)` reaches the fixture's `effect`; `t52-root-registration` drives `apply()` on a stub ctx with no `mpdDsh`, where every
facade property takes the `seam === undefined` branch (its `get` answers undefined for both probe modes) and the raw expressions run — its
listener collection therefore sees exactly the listeners it saw before.

### BR-1 (low, the only divergence I found): the built shape SYNTHESIZES missing members instead of failing

- Where: `mpd-adapter-ctx.js` `scopeShapeFrom` — `tools` becomes `{restrict: () => DISPOSE_NOTHING}` when the read member is absent or not
  object-shaped with a callable `restrict`; `on`/`effect` become per-call no-ops when the member is not callable.
- Concrete failure it would cause: with a per-agent ctx that LACKS `tools.restrict`, `capabilities.js`'s `scope.tools.restrict({deny: …})`
  now succeeds as a silent no-op, so a MEMBER agent keeps the captain-only tools; today's expression (`agent.ctx.tools.restrict(...)`) threw
  and the throw propagated out of `attach()` (after `state.dispose()`), i.e. the miss was loud. The same shape applies to `on` (a missing
  `agent.ctx.on` no longer throws on the failure-registration path).
- Reachability: on the installed harness the agent-scoped ctx always exposes `tools`/`on`/`effect` (the pre-bridge code already relied on all
  three), so this is a DEFENSIVE path, not a live one; it cannot change any currently-measured behaviour.
- Why it is a divergence at all: acceptance criterion 4 says the fallback arm executes "today's exact expressions with the same receivers and
  throws (only the R4 tolerances may differ)". The F1 ruling's "each property resolved independently" necessarily tolerates a missing member,
  so the AC text and the ruling disagree; the LANDED code follows the RULING (and the contract's revised §4 text, which specifies the built
  shape but is silent on a missing `restrict`).
- Disposition (captain's text decision, one line either way): (a) RECOMMENDED — amend acceptance criterion 4 / §4 parity rule (a) to name this
  as the F1 tolerance, exactly as the R4 tolerances are named, and optionally route a ONE-TIME warn through the existing witness sink when
  `tools.restrict` is synthesized, so the silent case is discoverable in a boot log; or (b) narrow the tolerance to `on`/`effect` only and let a
  missing `tools.restrict` keep today's throw. Nothing else in the review depends on the choice.

### BR-2 (low): the AC15 frozen-region map was not extended with the five F2 ids

`test/adapter-bypass-inventory.test.mjs`'s `FROZEN_REGIONS` lists the pre-F2 region set per file; the F2 regions
(`index.js` `adapter-steer-approval-notice`, `members.js` `adapter-steer-captain-report`(+`-caller`), `tools.js`
`adapter-steer-send-message-caller` and `adapter-inject-staged-discard`) are covered only by the same test's OTHER arm (`every region present
must be registered`) and by the registry machine (`--check`/heal, AC7/AC8). Concrete failure it would cause: deleting an F2 region from a file
while leaving its registry entry is caught by `patch-agent-teams-fixes.mjs --check`, not by this test — so the arm is belt-and-braces only.
Disposition: extend `FROZEN_REGIONS` with the five ids when the file is next touched, or record that the registry is the authority (the
contract already says so). Not blocking.

### BR-3 (informational): acceptance line anchors drifted; symbol anchors used

`index.js:387`, `members.js:235`, `tools.js:655` are the pre-landing positions of the steer/steer/inject sites; after the F2 regions landed
they are 405 / 248 / 685. Every claim here is symbol-anchored, so nothing rots; recorded so a reader of the acceptance is not misled (T-55).

### BR-4 (informational, no action): the raw-fallback inventory list omits two expressions it could carry

`adapter-bypass-inventory.test.mjs`'s `rawFallbacks` array (asserted PRESENT in the bridge, ABSENT elsewhere) does not list `agent.steer(` /
`agent.inject(`, although the bridge's fallback arms use both. The class is still covered by the `BYPASS_RULES` arm
(`agent.turn-steer` / `agent.turn-inject` redden on a non-`ctx` receiver outside a region), so this is a completeness nicety, not a gap in
coverage. Checked, no action required.

## 4. Verdict

- **F1: verified as implemented** — one shape in all four paths (mounted-usable, mounted-unusable, pending/absent, no-facade), `context`
  identity-preserving, per-member independent resolution, no all-or-nothing probe, and no throw path for a hostile agent-scoped proxy; the
  pre-F1 `undefined`-context park is removed.
- **Arm parity, property set, delivery-runtime identity, receiver discipline, childCtx exemptions, steer/inject routing with the throw
  preserved, `whenIdle` Class B recorded and exactly inventoried: all verified** against the landed code (details above).
- **One low-severity text divergence (BR-1)** for the captain to dispose of in one line; **one low-severity test-completeness note (BR-2)**;
  two informational notes (BR-3/BR-4). No blocking finding: nothing in the landed bridge contradicts the F1 ruling, and I found no code path
  where an adapter-mounted composition reaches a raw harness seam.

## 5. Errata / limits of this review

- Read-only seat: no command was executed, so this review certifies the CODE and the INSTRUMENTS as written. Test EXECUTION results
  (`bun test`, the mounting boot, the gate sweep) belong to the lanes that ran them and are cited by their artifacts, not here.
- The tree moved during earlier reviews of this wave; these claims are anchored to symbols, so a later edit that moves code keeps them valid,
  while an edit that CHANGES one of the named symbols invalidates the corresponding row and needs a re-read.
