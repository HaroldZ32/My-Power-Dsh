# t32 — Host seam dossier: settings service, web settings card, workspace identity, offline JSONC editing

Task: `t32` (requirements), member **Researcher** (read-only role; the ONLY writes are the files in this
directory, which the task's `inScope` grants explicitly). Attempt id `9ab97a10-b33a-4dfc-a8d6-3e163f32e31c`.

Every claim below is measured against the INSTALLED packages on this machine, not memory or spec prose:

- host CLI/engine `@deepseek-ai/dsh` **0.1.5-rc.1**, packages `0.1.5-rc.2`:
  `/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
  (abbreviated below as `$H/`).
- TUI host `@deepseek-harness-tui/dsh-tui` **0.10.1**:
  `/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-harness-tui/dsh-tui/`
  (abbreviated `$T/`).
- this repo at `/root/dshProj/my-power-dsh` (abbreviated `$R/`).

---

## (a) `ctx.settings` — the settings service seam

**Service id.** `settings`, registered by `dsh-settings` (`$H/dsh-settings/lib/index.js:238` —
`super(ctx, "settings")`), declared on the Cordis context at
`$H/dsh-settings/lib/types/index.d.ts:111-115` (`interface Context { settings: SettingsProvider }`).
It is the abstract `SettingsProvider extends Service` (`:157`); the concrete provider is
`FileSettingsProvider` from `dsh-settings-file`.

**Declaring/serving a namespace.** `ctx.settings.register(ns, schema, options?)` →
`SettingsScope<T>` (`$H/dsh-settings/lib/types/index.d.ts:216`). Options (`:22-48`):
`base` (composition layer resolved below the user layer), `applies: 'live' | 'restart'`
(`:20`), and an optional cross-field `validate`. Namespaces are lowercase-hyphenated
(`:15-19`); a duplicate registration fails loud; the registration is an **effect on the calling
plugin's fiber**, so unloading the fiber removes the namespace and its observers (`:205-214`).

**What our plugin already does [MEASURED].** `$R/packages/mpd-tui-plugin/src/settings.ts`:
`SETTINGS_NS = "mpd"` (`:30`) and a schemastery `SettingsSchema` whose six keys mirror the mpd.jsonc
knobs (`:33-41`); registration is soft-probed through `onService(ctx, "settings", …)`
(`:134-146`) and issued as `provider.register(SETTINGS_NS, SettingsSchema, { applies: "restart" })`
(`:141`). The TUI section is a separate, display-only registration (`:157`). No other mpd plugin
registers or reads a settings namespace today; `$R/packages/mpd-config-plugin/src/index.ts` reads only
`.mpd/mpd.jsonc` + `$DSH_HOME/mpd.jsonc` (`:76-94`).

**Read.** Host-side `ctx.settings.get(ns)` → resolved value, `undefined` while unregistered
(`index.d.ts:243`); `ctx.settings.describe(options?)` → one `SettingsDescriptor` per namespace with
`value`, `revision`, `base`, `user` and `applies` (`:236`, descriptor shape `:50-73`; `revision` is the
monotonic revision of the RAW user section, `:58-61`; `user` presence marks "user-overridden",
`:66-68`). Wire surfaces MUST pass `redactSecrets: true` (`:86-96`).

**Subscribe.** Two independent paths, both host-side and both **namespace-only**:
1. Owner scope: `scope.watch((next, prev) => …)` (`index.d.ts:92-96`) — "invoked after each commit",
   serialized, contained failures, returns a disposer.
2. Cordis events (`types.d.ts:73-104`):
   `settings/updated(ns, next, prev, source)` (`:89`) — deep-equal-gated, emitted after the provider
   persisted/published; and `settings/document-updated(ns, revision)` (`:100-103`) — fires whenever the
   RAW section changed "whether or not the resolved value did", explicitly "for configuration surfaces,
   which must learn … that their held revision is stale". `source: 'update' | 'provider'`
   (`types.d.ts:15`).

**Where values persist [MEASURED].** `dsh-settings-file` → **one YAML or JSON document under the
harness home**, default `<DSH_HOME>/settings.yaml` (`$H/dsh-settings-file/lib/index.js:32`;
`Config` doc `:10-19`: `path` wins, else `<DSH_HOME>`/`~/.dsh` + `settings.yaml`; `watch` default true,
`debounceMs` default 100). Format is chosen by extension and only `.yaml`/`.yml`/`.json` are accepted —
anything else throws `settings-file: extension "…" is not supported` (`:21-23`, `:34`). Writes are
**comment-preserving leaf-level diffs**: the provider re-reads the document under a cross-process
writer lock, applies `setIn`/`deleteIn` edits on a `yaml` `Document` so "every untouched node — and the
key node of every changed pair — keeps its comments, anchors" (`:48-59`), then writes atomically
(`persistSection`, `:160-175`; `renderYaml`, `:265-275`; module doc `types/index.d.ts:1-5`).
⇒ **The comment-preservation property belongs to the YAML path of the settings document; it is not a
general JSONC facility and cannot be pointed at `.mpd/mpd.jsonc` (see (d)).**

**Write op shape + revision fence.** Path ops: `{ op: 'set', path: string[], value }` or
`{ op: 'unset', path: string[] }` (`SettingsPathOp`, `index.d.ts:143-150`). Namespace-level writes:
`update(ns, patch, expectedRevision?)` (`:256`), `replace(ns, section, expectedRevision?)` (`:268`) —
absent keys re-inherit base/defaults, `replace({})` resets — and
`mutate(ns, ops, expectedRevision?)` (`:282`), the path-addressed path intended for callers holding a
redacted (incomplete) view: ops apply to the section "as it stands when the write reaches the front of
the queue", so a caller "cannot delete fields it never saw" (`:269-281`). Fence semantics: the caller
sends the descriptor `revision` it read; a namespace that moved past it rejects with
`SettingsConflictError` (`code = "SETTINGS_CONFLICT"`, carries `expected`/`actual`, `:116-134`);
writes to one namespace are serialized in call order, and a raw-section change bumps the revision even
when the resolved value is unchanged (`:285-306`, `:297-304`).

## (b) The web card contract — `settings.plugin.item`

**Slot type [MEASURED].** `$H/dsh-client-ui-settings-plugins/lib/types/client/slot-contract.d.ts:19-30`:
`'settings.plugin.item': { kind: 'keyed'; scope: 'root'; owner: SettingsPluginItemOwnerProps }`, and
`SettingsPluginItemOwnerProps` is deliberately empty (`{ children?: never }`, `:27-30`). Keying is by
the settings namespace: "it registers its own settings namespace on the Host and its own card under
that key in the browser, and the tab pairs the two without ever learning what the namespace means"
(`:1-16`).

**Registration API a bundle client uses [MEASURED].** `lib/client.js:1785-1806` (the host's own cards):
```js
ctx.slots.inject("settings.plugin.item", function* () {
  yield ctx.slots.register({ name: "settings.plugin.item", key: NS, locale: NS_LOCALE, inject: () => ctrl.inject() }, Card)
})
```
`ctx.slots.inject(name, fn)` waits for the slot declaration; `register` takes `key` = namespace.
The tab dispatches by namespace: `renderSlot("settings.plugin.item", {}, { entryKey: ns })`
(`lib/client.js:412-416`), and its controller derives `ConfigurablePluginsTabController(ctx.settingsScope.describe(), () => ctx.slots.entries("settings.plugin.item"))` (`:1726-1730`).

**A served namespace WITHOUT a card renders nothing [MEASURED].** `lib/client.js:1091-1096`: "the tab
renders … the intersection of two ledgers: the namespaces the Host serves and the cards registered into
`settings.plugin.item`. A served namespace no card claims renders nothing … and a card whose namespace
the Host does not serve is never dispatched". Our `mpd` namespace is served (registered at
`$R/packages/mpd-tui-plugin/src/settings.ts:141`) and no card claims it ⇒ **the Web plugins tab shows
nothing for `mpd` today.**

**Props a card receives.** The registered component receives the slot context, which supplies
`renderSlot`/`t` (`lib/client.js:412`), and the card's own form shell passes `PluginCardProps`
(`lib/types/client/PluginCard.d.ts:20-34`): `t`, `titleKey`, `descriptionKey`, `state: CardShell`
(availability/writability/what a save would do), `onSave`, `onDiscard`, `children`. Own data comes from
injected controllers, not from the owner (owner props are empty, above). A card also "renders nothing
while its namespace is unavailable" (`PluginCard.d.ts:1-13`).

**How a card reads and writes [MEASURED].** Reads ride the shared mirror: the client-side service is
`ctx.settingsScope` (`$H/dsh-client-ui-settings/lib/types/client/index.d.ts:1-13`), whose
`SettingsScopeBinder.bind(spec)` returns a per-namespace `SettingsScope<T>`
(`settings-scope.d.ts`, `bind` doc) over `SettingsScopeSnapshot<T>`
(`settings-contract.d.ts:8-27`: `status`, `value`, `base`, `user`, `revision`, `writable`,
`mode: 'host' | 'memory'`) with `getSnapshot()`, `subscribe()`, `set()`, `unset()` and
`mutate(ops, expectedRevision?)` (`:29-100`). The write call the host's own cards make is
`await this.scope.mutate([{ op: "set", path: ["enabled"], value: … }], this.draftRevision)`
(`lib/client.js:1354-1361`, with conflict handling at `:1343-1349`), which lands on the wire as
`settings/mutate(ns, ops, expectedRevision)` (`$H/dsh-api-settings-controller/lib/typert.remote-client.d.ts`).

**Our bundle client can carry a card [MEASURED].** `$R/packages/mpd-bundle-plugin/src/web-client.js`
already declares `REQUIRED_SERVICES = ["slots", "locale"]` (`:39`, exported as `inject` `:50`), uses
`ctx.slots.inject(...) → ctx.slots.register({...})` for another slot (`:62`) and reaches drift-prone
services through `ctx.inject(["betterSidebar"], …)` (`:88-110`), and exports the client-module contract
`module.exports = { inject, apply, … }` (`:707`); `$R/scripts/build-mpd-client.mjs:1-6` states the
combined client must register the bundle id. So a `settings.plugin.item` card is addable to the existing
bundle client through the same pattern, injecting `settingsScope` (and `remote.settings`) the same way.

**Persistence caveat for the Web half [MEASURED].** `$H/dsh-client-ui-settings/lib/client.js:1345`:
`const persistence = ctx.remote.$host.isLoopback ? "host" : "memory"`. In `memory` mode the snapshot is
`status: 'unavailable'`, `writable: false`, `mode: 'memory'` (`:981-989`, `:1075`;
`settings-contract.d.ts:10-27`) — a **non-loopback browser session's settings writes never reach the
host document**. Any "the Web page always persists" claim must exclude remote (non-loopback) pages.

## (c) Workspace identity — the settings path carries NONE

**Answer: no session id, no cwd, no workspace root appears anywhere in the settings read, subscribe, or
mutate path.** Evidence:

- Host service API: `register/get/update/replace/mutate` take `(ns, …)` only — no session parameter
  (`$H/dsh-settings/lib/types/index.d.ts:216, 243, 256, 268, 282`).
- Provider: the document path is derived from plugin config + harness home
  (`resolveDshHome(config.dshHome)` + `settings.yaml`, `$H/dsh-settings-file/lib/index.js:32`); a
  grep for `workspaceRoot|workspacePath|cwd` across `dsh-settings/lib/index.js`,
  `dsh-settings-file/lib/index.js` and `dsh-api-settings-controller/lib/index.js` returns **nothing**.
- Wire: every generated remote signature takes only `(ns, ops|patch|section, expectedRevision)`
  (`$H/dsh-api-settings-controller/lib/typert.remote-client.d.ts`, `TypertRemoteNamespace$73657474696e6773`
  / `TypertRemoteMap` `settings/*`).
- Events: `settings/updated(ns, next, prev, source)` (`$H/dsh-settings/lib/types/types.d.ts:89`) and
  `settings/document-updated(ns, revision)` (`:100-103`) carry no session/workspace either.
- Client locality is loopback-vs-remote, **not** workspace (`lib/client.js:1345`).
- `dsh-scope` declares no settings scoping; the settings service is a single host-global document for
  every session of one `DSH_HOME`.

**Consequence.** A settings change cannot tell the bridge which
`<workspace>/.mpd/mpd.jsonc` to write. Candidate rules and their failure modes:

| # | Rule | Failure mode |
|---|---|---|
| R1 | **Per-session bridge** (a host-side consumer instantiated with the session's cwd, e.g. our adapter's `dsh.workspaceRoot(exec)` / the session header cwd) | A web-page edit has no session of its own; with N live sessions the change must be fanned out to N workspaces or attributed to the wrong one, and sessions started later never receive it |
| R2 | **Last-writer session** (write-back happens on the next tool call, using that `exec`'s workspace) | Silent mis-targeting: the file written is whichever workspace ran a tool first, not the one the user meant |
| R3 | **Explicit workspace in the change** (front door passes a workspace) | Not expressible today: the card's owner props are empty (`slot-contract.d.ts:27-30`) and the TUI section is display metadata only (`$T/lib/types/dsh-adapter/settings-sections.d.ts:1-13`) |
| R4 | **User layer only** (`<DSH_HOME>/mpd.jsonc`, workspace-independent) | Contradicts the user decision that `<workspace>/.mpd/mpd.jsonc` is the persisted target |

## (d) Offline JSONC editing — what exists, and what does not

**A comment-aware READER exists in this repo [MEASURED].**
`$R/packages/mpd-config-plugin/src/index.ts:21-51` — a hand-written, string-aware `stripJsonc(src)`
(removes `//` and `/* */` comments and trailing commas), consumed by `parseJsonc` (`:48-51`) and
re-exported with `deepMerge` (`:94`). The plugin's own header states the boundary: project layer
`<workspace>/.mpd/mpd.jsonc` merged over the user layer (`:1-7`, `:76-94`). `writeFileSync` is **imported
but never called** (`:8`, single occurrence) — the config layer is a reader today.

**No comment-preserving JSONC EDITOR is available offline in this checkout [MEASURED].**
- `$R/node_modules` contains no `jsonc-parser`, `comment-json`, `json5`, `strip-json-comments` or `yaml`.
- The only `packages/*/_deps` directory in the repo is
  `$R/packages/mpd-agent-teams-plugin/_deps` (no JSONC/edit library there).
- Copies of `jsonc-parser`/`strip-json-comments`/`json5` exist on this machine only inside **unrelated
  global tools** (`/root/.nvm/versions/node/v24.16.0/lib/node_modules/oh-my-claude-sisyphus/…`,
  `…/wavedrom-cli/…`) — not our dependency and not vendored by us.
- The host's own comment-preserving machinery is YAML-only: `dsh-settings-file` accepts `.yaml/.yml/.json`
  and rejects anything else (`$H/dsh-settings-file/lib/index.js:21-23, 34`), and its diff engine is the
  `yaml` package's `parseDocument`/`setIn`/`deleteIn` (`:6, 48-59, 265-275`) — it cannot be pointed at
  `.jsonc`, and JSON (had we used `.json`) has no comments to preserve in the first place.
- The only `jsonc` token in the installed host is a language-label map
  (`$H/dsh-tool-fs/lib/index.js:128` — `jsonc: "json"`), not a parser or editor.

**Implication.** A comment-preserving write-back to `.mpd/mpd.jsonc` must be **implemented or vendored by
us**. Two viable shapes: (i) extend the existing string-aware scanner in `mpd-config-plugin` into a
path-addressed surgical editor that rewrites only the target value's span and leaves every other byte
(comments, key order, whitespace) untouched; or (ii) vendor a small JSONC editor into a package `_deps/`
directory, following the repo's existing vendoring convention (`mpd-agent-teams-plugin/_deps`).

## (e) The TUI section metadata contract

`$T/lib/types/adapter/ports/channel-settings.d.ts`:

- `TuiSettingsSection` (`:181-196`): `ns` (must match a namespace the plugin registers — "the screen
  marks the section unavailable when the composition serves no such namespace", `:182-187`), `title`,
  `descriptions?: LocalizedDescriptions`, `groups?: readonly TuiSettingsGroup[]`, `fields`.
- `TuiSettingsGroup` (`:198-205`): `id`, `title`, `descriptions?`.
- `TuiSettingsField` (`:206-255`): `path: readonly string[]` (key path "in the settings service's
  `mutate` path vocabulary", `:207-211`), `label`, `descriptions?`, `hint?`, `hintDescriptions?`,
  `group?`, `kind`, `options?` (for `select`), `placeholder?`, `secret?: { ref }` (credential control —
  "the literal never rides the settings document", `:238-246`), `format?(value): string`,
  `parse?(text): TuiSettingsFieldWrite | undefined` (an invalid draft blocks the save, `:247-255`).
- `TuiSettingsFieldKind = 'text' | 'number' | 'boolean' | 'select'` (`:257`);
  `TuiSettingsFieldWrite = { kind: 'set'; value: unknown } | { kind: 'clear' }` (`:267-272`).
- Registry (`$T/lib/types/dsh-adapter/settings-sections.d.ts`): `register(section)`, `list()`,
  `section(ns)`, `subscribe(listener)` (`:17-20`); the seam is **display metadata only** — "Storage,
  validation and layering stay with the dsh settings service; this registry is display metadata only",
  and "The TUI owns the settings screen: rendering, staged editing, and the revision-fenced
  `settings.mutate` writes" (`:1-13`).

Our current section (`$R/packages/mpd-tui-plugin/src/settings.ts`): six fields
(`hashline.maxDiffChars` number, `commentChecker.autoCheck` boolean, `ulw.maxRounds` number,
`memory.vcs` select git|svn, `team.stateDir` text, `boulder.dir` text — `:60-125`), every `hint` built by
`knobHint()` and therefore carrying `UNBRIDGED_MARKER = "not bridged: a save here does not rewrite
.mpd/mpd.jsonc"` (`:54-58`, `:127-137`), section registered at `:157`.

---

## RECOMMENDATION — minimal design

Goal: an edit in EITHER front door takes effect for the mpd plugins AND persists to
`<workspace>/.mpd/mpd.jsonc`, without destroying comments, and without the TUI plugin package writing
any file.

1. **Keep the harness namespace `mpd` as the single edit surface.** Both front doors already converge on
   it: the TUI screen performs revision-fenced `settings.mutate` writes (`$T …/settings-sections.d.ts:1-13`)
   and a Web card would call `ctx.settingsScope.bind({ namespace: 'mpd' }).mutate(...)` (b). "Either front
   door takes effect" then costs nothing new — every mpd plugin can read the resolved value through
   `ctx.settings.get("mpd")` and observe `settings/updated` / `settings/document-updated` (a).
2. **Ownership.** The bridge module belongs in **`packages/mpd-config-plugin`**, the only module that
   already knows `<workspace>/.mpd/mpd.jsonc` (project layer), the `$DSH_HOME/mpd.jsonc` user layer, the
   JSONC reader, `deepMerge`, and the workspace root (`$R/…/mpd-config-plugin/src/index.ts:1-7, 21-51,
   76-94`). It must not be the TUI plugin: that keeps the TUI package free of filesystem writes and keeps
   the single-contact-surface rule (settings is reached host-side through the adapter, never directly
   from a plugin row).
3. **Read-in (JSONC → plugins).** `mpd-config-plugin` keeps resolving project-over-user and exposes the
   result two ways: unchanged as the `mpdConfig` service (existing consumers), plus a republish into the
   settings layer so both UIs show the file's real values as the inherited/baseline layer (§a option
   `base`/`installSection`, which exists exactly for "an optional-settings consumer"). The JSONC file
   stays the readable/editable source of truth; the settings document holds only explicit user overrides.
4. **Write-back (settings → JSONC) with an explicit, honest workspace rule.** Subscribe with
   `scope.watch()` or `settings/document-updated` (raw-section changes, the revision-surfacing event) and
   write the changed leaves through the JSONC editor in (5). Workspace selection, since the settings path
   carries no identity (§c): use **R1 per-session ownership** — the bridge instance is created with the
   session's workspace root (our adapter's `workspaceRoot(exec)`, i.e. the session header cwd) and syncs
   that workspace — and apply **R4-style honesty** for an unattributable edit (a Web write arriving with
   no live session): persist it in the harness settings document, and surface it in the UI/report as
   "not yet written to any `.mpd/mpd.jsonc`" rather than guessing a workspace (R2's silent mis-targeting
   is the failure mode to avoid). Document the multi-session fan-out explicitly: a global document plus N
   workspaces is a fan-out decision, not an accident.
5. **Comment preservation.** Implement the surgical editor inside `mpd-config-plugin` by extending the
   existing string-aware scanner (`:21-51`) into a path-addressed value-span rewriter — no new dependency,
   no vendoring, comments and key order byte-preserved everywhere the edit does not touch. (Vendoring a
   small JSONC editor into `_deps/` is the fallback if the surgery proves fragile; nothing usable exists
   offline today — §d.)
6. **Web half.** Add one card to the existing bundle client
   (`$R/packages/mpd-bundle-plugin/src/web-client.js`, built by `$R/scripts/build-mpd-client.mjs`):
   `ctx.slots.inject('settings.plugin.item', …) → ctx.slots.register({ name, key: 'mpd', locale, inject }, Card)`
   with `key: 'mpd'`, reading/writing through `ctx.settingsScope.bind({ namespace: 'mpd' })`; without it
   the served `mpd` namespace renders nothing (§b). State the loopback caveat in the card's copy: on a
   non-loopback page the client is in `memory` mode and the write never reaches the host document.
7. **TUI half unchanged.** The TUI package keeps registering metadata only (§e) and the six hints keep
   naming their `.mpd/mpd.jsonc` key — after the bridge lands, `UNBRIDGED_MARKER` must be replaced by the
   bridge's real semantics (a later, explicitly-scoped task: rewording only, no new seam).
