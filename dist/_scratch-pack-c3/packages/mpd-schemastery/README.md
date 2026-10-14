# @mpd-dsh/schemastery

[中文](./README.zh-CN.md)

The mpd-owned home of the schemastery validator the bundle's four schema-declaring plugins import,
plus the DSH runtime modules this repository's own test suite drives directly. Every byte here was
relocated out of the retired `packages/mpd-agent-teams-plugin/_deps/**` closure; nothing here is
fetched at build or install time.

## Why this package exists

Until the `de-vendor-and-verify-law` wave, this bundle reached its schema validator through
`packages/mpd-agent-teams-plugin/_deps/schemastery` — a directory inside the ADOPTED
`dsh-agent-teams` body. That package is deleted, so the validator (and the framework modules the
suite needs) moved here, into an mpd-owned tree, in the SAME commit as the deletion.

## What is in it

| Path | What it is | Who reads it |
|---|---|---|
| `lib/index.ts` | The schemastery validator (`Schema`, the default export) | SHIPPED code: `mpd-config-plugin/src/{index,settings-schema}.ts`, `mpd-team-watchdog-plugin/src/index.ts`, `mpd-tui-plugin/src/index.ts` |
| `lib/cosmokit.ts` | schemastery's own dependency (`Binary`, `clone`, `deepEqual`, …) | `lib/index.ts`, `harness/cordis/lib/index.ts` |
| `lib/types/index.d.ts` | schemastery's type declarations, which also declare the GLOBAL `Schemastery<T>` interface and the `Schemastery` namespace | the four importers above, through this package's `exports.types` |
| `harness/cordis/` | The cordis runtime (`Context`, `Service`, the event dispatcher) | TESTS ONLY |
| `harness/dsh-tools/` | The harness tool layer (`assertSupportedJsonSchema`, `validateJsonSchemaValue`, `defineTool`, …) | TESTS ONLY |
| `harness/dsh-llm/` | The harness LLM layer (`createUserMessage`, `LlmError`, …) | TESTS ONLY |
| `harness/dsh-session/` | The harness session layer (`isJsonValue`, `freezeMessage`, …) | TESTS ONLY |
| `harness/dsh-scope/` | The harness scope layer (`scopeOf`, `scopeTarget`, …) | TESTS ONLY |
| `harness/dsh-timeout/` | The harness timeout constants (`MAX_TIMER_DELAY_MS`) | TESTS ONLY |

**Why the harness modules keep the `<name>/lib/index.ts` + `<name>/package.json` shape.** It is
upstream's own layout, and it is LOAD-BEARING, not decorative: `harness/dsh-llm/lib/index.ts` reads
its sibling manifest at runtime with `createRequire(import.meta.url)("../package.json")` to build the
`User-Agent` version of the harness's product identity. Flattening the module one level up would make
that read resolve to the wrong directory, so both levels stay exactly where upstream put them.

The last six modules are pulled in transitively by the four test files that need a REAL cordis
dispatcher or a REAL harness validator rather than a double:
`packages/mpd-team-watchdog-plugin/test/{pre-step-waterfall,tool-inflight}.test.ts`,
`packages/mpd-tui-plugin/test/plugin.test.ts`,
`packages/mpd-dsh-adapter-plugin/test/adapter.test.ts` and
`packages/mpd-ulw-plugin/test/engine.test.ts`. They are self-contained: the eight relocated files
import nothing outside this package and `node:*` builtins, so the suite needs no network and adds
no npm dependency.

## Import shapes

- The four shipped plugins import the validator as a PACKAGE DIRECTORY —
  `import z from "../../mpd-schemastery"` — which is what makes this package's `exports.types`
  load `lib/types/index.d.ts`. That file is the sole declaration of the global `Schemastery<T>`
  interface `export const Config: Schemastery<Config>` relies on; a direct `lib/index.ts` import
  would silently make `z` untyped.
- The test files import their harness module by FILE with the explicit `.ts` extension, e.g.
  `import { Context } from "../../mpd-schemastery/harness/cordis/lib/index.ts"`.

## Rules this package lives under

- **Not typed here.** Every relocated file carries a first-line `@ts-nocheck`: it is upstream code
  this repository relocated, not code it authored, so `scripts/verify-comment-coverage.ts` exempts
  the whole of `packages/mpd-schemastery/{lib,harness}` (`EXCLUDED_PATH_PREFIXES`) and the imports stay
  untyped by design.
- **No build.** There is no `src/`, no `dist/` and no `scripts.build`: nothing bundles this
  package. `bun build` INLINES these files into whichever plugin imports them, and
  `node scripts/verify-dist-fresh.ts` has no target here.
- **MIT.** `LICENSE` reproduces both upstream notices in full (Shigma for
  schemastery/cosmokit/cordis, DeepSeek for the `@deepseek-ai/dsh-*` modules). Both are also
  acknowledged in the repository's `LICENSE-NOTICES.md`.
