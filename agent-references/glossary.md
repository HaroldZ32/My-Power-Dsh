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

**LIVE AMENDMENT (2026-10-13, team-model slot):** the verbatim block below still reproduces the
2026-10-06 text, and its effort rule gained ONE adaptation afterwards — a slot whose model declares NO
reasoning efforts at all in the live catalog is sent none (the adapter's `withSupportedEffort` drops
the keyword and logs it), so a materialised slot default cannot fail a call no configuration error
caused. `AGENTS.md` §13 carries the binding wording; the block below is history.

**LIVE AMENDMENT (2026-10-20, workmate injection):** the automatic persona/memory injection into a
teammate lived in the vendored `dsh-agent-teams` body, which no loader row has mounted since its
2026-09-27 retirement and which the de-vendor wave removed — so that capability is NOT active.
Re-establishing it belongs to the OFFICIAL team path, `mpd-roster-provider-plugin`, which already routes
a teammate whose description names a roster member. The block below predates this note and is history.

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
  (chain key, `personas/<id>.md`, workmate `meta.baseId`) is INTERNAL: **refused as tool INPUT** (the
  tools accept a NAME spelling only; the internal `mpdRoles.get` service path still resolves the id for
  chain lookup and legacy callers), and exposed by NO tool output, description, render, web route or GUI. The **read-only discipline is the exported deny list** —
  exactly eight names, identical in `mpd-roles-plugin` and `mpd-workmate-plugin` (asserted equal by
  `roles.test.ts`): `write`, `edit`, `mpd_hashline_edit`, `bash`, `mcp__ast_grep__rewrite`,
  `mcp__ast_grep__scan`, `mcp__lsp__rename_symbol`, `mcp__lsp__rename_symbol_strict` (cclsp's own two
  rename tools, which replaced the single `mcp__lsp__rename` in de-omo wave B2). `bash` is denied on
  purpose (a shell can write files); `read`/`glob`/`grep` stay available. Enforced TWO ways that must
  keep agreeing: the `mpd_role_spawn` path passes it as `toolFilter.deny`, and a tool GUARD
  denies the same eight names for a
  live Team teammate whose name normalises to a read-only roster member — the official `spawn_teammate`
  accepts no per-teammate tool filter. **Do NOT re-add
  `str_replace_editor` or `apply_patch`**: both
  were REMOVED because they are not registered in this profile — the harness validates the WHOLE list
  at spawn time and rejects the child when any single name is unknown, so one dead entry breaks every
  read-only spawn (an installed `dsh-tool-str-replace-editor` package or a `dsh-base` patch row is NOT
  proof of runtime registration, and `dsh --dump-config` composes rows without mounting them). Do not
  filter the list with `dsh.hasTool` either: it reads the global tool view, where `write`/`edit`/`bash`
  answer false, so filtering would silently DROP the entries that are the guarantee.
  **Since 2026-10-10 the harness's own validation is TOLERATED, not fatal (the F2 repair):** the list stays
  canonical and is still never pre-filtered, but a spawn applies it through the adapter's
  `restrictToolsTolerant` (`packages/mpd-dsh-adapter-plugin/src/index.ts`), which lets `tools.restrict()`
  prune the names it reports as unknown (`names unknown global tools "…"`), retries EXACTLY ONCE with the
  survivors and rethrows any second failure. Measured 2026-10-10 before the repair: the two
  `mcp__lsp__*` entries made the harness reject the WHOLE list on a profile without `cclsp`, so every
  read-only `mpd_role_spawn` died and the captain fell back to the official `subagent` tool — which was
  the escape the since-WITHDRAWN delegation gate refused (below). The `mpd_role_spawn` path hands the CHILD the
  PRUNED list as `toolFilter.deny`; a pruned name is reported once on the row's log.
- delegation gate (RESTORED 2026-10-20 — a live capability again): the `tools.guard` rule that makes
  §5 rule 2's delegation discipline MECHANICAL, and the sibling of the captain-investigation guard
  below. `packages/mpd-roles-plugin/src/delegation-gate.ts` refuses a call to `subagent`, `subagent_fork`
  or `workflow` and names the sanctioned routes (`mpd_role_spawn`, `mpd_workmate_match` +
  `mpd_workmate_spawn`, Agent Teams, `send_message`); its knob is `delegation.gate` in `mpd.jsonc`
  (`"deny"` default | `"captain"` | `"allow"`), keyed on the preset-free `sessionRank`. **Its preset
  exemption is TOP-LEVEL ONLY**: a top-level session of another preset (the deployment default `cordis`
  included) keeps its own spawn habits, while MEMBER AND CHILD sessions stay covered WHATEVER preset they
  run — the install-time bypass releases only a rank-`captain` session that is not the `mpd` captain. The
  MODE picks coverage inside that scope: `deny` (the default) covers the `mpd` captain and every
  member/child/headerless session, `captain` the top-level session only, `allow` none. The user's
  2026-10-17 ruling withdrew it together with the persona restoration; the **2026-10-20 ruling split that
  bundle** (`.mpd/plans/restore-guard-discipline.md`): the long prompt stays, the guard comes back,
  because the measured consequence of its absence was a captain that did every search itself while the
  roster/team tools went unused. The row installs it again and its boot line reports the MODE
  (`delegationGate=deny`), never an `absent` claim.
- captain investigation guard (RESTORED 2026-10-20 — a live capability again): the `tools.guard` rule
  that makes the `mpd` preset's TOP-LEVEL session delegate reconnaissance. `read`, `grep` and `glob` are
  refused on a SOURCE path; the DOCUMENTATION BAND stays readable (`.mpd/**`, `docs/**`, `evidence/**`,
  `agent-references/**`, and the root `AGENT.md`/`AGENTS.md`/`CLAUDE.md`/`README*.md`/`CHANGELOG.md`/
  `LICENSE*.md`), because integrating a report needs the contract and the records, not the sources. The
  knob is `captain.investigation` in `mpd.jsonc` (`"deny"` default | `"allow"`), read per call, and the
  rule is scoped by `sessionIsMpdCaptain` (top-level AND the `mpd` preset — another preset keeps its own
  reconnaissance). It was withdrawn by the 2026-10-17 ruling and restored by the 2026-10-20 split, for
  the same measured reason as the delegation gate. Honest bound, unchanged: the guard reads a TOOL CALL's
  arguments, so a source path reached through the shell (`cat`, `rg`) is not blocked — the persona
  forbids that route by INTENT, and the guard's own doc comment says so.
- team-model slot: one of the four configured model routes of the ROSTER members —
  `teamModels.slot{1,2,3,4}.{provider,model,reasoningEffort?}` plus an optional `fallbacks:
  [{provider,model,reasoningEffort?}, …]` chain of the slot's OWN, in `mpd.jsonc` / the `mpd` settings
  namespace. Since the slot-single-source contract (`.mpd/plans/slot-single-source.md`) there is ONE
  configured route per slot and **no built-in default layer**: `TEAM_MODEL_SLOT_DEFAULTS` and
  `withTeamModelsDefaults` are deleted, the schema carries no `.default()` in the slot subtree, and the
  per-member override table `agentRoutes` is deleted (a leftover block in an old file is IGNORED and
  never rewritten). Slot 1 routes Architect/Planner/Reviewer/Lead/Senior Engineer, slot 2
  Researcher/Explorer/Plan Reviewer, slot 3 Deep Worker/Junior Engineer, slot 4 Vision Analyst (the
  vision member; the model here MUST accept image input). A slot that is not configured (or whose leaf
  is malformed) REFUSES the spawn with ONE structured `SLOT_UNCONFIGURED` error naming the slot, its
  members, the missing leaves and both recovery paths (`/mpd-model`, `teamModels.slotN` in
  `.mpd/mpd.jsonc`), and stating that nothing was written and no child was started; an effort is NEVER
  clamped, and a model whose catalog entry declares NO reasoning efforts at all is sent none so the run
  still proceeds. The read is TOTAL: `mpdConfig.slotResolutionOf(member)` returns a typed union
  (`ok` / `unconfigured` / `invalid` / `unrouted`) and never throws, so a display (`/mpd-model`, the Web
  card, `mpd_modelchain_resolve`, `mpd_roles_list`) renders `<unconfigured>` instead of crashing; only
  the three spawn appliers turn `ok:false` into the thrown failure. The slot's `fallbacks` chain is
  consumed ONCE before the spawn — the first route the live catalog POSITIVELY lists wins ("not listed"
  is not "unavailable"), the winner passes the effort adaptation, a malformed entry is dropped with one
  log line — and it is never retried after the run starts. INITIAL CONFIG IS FILE INITIALIZATION: a
  workspace whose file declares no `teamModels` is seeded once at mount from the configured providers
  via the LLM catalog (the `deepseek-flash` family; slot1 `max`, slots 2-4 `high`), never rewriting an
  existing block or user edit, and writing nothing when the catalog is unavailable. ONE-TIME IS
  DURABLE: a successful seed records `<ws>/.mpd/model-config-seed.json` (created with `wx`, never
  overwritten, and consulted BEFORE any attempt), so a block the user deletes on purpose is never
  re-seeded — the seed can only ever run once per workspace. **Team teammates ARE
  routed, through a provider of this bundle's own (2026-09-27).** The slot applies to the mpd
  single-call consult paths (`mpd_role_spawn`, `mpd_workmate_spawn`), which pass an explicit
  `agentOptions`, AND to an official `spawn_teammate` teammate: the harness — unlike its own TeamService
  — is not the limitation. `TeamService` forwards only `{ prompt, parent }`, but the durable-child start
  (`startContinuable` on 0.1.7-rc.2, `startActivation(spec)` on 0.2.1+) resolves `request.agentOptions`
  into provider/model/reasoningEffort and hands them to the PROVIDER, which constructs the run; the
  provider name is ROW CONFIG (`config.freshProvider`), not a tool argument. So
  `mpd-roster-provider-plugin` registers the `mpd-roster` provider — it delegates to the composition's
  own provider and applies the member's slot route — and the bundle points its `mpd-tool-agent-team`
  row's `freshProvider` at it. IDENTITY is the one thing the team service does not forward, so the
  routing rule is: **a teammate `description` that NAMES a roster member routes that member; any other
  teammate runs on the route of the session that staged it (the captain's in a top-level spawn, the
  Lead's in a team-lead spawn), and prompt text cannot change a route.** See
  `packages/mpd-roster-provider-plugin/README.md`.
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

## verifier's envelope (long form)

The tool and path boundary a BOUND VERIFIER SEAT was meant to work inside under the verification law
(AGENTS.md §5, §13).

**STATUS: the ENVELOPE is PROSE since 2026-10-17; the RECORD VALIDATOR is what still bites.** The envelope
was enforced by ONE `guardTool` install in the `mpd-roles` row
(`packages/mpd-roles-plugin/src/verify-guard.ts`), decided by the pure functions in
`packages/mpd-verify-plugin/src/law.ts` and reading its state from the `mpdVerify` service. The user's
rolling-back ruling withdrew that install (`.mpd/plans/harness-021-rollback.md`, R1) together with the
captain's write rule it also carried, so nothing refuses a seat's shell call, its source read or its board
mutation any more; `mpd_verify_seat` still records the seat, and the list below is the CONTRACT a verifier
keeps, not a fence around it. What remains mechanical is the record validator's own refusals (no cited
documents, no gate evidence, a forged evidence id, a same-agent verifier, a FAIL without findings), which
live in the TOOLS.

A seat is bound with `mpd_verify_seat {loop_id, role:"verifier"}`, which is idempotent and authoritative,
and which REFUSES a caller that is the loop's own writer. The boundary it is meant to keep:

- **NOT CALLED at all**: the shell (`bash`, `powershell`, `pwsh`); the source-returning tools
  (`mcp__codegraph__codegraph_explore`, cclsp's query family — `find_definition`, `find_references`,
  `find_implementation`, `get_diagnostics`, `get_hover`, `find_workspace_symbols`,
  `prepare_call_hierarchy`, `get_incoming_calls`, `get_outgoing_calls` — `mcp__ast_grep__rewrite`,
  `mcp__ast_grep__scan`, and cclsp's two renames `mcp__lsp__rename_symbol` /
  `mcp__lsp__rename_symbol_strict`); and every `agent_teams_*` / `mpd_*` board or team MUTATION —
  with `mpd_verify_*` explicitly exempt, because those five tools ARE the seat's job.
- **PATH-SCOPED while BLIND**: `read` / `glob` / `grep` under the loop's frozen `basis.docs[]`,
  `<ws>/.mpd/plans/**`, `<ws>/docs/**`, `<ws>/agent-references/**`, `<ws>/packages/*/README*.md`,
  `<ws>/.mpd/verify/**` and `<ws>/evidence/**`. MEASURED 2026-10-08: while the guard still installed, its bare-path refusal named
  `evidence/` in the live band, and a `glob {path:"evidence", pattern:"…"}` was ANSWERED (it reports no
  matches, not a refusal). An earlier revision of this line OMITTED `evidence/**`, and a bound seat
  concluded from the omission that it could not read a writer's evidence packet at all — it retracted
  after re-measuring, but the wrong conclusion had already been broadcast to writers and into a wave
  contract. Do not re-narrow this list without re-measuring whatever enforces it next.
- **WRITE confined** to `<ws>/.mpd/verify/**`. A verifier never fixes what it found: the record tool writes
  the verification record itself, and a FAIL bounces the work back to a writer as a `kind=repair` task.
- **THE RATCHET**: a recorded FAIL was meant to unlock implementation reading for DIAGNOSIS, COUNTED, with
  the count in the next record's `unlockedReads[]`. Nothing counts now: the observation log that fed it
  (`law.noteCall` / `law.countRead`, called from the withdrawn guard) is no longer written, so the ratchet
  stays EMPTY in practice.

**The blindness claim, honestly stated.** While the guard installed, blindness was PROVEN by the plugin's
own observation log — `guardTool` is consulted before every dispatch, so a seat whose session never
triggered a code-path read was `blind`, and a PASS on an `unproven` basis was refused (`bind-unproven`).
With the hook withdrawn nothing observes those reads, so every seat now READS as `blind`
(`observedCodeRead` is false because no read is recorded) and the `unproven` refusal cannot be triggered
by evidence. That is a real weakening, not a bound to shout down: the record validator's other refusals
and the boot marker still hold, and blindness should be treated as UNVERIFIED rather than established
until an observation channel that is not a pre-dispatch hook exists. Do not re-introduce such a hook
without a user ruling.

