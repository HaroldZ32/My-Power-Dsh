# mpd-config-plugin

**English** | [中文](./README.zh-CN.md)

Plan C / C7 — minimal `mpd.jsonc` runtime config layer.

Layers (deep-merged, project wins): project `<workspace>/.mpd/mpd.jsonc` and user
`$DSH_HOME/mpd.jsonc` (fallback `~/.dsh/mpd.jsonc`). JSONC (comments + trailing
commas) with prototype-pollution-safe merge.

## Known keys

- `memory.vcs`: `git | svn | both` (Plan C / C6 memory engine).
- `team.stateDir`, `hashline.enabled/guardEditTools`,
  `commentChecker.autoCheck/bin`, `modelchain.<role>`, `boulder.dir`,
  `ulw.maxRounds`.

## Service / tools

- Provides the `mpdConfig` service for other mpd plugins (`inject: ["mpdConfig"]`):
  `get(key?)`, `reload()`, `states()`.
- `mpd_config_get` / `mpd_config_reload` tools.

Boundary: the bundle patch stays the composition truth; this layer only feeds
plugin runtime config and never mutates dsh patch rows.
