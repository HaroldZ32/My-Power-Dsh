# mpd-config-plugin

**English** | [中文](./README.zh-CN.md)

Plan C / C7 — minimal `mpd.jsonc` runtime config layer.

Layers (deep-merged, project wins): project `<workspace>/.mpd/mpd.jsonc` and user
`$DSH_HOME/mpd.jsonc` (fallback `~/.dsh/mpd.jsonc`). JSONC (comments + trailing
commas) with prototype-pollution-safe merge.

## Known keys

- `memory.vcs`: `git | svn | both` (Plan C / C6 memory engine).
- `teamModels.slot{1,2,3,4}.{provider,model,reasoningEffort?}`: the four team-model
  slots — the ONE configured route of each member class, with an optional per-slot
  `fallbacks` chain (see below). No default layer: an unset slot refuses its spawns.
- `team.stateDir`, `hashline.enabled/guardEditTools`,
  `commentChecker.autoCheck/bin`, `modelchain.<role>`, `boulder.dir`,
  `ulw.maxRounds`.

## Team-model slots (`teamModels`)

**The ONE configured model route of every roster member**, one slot per member class.
Four slots, twelve leaves plus each slot's own optional fallback chain:

| Slot | Path | Member class |
|---|---|---|
| 1 | `teamModels.slot1.{provider,model,reasoningEffort?}` | Architect, Planner, Reviewer, Lead, Senior Engineer |
| 2 | `teamModels.slot2.{provider,model,reasoningEffort?}` | Researcher, Explorer, Plan Reviewer |
| 3 | `teamModels.slot3.{provider,model,reasoningEffort?}` | Deep Worker, Junior Engineer |
| 4 | `teamModels.slot4.{provider,model,reasoningEffort?}` | Vision Analyst (the model here MUST accept image input) |

- **No default layer.** There is zero `.default()` in the slot subtree, and
  `TEAM_MODEL_SLOT_DEFAULTS` / `withTeamModelsDefaults` are DELETED: a workspace that
  configured nothing has no route, and an absent `teamModels` block reads as ABSENT
  (`get("teamModels")` is `undefined`, `mpd_config_get` does not invent one).
- **No override item.** `agentRoutes` is deleted from the schema, the knobs, the
  resolver, the TUI dialog and the Web card. A leftover `agentRoutes` block in an old
  `.mpd/mpd.jsonc` is IGNORED and never rewritten — saving an unrelated leaf leaves it
  byte-identical.
- **A slot may carry its OWN fallback chain:** `fallbacks: [{provider, model,
  reasoningEffort?}, …]`, in precedence order. It is consumed ONCE before the spawn:
  the first candidate the live catalog POSITIVELY lists wins ("not listed" is not
  "unavailable"; with no positive listing the primary stands), the winner then passes
  the effort adaptation, and a malformed entry is dropped with one log line, never
  fatally.
- **The read is TOTAL.** `mpdConfig.slotResolutionOf(member)` returns a typed union —
  `ok` (route + fallbacks), `unconfigured` (missing leaves named), `invalid` (the
  offending path named) or `unrouted` (no slot carries that member) — and NEVER throws,
  so a display surface renders `<unconfigured>` instead of crashing.
  `teamModelRouteOf(member)` stays total too: the route when `ok`, `undefined`
  otherwise.
- **An unusable slot REFUSES the spawn** with ONE structured `SLOT_UNCONFIGURED` error
  naming the slot, its members, the missing leaves and both recovery paths
  (`/mpd-model`, and `teamModels.slotN` in `.mpd/mpd.jsonc`), stating that nothing was
  written and no child was started. Only the three spawn appliers (`mpd_role_spawn`,
  `mpd_workmate_spawn`, the `mpd-roster` teammate provider) throw it; an effort is
  never clamped. ONE EXCEPTION is the model-capability adaptation: a model whose
  catalog entry declares **no** reasoning efforts at all is sent none for that call, so
  it still runs (the adapter's `withSupportedEffort`).
- **Initial config is FILE initialization, not a runtime default.** A workspace whose
  `.mpd/mpd.jsonc` declares no `teamModels` is seeded ONCE at mount, from the
  configured providers via the LLM catalog: model = the `deepseek-flash` family (an
  exact `deepseek-flash`, else a close `*flash*` id), provider = a configured provider
  that lists it, effort `slot1=max` and `slots 2-4=high`. One log line when it writes;
  an existing block or user edit is never rewritten; the successful seed is durably
  marked in `<ws>/.mpd/model-config-seed.json` (created with `wx`, never overwritten,
  consulted before ANY attempt) so a block you delete on purpose is never re-seeded;
  with no usable catalog nothing is written and the first spawn reports
  `SLOT_UNCONFIGURED`. The seed also stands down when a layer ABOVE the project file already
  configures the slots (the user file, the settings document, the row knobs): the project
  file must never shadow them.
- **Front doors:** the twelve leaves are `select` knobs of the ONE 26-row declaration
  (`SETTINGS_KNOBS`: the original 13 knobs, these 12, and the TUI surface's own knob)
  in the TUI `/settings` section and in the Web GUI card, whose effective block shows
  each slot's state (or `<unconfigured>` with the leaves it lacks). Their option lists
  come from the live model catalog (the adapter's `llmCatalog()` server-side, the
  host's client catalog on the Web), falling back to `TEAM_MODEL_FALLBACK_OPTIONS`
  when that catalog is unavailable or degraded — so a slot is always a selection, never
  free text.
- **Restart semantics:** the model routes are read PER USE, so a save (or a watched
  file edit) reaches the next spawn/resolve with no restart; `mpd_config_reload` forces
  a re-read.

## Service / tools

- Provides the `mpdConfig` service for other mpd plugins (`inject: ["mpdConfig"]`):
  `get(key?)`, `reload()`, `states()`, `teamModelRouteOf(member)`.
- `teamModelRouteOf(member)` is the read that makes a **saved** `teamModels` slot take
  effect: it resolves the member's slot (membership comes from the one declaration both
  settings front doors already share), resolves it over the materialised defaults, and
  returns `{ provider, model, reasoningEffort? }` — `undefined` for a member the roster
  does not slot-route, and a thrown error naming the member and the slot when a
  slot-routed member's slot carries no provider or no model. The roster's one-shot paths
  (`mpd_role_spawn`, `mpd_roles_list`, the workmate library and `mpd_modelchain_resolve`)
  read it through this service, so a saved slot reaches them without a second
  cross-package import.
- `mpd_config_get` / `mpd_config_reload` tools.

## The `/settings` bridge (write-back)

This package owns the **write-back** half of the harness settings bridge: the
TUI `/settings` section and the Web GUI card edit the `mpd` settings namespace,
and a saved edit is projected into the workspace's `<workspace>/.mpd/mpd.jsonc`.

- **The namespace base (this package owns it):** `baseForNamespace()`
  derives the base under a cardinality rule — one live root ⇒
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
  read-only targets. The user-facing statement of this rule is `docs/tui.md` §6.5.

Evidence: `evidence/mpd-bridge/implementation/20260915T080138Z/` (two real boots,
one live root and two live roots), lane `skills/dsh-qa/scripts/tui-settings-bridge.ts`,
re-review `evidence/mpd-bridge/review/REREVIEW-t49.md`, ruling
`evidence/mpd-bridge/captain/RULING-duplicate-unset-FINAL.md`.

Boundary: the bundle patch stays the composition truth; this layer only feeds
plugin runtime config — plus the write-back projection above — and never mutates
dsh patch rows.
