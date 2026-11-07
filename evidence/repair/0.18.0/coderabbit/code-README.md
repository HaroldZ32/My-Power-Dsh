# CodeRabbit round 1 — the TWO CODE findings on PR #103

Seat: Senior Engineer (code repair only; no documentation file touched).
Branch: `feature/upstream-0.18.0` at `b0d9ecb7`.
Nothing was committed, added or checked out (the captain owns the single git writer, AGENTS.md §5).

**Both findings were VERIFIED against the live code before editing.** Finding A reproduces and is
FIXED; Finding B's two parts are both FIXED, with one honest nuance recorded for B2 (its literal
`null` example was already refused at HEAD — the reproduced hole was arrays and primitives).

| # | Finding | Verdict |
|---|---|---|
| A | `dshGo` inject callback probes once and caches the bridge | **FIXED** |
| B1 | a 180 s timeout is indistinguishable from a gate violation | **FIXED** |
| B2 | `gate.report.parseable` accepts non-report JSON shapes | **FIXED** (null sub-claim already held at HEAD) |

**Quotable reconciliation line for the PR:** *Round 1 code findings: A FIXED, B1 FIXED, B2 FIXED
(the `null` example in B2 was already refused by the pre-fix predicate; arrays and primitives were the
reproduced hole and are now refused too). No round-1 CODE finding remains STILL-VALID.*

Files changed (all inside this seat's declared scope):

- `packages/mpd-dsh-adapter-plugin/src/index.ts` — `bindDshGoBridge()` per-activation binding.
- `packages/mpd-dsh-adapter-plugin/test/adapter-dshgo-surface.test.ts` — the regression arm.
- `skills/dsh-qa/scripts/dshgo-standard.ts` — timeout attribution + strict report shape.
- `skills/dsh-qa/SKILL.md` — the case row's arm count (5 → 10 judge controls) and what the new arms pin.

## Finding A — the inject callback cached the bridge (VALID, FIXED)

**Claim, verified.** At `b0d9ecb7` the callback opened with

```ts
if (scopedDshGo !== undefined && scopedDshGo !== null) return
```

so a second firing never re-probed and never returned a cleanup. The cordis contract
(`registry.d.ts:104-111`, cordis 4.1.0 in the pinned harness 0.2.2-rc.1) is explicit: the callback
*"is unloaded and re-run whenever a required service changes"*.

**RED PROOF on the HEAD source, driven by the REAL cordis and the REAL `createDshAdapter`** — provide a
`dshGo` bridge, dispose it, provide a new one:

```
after provider 1.0.9: present=true caps={"app":"1.0.9"}
after 1.0.9 unload:   present=true caps={"app":"1.0.9"}   <- stale bridge survives its own unload
after provider 2.0.0: present=true caps={"app":"1.0.9"}   <- the newer bridge is never probed
```

**GREEN PROOF on the fixed tree, same probe:**

```
after provider 1.0.9: present=true  caps={"app":"1.0.9"}
after 1.0.9 unload:   present=false caps=null             <- the cleanup cleared its own binding
after provider 2.0.0: present=true  caps={"app":"2.0.0"}  <- each activation binds the bridge IT probed
```

**Fix shape.** The callback probes into a local `bound`, publishes it, notifies, and returns
`() => { if (scopedDshGo === bound) scopedDshGo = undefined }` — the identity guard is what keeps an
older activation's unload from clobbering a newer binding, whichever order cordis replays them in.

**Preserved:** the guarded `scoped?.dshGo` property read (it throws on an undeclared service), the
`scoped.get("dshGo", false)` probe, the `onServiceBound` notification path, and the absent-service
behaviour — a bridgeless host never fires the callback, so nothing registers, nothing polls, and the
consumer's ONE `dshGo=absent` line (`packages/mpd-bundle-plugin`) is untouched.

**New arm:** `a re-fired inject binds ITS OWN bridge, and an unload clears only its own binding` —
fires the inject twice with distinct bridges, replays the OLDER unload last, and asserts the newer
binding survives it. It reddens on the HEAD source (no cleanup is returned at all).

## Finding B1 — a timeout was unattributable (VALID, FIXED)

`runGate` now returns `signal`, `error` (`code: message`) and `timedOut`
(`error.code === "ETIMEDOUT"`, the flag spawnSync sets on its own timeout). Every gate/control log line
and every exit-check detail renders `runDetail()` — `exit=… signal=… timedOut=… error=…` — and
`result.json` carries `gate {exit, signal, timedOut, error, detail}` and `control {…}` beside the
pre-existing `gateExit`/`controlExit` keys. A new named check, `gate.timeout`, fails whenever
`timedOut` is true, so a killed child can never be credited as a pass by an exit predicate that
tolerates `null`. The existing exit-status predicates are unchanged (`0` with the kit, `3` without).

**Honest bound:** on the pre-fix code a timed-out run was already REFUSED (`null !== 0` and
`null !== 3`), but it was not ATTRIBUTABLE — the only trace was `exit = null`. The new arms redden on
pre-fix code because the check they NAME did not exist.

## Finding B2 — the parseable predicate admitted non-report shapes (VALID, FIXED)

Pre-fix predicate at HEAD line 126: `gate.report !== undefined && gate.report !== null`. Measured over
the shapes a `--json` file can parse to:

```
shape          | OLD parseable | NEW parseable
null           | false         | false
array          | true          | false
number         | true          | false
string         | true          | false
boolean        | true          | false
object         | true          | true
```

`reportCheck()` now passes ONLY for `typeof report === "object" && report !== null && !Array.isArray(report)`,
and its detail distinguishes the four outcomes: valid object / missing file / unparsable (with the
JSON.parse message) / a non-object (named as `null`, `an array`, `a number`, …). `GateRun.reportProblem`
is a discriminated union, so "missing" and "unparsable" no longer collapse into one `undefined`.

**Nuance for the reviewer:** the literal `null` example does not reproduce — `!== null` already refused
it. The class of bug is real for arrays and primitives. The `null` arm is kept as a regression pin.

## Gates — observed exits (full transcript: `code-gates.log`)

| Gate | Exit | Observed |
|---|---|---|
| `bun run typecheck` | 0 | `tsgo --noEmit`, no output |
| `node scripts/verify-comment-coverage.ts` | 0 | 614 files, 55047 declarations, VERDICT: PASS |
| `bun test packages/mpd-dsh-adapter-plugin` | 0 | 395 pass, 0 fail, 1573 `expect()`, 27 files |
| `bun skills/dsh-qa/scripts/dshgo-standard.ts --self-test` | 0 | 11 arms (10 judge controls + 1 real control) |
| `MPD_DSHGO_KIT="$PWD/.mpd/tmp-dshgo/kit" bun …/dshgo-standard.ts` | 0 | gate `exit=0 cross-check=passed`, 7/7 checks PASS |
| `node scripts/verify-dshgo-standard.ts --self-test` (extra) | 0 | 44 arms |

Two EXTRA runs, reported honestly because they are RED by construction:

- `bun test packages` (full suite): **3692 pass, 6 skip, 2 fail**. Both failures are the T-62
  "shipped artifact" dist-freshness assertions in `mpd-ext-plugin` and `mpd-roles-plugin`, which replay
  `verify-dist-fresh` over their own `dist/` — stale because `bun build` INLINES the edited adapter.
- `node scripts/verify-dist-fresh.ts`: **FAIL — 24 of 34 targets not fresh (STALE: 24)**, the expected
  consequence of editing `packages/mpd-dsh-adapter-plugin/src` without rebuilding `dist/**` (this
  seat was instructed not to; the captain/integrator owns `dist/`).

## What the integrator must do

1. **Rebuild `dist/` with the PINNED toolchain** (`.toolchain/node_modules/.bin/bun`, 1.4.0), from the
   repo root, for the adapter and every package whose dist inlines it — `verify-dist-fresh.ts` names
   each target with its exact command. That turns the two suite failures and the dist gate green.
2. **Re-pin `VENDOR_LOCK.json`** in the same commit: `skills/dsh-qa/**` changed (AGENTS.md §9/§11;
   `node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step`).
3. **Do not rebuild `dist/` from a package directory** — the gate flags it (the entry path embeds cwd).

## Evidence files in this directory (this seat's only writes)

| File | What it is |
|---|---|
| `code-red-proof-finding-a.log` | the HEAD-vs-fixed real-cordis adapter probe + the unit arms |
| `code-red-proof-finding-b.log` | the pre-fix field/predicate greps and the OLD-vs-NEW predicate table |
| `code-gates.log` | every command with its observed output and exit code |
| `code-change.diff` | the exact code diff (scoped to this seat's four files) |
| `code-result.json` | machine-readable reconciliation |
| `dshgo-real/{result.json,output.log,gate.json,control.json}` | the real dshgo-standard run's artefacts |

The doc seat's files in this same directory (`README.md`, `result.json`, `change.diff`,
`code-verification-f1.log`, `code-verification-f2.log`) were **not** touched.
