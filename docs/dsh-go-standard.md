# The DSH-Go native-plugin standard

**English** | [中文](./dsh-go-standard.zh-CN.md)

This page states the **DSH-Go native-plugin standard** this bundle implements, the way it is proven, and
the bounds of that proof. The standard is pinned to `ccch1mneyyy/dsh-Go` at commit
`d5ad25c5bc4c66ecacee76b3c5378db45e1db3fa` (2026-11-06). The enforcement point is
`node scripts/verify-dshgo-standard.ts`, a standing gate ([`AGENTS.md`](../AGENTS.md) §4).

## 1. What the standard is, and the spec data this repository pins

The upstream authority is three things: the numeric table
`runtime/bridge/dsh-go-bridge/lib/native/limits.js`, the bridge's `manifest.js` structural rules, and the
five JSON Schemas plus the app's `view-check.js` view budgets. This repository captures those bytes as
**spec data**, never as vendored executable code:

| Asset | What it is |
|---|---|
| [`specs/dsh-go/limits.ts`](../specs/dsh-go/limits.ts) | a SPEC-DATA transcription of `limits.js`: numbers, closed value sets and patterns, one upstream symbol named per declaration. Nothing in it computes anything. |
| [`specs/dsh-go/schemas/`](../specs/dsh-go/schemas) | byte-for-byte copies of the five upstream JSON Schemas (`manifest`, `contributions`, `view`, `stream`, `invoke`). |
| [`specs/dsh-go/SOURCE.json`](../specs/dsh-go/SOURCE.json) | the pinned repository, the commit and a per-file `sha256` for every fetched file. |
| `VENDOR_LOCK.json` | fingerprints the whole `specs/dsh-go/` tree as its own asset, so a drifted transcription or schema reddens `node scripts/verify-vendor.ts`. |

**The executable SDK is deliberately absent.** `@dsh-go/plugin-kit` is `private: true` on npm, so it
cannot be a dependency; and this repository's de-vendor policy forbids vendoring upstream executable code.
Numbers, closed value sets and patterns are the same class as the JSON Schemas beside them, so they are
transcribed and pinned rather than imported. That is a policy line, not an oversight: the gate
CROSS-CHECKS the shipped engine's own runtime constants against this table, so a divergence between our
code and the published standard is a gate failure instead of a silent drift.

## 2. The manifest: the seven slots and their caps

A `dshGo` block lives in the root `package.json`. Only `v` and `contributes` are required; `capabilities`
is optional. `engines.dsh` lives in `package.json`, **not** inside `dshGo`. The serialized block must stay
inside 16 KiB, every contribution id must be unique **across** slots and match
`^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$`.

| Slot | Per-plugin cap | This bundle declares |
|---|---|---|
| `composer.actions` | 2 | `mpd-dispatch`, `mpd-board` (2) |
| `message.actions` | 2 | `mpd-save-memory`, `mpd-copy-reply` (2) |
| `composer.strip` | 1 | `mpd-status` (1) |
| `panels` | 4 | `mpd`, `mpd-team` (2) |
| `composer.tools` | 2 | none |
| `session.actions` | 2 | none |
| `turn.note` | 1 | none |

Two further rules shape what a contribution may say. **`wants` pairing:** a `draft` or `clipboard` want is
legal only on `composer.actions` and `composer.tools`, and `message` only on `message.actions`. This bundle
declares `wants: ["message"]` and puts its two actions on `message.actions`, which is the pairing the
standard allows. **Static `effect` kinds** are limited to the six the invoke schema names (`insert`,
`command`, `open`, `link`, `copy`, `toast`), at most four per item; `mpd-board` uses the static
`{ type: "open", page: "panel:mpd-team" }` effect and therefore needs no handler at all.

## 3. Display text: per-locale limits

Every display string is measured **per locale**, in code points: the English and Chinese values are two
separate measurements, never one. The caps and this bundle's measured maxima:

| Field | Cap | This bundle (en) | This bundle (zh) |
|---|---|---|---|
| `pluginTitle` | 24 | 3 (`MPD`) | 3 (`MPD`) |
| `panelTitle` | 16 | 13 (`MPD Workbench`) | 7 (`MPD 工作台`) |
| `panelTitle` (second panel) | 16 | 14 (`MPD Team Board`) | 8 (`MPD 团队看板`) |
| `stripText` | 24 | 1 (`—`) | 1 (`—`) |
| `composerAction` | 10 | 8 (`Dispatch`) / 5 (`Board`) | 2 (`派活`) / 2 (`看板`) |
| `messageAction` | 12 | 11 (`Save memory`) / 10 (`Copy reply`) | 4 (`存为记忆`) / 4 (`复制正文`) |
| `composerTool` | 8 | none | none |
| `sessionAction` | 12 | none | none |
| `turnNote` | 16 | none | none |
| `toast` | 40 | runtime copy | runtime copy |

A value over its cap is a NOTE, not a failure: the bridge truncates an over-length label and warns, and this
gate mirrors that severity. A duplicate id or a structural violation is an ERROR and fails.

## 4. View budgets, and v1 versus v2

| View | Bytes | Nodes | Depth |
|---|---|---|---|
| tool card | 8192 | 40 | 6 |
| panel | 32768 | 120 | 8 |
| composer strip | 2048 | 8 | 3 |

**View v1 is always served; view v2 is opt-in and downgraded.** Every panel names a hand-written STATIC
fallback under `dsh-go/views/`, and those files are view v1: no `$` binding, no v2-only component. The live
trees the panels build are v2, and `adaptView` in the adapter rewrites them for an older app: tabs become a
stack of titled sections, a grid becomes a list, badges become text, `divider`/`spacer` disappear and every
`style`/`accent` is stripped, while a metric's label AND value survive. One builder produces both shapes, so
the fallback cannot drift from the tree it was derived from. A tool card is v1 by construction: no bindings
and no buttons, and anything over budget or carrying a v2-only component degrades to `{}`, where the app
renders its own generic tool row.

## 5. The host half: binding the `dshGo` bridge

The standard asks the plugin to bind the bridge with `ctx.inject(['dshGo'], …)`. The optional-inject spelling
`'dshGo?'` is not cordis syntax, and a `dshGo` entry in a top-level `inject` array would keep a bridgeless
host from starting the row at all. Once bound, the plugin registers exactly what the manifest advertises:
one `on(id)` per non-static entry, one `panel(id)` per panel, and no registration for an id the manifest does
not declare.

**How this bundle satisfies that rule — and the one deliberate deviation.** This repository centralises
every harness-service touch in `mpd-dsh-adapter-plugin` ([`AGENTS.md`](../AGENTS.md) §6), so the plugin rows
never name a harness service directly. The deferred inject therefore lives in **the adapter**, not in the
bundle plugin: the adapter registers exactly ONE `ctx.inject(["dshGo"], …)`, and every dshGo read goes
through a scoped accessor that falls back to the lazy root probe when the inject seam is absent. The bundle
rows keep calling the adapter's `dshGoPresent()` and `onServiceBound(["dshGo"])`. The rule's intent is
satisfied — the plugin's only contact surface binds the bridge the sanctioned way, exactly once — while the
architectural rule (one contact file) is preserved. The rows' own `export const inject: string[] = []`
stays empty, and no `'dshGo?'` appears anywhere.

**A host without the bridge pays nothing.** Nothing is registered, ONE `dshGo=absent` line is logged, and
there are zero timers and zero polling: the row subscribes to the service-bound seam instead of polling for
it. That is the backward-compatibility statement on this plane, and it is unit-covered, including an arm
that counts `setInterval` calls.

## 6. The gate: five lanes, one exit contract

`node scripts/verify-dshgo-standard.ts` is the conformance gate. Its lanes and what each one may and may
not prove:

| Lane | What it proves | Bound |
|---|---|---|
| MANIFEST | the `dshGo` block and the package fields around it: `v`, a `contributes` object, the 16 KiB ceiling, ids unique across slots and pattern-legal, per-slot caps, per-locale text limits, `wants` pairing, static `effect` kinds, panel enums, a strip's `panel` naming a declared panel, `engines.dsh`, and the `dsh.bundle.patch` files the install path resolves | static |
| VIEW | every static view a panel declares: inside the package, parses, inside the panel budget, view v1, v1 components only, no `$` binding, no external image, design lint | static |
| COMPAT | backward compatibility: a declared static view stays a legacy v1 tree; the kit still ships `adaptView` + `V1_COMPONENTS`; downgrading every v2-only name leaves no v2-only node; the adapter's v1/v2 catalogs partition the schema's component names | static |
| HOST | the host half binds the bridge the sanctioned way and registers exactly what the manifest advertises (no `'dshGo?'`, no top-level `inject` entry, the adapter's probe or `ctx.inject(['dshGo'], …)` present, one `dshGoPanel(id)` per panel, a handler per non-static id, no unregistered id) | source-text walk — **not a boot** |
| CROSS-CHECK | when `MPD_DSHGO_KIT` names a DSH-Go checkout, its own `check.mjs --json` runs and the two verdicts are compared | host-bound; absent kit = NOT-PASSED |

Exit codes are the contract the aggregator honours: **0** every lane legal, **1** one or more violations,
**2** cannot run (unreadable `package.json`, unknown flag, a misbehaving self-test arm), **3** NOT-PASSED when
the official cross-check could not run. `--self-test` runs **44 arms** — one clean control and 43 negative
controls, one per rule family — and it exits 0 on this tree.

The gate is a **standing** member: it is the eleventh member of `bun run verify:gates`, `gates.yml` checks
out the pinned upstream commit with a sparse `sdk/plugin-kit` checkout and exports `MPD_DSHGO_KIT` before the
aggregate, and `publish.yml` runs it BEFORE `npm pack` / `npm stage publish`, so a non-conforming manifest
cannot be staged for a release. `scripts/verify-dshgo-views.ts`, its predecessor, is **retired**: the file is
still present on disk, but no npm script, aggregate or workflow calls it any more.

## 7. The official cross-check, and its one known false negative

`MPD_DSHGO_KIT` names a DSH-Go checkout. **Without one the lane reports NOT-PASSED (exit 3): a cross-check
that did not run is never a green.** `--require-dshgo-kit` states the absence as an explicit requirement in
the transcript; the exit code is 3 either way, by design, so the aggregate is RED until a checkout is
supplied.

One official false negative is isolated explicitly. The upstream `check.mjs` requires `dsh.bundle.patch` to
be a **string**, while a DSH bundle may declare an **array** of patch layers — this repository does. When
that single item is the only blocking item in the official report and the gate's own MANIFEST lane resolved
every declared patch path, the comparison excludes it and prints `crosscheck-normalized` as a NOTE; the raw
official exit code stays quoted in the report. Every other official error, a non-`ok` manifest state and a
fatal view still stop the plugin.

## 8. What this page does not prove

- **No Flutter app exists in this repository**, and nothing was rendered on a device: the native half is
  proven against the published standard, the pinned spec data and service doubles.
- The **HOST lane is static source analysis**, not a mounted boot; an id supplied through a lowercase
  variable and never spelled as a resolvable key would be invisible to it.
- The tool-card and degradation arms assert the kit's behaviour on **synthetic trees**, not on a real tool
  result.
- The **official checker is not vendored**; with no checkout the CROSS-CHECK lane is NOT-PASSED, and that is
  a declared bound rather than a pass.
- A skipped Docker lane is not a pass.

## 9. Where the detail lives

The spec data is [`specs/dsh-go/`](../specs/dsh-go); the gate is
[`scripts/verify-dshgo-standard.ts`](../scripts/verify-dshgo-standard.ts) and its QA case is
[`skills/dsh-qa/scripts/dshgo-standard.ts`](../skills/dsh-qa/scripts/dshgo-standard.ts). The manifest lives
in [`package.json`](../package.json) (`dshGo`), the static views in [`dsh-go/views/`](../dsh-go/views), the
view kit in `packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts`, and the panels/surfaces in
`packages/mpd-bundle-plugin/src/dshgo-*.ts`. The user-facing surface is described in
[`drive-surface.md`](drive-surface.md) §4, and the three-plane compatibility matrix in
[`compatibility.md`](compatibility.md).
