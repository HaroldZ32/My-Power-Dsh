# Bridge lane (team task t5 / contract lane t3): the agent-teams ↔ mpd-dsh-adapter bridge

Seat: Senior Engineer (worker) · wave: w1 · team: `agent-teams-adapter-wiring`
Authority: `evidence/agent-teams/adapter-wiring/requirements-contract.md` (frozen, revision 2)
Deliverable: `packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js` + the frozen delta regions in six
adopted files + a regenerated registry + four new tests. No behaviour change to the team protocol.

## 1. What landed

| File | What | Frozen region ids (§5) | Region-less projection vs HEAD |
|---|---|---|---|
| `lib/mpd-adapter-ctx.js` | NEW mpd-owned bridge module (ONE region) | `mpd-delta adapter-ctx-bridge` | new file (no committed twin) |
| `lib/index.js` | facade built at the top of `apply`; every consumer below (including pre-existing regions) receives it | `adapter-facade-wiring` | **IDENTICAL** (nothing adopted replaced) |
| `lib/capabilities.js` | one `agentScopeOf(ctx, agent)` per `attach()`; `scope.tools.restrict` / `scope.effect` | `adapter-agent-scope` | 5 removed, 0 added outside regions |
| `lib/harness-compat.js` | `subagentRuntimeOf(ctx)` in both installers; `agentScopeOf` for setup/listener/effect; `liveAgentOf` replaces the `get('agents')` spelling | `adapter-subagent-runtime-install`, `…-guard`, `…-agent-scope`, `…-agents-lookup` | 6 removed, 0 added outside regions |
| `lib/members.js` | `queueMemberPrompt(subagentRuntimeOf(ctx), …)` | `adapter-delivery-runtime` | 1 removed, 0 added outside regions |
| `lib/command.js` | both `invocation.agent.followup(msg)` sites → `ctx.startAgentTurn(...)` | `adapter-command-turn-submit` | 2 removed, 0 added outside regions |
| `lib/tools.js` | `captain.followup` → `ctx.startAgentTurn`; the four `captain.cancel` sites → `ctx.cancelAgentTurn`; the halt DRAIN resolves the runtime through the bridge | `adapter-turn-submit`, `adapter-cancel-halt`, `adapter-cancel-feedback`, `adapter-cancel-discard` | 20 removed, 0 added outside regions |
| `lib/mpd-deltas.js` | regenerated: **151 regions / 13 files** (was 123 / 10; 146 after the wiring batch, +5 with the F2 steer/inject call sites) | (registry) | derived (`--write-registry` only) |

`node evidence/agent-teams/adapter-wiring/bridge/region-diff-proof.mjs` (exit 0) proves the last column:
every other adopted file's region-less projection is **byte-identical to HEAD** — including all ten
edit-free server files (`scheduler.js`, `session-start.js`, `snapshot.js`, `events.js`, `state.js`,
`profiles.js`, `quality-gates.js`, `web-routes.js`, `types.js`, `tool-names.js`, `event-types.js`,
`client.js`) which receive the facade without a single line changing. Raw log: `region-diff-proof.log`.

## 2. The bridge (frozen layout, D11)

`lib/mpd-adapter-ctx.js` is `skeleton-line + ONE region + skeleton-line + "\n"`, so
`beforeContext + block + afterContext + "\n"` reproduces it byte-for-byte — verified by construction:

```
regions in bridge file: 1 | lines: 325
skeleton lines: ["// mpd-owned bridge module — …", "// mpd-owned bridge module END — …", ""]
D11 reconstruction byte-identical: true
sha256 8670356f1009a2513b6d801c2ca2c80dfd4ee8123abf44330a7d4aad3471e59b  (2026-09-19T14:44:26Z)
```

Exports: `createAgentTeamsCtx(targetCtx, options?)`, `agentScopeOf(ctx, agent)`, `subagentRuntimeOf(ctx)`
and — see §5 deviation D6 — `liveAgentOf(ctx, agentId)`.
Resolution mirrors the adapter row's own `createLazyDshAdapter` (T-50) **except** that it never builds a
private adapter: strict probe per access, success cached, **miss never cached**, strict-miss +
non-strict-hit = PENDING, both-miss = ABSENT → the raw cordis ctx (today's behaviour) + one witness line.

## 3. Acceptance-criteria evidence (lane-owned: AC3, AC4, AC5, AC6, AC7, AC15)

| AC | Test / command | What is asserted | Result |
|---|---|---|---|
| AC3 | `test/adapter-routing.test.mjs` (7 tests, incl. the F2 and F7 arms) | recording adapter + raw ctx whose seam objects are THROWING proxies; `apply()` + `installTeamCapabilities` + `registerAgentTeamsCommand` + the runtime-only consumers (`deliverToMember`, `interruptMember`, `spawnMember`, `haltTeamWork`, `validateMemberLlmSelections`, `resolveMemberLlmSelection`, `captainSessionOf`, the registered command handler) record >0 calls for every Class-A seam and **ZERO raw hits**; a negative control proves the detector is armed | pass |
| AC4 | `test/adapter-facade.test.mjs` (15 tests, incl. the F1 three-arm and F2 arms) | frozen property set (14 keys); frozen witness literals; exactly ONE witness per mode per plugin instance (also across the scoped facades `inject` derives, and on the default console sink); PENDING ≠ ABSENT and re-probed on every access; a hit is cached; every fallback expression returns/throws exactly like today's (same receiver); `agentScopeOf`/`subagentRuntimeOf`/`liveAgentOf` branch table; per-method degrade when the adapter lacks one method | pass |
| AC5 | `bun test packages/mpd-agent-teams-plugin` + `git status --porcelain -- …/test …/self-fix-tests` | 346 pass / 0 fail (baseline 321 + 25 new); the test-status output shows **only `??` entries** (the four new files) — no ` M ` | pass |
| AC6 | `test/adapter-tool-parity.test.mjs` (2 tests) | the 21 `agent_teams_*` definitions are identical in both lanes under canonical serialization (sorted key sets, non-function JSON values, `String(fn)` for every function) and keep registration order; the definition reaches the seam by **reference** (`Object.is`) in both lanes, so nothing is rebuilt (a rebuild would drop `finalizeContent`/`presentCall`/`presentResult`/`isConcurrencySafe`) | pass |
| AC7 | `node scripts/patch-agent-teams-fixes.mjs --check` + `region-diff-proof.mjs` | 151 regions / 13 files verified byte-identical to the registry; every region is a bracketed sibling (no nesting — the registry's own stack scan refuses nesting); the region-less projections carry **0 added lines outside regions** | pass |
| AC15 | `test/adapter-bypass-inventory.test.mjs` (5 tests) | receiver-aware scan of the ten server files: every seam access on a receiver that is NOT the plugin's own ctx-shaped binding must sit inside an `mpd-delta` region (or the bridge); the raw fallback column exists in the bridge module ONLY; every region in every server file is registered; the six bridged files carry their frozen ids; the host-handed child scope is a **counted** residual (5 lines, a new use reddens) | pass |

Per-seam roll-up for AC3 (which consumer drives each seam, all with the adapter recording and the raw
ctx throwing):

| Seam | Exercised by |
|---|---|
| `registerHostTool` (21) | `apply()` — asserted exactly 21, all named `agent_teams_*` |
| `registerPromptSection` | `apply()` + the member-lane `installTeamCapabilities` |
| `registerCommand` | `apply()`'s `ctx.inject(['commands'], …)` (the facade wraps the scoped ctx) |
| `onEvent` | `apply()` (capabilities, command boundary, session-start sweep, `internal/service`) |
| `liveAgents` | `apply()` → `installTeamCapabilities`' roster loop |
| `liveAgent` | `haltTeamWork` (`captainSessionOf`) and `captainSessionOf` directly |
| `subagentRuntime` | the delivery ladder (`installContinuableMemberSetup` / `guardSubagentDelivery`) and `deliverToMember` |
| `subagentProvider` + `subagentProviders` | `spawnMember` (loud missing-provider failure names the catalog) and the successful spawn |
| `startContinuableAgent` | `spawnMember` with a provider |
| `interruptAgent` | `interruptMember` and `haltTeamWork` |
| `agentScope` (+ `scope.tools.restrict` / `scope.effect`) | `installTeamCapabilities` with a member roster |
| `startAgentTurn` | the registered `/agent-teams` command handler |
| `cancelAgentTurn` (×2) | `haltTeamWork`'s stop boundary |
| `llmListModels` / `llmResolveCallConfig` | `validateMemberLlmSelections` / `resolveMemberLlmSelection` |

## 4. Measured gaps the contract's inventory did not name (closed here)

1. **`tools.js:311` (`const runtime = ctx.subagents;` in the halt drain)** — a Class-A access on the
   `subagents` RUNTIME, absent from §2.1's per-file roll-up (28). Unrouted, the facade's `subagents`
   projection carries no `drainContinuableChildren`, so the browser Stop path would have silently
   downgraded to the quiescence fallback. Closed by `subagentRuntimeOf(ctx)` in region
   `mpd-delta adapter-subagent-runtime-halt-drain`, and the routing test asserts the runtime's
   `drainContinuableChildren` was the path taken.
2. **`harness-compat.js` `ctx.get?.('agents')?.get(…)`** — routed through the bridge's `liveAgentOf`
   (deviation D6), so no raw fallback expression remains in an adopted file.
3. **The host-handed child scope** (Class B by F7: legitimate host-provided per-agent usage) (`members.js` `childCtx`) — **not routed**, counted exactly by the
   inventory test: `installModelSelection(childCtx, …)` hands that ctx to a VENDORED helper
   (`_deps/dsh-agent`, out of scope by D7), and on a legacy Alpha.2 host `childCtx` is not guaranteed to
   be `child.ctx`, so re-resolving it through `agentScope(agent)` could change the legacy path. Flagged
   for the captain rather than silently left.
4. **`captain.steer` / `captain.inject`** remain direct Agent-object calls: the adapter's own
   `submitUserTurn` doc states `steer`/`inject` are deliberately NOT exposed, and §2/D8 routed only
   `followup`/`cancel`.
5. **REQUIRED FOLLOW-UP outside this lane's inScope — a non-facade caller of the real halt path.**
   `packages/mpd-team-watchdog-plugin/test/fixtures/inject.mjs` hands `haltTeamWork` a hand-built RAW
   ctx, and the frozen §5 spelling (`ctx.cancelAgentTurn(...)`, i.e. a facade-shaped caller) makes its
   `pause-preserves-halt-control` leg throw. MEASURED:
   `{"threw":"input.ctx.cancelAgentTurn is not a function"}` (`watchdog-fixture-caller-probe.log`).
   Remedy (one line, another package): wrap that ctx with `createAgentTeamsCtx({...}, { witness: () => {} })`
   — which also makes the fixture exercise the real facade path. NOT caught by the wave's gates: the
   fixture is not a `*.test.mjs`, so `bun test packages/mpd-team-watchdog-plugin` stays green
   (139 pass / 0 fail, measured after this lane's change).

## 5. Deviations from the frozen text, each with its measurement

- **D1 — five `<feature>-import` regions** (`adapter-facade-import`, `adapter-agent-scope-import`,
  `adapter-subagent-runtime-import` ×2, `adapter-delivery-runtime-import`). A module binding cannot live
  inside a function-scoped region, and the tree already carries EIGHT regions of exactly this shape
  (`mailbox-check-import`, `plan-format-import`, `deferred-kind-import`, … "purely ADDITIVE region").
  Every frozen id of §5 is present and unchanged; these are additions, not renames.
- **D2 — `harness-compat.js` maps the one frozen `…-agent-scope` concept to four regions** (the hoist
  plus `…-agent-scope-setup` / `…-request` / `…-effect`). The three sites are separated by upstream code;
  a single region would have had to swallow ~24 adopted lines (the registry would then own them).
- **D3 — `command.js` carries `adapter-command-turn-submit` + `adapter-command-turn-submit-profile`**:
  §5 lists one id for both `followup` sites, which are 19 lines apart (the second sits inside the
  generated-profile command registration).
- **D4 — the tools.js `adapter-turn-submit` region CONTAINS its `try { … }` block.** Measured necessity:
  with `try {` sitting BETWEEN `adapter-cancel-feedback` and `adapter-turn-submit`, the delta applier
  cannot heal the second region — the sibling healed first moves the registered `beforeContext` away from
  the seam and the applier refuses by design (`… does not match the registered beforeContext`). Adjacent
  sibling regions sharing one seam is the arrangement the applier's walk-back supports; the alternative
  layouts were measured with `heal-probe.mjs` before choosing. The change is comment-only in effect: the
  region-less projection of `tools.js` has 0 added lines.
- **D5 — the bridge exports a fourth helper, `liveAgentOf(ctx, agentId)`.** §5 prescribes
  `ctx.agents?.get?.(…)` for `harness-compat.js:193`; that spelling was MEASURED to redden the
  pre-existing `harness-compat.test.ts` arm "0.1.5-rc.2 host: the public prompt seam rejects a retired
  member and passes others" (the guard's ctx exposes the registry only through `get('agents')`, so the
  sender lookup returns `undefined` and the guard admits a retired member). The alternatives were a raw
  fallback expression inside the adopted file (contradicting AC15's "the bridge file is the ONLY module
  holding raw fallback expressions") or an AC5 violation. AC5 wins; the raw lane is centralised in the
  bridge and byte-equal to today's expression.
- **D6 — the facade's `on` forwards listener OPTIONS and always returns a disposer** (frozen table says
  "(always a function)"). `installInterjectionExpirySweep` registers with `{ global: true, prepend: true }`;
  dropping the third argument would silently change which events the plugin hears.

### 5d. Post-ruling alignment + an ABSORBED foreign repair (BR-1)

- **Capability-flag parity with the binding manual (this lane, after the captain's ruling):**
  `subagentRuntime` was the ONE of the fourteen mediated methods that was presence-gated; it now
  passes the adapter's own `subagents` flag (`capabilities().subagents === (service !== undefined)`,
  so a `false` flag and an absent service are the same state and no behaviour moved). Every one of
  the fourteen methods AGENTS.md §6 lists is now behind a capability flag, exactly as that sentence
  claims; `adapter-flag-conformance.mjs` reports **14 flags used, all declared**.
- **BR-1 (the bridge review t16's low-severity finding) landed in this lane's files while the review
  and repair lanes ran**, and was ABSORBED here rather than left to drift: `scopeShapeFrom` now takes
  an optional report callback and NAMES every member it hands a no-op (a member that cannot be
  tool-restricted loses its restriction — a privilege event, not cosmetic), `ADAPTER_WITNESS.substituted`
  + `adapterSubstitutionWitness(members)` carry the frozen line, and both the facade's `agentScope`
  and `agentScopeOf` pass the reporter under the same once-per-instance discipline. This lane
  verified coherence (F1's per-member build, identity `context`, no throwing read) and re-derived the
  registry so the entries carry the new bytes; the review lane's own BR-1 test arm lives in
  `test/adapter-facade.test.mjs`. Record: `evidence/agent-teams/adapter-wiring/bridge-review/t16-bridge-review.md`.
- **Settled hashes moved with those two changes** (superseding the values quoted in the first
  completion): bridge `01fd9125510885fb…`, registry `456a297b00e5225f…`, sandwich
  2026-09-19T15:13:25Z == 15:13:59Z, `360 pass / 0 fail`, `--check` exit 0 (151 regions / 13 files);
  the other six adopted files are byte-unchanged.

## 6. Reproduction (all commands run from the repo root)

```
bun test packages/mpd-agent-teams-plugin                                   # 350 pass / 0 fail
node scripts/patch-agent-teams-fixes.mjs --check                           # 146 regions / 13 files, exit 0
bun run typecheck                                                          # exit 0
git status --porcelain -- packages/mpd-agent-teams-plugin/test packages/mpd-agent-teams-plugin/self-fix-tests
node evidence/agent-teams/adapter-wiring/bridge/heal-probe.mjs             # 13/13 files strip-heal byte-identical
node evidence/agent-teams/adapter-wiring/bridge/region-diff-proof.mjs      # 0 added lines outside regions
bun test packages/mpd-agent-teams-plugin/test/adapter-bypass-inventory.test.mjs
```

Raw logs in this directory: `gate-sweep.log`, `suite-green-baseline.log`, `inventory-pre-edit.log`,
`heal-probe.mjs` (the layout experiment), `region-diff-proof.log`, `projections/`.
`suite-after-regions.log` / `suite-after-registry.log` / `suite-after-heal-fix.log` are the intermediate
reds that document the two mid-flight defects this lane hit and fixed (the discovered-file ENOENT class
in the self-fix strip-heal tests, and the sibling-seam heal defect) — kept because the wave's review asks
what was measured, not only what passed.

Also kept: `facade-test-debug.log` / `routing-test-debug.log` (the first red runs of the two new tests —
they document which assertions caught which mistake, e.g. the pending-vs-absent lane and the missing
`subagentRuntime` recording) and `inventory-mid-edit.log` (the inventory after the regions landed but
before the registry was regenerated).

The captain is the only git writer: this lane wrote files only.
