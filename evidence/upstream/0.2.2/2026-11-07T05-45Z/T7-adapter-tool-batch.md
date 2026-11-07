# T7 repair — `ToolsService.execute` became a BATCH call at harness 0.2.2

Repair of the Blocker recorded by the pins seat (T2/T1). Owner: Senior Engineer (board task T7).
**Not committed** — the captain is the only git writer. **dist/** was NOT left rebuilt: the integrator
owns that artifact (see §6).

## 1. Symptom (before)

On harness `0.2.2-rc.1`, `bun skills/dsh-qa/scripts/bundle-lifecycle.ts` was RED while every MOUNT check
was green:

```
[roles-probe] ADAPTER_TOOL_CALL=fail:Tool batch execution failed
[roles-probe] FAIL
```

`packages/mpd-qa-roles-probe/src/index.ts` calls `dsh.executeTool({ name: "mpd_config_get", arguments: {} })`
through the MOUNTED adapter service; the adapter forwarded a single-call object to
`ToolsService.execute`.

## 2. Root cause (measured from the installed packages, not the release notes)

| | 0.2.1-rc.5 | 0.2.2-rc.1 |
|---|---|---|
| signature | `execute(exec: ToolExecutionInput)` (`dsh-tools/lib/types/index.d.ts:766`) | `execute(input: ToolBatchInput)` (`dsh-tools/lib/types/executor.d.ts:130`) |
| input | one call `{ callId, name, arguments, signal, agent? }` | `{ calls: readonly ToolCallBlock[], signal, maxParallelToolCalls?, agent?, toolSet?, log? }` where `ToolCallBlock = { type: 'tool-call', id, name, arguments: <RAW JSON STRING> }` (`dsh-llm/lib/types/types.d.ts:92-99`) |
| output | one `ToolExecutionResult` | `ToolBatchResult { results: [{ callId, result: ToolExecutionResult }], additionalContexts, concluded }` |
| service members | `get`, `schemas`, `executionMode`, `execute`, `guard`, `checkGuards` | `get`, **`executable`**, `definitions`, `schemas`, `setExecutor`, `execute`, `guard`, `checkGuards` (and **no** `executionMode`) |

The per-call `ToolExecutionResult` is the SAME type on both lines (`ToolExecutionSuccess |
ToolExecutionFailure`), which is why the adapter's existing `projectToolResult` needed no change.

Sending the single-call object to a 0.2.2 registry makes the executor fail internally; the harness drains
and rejects with `ToolBatchExecutionError("Tool batch execution failed")`.

## 3. Change (one seam, two helpers, two call sites)

`packages/mpd-dsh-adapter-plugin/src/index.ts` (+77 / −4; nothing named `dshgo` touched):

1. `toolRegistrySpeaksBatch(registry)` — the FEATURE DETECTOR. `execute` is arity-identical in both
   lines, so it cannot be introspected; 0.2.2 ADDED `executable()` and `resolve()` to the service, so a
   registry answering either one is the batch generation and every other registry is the single-call
   one. **No version string, and no discovery by throwing**, which is what keeps a genuine tool error
   distinguishable from a shape mismatch.
2. `executeToolCall(registry, input)` — builds the payload for THAT registry and returns the per-call
   `ToolExecutionResult`:
   - single-call: `{ name, arguments: <object>, callId, signal?, agent? }` (byte-for-byte the previous
     payload);
   - batch: `{ calls: [{ type: "tool-call", id: callId, name, arguments: <RAW JSON STRING> }],
     signal, agent? }`, returning `batch.results[0].result`.
   The argument ENCODING is the only other difference: the batch form takes the raw JSON string, the
   single form takes the parsed object. An absent caller signal becomes a live `AbortController` signal
   in the batch form, whose `signal` is required.
3. Both call sites now route through it: the host-plane `executeTool`, and the agent-scoped
   `executeToolForAgent` (which reads `agent.ctx.tools`, the SAME service class). `toolRuntime().execute`
   funnels through `executeTool` and inherits the fix.

## 4. Unit tests — `packages/mpd-dsh-adapter-plugin/test/tool-execute-shape.test.ts` (NEW)

```
bun test packages/mpd-dsh-adapter-plugin/test/tool-execute-shape.test.ts
  (pass) a BATCH registry is asked with { calls: [...] } carrying a RAW JSON STRING, and results[0].result is projected
  (pass) a SINGLE-CALL registry keeps the 0.2.1 payload and no batch envelope
  (pass) the calling agent rides BOTH shapes verbatim, and stays absent when not given
  (pass) a genuine tool ERROR surfaces on both shapes and is never swallowed
  (pass) a registry that THROWS surfaces one error result and is never retried in the other shape
  (pass) toolRuntime().execute returns the RAW per-call result on both shapes
  6 pass, 0 fail — 24 expect() calls
```

The two fakes are deliberately shaped by CAPABILITY (one carries `resolve`/`executable`, one carries
neither), so the detector is exercised by the same signal production uses. The "thrown error" arm also
asserts `payloads.length === 1`, which is what proves there is no blind retry in the other shape.

## 5. End-to-end proof on BOTH harness lines (real registries, real boots)

```
=== bundle-lifecycle on dsh 0.2.2-rc.1 (AFTER adapter fix) ===
exit=0
[bundle-lifecycle] ok=true -> evidence/dsh-qa/bundle-lifecycle/2026-11-07T06-16-14.216Z
  boot: {"ok":true,"checks":{"http":true,"adapterProvided":true,"adapterSeams":true,"adapterToolCall":true,
         "corpusFromBundle":true,"noPresetRefusal":true,"probePass":true,"presetProbeOk":true},"failed":[],
         "probeVerdict":"PASS","presetProbeLine":"ok"}
[bundle-lifecycle] PASS

=== bundle-lifecycle on dsh 0.2.1-rc.5 (AFTER adapter fix) ===
exit=0
[bundle-lifecycle] ok=true -> evidence/dsh-qa/bundle-lifecycle/2026-11-07T06-16-28.005Z
  boot: {… "adapterToolCall":true … "probeVerdict":"PASS" …}
[bundle-lifecycle] PASS
```

The probe line, quoted verbatim from each run's own `boot.log`:

```
# 0.2.2-rc.1 run (evidence/dsh-qa/bundle-lifecycle/2026-11-07T06-16-14.216Z/boot.log)
[roles-probe] ADAPTER_TOOL_CALL=ok
[roles-probe] PASS
# 0.2.1-rc.5 run (evidence/dsh-qa/bundle-lifecycle/2026-11-07T06-16-28.005Z/boot.log)
[roles-probe] ADAPTER_TOOL_CALL=ok
[roles-probe] PASS
```

Full transcript: `t7-bundle-lifecycle-both-exit.log` (this directory); the earlier confirmation pair
(`2026-11-07T06-15-35.912Z` 0.2.2, `2026-11-07T06-15-51.114Z` 0.2.1) is recorded in
`t7-bundle-lifecycle-both.log`. The 0.2.1 arm was ALSO green before the change (pins seat baseline) — no
regression.

Typecheck: `bun run typecheck` (`tsgo --noEmit`) — **exit 0**, no diagnostics.

## 6. The dist/** boundary (why the tree looks "half built", and what the integrator must do)

The E2E boots load `packages/<pkg>/dist/index.js`, so the proof above REQUIRED a build of the adapter
entry. It was made with the PINNED toolchain from the repo root:

```
.toolchain/node_modules/.bin/bun build packages/mpd-dsh-adapter-plugin/src/index.ts \
  --target node --format esm --outfile packages/mpd-dsh-adapter-plugin/dist/index.js
```

and then REVERTED byte-identically (`sha256 87f1b40e436e6d9890d9aeb9012891c3ea38e0a4c87878078790742b487ad4b4`,
`git status packages/mpd-dsh-adapter-plugin/dist/` empty), because `dist/**` is the integrator's scope.
The rebuilt bytes contained `toolRegistrySpeaksBatch` and the `{ calls: [{ type: "tool-call", … }] }`
payload (grep-verified at 103,238 B vs the committed 102,182 B).

CONSEQUENCE, and it is expected: `bun test packages` now reports **3679 pass, 6 skip, 2 fail**, and the
two failures are both `F1 shipped artifact > the committed dist is the byte-identical product of a
canonical build (T-62)`:

```
(fail) … packages/mpd-ext-plugin/test/adapter-identity.test.ts
(fail) … packages/mpd-roles-plugin/test/adapter-identity.test.ts
```

They compare each dependent package's committed dist against a canonical rebuild of its src, and
`bun build` INLINES the adapter — 20 `packages/*/dist/index.js` carry `ADAPTER_IDENTITY_FALLBACK`, so any
adapter src edit invalidates their committed bytes. **They go green at the integrator's rebuild**
(`node scripts/verify-dist-fresh.ts` names every target), which is the documented adapter fan-out and the
reason T7 was told not to rebuild `dist/**`. Not fixed here: rebuilding 20 dependent artifacts to satisfy
two fixtures would collide with the integrator's scope.

## 7. What I could NOT prove / declared bounds

- **`toolSet` is not supplied on the batch call.** `ToolBatchInput.toolSet` undefined "admits only
  unconditional registrations" (harness doc). Every tool this seam executes (`mpd_config_get`, the goal
  trio, the agent-teams write tools) is registered unconditionally, and the real 0.2.2 probe call
  succeeded — but a CONDITIONALLY-registered tool driven through `executeTool` could answer
  `UNKNOWN_TOOL` on 0.2.2 where it would have executed on 0.2.1. Not observed; not proven impossible.
- **`additionalContexts` from a batch answer is ignored.** The single-call contract had no such channel,
  so this is not a regression, but a tool that defers context loses it through this in-process seam.
- **`log` is not supplied**, so these in-process calls commit no root call/result events — identical to
  the pre-change behaviour on both lines.
- **`bun test packages` is not fully green** (§6: the two dist-freshness arms, by construction).
- The batch shape is proven against a REAL 0.2.2 registry (the probe's `mpd_config_get` through the
  mounted adapter) and the single shape against the REAL 0.2.1 registry; the unit arms cover the payload
  shapes the fakes record. What is NOT proven is any 0.2.2-only executor nuance beyond this call —
  concurrency overrides, program (PTC) subcalls and step logging are fields this seam leaves undefined
  and therefore never exercises.
