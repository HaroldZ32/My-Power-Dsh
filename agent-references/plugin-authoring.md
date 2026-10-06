# Plugin authoring (the full former §6 body)

Agent-facing reference (English-only by the bundle's language policy; `bun run verify:docs` does not
discover this tree). **On demand — never auto-injected**: this file is deliberately not named
`AGENT.md`/`AGENTS.md`/`CLAUDE.md`, so the workspace instruction loader never reads it. `§N` citations
below refer to `AGENTS.md` sections, whose numbering is stable.

Provenance: moved from `AGENTS.md` §6 ("Plugin Authoring Guide") on 2026-10-06 by the instruction-budget split (the
manual must stay under the harness's 65,536-byte workspace-instruction budget, and it was already
over at the previous HEAD). The block below is reproduced VERBATIM — its byte count and sha256 are
recorded in `evidence/gates/agents-budget/20261006T085805Z/result.json`. `AGENTS.md` §6 carries the BINDING rules and points
here for the full body; where the two differ, the manual wins.

## The former §6 body (verbatim)

## 6. Plugin Authoring Guide

Structure per plugin package: `src/index.ts` (cordis `name`/`inject`/`apply`), `packages/<pkg>/dist/index.js`
(bun build), `README.md`, optional `package.json` with `@mpd-dsh/<name>` naming.

- **Harness seams go through `mpd-dsh-adapter` — binding.** No plugin row may touch a harness service
  directly (`ctx.tools`, `ctx.subagents`, `ctx.skills`, `ctx.agentPresets`); `packages/mpd-dsh-adapter-plugin`
  is the ONE file allowed to, so a harness release that renames or reshapes a seam is absorbed there
  instead of across every plugin. Resolve it with the adapter's own helper,
  `const dsh = resolveDshAdapter(ctx)` (the mounted `mpdDsh` instance, or a row-private
  `createDshAdapter` so the plugin stays standalone in unit tests) — or `createLazyDshAdapter(ctx,
  { label })` when the row must also survive a transient "provider not ACTIVE yet" miss. The
  package also carries the bundle's pure, harness-free helpers (`src/shared.ts`, re-exported from the
  entry: `isRecord`, `errorMessage`, `bundleRootOf`); the SEAM surface stays
  `src/index.ts`. The skill-frontmatter subset has ONE implementation for both the extension skill
  plane and the bundle corpus (`packages/mpd-ext-plugin/src/skill-frontmatter.ts`).
  QA proves the surface: `bundle-lifecycle` asserts the row, the boot log line and the probe's
  `ADAPTER_SEAMS`/`ADAPTER_TOOL_CALL=ok`.
- **DSH-TUI seams go through `mpd-tui-adapter` — binding, the SAME rule on the second plane.** No file
  outside `packages/mpd-tui-adapter-plugin` may name a `ctx.tui*` service, nor the `commands`/`settings`
  services that plane uses; resolve it with `resolveTuiAdapter(ctx)` / `createLazyTuiAdapter(ctx,
  { label })`, binder = ONE deferred `ctx.inject([id], …)` PER SEAM, probe = `ctx.get(id, false)`, and a
  seam that never binds degrades to `absent` rather than failing the boot. The plane's log sink and the
  R5 "never fd 1 or fd 2" rule live there too. Two gates pin it: `no-direct-tui-access` (a NEW direct
  touch) and `no-terminal-writes` (a NEW terminal write). Full contract, the fourteen seams and the
  declared WEB-plane residual: `agent-references/seam-adapters.md`.
- **ONE DSH-TUI contact is NOT a seam, is COUNTED, and lives in that same adapter (2026-10-05).** The
  host's built-in `dashboard` action owns `Ctrl+A` and no contribution kind can reach it, so the
  adapter resolves the INSTALLED host root and dynamic-imports `<root>/lib/types/ui.js` **by file URL**
  (a package specifier is refused: the host's `exports` map has no `./lib/*` subpath) to obtain the
  host's own `useStdin`, exposing it as `hostInput()`. Module-instance identity is the whole point —
  Node caches ESM by resolved URL, so the hook is supposed to read the SAME React context the host
  does; MEASURED on dsh-tui 0.12.0 it does NOT (the import is a foreign instance whose `useStdin()`
  answers nothing), so the adapter ALSO stores the live kit a SCENE render receives
  (`rememberHostKit`) and prefers it — which is why a take-over built on this contact arms only after
  the session has rendered an MPD scene, and stays inert before that. Two further host rules bind
  here: a STATUS registration's identity must be the CALLING ACTIVATION (the injected scope, not the
  consumer's ctx — the host's `assertCallerContext` refuses the latter), and no DSH-TUI file is
  patched, vendored or written; every failure (no candidate, import error, a `ui.js` without
  `useStdin`) degrades to `hostInput() === undefined` + ONE line with the take-over simply absent.
  Route any future host-internals need through this same adapter — never a second contact site.
- **A patch row NEVER id-targets a host-owned row — binding** (`node scripts/verify-no-host-override.ts`,
  §4). The deployment default preset is the USER's to choose, not the bundle's: `docs/preset-default.md`
  and `node scripts/set-default-preset.ts`.
- **The adopted-plugin exception is CLOSED (2026-09-19), and not overstated.** Its SIX bridged files
  (`lib/{index,capabilities,harness-compat,members,command,tools}.js`) route through the facade
  `lib/mpd-adapter-ctx.ts` — an mpd-OWNED module (name rule `lib/mpd-*.js`, healed byte-faithfully from
  the registry) that resolves the mounted `mpdDsh` lazily behind a warn-once fallback, so the plugin
  still applies with the adapter absent (exactly ONE absent line per instance). Each bridged call sits
  in a bracketed `mpd-delta` region and goes through a capability-flagged adapter method:
  `registerHostTool` (VERBATIM, `Object.is` — `registerTool` cannot serve it), the `subagent*` /
  `agentTurn*` families, `llmListModels` / `llmResolveCallConfig`, `registerPromptSection`, `agentScope`.
  **One bypass is COUNTED, never routed:** the ctx the HOST hands `setup(childCtx, child)` stays DIRECT
  on its **5 counted lines** in `lib/members.ts` (two raw `childCtx.on('agent/error' |
  'agent/request-error')` subscriptions, the `installModelSelection(childCtx, …)` hand-off into a
  VENDORED `_deps/dsh-agent` helper, the legacy `hostChild ?? childCtx.agent` read) — on a legacy Alpha.2
  host a `childCtx` need not be `child.ctx`, so re-resolving it could change that path. `packages/mpd-agent-teams-plugin/test/adapter-bypass-inventory.test.ts` pins exactly those
  5 lines (plus the two `whenIdle` Class-B sites), so a NEW use reddens instead of hiding.
- **Five further residuals stay NAMED**, so the closure is never read as unconditional: (R1)
  adapter-mediated registrations (`tools.register`, `commands.register`, `systemPrompt.section`,
  `ctx.on`) belong to the ADAPTER row's fiber — a plugin-only unload would not revoke them (accepted:
  shared boot lifetime, no module hot reload, T-21); (R2) the retired-member delivery guard still PATCHES
  `subagentRuntime()`'s object — delivery stays in the plugin, RESOLUTION in the adapter; (R3)
  `lib/client.js` (browser bundle) is OUT OF SCOPE, its export bridge guarded by
  `scripts/patch-agent-teams-client.ts`; (R4) `liveAgent`/`liveAgents`/`onEvent` swallow-and-degrade
  where the raw ctx would throw — the adapter's never-crash contract, deliberate; (R5) the count sentence
  in `agent-references/agent-teams-deltas.md` keeps its exact wording (the docs gate's regex is FIXED)
  while only its numbers move.
- **The adopted-plugin delta registry lives in `agent-references/agent-teams-deltas.md`** (on demand,
  not injected): the A1–D42 table, the registry mechanics, the region count and the wave-2 driver-script
  warning. Two rules bind: (a) the registry is **derived** — regenerate with `--write-registry`, never
  hand-edit an entry; (b) the **REPLACEMENT-shaped** deltas (D13/D14/D21/D22) do **not** self-heal after
  a human re-materialize — the applier REFUSES loudly, file byte-untouched, and the remedy is to restore
  the region or re-author it plus `--write-registry`. `scripts/vendor-agent-teams.ts` never re-copies the
  tree (it rewrites bare specifiers in place, works inside `_deps/`, and asserts OUR `lib/index.ts`
  survives), so the risk is a human re-vendor — which the applier makes loud (a line-keyed anchor can
  still land a region one statement late). A hand-dropped `lib/mpd-adapter-ctx.ts` heals byte-faithfully.

  Everything else — including every future mpd plugin — goes through the adapter.
- **Tools**: `dsh.registerTool({name, description, parameters, output:{schema, render}, execute})`.
  The adapter defaults `parameters` to an object-rooted schema and `output.render` to a text block, and
  always calls `execute(args, exec)` with objects. `parameters` is object-rooted JSON Schema;
  `output.schema` the canonical value contract; `render` returns `[{type:'text', text}]` blocks;
  `exec.signal` cancels.
- **Guards**: `dsh.guardTool(fn)` where `fn(exec) => string | undefined` (string denies). Keep guards
  monotonic and non-throwing; read only, never mutate.
- **Waterfalls**: `dsh.onPostToolExecute(async (exec, result, downstream) => decision | undefined)` —
  the adapter owns `next()`, so the listener only decides: return `{...downstream, content}` to replace,
  `undefined` to pass through. Accept with `{kind:'accept', content?}`, block with
  `{kind:'block', feedback}` (the harness key is `feedback`; `decision.block(reason)` builds it).
- **Subagents**: `dsh.spawnAgent({label, prompt, parent: exec.agent, signal: exec.signal, provider,
  model, outputSchema, persona, maxDepth, toolFilter})` → `{output, structured, stopReason}`. Flat
  `provider`/`model` and harness-shaped `agentOptions` both work, and `run.result` is awaited whether it
  is a promise or an object.
- **Internal tool calls**: `dsh.hasTool(name)` / `dsh.executeTool({name, arguments, callId?, signal?})`
  (→ `{ok, isError, value, error}`) — never `ctx.tools.get`/`ctx.tools.execute` directly.
- **Capability probing**: `dsh.capabilities()` reports one boolean per seam; degrade with a warning
  instead of aborting a plugin tree (a missing optional seam must never take the boot down — see the
  `registerContinuableSetup` guard in the adopted agent-teams plugin).
- **State**: workspace-scoped only (`.mpd/` under the **calling session's workspace**, never the dsh
  process cwd); never write `~/.dsh` from a plugin. Every plugin resolves that root through the ONE
  adapter helper — `dsh.workspaceRoot(exec)` with precedence **session header cwd →
  `DSH_WORKSPACE_ROOT` → `process.cwd()`** — plus `dsh.workspaceRootsAll()` (the union of live session
  cwds, `[]` when the agent registry is absent) for agentless surfaces such as web routes. The session
  fact outranks the process-wide env because one host serves many sessions with different workspaces; an
  explicit row/config override (`boulder.dir`, `hashline.registryFile`, `memory.dir`, `ulw.planDir`,
  `config.projectFile`, `MPD_DSH_VERIF_VENV|WORK`) still wins over all of them. Resolve it PER CALL:
  never cache the root in a module-level const, never `chdir`, and never set `DSH_WORKSPACE_ROOT` from a
  row — each of those would "fix" one session by breaking the multi-session host. Evidence:
  `evidence/session-workspace-root/b1-resolution/`. Sanctioned exceptions: (1) the bundle writes NOTHING
  to the home any more — the `mpd-bootstrap` row serves `<bundle>/skills` through a `ctx.skills`
  provider and the bundle patch roots the `agent-presets` roster at `<bundle>/presets`, so both assets
  exist exactly while the bundle is installed (§8), and the row only REMOVES the version-stamped copies
  that bundle `<= 0.2.6` wrote; (2) the **workmate library** deliberately lives under the user's HOME
  (`~/.mpd/workmate`), the user's cross-project evolving agent library (§13), and QA must boot with
  `HOME=<sandbox>` so tests never touch the real home; (3) **`mpd-codegraph`** keeps its project index in
  `.codegraph/` under the workspace (the upstream-mirrored second state root, gitignored — see
  `packages/mpd-codegraph-plugin/README.md`).
- **TypeScript is the only source language, run directly by Node — binding.** Every file this
  repository owns is `.ts` and runs as `node <file>.ts` (type stripping; `engines.node` states the
  floor). Four rules: **erasable syntax only** (no `enum`, `namespace`, parameter properties or
  decorators); **every relative specifier carries the explicit `.ts` extension**; `import type` for
  type-only imports; no `tsconfig`-`paths` mapping. `packages/*/src` differs in FORM only (`bun build`
  → `dist/*.js`, extensionless specifiers), and a genuine CommonJS module is spelled `.cts`. The ONLY
  JavaScript left is 32 files, for a MEASURED reason: Node refuses to strip types for any path under
  `node_modules`, and a shipped bundle IS installed there — the list and the failure are in
  `agent-references/troubleshooting.md` (last row). The converted ADOPTED body carries `@ts-nocheck`
  and its suite is out of the type program (`tsconfig.json`).
- **Every declaration is documented and every named function is fully typed — binding, enforced by
  §4's `verify:comments`.** A comment states the contract, unit, invariant or reason — never a
  restatement of the name; a local inside a function body counts as a declaration. Types are precise:
  `unknown` plus narrowing instead of `any`, an existing interface/type reused instead of a structural
  clone, and a cast only where narrowing is impossible, with a comment saying why.
- **Build — from the REPO ROOT, with path-qualified args**: `bun build
  packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js`
  (a multi-entry package repeats it per entry, e.g. `packages/mpd-ext-plugin/src/sdk.ts` →
  `packages/mpd-ext-plugin/dist/sdk.js`). The canonical form matters: `bun build` writes every bundled
  module's path RELATIVE TO CWD into the artifact's path comments, and
  `node scripts/verify-dist-fresh.ts` reproduces THESE bytes — so a build run from a PACKAGE directory
  is flagged STALE even though it looks sanctioned. Three packages used to carry exactly that shape in
  their own `build` scripts (`mpd-ext-plugin`, `mpd-team-watchdog-plugin`, `mpd-tui-plugin`); T-67 moved
  them to the canonical form above, which now begins with `cd "$(git rev-parse --show-toplevel)"`. Zero
  runtime deps preferred (type-only imports). **An ADAPTER edit fans out**: `bun build` INLINES every
  imported module, so touching `packages/{mpd-dsh,mpd-tui}-adapter-plugin/src` changes the emitted
  bytes of every package that imports it (measured: one adapter edit left 12 of 24 dist targets
  STALE). Rebuild each dependent with the pinned toolchain — see `agent-references/seam-adapters.md`.
- **Load/test**: the committed patch names rows as `@mpd-dsh/mpd/packages/...`, which resolve in BOTH
  install layouts (the repo root IS `@mpd-dsh/mpd`, so a checkout install resolves them through the
  link; the packed package through its own name). QA boots it straight from a checkout through the
  dev-flavor rewrite (`devPatch()` in `skills/dsh-qa/scripts/preset-register.ts`: rename rows to
  checkout-absolute paths, rewrite the preset-root expression, pin MCP binaries via `MPD_DSH_*` env)
  because a QA sandbox has no installed profile. Do NOT keep a bundle row in a QA overlay while it is
  already in the bundle — the loader rejects duplicate entry ids.
- **Docstrings/comments**: English only.

