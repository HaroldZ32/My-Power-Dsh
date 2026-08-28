# mpd-roles-plugin

The OMO-origin agents (oracle / librarian / prometheus / explore / metis / momus /
atlas / hephaestus / sisyphus / sisyphus-junior / multimodal-looker) exist as a
**subagent roster**, not as standalone presets. Each role = persona text (asset
`personas/<id>.md`, generated from the pre-migration preset personas by
`scripts/gen-roles.mjs`) + DeepSeek model chain + read-only discipline.

## Surface

- `mpdRoles` service (`ctx.get("mpdRoles")`): `list()` / `get(key)` — consumed by
  `mpd-modelchain-plugin` (chain lookup) and `mpd-team-plugin` (member roles).
- `mpd_roles_list` — the roster.
- `mpd_role_spawn` — spawn one role as a subagent (roster persona + route +
  write-deny toolFilter for read-only roles).
- `mpd_role_persona` — fetch the persona text for spawn surfaces that take
  persona as text (e.g. `agent_teams_add_member persona=...`).

Role keys accept the canonical id (`oracle`, `sisyphus-junior`), the
modelchain-style key (`sisyphusJunior`, `multimodalLooker`) and the legacy
`mpd-<id>` preset alias.

Read-only roles: oracle, librarian, prometheus, momus, explore,
multimodal-looker (write/edit/str_replace_editor/apply_patch/mpd_hashline_edit
denied at spawn). Workers: sisyphus, sisyphus-junior, atlas, metis, hephaestus.