# Bundles and Host plugins (generic form)

A **bundle** is a package whose `package.json` declares `dsh.bundle.patch`; the YAML patch it names
inserts plugin entries. Give the package and its rows unique names and read an existing patch before
editing: a matching override replaces the row's whole `config`.

## Manifest

A Host-only bundle needs no dependencies, install scripts, or build tool:

```json
{
  "name": "@local/my-plugin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`cordis.patch.yml`:

```yaml
- insert:
    - id: my-plugin
      name: '@local/my-plugin'
      config: {}
```

`dsh.bundle.patch` is a string OR an array of patch files, applied in order (this repository ships
`["./cordis.patch.yml", "./presets/mpd.patch.yml"]`). `dsh.client` (see `ui-plugin.md`) declares the
browser half. Every path-bearing value in a patch resolves through the loader's `baseUrl` (the
profile directory), which is what makes one patch work for both a checkout install and a packed
install.

## Display metadata and icon

Plugin Manager cards, bundle details and the Settings plugin inventory read display text and an icon
WITHOUT activating the plugin. Put title/description in `locale/en.json` (other languages such as
`locale/zh.json` use the same fields) and declare `icon` as a top-level `package.json` path:

```json
{ "meta": { "title": "My Decoration", "description": "Draws a badge under the composer." } }
```

```json
{
  "icon": "./icon.svg",
  "exports": { "./package.json": "./package.json", "./locale/*.json": "./locale/*.json" },
  "files": ["locale/*.json", "icon.svg"]
}
```

SVG, PNG, JPEG and WebP up to 256 KiB are accepted; absolute paths, URLs, paths outside the package
directory and symlinks leaving it are rejected. Missing fields fall back to `package.json`'s `name`
and `description`; malformed metadata produces a diagnostic and keeps the valid text.

## Host plugin export forms

`index.js` exports ONE of these; do not mix them:

- `export function apply(ctx, config) {}` with optional `export const inject = ['tools']` and
  `export const Config`;
- a service class as the default export.

Register every resource inside `apply` with `ctx.effect` or `ctx.on` and return its cleanup. A plugin
that declares `Config` validates the row's `config` at activation, so query `Config.listConfigs` for
an installed plugin's schema before writing its `config`, and follow `$defs` references in the
returned document.

**Optional services belong in `inject`** (or `ctx.inject([...], …)`) so the plugin stays inactive in
profiles without them instead of throwing — the same discipline this bundle states as "capability
probe, then degrade" (`dsh.capabilities()` on the adapter, `references/this-bundle.md`).

## Install, enable, observe

`plugin_manager` `install_bundle` performs package installation and bundle selection itself: do not
reproduce those steps with shell commands, and pass `approvedBuilds` only after the user explicitly
approves the reported pending build scripts.

`list_plugins` / `list_bundles` return exact identifiers; `set_plugin` / `set_bundle` toggle;
`remove_bundle` removes. Read the saved-state and activation outcomes separately: `failed` needs
diagnosis, `overridden` means a higher-priority layer wins, `restart-required` means the change is
not live. Installing a NEW bundle can activate through HMR; REPLACING an installed package requires
a restart to load a fresh JavaScript module generation — and an unchanged slot id is not evidence
that the browser code changed.

In THIS repository none of the above applies: rows are added to `cordis.patch.yml` and travel through
the profile mechanism (`references/this-bundle.md` §Mounting).
