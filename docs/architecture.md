# Architecture

**English** | [中文](architecture.zh-CN.md)

How my-power-dsh mounts inside the DeepSeek Harness (DSH), what each piece does, and
how the pieces talk to each other. Reading order: bundle assembly → boot chain →
plugin inventory → interaction flows → state layout → web client wiring.

## 1. Big picture

DSH is a Cordis host: plugins are rows in a composition (`cordis.yml` + patch layers),
services are provided/consumed per scope, and the model route is resolved from the
session's request header. my-power-dsh ships as an **npm bundle** (`@mpd-dsh/mpd`) whose
`dsh.bundle.patch` (`packages/mpd-bundle/cordis.patch.yml`) adds rows to any profile it
is installed into. It contributes:

- 8 MCP servers (ast-grep, git-bash [disabled by default], LSP, codegraph + remote
  context7 / grep.app),
- the harness adapter (`mpd-dsh-adapter`) every other row calls through,
- 13 host plugins (adapter, config, tools, modelchain, roles, ulw, hashline, boulder,
  comment-checker, memory, codegraph, workmate, bootstrap) + the adopted agent-teams
  plugin and the bundle's own web-compat/client plugin,
- one agent preset (`mpd`) and a skill corpus, served from the bundle (no home copy),
- a combined web client (the AgentTeams sidebar page + the workmate library).

The specialist roster's 11 specialists are **not presets**: they live as a specialist roster
(`mpd-roles-plugin`) and as teammate instantiation templates in the adopted
`agent-teams` `mpd` profile.

## 2. Bundle assembly

**The repo root IS the bundle package.** `package.json` is named `@mpd-dsh/mpd` and
declares `dsh.bundle.patch` (`./packages/mpd-bundle/cordis.patch.yml`), `dsh.client`,
the `exports` map the rows resolve through and the toolchain `optionalDependencies`, so
`dsh plugin add .` in the repo root installs the whole unit in ONE command (no pack
step). `scripts/pack-mpd.mjs` is the RELEASE step: it assembles the relocatable
`dist/mpd-package/` for publishing / tarball installs — a self-contained npm package with
**no checkout-absolute paths**:

| Piece | Where it goes | Why |
|---|---|---|
| plugin dists | `packages/<pkg>/dist/index.js` | host rows reference them via `@mpd-dsh/mpd/packages/...` (the exports map) |
| adopted agent-teams | `packages/mpd-agent-teams-plugin/` (lib + `_deps/` + assets) | copied wholesale so the bundle is self-contained under any install layout |
| combined web client | `packages/mpd-bundle-plugin/client.js` | served as `@mpd-dsh/mpd`'s `./client` export |
| presets + skills | `presets/`, `skills/` | SERVED from the package: the patch roots the preset roster at `presets/`, `mpd-bootstrap` registers `skills/` as a skill provider — nothing is copied into `$DSH_HOME` |
| `cordis.patch.yml` | package root | the `dsh.bundle.patch` layer |

Manifest invariants (why they exist):

- `main` / `exports["."]` → `packages/mpd-bundle-plugin/dist/index.js` — the loader
  resolves profile bundles through `exports["."]`; a bundle without it fails to load
  as an entry (`ERR_PACKAGE_PATH_NOT_EXPORTED`).
- `exports["./client"]` → combined client; `dsh.client.platform: "web"` — marks the
  bundle as a web client contributor.
- **No `dependencies` on `@nanmicoder/dsh-agent-teams`** — pnpm (the engine behind
  `dsh plugin add`) never links a bundle's transitive deps into the profile root, so a
  plain package-name row would silently self-disable (the E4 defect, see
  `docs/plan-e.md`). The adopted plugin is main code + its own vendored closure.

`scripts/build-mpd-client.mjs` composes the combined client (see §7).

## 3. Boot chain & the web-compat self-row

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

| Row id | Package | Purpose | Tools / service | Key config |
|---|---|---|---|---|
| `mpd-dsh-adapter` | mpd-dsh-adapter-plugin | THE single contact surface with harness seams: tool registration/guard/post-execute/execute, subagent spawn, skill provider + catalog, preset resolve, capability probing | service `mpdDsh` | `defaultTimeoutMs`, `quiet` |
| `mpd-config` | mpd-config-plugin | minimal `mpd.jsonc` runtime config layer (project `.mpd/mpd.jsonc` merged over user `$DSH_HOME/mpd.jsonc`) | `mpd_config_get`, `mpd_config_reload`; service `mpdConfig` | `projectFile`, `userFile` |
| `mpd-tools` | mpd-tools-plugin | write guard (no silent clobber), tool-output truncation (token budget), edit-error recovery guidance | waterfalls only | `writeGuard`, `truncateMaxBytes`, `recoveryHint` |
| `mpd-modelchain` | mpd-modelchain-plugin | DeepSeek route resolution for roster roles + key/value memory notes | `mpd_modelchain_resolve`, `mpd_memory_save`, `mpd_memory_recall` | — |
| `mpd-ext` | mpd-ext-plugin | the extension interface: one frozen descriptor contract, two planes (code `register()` + data-plane `mpd-ext.json`), lifecycle-split discovery, skills/flows providers, the runtime stdio MCP bridge, extension roles | `mpd_ext_list`, `mpd_ext_show`, `mpd_flow_list`, `mpd_flow_show`; service `mpdExtensions` | `quiet` + the lazy `mpd.jsonc` layer (`extensions.enable`, `extensions.disable`, `extensions.mcp.*`) |
| `mpd-roles` | mpd-roles-plugin | the specialist roster's 11 specialists as a roster (normal names/personas/model chains/read-only), merged per call with extension-contributed roles | `mpd_roles_list`, `mpd_role_spawn`, `mpd_role_persona`; service `mpdRoles` | `personasDir` |
| `mpd-ulw` | mpd-ulw-plugin | fixed plan→execute→verify loop discipline (C2 ultrawork v2) | `mpd_ultrawork`, `mpd_ulw` (light alias); commands `/ulw`, `/ultrawork` | `maxRounds`, `maxReReviews`, `provider/model/reviewerModel`, `planDir`, `stateDir` |
| `mpd-hashline` | mpd-hashline-plugin | hash-anchored edit discipline (`LINE#HASH` anchors) | `mpd_hashline_read`, `mpd_hashline_edit`, `mpd_hashline_format`, `mpd_hashline_restore` | `guardEditTools`, `maxDiffChars`, `registryFile` |
| `mpd-boulder` | mpd-boulder-plugin | durable work ledger bound to plan markdown files | `mpd_boulder_status`, `mpd_boulder_start`, `mpd_boulder_complete`, `mpd_boulder_task_timer`, `mpd_boulder_plan_progress`, `mpd_boulder_plans` | `boulderDir` |
| `mpd-comment-checker` | mpd-comment-checker-plugin | comment/docstring detection (opt-in binary) | `mpd_comment_check` | `autoCheck`, `binary`, `timeoutMs`, `maxMessageChars` |
| `mpd-memory` | mpd-memory-plugin | VCS-backed memory (git/svn) + reflection state machine | `mpd_memory_write`, `mpd_memory_read`, `mpd_memory_reflect`, `mpd_memory_reflect_complete`, `mpd_memory_status` | `vcs`, `dir`, `agentSlug`, `reflectionEvery` |
| `mpd-codegraph` | mpd-codegraph-plugin | codegraph binary resolve + project index init | effect (auto init) + `/mpd-codegraph` command | `autoInit`, `initTimeoutMs`, `cooldownMs`, `binary` |
| `mpd-workmate` | mpd-workmate-plugin | durable evolving agent library under `~/.mpd/workmate/` (mutations rename/delete, archive-first) | `mpd_workmate_list/init/spawn/reflect/match/rename/delete`; service `mpdWorkmate` (`list`/`get`/`read`/`rename`/`delete`); web routes `GET /plugins/mpd-workmate/{list,roster,get}` + `POST /plugins/mpd-workmate/{init,rename,delete}` | — |
| `mpd-bootstrap` | mpd-bootstrap-plugin | provisioning BY REFERENCE: registers `<bundle>/skills` as a skill provider through the adapter (rank 600 `bundled`) and removes the version-stamped home copies written by bundle <= 0.2.6 | effect only | `skillsDir`, `skipSkills`, `skipPresets`, `skipLegacyCleanup` |
| `mpd-web-compat` | mpd-bundle-plugin | web-compat self-row: makes `@mpd-dsh/mpd` a loader entry; hosts the combined web client | no-op apply; `./client` | — |
| `agent-teams` | mpd-agent-teams-plugin (adopted, MIT) | multi-agent team collaboration (captain, members, tasks, scheduler; its views back the AgentTeams sidebar tab) | `agent_teams_*` | `stateDir`, `memberProvider`, `memberMaxDepth`, `maxMembers`, `profiles` |
| `mcp-astgrep/gitbash/lsp/codegraph/context7/grepapp` | dsh-mcp-client instances | tool servers | `mcp__*` | per-row |

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
  refused with a names-only error, and `/roster` never serves an id either); omitting
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
  `finally`) plus a READ-ONLY scan of direct children of `<cwd>/.mpd/team/<teamId>/team.json`
  (archived teams live under `.mpd/team/archive/**` and are excluded by construction);
  rename gates the target key too. The gate, the collision guard and the mutation run with no
  `await` between them, so no spawn or reflect can interleave — no lock file. Writing
  `.mpd/team` state is never done here (that is the agent-teams plugin's state), and a read
  error fails OPEN.
- Team mode: `agent_teams_create(profile="mpd")` stages the normal-named roster as
  teammate templates. The patched `memberPersona()` in the adopted plugin checks
  `~/.mpd/workmate/<member-name>`: if an instance exists, the member's system prompt
  gets the workmate's persona + memory + note plus a `mpd_workmate_reflect` instruction
  ("captain checks the note, delegates to the workmate-named member").

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
  enters the agent-teams member list, which is static patch configuration.
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
| `<workspace>/.mpd/team/` | agent-teams | team stateDir override (teams + mailboxes) |
| `<workspace>/.mpd/plans/` | mpd-boulder / mpd-ulw | plan markdown files |
| `<workspace>/.mpd/memory.json` | mpd-modelchain | key/value notes |
| `<workspace>/.mpd/` (VCS-backed memory dir) | mpd-memory | git/svn-backed memory + reflection |
| `<workspace>/.mpd/mpd.jsonc` | mpd-config | project config layer |
| `<workspace>/.mpd/extensions/*/mpd-ext.json` | mpd-ext | the PER-CALL extension plane: re-read on every call from the calling session's workspace, so a QA boot launched from the repo cannot leak the repo's own extensions into a sandbox (skills + flows only) |
| **`~/.mpd/extensions/*/mpd-ext.json`** (user HOME) | mpd-ext | the host-wide user extension plane, discovered at apply (skills, flows, mcp, roles) — a deliberate HOME-scoped exception like the workmate library |
| **`<bundle>/extensions/*/mpd-ext.json`** | mpd-ext | the bundle-shipped host-wide extension plane (skills, flows, mcp, roles); it ships the disabled reference extension and disappears with an uninstall |
| **`~/.mpd/workmate/`** (user HOME) | mpd-workmate | the cross-project workmate library (`<key>/` instances + `.archive/` — deleted instances moved out of the library, restorable by a manual `mv` back) — deliberate user-approved exception to workspace-scoped state (§ AGENTS.md §6); QA boots with `HOME=<sandbox>` |
| `$DSH_HOME/.agent-presets/mpd*`, `$DSH_HOME/skills/*` | mpd-bootstrap | LEGACY only (bundle <= 0.2.6 stamped copies); removed on the first 0.3.0 boot — the bundle writes nothing to the home |

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
- **Boundary:** the adopted `agent-teams` plugin (`packages/mpd-agent-teams-plugin`, MIT,
  re-vendored from upstream on upgrades) is NOT routed through the adapter — its `lib/`
  is upstream main code that a vendor refresh would overwrite. It keeps its own `ctx.*`
  calls plus exactly one local adaptation, the `registerContinuableSetup` boot-safety
  guard in `lib/members.js` (see LICENSE-NOTICES.md).

## 6c. Agent preset plane (the `mpd` preset)

`presets/mpd/agent.cordis.yml` is the agent-plane composition every `mpd` session joins.
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
  fails the row, and `dsh-agent-presets.mountPreset` then refuses the WHOLE preset
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

1. the adopted agent-teams `lib/client.js` **verbatim** — it self-registers
   `@nanmicoder/dsh-agent-teams`. It is now used strictly as a **view library**:
   `scripts/patch-agent-teams-client.mjs` additively exports its views (`TeamSection`,
   historic cards), monitor store, zh/en dictionaries and CSS through a pinned export
   bridge that `scripts/vendor-agent-teams.mjs` re-applies after every refresh, and the
   adopted `apply(ctx)` is **never called** — that is what registered the removed surfaces;
2. a `__ModuleLoader__.load({ id: "@mpd-dsh/team-page", factory })` — the mpd-owned
   AgentTeams page (`src/team-page.js`): it composes those adopted views into one
   DSH-better-sidebar tab (id `mpd-agent-teams`, order 85, `single: true`) listing the
   conversation's live + archived teams with the staged-plan approval editor, the
   live-team-count badge and the `autoOpenOnTeamActivity` switch. Its auto-open is
   **seedless** (`openTab({ type })`): from dsh-better-sidebar 0.19 a seed carrying
   `path`/`url` is routed to DSH's NATIVE right column (`surface.openResource(
   fileAddress(sessionId, cwd, path))`) instead of this registered tab type, so the
   throwaway marker path it used to carry made the host resolve `<cwd>/team-activity`,
   fail `realpath` and raise `cannot resolve target …` in the GUI without ever opening
   the tab — a type-only open lands the tab in its own surface and expands it, which is
   what auto-open means here (`seedlessAutoOpen` in `agent-teams-sidebar` pins the
   shipped and the served bytes; `team-page.test.mjs` drives the real client). **Visual parity is a
   requirement**: the page renders the floater's own interior — the same `aside` root
   carrying the adopted `panel` class (which is where that stylesheet declares the
   `--dsw-alias-*` custom properties every adopted rule reads, so dropping it renders the
   sections unstyled), the same `panelHead` (title + busy dot + collapse control, using
   the platform's own `IconChevronDownOutline14`), the same `teams` scroll body, the same
   `emptyHint`/`archivedWrap`/`archiveLabel` markup. Only the window-manager half is
   overridden inline (position/size pinned to the pane, no drag/resize handles, no
   border/radius/shadow/backdrop blur) and the collapse control drives the sidebar's own
   `store.reduce` panel flag;
3. a third `__ModuleLoader__.load({ id: "@mpd-dsh/mpd", factory })` whose factory
   contributes the **workmate library** as its own sidebar tab and the null
   `conversation.chat.commandview` row that hides the `/agent-teams` command result.

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

**Both GUIs are sidebar-only — no fallback anywhere.** `WorkmateLibraryView` is contributed
by `registerSidebarTab` as a **DSH-better-sidebar** tab
(`ctx.betterSidebar.registerTab({id: "mpd-workmate", …})`, `single: true`, order 90) and the
AgentTeams page by `registerTeamSidebarTab`. Without DSH-better-sidebar each logs exactly one
warning (`… has no host (no floating fallback by design)`) and registers nothing, so no
surface exists outside the sidebar. `scripts/build-mpd-client.mjs` enforces this at build
time: it fails if any mpd client source registers `agent-teams-activity`,
`conversation.chat.node`, `shell.overlay` or `sidebar.footer.action` — the removed card, the
removed activity floater and the removed workmate floater/footer toggle.

Host data comes from lazy-registered routes on the `mpd-workmate` host plugin
(`GET /plugins/mpd-workmate/list`, `GET /plugins/mpd-workmate/roster` — the roster-backed
base picker, `GET /plugins/mpd-workmate/get?name=` — persona/memory/note detail, `POST
/plugins/mpd-workmate/init`, and the two mutation routes `POST /plugins/mpd-workmate/rename`
+ `POST /plugins/mpd-workmate/delete`, which answer the same reason-coded refusals the
tools raise — `400 invalid-name` / `400 confirm-required` / `404 unknown` / `409 collision` /
`409 in-use` with the `blocking` team list, plus `405` + `allow: POST` on a wrong verb);
the AgentTeams page drives the adopted monitor store, which
polls `/plugins/dsh-agent-teams/{state,halt,plan,assets}`. All register via
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
