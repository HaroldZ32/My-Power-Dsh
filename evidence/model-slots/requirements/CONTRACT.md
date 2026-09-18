# FROZEN ACCEPTANCE CONTRACT — three team-model slots + workmate alias removal

Task: `t1` (requirements r1), attempt 1. Author: Planner (read-only).
Contract revision: 1. Frozen against plan revision of record:
`.mpd/plans/model-slots-and-workmate-aliases.md` (150 lines, read at 2026-09-18).
Artifact: `evidence/model-slots/requirements/CONTRACT.md`.

Authority: this is the ONE acceptance source for every implementation lane and both verification
lanes of the wave `model-slots-amp-workmate-aliases`. Where a lane contract is silent or differs,
this file wins (t3 and t6 already say so in their own text). It freezes BEHAVIOUR and CHECKABILITY,
not implementation shape: a lane may choose any code layout that satisfies the items.

Cite code by SYMBOL, never by line number (AGENTS.md T-55).

---

## 0. Frozen inputs, non-goals, wave invariants

Read for this contract: the plan of record section 1–3 (user's words, requirements-conference
decisions Q1–Q3, design contracts 3.1–3.5); `packages/mpd-config-plugin/src/settings-schema.ts`
(`SettingsSchema`, `SETTINGS_KNOBS`, `SettingsKnob`, `BRIDGE_DISCLOSURE`);
`packages/mpd-config-plugin/src/index.ts` (`loadConfig`, the `mpdConfig` service `get`,
`SETTINGS_NS` registration); `packages/mpd-tui-plugin/src/settings.ts` (`SETTINGS_FIELDS`,
`SETTINGS_SECTION`, `registerSettingsSection`); `packages/mpd-bundle-plugin/src/settings-card.js`
(`FIELDS`, `createMpdCardController`, `mountSettingsCard`);
`packages/mpd-bundle-plugin/src/web-client.js` (workmate tab);
`packages/mpd-workmate-plugin/src/index.ts` (`resolveBase`, `initWorkmate`, `workmateLibrary`, the
five web routes); `packages/mpd-agent-teams-plugin/lib/members.js`
(`resolveMemberLlmSelection`, `isFallbackFailureCode`, `memberPersona`);
`packages/mpd-bundle/cordis.patch.yml` (the eleven `mpd` profile members).

**Non-goals (binding, from plan §6 and task contracts):** the host `agent-default-model` namespace;
session defaults; any change to the mpd-roles roster stable ids (they remain internal chain keys);
migrating existing `~/.mpd/workmate` instances on disk; a new plugin package, a new web route or a
new long-lived service for the catalog; any git write by a member (the captain is the single git
writer); packing a release (`scripts/pack-mpd.mjs`).

**Wave invariants (each one is a verifiable item below):**
- INV-1 No lane edits `skills/**`, so NO `VENDOR_LOCK.json` re-pin exists in this wave. Any
  `verify:vendor` failure caused by a `skills/**` change is out-of-contract and must be reported,
  never repaired by a lane.
- INV-2 No lane runs a git write command; every lane's result states that explicitly.
- INV-3 `dist/mpd-package/**` is GITIGNORED and untracked (verified: `git ls-files dist/mpd-package`
  = 0 entries, `.gitignore` line `dist/mpd-package/`). It is a release artifact produced only by
  `scripts/pack-mpd.mjs` (a non-goal) and therefore needs no lane and no `inScope` declaration this
  wave. A stale staged pack is NOT a defect of this wave; do not run
  `node scripts/verify-pack-closure.mjs` as a wave gate.
- INV-4 Real-mounted proof beats composition proof: `node scripts/dump-config.mjs --profile mpd`
  proves COMPOSITION ONLY and never a plugin load (AGENTS.md §4). Any claim about a tool, a schema,
  a route or a rendered surface needs a mounting boot or a real call.

---

## 1. Frozen vocabulary (normative)

### 1.1 Settings shape and defaults

Namespace `mpd` (unchanged). New block:

```
teamModels.slot1 = { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "max"  }
teamModels.slot2 = { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" }
teamModels.slot3 = { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" }
```

- The dotted settings path is `mpd.teamModels.slot<N>.{provider|model|reasoningEffort}` for N in
  {1,2,3}; the `.mpd/mpd.jsonc` spelling is the same subtree without the `mpd` prefix
  (`teamModels.slot<N>.<leaf>`).
- `provider`, `model`, `reasoningEffort` are all STRINGS; none is optional in a resolved slot.
- Effort ids in this deployment are `off` / `low` / `high` / `max` (AGENTS.md-tracked deployment
  fact, also stated in `packages/mpd-bundle/cordis.patch.yml`'s member comment).
- Read API for consumers: `ctx.get("mpdConfig").get("teamModels.slot<N>")` — the EXISTING mpdConfig
  service, whose `get` already supports dot-paths. No new service, no new key outside `teamModels`.

### 1.2 Member → slot mapping (frozen)

| Slot | Members routed by that slot (by `tier`) |
|---|---|
| slot1 | Architect, Planner, Reviewer, Lead, Senior Engineer |
| slot2 | Researcher, Explorer, Plan Reviewer |
| slot3 | Deep Worker, Junior Engineer |
| explicit `route` (NOT a tier) | Vision Analyst → `deepseek-official` / `deepseek-v4-flash-vision-exp` / `high` |

The USER's class assignment (plan §2 Q1) names Vision Analyst in slot2's class. The APPROVED
design (plan §3.4) keeps that capability by giving Vision Analyst an explicit `route` instead of a
tier, because the slots' default model is not a vision model. Frozen consequences, both required:
- the observable route of Vision Analyst is `deepseek-official/deepseek-v4-flash-vision-exp` at
  effort `high` regardless of the slot values;
- changing slot2 must NOT change Vision Analyst's route, and a lane that wires Vision Analyst as
  `tier: 2` FAILS item B3.
The captain and 11 members are otherwise unchanged; the captain is not routed by a slot.

### 1.3 Surface vocabulary

- "the ONE declaration" = `SETTINGS_KNOBS` in `packages/mpd-config-plugin/src/settings-schema.ts`.
- "the TUI front door" = the registered `tuiSettingsSections` section built from `SETTINGS_FIELDS`
  in `packages/mpd-tui-plugin/src/settings.ts`.
- "the Web front door" = the `settings.section` (id `mpd`, order 20) registered by
  `packages/mpd-bundle-plugin/src/settings-card.js`, inlined into the built
  `packages/mpd-bundle-plugin/client.js` by `scripts/build-mpd-client.mjs`.
- "declared metadata" = for one knob: its `path` array, `label`, `zh`, `kind`, and its DECLARED
  fallback `options` list. Parity is required on declared metadata only (§A6); the LIVE option
  lists are deliberately different sources (server catalog vs client catalog) and are NOT a drift.

---

## 2. CLAUSE A — three selectable model slots in the MPD settings, both front doors

**A1 — schema shape and defaults.** `SettingsSchema` carries `teamModels` with `slot1`/`slot2`/`slot3`,
each an object of three required-ish strings, and the resolved defaults are exactly §1.1.
- Satisfied by: t3 (Senior Engineer). Verified by: t9.
- Check: `bun test packages/mpd-config-plugin` — a test asserting the three slots' literal defaults;
  AND the real resolved-config read in A2.

**A2 — the RESOLVED config carries the slots, with defaults, in a workspace whose
`.mpd/mpd.jsonc` has no `teamModels` block.** This is the load-bearing cross-lane item: the
member-route resolver reads `ctx.get("mpdConfig").get("teamModels.slot<N>")`, and the mpdConfig
service today returns only the RAW merged file config (schema defaults are normally applied by each
consumer). If the config layer does not materialise the three slot defaults on the READ path, every
fresh workspace fails team creation and the flagship default route is broken.
- Required semantics: (a) no `teamModels` anywhere → `get("teamModels")` returns the three complete
  defaults; (b) a file that sets only `teamModels.slot2.model` returns slot2 merged over ITS
  defaults, with slot1/slot3 untouched; (c) project `.mpd/mpd.jsonc` outranks user
  `$DSH_HOME/mpd.jsonc`; (d) materialisation is READ-path only — the settings-document write-back
  delta is computed from the settings document (`changedLeaves` over the described user section),
  never from the materialised defaults, so saving an unrelated knob must NOT inject a `teamModels`
  key into `<workspace>/.mpd/mpd.jsonc`.
- Satisfied by: t3. Verified by: t9.
- Check: `bun test packages/mpd-config-plugin`; AND a REAL `mpd_config_get` call (no key) in the t9
  evidence, in a sandbox workspace whose `.mpd/mpd.jsonc` has no `teamModels`; AND the negative
  control (d) through `node skills/dsh-qa/scripts/web-settings-bridge.mjs`.
- Observable artifact: `evidence/model-slots/settings-surfaces/<ts>/result.json` carrying the
  `mpd_config_get` payload verbatim.

**A3 — nine knobs in the ONE declaration.** `SETTINGS_KNOBS` gains EXACTLY nine entries, in this
order: `teamModels.slot1.provider`, `.model`, `.reasoningEffort`, then slot2, then slot3. Every one
has `kind: "select"` and a NON-EMPTY declared fallback `options` list; the declared lists are the
ones t3's own acceptance fixes (provider `[deepseek-official]`; model `[deepseek-v4-flash,
deepseek-v4-flash-vision-exp, deepseek-v4-pro, deepseek-flash]`; effort `[off, low, high, max]`);
each `hint` contains the literal dotted key (`mpd.jsonc teamModels.slot<N>.<leaf>`) AND the shared
`BRIDGE_DISCLOSURE` sentence AND the not-lost clause, built by the same single helper the existing
knobs use. The existing thirteen knobs keep their paths, kinds and labels byte-for-byte.
- Satisfied by: t3. Verified by: t9 (byte read of the built TUI dist) and t12 (parity attack).
- Check: `bun test packages/mpd-config-plugin` (exact nine paths, kind, non-empty options, hint
  contents) and `grep -n "teamModels" packages/mpd-config-plugin/src/settings-schema.ts`.

**A4 — the TUI front door offers SELECTIONS computed from the live catalog at registration; no
slot is ever a text field.** The host renders `kind: "select"` by cycling a frozen option list, so
option lists must be computed from the adapter's `llmCatalog()` at registration, must be non-empty,
and degrade to A3's declared lists when the catalog is degraded or empty. The OTHER thirteen fields
keep their current paths/kinds/labels byte-for-byte and the section still registers exactly once.
- Satisfied by: t4 (Junior Engineer). Verified by: t9.
- Check: `bun test packages/mpd-tui-plugin` (a fake adapter with a two-provider catalog → derived
  option values/labels per knob; a degraded adapter → declared fallback options; no field of the
  nine has `kind !== "select"`; section field count pin updated 13 → 22 and commented); AND a
  mounting boot (`node skills/dsh-qa/scripts/tui-settings-bridge.mjs`, or `tui-mount.mjs`) in the
  t9 evidence.
- MEASUREMENT REQUIREMENT (plan risk "TUI host variance"): the evidence must record WHICH branch
  produced the options (live catalog vs declared fallback). A case that only asserts "non-empty
  options" cannot distinguish the two and does not satisfy A4.

**A5 — the Web front door renders dependent pickers and the SERVED bytes carry them.** Per slot the
card renders a model control whose options are the catalog's provider/model pairs (provider shown
as a group) and an effort control whose options are the SELECTED model's own efforts; changing the
model re-derives the effort options. Nothing about a slot is settable only by typing. The catalog is
reached through GUARDED probes of `ctx.get("sessions")` + `ctx.get("modelDirectories")` (the
existing `team-page.js` pattern) — never by adding a required inject. If a probe is absent, no
session is bound, or `directoryFor` throws, the card falls back to the declared option lists and the
settings section still renders.
- Satisfied by: t5 (Senior Engineer). Verified by: t9.
- Check: `bun test packages/mpd-bundle-plugin`; `node scripts/build-mpd-client.mjs` then a byte read
  of `packages/mpd-bundle-plugin/client.js`; AND `node skills/dsh-qa/scripts/web-settings-bridge.mjs`
  proving a mutate that sets at least one slot key lands in the resolved config.
- HONESTY BOUND: no lane may claim "the user sees the picker" — no browser exists here. The claim
  is (i) the registration is in the BUILT and SERVED client and (ii) the write path over the host
  API works. State it exactly that way.

**A6 — front-door parity is enforced, and the count pins move 13 → 22.** The card's mirrored
`FIELDS` and the TUI's declared knob metadata are ELEMENT-WISE identical on declared metadata
(§1.3) for all 22 rows, in the same order, including the FULL `path` array (not only its first two
segments), `kind`, and the declared fallback `options`. Both existing count pins move:
`packages/mpd-bundle-plugin/test/settings-card.test.mjs` (`toHaveLength(13)` and its stale "eleven
fields" comment) and `packages/mpd-tui-plugin/test/plugin.test.ts` (the `toHaveLength(13)` pin and
its comment). The web client source still does NOT reference `SETTINGS_KNOBS`.
- Satisfied by: t3 (declaration) + t5 (mirror + extended test). Verified by: t12 (parity attack) and
  t9 (byte read).
- Check: `bun test packages/mpd-bundle-plugin packages/mpd-tui-plugin` and
  `grep -rn "SETTINGS_KNOBS" packages/mpd-bundle-plugin/src packages/mpd-bundle-plugin/client.js`
  (must return nothing in the client path).
- Non-drift note: the LIVE option lists differ by construction (server catalog vs client catalog).
  A lane must NOT "fix" that difference; only declared metadata is compared.

---

## 3. CLAUSE B — the slots are the DEFAULT route of agent-teams members

**B1 — one additive adapter seam for the catalog.** `packages/mpd-dsh-adapter-plugin` gains
`llmCatalog()` resolving to `{ providers: [{ id, name, models: [{ id, name, description?, efforts:
[{id,name,description?}], defaultEffort? }] }], degraded: boolean }`, built ONLY from
`ctx.llm.listProviders` / `listModels` / `resolveModelInfo`, plus a `capabilities()` boolean for the
seam. Absent `ctx.llm`, or any one of the three methods missing → `{ providers: [], degraded: true }`,
never a throw, with ONE warn-once line naming the missing seam. A rejecting provider or model is
skipped, not fatal. No new runtime dependency (type-only imports).
- Satisfied by: t2 (Junior Engineer). Verified by: t9 and t12.
- Check: `bun test packages/mpd-dsh-adapter-plugin`; `bun run typecheck`.

**B2 — profile member schema learns `tier` and `route`.** `profiles.js`: `MEMBER_KEYS` gains `tier`
(positive integer) and `route` (all-or-nothing `{ provider, model, reasoningEffort? }`, the same
shape discipline as `fallback`); `normalizeMember` carries both; declaring BOTH on one member is
refused with both keys and the member name in the message; an unknown key is still refused. A
schema-retention test asserts key-by-key that the real profile still carries each member's `tier`
(and Vision Analyst's `route`) — asserted by VALUE, not merely asserted not to throw.
- Satisfied by: t6 (Deep Worker). Verified by: t12.
- Check: `bun test packages/mpd-agent-teams-plugin`.

**B3 — the bundle patch declares tiers, not literals.** All eleven members of the `mpd` profile in
`packages/mpd-bundle/cordis.patch.yml` follow §1.2 exactly: no member keeps a literal
`provider`/`model`/`reasoning_effort`; `role`, `executionPrompt`, `fallback` and `toolDeny` are
unchanged; Vision Analyst declares the explicit `route` from §1.2.
- Satisfied by: t6. Verified by: t9 (composition read) and t10 (real staging).
- Check: `node scripts/dump-config.mjs --profile mpd` (COMPOSITION ONLY, INV-4) to show the profile
  member block is composed, PLUS `grep -n "reasoning_effort\|tier:\|route:" packages/mpd-bundle/cordis.patch.yml`
  read by symbol, PLUS the real staging in B4.

**B4 — a real staging call takes each member's route from its slot.** A real
`agent_teams_create` with `profile: "mpd"` (staged, no approval) in an isolated environment, read
back from PERSISTED team state, yields: Architect/Planner/Reviewer/Lead/Senior Engineer = slot1's
route; Researcher/Explorer/Plan Reviewer = slot2's; Deep Worker/Junior Engineer = slot3's; Vision
Analyst = the vision route. Changing slot1 (or any slot) in the resolved config and repeating the
staging CHANGES the corresponding staged routes — the slots are demonstrably the source, not a
coincidence with a literal.
- Satisfied by: t6. Verified by: t10.
- Check: the staging driver + the staged member records quoted in
  `evidence/model-slots/routing-and-workmate/<ts>/result.json`.
- A member with NEITHER `tier` nor `route` keeps today's captain-derived behaviour byte-for-byte —
  that path must stay reachable (assert it in a unit test, not only in prose).

**B5 — failure semantics (see §6 for the normative matrix).** An unusable slot FAILS team creation
LOUDLY, naming the member and the slot; no team state is written; no effort is ever clamped, aliased
or silently replaced; nothing silently falls back to another route.
- Satisfied by: t6. Verified by: t10 (real staging with a deliberately broken slot) and t12
  (code attack on the whole resolution path).
- Check: `bun test packages/mpd-agent-teams-plugin` for the stub-level branches AND the real broken
  -slot staging quoted in the t10 evidence.
- Distinction that must NOT be blurred: a member's declared `fallback` route is a POST-FAILURE
  switch for `QUOTA`/`RATE_LIMIT`/`AUTH`/`MISSING_CREDENTIAL`/`NO_ADAPTER` (existing
  `isFallbackFailureCode` semantics). It is NOT a staging-time fallback and must never mask a broken
  slot.

**B6 — the adopted-plugin change is carried as deltas only.** Every added/changed line inside
`packages/mpd-agent-teams-plugin/lib/**` lives inside `//#region mpd-delta …` / `//#endregion`
markers; `lib/mpd-deltas.js` is REGENERATED with
`node scripts/patch-agent-teams-fixes.mjs --write-registry` (never hand-edited); afterwards
`node scripts/patch-agent-teams-fixes.mjs --check` exits 0. `lib/index.js`'s member Config schema is
not modified on an assumption — retention is measured by B2's test. The region count BEFORE and
AFTER is reported for the documentation lane.
- Satisfied by: t6. Verified by: t12 (its own `--check` run) and t13 (gate sweep).
- Check: `node scripts/patch-agent-teams-fixes.mjs --check`.

**B7 — no new subsystem.** No new web route, no new service, no new config key outside `teamModels`,
no new runtime dependency anywhere in the wave.
- Satisfied by: t2 + t6. Verified by: t12.
- Check: `grep -rn "register(" packages/*/src/index.ts` review + `node scripts/dump-config.mjs
  --profile mpd` row set unchanged vs. the pre-wave row set.

---

## 4. CLAUSE C — the workmate omo alias is gone

**C1 — base resolution by FUNCTIONAL NAME only.** `mpd_workmate_init base="Deep Worker"` succeeds;
a name spelling that differs only in case/space/hyphen (`"deep worker"`, `"deep-worker"`,
`"DEEP WORKER"`) resolves to the same base; every omo/roster-id key (`hephaestus`, `sisyphus`,
`oracle`, `librarian`, `explore`, `metis`, `momus`, `multimodal-looker`, `sisyphus-junior`) is
REFUSED, and the error lists the valid functional NAMES only — no id appears in the message. The
roster `id` is not accepted as a base key on any surface.
- Satisfied by: t7 (Lead). Verified by: t10 (real tool calls) and t12 (search).
- Check: `bun test packages/mpd-workmate-plugin`; real `mpd_workmate_init` calls in
  `evidence/model-slots/routing-and-workmate/<ts>/`.

**C2 — auto-generated names derive from the functional name.** Omitting `name` yields a slug of the
base's functional name plus a counter unique across existing instances of that base:
`Deep Worker` → `deep-worker-1`, then `deep-worker-2` (never `hephaestus-1`).
- Satisfied by: t7. Verified by: t10.
- Check: `bun test packages/mpd-workmate-plugin` + the real second init in the t10 evidence.

**C3 — `baseId` is exposed by NO tool output, output schema, web route, GUI surface or advertising
string.** Exact surface list, all required:
- tool results AND output schemas: `mpd_workmate_init`, `mpd_workmate_list`, `mpd_workmate_match`
  (and `mpd_workmate_spawn`/`reflect`/`rename`/`delete` carry none);
- the service payloads read by the tab: `mpdWorkmate.list` / `get` / `read` (no `baseId` key for an
  instance or a base);
- web routes: `GET /plugins/mpd-workmate/list`, `/roster`, `/get` carry no `id`/`baseId` field for a
  base or an instance;
- the sidebar tab in `packages/mpd-bundle-plugin/src/web-client.js`: the base `<option>` VALUE is the
  functional NAME, the option LABEL is the name alone (no `" (id)"` suffix), the detail panel and the
  search read `baseName` only, and the "type the base id" fallback copy is gone from BOTH locale
  dictionaries (`panel.rosterUnavailable`);
- tool descriptions and parameter descriptions no longer advertise "roster id or normal name" —
  `mpd_workmate_init`'s `base` parameter says the functional name (and the refusal text says NAMES).
- Satisfied by: t7. Verified by: t10 (MEASURED absence in real payloads) and t12 (search: pattern +
  searched roots quoted).
- Check: `grep -rn "baseId" packages/mpd-workmate-plugin/src packages/mpd-bundle-plugin/src` must
  return no EXPOSURE site (internal plumbing sites are not exposure); a real init/list/match/roster
  payload read in the t10 evidence; `bun test packages/mpd-bundle-plugin`.
- Scope boundary (do not over-reach): this clause governs the WORKMATE place. The mpd-roles roster's
own `id` field in `mpd_roles_list` is NOT touched (plan §6 non-goal: stable ids stay internal chain
keys). A lane must not "clean" `mpd-roles-plugin` output.

**C4 — storage provenance is preserved (negative control).** After an init, `meta.json` STILL
contains `baseId`; no existing `~/.mpd/workmate` instance is migrated, rewritten or renamed.
- Satisfied by: t7. Verified by: t12 (a test that asserts the key survives must exist, so the removal
  cannot be "proved" by deleting storage).
- Check: `bun test packages/mpd-workmate-plugin` + a test asserting `meta.json.baseId` is present.

**C5 — the rest of the workmate contract is intact.** rename (directory move + index + note
self-reference + `renamedFrom`, never re-instantiation), delete (archive-first; purge only with
`purge:true` + `confirm === name`), the in-use refusal, `mpd_workmate_reflect`, match threshold and
spawn semantics are unchanged; `bun test packages/mpd-workmate-plugin` is green.
- Satisfied by: t7. Verified by: t13 (gate sweep) and t12.

---

## 5. CLAUSE D — documentation, derived artifacts, gates, evidence, process

**D1 — bilingual documentation.** Every human-facing doc touched ships BOTH its English file and its
简体中文 twin in the same change, with the language switch link directly under the title; the
packages whose behaviour changed carry the new truth (mpd-config: slot shape/defaults/mapping/
restart semantics; mpd-tui: catalog-driven selections; mpd-bundle-plugin: the dependent picker and
its degraded fallback; mpd-workmate: base by functional name only, name-derived auto names, baseId
internal-only; adapter: the `llmCatalog` seam and its degrade path). Invalidated statements are
CORRECTED, not softened (the old "thirteen knobs" wording becomes the new count; the workmate docs
stop advertising an id or "roster id or normal name"). `AGENTS.md` carries the two new facts where a
future agent meets them, and `agent-references/agent-teams-deltas.md` records the new delta regions
and the regenerated live region count.
- Satisfied by: t8 (Junior Engineer). Verified by: t12 and t13.
- Check: `bun run verify:docs`; `node scripts/verify-docs-parity.mjs` must not discover
  `agent-references/**` (English-only band, by policy).
- Honesty bound: the `mpd-agent-teams-plugin/README*.md` files are upstream provenance and stay
  VERBATIM (t6/t8 non-goal).

**D2 — derived artifacts are rebuilt by the task that owns them (T-88).** Each touched package's
committed `dist/index.js` is the byte product of the CANONICAL repo-root build:
`bun build packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js`
for `mpd-dsh-adapter-plugin`, `mpd-config-plugin`, `mpd-tui-plugin`, `mpd-workmate-plugin`; and
`node scripts/build-mpd-client.mjs` produces `packages/mpd-bundle-plugin/client.js`.
`packages/*/dist/**` is declared in t13's `inScope` (verified: t13 inScope contains
`packages/*/dist/**`). **`packages/mpd-bundle-plugin/client.js` is the one derived surface with an
ordering hazard — see §9 H1; the captain must amend t13's `inScope` to include it.**
- Satisfied by: t13 (integration) for dist; t5 for the first client build; t7 for `web-client.js`.
- Check: `node scripts/verify-dist-fresh.mjs` green after the final build; `git ls-files` shows the
  rebuilt bytes tracked for `packages/*/dist/index.js`.

**D3 — the gate sweep runs on settled hashes.** After all lanes are quiesced, run and capture
(enumerated exactly, per AGENTS.md §4/§11 minus the release-only items):
`bun run verify:gates`, `bun test` (per touched package), `bun run typecheck`, `bun run test:qa`,
`bun run verify:rows`, `bun run verify:docs`, `node scripts/verify-dist-fresh.mjs`,
`node skills/dsh-qa/scripts/preset-conformance.mjs`,
`node scripts/patch-agent-teams-fixes.mjs --check`, `node scripts/install-profile.mjs --dry-run`.
NOT wave gates: `scripts/pack-mpd.mjs`, `node scripts/verify-pack-closure.mjs` (INV-3), any
`skills/**`-dependent re-pin (INV-1). Every verdict is anchored to measured hashes, re-checked after
a short settle window (AGENTS.md §7 "Verify on SETTLED hashes").
- Satisfied by: t13. Verified by: the captain's single commit + t12's independent `--check`.
- Check: the commands above, with exit codes and output quoted under
  `evidence/model-slots/integration/<ts>/{result.json,output.log}`.

**D4 — evidence on disk (assignment per lane).** Every claim is backed by a real command or tool
result with its exit code. Writer scopes for `evidence/**` exist only on t9
(`evidence/model-slots/settings-surfaces/**`), t10 (`evidence/model-slots/routing-and-workmate/**`),
t12 (`evidence/model-slots/review/**`) and t13 (`evidence/model-slots/integration/**`).
**Implementation lanes (t2–t8) hold NO `evidence/**` writer scope**, so their on-disk evidence is
(a) the quoted command output in their task-result payload (durable in
`.mpd/team/model-slots-amp-workmate-aliases/team.json`) and (b) their committed test files under
`packages/<pkg>/test/**`. The wave's per-clause disk evidence is therefore:
- CLAUSE A → t9 `evidence/model-slots/settings-surfaces/<ts>/`;
- CLAUSE B → t10 `evidence/model-slots/routing-and-workmate/<ts>/`;
- CLAUSE C → t10 same directory;
- CLAUSE D → t13 `evidence/model-slots/integration/<ts>/`;
- the review verdict → t12 `evidence/model-slots/review/<ts>/` (or its task result, if its inScope is
  narrower than that path — the verdict is the deliverable);
- requirements → this file.
If the captain wants per-implementation-lane evidence FILES under `evidence/model-slots/**`, the
`inScope` must be amended per the T-88 hop rule (§9 H3) BEFORE that lane edits anything.

**D5 — process invariants.** INV-1, INV-2 hold; no lane commits; the plan of record is updated by
t13 with the wave outcome and the evidence paths named.
- Check: each lane's result states "no git write command was run"; `git status --porcelain` at the
  end shows only in-scope changes.

**D6 — the plan of record records the outcome.** `.mpd/plans/model-slots-and-workmate-aliases.md` has
its checklist items marked and the landed evidence paths named.
- Satisfied by: t13 (declared in its `inScope`: `.mpd/plans/**`). Verified by: t12/the captain.

---

## 6. FAILURE SEMANTICS (normative — every row is a required observable)

| # | Condition | Required observable | Proved by |
|---|---|---|---|
| F1 | `mpdConfig` service absent from the composition | staging FAILS; message names the MEMBER, the SLOT and the fix; NO team state written | unit test (t6) + real staging (t10) |
| F2 | `teamModels.slot<N>` absent (stub / edge config) | same as F1 — never a default-route substitution | unit test (t6) |
| F3 | slot's `provider` or `model` missing, EMPTY or whitespace-only | same as F1. An empty string is INCOMPLETE (the file layer can carry `""` past a deep merge), and it is NEVER replaced by the schema default | unit test (t6) + real staging with `"provider": ""` (t10) |
| F4 | slot `model` not in the provider's catalog | staging FAILS; message names the MEMBER and the SLOT; the underlying dsh-llm error text (available-model list) is preserved | unit test (t6) + real staging (t10) |
| F5 | slot `reasoningEffort` unsupported by the model | staging FAILS with the underlying `UNSUPPORTED_REASONING_EFFORT` surfaced plus the member and the slot named. The effort is NEVER clamped, aliased, dropped or replaced by a neighbour | unit test (t6) + real staging (t10) + code attack (t12) |
| F6 | a member declares BOTH `tier` and `route` | profile load REFUSES, naming the member and both keys | unit test (t6) |
| F7 | a member declares NEITHER | today's captain-derived route, byte-for-byte unchanged | unit test (t6) |

INVARIANT over all rows: a declared `fallback` route is used ONLY after a real failure whose code is
in `{QUOTA, RATE_LIMIT, AUTH, MISSING_CREDENTIAL, NO_ADAPTER}`; it is never consulted at staging time
and never masks F1–F6. `agent_teams_create` must write NO team state for a failed staging.

---

## 7. PER-LANE CHECKLIST

Legend: `[S]` = must satisfy, `[V]` = must verify (independent). Owner names are the roster names.

### t1 requirements — Planner (this task)
- [x] Contract frozen at `evidence/model-slots/requirements/CONTRACT.md`, checklist per lane, every
      item checkable by a command or an observable artifact path.

### t2 implementation — Junior Engineer · adapter seam
- [S] B1, B7. [V] —
- Result must quote: `bun test packages/mpd-dsh-adapter-plugin`, `bun run typecheck` (outputs).
- On-disk evidence: committed `packages/mpd-dsh-adapter-plugin/test/adapter.test.ts` + task result.

### t3 implementation — Senior Engineer · config layer
- [S] A1, A2, A3, and the declaration half of A6.
- Result must quote: `bun test packages/mpd-config-plugin` (literal defaults, the nine paths, hint
  contents, the resolution cases a–c).
- On-disk evidence: committed tests + task result. Disk evidence for A2 is produced by t9.

### t4 implementation — Junior Engineer · TUI selections
- [S] A4 (all three catalog/fallback branches + the measured-branch requirement + the 13 → 22 pin).
- Result must quote: `bun test packages/mpd-tui-plugin`, `bun run typecheck`.
- On-disk evidence: committed `packages/mpd-tui-plugin/test/plugin.test.ts` + task result.

### t5 implementation — Senior Engineer · Web card
- [S] A5, the mirror half of A6, and the first successful `node scripts/build-mpd-client.mjs`.
- Result must quote: `bun test packages/mpd-bundle-plugin`, `bun run typecheck`,
  `node scripts/build-mpd-client.mjs`, plus the rebuilt `client.js` byte read showing the nine slot
  keys.
- On-disk evidence: committed `packages/mpd-bundle-plugin/test/settings-card.test.mjs` +
  `client.js` + task result. **`client.js` has a later authoritative rebuild — see §9 H1.**

### t6 implementation — Deep Worker · adopted plugin + profile
- [S] B2, B3, B4, B5, B6, B7. Also reports the delta region count before/after and the exact
  `--write-registry` command used.
- Result must quote: `node scripts/patch-agent-teams-fixes.mjs --check`,
  `bun test packages/mpd-agent-teams-plugin`, `bun run typecheck`.
- On-disk evidence: committed `lib/profiles.js`, `lib/tools.js`, regenerated `lib/mpd-deltas.js`,
  `cordis.patch.yml`, tests + task result.

### t7 implementation — Lead · workmate alias removal
- [S] C1, C2, C3, C4, C5.
- Result must quote: `bun test packages/mpd-workmate-plugin`, `bun test packages/mpd-bundle-plugin`,
  `bun run typecheck`, and the grep that shows no exposure site remains.
- On-disk evidence: committed `src/index.ts`, `test/workmate.test.ts`,
  `packages/mpd-bundle-plugin/src/web-client.js`, sidebar-tab test + task result.
- **Do NOT rebuild `client.js`** (out of scope) — that is H1's job.

### t8 documentation — Junior Engineer
- [S] D1 (both twins, corrected statements, AGENTS.md facts, deltas registry).
- Result must quote: `bun run verify:docs` and the doc-parity summary line.
- On-disk evidence: the committed EN + `*.zh-CN.md` pairs, `AGENTS.md`,
  `agent-references/agent-teams-deltas.md` + task result.

### t9 verification — Lead · settings surfaces [V]
- [V] Independent verification of A1–A6 and B1; MUST NOT restate a lane's own suite as its verdict.
- Evidence: `evidence/model-slots/settings-surfaces/<ts>/{result.json,output.log}` with a REAL mount
  in an isolated `DSH_HOME` + sandbox `HOME` + sandbox workspace (AGENTS.md §7), the real
  `mpd_config_get` payload, the TUI option-source measurement, the byte read of
  `packages/mpd-tui-plugin/dist/index.js` and `packages/mpd-bundle-plugin/client.js`, and the
  negative control of A2(d).
- Every unprovable item is reported as a FAILURE with the missing piece named.

### t10 verification — Junior Engineer · routing + workmate [V]
- [V] Independent verification of B3, B4, B5 and C1–C3, end-to-end with real calls.
- Evidence: `evidence/model-slots/routing-and-workmate/<ts>/{result.json,output.log}` with the
  persisted staged member routes, the slot-change re-staging, the broken-slot loud failure (F3/F4/F5
  variants), the omo-id refusal, `deep-worker-1`, and the MEASURED absence of `baseId`/`id` in the
  real payloads.

### t11 review (plan gate) — Plan Reviewer
- [V] Judges THIS contract's executability and completeness against the plan of record; verdict only.

### t12 review — Reviewer [V]
- [V] Judges EVERY item above as met / not met with FILE+SYMBOL evidence read from the tree, attacks
  the failure semantics (F1–F7), the parity claim (A6), the adopted-delta discipline (B6) with its own
  `node scripts/patch-agent-teams-fixes.mjs --check` run, and the absence claims (C3) with the quoted
  search pattern and roots. Verdict only; no fixes.
- Evidence: `evidence/model-slots/review/<ts>/` (or the task-result verdict if narrower).

### t13 integration — Lead
- [S] D2, D3, D6. Runs the canonical dist builds, the authoritative `client.js` rebuild (per §9 H1's
  amendment), the gate sweep, and records the wave outcome in the plan of record.
- Evidence: `evidence/model-slots/integration/<ts>/{result.json,output.log}`.
- Must state exactly which paths changed and what remains uncommitted (for the captain's single
  commit), and that no git write command was run.

---

## 8. EVIDENCE TREE (final shape)

```
evidence/model-slots/
  requirements/CONTRACT.md                     (t1, this file)
  settings-surfaces/<ts>/{result.json,output.log}      (t9  — clause A + B1)
  routing-and-workmate/<ts>/{result.json,output.log}   (t10 — clauses B + C)
  review/<ts>/…                                (t12 — verdict/findings)
  integration/<ts>/{result.json,output.log}    (t13 — derived artifacts + gate sweep)
```
Implementation-lane proof lives in their task results plus committed tests (§D4).

---

## 9. OPEN HAZARDS AND REQUIRED CAPTAIN AMENDMENTS

**H1 — `packages/mpd-bundle-plugin/client.js` is a derived surface with an UNOWNED-ORDERING hazard
(T-88).** `client.js` is the built product of `packages/mpd-bundle-plugin/src/*.js`, and TWO lanes
invalidate it: t5 (settings card) and t7 (`web-client.js`, the workmate tab). `client.js` is declared
in t5's `inScope` only, and NO dependency orders t5 after t7 (t5 deps t1,t3; t7 deps t1), so the two
can run in parallel and the committed `client.js` can carry the OLD "(id)" option value and the old
"type the base id" copy while C3 is reported as satisfied. It is also excluded from t13's
`inScope` (`packages/*/dist/**` does not match `packages/mpd-bundle-plugin/client.js`), so integration
cannot repair it — the platform refuses an undeclared changed path.
- REQUIRED FIX (recommended): amend t13's `inScope` to add `packages/mpd-bundle-plugin/client.js`,
  and make the post-all-lanes rebuild THERE the authoritative one. t13 then commits the rebuilt bytes
  (it owns them) instead of reporting a byte difference as a failure; t5's rebuild remains the proof
  that the card compiles into the client.
- ALTERNATIVE: make t5 depend on t7 so t5's rebuild is last (and keep t13's wording as a staleness
  detector).
- Either way, t12 must check that the committed `client.js` contains NO `baseId` and NO `(id)` option
  suffix.

**H2 — `dist/mpd-package/**` is not a hole.** It is gitignored and untracked (INV-3) and is a
release-only artifact; nothing in this wave packs. No amendment needed. Reported so a reviewer does
not raise it as an undeclared derived path.

**H3 — implementation lanes cannot write `evidence/model-slots/**`.** Their `inScope` values name
only `packages/**`. D4's assignment (task-result payload + committed tests for t2–t8, all
`evidence/model-slots/**` files owned by t9/t10/t12/t13) is the frozen reading. If the captain wants
per-lane evidence FILES, the `inScope` must be amended per the T-88 hop rule — requested in ONE
message with the exact amendment text and no work attached — BEFORE the lane edits anything. This is
not required for the wave to be verifiable, and it is the captain's call.

**H4 — no `skills/**` change means NO `VENDOR_LOCK.json` re-pin (INV-1).** A dirty `skills/**` tree
would legitimately redden `verify:vendor`; that must be reported as out-of-contract, never repaired
by a lane.

---

## 10. SELF-CHECK AGAINST THIS TASK'S OWN ACCEPTANCE

| t1 acceptance criterion | Where satisfied |
|---|---|
| names all three user clauses | §2 (slots on both front doors), §3 (default route + slot1/2/3 member assignment, §1.2), §4 (workmate alias: base resolution, auto-naming, every exposed surface) |
| every item checkable by a command or an observable artifact path | every item A1–A6, B1–B7, C1–C5, D1–D6 carries an explicit `Check:` line; §6 rows carry their proving lane and case |
| fixes the settings shape and defaults; both front doors declare identical labels | §1.1 (shape + max/high/high) and A6 (declared-metadata parity on path/label/zh/kind/options, count pins 13 → 22) |
| states the failure semantics (loud, member + slot named, no silent fallback, no clamping) | §6 F1–F7 plus the `fallback`-vs-staging distinction in B5 and the invariant under the table |
| assigns each item to the satisfying and verifying lane, and lists on-disk evidence | §2–§5 (`Satisfied by` / `Verified by` per item), §7 per-lane checklist, §8 evidence tree, D4 for the implementation-lane proof boundary |
| artifact written to `evidence/model-slots/requirements/`, readable markdown, checklist per lane | this file, §7 |

Additionally reported to the captain (they change what the parent must do next): H1 (required
`inScope` amendment) and H3 (per-lane evidence scope choice).
