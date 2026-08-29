# Architecture

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
- 12 host plugins (config, tools, modelchain, roles, ulw, hashline, boulder,
  comment-checker, memory, codegraph, workmate, bootstrap) + the adopted agent-teams
  plugin and the bundle's own web-compat/client plugin,
- one agent preset (`mpd`) and a skill corpus, auto-copied at boot,
- a combined web client (the agent-teams activity panel + the workmate library).

The OMO-origin 11 agents are **not presets**: they live as a specialist roster
(`mpd-roles-plugin`) and as teammate instantiation templates in the adopted
`agent-teams` `mpd` profile.

## 2. Bundle assembly (Plan D)

`scripts/pack-mpd.mjs` assembles `dist/mpd-package/` — a relocatable npm package with
**no checkout-absolute paths**:

| Piece | Where it goes | Why |
|---|---|---|
| plugin dists | `packages/<pkg>/dist/index.js` | host rows reference them via `@mpd-dsh/mpd/packages/...` (the exports map) |
| adopted agent-teams | `packages/mpd-agent-teams-plugin/` (lib + `_deps/` + assets) | copied wholesale so the bundle is self-contained under any install layout |
| combined web client | `packages/mpd-bundle-plugin/client.js` | served as `@mpd-dsh/mpd`'s `./client` export |
| presets + skills | `presets/`, `skills/` | copied to `$DSH_HOME` by `mpd-bootstrap` at boot |
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
| `mpd-config` | mpd-config-plugin | minimal `mpd.jsonc` runtime config layer (project `.mpd/mpd.jsonc` merged over user `$DSH_HOME/mpd.jsonc`) | `mpd_config_get`, `mpd_config_reload`; service `mpdConfig` | `projectFile`, `userFile` |
| `mpd-tools` | mpd-tools-plugin | write guard (no silent clobber), tool-output truncation (token budget), edit-error recovery guidance | waterfalls only | `writeGuard`, `truncateMaxBytes`, `recoveryHint` |
| `mpd-modelchain` | mpd-modelchain-plugin | DeepSeek route resolution for roster roles + key/value memory notes | `mpd_modelchain_resolve`, `mpd_memory_save`, `mpd_memory_recall` | — |
| `mpd-roles` | mpd-roles-plugin | the 11 OMO-origin specialists as a roster (ids/normal names/personas/model chains/read-only) | `mpd_roles_list`, `mpd_role_spawn`, `mpd_role_persona`; service `mpdRoles` | `personasDir` |
| `mpd-ulw` | mpd-ulw-plugin | fixed plan→execute→verify loop discipline | `mpd_ultrawork`, `mpd_ulw` (light alias) | `maxRounds`, `maxReReviews`, `provider/model/reviewerModel`, `planDir`, `stateDir` |
| `mpd-hashline` | mpd-hashline-plugin | hash-anchored edit discipline (`LINE#HASH` anchors) | `mpd_hashline_read`, `mpd_hashline_edit`, `mpd_hashline_format`, `mpd_hashline_restore` | `guardEditTools`, `maxDiffChars`, `registryFile` |
| `mpd-boulder` | mpd-boulder-plugin | durable work ledger bound to plan markdown files | `mpd_boulder_status`, `mpd_boulder_start`, `mpd_boulder_complete`, `mpd_boulder_task_timer`, `mpd_boulder_plan_progress`, `mpd_boulder_plans` | `boulderDir` |
| `mpd-comment-checker` | mpd-comment-checker-plugin | comment/docstring detection (opt-in binary) | `mpd_comment_check` | `autoCheck`, `binary`, `timeoutMs`, `maxMessageChars` |
| `mpd-memory` | mpd-memory-plugin | VCS-backed memory (git/svn) + reflection state machine | `mpd_memory_write`, `mpd_memory_read`, `mpd_memory_reflect`, `mpd_memory_reflect_complete`, `mpd_memory_status` | `vcs`, `dir`, `agentSlug`, `reflectionEvery` |
| `mpd-codegraph` | mpd-codegraph-plugin | codegraph binary resolve + project index init | effect (auto init) + `/mpd-codegraph` command | `autoInit`, `initTimeoutMs`, `cooldownMs`, `binary` |
| `mpd-workmate` | mpd-workmate-plugin | durable evolving agent library under `~/.mpd/workmate/` | `mpd_workmate_list/init/spawn/reflect/match`; service `mpdWorkmate`; web routes `/plugins/mpd-workmate/{list,init}` | — |
| `mpd-bootstrap` | mpd-bootstrap-plugin | provisioning: copy the `mpd` preset → `$DSH_HOME/.agent-presets`, skill corpus → `$DSH_HOME/skills` (version-stamped, idempotent) | effect only | `presetsDir`, `skipPresets`, `skillsDir`, `skipSkills` |
| `mpd-web-compat` | mpd-bundle-plugin | web-compat self-row: makes `@mpd-dsh/mpd` a loader entry; hosts the combined web client | no-op apply; `./client` | — |
| `agent-teams` | mpd-agent-teams-plugin (adopted, MIT) | multi-agent team collaboration (captain, members, tasks, scheduler, Web panel) | `agent_teams_*` | `stateDir`, `memberProvider`, `memberMaxDepth`, `maxMembers`, `profiles` |
| `mcp-astgrep/gitbash/lsp/codegraph/context7/grepapp` | dsh-mcp-client instances | tool servers | `mcp__*` | per-row |

## 5. Interaction flows

### Roster → one-shot specialist
`mpd_role_spawn` reads the roster spec (`mpdRoles`), builds `persona + task`, then
`ctx.subagents.start("spawn", { agentOptions: { provider, model }, persona,
outputSchema, toolFilter (read-only deny) })`. The model route comes from the role's
chain (`roles.data.ts` chain[0]); **credentials resolve through DSH's own credential
mechanism — the plugin never touches API keys**.

### Roster → workmate → team
- `mpd_workmate_init` (base + optional name) copies a roster base into
  `~/.mpd/workmate/<name>/` (meta/persona/memory/note, capped 8/8/1.5 KiB) — the base
  stays pristine.
- After work, `mpd_workmate_reflect` appends a bounded memory entry (oldest evicted),
  merges a persona revision, regenerates the note (specialty kept + latest task), bumps
  `uses`.
- `mpd_workmate_spawn` reuses the instance one-shot: persona + memory + note + task on
  the instance's own route; the subagent is instructed to call `mpd_workmate_reflect`
  before its final report.
- `mpd_workmate_match` scores notes (keyword overlap + base-name boost, threshold 0.35);
  below threshold → `matched: false` + "initialize a new workmate" (never force a weak
  match).
- Team mode: `agent_teams_create(profile="mpd")` stages the normal-named roster as
  teammate templates. The patched `memberPersona()` in the adopted plugin checks
  `~/.mpd/workmate/<member-name>`: if an instance exists, the member's system prompt
  gets the workmate's persona + memory + note plus a `mpd_workmate_reflect` instruction
  ("captain checks the note, delegates to the workmate-named member").

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
| **`~/.mpd/workmate/`** (user HOME) | mpd-workmate | the cross-project workmate library — deliberate user-approved exception to workspace-scoped state (§ AGENTS.md §6); QA boots with `HOME=<sandbox>` |
| `$DSH_HOME/.agent-presets/mpd`, `$DSH_HOME/skills` | mpd-bootstrap | version-stamped, idempotent copies |

## 7. Web client wiring (the subtle part)

`packages/mpd-bundle-plugin/client.js` (generated by `scripts/build-mpd-client.mjs`) is
one script:

1. the adopted agent-teams `lib/client.js` **verbatim** — it self-registers
   `@nanmicoder/dsh-agent-teams` (activity floater + team card + command view);
2. a second `__ModuleLoader__.load({ id: "@mpd-dsh/mpd", factory })` whose factory
   `require("@nanmicoder/dsh-agent-teams")` and mounts `agentTeams.apply(ctx)` plus the
   **workmate library** floater (`shell.overlay`, order 90) and a sidebar-foot toggle
   (`sidebar.footer.action`, "Workmates").

Host data for the workmate floater comes from lazy-registered routes on the
`mpd-workmate` host plugin (`GET /plugins/mpd-workmate/list`, `POST
/plugins/mpd-workmate/init`); the agent-teams floater uses
`/plugins/dsh-agent-teams/{state,halt,plan,assets}`. Both register via
`webServer.register` and retry on `internal/service` binding (a webless profile stays
tool-only).

## 8. Security & isolation

- Credentials are never stored, logged, or echoed by any plugin; QA copies the
  sandbox's `.credentials.yaml` once and asserts the sandbox path.
- QA never touches the real `~/.dsh` or the real `~/.mpd/workmate` (HOME is sandboxed).
- Adopted code keeps its MIT license + provenance (`LICENSE-NOTICES.md`); runner
  binaries are optional dependencies and are never bundled.
