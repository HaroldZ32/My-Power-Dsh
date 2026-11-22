# mpd-config-plugin

**English** | [中文](./README.zh-CN.md)

A minimal `mpd.jsonc` runtime config layer, read by the bundle's other rows.

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
  `autoproject.maxRounds`.
- `team.reteam.enabled` (default `true`) controls completed-consult staging and concurrent consult
  admission. Team settlement and clean-terminal auto-end are independent of this switch.
- `team.reteam.afterConsults` (default `4`) is the completed-call threshold for staging a new empty
  plan shell under `[AgentTeams] Re-team rule`. Successful `mpd_role_spawn`, `mpd_role_spawn_async`
  and `mpd_workmate_spawn` calls by the agent count since the last fire. The count persists in
  `<ws>/.mpd/session-gate/<sessionId>.json`. In mechanical mode, this setting also bounds overlapping
  calls to those tools by an eligible top-level captain without a live team. At the default, MPD
  redirects the fourth outstanding call before it can start another child.

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

- Other MPD plugins can call `get(key?, workspace?)`, `states(workspace?)`,
  `agentRouteResolutionOf(member, workspace?)`, and `agentRouteOf(member, workspace?)` on `mpdConfig`.
  Pass the absolute workspace root when the caller has a session. Each root has its own live snapshot.
  Calls without a workspace use the sole live root when there is one and otherwise use the adapter's
  process-level default. That default is independent of the most recent call or reload.
- `agentRouteResolutionOf` returns `ok`, `unconfigured`, `invalid`, or `unrouted`. `agentRouteOf`
  returns `{ provider, model, reasoningEffort?, fallbacks? }` for a usable route. Direct consults,
  workmates, and the model-chain tool use the calling session's workspace. Team members use the staging
  session's workspace even when the member runs in a separate worktree.
- `mpd_config_get` and `mpd_config_reload` reread the calling session's own project layers. The
  `reload(exec?)` service has the same behavior.

## The `/settings` bridge

The Web settings card reads and saves model route fields for the selected live session. The route
updates `<workspace>/.mpd/mpd.jsonc` while preserving unrelated JSONC content. Clearing a field removes
its project value so the remaining layers can supply it. Profile-wide overrides still take precedence.
If a profile-wide value blocks an edit, the card reports which field is overridden. A `projectFile` row
override shares a file across workspaces and is edited separately. A request that names an unknown session,
or an unscoped read on a host with multiple live roots, receives a visible error.

The TUI `/settings` section and the Web card's other fields use the host's `mpd-config` entry
document. A save there refreshes the settings layer for every workspace. On older hosts that serve the
legacy `mpd` namespace, the bridge can also write its values back when exactly one workspace is live.
The pinned host has retired that namespace. Manual project file edits refresh the corresponding
snapshot after the 150 ms watcher debounce.

**The READ-BACK is live; the EFFECT is per knob.** `mpd_config_get` / `mpd_config_reload` re-read the
layers on every call and report the new value at once, but a consumer that captured its configuration
at `apply()` still acts on the old one. Two groups plus one special case, and this section states them
all — never only the promising half (`docs/user-guide.md` §9.1 is the per-knob table):

- **live in the running process** — the model routes (`agentRoutes.*`, `modelchain.*`),
  `team.gate` / `team.sensitivity`, the `team.stateDir` reader, and the two guards
  `captain.investigation` / `delegation.gate` (each reads the row's own `configValue` per decision);
- **captured at `apply()`, so they need the next `dsh` boot** — `hashline.*`, `commentChecker.*`,
  `autoproject.*`, `memory.*`, `boulder.dir`, `goal.*`;
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
  because the host exposes no disposal handle for a live registration. Session-scoped consumers read
  their own workspace's resolved snapshot.
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
