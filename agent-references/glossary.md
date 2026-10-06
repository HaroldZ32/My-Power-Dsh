# Glossary (the full former §13 body)

Agent-facing reference (English-only by the bundle's language policy; `bun run verify:docs` does not
discover this tree). **On demand — never auto-injected**: this file is deliberately not named
`AGENT.md`/`AGENTS.md`/`CLAUDE.md`, so the workspace instruction loader never reads it. `§N` citations
below refer to `AGENTS.md` sections, whose numbering is stable.

Provenance: moved from `AGENTS.md` §13 ("Glossary") on 2026-10-06 by the instruction-budget split (the
manual must stay under the harness's 65,536-byte workspace-instruction budget, and it was already
over at the previous HEAD). The block below is reproduced VERBATIM — its byte count and sha256 are
recorded in `evidence/gates/agents-budget/20261006T085805Z/result.json`. `AGENTS.md` §13 carries the BINDING rules and points
here for the full body; where the two differ, the manual wins.

## The former §13 body (verbatim)

## 13. Glossary

- DSH: DeepSeek Harness (host; cordis plugin architecture, web/headless profiles).
- bundle: npm package with `dsh.bundle.patch` patch layer (here: `mpd-bundle`).
- patch layer: id-targeted override or `insert:` list applied in order.
- preset: a named agent-plane composition declared as an ordinary plugin ROW. Harness 0.1.7-rc.2
  REPLACED the directory form (`preset.yml` + `agent.cordis.yml` served by
  `@deepseek-ai/dsh-agent-presets`, a package that no longer exists): the deployment default lives on
  `@deepseek-ai/dsh-agent-preset-registry` (`config.default`) and each preset is one
  `@deepseek-ai/dsh-agent-preset` row whose `config.plugins` carries the child entry list inline. This
  bundle declares `mpd` that way in `presets/mpd.patch.yml`, listed as the second entry of the
  manifest's `dsh.bundle.patch` array.
- roster: the specialist roster served by `mpd-roles-plugin` (`mpd_roles_list` / `mpd_role_spawn` /
  `mpd_role_persona`) as teammate instantiation templates for the OFFICIAL Agent Teams plugin
  (`spawn_teammate`, whose persona the captain takes from `mpd_role_persona`). The eleven members are
  addressed by NAME and described by what they do — Architect, Researcher, Planner, Deep Worker, Senior
  Engineer, Lead, Explorer, Reviewer, Plan Reviewer, Vision Analyst, Junior Engineer. The stable `id`
  (chain key, `personas/<id>.md`, workmate `meta.baseId`) is INTERNAL: accepted for compatibility,
  exposed by NO tool output, description, render, web route or GUI. The **read-only discipline is the exported deny list** —
  exactly seven names, identical in `mpd-roles-plugin` and `mpd-workmate-plugin` (asserted equal by
  `roles.test.ts`): `write`, `edit`, `mpd_hashline_edit`, `bash`, `mcp__ast_grep__rewrite`,
  `mcp__ast_grep__scan`, `mcp__lsp__rename`. `bash` is denied on purpose (a shell can write files);
  `read`/`glob`/`grep` stay available. Enforced TWO ways that must keep agreeing: the one-shot path
  passes it as `toolFilter.deny` to `mpd_role_spawn`, and a tool GUARD denies the same seven names for a
  live Team teammate whose name normalises to a read-only roster member — the official `spawn_teammate`
  accepts no per-teammate tool filter. **Do NOT re-add
  `str_replace_editor` or `apply_patch`**: both
  were REMOVED because they are not registered in this profile — the harness validates the WHOLE list
  at spawn time and rejects the child when any single name is unknown, so one dead entry breaks every
  read-only spawn (an installed `dsh-tool-str-replace-editor` package or a `dsh-base` patch row is NOT
  proof of runtime registration, and `dsh --dump-config` composes rows without mounting them). Do not
  filter the list with `dsh.hasTool` either: it reads the global tool view, where `write`/`edit`/`bash`
  answer false, so filtering would silently DROP the entries that are the guarantee.
- team-model slot: one of the four configurable default model routes of the ROSTER members —
  `teamModels.slot{1,2,3,4}.{provider,model,reasoningEffort}` in `mpd.jsonc` / the `mpd` settings
  namespace, whose defaults are `deepseek-official` / `deepseek-v4-flash` at `max`/`high`/`high`, plus
  `deepseek-official` / `deepseek-v4-flash-vision-exp` at `high` for slot 4. Slot 1 routes
  Architect/Planner/Reviewer/Lead/Senior Engineer, slot 2 Researcher/Explorer/Plan Reviewer, slot 3 Deep
  Worker/Junior Engineer, slot 4 Vision Analyst (the vision member; the model here MUST accept image
  input). A slot that cannot be resolved — a
  missing service, a missing or incomplete slot, an unknown model, an unsupported effort — fails the
  corresponding spawn LOUDLY naming the member and the slot, writes no state, and NEVER clamps an
  effort. **Team teammates ARE routed, through a provider of this bundle's own (2026-09-27).** The slot
  applies to the mpd ONE-SHOT consult paths (`mpd_role_spawn`, `mpd_workmate_spawn`), which pass an
  explicit `agentOptions`, AND to an official `spawn_teammate` teammate: the harness — unlike its own
  TeamService — is not the limitation. `TeamService` forwards only `{ prompt, parent }`, but
  `SubagentContinuationManager.startContinuable` resolves `request.agentOptions` into
  provider/model/reasoningEffort and hands them to the PROVIDER, which is what constructs the run;
  the provider name is ROW CONFIG (`config.freshProvider`), not a tool argument. So
  `mpd-roster-provider-plugin` registers the `mpd-roster` provider — it delegates to the
  composition's own provider and applies the member's slot route — and the bundle points its
  `mpd-tool-agent-team` row's `freshProvider` at it. IDENTITY is the one thing the team service does
  not forward, so the routing rule is: **a teammate `description` that NAMES a roster member routes
  that member; one that does not inherits the Lead's route.** An incomplete slot fails the spawn
  loudly, naming the member and the slot. See `packages/mpd-roster-provider-plugin/README.md`.
- workmate: a durable, evolving agent instance in `~/.mpd/workmate/` created by `mpd-workmate-plugin`
  (`mpd_workmate_*`) from a roster BASE template with an independent name; it self-summarizes after each
  work (persona + independent memory, size-capped) and keeps a short note card. Reuse is via
  `mpd_workmate_match`; weak matches must NOT be forced — initialize a new workmate instead. The tool
  surface is `mpd_workmate_list` / `mpd_workmate_init` / `mpd_workmate_spawn` / `mpd_workmate_reflect` /
  `mpd_workmate_match` / `mpd_workmate_rename` / `mpd_workmate_delete`. **The directory name IS the instance
  key** (`meta.name` is only a display mirror), so a rename is a directory move and an interrupted one is
  harmless. `delete` is archive-first (`~/.mpd/workmate/.archive/<key>-<stamp>/`, no in-product restore
  — recover by hand with `mv`), permanent only with `purge: true` + `confirm === name`; both mutations
  are refused while the workmate is in use, and names are ASCII-only `[a-z0-9_-]`. A base is addressed by its functional NAME only (a
  roster id is refused with a names-only error), an auto-generated name derives from that functional
  name (`Deep Worker` → `deep-worker-1`), and `baseId` is internal provenance in `meta.json` that no
  tool output, web route or GUI ever exposes.
- mpd: our naming prefix (my-power-dsh).
- golden: graded benchmark task set in `tests/golden`.
