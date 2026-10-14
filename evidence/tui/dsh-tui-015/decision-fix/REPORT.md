# decision-fix — the DecisionEvents identity + observability fix, and the gate that remains

Wave **tui-015-adaptation**. Scope: `packages/**` only (no `skills/**` byte, **no git write**).
Host under test: `@deepseek-harness-tui/dsh-tui` **0.15.0**, sandbox `.mpd/recon/qa/tui-lanes/tui-015`.

Hashes of every touched artifact: `hashes.txt` (read at the UTC instant printed in that file).
Every command: `commands.txt`. Gate transcripts: `gates-final.log`.

---

## 1. WHAT CHANGED

| # | Path | Symbol | Change |
|---|---|---|---|
| 1 | `packages/mpd-tui-plugin/src/log.ts` | `createLog` → `emit` | the FILE sink is written **first** and the host logger **second**; the `return` after `ctx.logger` is gone. `debug` keeps its `DSH_TUI_DEBUG` gate on the file side. |
| 2 | `packages/mpd-tui-plugin/src/index.ts` | `apply` | ONE line states the decision seam's aggregate outcome (`decisions.outcome()`) when it reads `absent` at apply time — the case the seam's own disclosure cannot reach. |
| 3 | `packages/mpd-tui-adapter-plugin/src/index.ts` | `TuiAdapter.requestDecisionEvent` | the host identity is the **bound seam scope** (`scope` from `whenBoundInternal`), for BOTH `grants.allows(…)` and `host.subscribeDecision(…)`. `options.identity ?? fallbackIdentity` is gone from this path; the option field stays for source compatibility and is documented as NOT forwarded — the `setStatus` rule, verbatim in style. |
| 4 | `packages/mpd-tui-plugin/src/decisions.ts` | `attemptDecisionEvents` | drops `identity: ctx` from the subscription options, and its module header now records the measured refusal. |
| 5 | `packages/mpd-tui-plugin/test/plugin.test.ts` | 2 new arms | the identity argument IS the bound seam scope; a consumer-supplied `options.identity` is NOT forwarded. |
| 6 | `packages/mpd-tui-plugin/test/state.test.ts` | 2 new arms | the FILE sink is mirrored even when the host logger takes the line; the debug gate opens for the file under `DSH_TUI_DEBUG`. |

`attemptDecisionEvents(ctx, tui, log)` **keeps** its `ctx` parameter (mirroring the adapter's own
`identity` precedent: kept for source compatibility, deliberately not forwarded). It is now unused for
identity; removing it would change an exported signature for no gain.

### Deviation from the task text, stated
The task described the index.ts change as "log … when the seam **never** binds". The measured boot shows
that a synchronous read inside `apply` cannot distinguish *never* from *not yet*: the adapter's deferred
`ctx.inject(["tuiPluginHost"], …)` callback runs **after** `apply` returns, so the line fires in every
boot whose host binds late (which is every boot measured). The line's wording was therefore changed to an
**observation** ("read at apply time; the seam discloses its own verdict once it binds") rather than an
`ABSENT` verdict, and the measurement that forces it is recorded in the code comment. See
`final-bytes-mpd-tui.log` lines 194/202 for the two-instant sequence.

---

## 2. GATES (final bytes, observed)

| Gate | Command | Observed |
|---|---|---|
| Dist freshness | `node scripts/verify-dist-fresh.ts` | `ok: 31/31 targets fresh (each rebuilt twice, byte-identical)` — exit **0**; toolchain `bun 1.4.0 from the repository toolchain` |
| Tests (touched pkgs) | `bun test packages/mpd-tui-plugin packages/mpd-tui-adapter-plugin` | `560 pass · 0 fail · 13832 expect() calls` |
| Tests (whole repo) | `bun test packages` | `1939 tests · 3 skip · 0 fail` |
| Typecheck | `bun run typecheck` (`tsgo --noEmit`) | exit **0** |
| Declaration comments | `bun run verify:comments` | `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature` |

Both dist entries were rebuilt with the **pinned** toolchain from the repo root, path-qualified:
`.toolchain/node_modules/.bin/bun build packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js`.
The adapter edit did **not** fan out: only the two rebuilt targets were flagged STALE.

### Negative controls (an arm that cannot fail is not evidence)
* **Identity arms** — with the pre-fix rule restored (`host.subscribeDecision(options.identity ?? fallbackIdentity, …)`):
  `bun test … -t "identity"` → **0 pass, 2 fail**. Source restored; `sha256sum -c` on the three files
  (src + both dists) reports `OK` — byte-exact restoration.
* **Log arm** — with the sink made unreachable while a host logger exists (the old `return`):
  `bun test … -t "FILE sink"` → **1 fail** (`Received: []`). Restored; `log.ts` hash matches the
  pre-mutation value.

---

## 3. THE LANE RE-RUN — arm3 does NOT flip, and here is the named gate

Recipe exactly as prescribed: `XDG_RUNTIME_DIR` inside the sandbox, `pnpm_config_registry=https://registry.npmmirror.com`,
the sandbox profile's own 0.15.0 launcher prepended to `PATH`, sandbox root
`.mpd/recon/qa/tui-lanes/tui-015`. Evidence: `lane-final.evidence/` (run **2026-10-14T11:30:05.219Z**),
raw lane stdout `lane-run-final.log`.

```
[tui-admission] arm3 attribution: attributed=0 decisionHandlerBinds(applied)=0 (ledger delta=20)
[tui-admission] arm3 host wiring: `decision-handler` binds are wired by plugin-host.js#subscribeDecision but none fired
[tui-admission] arm3 identity differential: admission loader admitted=61 refused=0 (this boot) vs admitted=0 refused=61 (negctl)
[tui-admission] FAIL: {"static":true,"staticGrants":true,"arm1":true,"arm2":true,"arm3":false,"arm4":true,"arm5":true,...}
```

**`arm3` (`attributed.length > 0 && handlerBinds.length > 0`) stays RED — `false`. The arm was not touched.**

### The NEW disclosure line, now readable
`final-bytes-mpd-tui.log` — the workspace sink carried **36 `[mpd-tui]` lines** (132 `[mpd-tui-adapter]`
lines in the same file). Before this fix the same file carried **0 `[mpd-tui]` lines** — that is the
Architect's measurement in `evidence/tui/dsh-tui-015/triage-reds/REPORT.md` §3, not re-measured here
(the pre-fix sink state was not preserved), and it is the finding this change removes:

```
[mpd-tui] decision-event seam: no intercept point attempted — the mediated plugin host was not injected
          (read at apply time; the seam discloses its own verdict once it binds)
[mpd-tui] decision-event seam is ready but NOT activated: tui.dsh/v1alpha1#DecisionEvents registration was
          refused (first refusal: the calling activation has no verified dsh-plugin.json Component identity).
          No input/rewind/session-switch/compact interception is claimed.
```

### THE NAMED GATE — and the differential that proves the identity fix is load-bearing
The same lane re-run with the **pre-fix** identity rule (`options.identity ?? fallbackIdentity`; sources
mutated, rebuilt, lane re-run at **2026-10-14T11:32:32.360Z**, then restored byte-exactly) produced a
**different** refusal string:

| identity argument | refusal string (first refusal) | host site |
|---|---|---|
| pre-fix: consumer ctx | `dsh-tui: mediated capability requires a non-root activation context from the host composition` | `plugin-host.js#subscribeDecision` → `assertActivationContext` |
| **fixed: bound seam scope** | `the calling activation has no verified dsh-plugin.json Component identity` | `plugin-host.js#subscribeDecision` → `requireComponentIdentity` → `component-identity.js` |

Evidence: `prefix-identity-mpd-tui.log` vs `final-bytes-mpd-tui.log`; lane runs
`lane-prefix-identity.evidence/` vs `lane-final.evidence/`.

So the fix **moved the failure one gate deeper**: the bound scope is accepted as a live non-root activation
and passes `assertCallerContext`; what refuses now is the host's **Component ADMISSION** —
`requireComponentIdentity(caller)` is a `WeakMap` keyed by the activation's Cordis **fiber**, populated
only by `bindComponentIdentity`. A patch row's activation never receives one.

**This is the next fix's target, and it is host-side by construction**: no identity argument this row can
supply satisfies `requireComponentIdentity`. Flipping arm3 requires either the activation context the
admission loader bound for `com.mpd-dsh.mpd-tui`, or a host-side change. `arm3` must stay red until then.

---

## 4. HONEST BOUNDS

* **arm3 is RED.** Nothing here flips it; the fix is necessary and provably load-bearing, not sufficient.
* The pre/post differential was measured on **two different dist bytes** (the lane pins
  `packages/mpd-tui-plugin/dist/index.js`; the two runs carry different `.revision.sha256`). The final
  lane run's pinned artifact is `9315076d2acebddb…`, **identical** to the committed dist at hand-off.
* The single-unit-level proof that the identity is the *bound scope* (rather than merely *some* live
  context) is the negative-controlled unit arm; the lane proves only that the refusal moved past
  `assertActivationContext`/`assertCallerContext`.
* `packages/mpd-tui-plugin/src/{log,decisions}.ts` received **comment-only** edits after the lane run.
  Neither reaches the built bytes (`bun build` strips comments — proved by `verify-dist-fresh` staying
  `31/31` fresh with **no** rebuild), and the lane's own pinned artifact
  (`packages/mpd-tui-plugin/dist/index.js`, sha `9315076d2acebddb…`) is unchanged, so the lane evidence
  still describes the artifact at hand-off. `hashes.txt` records both src and dist.
* `attemptDecisionEvents`' `ctx` parameter is now unused for identity. Deliberate; stated above.
* The apply-time line fires in **every** measured boot (late bind), not only in a never-binding one —
  hence the reworded, non-verdict phrasing. Its "never binds" value is unproven by a live boot: no
  host-less `dsh-tui` composition was run in this pass.
* No `skills/**` byte was touched; no git write was made (`git diff`/`git status` only, read-only).
