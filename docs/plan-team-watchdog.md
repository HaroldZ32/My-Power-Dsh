# Team Watchdog — Frozen Contract for the Next Wave (no implementation in this wave)

- **Artifact owner / task**: `t45` (work, Planner, read-only) — deliverable `.mpd/plans/team-watchdog.md`.
- **Status**: FROZEN as the acceptance contract of the NEXT wave, **AMENDED once by `t46`** (see the
  AMENDMENT 1 note below and the §12 log). Every surviving claim about the workspace was re-verified
  against the live code sites in this edit round: `tools.js:241-246` (mass cancel), `:2217` (resume
  cannot recreate), `scheduler.js:422-423`/`:454-455`/`:490-491` (the decline gates the hold must
  join), `tools.js:1343` (no `halted` guard on claim), adapter `:273`/`:274`/`:279` (+ impls `:529`/
  `:535`/`:564`), `settings-card.js:46` (its own `FIELDS`), `mpd-config-plugin/src/index.ts:511`
  (`applies:"restart"`), `snapshot.js:49-56`/`:84` (the unread pattern). This wave (`t43`, `t44`,
  `t45`, `t46`) stops at research + design + this freeze. **The user's sequencing is verbatim
  binding** — see D0.
- **Derived from**: the Researcher's dossier
  `evidence/team-watchdog/requirements/20260915T090440Z/HOST-WATCHDOG.md` (326 lines, sha256
  `e483db67fd5063a8b4bd…`) and its `result.json` (t43, verdict pass, 6/6 acceptance). Every claim
  about the workspace below either cites the dossier (`D§a`..`D§f`) or was re-checked on this tree;
  where the dossier left a question open, this plan says so instead of inventing an answer.
- **AMENDMENT 1 (t46)** — this file is amended through its own §10 change channel, not forked. The
  decisions-scoped dossier `evidence/team-watchdog/requirements/HOST-AND-PLUGIN-SEAMS.md` (306 lines,
  sha256 `a2dd5227a3324651f490…`) + `result-decisions.json` (t43 decisions scope) measured FOUR
  things this plan got wrong or omitted; the corrections are folded in place and marked
  **[AMEND-1]**: (1) the pause must NOT reuse the task-cancelling `haltTeamWork`; (2) the concrete
  knob paths + the three-file consequence + live tuning; (3) the adapter's read-only PRE-hook limit;
  (4) the seen/unread gap. §6's staging is explicitly re-sequenced (see §6's re-sequence note).
- **Design input (must land before implementation)**: `t44` (Architect, `inScope:
  evidence/team-watchdog/design/`) produces the reviewable design (region-vs-module per hook, the
  WARN→ESCALATE state machine, the scene schema, freeze semantics). This plan is the **contract**
  the design must satisfy; if the design and this plan disagree, the captain amends `t46` (this
  file) — amendment is the single channel (`§10`).
- **Shape reference**: `.mpd/plans/dsh-tui-edition.md` (the wave that shipped the TUI edition,
  the settings bridge and the lane patterns this plan reuses).
- **Pins**: repo `/root/dshProj/my-power-dsh` @ the wave's final revision; installed harness
  `@deepseek-ai/dsh` 0.1.5-rc.1 CLI / 0.1.5-rc.2 packages; TUI host
  `@deepseek-harness-tui/dsh-tui` 0.10.1; adopted plugin `packages/mpd-agent-teams-plugin/lib/**`
  (48 delta regions).

## 0. User decisions (VERBATIM — they are the contract)

**D0 (sequencing, verbatim):** *"研究完了先落实为计划，在桥接完事了以后，下一波再实现"* — research
first, then freeze a **plan**, and implement in the NEXT wave **after the bridge wave lands**. This
wave writes no implementation. The bridge wave (`evidence/mpd-bridge/**`, tasks t32–t42) must be
complete before the implementation wave starts.

**D1 (heartbeat scope, verbatim):** heartbeat every model step **and every tool call**, for
**members AND the captain**.

**D2 (configurability, verbatim):** "defaults plus configurability, with the knobs placed in the
`mpd` settings namespace we just bridged (so they appear in the TUI `/settings` screen AND the Web
card through the same path)". **Frozen working defaults:** silence > **90 s** ⇒ **WARN** +
heartbeat snapshot; the **same task WARNing three consecutive times** ⇒ **ESCALATE**.

**D3 (blast radius, verbatim):** pause the **affected TEAM only** (scheduler halt + members stop
claiming), scene preserved, resumable by one action.
> **[AMEND-1] The mechanism for D3 is corrected in §5-H2b and AC-7/AC-8.** The verbatim clause says
> "scene preserved, resumable by one `agent_teams_resume`"; the existing `haltTeamWork`
> (`packages/mpd-agent-teams-plugin/lib/tools.js:241-246`) **cancels every non-terminal task**
> (`cancelUnfinishedTask(task, 'Stopped from the captain chat.')`) before it halts, then cancels the
> captain's turn (`:267`) and drains members (`:268`), and `agent_teams_resume` states verbatim
> *"Does not recreate cancelled tasks; only still-pending work is scheduled"* (`:2217`). Reuse would
> therefore DESTROY the in-flight work the watchdog exists to protect. The plan keeps D3's intent
> (team-only, scene preserved, one action) and replaces the mechanism.

**D4 (notification, verbatim):** notify on **BOTH** front doors — Web = banner at the top of the
AgentTeams panel + an activity record; TUI = status-line row + dialog/notice; and **a user who was
not watching must learn about it on the next start**.

**D5 (captain coverage, verbatim):** coverage **includes the captain**, who **cannot rescue itself**
while wedged — hence the process-level tick that writes the scene to disk for the next start or a
front door to surface.

## 1. What this wave established (grounding)

| Fact | Where |
|---|---|
| The measured incident: a member produced nothing for ~20 min while the runtime said `running`, no stray child | `D§f` — `team.json` `t36.reassignReason`, timeline 16:28:25 → 16:32:37 last write, silence to ~16:52 |
| Five harness moments exist and are reachable from a NEW plugin row: `agent/session-start`, `agent/pre-step` (per step), `agent/assistant-stream` (per frame), `agent/turn-stopping`, `agent/status` | `D§a`; host sites `dsh-agent-loop/lib/index.js:1720/:894/:1032/:967/:781` |
| Nothing heartbeat/watchdog/stuck/liveness/lastSeen exists anywhere in `lib/**` or our plugins | `D§c` [MEASURED by grep; re-checked 2026-09-15: still zero] |
| The only existing watchdog is provider-stream-scoped (`idleWatchdog`, 5 min) and is the wrong instrument — its timer exists only while a stream is outstanding | `D§c`, `$H/dsh-llm-deepseek/lib/index.js:1627` |
| Durable state that exists today: `team.json` (+ atomic write), `inbox/<member>.jsonl` (+ watermark read), `retired-members.json`, the member session log, `boulder.json` (absent in this workspace) | `D§d` |
| Resume vs fresh is decidable from disk: same `attemptId` + same `attempt` ⇒ resume; different `attemptId`/incremented `attempt` ⇒ fresh | `D§d`; `state.js:167-195` |
| The `mpd` settings namespace + both front doors already exist (t35 landed) | `packages/mpd-config-plugin/src/settings-schema.ts` (`SETTINGS_NS="mpd"`, `SettingsSchema`, `SETTINGS_KNOBS`, `BRIDGE_DISCLOSURE`), `packages/mpd-tui-plugin/src/settings.ts`, `packages/mpd-bundle-plugin/src/settings-card.js` |
| **[AMEND-1]** The namespace is registered `applies:"restart"`; the bridge re-reads on `settings/document-updated` — the pattern the tick must copy for live tuning | `packages/mpd-config-plugin/src/index.ts:511` (`settingsRegister(..., {applies:"restart"})`), `:478` (doc-updated subscription) |
| **[AMEND-1]** The adapter wraps BOTH tool families but exposes only a POST hook; `guardTool` is contractually read-only | `packages/mpd-dsh-adapter-plugin/src/index.ts:273`/`:529` (`guardTool`), `:274`/`:535` (`onPostToolExecute`), `:279`/`:564` (`executeTool` = the internal tool seam); `AGENTS.md` §6 |
| The lane pattern this plan reuses already shipped | `skills/dsh-qa/scripts/{tui-mount,tui-panels,tui-settings-bridge}.mjs`; SKILL.md case table rows 80–86 |
| Adopted-code changes are delta REGIONS; the applier's refusals are the constraint | `D§b`; `lib/mpd-deltas.js`, `scripts/patch-agent-teams-fixes.mjs` |

## 2. Scope

### 2.1 In scope for the NEXT wave

- One new plugin package `packages/mpd-team-watchdog-plugin/` (heartbeat writer, watchdog state
  machine, scene store, the **preserving hold** + resume, notification fan-out, the process-level tick).
- Watchdog knobs added to the EXISTING `mpd` settings namespace — **[AMEND-1] three of OUR files, none
  in adopted code**: `packages/mpd-config-plugin/src/settings-schema.ts` (schema + `SETTINGS_KNOBS`),
  `packages/mpd-tui-plugin/src/settings.ts` (DERIVES from `SETTINGS_KNOBS`, so it needs no new field
  list — it needs the section/disclosure unchanged), and `packages/mpd-bundle-plugin/src/settings-card.js`
  which keeps its **OWN** `FIELDS` list (`:46`, "the SAME fields the TUI `/settings` section declares")
  and must gain the same rows. **The "same path" is single-NAMESPACE, not single-list.**
- **[AMEND-1] Live tuning**: the namespace is registered `applies:"restart"`
  (`mpd-config-plugin/src/index.ts:511`), so the tick must **re-read its four knobs on
  `settings/document-updated`** (the bridge subscribes exactly so at `:478`) instead of caching them at
  apply time — otherwise raising `warnSilenceMs` would only take effect after a host restart.
- **[AMEND-1] One adapter extension in OUR package**: `packages/mpd-dsh-adapter-plugin/src/index.ts`
  needs a mutate-shaped gate on `tools/execute` (see §5-H1b) — an adapter change, zero delta regions.
- The bundle patch row for the new package: `packages/mpd-bundle/cordis.patch.yml`.
- QA lanes: `skills/dsh-qa/scripts/team-watchdog-*.mjs` + their SKILL.md rows (the wave's only
  `skills/**` writer).
- Web banner + activity record in `packages/mpd-bundle-plugin/src/team-page.js` (and the client
  rebuild `client.js` via `node scripts/build-mpd-client.mjs`).
- Evidence under `evidence/team-watchdog/**`.

### 2.2 Explicitly OUT of scope

- Any change to `packages/mpd-agent-teams-plugin/lib/**` **unless** it is a registered delta region
  with `--write-registry` re-run; and no region at all if the new-package design suffices (`D§b`
  shape (ii)/option 3 is the recommendation).
- Re-implementing the **halt/resume** path as the pause. The existing `agent_teams_halt` /
  `agent_teams_resume` contract is NOT the pause: `haltTeamWork` mass-cancels non-terminal tasks
  (`tools.js:241-246`) and the resume cannot recreate them (`:2217`) — see D3's AMEND-1 note and
  §5-H2b. The pause is a NEW preserving hold; `agent_teams_resume` stays untouched for teams the
  user halted by hand.
- **[AMEND-1]** Reusing `haltTeamWork` minus its cancel loop. That is a REPLACEMENT-shaped edit to an
  adopted file ⇒ the delta heal REFUSES loudly after a human re-materialise (D13/D14 class) and is
  forbidden for a new capability by §4's rule.
- Reusing `idleWatchdog` for member silence. Its contract is "one outstanding async-iterator
  demand" — precisely what a wedge is not (`D§c`).
- Repainting the Web card's look; only the banner + activity record + the two new knob rows.
- Any change to `VENDOR_LOCK.json` by a worker: the wave's single skills-corpus re-pin is the
  captain's commit (`AGENTS.md` §9/§11).

## 3. Acceptance criteria (AC-1 … AC-17)

Each row is falsifiable, names its lane, the exact command where one exists, and where the raw
artifact must land. "Nothing to assert" is never a pass — a surface that cannot be witnessed is
`not-claimed` with its artifact (`§9`). Rows marked **[AMEND-1]** were changed or added by t46; the
count grew from 16 to 17 (AC-17 is the pause-preservation AC the first freeze lacked).

| ID | Claim (falsifiable) | Lane | Exact command(s) | Evidence path |
|---|---|---|---|---|
| **AC-1** | The heartbeat is REAL and per-step: during a live member turn, the heartbeat store's `lastSeen` for that member+task advances on **model steps** (not only at turn end), proven by ≥ 3 distinct `lastSeen` values with monotonic timestamps across one turn, captured from disk while the turn runs. | heartbeat | `bun skills/dsh-qa/scripts/team-watchdog-heartbeat.mjs` | `evidence/team-watchdog/lanes/<ts>/heartbeat.json` |
| **AC-2** **[AMEND-1]** | The heartbeat also advances on **tool calls**, for **members AND the captain** — three witnesses: a member turn that calls a tool, a captain turn that calls a tool, and a turn that calls no tool (the last proves the step path is independent of the tool path). **Stamp semantics are honest**: the tool stamp comes from the adapter's POST hook (`onPostToolExecute`), so it is stamped on tool COMPLETION, not before dispatch; the lane asserts a `kind:'tool'` stamp whose `at` lands after the call returned, and must NOT claim a pre-call stamp (that needs the adapter's `tools/execute` extension — §5-H1b). | heartbeat | same lane, `--witness member-tool\|captain-tool\|member-no-tool\|captain-no-tool` | `evidence/team-watchdog/lanes/<ts>/heartbeat.json` |
| **AC-3** | **90 s silence ⇒ WARN + snapshot**, measured with the clock controlled (an injected `now()` or a scaled threshold in the lane config), within a bounded latency (`WARN latency ≤ threshold + 5 s`), and the snapshot lands with the AC-5 fields. | fault-injection | `bun skills/dsh-qa/scripts/team-watchdog-fault.mjs --case warn-90s` | `evidence/team-watchdog/fault/<ts>/warn-90s.json` |
| **AC-4** | **Three consecutive WARNs on the same task ⇒ ESCALATE**: exactly one ESCALATE per task+attempt, its predecessors are recorded as WARNs with their snapshot paths, and no fourth WARN is emitted for the same streak. | fault-injection | `bun skills/dsh-qa/scripts/team-watchdog-fault.mjs --case escalate-3x` | `evidence/team-watchdog/fault/<ts>/escalate-3x.json` |
| **AC-5** **[AMEND-1]** | The **scene snapshot** is complete and restorable: it carries team phase, the adopted `halted`/`haltedAt` **and** the watchdog's own `hold` (id, since, cause, task, attemptId), per-task `{id,status,assignee,attempt,attemptId,lastSeen}`, per-member mailbox watermarks, parked attempt ids, and the halt/stuck reason — and a restart of the process re-reads exactly those fields (a fresh process prints them). | scene | `bun skills/dsh-qa/scripts/team-watchdog-scene.mjs` | `evidence/team-watchdog/scene/<ts>/` |
| **AC-6** | The snapshot is **atomic and idempotent**: write-then-read round-trips byte-identically; a second write of the identical state changes no bytes; a torn write is impossible (temp+rename), proven by a crash-injection of the writer. | scene | same lane, `--case atomic --case idempotent` | `evidence/team-watchdog/scene/<ts>/` |
| **AC-7** **[AMEND-1]** | **The pause is a PRESERVING hold, team-scoped**: after ESCALATE the affected team's dispatch stops (no new claim/kick for THAT team) while a SECOND, untouched team in the same workspace keeps dispatching through the same window; and **NO task record is cancelled** — every non-terminal task present before the pause is still non-terminal after it, with its status and `attemptId` byte-identical (the byte-diff of `team.json` task records shows ONLY the new hold fields, never a status/attemptId change, and never `cancelledTasks`). The lane FAILS if `agent_teams_halt`-style mass cancellation happened. | fault-injection | `bun skills/dsh-qa/scripts/team-watchdog-fault.mjs --case pause-scope` | `evidence/team-watchdog/fault/<ts>/pause-scope.json` |
| **AC-8** **[AMEND-1]** | **One action resumes AND re-arms the held attempt**: a single resume action (the plugin's own `session-watchdog-resume` path through the adapter's internal tool seam; `agent_teams_resume` is NOT used for a watchdog hold) clears the hold for that team and re-dispatches the parked attempt through the EXISTING parked-attempt machinery (`scheduler.js:397`, `:515-548`, `:620-630`); the held task then continues with the SAME `attemptId` when the park survived, and mints a FRESH attempt when it did not — both branches witnessed, and a second resume is refused as a no-op. | fault-injection | `bun skills/dsh-qa/scripts/team-watchdog-fault.mjs --case resume` | `evidence/team-watchdog/fault/<ts>/resume.json` |
| **AC-9** | The **captain-wedge** case is covered: with the captain's own turn silent past the threshold, the process-level tick still fires (the watchdog does not depend on a captain turn), the scene lands on disk, the escalation is recorded, and the notice survives a process restart and is surfaced on the next start. | fault-injection | `bun skills/dsh-qa/scripts/team-watchdog-fault.mjs --case captain-wedge` | `evidence/team-watchdog/fault/<ts>/captain-wedge.json` |
| **AC-10** | **NEGATIVE CONTROL**: with the watchdog disabled (a config knob / an env kill-switch), the SAME injected fixture produces **no** WARN, **no** scene and **no** pause — and the lane FAILS when the control unexpectedly fires. A vacuous pass (no injection at all) is a lane failure. | fault-injection | `bun skills/dsh-qa/scripts/team-watchdog-fault.mjs --case control-disabled` | `evidence/team-watchdog/fault/<ts>/negative/` |
| **AC-11** **[AMEND-1]** | The **four knobs are the `mpd` namespace's, with these exact frozen paths and readers**: `watchdog.warnSilenceMs` (number, `90000`, read by the tick), `watchdog.tickIntervalMs` (number, `15000`, must be `< warnSilenceMs`, read by the tick), `watchdog.warnStreakToEscalate` (number, `3`, read by the escalator, counted **per task**), `watchdog.actionOnEscalate` (select `pause` \| `warn-only`, `pause`, read by the escalator). All four appear in the ONE `SettingsSchema` + `SETTINGS_KNOBS`, and the Web card's **own** `FIELDS` list (`settings-card.js:46`) carries the same four rows. **LIVE TUNING is proven**: with the tick running, a `settings/document-updated` for the namespace re-reads the knobs and a raised `warnSilenceMs` changes the observed WARN time without a host restart. | config | `bun skills/dsh-qa/scripts/team-watchdog-config.mjs` (+ `bun skills/dsh-qa/scripts/tui-settings-bridge.mjs`) | `evidence/team-watchdog/config/<ts>/` |
| **AC-12** | **Web**: a stuck team renders a banner at the TOP of the AgentTeams panel plus one activity record; the banner is WIRED into the rendered surface (the render function receives the stuck state), and the record is present in the state payload the panel consumes — not merely a string in the source. | notify-web | `bun skills/dsh-qa/scripts/team-watchdog-notify.mjs --surface web` | `evidence/team-watchdog/notify/<ts>/web.json` |
| **AC-13** | **TUI**: a stuck team holds a status-line row while the condition lasts and surfaces a dialog/notice; the lane asserts the RENDERED pane contains the notice text after the state is set, and re-asserts absence after resume. | notify-tui | `bun skills/dsh-qa/scripts/team-watchdog-notify.mjs --surface tui` | `evidence/team-watchdog/notify/<ts>/tui.pane.txt` |
| **AC-14** **[AMEND-1]** | **Unread replay closes the seen gap**: the durable incident record carries a READ WATERMARK in the mailbox-unread shape (a record per incident + a watermark per reader, the pattern `snapshot.js:49-56`/`:84` uses for mail), so a user who was NOT watching learns on the next start through all three readers — the Web panel's first poll (`team-page.js:101-165`), the TUI status publisher's `publish()` interval (`mpd-tui-plugin/src/status.ts`), and the plugin's session-start attach (`capabilities.js:110`) — and the record clears ONLY on an explicit acknowledge (TUI dialog/`tuiDialogs`, or the Web banner's acknowledge); the lane proves the flag SURVIVES a process restart, that a second start does not surface an acknowledged incident again, and it records the honest fallback: without an acknowledge the replay is **permanent re-display by design** (stated, not hidden). | notify-replay | `bun skills/dsh-qa/scripts/team-watchdog-notify.mjs --surface replay` | `evidence/team-watchdog/notify/<ts>/replay.json` |
| **AC-15** | **Fail-safe**: the watchdog cannot wedge the host — its timer never throws (a throwing callback is caught and counted, not propagated), no unbounded timer chain grows (timer count is asserted over a run window), there is no write loop (write count per state change is asserted), and an UNWRITABLE scene location degrades LOUDLY (a named warning + the incident still notified) instead of silently dying. | regression | `bun test packages/mpd-team-watchdog-plugin` | `evidence/team-watchdog/plugin/<ts>/` |
| **AC-16** | **No adopted-code drift**: `node scripts/patch-agent-teams-fixes.mjs --check` is clean; if a region was added, the registry was regenerated once with `--write-registry` and the region is ADDITIVE (a hypothetical re-materialise of upstream self-heals — proven by the strip → heal → 0-diff method of `evidence/wave3/t5-verify/`); with no region, the adopted tree is byte-identical to the wave's starting revision. | regression | `node scripts/patch-agent-teams-fixes.mjs --check` (+ the strip/heal driver) | `evidence/team-watchdog/delta/<ts>/` |
| **AC-17** **[AMEND-1]** | **Pause PRESERVES the in-flight work (the AC the old plan lacked)**: a task that is `claimed`/`running` when the hold lands is STILL `claimed`/`running` with the SAME `attemptId` after ESCALATE (never `cancelled`, never re-`pending`, no `handoffId/output` cleared), and it is still resumable — the held attempt re-dispatches on resume (AC-8). **Negative control**: the same fixture driven with the pause implemented via `haltTeamWork` MUST redden this AC (the task comes back `cancelled` and `cancelledTasks ≥ 1`), proving the AC falsifies the wrong mechanism rather than merely describing the right one. | fault-injection | `bun skills/dsh-qa/scripts/team-watchdog-fault.mjs --case pause-preserves` (+ `--case pause-preserves-halt-control`) | `evidence/team-watchdog/fault/<ts>/pause-preserves/` |

### 3.1 The measurement trap (this repo has paid for it twice)

A lane MUST assert the REAL thing. For this wave, "real" means: **a scene file that exists and
parses and whose fields a FRESH process reads back** (not "the writer was called"); **a notice that
is WIRED into the rendered surface** (a value the render function receives / a string in the
captured pane / a field in the payload — not a literal in the source); **a pause that the scheduler
honours** (no dispatch observed in a window while paused, and dispatch observed for an untouched
team in the same window). Precedents: `tui-settings-bridge` T4–T6 (the runtime notice must be wired
into the status-line composition, "not merely defined"), `tui-panels` (a surface that renders
nothing FAILS), `codegraph-smoke` (asserting against the model's ANSWER produced both a false green
and a false red).

No lane may report a pass from `--dump-config`, from a source grep, or from a `--self-test` that
never mounts the plugin (`AGENTS.md` §4: composition is not a load).

## 4. Deliverable-to-path table (who owns it, what kind of change)

| Path | Owner | Change kind | Re-materialise consequence |
|---|---|---|---|
| `packages/mpd-team-watchdog-plugin/{src/**,dist/index.js,package.json,README.md,README.zh-CN.md}` | new plugin | NEW package | N/A — not adopted code; a re-materialise cannot touch it |
| `packages/mpd-bundle/cordis.patch.yml` (one `mpd-team-watchdog` row) | new plugin | edit | N/A |
| `packages/mpd-config-plugin/src/settings-schema.ts` (the four watchdog knobs in `SettingsSchema` + `SETTINGS_KNOBS`) | config | edit (our code) | N/A |
| **[AMEND-1]** `packages/mpd-bundle-plugin/src/settings-card.js` (its **own** `FIELDS` at `:46` gains the same four rows) + `client.js` (rebuilt) | web | edit + rebuild | N/A — a second writer for the field LIST; the TUI derives, the card does not |
| **[AMEND-1]** `packages/mpd-dsh-adapter-plugin/src/index.ts` (a mutate-shaped `tools/execute` gate so a PRE-call heartbeat stamp is possible; `guardTool` stays read-only) | adapter | edit (OUR contact surface, `AGENTS.md` §6) | N/A — an adapter change absorbs harness drift; **no delta region** |
| **[AMEND-1]** `packages/mpd-config-plugin/src/index.ts` (no change expected: the tick re-reads on the EXISTING `settings/document-updated` subscription at `:478`) | config | none / reuse | N/A |
| `packages/mpd-config-plugin/src/bridge.ts` (only if a new refusal reason is needed) | config | edit (our code) | N/A — reuse the existing reasons if possible |
| `packages/mpd-tui-plugin/src/settings.ts` (DERIVES from `SETTINGS_KNOBS`; expected unchanged — verified, not edited) | tui | none / verify | N/A |
| `packages/mpd-bundle-plugin/src/team-page.js` (banner + activity record) + `client.js` | web | edit + rebuild (`node scripts/build-mpd-client.mjs`) | N/A |
| `skills/dsh-qa/scripts/team-watchdog-*.mjs` + `skills/dsh-qa/SKILL.md` | QA (ONE writer) | NEW + edit | N/A — but `VENDOR_LOCK.json` `treeSha` is invalidated; the captain's commit carries the single re-pin |
| **If (and only if) the install call must live in adopted code:** `packages/mpd-agent-teams-plugin/lib/index.js` (+ maybe `scheduler.js`) | adopted | **ADDITIVE delta REGION**, body = a one-line install call into the new module | Region must be ADDITIVE (re-defines nothing upstream) ⇒ a hand re-materialise is **self-healed** by `--write`; a REPLACEMENT-shaped region would make the heal **REFUSE loudly** (file byte-untouched, D13/D14 class) and MUST be avoided for this new capability |
| `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js` | adopted | regenerated ONCE by `--write-registry` | Mandatory if any region is added; never hand-edited |
| `packages/mpd-agent-teams-plugin/self-fix-tests/**` | adopted tests | NEW test only if a region is added | Follows D11/D21/D22 style |
| `evidence/team-watchdog/{lanes,fault,scene,config,notify,plugin,delta,review,integration}/<ts>/**` | lanes/verifiers | NEW evidence | Not committed as source |
| `VENDOR_LOCK.json` | **captain** | edit at commit time only | The wave's single re-pin |

**Delta decision rule (frozen):** prefer **zero adopted-code edits**. **[AMEND-1] measured result:**
the heartbeat needs **zero** adopted edits — `agent/pre-step` (`dsh-agent-loop/lib/index.js:894`) and
`agent/assistant-stream` (`:1032`) are ordinary Cordis events a new row can listen to exactly as the
adopted plugin already does, and the tool family is reachable through the adapter's
`onPostToolExecute` (the tool waterfalls are scope-filtered by `dsh-scope` and a plain-context
listener applies globally — `$H/dsh-tools/lib/types/index.d.ts:612`). **The only adopted-code touch
this amendment sanctions** is the pause's decline gate (§5-H2b), and it must be a NEW ADDITIVE gate
(never a replacement): a hand re-materialise then self-heals with `--write`, whereas a
replacement-shaped edit would make the heal REFUSE loudly (D13/D14 class) — forbidden here.

## 5. The hard problems (named, not papered over) — H1 · H1b · H2 · H2b · H2c · H3

**H1 — "resume this attempt" vs "start a fresh one", per task state.** The durable rule is `same
attemptId` + same `attempt` ⇒ resume; a different `attemptId` (or an incremented `attempt`) ⇒ fresh
(`D§d`; `state.js:167-195`; only the current `attemptId` is accepted by `agent_teams_update_task`).
The plan requires the snapshot to carry `attemptId`/`attempt`/`parkedAttempt` per task so the resume
decision is derived from disk, not from memory. **What is NOT solved here:** `parkedAttempts` lives
in process memory (`scheduler.js:397`), so a process that dies mid-pause loses the park — the resume
then has to mint a fresh attempt for a parked task. The implementation must state that consequence
per state (pending / claimed / running / failed) and prove both branches in AC-8.

**H1b [AMEND-1] — the adapter's PRE-hook limit (honest bound on the heartbeat).** The adapter exposes
`guardTool` (`mpd-dsh-adapter-plugin/src/index.ts:273`, impl `:529`) and `onPostToolExecute` (`:274`,
impl `:535`) — the PRE gate and the POST waterfall — and `guardTool`'s contract in `AGENTS.md` §6 is
**"read only, never mutate"**, so writing a heartbeat there would violate the guard contract. A
genuine pre-call stamp therefore requires the adapter to extend to `tools/execute`
(`$H/dsh-tools/lib/types/index.d.ts:49`, "wrappers may change only `exec.signal`") — an adapter change
in OUR package with **no delta involvement**. This plan freezes the POST stamp as the required
deliverable (AC-2) and the PRE stamp as a **declared adapter extension** in §4; no lane may claim a
pre-call tool stamp before that extension lands.

**H2 — the captain cannot rescue itself while wedged.** The only path is the **process-level tick**
(Node/`setInterval` in the plugin's own row — `$L/index.js:537-547` is the existing precedent, and a
new row may call `ctx.setInterval` itself because the harness loads `@deepseek-ai/cordis-plugin-timer`
when `ctx.get('timer')` is undefined) writing the **scene to disk**, plus a durable unread flag that a
later start (or a front door) surfaces (`D§e`: a toast is fire-and-forget, has no persistence and is
DROPPED with no sink; `appendTeamEvent` is not a fallback either because it omits event types the
harness does not know). Consequence: the notification must survive a restart, which AC-9 and AC-14
measure explicitly.

**H2b [AMEND-1] — THE PAUSE (the correction this amendment exists for).** `haltTeamWork`
(`tools.js:225-281`) cancels every non-terminal task before halting (`:241-246`,
`cancelUnfinishedTask(task, 'Stopped from the captain chat.')`), then cancels the captain's turn
(`:267`) and drains members (`:268`); `agent_teams_resume` states verbatim *"Does not recreate
cancelled tasks"* (`:2217`) and `resumeTeamState` only flips the flag (`quality-gates.js:839-852`).
**Option (b)** — reuse `halted`, drop the mass cancel — is a REPLACEMENT-shaped edit to an adopted
file ⇒ loud refusal after a human re-materialise (D13/D14 class), forbidden by §4's own rule.
**Option (a) — CHOSEN: a distinct PRESERVING hold.** A durable `watchdogHold` record on the team
(written by the NEW plugin, in a sidecar next to `team.json`, so the adopted `state.js` keeps sole
ownership of `team.json`) plus the same decline gates the scheduler/kick already honour
(`scheduler.js:422-423`, `:454-455`, `:490-491` — the existing decline sites are themselves regions
of the ADDITIVE class `mpd-delta kick-team-decline-logs` / `kick-member-locked-decline-logs` /
`idle-edge-*`, so new gates follow that shape). Task statuses, attempts and parked attempts are left
untouched. **Trade-off named:** (a) introduces a SECOND team-stopped semantic alongside `halted`
(two states a future reader must know) and costs a small ADDITIVE adoption in `scheduler.js`; it is
chosen because it costs NO replacement-shaped region, it cannot destroy in-flight work, and it makes
D3's "scene preserved" literally true. **Option (c)** — ADDITIVE `halted` guards at the tool boundary
(`agent_teams_claim_task` has NO halted guard today: `tools.js:1343`; the guards sit at `:111`,
`:228`, `:1139`, `:1991`) — is **frozen as a REQUIRED part of (a)**, because a member that already
holds an attempt can otherwise still call `agent_teams_update_task` while the team is held.
**Resume** (one action) clears the hold and re-arms the still-claimed attempts through the EXISTING
parked-attempt machinery (`scheduler.js:397`, `:515-548`, `:620-630`) rather than `resumeTeamState`
alone. **AC-17 is the AC the old plan lacked**: it proves the pause PRESERVES task state, and its
negative control reddens when the pause is implemented with `haltTeamWork`.

**H2c [AMEND-1] — captain authority for the pause: SETTLED.** The process-level tick performs the
pause through the adapter's **internal tool seam** (`dsh.toolRuntime().execute(...)`, adapter
`:279`+`toolRuntime()`, impl `:564`) — the same seam the repo already uses for internal tool calls —
and **never** through `agent_teams_halt` (whose T2 semantics are the mass cancel this amendment
forbids) nor by impersonating captain identity. Reason: the watchdog row is a first-class bundle row
holding its own ctx; the internal seam is the sanctioned way to reach a tool without forging an
authority, and §4 keeps it inside OUR adapter. Consequence to carry: the pause tool the tick calls
must be the plugin's OWN `session-watchdog-hold` action, so the recovered request is NOT a captain
declaration and `update-task`-style identity gates must not be relied on for it; the resume uses the
mirror `session-watchdog-resume`.

**H3 — the watchdog must be fail-safe.** It must not be able to wedge the host: no unbounded timer
chains, no throwing in a timer callback, no write loop; an unwritable scene location must degrade
**loudly** (named warning + the notice still attempted) rather than silently dying; and if the
process is killed outright, the plan must state what survives (the last scene + the unread flag) and
who notices (the next start). **[AMEND-1] the hold is idempotent and never partially applied**: a
second ESCALATE for an already-held team writes no second hold and does not re-interrupt (exit with
the existing hold's identity), and a hold that cannot be persisted is never announced as applied
(it degrades loudly instead). AC-15 measures all of these.

## 6. Next wave's task DAG (a starting point the captain can stage directly)

Roles follow the profile protocol: read-only members take requirements/analysis/review; workers take
implementation/verification/integration. Every implementation task's `inScope` must be disjoint from
its open siblings (the team plugin refuses overlapping write scopes — this is why the shared package
is staged in waves, not parallel branches).

| Task | Role | Depends on | Deliverable |
|---|---|---|---|
| **w1** Freeze the design (consume t44) | Architect | t44 (design) + this plan | design amendments folded into the plan or a design erratum |
| **w2** Seam audit (re-scoped by **[AMEND-1]**: the reachability question is now ANSWERED by measurement — step events + the adapter's POST hook = zero adopted edits; this task VERIFIES the measured claims against the pinned host source and audits the pause gates) | Explorer (read-only) | w1 | `evidence/team-watchdog/seam-audit/<ts>/` — the verification of the heartbeat claim, the `tools/execute` PRE-gap, and the three existing decline-gate sites the hold must join |
| **w3** Heartbeat writer + scene store + WARN→ESCALATE state machine (incl. the durable `watchdogHold` + incident record sidecars, whose schema w7 then drives) | Senior Engineer | w1, w2 | `packages/mpd-team-watchdog-plugin/` (the package, one writer) |
| **w4** Settings knobs in the `mpd` namespace (three OUR-files: config schema+knobs, the TUI section verified as deriving, the web card's own `FIELDS`) + the `settings/document-updated` re-read | Junior Engineer | w3 | the config/card knob edits + AC-11 |
| **w5** Web banner + activity record + client rebuild | Senior Engineer | w3, w4 | `team-page.js` + `client.js` |
| **w6** TUI status row + dialog + unread replay (the watermark + acknowledge) | Senior Engineer | w3, w4 | the TUI notice path |
| **w7 [AMEND-1]** The PRESERVING pause: `session-watchdog-hold`/`-resume` through the adapter's internal tool seam, the durable hold sidecar, the ADDITIVE decline gates in `scheduler.js` (422/454/490 class) and the ADDITIVE tool-boundary `halted`/hold guards on claim/update — **plus** the resume that re-arms parked attempts. **NOT** `agent_teams_halt` | Senior Engineer | w3 | the pause + AC-7/AC-8/AC-17 |
| **w8** Fault-injection harness (stub member that stops stepping; captain-wedge; the halt-control that must redden AC-17) | Deep Worker | w3, w7 | the injected fixture the lanes drive |
| **w9** QA lanes (`team-watchdog-{heartbeat,fault,scene,config,notify}.mjs` + SKILL.md) | Lead (the ONLY `skills/**` writer this wave) | w3…w8 | `skills/dsh-qa/**` + evidence |
| **w10** Independent fault-lane verification (re-run from a clean sandbox, no implementer cache) | Reviewer | w9 | `evidence/team-watchdog/live/<ts>/` |
| **w11** Correctness + fail-safe review of the plugin | Reviewer | w10 | findings only |
| **w12** Delta-region / re-materialise + fail-safety architecture review | Architect | w10, w11 | findings only |
| **w13** Integration: acceptance ledger + evidence index + honest not-claimed list | Lead | w11, w12 | `.mpd/plans/team-watchdog-report.md` |

**Single-writer conflicts to honour when staging (finding F-c below is deliberately answered here):**
the new package is ONE writer (`w3`); `skills/**` is ONE writer (`w9`); `client.js` is generated by
ONE script, so `w5` owns it and `w6` must not rebuild it. Because `w3` and `w4`/`w5`/`w6`/`w7` can
share file scopes, stage them **sequentially, not in parallel** (wave 1: w1–w3; wave 2: w4–w8;
wave 3: w9; wave 4: w10–w13).

**RE-SEQUENCE NOTE [AMEND-1] (explicit, per this amendment's instruction — the DAG is otherwise
unchanged and the w-numbers are NOT renumbered):** the pause change moves work, not identity.
(1) **w7 is no longer a thin "wire up halt" task** — it now carries the preserving hold, the ADDITIVE
`scheduler.js` gates and the resume re-arm, so it is the wave's second-most-sensitive task after w3
and MUST NOT start before w3 has landed the hold/incident sidecar schema it drives (edge w3 → w7
kept, now substantive); (2) **w8 now depends on w7** (its halt-control fixture must drive a real
pause to prove AC-17 reddens), which is why `w3, w7` is written into row w8 above; (3)
**the delta-sensitive work now spans two adopted files** (`scheduler.js` gates + possibly
`tools.js` guards), so `w9`'s delta lane and `w12`'s re-materialise review must cover BOTH — if
either lands as a region, the wave still has exactly ONE `--write-registry` re-run.

## 7. Evidence and gates the next wave must produce

- **Gates**: `bun run typecheck`; `bun test packages/mpd-team-watchdog-plugin`;
  `bun run test:qa`; `node scripts/patch-agent-teams-fixes.mjs --check`;
  `node scripts/verify-rows-parity.mjs`; `node skills/dsh-qa/scripts/preset-conformance.mjs`;
  `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` (the web profile still mounts);
  `node skills/dsh-qa/scripts/team-watchdog-*.mjs --self-test` for every new lane.
- **Evidence layout**: `evidence/team-watchdog/{lanes,fault,scene,config,notify,plugin,delta,live,review,integration}/<timestamp>/`
  with `result.json` + `output.log` per case, pane captures for any TUI lane, and the raw injected
  fixture for every fault case.
- **Isolation**: `DSH_HOME`, `HOME`, and the workspace-scoped `.mpd` roots all sandboxed inside the
  chain (the adopted plugin's `stateDir` is `.mpd/team`, so a lane that boots with a real cwd writes
  REAL team records — assert `assertSessionsSandboxed` and an explicit sandbox cwd).
- **Settled hashes**: every verdict anchored to the artifact hash it measured, re-checked after a
  settle window (`AGENTS.md` §7).

## 8. The wedge arithmetic (re-anchored to the measured timeline) [AMEND-1]

The fixture is the recorded incident, and the numbers are now derived from it rather than asserted:

| Step | Time (local +0800) | Basis |
|---|---|---|
| Last artifact write by the member | **16:32:37.003** | measured mtime (`lane-run-2.hashes-after.txt`), `D§f` |
| The 90 s threshold is crossed (age > `warnSilenceMs`) | **16:34:07** | 16:32:37.003 + 90 s |
| 1st WARN + snapshot | **≈16:34** | the tick's cadence (15 s) bounds the latency |
| 2nd / 3rd consecutive WARN for the same task | ≈16:34:2x / ≈16:36–16:37 | same task, consecutive ticks |
| **ESCALATE** (scene + pause + notice) | **≈16:37** | third consecutive WARN |
| The human noticed and interrupted | **16:52:49** | mailbox record, `D§f` |

⇒ the design would have escalated **≈15 minutes before the human noticed**, and the intervening
WARNs give the user a grace window in which a member that is merely thinking (not wedged) recovers
without any pause at all. The provider `idleWatchdog` would have fired NOTHING (armed only while a
stream is outstanding) and the scheduler idle edge would have fired nothing (the runtime kept
reporting `running`) — both measured. `w5`'s "no real wedge is reproducible" caveat stands: the lane
injects the silence, it does not reproduce a provider wedge.

## 9. NOT CLAIMED

- **W-1 — No implementation in this wave.** This file is a contract; no code, no docs, no lanes
  were written by `t43`/`t44`/`t45`.
- **W-2 — [AMEND-1: RESOLVED by measurement, kept as a record] the per-tool-call heartbeat's seam.**
  The first freeze said a NEW row might not be able to observe tool calls without an adopted edit.
  The decisions-scoped dossier settles it: the tool waterfalls are scope-filtered by `dsh-scope` and a
  plain-context listener applies globally (`$H/dsh-tools/lib/types/index.d.ts:612`), and the adapter
  already wraps the family (`onPostToolExecute`, `:274`/`:535`), so **a new row stamps tool-call
  heartbeats with ZERO adopted-code edits**. What REMAINS open and is now the honest carrier of this
  item: the PRE-call stamp needs the adapter's `tools/execute` extension (§5-H1b) — `w2` verifies the
  measured claims, it no longer has to invent an answer.
- **W-3 — No real bracket-visible wedge exists in this environment.** The fault lanes inject a stub
  member that stops stepping; a genuine 20-minute provider wedge is NOT reproducible on demand, so
  no lane may claim "a real wedge was caught".
- **W-4 — No real browser render.** The Web banner is asserted from the rendered payload/render
  function and the built client bytes; a pixel-level browser render is out of scope.
- **W-5 — The threshold T is frozen at 90 s by the user, not calibrated by data.** The measured
  incident bounds it (silence ≥ 19 min), but the false-positive budget at 90 s is NOT proven here;
  the wave must not claim it is.
- **W-6 — [AMEND-1: SETTLED] Pause authority.** Choice and reason are in §5-H2c: the tick performs
  the pause through the adapter's internal tool seam (`toolRuntime().execute`, adapter `:279`/`:564`)
  calling the plugin's OWN `session-watchdog-hold` action — never `agent_teams_halt` (whose mass
  cancel is forbidden) and never by impersonating captain identity. Consequence carried, not hidden:
  the hold is not a captain declaration, so no identity gate may be assumed for it.
- **W-7 — Engine skew.** Verified against the installed engine (0.1.5-rc.2 packages / 0.1.5-rc.1
  CLI), not against a revision we cannot install here.
- **W-8 [AMEND-1] — A preserving pause is UNEXERCISED against a real wedge.** The hold is proven only
  against an injected fixture (AC-7/AC-8/AC-17); no lane may claim it has been validated on a genuine
  provider wedge, and the two-semantics cost (a `watchdogHold` beside `halted`) is a design debt the
  wave accepts knowingly.
- **W-9 [AMEND-1] — The PRE-call tool stamp does not exist until the adapter lands it.** AC-2 asserts
  the POST stamp; a pre-dispatch stamp is a declared extension in §4 and must be reported as
  not-claimed if it is not implemented.

## 10. Change control

An AC may change only if the captain amends `t46` (task amendment is the single channel — this
amendment is itself the standing precedent); the downstream tasks re-run from the amended contract. Workers and reviewers must not silently weaken an
AC: a criterion that cannot be met is reported **failed** or **not-claimed** with its artifact,
never restated. Findings from `w11`/`w12` are findings-only tasks; a repair task must be NEW
(`AGENTS.md` §12: a failed dependency pins its dependents forever — create new downstream tasks
that depend on the repair + its verification).

## 11. Consumers

| Task | Judges against |
|---|---|
| w1 (design freeze) | D1–D5 realisation, §5 H1/H1b/H2/H2b/H2c/H3, §4 delta rule |
| w2 (seam audit) | W-2, `D§a`, the `tools/execute` PRE-gap and the three decline-gate sites |
| w3–w7 (implementation) | AC-1…AC-9, AC-11…AC-15, AC-17 |
| w8 (fixture) | AC-3, AC-4, AC-9, AC-10, AC-17 (incl. its halt-control that must redden) |
| w9 (lanes) | AC-1…AC-17 (as the producers) |
| w10 (live verification) | AC-1, AC-2, AC-7, AC-8, AC-9, AC-10, AC-12, AC-13, AC-14, AC-17 |
| w11/w12 (reviews) | AC-15, AC-16, §5 H1b/H2b/H2c, §4's ADDITIVE-only rule, §8's arithmetic |
| w13 (integration) | every AC has a final status + artifact; §6/§7 completeness; W-1…W-9 |

## 12. Amendment log

| # | Task | What changed | Why |
|---|---|---|---|
| 1 | `t46` | §0 D3's mechanism note; §2.1 (three OUR-files + live tuning + the adapter extension); §3 AC-2 (POST semantics), AC-7/AC-8 rewritten, **AC-17 added**, AC-11 (exact knobs + live tuning), AC-14 (watermark + acknowledge); §4 (card `FIELDS`, adapter `tools/execute`, TUI verify-only); §5 re-numbered with H1b/H2b/H2c; §6 w2 re-scoped, w7 rewritten, w8 edge + re-sequence note; new §8 arithmetic; §9 W-2 resolved-record, W-6 settled, **W-8/W-9 added** | the decisions-scoped dossier `HOST-AND-PLUGIN-SEAMS.md` measured the halt mass-cancel, the three-file knob wrinkle, the read-only PRE hook and the seen/unread gap |
