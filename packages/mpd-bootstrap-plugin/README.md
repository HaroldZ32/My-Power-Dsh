# mpd-bootstrap-plugin

**English** | [中文](./README.zh-CN.md)

Bundle provisioning: at boot, idempotently copies the `mpd` preset into
`$DSH_HOME/.agent-presets/` and the skill corpus into `$DSH_HOME/skills`, stamped with
the bundle version so already-installed copies refresh only when the package version
changes.

## What it does

- Resolves the package root by file location (no package-name resolution — the plugin
  must work under any install layout, including `link:` checkouts).
- `syncTree(presets, userPresetsDir, version, ...)` copies preset dirs matching
  `mpd`/`mpd-*`; `syncTree(skills, userSkillsDir, version)` copies the whole `skills/`
  corpus.
- Version-stamped: the copy is skipped when the installed stamp equals the bundle
  version (bump `package.json` version → `node scripts/pack-mpd.mjs` → restart to
  refresh).

## Config

| Key | Type | Default |
|---|---|---|
| `presetsDir` | string | `<pkg-root>/presets` |
| `skipPresets` | boolean | `false` |
| `skillsDir` | string | `<pkg-root>/skills` |
| `skipSkills` | boolean | `false` |

## Why it exists

The packed bundle is installed without writing to `$DSH_HOME`; this row is the ONE
sanctioned boot-time writer to `$DSH_HOME` (AGENTS.md §6). It makes the shipped preset
and skills available to every profile the bundle is added to.

## Usage

No user-facing tools. Install the bundle and start DSH; the preset appears in the
selector after the first boot.
