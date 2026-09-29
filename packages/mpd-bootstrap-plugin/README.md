# mpd-bootstrap-plugin

**English** | [中文](./README.zh-CN.md)

Bundle asset provisioning, by REFERENCE: the row serves the bundle's own skill corpus
to every session through the harness adapter's skill provider and cleans up the home copies written
by older bundle versions. Nothing is copied into `$DSH_HOME` any more, so installing
the bundle installs its skills and removing the bundle removes them.

## What it does

- Resolves the package root by file location (no package-name resolution — the plugin
  must work under any install layout, including `link:` checkouts and relocation).
- Registers a skill provider through `mpd-dsh-adapter` (`name: mpd-bundle`,
  `source: bundled`, `rank: 600 = BUNDLED_SKILL_RANK`) over `<pkg-root>/skills`: directory bundles
  (`<name>/SKILL.md`) and flat `*.md` files, frontmatter parsed in-process by the SHARED
  parser `packages/mpd-ext-plugin/src/skill-frontmatter.ts` (the extension skill plane
  reads the same file format through the same module — see that package's README). The corpus
  is therefore visible exactly while the bundle is installed and disappears when the
  row unloads — no version stamp, no stale copy.
- Serves the `mpd` preset by the SAME rule: the bundle patch points the `agent-presets`
  roster at `<pkg-root>/presets` (see `cordis.patch.yml`).
- Migrates legacy installs: the version-stamped copies that bundle `<= 0.2.6` wrote
  into `$DSH_HOME/skills` and `$DSH_HOME/.agent-presets` are removed on the first boot
  of `>= 0.3.0`. The stamp file is the ownership proof — unstamped content (for example
  copies made by the legacy `scripts/install-profile.ts` flow) and user-authored
  skills/presets are never touched.
- Re-reads an edited skill on the next catalog read (`fs/observed` invalidation for
  model-facing `write`/`edit` inside the corpus).

## Config

| Key | Type | Default |
|---|---|---|
| `skillsDir` | string | `<pkg-root>/skills` |
| `skipSkills` | boolean | `false` (skip registering the corpus provider) |
| `skipPresets` | boolean | `false` (skip the legacy preset-copy cleanup) |
| `skipLegacyCleanup` | boolean | `false` (skip all legacy home-copy cleanup) |

## Why it exists

AGENTS.md §2 requires every capability to be a plugin, and §6 forbids logic in the
user home. Serving the corpus by reference is what makes `dsh plugin add` /
`dsh plugin remove` a whole-unit install/uninstall for the bundle, skills included.

## Usage

No user-facing tools. Install the bundle and start DSH; the preset appears in the
selector and the corpus appears in every session's skill catalog.
