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

## The `/settings` bridge (write-back)

This package owns the **write-back** half of the harness settings bridge: the
TUI `/settings` section and the Web GUI card edit the `mpd` settings namespace,
and a saved edit is projected into the workspace's `<workspace>/.mpd/mpd.jsonc`.

- **The namespace base (this package owns it):** `baseForNamespace()`
  (`src/index.ts:511`) derives the base under a cardinality rule — one live root ⇒
  that workspace's `<workspace>/.mpd/mpd.jsonc`; zero roots ⇒ the mount-time
  (exec-less) root (`DSH_WORKSPACE_ROOT` or the process cwd), an absent file there
  yielding an empty base (schema defaults) — the normal boot path; more than one
  root ⇒ **no file base is invented** (`base: undefined`, reason
  `ambiguous-multi-root`, every candidate warned and surfaced by `states()`), and a
  save in that state is refused. The base is **fixed for the process lifetime**
  (the host exposes no disposal handle for a live registration), which is why the
  shipped hint says "after a restart"; the **resolved value** plus this layer's
  **per-call file reads** are what consumers use, so each session still resolves its
  own file.
- **Read-in precedence:** L0 schema defaults < L1 `$DSH_HOME/mpd.jsonc` < L2
  `<workspace>/.mpd/mpd.jsonc` < **L3 the settings user section**, which is
  authoritative at runtime; a later file edit **unsets** the overlapping settings
  leaf, so neither direction silently loses a value.
- **Write-back** triggers on the host's `settings/document-updated(ns, revision)`
  event filtered to `source === 'update'`, and writes under a lock, a
  compare-and-swap on the raw bytes, a sibling temp file and an atomic rename.
  **Comments, key order and trailing commas survive** (measured: a real boot
  rewrote `hashline.maxDiffChars` 20000 → 31415 in a 21-line JSONC unchanged
  otherwise).
- **Workspace target:** the settings path carries no identity, so the target set
  is the live session workspaces at event time — exactly one ⇒ write; **zero ⇒
  `no-live-session`**; **several ⇒ `ambiguous-multi-root`** (every candidate
  named). Both skip cases change **no file** and the edit is **never lost**: it
  is stored in the host-global settings document and the config layer applies it
  to every workspace immediately.
- **Timing:** consumers read the config at plugin `apply()`, so a saved edit
  takes effect for the mpd plugins **after a restart**.
- **Degenerate targets are loud:** missing (created with a header comment),
  read-only (`denied` + path + errno, the settings edit still succeeds),
  concurrent (retry ×3 then `conflict`, the human's file untouched), unparsable
  (`unparsable`, never repaired).
- **Duplicate keys:** `SET` edits the LAST occurrence of a path and warns naming
  every occurrence line; `UNSET` removes EVERY occurrence in one descending-span
  pass (leaving one behind would keep the key effective in the file while the
  settings layer reports it unset). Refusal is reserved for unprovable spans,
  duplicated intermediates (`ambiguous-intermediate`), unparsable documents and
  read-only targets.

Evidence: `evidence/mpd-bridge/implementation/20260915T080138Z/` (two real boots,
one live root and two live roots), lane `skills/dsh-qa/scripts/tui-settings-bridge.mjs`,
re-review `evidence/mpd-bridge/review/REREVIEW-t49.md`, ruling
`evidence/mpd-bridge/captain/RULING-duplicate-unset-FINAL.md`.

Boundary: the bundle patch stays the composition truth; this layer only feeds
plugin runtime config — plus the write-back projection above — and never mutates
dsh patch rows.
