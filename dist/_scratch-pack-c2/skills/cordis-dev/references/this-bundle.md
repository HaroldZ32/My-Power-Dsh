# This bundle's binding rules (`my-power-dsh`)

The authoritative manual is `AGENTS.md` at the repository root — read it for every session. This
file is the plugin developer's path through it: the rules a plugin change must satisfy, with the
commands that check them. When this file and `AGENTS.md` disagree, `AGENTS.md` wins.

**Package root for everything below**: `<bundle>` = the repository root = the package `@mpd-dsh/mpd`.

## What a plugin package looks like here

```
packages/mpd-<name>-plugin/
├── src/index.ts        # cordis plugin: export const name / inject / apply (+ Config)
├── dist/index.js       # COMMITTED build output — the harness loads THIS, never src/
├── test/*.test.ts      # bun test
├── package.json        # { "name": "@mpd-dsh/<short>", "private": true, "type": "module" }
├── README.md           # bilingual pair, switch link under the title
└── README.zh-CN.md
```

Minimum plugin body:

```ts
import { DSH_SEAM_TOOLS, dshSeamInject, resolveDshAdapter, textBlock, type DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** Cordis plugin name; the loader keys the mounted instance on it. */
export const name = "mpd-example"
/** Harness services required before `apply` runs. */
export const inject = dshSeamInject(DSH_SEAM_TOOLS)

/** Apply the row. */
export function apply(ctx: { tools: any; get?: (k: string) => any }, config: { /* … */ } = {}): void {
  const dsh: DshAdapter = resolveDshAdapter(ctx)
  dsh.registerTool({ name: "mpd_example", description: "…", parameters: { type: "object", properties: {} }, output: { render: (_a, v) => textBlock(String(v)) }, execute: async (args, exec) => ({ ok: true }) })
}
```

## The rules that are gates, not advice

| Rule | Why | Check |
|---|---|---|
| **All harness seams go through `mpd-dsh-adapter`.** No other file may name `ctx.tools`, `ctx.subagents`, `ctx.skills`, `ctx.agentPresets`, `ctx.goals`, … Resolve with `resolveDshAdapter(ctx)` (or `createLazyDshAdapter(ctx, {label})` across a late-ACTIVE window). | One file absorbs a harness rename instead of every plugin. | `bun test packages/mpd-dsh-adapter-plugin` |
| **TUI seams go through `mpd-tui-adapter`**, same rule on the second plane; no file outside it may name a `ctx.tui*` service. | Same reason, second contact surface. | `no-direct-tui-access` / `no-terminal-writes` checks |
| **A row never id-targets a host-owned row.** Additive only. | A shipped row may add a capability, never overwrite a host decision. | `node scripts/verify-no-host-override.ts` |
| **Mount through `cordis.patch.yml` + the profile mechanism only.** Never write a profile by hand, never push rows into `$DSH_HOME`, never mount from a script. | The one install path the Docker lane certifies. | `node scripts/verify-plugin-manifest.ts --pack`, `bun run verify:rows` |
| **State is workspace-scoped**: `<root>/.mpd/…`, where `<root>` is `dsh.workspaceRoot(exec)` resolved **per call** (session cwd → `DSH_WORKSPACE_ROOT` → `process.cwd()`). Never cache the root in a module constant, never `chdir`. | One host serves many sessions with different workspaces. | review + `bun run test:qa` |
| **Cordis services you provide are MPD-owned names** (`mpdDsh`, `mpdConfig`, `mpdGoal`, …), never a harness seam id. | The independence gate counts harness-service `provide`s. | `bun test packages/mpd-dsh-adapter-plugin` (cross-package coupling inventory) |
| **Rows never touch another package's source imports** beyond the sanctioned adapter packages; talk through SERVICES (`ctx.get("mpdGoal")`). | The cross-package inventory may only shrink. | same inventory test |
| **Every declaration carries a precise comment; every named function writes down parameter and return types.** | Reviewers read contracts, not names. | `bun run verify:comments` |
| **TypeScript is the only source language**, run directly by node: erasable syntax only, every relative specifier carries `.ts`, `import type` for type-only imports. | `node file.ts` type stripping. | `bun run typecheck` |
| **A UI/text-facing doc ships EN + `*.zh-CN.md`** with the switch link. Agent-facing content stays English-only. | `scripts/verify-docs-parity.ts`. | `bun run verify:docs` |

## Build and dist

The harness imports the committed `packages/<pkg>/dist/index.js`; a stale dist keeps unit tests green
and fails only in a mounted boot. So every `src` edit ends with a rebuild **from the repository root,
with path-qualified arguments**:

```sh
.toolchain/bun/bin/bun build packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js
node scripts/verify-dist-fresh.ts
```

- Use `.toolchain/bun/bin/bun` — `package.json`'s `buildToolchain` pins the bun whose bytes the
  committed dists came from; a different bun rewrites the injected preamble and reddens every target.
- **An adapter edit fans out**: `bun build` inlines every imported module, so touching
  `packages/{mpd-dsh,mpd-tui}-adapter-plugin/src` restales every dependent's dist. Rebuild each
  dependent before running the gate.
- A multi-entry package repeats the command per entry (`mpd-ext-plugin` also emits `dist/sdk.js`).

## Mounting a row in this bundle

1. Add the row to `cordis.patch.yml` (host plane) under `- insert:` with `id` + the
   `@mpd-dsh/mpd/packages/<pkg>/dist/index.js` specifier, plus `config:` when the row has settings.
   Preset-plane rows go in `presets/mpd.patch.yml` instead; a service row needs a group carrying an
   `isolate` realm.
2. Evidence: `node scripts/dump-config.ts --profile <p>` proves COMPOSITION ONLY (rows compose,
   plugin code never runs), so any behaviour claim needs a real mount boot with an isolated
   `DSH_HOME` (see `skills/dsh-qa`).

## Skills, extensions, presets

- **Skill**: `skills/<name>/SKILL.md` with frontmatter `name` + `description` (trigger-rich), served
  by the `mpd-bootstrap` row at rank 600 — adding the directory is the whole registration. Keep the
  RENDERED `SKILL.md` under **8192 characters** (the tool-result pruner's threshold); put bulk in
  `references/` and load it on demand. `skills/**` is a VENDOR_LOCK directory asset (fileCount +
  treeSha): ONE writer per wave, and the wave's single
  `node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step` lands in the SAME commit
  as the change that invalidated the treeSha.
- **Extension**: `extensions/<name>/mpd-ext.json` (plus its assets) validated by
  `bun scripts/mpd-ext.ts validate extensions/<name>`; the interface is
  `packages/mpd-ext-plugin/README.md`. A deliberately broken extension MUST exit 1.
- **Preset**: `presets/mpd.patch.yml` declares the `mpd` preset as one
  `@deepseek-ai/dsh-agent-preset` row with an inline child list — see `references/compositions.md`.
  Row-set parity with the harness's shipped `standard` preset is checked by
  `node skills/dsh-qa/scripts/preset-conformance.ts`.

## The goal plane (continuous execution)

`packages/mpd-goal-plugin` is the bundle's goal authority:

- Tools `mpd_goal_status` / `mpd_goal_anchor` / `mpd_goal_finish`; service `mpdGoal`
  (`available` / `autoAnchor` / `status` / `anchor` / `finish`), consumed lazily by `mpd-ulw` and
  `mpd-boulder` with `ctx.get("mpdGoal")`.
- Adapter seam: `capabilities().goals` (durable read via `ctx.goals`) and `capabilities().goalTools`
  (the write path), `goalState(agent)`, `goalControl({agent, action, …})`. **Mutations go through the
  harness goal TOOLS** — the authorisation (a direct human turn for create/edit/pause/resume, the
  consecutive-round count for `blocked`) lives there, and a plugin that wrote `ctx.goals` directly
  could arm a goal the model itself could not.
- Ownership: an anchor is recorded per session in `<workspace>/.mpd/goal/anchors.json`; a run only
  ever finishes a goal it anchored. Config: `goal.enabled`, `goal.autoAnchor`, `goal.autoRounds`.
- A `max-rounds` run deliberately leaves its goal ARMED: that is the handoff from the in-turn engine
  to the harness's round driver.

## The gate table (run the ones your change touches; evidence on disk)

| Gate | Command |
|---|---|
| Tests (packages) | `bun test packages` |
| Types | `bun run typecheck` |
| Declaration comments | `bun run verify:comments` |
| Dist freshness | `node scripts/verify-dist-fresh.ts` |
| Rows / preset parity | `bun run verify:rows` + `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` |
| Manifest + pack contract | `bun run verify:manifest` |
| Doc pairs | `bun run verify:docs` |
| Vendor baseline | `node scripts/verify-vendor.ts` (after the wave's single re-pin) |
| QA self-tests | `bun run test:qa` |
| Real mount boot | a `skills/dsh-qa` lane, e.g. `bun skills/dsh-qa/scripts/bundle-lifecycle.ts` |
| Manual paths (after editing `AGENTS.md`) | `node scripts/verify-manual-paths.ts` |
| Docker real machine (release sweep, LAST) | `bun run verify:docker` |

Evidence goes to `evidence/<domain>/<slug>/<timestamp>/{result.json,output.log}`. No evidence on disk
means the change is not complete.
