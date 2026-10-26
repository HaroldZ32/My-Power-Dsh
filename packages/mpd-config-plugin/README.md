# mpd-config-plugin

**English** | [中文](./README.zh-CN.md)

Plan C / C7 — minimal `mpd.jsonc` runtime config layer.

Layers (deep-merged, project wins): project `<workspace>/.mpd/mpd.jsonc` and user
`$DSH_HOME/mpd.jsonc` (fallback `~/.dsh/mpd.jsonc`). JSONC (comments + trailing
commas) with prototype-pollution-safe merge.

## Known keys

- `memory.vcs`: `git | svn | both` (Plan C / C6 memory engine; `both` commits to each backend).
  `both` is selectable in Settings as well: the `SettingsSchema` union and the `SETTINGS_KNOBS`
  option list both carry it.
- `agentRoutes.<Agent>.{provider,model,reasoningEffort?,fallbacks?}`: the per-AGENT model
  routes — the unit of model configuration, one entry per roster member, with an optional
  per-agent `fallbacks` chain (see below). No default layer: an unset entry refuses that
  agent's single-call spawns with `AGENT_UNCONFIGURED`.
- `team.stateDir`, `hashline.guardEditTools/maxDiffChars/registryFile`,
  `commentChecker.autoCheck/bin`, `modelchain.<role>`, `boulder.dir`,
  `ulw.maxRounds`.

## Agent routes (`agentRoutes`)

**The ONE configured model route of every roster member is that member's OWN entry.** The unit of model
configuration is the AGENT; there is NO persisted slot:

```
agentRoutes: {
  "<Agent Name>": { provider?: string, model?: string, reasoningEffort?: string, fallbacks?: ModelRoute[] }
}
ModelRoute = { provider: string, model: string, reasoningEffort?: string }
```

Keys are the eleven display names (lookup is case- and separator-insensitive through the ONE exported
member-name normalizer, which lives in this package and is reused by the resolver, the migration writer
and every display path). The four groups exist ONLY as the `/mpd-model` bulk-edit grouping: a group edit
writes every member's own entry and stores nothing of its own.

- **No default layer.** There is zero `.default()` in the `agentRoutes` subtree (a schema default would
  beat the user's file, because the row-knob layer merges last): a workspace that configured nothing has
  no route, and an absent `agentRoutes` block reads as ABSENT (`get("agentRoutes")` is `undefined`,
  `mpd_config_get` does not invent one).
- **`teamModels` is a TOLERATED LEGACY block**, declared as a permissive node rather than a typed slot
  tree so an existing profile patch or row config still validates and boots. It is read ONLY by the
  one-time migration (below) and by `mpd_config_get`'s raw pass-through: it is NEVER read for routing
  and this bundle NEVER writes it.
- **An entry may carry its OWN fallback chain:** `fallbacks: [{provider, model, reasoningEffort?}, …]`,
  in precedence order. It is consumed ONCE before the spawn: the first candidate the live catalog
  POSITIVELY lists wins ("not listed" is not "unavailable"; with no positive listing the primary
  stands), the winner then passes the effort adaptation, and a malformed entry is dropped with one log
  line, never fatally.
- **The read is TOTAL.** `mpdConfig.agentRouteResolutionOf(member)` returns a typed union — `ok` (route
  + fallbacks), `unconfigured` (missing leaves named), `invalid` (the offending path named) or
  `unrouted` (an EXTENSION-contributed role; it carries no `agent` field on purpose) — and NEVER throws,
  so a display surface renders `<unconfigured>` instead of crashing. `agentRouteOf(member)` stays total
  too: the route when `ok`, `undefined` otherwise. The names `slotResolutionOf` / `teamModelRouteOf` are
  REMOVED.
- **An unusable route REFUSES the spawn** with ONE structured `AGENT_UNCONFIGURED` error naming the
  agent, the missing leaves (`agentRoutes.<Agent>.provider`, `.model`) and both recovery paths
  (`/mpd-model`, and `agentRoutes.<Agent>` in `.mpd/mpd.jsonc`), stating that nothing was written and no
  child was started. Only the three spawn appliers (`mpd_role_spawn`, `mpd_workmate_spawn`, the
  `mpd-roster` teammate provider) throw it; `unrouted` is NOT a refusal, so an extension role keeps its
  own chain and still spawns; an effort is never clamped. ONE EXCEPTION is the model-capability
  adaptation: a model whose catalog entry declares **no** reasoning efforts at all is sent none for that
  call, so it still runs (the adapter's `withSupportedEffort`).
- **Initialization is FILE initialization, not a runtime default, and the marker is VERSIONED.** On
  mount, for each live workspace root: if `agentRoutes` is already declared in ANY layer, write the
  marker `{"version": 2}` and change nothing else; else if the EFFECTIVE config declares `teamModels`,
  materialize all eleven `agentRoutes` entries from their groups' routes (one log line naming the legacy
  source) and write the v2 marker; else seed the eleven entries from the configured providers via the
  LLM catalog — model = the `deepseek-flash` family (an exact `deepseek-flash`, else a close `*flash*`
  id), provider = a configured provider that lists it, effort `max` for the slot-1 group and `high` for
  the rest — then write the v2 marker. Initialization runs whenever the marker is ABSENT, unparsable or
  below version 2 (v0.15.4/v0.15.5 shipped an unversioned marker, and a presence-only rule would strand
  those returning workspaces), and once the v2 marker exists a block you delete on purpose is never
  re-seeded. An existing block or user edit is never rewritten; with no usable catalog nothing is
  written and the first spawn reports `AGENT_UNCONFIGURED`.
- **Front doors:** the schema declares one three-leaf row per roster agent
  (`agentRoutes.<Agent>.{provider,model,reasoningEffort}`) in the TUI `/settings` section and the Web
  GUI card, grouped under the four group headings (grouping is DISPLAY-ONLY); an unconfigured agent
  shows `<unconfigured>` with the leaves it lacks. Both write `agentRoutes.<Agent>.<leaf>` and neither
  writes `teamModels`. Their option lists come from the live model catalog (the adapter's
  `llmCatalog()` server-side, the host's client catalog on the Web), falling back to
  `TEAM_MODEL_FALLBACK_OPTIONS` when that catalog is unavailable or degraded — so a leaf is always a
  selection, never free text.
- **Restart semantics:** the model routes are read PER USE, so a save (or a watched
  file edit) reaches the next spawn/resolve with no restart; `mpd_config_reload` forces
  a re-read.

## Service / tools

- Provides the `mpdConfig` service for other mpd plugins (`inject: ["mpdConfig"]`):
  `get(key?)`, `reload()`, `states()`, `agentRouteResolutionOf(member)`, `agentRouteOf(member)`.
- `agentRouteResolutionOf(member)` / `agentRouteOf(member)` are the reads that make a **saved**
  `agentRoutes` entry take effect. The first returns the typed, never-throwing union
  (`ok` / `unconfigured` / `invalid` / `unrouted`) that display surfaces render; the second returns
  `{ provider, model, reasoningEffort?, fallbacks? }` when `ok` and `undefined` otherwise. The roster's
  one-shot paths (`mpd_role_spawn`, `mpd_roles_list`, the workmate library and `mpd_modelchain_resolve`)
  read them through this service, so a saved route reaches them without a second cross-package import.
  The removed names `slotResolutionOf` / `teamModelRouteOf` must not come back.
- `mpd_config_get` / `mpd_config_reload` tools.

## The `/settings` bridge

This package owns the config side of the harness settings bridge. **The live save path is the ENTRY
document; the `mpd.jsonc` write-back is the RETIRED legacy path.** The TUI `/settings` section and the
Web GUI card both save the row's `mpd-config` ENTRY document (`ENTRY_CONFIG_ID`,
`configForms.get("mpd-config")`), and the HOST owns that store: this row's
`onSettingsDocumentUpdated(ENTRY_CONFIG_ID, …)` listener re-loads `state` from it and deliberately
writes NO workspace file. A `<workspace>/.mpd/mpd.jsonc` write exists only for the LEGACY `mpd`
namespace (`SETTINGS_NS`), whose registration the pinned harness REFUSES — `settingsModelRetired`, one
boot warning: "the legacy file write-back and override clearing are dormant" — so on the pinned host
that path never runs. A hand edit of `<workspace>/.mpd/mpd.jsonc` IS still read: the file layers are
re-read on every resolution and a mount-time `watchRoot` watcher picks the edit up through the same
150 ms debounce.

**The READ-BACK is live; the EFFECT is per knob.** `mpd_config_get` / `mpd_config_reload` re-read the
layers on every call and report the new value at once, but a consumer that captured its configuration
at `apply()` still acts on the old one. Two groups plus one special case, and this section states them
all — never only the promising half (`docs/user-guide.md` §9.1 is the per-knob table):

- **live in the running process** — the model routes (`agentRoutes.*`, `modelchain.*`),
  `team.gate` / `team.sensitivity`, the `team.stateDir` reader, and the two guards
  `captain.investigation` / `delegation.gate` (each reads the row's own `configValue` per decision);
- **captured at `apply()`, so they need the next `dsh` boot** — `hashline.*`, `commentChecker.*`,
  `ulw.*`, `memory.*`, `boulder.dir`, `goal.*`;
- **ONE special case — `watchdog.*`** — its ROW CONFIG is the defaults layer captured at mount, and the
  workspace `<workspace>/.mpd/mpd.jsonc` FILE layer is re-read on every knob refresh (at mount, on a
  `settings/document-updated` for the `mpd` namespace — a legacy host — and once per tick), so a hand
  edit of that file IS live. A front-door `/settings` save does NOT reach its knobs: the engine reads
  `settingsReader("mpd")` and never the `mpd-config` ENTRY document the form saves, so the stored value
  is the declaration while the knob values come from the row config and the file.

A settings-only save is never LOST: the host settings document keeps the value and the config layer
applies it to every workspace immediately — and because this path writes no file, it never waits for a
live session.

### The LEGACY namespace path (DORMANT on the pinned host)

The bullets below describe the `mpd` NAMESPACE bridge (`SETTINGS_NS`) — exactly what a host that still
serves that namespace runs. The pinned harness refuses the registration, so on this host the whole path
is dormant; it stays documented because the code still ships it and a legacy host still executes it.

- **The namespace base (this package owns it; LEGACY):** `baseForNamespace()`
  derives the base under a cardinality rule — one live root ⇒
  that workspace's `<workspace>/.mpd/mpd.jsonc`; zero roots ⇒ the mount-time
  (exec-less) root (`DSH_WORKSPACE_ROOT` or the process cwd), an absent file there
  yielding an empty base (schema defaults) — the normal boot path; more than one
  root ⇒ **no file base is invented** (`base: undefined`, reason
  `ambiguous-multi-root`, every candidate warned and surfaced by `states()`), and a
  save in that state is refused. The base is **fixed for the process lifetime**
  (the host exposes no disposal handle for a live registration); the **resolved value** plus the
  config layer's **per-call file reads** are what consumers use, so each session still resolves its
  own file.
- **Read-in precedence (LEGACY namespace layer):** L0 schema defaults < L1 `$DSH_HOME/mpd.jsonc` < L2
  `<workspace>/.mpd/mpd.jsonc` < **L3 the settings user section**, which is
  authoritative at runtime; a later file edit **unsets** the overlapping settings
  leaf, so neither direction silently loses a value. L3 needs a host that still serves the namespace;
  the L0–L2 FILE layers are the live read described above.
- **Write-back (LEGACY, dormant)** triggers on the host's `settings/document-updated(ns, revision)`
  event filtered to `source === 'update'`, and writes under a lock, a
  compare-and-swap on the raw bytes, a sibling temp file and an atomic rename.
  **Comments, key order and trailing commas survive** (measured on the legacy path: a real boot
  rewrote `hashline.maxDiffChars` 20000 → 31415 in a 21-line JSONC unchanged
  otherwise).
- **Workspace target (LEGACY, dormant):** the settings path carries no identity, so the target set
  is the live session workspaces at event time — exactly one ⇒ write; **zero ⇒
  `no-live-session`**; **several ⇒ `ambiguous-multi-root`** (every candidate
  named). Both skip cases change **no file** and the edit is **never lost**: it
  is stored in the host-global settings document and the config layer applies it
  to every workspace immediately.
- **Degenerate targets are loud (LEGACY, dormant):** missing (created with a header comment),
  read-only (`denied` + path + errno, the settings edit still succeeds),
  concurrent (retry ×3 then `conflict`, the human's file untouched), unparsable
  (`unparsable`, never repaired).
- **Duplicate keys (LEGACY, dormant):** `SET` edits the LAST occurrence of a path and warns naming
  every occurrence line; `UNSET` removes EVERY occurrence in one descending-span
  pass (leaving one behind would keep the key effective in the file while the
  settings layer reports it unset). Refusal is reserved for unprovable spans,
  duplicated intermediates (`ambiguous-intermediate`), unparsable documents and
  read-only targets. The user-facing statement of this rule is `docs/tui.md` §6.5.

The LEGACY bridge's evidence: `evidence/mpd-bridge/implementation/20260915T080138Z/` (two real boots,
one live root and two live roots), lane `skills/dsh-qa/scripts/tui-settings-bridge.ts`,
re-review `evidence/mpd-bridge/review/REREVIEW-t49.md`, ruling
`evidence/mpd-bridge/captain/RULING-duplicate-unset-FINAL.md`.

Boundary: the bundle patch stays the composition truth; this layer only feeds
plugin runtime config — plus the LEGACY write-back projection above, which the pinned host never runs —
and never mutates dsh patch rows.
