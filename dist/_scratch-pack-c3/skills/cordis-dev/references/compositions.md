# Editing Cordis compositions (patch layers, presets, placement)

A composition is an ordered list of patch layers over the bundle entry lists. Nothing edits a
declaration in place: a preset or a row is created or changed by a patch, and the patch travels
through a bundle install.

## The patch dialect

Each patch file is a YAML list of mappings:

- `insert: [rows]` appends rows. With an `id` naming an existing `group: true` row, the rows are
  appended INSIDE that group's `config` list.
- A patch with an `id` and no `insert` TARGETS the existing row with that id. Supplied fields
  replace the row's fields, and `config` is replaced **wholesale, never deep-merged** — restate every
  field the row needs. A truthy `name` asserts the existing plugin name rather than renaming it.
- Non-insert patches without a nonempty `id`, and targets that match no row, are warned about and
  skipped.
- In THIS repository, targeting a host-declared id is forbidden outright
  (`node scripts/verify-no-host-override.ts`).

A row has `id`, `name` (the plugin package specifier; inserted relative paths are anchored beside
their patch file), optional `config`, and optional `disabled`, `inject`, `intercept`, `isolate`:

- `group: true` with `name: cordis:group` makes `config` a nested entry list and lets patches insert
  into it by id; `cordis:include` loads a literal YAML/JSON entry list from `config.path`.
- `disabled` accepts a boolean, `null`, or a `!!js` expression evaluated at every mount decision.
- `!!js` scalars are loader expressions (never `!js`). Inside `config` they evaluate after the row's
  declared injections activate, against that plugin's context, so `!!js "!ctx.get('profileContext')"`
  is valid; other row metadata stays literal.
- `isolate` maps service names to `true` or a realm label. **A plugin that provides a service must
  isolate the provider and all its consumers in the same realm** — an entry-local realm (`true`)
  keeps a preset's instance apart from every other preset's. A shared LABEL joins realms; it does not
  pool instances.
- Service placement rule of thumb from the host: **scope controls contributions and event
  visibility; `isolate` controls service instances.** Keep a service consumed by host plugins (or by
  a Gateway remote) on the host plane; keep scoped tools, persona and prompt sections in the preset.

## Agent presets

In this harness a preset is an ordinary `@deepseek-ai/dsh-agent-preset` ROW, not a directory:

```yaml
- insert:
    - id: preset-review
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: review                 # required, lowercase letters/digits/hyphens
        name: Review               # optional display
        description: …             # optional
        order: 10                  # optional roster position
        plugins:                   # required: the child entry list, inline
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config: { prefix: You review software changes. }
          - id: tool-bash
            name: '@deepseek-ai/dsh-tool-bash'
```

- The loader row id is `preset-<id>` by convention.
- To CHANGE a shipped preset, override its row id and restate the COMPLETE `config` (see the
  wholesale-replacement rule above). This repository's `mpd` preset is declared that way in
  `presets/mpd.patch.yml`, listed as the second entry of `dsh.bundle.patch`.
- A declaration whose activation fails stays on the roster with its diagnostic and cannot compose a
  session until the bundle is fixed and reinstalled. Existing sessions keep the plugin revision they
  started with: validate changed behaviour in a NEW session.
- Legacy directory presets (`$DSH_HOME/.agent-presets/<id>/` with `preset.yml` + `agent.cordis.yml`)
  are no longer read by this harness. To migrate one, build a declaration row taking `id` from the
  directory name and `plugins` from `agent.cordis.yml` verbatim, then check every plugin name.

## Inspecting a composition

- `node scripts/dump-config.ts --profile <p>` (this repository's wrapper) prints the composed rows.
  It proves **COMPOSITION ONLY**: it never executes plugin code, so a schema/apply abort is invisible
  to it. Anything about plugin behaviour needs a mount boot.
- `cordis_inspect_query` `Config.listConfigs` lists the RUNNING loader entries (paged; `offset`,
  `limit`, optional exact plugin `name`; `total` + `nextOffset` bound the walk) with each entry's
  Config state (`schema`, `absent`, `unsupported`, `tree` for group/include carriers, `inactive` for
  disabled/unimported/destroyed entries) and, when resolvable, its `packageDir` — where the package
  README and built `lib/` live.
- Which package provides which plugin: the shipped `cordis-composition-reference` skill's
  `references/packages.md` (generated; search it with `grep -n <keyword>` rather than reading it
  whole), or `ls <dsh>/node_modules/@deepseek-ai` for the installed set. Plugins from installed
  bundles are named by `plugin_manager` `list_bundles`.
