# Design

**English** | [中文](design.zh-CN.md)

The detailed design of my-power-dsh: what it designs, the principles it is built on, how it is
assembled and mounts inside the DeepSeek Harness (DSH), what each piece does, and how the pieces
talk to each other.

**This document is for engineers; it is not the user manual.** Installing the bundle, the commands
to type, the settings knobs and the recipes live in [`README.md`](../README.md) and the
task-oriented [user guide](user-guide.md) — this is the document those two link to when the
mechanism behind a feature matters.

Reading order: what is designed → design principles → bundle and package structure → patch layer
and boot chain → plugin inventory → interaction flows → state layout → web client wiring → TUI
wiring → known limits.

## 0. What this document designs

**The system under design is the bundle, not the host.** DSH (the DeepSeek Harness) is a Cordis
plugin host: it owns the loader, the session/agent runtime, the model routing, the Web and TUI
shells and the base row set. `@mpd-dsh/mpd` designs what is added ON TOP of that host, and how it
is added:

- a **patch layer** that inserts the bundle's rows into any profile the bundle is installed into,
  and one id-target plus a second patch file that make the bundle's own `mpd` preset the default
  there,
- **28 inserted plugin rows** (6 MCP client rows, 18 `mpd-*` plugin rows including the
  `mpd-web-compat` self-row, the 3 official Agent Teams rows, and the `mpd-better-sidebar` host row
  that mounts the bundle's declared sidebar dependency), and the services, tools, commands, routes
  and state each one owns (§4),
- a **web client** and a **TUI surface** that render the bundle's surfaces inside the host's own
  shells (§7, §7b),
- the **state layout** the bundle writes under the session workspace and under the user home (§6),
  and the isolation rules that keep QA away from both (§8).

What is NOT designed here: the host's own seams and row set, the model providers, and the upstream
work this bundle builds on — that provenance is credited in
[`LICENSE-NOTICES.md`](../LICENSE-NOTICES.md) and summarized in the README.

## 0b. Design principles

These are the rules the pieces below are shaped by; a change that violates one of them is a defect
even when it works on the happy path.

1. **The agent is the worker.** Every surface exists so that an agent that reads the repository
   cold behaves correctly: explicit conventions, executable gates, evidence on disk. This is why
   the roster ships as data + personas rather than prose, and why the design documents its own
   limits (§8b) instead of leaving them to be discovered.
2. **One seam contact surface.** Exactly one package (`mpd-dsh-adapter`) touches the host's
   tool/agent/skill/preset seams; every other row calls through the `mpdDsh` service. A host
   release that reshapes a seam is absorbed there instead of across the tree (§6b). The RETAINED
   (retired-from-composition) upstream `agent-teams` body is not an exception either: its `lib/`
   still reaches those seams through the adapter, behind the mpd-owned bridge
   `lib/mpd-adapter-ctx.js` (§6b) — which is why that code is kept rather than deleted.
3. **Plugin form, config by reference.** Every capability is a Cordis plugin row or a configured
   host plugin instance; no logic lives in profiles or scripts. Assets (the skill corpus, the
   `mpd` preset) are SERVED by the bundle rather than copied into `$DSH_HOME`, so uninstall leaves
   no residue (§2, §6c).
4. **Workspace-scoped state, resolved per call.** State lands under the calling session's
   workspace (`.mpd/…`), resolved through the adapter on every call — never a module-level
   constant, never `chdir`, never `$DSH_WORKSPACE_ROOT` set from a row (§6). The only deliberate
   exception is the user-scoped workmate library under `~/.mpd/workmate` (§6).
5. **Evidence without evidence is incomplete.** A behavioral claim needs a gate or a real tool
   call, not a composition dump: `--dump-config` composes rows and never executes plugin code,
   so it can never witness a load (§4). Claims in this document name their evidence.
6. **Isolation in QA.** QA boots in a temp `DSH_HOME` with a sandbox `HOME` and a sandbox
   workspace, and never touches the real `~/.dsh` or `~/.mpd/workmate` (§8).
7. **Baseline discipline and minimal diffs.** Upstream assets are pinned and verified
   (`VENDOR_LOCK.json`), not chased; the smallest change that satisfies the requirement wins.

## 1. Big picture

DSH is a Cordis host: plugins are rows in a composition (`cordis.yml` + patch layers),
services are provided/consumed per scope, and the model route is resolved from the
session's request header. my-power-dsh ships as an **npm bundle** (`@mpd-dsh/mpd`) whose
`dsh.bundle.patch` array (`packages/mpd-bundle/cordis.patch.yml` then `presets/mpd.patch.yml`)
adds rows to any profile it is installed into. It contributes:

- **28 inserted rows** in TWO additive patch layers: 6 MCP client rows (local ast-grep,
  git-bash [disabled by default], LSP, codegraph; remote context7, grep.app), 18 `mpd-*`
  plugin rows (including the `mpd-web-compat` self-row that makes the bundle a loader entry),
  the 3 OFFICIAL Agent Teams rows, and the `mpd-better-sidebar` row that mounts the
  bundle's declared sidebar dependency (the community sidebar host) — §4 lists every
  one of them. The second patch file contributes the `preset-mpd` row,
- **1 id-target** (not an insert) that makes the bundle's own preset the default:
  `agent-preset-registry` → `{ default: mpd }` (§2, §6c),
- the harness adapter (`mpd-dsh-adapter`) every other row calls through,
- one agent preset (`mpd`) declared as a ROW, and a skill corpus served by reference
  (no home copy),
- a combined web client (the workmate library page; the team surface is the official
  client plugin's own panel, §7).

The specialist roster's 11 specialists are **not presets**: they live as a specialist roster
(`mpd-roles-plugin`) and as teammate instantiation templates the Lead spawns by name with the
official `spawn_teammate` tool, taking each member's persona text from `mpd_role_persona`.

## 2. Bundle and package structure

**The repo root IS the bundle package.** `package.json` is named `@mpd-dsh/mpd` and
declares `dsh.bundle.patch` (the ARRAY `["./packages/mpd-bundle/cordis.patch.yml",
"./presets/mpd.patch.yml"]`), `dsh.client`,
the `exports` map the rows resolve through and the toolchain `optionalDependencies`, so
`dsh plugin add .` in the repo root installs the whole unit in ONE command (no pack
step). `scripts/pack-mpd.mjs` is the RELEASE step: it assembles the relocatable
`dist/mpd-package/` for publishing / tarball installs — a self-contained npm package with
**no checkout-absolute paths**:

| Piece | Where it goes | Why |
|---|---|---|
| plugin dists | `packages/<pkg>/dist/index.js` | host rows reference them via `@mpd-dsh/mpd/packages/...` (the exports map) |
| retired agent-teams body | `packages/mpd-agent-teams-plugin/` (lib + `_deps/` + assets) | kept as provenance and copied wholesale so the packed artifact stays self-contained; NO row mounts it (§4) |
| combined web client | `packages/mpd-bundle-plugin/client.js` | served as `@mpd-dsh/mpd`'s `./client` export |
| skills | `skills/` | SERVED from the package: `mpd-bootstrap` registers `skills/` as a skill provider — nothing is copied into `$DSH_HOME` |
| preset | `presets/mpd.patch.yml` | the `preset-mpd` ROW (`@deepseek-ai/dsh-agent-preset`, `config.id: mpd`, the child entry list inline) and the manifest's second `dsh.bundle.patch` entry |
| `cordis.patch.yml` | package root | the first `dsh.bundle.patch` layer (the row inserts and the one id-target) |

Manifest invariants (why they exist):

- `main` / `exports["."]` → `packages/mpd-bundle-plugin/dist/index.js` — the loader
  resolves profile bundles through `exports["."]`; a bundle without it fails to load
  as an entry (`ERR_PACKAGE_PATH_NOT_EXPORTED`).
- `exports["./client"]` → combined client; `dsh.client.platform: "web"` — marks the
  bundle as a web client contributor.
- **The retained `agent-teams` body is NOT a declared dependency.** pnpm (the engine behind
  `dsh plugin add`) never links a bundle's transitive deps into the profile root, and a
  package-name row would self-disable on an unresolvable module (the E4 defect, see
  `docs/plan-e.md`). That body is main code plus its own vendored closure
  (`packages/mpd-agent-teams-plugin/_deps/`), and since 0.1.7-rc.2 no row mounts it at all.
- **Four `dependencies` entries: `dsh-better-sidebar` and the three official Agent Teams
  packages** (`@deepseek-ai/dsh-experimental-agent-team`, `-tool-agent-team`,
  `-client-ui-agent-team`). Declaring a dependency mounts nothing on its own, and a row
  alone would be boot-fatal when the module cannot be resolved, so BOTH halves are
  required: the packages are resolvable because
  `@deepseek-ai/dsh-app-boot#healProfileModuleFallback`
  materializes the dependency closure of non-installation bundle layers into
  `<profile>/node_modules` before the loader runs, and this bundle mounts them with its own
  `mpd-*-agent-team` rows (§4). A checkout install also materializes them in
  the repository (`bun install`). The row that mounts the sidebar (`mpd-better-sidebar`) is guarded
  and order-independent (§4), so a composition that mounts the package itself keeps
  working and an unresolvable package degrades to "no sidebar", never a dead boot.

`scripts/build-mpd-client.mjs` composes the combined client (see §7).

## 3. Patch layer, boot chain & the web-compat self-row

1. `dsh --profile <p>` loads `dsh.profile.bundles` (base, web-app/headless,
   `@mpd-dsh/mpd`) via `dsh-app-boot`: each bundle contributes its `cordis.patch.yml`
   rows and the profile's own patch.
2. The Cordis loader turns every row into a plugin entry. **A row's entry name is its
   `name` field** (the package name or subpath).
3. `dsh-client-modules` builds the bootstrap client graph from
   `ctx.loader.entries()`: for each entry named `X`, if package `X` declares
   `dsh.client` (platform web) + `exports["./client"]`, it becomes a boot-graph row
   `/plugins/X/client.js`.
4. The browser loads each row, and the served client file must
   `__ModuleLoader__.load({ id: "<X>", factory })` — the id must match the row id or
   the loader throws "bundle ... loaded without registering".

5. Sibling rows apply **concurrently**, so nothing may assume an ordering: services are resolved
   lazily (`ctx.get(...)`) at tool-execute time, and a plugin that must finish work during
   activation returns an **async** `apply` (Cordis awaits it) instead of doing it lazily later.
   The `mpd-ext` row is the one row that finishes real startup work: it discovers the host-wide
   extension roots and connects their declared stdio MCP servers before its apply resolves, so the
   first tool generation of a reachable server already exists when the session starts.

**Consequence**: to have a web client, the bundle needs (a) `dsh.client` + `./client`
on its manifest, and (b) a **loader entry named exactly `@mpd-dsh/mpd`** — provided by
the patch self-row:

```yaml
- id: mpd-web-compat
  name: '@mpd-dsh/mpd'   # loads the bundle's own no-op main (mpd-bundle-plugin)
```

This mirrors `@linxin666/dsh-web-ui-all`'s `web-ui-compat` self-row. Without it the
bundle's client never appears in the boot graph (verified reproducibly; evidence
`evidence/plan-f/web-client-adapt`). Because entry names come from patch rows, the
other rows must keep subpath names (`@mpd-dsh/mpd/packages/...`) — do not rename them
to bare package names.

## 4. Plugin inventory

**Every row of `packages/mpd-bundle/cordis.patch.yml`, by composition.** The patch layer is
additive and carries **28 `insert` rows**; the bundle's SECOND patch file
(`presets/mpd.patch.yml`) carries one more insert, the `preset-mpd` row, and both files are listed
in the manifest's `dsh.bundle.patch` ARRAY. `node scripts/verify-rows-parity.mjs` asserts that this
list and the repository's own row bookkeeping agree. One further entry is an **id-target**, not an
insert — it REPLACES a row the host itself owns — so it is listed in its own table below.

The `Composition` column answers "which composition does this row reach": an `insert` row reaches
every profile the bundle is installed into (`web + dsh-tui`). The id-target reaches the composition
that mints the registry row.
**Composition-only evidence**: `evidence/tui/composition/20260915T053445Z/raw/web-dump-config-final.txt`
and `…/raw/dsh-tui-dump-config.txt` list the same bundle rows in both compositions; that snapshot
predates `mpd-team-watchdog`, which the patch adds as an `insert` in the same band. A dump proves
COMPOSITION ONLY — it never executes plugin code, so it is never load evidence (§8b).

| Row id | Package | Composition | Purpose | Tools / service | Key config |
|---|---|---|---|---|---|
| `mcp-astgrep` | dsh-mcp-client | web + dsh-tui | local ast-grep stdio server; `launch.mjs` resolves the binary bundle-relatively (env pin → `$MPD_AST_GREP_BIN_DIR` → createRequire of the optional dependency → `<bundle>/.toolchain/node_modules/.bin` → `<bundle>/node_modules/.bin`, every candidate expanded into the spellings the host can EXECUTE: win32 resolves `.exe`/`.com` and never a `.cmd` shim the shell-less runner cannot start) | `mcp__ast_grep__*` (search / rewrite / scan) | `serverName: ast_grep`, `toolCallTimeoutMs: 60000` |
| `mcp-gitbash` | dsh-mcp-client | web + dsh-tui, **disabled by default** | local git-bash stdio server; upstream designs it as Windows-only, so the row ships `disabled: true` | `mcp__git_bash__*` once enabled | flip `disabled: false` to enable |
| `mcp-lsp` | dsh-mcp-client | web + dsh-tui | local LSP bridge (`…/mpd-mcp-lsp/dist/cli.js mcp`) | `mcp__lsp__*` | `serverName: lsp`, `toolCallTimeoutMs: 60000` |
| `mcp-codegraph` | dsh-mcp-client | web + dsh-tui | local codegraph stdio server; `launch.mjs` resolves the binary bundle-relatively and sets `MPD_CODEGRAPH_BIN` only when the caller left it unset | `mcp__codegraph__*` | `serverName: codegraph`, `toolCallTimeoutMs: 60000` |
| `mcp-context7` | dsh-mcp-client | web + dsh-tui (network) | remote streamable-http MCP server (public service, optional per use) | `mcp__context7__*` | `url: https://mcp.context7.com/mcp` |
| `mcp-grepapp` | dsh-mcp-client | web + dsh-tui (network) | remote streamable-http MCP server (public service, optional per use) | `mcp__grep_app__*` | `url: https://mcp.grep.app` |
| `mpd-web-compat` | mpd-bundle-plugin | web + dsh-tui | web-compat self-row: makes `@mpd-dsh/mpd` a loader entry (the web client loads only for an entry of that exact name); hosts the combined web client | no-op apply; `./client` | — |
| `mpd-dsh-adapter` | mpd-dsh-adapter-plugin | web + dsh-tui | THE single contact surface with harness seams: tool registration/guard/post-execute/execute, subagent spawn, skill provider + catalog, preset resolve, capability probing | service `mpdDsh` | `defaultTimeoutMs`, `quiet` |
| `mpd-config` | mpd-config-plugin | web + dsh-tui | minimal `mpd.jsonc` runtime config layer (project `.mpd/mpd.jsonc` merged over user `$DSH_HOME/mpd.jsonc`); owns the settings write-back (§7b) | `mpd_config_get`, `mpd_config_reload`; service `mpdConfig` | `projectFile`, `userFile` |
| `mpd-team-watchdog` | mpd-team-watchdog-plugin | web + dsh-tui | per-step/per-tool heartbeat store for members AND the captain, the WARN→ESCALATE machine over the `watchdog.*` knobs, the atomic restorable scene snapshot, and the durable hold/incident sidecars under `<workspace>/.mpd/team/watchdog/` (its OWN namespace: the official Team service keeps team state in the Lead session log, and the watchdog reads the roster through the adapter); mounted on the HOST plane on purpose, so a preset-scoped tick cannot fail to witness a wedged captain | `session-watchdog-status`, `session-watchdog-hold`, `session-watchdog-resume` | `stateDir`, `warnSilenceMs`, `tickIntervalMs`, `warnStreakToEscalate`, `actionOnEscalate`, `toolInFlightMaxMs`, `holdTtlMs` |
| `mpd-tools` | mpd-tools-plugin | web + dsh-tui | write guard (no silent clobber), tool-output truncation (token budget), edit-error recovery guidance | waterfalls only | `writeGuard`, `truncateMaxBytes`, `recoveryHint` |
| `mpd-modelchain` | mpd-modelchain-plugin | web + dsh-tui | DeepSeek route resolution for roster roles + key/value memory notes | `mpd_modelchain_resolve`, `mpd_memory_save`, `mpd_memory_recall` | — |
| `mpd-ext` | mpd-ext-plugin | web + dsh-tui | the extension interface: one frozen descriptor contract, two planes (code `register()` + data-plane `mpd-ext.json`), lifecycle-split discovery, skills/flows providers, the runtime stdio MCP bridge, extension roles | `mpd_ext_list`, `mpd_ext_show`, `mpd_flow_list`, `mpd_flow_show`; service `mpdExtensions` | `quiet` + the lazy `mpd.jsonc` layer (`extensions.enable`, `extensions.disable`, `extensions.mcp.*`) |
| `mpd-roles` | mpd-roles-plugin | web + dsh-tui | the specialist roster's 11 specialists as a roster (normal names/personas/model chains/read-only), merged per call with extension-contributed roles; registers the roster prompt section for the Lead (persona text via `mpd_role_persona`, and the measured model-route bound) and the READ-ONLY tool guard for a live Team teammate whose name normalises to a read-only roster member | `mpd_roles_list`, `mpd_role_spawn`, `mpd_role_persona`; service `mpdRoles` | `personasDir` |
| `mpd-ulw` | mpd-ulw-plugin | web + dsh-tui | fixed plan→execute→verify loop discipline (C2 ultrawork v2) | `mpd_ultrawork`, `mpd_ulw` (light alias); commands `/ulw`, `/ultrawork` | `maxRounds`, `maxReReviews`, `provider/model/reviewerModel`, `planDir`, `stateDir` |
| `mpd-hashline` | mpd-hashline-plugin | web + dsh-tui | hash-anchored edit discipline (`LINE#HASH` anchors) | `mpd_hashline_read`, `mpd_hashline_edit`, `mpd_hashline_format`, `mpd_hashline_restore` | `guardEditTools`, `maxDiffChars`, `registryFile` |
| `mpd-boulder` | mpd-boulder-plugin | web + dsh-tui | durable work ledger bound to plan markdown files | `mpd_boulder_status`, `mpd_boulder_start`, `mpd_boulder_complete`, `mpd_boulder_task_timer`, `mpd_boulder_plan_progress`, `mpd_boulder_plans` | `boulderDir` |
| `mpd-comment-checker` | mpd-comment-checker-plugin | web + dsh-tui | comment/docstring detection (opt-in binary) | `mpd_comment_check` | `autoCheck`, `binary`, `timeoutMs`, `maxMessageChars` |
| `mpd-codegraph` | mpd-codegraph-plugin | web + dsh-tui | codegraph binary resolve + project index init | effect (auto init) + `/mpd-codegraph` command | `autoInit`, `initTimeoutMs`, `cooldownMs`, `binary` |
| `mpd-memory` | mpd-memory-plugin | web + dsh-tui | VCS-backed memory (git/svn) + reflection state machine | `mpd_memory_write`, `mpd_memory_read`, `mpd_memory_reflect`, `mpd_memory_reflect_complete`, `mpd_memory_status` | `vcs`, `dir`, `agentSlug`, `reflectionEvery` |
| `mpd-workmate` | mpd-workmate-plugin | web + dsh-tui | durable evolving agent library under `~/.mpd/workmate/` (mutations rename/delete, archive-first) | `mpd_workmate_list/init/spawn/reflect/match/rename/delete`; service `mpdWorkmate` (`list`/`get`/`read`/`rename`/`delete`); web routes `GET /plugins/mpd-workmate/{list,roster,get}` + `POST /plugins/mpd-workmate/{init,rename,delete}` | — |
| `mpd-team-compact` | mpd-team-compact-plugin | web + dsh-tui | compacts a FINISHED team's members (every task terminal AND every member idle) through each member's OWN scoped context; the captain is left to the human `/compact`; audit lands under `<workspace>/.mpd/team-compact/` and this row never writes `.mpd/team` | `mpd_team_compact_run`, `mpd_team_compact_status` | — |
| `mpd-bootstrap` | mpd-bootstrap-plugin | web + dsh-tui | asset provisioning BY REFERENCE: registers `<bundle>/skills` as a skill provider through the adapter (rank 600 `bundled`) and removes the version-stamped home copies written by bundle <= 0.2.6 | effect only | `skillsDir`, `skipSkills`, `skipPresets`, `skipLegacyCleanup` |
| `mpd-tui` | mpd-tui-plugin | web + dsh-tui (active in dsh-tui, degrades elsewhere) | the dsh-tui edition's native surface: binds the host's activation-gated TUI seams and probes each one with `ctx.get(id, false)` + warn-once degrade, so a web/headless composition loses the TUI surfaces and not the boot (§7b) | no model-facing tools; TUI status / settings section / board / command tree / shortcuts / dialogs / transcript renderer | — |
| `mpd-agent-team` | @deepseek-ai/dsh-experimental-agent-team | web + dsh-tui | the OFFICIAL Agent Teams domain service (`ctx.agentTeams`): the implicit-root roster, the durable peer mailbox and the shared task board; roster, mailbox and task state are persisted in the LEAD's session log | service `agentTeams` | `maxMembers: 16`, `maxTasks: 256`, `maxPendingMessagesPerMember: 64`, `maxMessageBytes: 32768`, `disposalTimeoutMs: 5000` |
| `mpd-tool-agent-team` | @deepseek-ai/dsh-experimental-tool-agent-team | web + dsh-tui | the nine scoped model-facing tools every member receives — `spawn_teammate`, `send_message`, `list_agents`, `wait_agent`, `interrupt_agent`, `team_task_create/list/get/update` — plus the `team:policy` prompt section | those nine tools | `freshProvider: spawn`, `forkProvider: fork` |
| `mpd-ui-agent-team` | @deepseek-ai/dsh-experimental-client-ui-agent-team | web (inert host export elsewhere) | the official Web roster, shared task board and teammate-navigation panel in the conversation header; read-only (no spawn/rename/delete/interrupt and no task-mutation control) | `/client` browser half | — |
| `mpd-better-sidebar` | dsh-better-sidebar (the bundle's declared dependency; entry id is `mpd-`-prefixed on purpose, never the package's own `better-sidebar` or an aggregate's id) | web (the guard disables it when no enabled `@deepseek-ai/dsh-host-webserver` entry exists, `dsh-tui` included) | mounts the community sidebar bundle that HOSTS the Workmates tab, so the tab exists without a second manual plugin install; the guard is order-independent and disables the row where ANY composed patch layer already names the package — every declared bundle layer's `dsh.bundle.patch` (e.g. the `@linxin666/dsh-web-all` aggregate), `<profileDir>/cordis.patch.yml`, `$DSH_HOME/cordis.patch.yml`, and every `--patch` overlay path read from `process.argv` (both spellings, repeatable) — where `dsh-better-sidebar` is itself a bundle layer, where the package is unresolvable, or where no enabled `@deepseek-ai/dsh-host-webserver` ENTRY exists (a webserver row disabled by an expression does not count). A foreign layer suppresses the row only when its patch contains a ROW that mounts the package — a row naming `dsh-better-sidebar` whose `disabled` is not literally `true` (YAML comments are stripped first); a mention inside a comment, or a row that is literally `disabled: true`, mounts nothing and does not suppress our mount, and any form the row scanner cannot parse falls back to the conservative behaviour (treated as a mount), because a false disable costs the sidebar while a false enable kills the boot with `duplicate prefix route`. Every path degrades to "no sidebar" with one log line, never a dead boot | sidebar host + its tab registry (`ctx.betterSidebar`) | `disabled: !!js` mount guard |

**The id-target** (it replaces the composition's own preset-selection row; an id-target is a
per-key shallow override, so the host row's other keys survive, and a composition that does not
have the row logs `patch: entry … not found` and skips it):

| Entry id | Target | Composition | What it carries here |
|---|---|---|---|
| `agent-preset-registry` | the registry row `dsh-web-app` inserts | web / base plane | `default: mpd`, so ONE `dsh plugin add` selects the bundle's preset. The registry declares exactly ONE config key (`default`), so restating it is complete; a composition that carries no such row logs `patch: entry … not found` and keeps its own default (a warning, never an error) |

Two rows behave differently per composition ON PURPOSE and neither is a defect: `mpd-tui` binds TUI
seams and degrades warn-once where none exist (web / headless), and `mpd-web-compat` is what puts the
bundle's web client into the boot graph (§3, §7) while being inert elsewhere.

## 5. Interaction flows

### Roster → one-shot specialist
`mpd_role_spawn` reads the roster spec (`mpdRoles`), builds `persona + task`, then
`dsh.spawnAgent({ provider, model, persona, outputSchema, toolFilter (read-only deny) })`
(the adapter's normalized form of the harness spawn). The model route comes from the role's
chain (`roles.data.ts` chain[0]); **credentials resolve through DSH's own credential
mechanism — the plugin never touches API keys**.

### Roster → workmate → team
- `mpd_workmate_init` (base + optional name) copies a roster base into
  `~/.mpd/workmate/<name>/` (meta/persona/memory/note, capped 8/8/1.5 KiB) — the base
  stays pristine. The base is addressed by its **functional NAME only** (a roster id is
  refused with a names-only error; the roster surface is the `mpd_roles_list` TOOL, and neither it
  nor any other registered surface ever serves a roster id); omitting
  `name` auto-generates it from that functional name (`Deep Worker` → `deep-worker-1`).
  `meta.json` keeps the internal `baseId` as provenance, while every tool output, route
  and GUI strips it.
- After work, `mpd_workmate_reflect` appends a bounded memory entry (oldest evicted),
  merges a persona revision, regenerates the note (specialty kept + latest task), bumps
  `uses`.
- `mpd_workmate_spawn` reuses the instance one-shot: persona + memory + note + task on
  the instance's own route; the subagent is instructed to call `mpd_workmate_reflect`
  before its final report.
- `mpd_workmate_match` scores notes (keyword overlap + base-name boost, threshold 0.35);
  below threshold → `matched: false` + "initialize a new workmate" (never force a weak
  match).
- `mpd_workmate_rename { name, new_name }` MOVES the evolved identity — the directory key
  IS the identity, so `resolveTarget` keys on the directory, `meta.name` is only a repaired
  display mirror, and `renamedFrom` (deduped, capped at 10) carries the previous keys
  through `readMeta`'s whitelist. The collision guard uses `lstat` (a silent overwrite of an
  empty directory and a dangling symlink are both invisible to `existsSync`), and a
  post-move write failure rolls the directory back.
- `mpd_workmate_delete { name, purge?, confirm? }` is ARCHIVE-FIRST: the directory is moved
  to `~/.mpd/workmate/.archive/<key>-<compactUtcStamp>/` (hidden from `list`/`match` by
  construction — the archive root has no `meta.json` and is not an addressable key), the
  index key is dropped on BOTH paths, and purge additionally requires `confirm === name`.
  A failed delete restores the index key, so it never leaves a partially removed instance.
- **In-use gate (one synchronous block)**: `assertNotBusy` checks an in-process
  `Map<key, count>` incremented around `dsh.spawnAgent` in `mpd_workmate_spawn` (released in
  `finally`) plus a READ-ONLY scan of direct children of `<cwd>/.mpd/team/<teamId>/team.json` —
  LEGACY records only, because the official Team service keeps no such file (archived teams live
  under `.mpd/team/archive/**` and are excluded by construction);
  rename gates the target key too. The gate, the collision guard and the mutation run with no
  `await` between them, so no spawn or reflect can interleave — no lock file. Writing
  `.mpd/team` state is never done here (that was the retired plugin's state; the official service
  keeps roster, mailbox and board in the Lead's session log), and a read
  error fails OPEN.
- Team mode: the session agent is the Lead. It calls `spawn_teammate` once per member (name,
  description, and a prompt built from `mpd_role_persona` text plus the task), opens each lane with
  `team_task_create`, and drives the board with `team_task_list` / `team_task_get` /
  `team_task_update` (compare-and-set on the task `revision`) and the mailbox tools. Two measured
  bounds are part of the design, not an omission: a teammate **inherits the Lead's model route**
  (`TeamService` forwards only the prompt and the parent to the subagent registry), so the
  `teamModels` slots apply to the one-shot consult paths only; and a read-only roster member's write
  tools are denied by the `mpd-roles` guard keyed on team membership, because
  `spawn_teammate` cannot take a per-teammate tool filter. Persona and workmate memory are NOT
  injected automatically — they travel in the prompt text.

### Extension → skills, flows, MCP tools and roles

The `mpd-ext` row provides the `mpdExtensions` service and loads a standardized descriptor
(`mpd-ext.json`, or the first argument of `register(descriptor, { root })`) through ONE validator,
so a data-plane directory and a code-plane plugin row produce identical registry entries.

- **Two discovery lifecycles.** Apply-time roots (`~/.mpd/extensions/` and
  `<bundle>/extensions/`) are scanned once when the row applies and may contribute all four kinds;
  the per-call project root (`<session workspace>/.mpd/extensions/`, resolved from the calling
  session's workspace, never `process.cwd()`) is re-read on every call and may contribute only
  skills and flows — tool and provider registration is process-global, so a project-level
  `mcp`/`roles` item is rejected per item with a stated reason rather than silently half-loading.
- **Skills and flows** are served through the adapter's `registerSkillProvider` under a
  per-extension provider name; every candidate is pre-validated against the harness's own rules and
  a violating candidate is skipped and recorded. A flow is a declarative JSON document rendered
  into an in-memory SKILL.md-shaped candidate — the harness has no flow seam, so this plane adds
  none.
- **MCP servers** start at apply time, in parallel and time-boxed: the runtime bridge spawns the
  declared stdio child, performs `initialize` → `notifications/initialized` → `tools/list`, and
  publishes the first tool generation **before** the plugin finishes activating. A later tool-list
  change is a two-phase fetch/swap whose rollback leaves ZERO tools from that server. Tool names
  replicate the harness's `publicToolName` wire contract exactly
  (`mcp__<server>__<raw>`, 64-char cap, `_<12-hex sha256(server NUL raw)>` on any lossy
  transformation); a foreign `outputSchema` is kept or that tool is dropped (never rewritten), and
  a foreign `inputSchema` is projected onto the enforced schema subset. Startup failure is
  contained — the server is recorded `unavailable`/`failed` with its stderr tail.
- **Roles** are resolved per call by `mpd-roles` (a lazy merge of the base roster with
  extension-contributed roles at lookup time, never an apply-time merge), so an extension role is
  usable through `mpd_role_spawn` / `mpd_role_persona` and as a workmate base template. It never
  becomes a teammate on its own: a teammate exists only when the Lead spawns it by name with
  `spawn_teammate`.
- Four tools inspect all of it — `mpd_ext_list`, `mpd_ext_show`, `mpd_flow_list`, `mpd_flow_show` —
  and `scripts/mpd-ext.mjs` (`validate` / `scaffold` / `list`) shares the same runtime validator.

### Service timing
Sibling-provided services are read **lazily at tool-execute time**
(`mpd_modelchain`, `mpd-workmate` do `ctx.get("mpdRoles")` inside `execute`), matching
the proven QA-roles-probe pattern: at apply time not every bundle plugin has applied
yet.

## 6. State layout

| Path | Owner | Notes |
|---|---|---|
| `<workspace>/.mpd/team/` | legacy team records + the watchdog's OWN namespace | the official Team service keeps the roster, the mailbox and the board in the Lead's session log, so no shipped row writes a team record here; the watchdog keeps `<stateDir>/watchdog/{heartbeat,scene,hold,incidents.jsonl}` under it, and the workmate in-use check still reads legacy `team.json` files when present |
| `<workspace>/.mpd/team-compact/` | mpd-team-compact | the compaction audit for a finished team's member contexts |
| `<workspace>/.mpd/plans/` | mpd-boulder / mpd-ulw | plan markdown files |
| `<workspace>/.mpd/memory.json` | mpd-modelchain | key/value notes |
| `<workspace>/.mpd/` (VCS-backed memory dir) | mpd-memory | git/svn-backed memory + reflection |
| `<workspace>/.mpd/mpd.jsonc` | mpd-config | project config layer |
| `<workspace>/.mpd/extensions/*/mpd-ext.json` | mpd-ext | the PER-CALL extension plane: re-read on every call from the calling session's workspace, so a QA boot launched from the repo cannot leak the repo's own extensions into a sandbox (skills + flows only) |
| **`~/.mpd/extensions/*/mpd-ext.json`** (user HOME) | mpd-ext | the host-wide user extension plane, discovered at apply (skills, flows, mcp, roles) — a deliberate HOME-scoped exception like the workmate library |
| **`<bundle>/extensions/*/mpd-ext.json`** | mpd-ext | the bundle-shipped host-wide extension plane (skills, flows, mcp, roles); it ships the disabled reference extension and disappears with an uninstall |
| **`~/.mpd/workmate/`** (user HOME) | mpd-workmate | the cross-project workmate library (`<key>/` instances + `.archive/` — deleted instances moved out of the library, restorable by a manual `mv` back) — deliberate user-approved exception to workspace-scoped state (§ AGENTS.md §6); QA boots with `HOME=<sandbox>` |
| `$DSH_HOME/.agent-presets/mpd*`, `$DSH_HOME/skills/*` | mpd-bootstrap | LEGACY only (bundle <= 0.2.6 stamped copies); removed on the first 0.3.0 boot — the bundle writes nothing to the home, and the preset is a ROW served from the bundle (§6c) |

## 6b. Harness adapter (the only seam contact)

`packages/mpd-dsh-adapter-plugin` is the bundle's ONLY contact surface with DeepSeek
Harness services. Every mpd row calls `dsh.registerTool` / `dsh.guardTool` /
`dsh.onPostToolExecute` / `dsh.executeTool` / `dsh.spawnAgent` /
`dsh.registerSkillProvider` / `dsh.loadSkill` / `dsh.resolvePreset` instead of the raw
`ctx.tools` / `ctx.subagents` / `ctx.skills` / `ctx.agentPresets`, so a harness release
that renames or reshapes a seam is absorbed in one file (AGENTS.md §6).

- The row is inserted before every other mpd row and provides the `mpdDsh` service;
  consumers use `ctx.get("mpdDsh") ?? createDshAdapter(ctx)`, so a plugin still works
  standalone in unit tests.
- The adapter is `inject`-free and resolves every seam lazily: the loader applies
  sibling rows concurrently (a snapshot at `apply` would under-report) and reading an
  uninjected service as a property throws in Cordis. `capabilities()` reports one
  boolean per seam for graceful degradation.
- Normalizations that used to be per-plugin: default object-rooted `parameters`,
  default text `output.render`, always-object `(args, exec)`, the adapter owning
  `next()` in the `tools/post-execute` waterfall, `run.result` awaited whether it is a
  promise or an object, `{ok, isError, value, error}` tool-call results, and
  `{output, structured, stopReason}` spawn results.
- QA proof: `bundle-lifecycle` asserts the composed row, the boot log line, the probe's
  `ADAPTER_SEAMS=…` snapshot and `ADAPTER_TOOL_CALL=ok` (a real `mpd_config_get` call
  through the normalized path).
- **Retained-code seam routing (the former boundary — CLOSED 2026-09-19; the code since RETIRED
  from the composition 2026-09-27):** the `agent-teams` body at
  `packages/mpd-agent-teams-plugin` (MIT) is kept as provenance and no loader row mounts it, but it
  still reaches every harness seam
  through this adapter — except the counted `setup(childCtx, child)` residual that AGENTS.md §6
  names (five lines in `lib/members.js`, asserted line-by-line, because that host-handed scoped
  ctx is passed to a vendored `_deps/dsh-agent` helper and a legacy Alpha.2 `childCtx` is not
  guaranteed to be `child.ctx`). `lib/mpd-adapter-ctx.js` — a NEW mpd-owned module (name rule
  `lib/mpd-*.js`, restorable byte-faithfully from the delta registry) — builds the facade once
  at the top of `apply`, so the SIX bridged adopted files (`lib/index.js`, `lib/capabilities.js`,
  `lib/harness-compat.js`, `lib/members.js`, `lib/command.js`, `lib/tools.js`) consume the facade
  and the remaining adopted server files receive it unchanged. Keeping it adapter-routed is exactly
  why the code is retained rather than deleted: a later wave can delete it without re-deriving the
  D6 analysis. The facade resolves the mounted
  `mpdDsh` service lazily and falls back warn-once (exactly one absent line per plugin instance),
  so the plugin still applies with the adapter absent. FOURTEEN adapter methods carry the
  traffic, each behind a `capabilities()` flag (one flag may cover two methods; `subagentRuntime`
  reuses the existing `subagents` flag): `registerHostTool` (verbatim, `Object.is`),
  `subagentRuntime` / `subagentProvider` / `subagentProviders` / `startContinuableAgent` /
  `interruptAgent`, `llmListModels` / `llmResolveCallConfig`, `registerPromptSection`,
  `agentScope`, and the `agentTurn*` family (`startAgentTurn` / `cancelAgentTurn` /
  `steerAgentTurn` / `injectAgentMessage`). The local adaptations that remain are unchanged —
  the `installContinuableMemberSetup` boot-safety guard wrapping the host's
  `registerContinuableSetup`, the workmate persona injection, and the re-vendor-resistant
  `mpd-delta` regions. The closure is stated WITH its residual set in AGENTS.md §6 (R1–R5 plus
  the counted `members.js` bypass), and the bridged region ids live in
  `agent-references/agent-teams-deltas.md`.
- The ADAPTER's own team surface is what the shipped consumers use: `teamMembership`,
  `teamListMembers`, `teamListTasks`, `teamCreateTask`, `teamGetTask`, `teamUpdateTask`,
  `teamSendMessage`, `teamSpawnTeammate`, `teamInterrupt`, `teamWaitForChange` and
  `teamLiveTeams` — each a thin,
  never-throwing projection over the mounted `agentTeams` service, so no mpd plugin (the watchdog,
  the roster guard, the ULW engine, the TUI or the web routes) references `ctx.agentTeams`
  directly.

## 6c. Agent preset plane (the `mpd` preset)

`presets/mpd.patch.yml` declares the `mpd` preset as an ordinary **ROW**: an insert of `preset-mpd`
(`name: '@deepseek-ai/dsh-agent-preset'`, `config.id: mpd`, the child entry list inline under
`config.plugins`). That child list IS the agent-plane composition every `mpd` session joins, and the
file is the manifest's SECOND `dsh.bundle.patch` entry; `packages/mpd-bundle/cordis.patch.yml`
id-targets `agent-preset-registry` to `{ default: mpd }`. Harness **0.1.7-rc.2 replaced the
directory form**: `@deepseek-ai/dsh-agent-presets` (which served `preset.yml` + `agent.cordis.yml`
from a preset root) no longer exists, so there is no `<bundle>/presets` preset root and no
`$DSH_HOME/.agent-presets` copy.
It is a **row-for-row mirror of the shipped `standard` preset** of the harness that is
actually installed, and that mirroring is load-bearing:

- The harness moves model-facing rows between the host plane and the preset plane between
  releases. The Web overlay disables the HOST `tool-goal` / `command-goal` rows ("presets
  own the human command and model-facing tool"), so a preset that mounts only `tool-goal`
  leaves its sessions without `/goal`; `present` first shipped in 0.1.5-alpha.2 and is the
  tool behind the Web deliverables row. A missing row is therefore a missing capability —
  it produces no error at all.
- A row's `config` is validated against the installed plugin's own schemastery schema when
  the row is applied. The two failure modes differ in visibility: a **missing required key**
  fails the row, and the preset registry then refuses the WHOLE preset
  (`agent-preset/invalid: … row(s) did not activate`), so every session on that preset fails
  to start; an **unknown key** is silently KEPT by schemastery, so the row applies and the
  setting it was supposed to carry never takes effect.
- Measured incident (2026-09-11, harness 0.1.5-rc.1 CLI + rc.2 packages): the persona row
  still used the single `text:` key that `dsh-persona` accepted through 0.1.2-rc.1. From
  0.1.3-alpha.2 that row registers the deployment persona prefix/suffix sections and
  `prefix` is REQUIRED, so the row failed and the whole preset refused to mount —
  `$.prefix missing required value` on every `mpd` session creation. Nothing in the gate set
  saw it: `--dump-config` never executes plugin code, `agentPresets.list`/`resolve` parse the
  composition for YAML shape and row resolvability only, and no case created a session.
- The gate is `skills/dsh-qa/scripts/preset-conformance.mjs`: its `--self-test` validates
  every `@deepseek-ai/*` row of the preset, the bundle patch and the QA overlays against the
  INSTALLED schemas (unknown keys included, `!!js` nodes materialized) and pins row-id parity
  with the installed `standard` preset; its real run boots the web profile in an isolated
  `DSH_HOME`/`HOME` and creates a session with `agentPreset: "mpd"` over the gateway — where
  `session/create` mounts the preset's standing composition and refuses on any inactive row —
  and a negative control boots the same sandbox with the retired `text:` persona form and
  must fail, so the assertion cannot pass vacuously.

## 7. Web client wiring (the subtle part)

`packages/mpd-bundle-plugin/client.js` (generated by `scripts/build-mpd-client.mjs`) is
one script:

1. the retained agent-teams `lib/client.js` **verbatim** — it self-registers
   `@nanmicoder/dsh-agent-teams`. It is used strictly as a **view library**:
   `scripts/patch-agent-teams-client.mjs` additively exports its views (`TeamSection`,
   historic cards), monitor store, zh/en dictionaries and CSS through a pinned export
   bridge that `scripts/vendor-agent-teams.mjs` re-applies after every refresh, and the
   adopted `apply(ctx)` is **never called** — that is what registered the removed surfaces;
2. a `__ModuleLoader__.load({ id: "@mpd-dsh/team-page", factory })` entry retained from the same
   vendored body (`src/team-page.js`). Its HOST half was the retired `agent-teams` plugin's routes
   (`/plugins/dsh-agent-teams/{state,halt,plan,assets}`), and no mounted row serves those any more —
   so **the shipped team surface is the official plugin's panel** (`mpd-ui-agent-team`, next
   section), and this entry is NOT documented as providing one;
3. a third `__ModuleLoader__.load({ id: "@mpd-dsh/mpd", factory })` whose factory
   contributes the **workmate library** as its own sidebar tab.

**Seam policy (the failure this file exists to prevent).** The web boot asserts, for
every entry, that every declared `inject` service is registered; a declared-but-missing
service leaves the entry `pending` and throws `Failed to load plugins`, which blanks the
whole GUI. The bundle factory therefore declares only `slots` + `locale`. The drift that
forced the first half of this: current DSH releases dropped `conversationEvents` for
`conversationViews`, and since the adopted client half used that seam only for the removed
in-conversation card, the client half is not applied at all any more. Every optional mount
stays contained in try/catch.

**The other half of the rule — and the bug that hid behind it.** "Never declare an optional
seam" does NOT mean "probe it with `ctx.get`": cordis resolves services through the fiber's
own scope, so a service owned by ANOTHER plugin is invisible to a one-shot probe, and
`notify()` only re-evaluates fibers that DECLARE the name, so a probe can never recover
either. Measured on the live GUI: `ctx.get('betterSidebar')` answered `false` inside
`apply()` and `true` eight seconds later, both sidebar pages silently registered nothing,
and the sidebar's `+` menu offered no mpd row at all. The fix is the runtime's own pattern —
`ctx.inject(['betterSidebar'], cb)` (the same call better-sidebar uses for its
asynchronously-mounted `remote.session`) — which waits for the provider, re-runs after a
provider remount, and never parks this entry: a profile without the sidebar simply never
fires the callback. `packages/mpd-bundle-plugin/test/client-harness.mjs` models that race by
default (the sidebar service is published AFTER `apply()`), so the suite fails loudly if a
probe ever comes back.

**Both mpd surfaces are sidebar-hosted; the team panel is the official plugin's.** `WorkmateLibraryView`
is contributed
by `registerSidebarTab` as a **DSH-better-sidebar** tab
(`ctx.betterSidebar.registerTab({id: "mpd-workmate", …})`, `single: true`, order 90). Without
DSH-better-sidebar it logs exactly one
warning (`… has no host (no floating fallback by design)`) and registers nothing, so no
surface exists outside the sidebar. The host itself is not an optional third-party extra:
`dsh-better-sidebar` is a declared runtime dependency and the guarded `mpd-better-sidebar` row
mounts it (§4), so that warning path is what a missing or broken dependency produces, not
something a normal install sees. The **Agent Teams panel** is separate and does not depend on that
sidebar at all: it is the official `@deepseek-ai/dsh-experimental-client-ui-agent-team` client
plugin, mounted by the bundle's own `mpd-ui-agent-team` row, and it registers a
conversation-header action that renders the Lead session's `agentTeam` projection (roster + task
board, read-only). `scripts/build-mpd-client.mjs` enforces the sidebar rule at build
time: it fails if any mpd client source registers `agent-teams-activity`,
`conversation.chat.node`, `shell.overlay` or `sidebar.footer.action` — the removed card, the
removed activity floater and the removed workmate floater/footer toggle.

Host data comes from lazy-registered routes on the `mpd-workmate` host plugin
(`GET /plugins/mpd-workmate/list`, `GET /plugins/mpd-workmate/roster` — the roster-backed
base picker, `GET /plugins/mpd-workmate/get?name=` — persona/memory/note detail, `POST
/plugins/mpd-workmate/init`, and the two mutation routes `POST /plugins/mpd-workmate/rename`
+ `POST /plugins/mpd-workmate/delete`, which answer the same reason-coded refusals the
tools raise — `400 invalid-name` / `400 confirm-required` / `404 unknown` / `409 collision` /
`409 in-use` with the `blocking` team list, plus `405` + `allow: POST` on a wrong verb).
All register via
`webServer.register` and retry on `internal/service` binding (a webless profile stays
tool-only).

## 7b. TUI edition wiring (the counterpart of §7)

The same bundle mounts under the host's `dsh-tui` profile as the **third** patch layer: host-base
(`@deepseek-ai/dsh-base`) → host-tui (`@deepseek-harness-tui/dsh-tui`) → this bundle, measured as
`dsh.profile.bundles = ["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"]`
(`evidence/tui/composition/20260915T053445Z/`). The bundle patch contributes ONE TUI row:

- `mpd-tui` → `@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js`. The package ships **no**
  `cordis.patch.yml` of its own: the bundle patch owns that row id, and a second mount would duplicate
  a loader entry id, which the loader rejects outright.

What that plugin does — and what it deliberately does not:

- **Does** bind the host's activation-gated TUI seams, each through a soft probe
  (`ctx.get(id, false)`) so an absent service degrades with a warning instead of failing the boot: the
  keyed status line (`tuiStatus`), the `/settings` section (`tuiSettingsSections`), the full-screen
  board (`tuiScenes`), the `/mpd` command tree (`tuiCommandTrees`), keyboard shortcuts
  (`tuiShortcuts`), managed dialogs (`tuiDialogs`) and the transcript-renderer registration
  (`tuiRenderers`; the host projects no row for the bundle's renderer event). Every registration is
  disposed through `ctx.effect`.
- **Does not** write to the filesystem at all — the settings write-back lives in
  `packages/mpd-config-plugin` (below), and the TUI package's zero-write property is asserted by its own
  lane (`tui-settings-bridge.mjs`, check T7). It also claims no admitted Component identity: the
  bundle-level `dsh-plugin.json` declares the host facet, and the host's own admission answers
  `waiting_authorization` for the four default-deny decision-event permissions, so the effect ledger
  attributes the registration as `undeclared` (`docs/tui.md` §4 and §6.1).

**The seam providers, in the order the composition resolves them.** (1) The **settings-section
provider** is `packages/mpd-config-plugin`: it registers the `mpd` namespace through the adapter's
`settingsRegister` with a **file-derived base** — the workspace's `<workspace>/.mpd/mpd.jsonc` value
when exactly one session root is live, the mount-time (exec-less) root when none is, and
`ambiguous-multi-root` (no invented base) when several are — and it owns the **write-back**, triggered
by the host's `settings/document-updated(ns, revision)` event filtered to `source === 'update'`, under
a lock plus compare-and-swap, a sibling temp file and an atomic rename. (2) The **host-served
`tuiSettingsSections` seam** is what renders the section: the TUI package registers a section for the
namespace `mpd` (with a guarded fallback for compositions that lack the config plugin) and the host
binds that registration to its own `/settings` screen — that provider/host split is why the screen can
open on the file value while the TUI package itself never reads the file. (3) The **status publisher**
is the TUI package's `tuiStatus` keys: each key is set from the session workspace's `.mpd` state
(workspace resolved per call through the adapter) and disposed with the plugin's own `ctx.effect`, so a
plugin reload cannot leave a stale line behind.

## 8. Security & isolation

- Credentials are never stored, logged, or echoed by any plugin; QA copies the
  sandbox's `.credentials.yaml` once and asserts the sandbox path.
- QA never touches the real `~/.dsh` or the real `~/.mpd/workmate` (HOME is sandboxed).
- Adopted code keeps its MIT license + provenance (`LICENSE-NOTICES.md`); runner
  binaries are optional dependencies and are never bundled.

## 8b. Known limits of the design

The design is deliberate about what it does not promise. These are the limits a reader of this
document should carry, stated rather than left to be discovered:

- **A composition dump is not a load.** `dsh --profile <p> --dump-config` composes rows and never
  executes plugin code, so it can never witness a plugin load, a schema abort or a missing seam.
  Every behavioural claim in this document rests on a gate or a real tool call instead (§4).
- **The preset plane is validated only by a mounting boot.** A row whose `config` misses a REQUIRED
  key fails the row and the preset registry then refuses the WHOLE preset (`agent-preset/invalid: …
  row(s) did not activate`) — while an UNKNOWN key is silently kept by schemastery, so the row
  applies and quietly loses that setting. `agentPresets.list` / `resolve` see neither class; only
  `skills/dsh-qa/scripts/preset-conformance.mjs` (with its negative control) does (§6c).
- **No plugin-module hot reload.** ESM caches a module at session start, so a plugin edit is
  invisible until `dsh` restarts; an edit applied mid-session must be verified on the next boot.
- **Two configuration paths with different latency.** The `mpd.jsonc` layers (schema defaults → the
  patch row's `config` → the file) are read once at plugin mount, so a `.mpd/mpd.jsonc` edit lands
  at the next boot; the settings document path (the TUI `/settings` screen, the write-back and the
  `settings/document-updated` re-read) is the live path (§6c, §7b).
- **The watchdog hold is a contract, not yet an interlock.** The row owns
  `session-watchdog-hold` / `-resume` and the durable hold record; wiring the OFFICIAL dispatch
  gates that honour a hold is a later task. Until then a hold is recorded and reported, and a
  teammate's current turn is stopped by the official `interrupt_agent` (Lead-only) (§4).
- **The retained team body is NOT mounted.** `packages/mpd-agent-teams-plugin` is kept as
  provenance: no loader row mounts it, so none of its tools, its `.mpd/team` records or its
  sidebar panel is part of a shipped session. Its `lib/` stays adapter-routed (§6b) and its
  client half is retained as a view library (§7); deleting it is a declared follow-up, not an
  oversight.
- **The web client's mpd page is sidebar-only.** There is no in-conversation fallback: the mpd page
  lives as a sidebar tab, and an optional seam must be mounted with `ctx.inject([...])` rather than probed
  with a one-shot `ctx.get` — a probe cannot see a service another plugin owns and cannot recover
  when that provider mounts late (§7). The sidebar host is installed with the bundle (the declared
  `dsh-better-sidebar` dependency plus the guarded `mpd-better-sidebar` row, §4), so this limit
  describes the code path, not an extra install step the user owes. The Agent Teams panel is the
  exception by construction: the official client plugin renders it in the CONVERSATION HEADER, not
  in the sidebar.
- **Two rows are inert or degraded by design.** `mcp-gitbash` ships disabled (Windows-only upstream)
  and `mpd-tui` degrades warn-once in a composition with no TUI seams, so "the row is composed" and
  "the capability is present" are different statements (§4).
- **The vendored skill corpus is a pinned snapshot.** `skills/**` is fingerprinted in
  `VENDOR_LOCK.json`; a corpus edit invalidates that fingerprint, so edits are serialized through a
  single writer per wave and the re-pin lands in the same commit as the change.
- **The rename and this document's role.** This document IS the design document the bundle links to
  (`docs/design.md`, with `docs/design.zh-CN.md` as its twin); its own switch links and the links
  inside the pair are maintained here. Records that predate the rename — `docs/decisions.md` and the
  prior-phase reports — keep the former filename on purpose: they are historical records, not live
  documentation.

### Residual gaps carried from the fact base and the baseline measurement

Two pre-wave evidence artifacts were read before this document was frozen; their stated limits are
carried forward here instead of being dropped:

- **The composition column is composition evidence, not load evidence.** The fact base's composition
  section rests on the patch, the two installed profile manifests and a live tool list — its own
  `dump-config` runs failed on a read-only filesystem — so §4 cites the stored
  `evidence/tui/composition/20260915T053445Z` artifacts. **No mounting boot in an isolated
  `DSH_HOME` was run for this document**; `skills/dsh-qa/scripts/preset-conformance.mjs` and
  `bundle-lifecycle.mjs` remain the gates that would prove a load.
- **The fact base is hash-anchored and therefore perishable.** It was measured while this document
  was being rewritten, so its line references describe the pre-rewrite bytes even though the
  findings it reports — the §4 table missing `mpd-team-watchdog`, `mpd-team-compact` and `mpd-tui`,
  a roster surface claimed as a slash command that has no registration anywhere in the bundle, and
  the 8-vs-6 MCP count — are FIXED here.
- **The settings-knob count is deliberately not restated in this document.** The baseline
  measurement audited it (`25 = 13 non-slot keys + 12 teamModels leaves`, which the schema declares)
  and found no stale copy in this document or its predecessor; the count belongs to the README /
  user-guide / schema comment. For readers of that count: the 13 are 6 single-key sections + 7
  `watchdog.*` fields (not 13 sections), and FOUR — not three — `teamModels` slots are authoritative.
