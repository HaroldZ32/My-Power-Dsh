# Lane A report — VEdit P0 cellwork fixes (board row T2)

**Branch state:** HEAD `d2032bf3` + lane A working tree. No git writes (captain commits).
**Contract:** `.mpd/plans/cellwork-vedit-p0-fix-r2.md` (revision 2, frozen).
**Write scope used:** `packages/mpd-cellwork-plugin/{src,test}/**`, `packages/mpd-dsh-adapter-plugin/{src,test}/**`,
`evidence/cellwork/vedit-p0/lane-a/**`. Nothing outside it was edited.

## 1. Files and symbols changed

### Adapter — `packages/mpd-dsh-adapter-plugin/src/index.ts`
| symbol | change |
|---|---|
| `DshAdapter.compactionEngineForLiveAgent` | NEW public seam (interface declaration + implementation + entry in the returned adapter object). Reads `agent.ctx.get("compaction")` for a handle the caller already holds, WITHOUT the live-session registry. |
| `engineOfLiveHandle` | NEW private helper: the ONE memoized engine body (WeakMap keyed by the Agent OBJECT). `compactionEngineForAgent` now delegates to it, so the two seams cannot disagree about a realm. |

### Cellwork — `packages/mpd-cellwork-plugin/src/protocol-core.ts`
| symbol | change |
|---|---|
| `PromotionDeps` | gains `parentSessionId?: string`; the `dsh` Pick gains `compactionEngineForLiveAgent` and `liveAgent`. |
| `PromotionResult` | gains `parentSessionId?: string` and `parentSource?: "parent" \| "captain"` (the union stays `promoted \| reseeded \| refused`, R5). |
| `CompactionEngine` | NEW private interface (the host engine read structurally). |
| `liveSessionOf`, `engineForBarrier`, `ReseedParent`, `reseedParentOf` | NEW private resolvers (live session; live-handle engine first; live parent then captain). |
| `promoteAfterHandoff` | no sleep before attempt 1; engine from the live handle BEFORE the registry; reseed parent = live parent → captain → `reseed-parent-unavailable`; `request.parent` is the live session, never `deps.agent`. |
| `compactionJournalEntry` | carries `parentSource` + `parentSessionId` when the reseed ran. |

### Cellwork — `packages/mpd-cellwork-plugin/src/protocol.ts`
| symbol | change |
|---|---|
| `parentSessionOf` | NEW private reader: `agent.session.header.parentSession`, structurally. |
| `runBarrier` | passes `parentSessionId`; journals a `reseed-parent` row (`parentSource`, `parentSessionId`, `originalParentSessionId`, `newHandle`) when the reseed ran. |
| `agent/turn-stopping` listener | RETURNS `runBarrier(agent).catch(...)` (the `void` spelling removed); every throw contained, the returned promise never rejects. |
| `workspaceConfigReader` | NEW private reader binding `mpdConfig.get(<dotted key>)`. |
| `cellwork_send` call site | `maxUndelivered: mailMaxUndeliveredOf(workspaceConfigReader(deps.ctx))` — the SHARED resolver lane B exports, read per call. |
| `cellwork_send` description | adds the MAILBOX FULL paragraph: the config key, the default 8, that `agent_teams_mail` shares the bound, and both recovery paths. |

### Cellwork — `packages/mpd-cellwork-plugin/src/split.ts`
| symbol | change |
|---|---|
| `SplitVerdict.warnings` | NEW `warnings: GraphFinding[]`, excluded from `accepted`. |
| `SCOPE_REQUIRED_KINDS`, `writeScopeWarnings` | NEW: empty `writeScopes` on a `work`/`repair`/`integration` task → one advisory by key. |
| `submitSplit` | computes and persists `warnings`; `accepted` untouched. |
| `readVerdictFile` | normalises an older verdict's absent `warnings` to `[]`. |

### Cellwork — `packages/mpd-cellwork-plugin/src/activate.ts`
| symbol | change |
|---|---|
| `ActivateOutcome.notice` | NEW optional field. |
| `resplitNotice` | NEW private builder (kept count, NOT rewritten, re-freeze + new verify loop, owner-only dispatch count, stage-4 exception). |
| `materializeSplit` | computes `rebuiltKept` (kept tasks whose contract stage 4 rebuilt) and returns `notice` when anything was kept. |
| `buildContractDoc` | the no-scope line now carries the recovery: "ask the captain for a scope extension BEFORE the first write". |

### Cellwork — `packages/mpd-cellwork-plugin/src/flow.ts`
| symbol | change |
|---|---|
| `cellwork_split` | output schema `warnings`; all three result paths carry it; the render prints `SCOPE WARNING(S) — non-fatal, the split stays accepted: …`; the refusal journal row carries warning codes; description states the warning rule. |
| `cellwork_activate` | output schema `notice`; the result carries it; the render prints `NOTICE: …`; description states the re-split notice. |

### Tests
| file | change |
|---|---|
| `test/barrier-live-engine.test.ts` | NEW — 8 arms (C6 a–g + the older-adapter fallback + the appending host-throw sentence). |
| `test/split-scope-warnings.test.ts` | NEW — 4 arms (work/repair/integration, no-noise control, contract-doc recovery). |
| `test/mail-bound-config.test.ts` | NEW — 4 arms (configured 1, absent → 8, `0` disables, description disclosure). |
| `packages/mpd-dsh-adapter-plugin/test/adapter-live-engine-seam.test.ts` | NEW — 3 arms (no registry entry needed, memo per object, total degrade). |
| `test/flow.test.ts` | `CapturedTool.output` + `renderText` helper; 2 NEW arms (D4/C5 notice+render, D3/C4 warnings+render); 3 test doubles completed with the two new seams; 2 superseded reseed-parent assertions replaced (see §4). |
| `packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` | one frozen entry re-frozen (see §4). |

## 2. Reproduction — red first, then green

Every red log carries `# RED-FIRST on HEAD d2032bf3 — <UTC>` and the exact command; every green log
carries `# GREEN-AFTER`.

| item | red-first (HEAD, before any fix) | green-after |
|---|---|---|
| D1 (fence: detached member + dead-parent reseed) | `red-first/d1-barrier-red.log` — `0 pass / 8 fail`; first failure: listener returned `undefined` (`Expected constructor: Promise`), then `engine.calls.length` 0, then the reseed parent refuses. | `green-after/cellwork-tests.log` |
| C1 adapter seam | `red-first/c1-adapter-seam-red.log` — `0 pass / 3 fail` (`compactionEngineForLiveAgent` was not a function). | `green-after/adapter-tests.log` |
| D3 split half (silent empty writeScopes) | `red-first/d3-split-warnings-red.log` — `0 pass / 4 fail` (`verdict.warnings` undefined; the contract doc printed `(none declared …)` with no recovery). | `green-after/cellwork-tests.log` |
| D4 (unstated kept / auto-dispatch) | `red-first/d4-activate-notice-red.log` — `0 pass / 1 fail` (`expected "string", received "undefined"` for `resplit.notice`). | `green-after/cellwork-tests.log` |
| C4 render | `red-first/d3-split-render-red.log` — `0 pass / 1 fail` (`submitted.warnings` undefined). | `green-after/cellwork-tests.log` |
| C3 lane A (bound not wired, description silent) | `red-first/c3-mail-bound-red.log` — `1 pass / 2 fail` (the passing arm is the absent-key control). | `green-after/cellwork-tests.log` |

No defect was closed `already-fixed`: all four reproduced on `d2032bf3`.

## 3. Commands and observed results (final tree)

| command | observed |
|---|---|
| `bun test packages/mpd-cellwork-plugin` | `195 pass / 0 fail`, 2309 expect() calls, 24 files — exit 0 (`green-after/cellwork-tests.log`) |
| `bun test packages/mpd-dsh-adapter-plugin` | `365 pass / 0 fail`, 1460 expect() calls, 24 files — exit 0 (`green-after/adapter-tests.log`) |
| `bun run typecheck` (`tsgo --noEmit`) | no output — exit 0 (`green-after/typecheck.log`); zero errors caused, zero pre-existing |
| `node scripts/verify-comment-coverage.ts` | `VERDICT: PASS …` — exit 0 (`green-after/comments.log`) |
| stray `mpd-gates.json` | none in the checkout or any package dir |

Not run by lane A (integration lane owns them): `verify-dist-fresh` (dist deliberately stale until the
captain rebuilds with the pinned toolchain), `preset-conformance`, `verify:gates`, `verify:docs`,
`verify:manifest`, `verify-pack-closure`, Docker.

## 4. R2 — superseded assertions / frozen strings, OLD and NAMED REPLACEMENT

1. **`packages/mpd-cellwork-plugin/test/flow.test.ts` — the B8 reseed leg.**
   OLD: `dsh.liveAgent: () => undefined` plus `expect(reseeded.outcome).toBe("reseeded")` — i.e. the arm
   only passed while the reseed accepted a parent that was not live (the old `parent: deps.agent`).
   NAMED REPLACEMENT: the double offers the captain (`liveAgent: (id) => id === "session-captain" ?
   liveCaptain : undefined`) and the arm keeps its original subject (the reseed path runs, the stale child
   is interrupted, a fresh handle is minted). The no-live-parent outcome is covered separately by
   `barrier-live-engine.test.ts` C6(g).
2. **`packages/mpd-cellwork-plugin/test/flow.test.ts` — the C2.1 `busy`/`failed`/`noEngine` arms.**
   OLD: the same no-live-parent double, so the reseed leg could only succeed under the old rule.
   NAMED REPLACEMENT: the shared `seams` double offers the captain; the arms' subject (how each engine
   answer is CLASSIFIED before the fallback) is unchanged.
3. **`packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` — one frozen entry.**
   OLD: `protocol.ts :: import { sendMany } from "../../mpd-team-core-plugin/src/mailbox-store"`.
   NAMED REPLACEMENT: `protocol.ts :: import { mailMaxUndeliveredOf, sendMany } from "…"` (captain ruling:
   one bound, one rule; the number of couplings is unchanged — same file, same module).
4. **Test-double completion, no assertion moved:** three `dsh:` literals in `flow.test.ts` gained
   `compactionEngineForLiveAgent` and `liveAgent`, because `PromotionDeps["dsh"]`'s `Pick` now requires them.

## 5. Mail-bound path taken (captain ruling)

Lane A **imports lane B's exported resolver**: `mailMaxUndeliveredOf` from
`packages/mpd-team-core-plugin/src/mailbox-store.ts`, through the import edge that file already had
(`sendMany`). No private duplicate of the number logic and no parity test is needed — the value semantics
are lane B's one implementation. Lane A owns only the seam read (`workspaceConfigReader`) and proves the
call site passes the resolver's answer through, including the `0`-disables-bound edge (an arm in
`mail-bound-config.test.ts`). **Declared dependency:** the cellwork package now compiles only against
lane B's working-tree exports; if lane B's file is reverted, cellwork breaks.

## 6. Older VEdit observations — CHECKED, report only (no fix, no captain ruling)

1. **`cellwork_send` cannot reach a member added later via `agent_teams_plan add_member` — LIVE.**
   Evidence (code): the `cellwork_send` body resolves recipients from the CELL record only
   (`protocol.ts`, `Object.values(target.members)` for the membership check and for `memberIds`), and the
   live team roster is read ONLY by `cellwork_activate` (`flow.ts` wires `recordFor` for `materializeSplit`,
   nowhere else). Nuance: `cellwork_activate` stage 2 DOES import a live-roster member NAMED by an accepted
   split (`activate.ts` "2. MEMBERS", the `existing !== undefined` branch), so a later activation makes it
   addressable. A member added later and not named by a split stays unreachable. No test covers this.
2. **The host's 8-child cap turns a delivery into a CLAIMED-but-undelivered row — LIVE, on the reassign
   path only.** `packages/mpd-team-core-plugin/src/team-actions.ts#applyReassignments` writes the claim,
   the journal row and the ledger BEFORE `deps.send(...)`, so a refused send yields
   `{claimed:true, delivered:false, reason:"the row IS claimed for X but the message failed: …"}`. The MAIN
   pass sends first and claims after, so its failure yields a `skipped` row and an UNCLAIMED task. Both are
   reported — `cellwork_dispatch` renders "CLAIMED, delivery failed: …" — so the state is visible, but the
   row remains claimed for a member that never received it.
3. **`cellwork_dispatch {reassign}` refuses a row whose blocker is still open — LIVE by design, and
   documented.** The same function runs the readiness predicate (`blockingDependencies`) before the CAS and
   refuses with the blocking ids plus the `agent_teams_task {action:"complete"}` repair (`claimed:false`).
   This matches the old observation and looks intentional (wave W2-C gap 1), not a regression.
4. **A member raise failure leaves a roster row without a seat — PARTLY LIVE.**
   (i) An OWNERLESS TASK row is not possible: stage 2 raises members before stage 3 appends tasks
   (`activate.ts` "2. MEMBERS" → "3. TASKS"), so a raise failure returns `fail(...)` before any task for
   that member exists, and the retry resumes from the partial (`test/activate-resume.test.ts` A2/A3).
   (ii) A LIVE roster row with NO executor handle IS possible: `add_member` can succeed while the answer
   carries no `spawned` handle, which returns `fail(...)` AFTER the roster write; the retry's
   duplicate-reconcile path then records a cell member with `executorRef: ""`, and the dispatch/reassign
   paths refuse it with "has no executor handle (never raised)". Report only.

## 7. What I could NOT prove (bounds)

- **The host really awaits the returned listener promise.** The tests prove the listener RETURNS an
  awaitable and that the barrier completes when awaited; the "returned promise is awaited" rule rests on the
  vendored cordis serial dispatch and the repository note (the contract's §8 bound). I did not run a real
  host boot.
- **`preset-conformance` / a real mount.** Two tool descriptions changed (`cellwork_send`, `cellwork_split`,
  `cellwork_activate`) and two output schemas gained fields (`cellwork_split.warnings`,
  `cellwork_activate.notice`), so the captain's integration sweep MUST run the real-mount conformance.
- **`dist`.** Not rebuilt (integration lane owns `packages/*/dist/**`). Because the adapter edit inlines
  into every dependent package, the captain's rebuild must cover the adapter's dependents.
- **No live-LLM checkpoint run.** The host's `startActivation` refusal is reproduced with a registry double
  enforcing `agents.get(parent.id) === parent` (the contract's declared double).
- **The `mail.maxUndelivered` semantics** are lane B's resolver; lane A proves only the wiring and the `0`
  edge.

## 8. Evidence paths

```
evidence/cellwork/vedit-p0/lane-a/
  red-first/{d1-barrier-red, c1-adapter-seam-red, d3-split-warnings-red, d3-split-render-red,
             d4-activate-notice-red, c3-mail-bound-red}.log
  green-after/{cellwork-tests, adapter-tests, typecheck, comments}.log
  report.md   (this file)
```
