# mpd-roles-plugin
**English** | [中文](./README.zh-CN.md)

The specialists exist as a **specialist roster**, not as standalone presets.
Each role is addressed by its **name** and described by what it does; it also carries
a persona text (`personas/<internal-key>.md`), a DeepSeek model chain and its
read-only discipline.

| role (what it does) | readonly |
| --- | --- |
| Architect — architecture review, deep debugging, self-review | yes |
| Researcher — evidence-based code/open-source search | yes |
| Planner — produces `.mpd/plans` plans, never implements | yes |
| Deep Worker — executes goals end-to-end with tools | no |
| Senior Engineer — primary implementation and verification | no |
| Lead — orchestration, delegation, integration | no |
| Explorer — read-only codebase search and location | yes |
| Reviewer — correctness/risk findings, no fixes | no |
| Plan Reviewer — plan executability and reference review | yes |
| Vision Analyst — image/screenshot/PDF analysis | yes |
| Junior Engineer — fast, well-scoped execution | no |

## Surface

- `mpdRoles` service (`ctx.get("mpdRoles")`): `list()` / `get(key)` — consumed by
  `mpd-modelchain-plugin` (chain lookup).
- `mpdConsults` service (`ctx.get("mpdConsults")`): `start` / `list` / `wait` / `settle` / `collect` /
  `cancel` — the SAME consult supervisor the tools below use, published as a cordis SERVICE so a bounded
  plane outside this package (cellwork's `cellwork_delegate` / `cellwork_consult` / batch
  `cellwork_recon`) can start and settle background consults without a relative import into this row.
  ONE registry, ONE `MPD_DSH_CONSULT_MAX` cap and ONE silence deadman govern both surfaces; a start
  answers `{consultId, role, state:"running", startedAt}` at once and the role is canonicalised first. It
  adds no tool and appears in no tool list. **THE ONE BEHAVIOURAL DIFFERENCE:** `start` does NOT apply
  `consultDepthRefusal` — that floor belongs to the TOOL handlers, while this service is called by a
  plane that owns its own cap (`cellwork.depthMax`, forwarded as the absolute `maxDepth`); persona,
  route, fallback, cap, deadman and the read-only child scope are identical because the raise lands on
  the same internal path.
- `mpd_roles_list` — the roster, one line per role: name, route, and what it does.
- `mpd_role_spawn` — ONE-SHOT single-call consult: one bounded delegation with one role, one report.
  The child (roster persona + route + write-deny toolFilter for read-only roles) is **labelled with
  the role's name** (`Architect`, `Deep Worker`), never with `role-<id>-<random>`. On a host that
  exposes `startActivation` the adapter disposes the activation once the report settles — the retired
  `start` fallback has NO activation to dispose — so either way the consult is **not reused**: ask a
  NEW question with a NEW spawn. (The harness catalog is append-only, so a settled child may still list
  as `inactive`; the contract is one-shot regardless.) `mpd_workmate_spawn` is the same one-shot spawn
  mechanics for a durable, evolving instance — the RECORD's persona/memory/note carry continuity, not
  the child session; team work is the mpd plan plane (`agent_teams_plan`), never the official
  `spawn_teammate`, which the team door guard refuses. **A CONSULT IS A LEAF, enforced two ways.** (1)
  The child's OWN tool scope denies both bundle spawn tools (`mpd_role_spawn`, `mpd_workmate_spawn`), so a
  consult can never delegate again — read-only or not — and can never raise its own depth cap; the deny
  list is separate from the roster's read-only list and pinned equal in the workmate row by a test. (2) A
  caller already at delegation depth **2 or deeper** is REFUSED outright with a teaching sentence (do the
  work here, or hand the question up), while depth `0` and `1` stay open: the captain raises its consults
  (0 → 1), and a cell PLANNER — a team member at depth 1, not a child of these tools — keeps the
  `mpd_role_spawn` route, its consult landing at depth 2 as a leaf. `mpd_role_spawn` also forwards
  `maxDepth` = the caller's recorded depth + 1, so the host's own depth default can never refuse that leaf.
  A caller with no recorded depth reads as depth `0`; a session the harness recorded `origin:"subagent"`
  WITHOUT a depth reads as depth `1` (a CHILD). `mpd_workmate_spawn` reads the header identically and a
  test compares both helpers on every header shape. `cellwork_recon` is EXEMPT from the depth floor — its
  own child depth is bounded by `cellwork.depthMax` — and a cellwork VERIFIER seat is refused both spawn
  tools as well: the verdict is its own work, and a FAIL is the channel back to the writer.
- `mpd_role_persona` — fetch the persona text for spawn surfaces that take
  persona as text (a teammate staged with `agent_teams_plan` `add_member` takes it as
  the member's `prompt`; `spawn_teammate` itself is refused at the tool boundary).
- `mpdQuestions` service (`ctx.get("mpdQuestions")`): `list({ sessionId? })` / `answer({ id, answers })` —
  the question relay's parking lot, consumed by the DSH Go panel. It is provided ONLY when the row
  really registered the harness `user-questions/request` waterfall answerer; a composition without that
  seam stays inert and reports `questions=absent reason=…` on the boot line.
- The QUESTION RELAY — `ask_user_question` answered from a client with no DSH surface attached:
  `GET /plugins/mpd-roles/questions?sessionId=` returns `{ ok: true, pending }`, and
  `POST /plugins/mpd-roles/questions/answer` with `{ id, answers: [{ id, selected, custom? }] }` returns
  `{ ok: true, answered: true }` (404 for an unknown id, 400 when the batch breaks a relay rule below
  or the body is malformed, 413 above the 64 KiB cap). `selected` entries are option LABELS, never
  indices. Both routes take the host request fence first and answer `no-store` JSON; the relay awaits the downstream answerer first,
  parks only a `NO_PROVIDER` rejection and only while a client has polled within `attachWindowMs`, and an
  unanswered question rethrows that original error after `ttlMs` (120 s default, capacity 16).
  **THE REPLY IT RETURNS TO THE HARNESS IS THE ENVELOPE** `{ answers: [...] }`, never a bare array: the
  parking lot itself holds a `DshQuestionAnswer[]`, and only the waterfall reply wraps it — a downstream
  envelope is returned by identity, and every failure path (ttl, eviction, abort, dispose) still rejects
  with the original error rather than an invented empty envelope.
  **A BATCH MUST COVER THE REQUEST.** `answers` carries exactly ONE entry per parked question item; a
  missing item, a duplicate question id, or an id this request never carried refuses the WHOLE batch
  (400, and the service's `answer` returns `false`) while the question STAYS PARKED for a retry — a
  half-answered request would otherwise settle the model's tool call with the other question
  unanswered. A question that is not `multiSelect: true` accepts at most one label; an empty `selected`
  plus `custom` is still a legitimate "skipped"/free-text answer. The refusal's one-line reason names
  the rule that failed and never echoes the submitted ids or labels.
  **CONSEQUENCE, NOT A WORKAROUND:** the DSH Go panel renders only the FIRST question item, so a
  question set with more than one item cannot be answered from the panel at all — unless a client that
  renders (and submits) every item answers it, the request stays parked until it expires.
  **NO LIFETIME OWNER IS REPORTED, NOT HIDDEN:** when the ctx exposes no `effect` seam the boot token
  reads `questions=relay routes=N lifetime=unowned` and ONE warning line says the waterfall answerer
  and its routes are never disposed; with an `effect` seam the token is unchanged and teardown disposes
  both.

**One vocabulary for both surfaces (name unification).** The role's name is its
identity: it is the member name agent-teams stages in team mode, and it is the label a
solo `mpd_role_spawn` produces. Address a role by that name in any spelling —
`Architect`, `architect`, `Deep Worker`, `deep-worker`, `deepworker`,
`Plan Reviewer` (case-, space-, hyphen- and underscore-insensitive). No surface
advertises an upstream alias: a role is described by what it does.

*Internal keys (never tool input):* the stable internal keys — the chain keys used by
`mpd-modelchain-plugin` and by `personas/<key>.md` (`oracle`, `sisyphus-junior`, …), the
camelCase spellings (`sisyphusJunior`) and the legacy `mpd-<key>` form — stay resolvable on
the **service path** (`ctx.get("mpdRoles").get(key)`), so existing chains and internal
callers keep working. They are **refused as tool input**: `mpd_role_spawn`,
`mpd_role_persona` and `mpd_modelchain_resolve` accept a NAME spelling only and answer a
loud error that lists the roster names — it never repeats the rejected key, and an id is
never returned, listed or required. The **workmate library behaves the same way**:
`mpd_workmate_init` matches the functional NAME only (a stable id is refused with a
names-only error), and `meta.baseId` is kept purely as internal provenance that no tool
output, route or GUI exposes.

`ctx.get("mpdRoles").get(key)` still uses that same resolution — it is the INTERNAL path.
The tool-facing path accepts NAME spellings only, so `mpd_modelchain_resolve`, the roster
tools and the workmate library (`mpd_workmate_init base=...`) all address a role by name.

### Native tool cards (dsh-Go)

`mpd_roles_list` and `mpd_role_spawn` carry `output.presentationMeta`, so the dsh-Go app draws them
as a **native card** in the chat log instead of a generic tool row: the roster table (name, route,
read-only/writes) plus any refused extension for the list tool; the role, its status metric and the
bounded report sections for the spawn tool. Each card is a **v1** view tree (`stack` with a title,
then metrics, `keyValue`, tables and short text) with **no `$` binding, no `actions` and no `style`
key** — a chat-log entry has no data model and no action channel, and an older app must still be able
to draw it. `toolCard()` from `packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts` is the seam: a
failed build, a v2 component or a tree over **8 KiB / 40 nodes / depth 6** degrades to `{}` and the
app falls back to its generic row, so a card can never break a tool call. The builders are pure
functions in `src/tool-cards.ts`, and the unit test runs them through the SAME wrapper the
registration uses.

## Extension-contributed roles

An `mpd-ext` extension may contribute roles. They are merged into this roster **per call**
(`ctx.get("mpdExtensions")`, resolved lazily at tool-execute time — never an apply-time
cache, so an extension row that applies later, or registers later, is still visible), and
they work on every surface a base role does:

- `mpd_roles_list` lists them with their owning extension (`extension: <extension-id>`), and
  `mpd_role_spawn` / `mpd_role_persona` address them by their declared name in any spelling
  (`Code Reviewer`, `code-reviewer`, `codereviewer`).
- A role the extension declares `readonly` spawns with the same write-deny toolFilter as the
  read-only base roles.
- The `mpdRoles` service serves them too, so they are usable as **workmate BASE templates**
  (`mpd_workmate_init base="Code Reviewer"`) and resolve through `mpd_modelchain_resolve`
  when the extension declared a `provider` + `model` pair.
- The stable id is namespaced (`ext-<extension-id>-<slug of the name>`), so it can never
  collide with a base id.

Refusals are loud and isolated: a role whose name is already taken by a base role or by
another extension is reported in `mpd_roles_list`'s `refused` list and logged once — it never
takes the roster, or the boot, down. A role whose persona file is unreadable is refused the
same way, and an extension that is disabled by config contributes no role at all.

**Honoured limit — the roster SECTION lists the BASE roster only.** Extension-contributed
roles are resolved per call from `mpdExtensions`, not when an agent scope is created, so they
are not named in the `mpd:roster` section below. They stay fully usable: single-call consult through
`mpd_role_spawn`, as a **workmate BASE template**, and a Lead that knows one can still stage
it with `agent_teams_plan` `add_member` by passing its `mpd_role_persona` text as the prompt.

## Team mode

Multi-member team work is NOT built here: **staging** runs on the mpd plan plane (`agent_teams_plan`,
owned by `mpd-team-core-plugin`) and the members themselves ride the **official Agent Teams plugin**
(`@deepseek-ai/dsh-experimental-agent-team` + `-tool-agent-team` + `-client-ui-agent-team`,
mounted by this bundle's `mpd-agent-team` / `mpd-tool-agent-team` / `mpd-ui-agent-team` rows),
whose Lead stages teammates and opens their lanes with `agent_teams_plan` (`add_member` /
`create_task`); the official `spawn_teammate` and `team_task_create` are REFUSED by the team door guard.
This row contributes the ROSTER side of that path — every call through `mpd-dsh-adapter`:

| Contract | How this row implements it |
|---|---|
| the roster reaches the Lead | an **AGENT-SCOPED** `mpd:roster` system-prompt section (order `605`, immediately after the harness's `TEAM_POLICY` at 600), registered for a top-level `mpd` session only — never host-plane (that would inject the roster into every session this process serves), never a teammate's or another preset's session |
| a teammate's persona | the section names `agent_teams_plan`'s `add_member` and `mpd_role_persona`: the Lead passes the member's persona text as the staged prompt |
| a READ-ONLY teammate's discipline | a TOOL GUARD (below), registered through the adapter |
| the session-start complexity gate | an `agent/pre-step` listener that STAGES an approvable plan shell when `team.gate` says `mechanical` — the DEFAULT again since 2026-10-20 (below) |

**Model routing comes from each member's OWN `agentRoutes` entry, by member identity.** The native team
executor resolves a staged member's route by identity precedence — the member's `role` first, then
the head of its `description`, then its whole `name` (`agent_teams_plan` forwards `role`, and the
descriptor label still carries the description; `docs/plan-0.1.7-adaptation.md` §3). The TEAM path
never refuses: a member whose identity matches nothing, a member with no usable route, and a
composition without `mpdConfig` all INHERIT the staging session's model route (the captain's in a
top-level spawn, the Lead's in a team-lead spawn), with exactly ONE log line and never a throw —
`approve` is a batch raise of N members in a loop, so a route must never leave a team half-built.
Prompt text cannot change a route. On the official-executor fallback,
`mpd-roster-provider-plugin` applies — or refuses with `AGENT_UNCONFIGURED` before it starts — the same
per-agent route from the description label, on its OWN path
(`packages/mpd-roster-provider-plugin/README.md`).
The same `agentRoutes` entries also apply to the single-call appliers `mpd_role_spawn` /
`mpd_workmate_spawn`, which pass explicit `agentOptions`; the roster section says exactly that. On the
native team path (`approve`) the route never refuses; ONLY those single-call appliers refuse, and only
for a BASE roster member: there is no persisted slot (the four groups are only the `/mpd-model`
bulk-edit shortcut), and an unconfigured or malformed route refuses with the structured
`AGENT_UNCONFIGURED` failure the config row builds — naming the agent, the missing leaves and both
recovery paths — so no child is ever started on an invented route. An EXTENSION-contributed role is
`unrouted` instead and still spawns on its own declared chain. The agent's own `fallbacks` chain is
consumed once before the spawn (the first catalog-POSITIVE candidate wins), and the winning route's
effort is passed through the adapter's `withSupportedEffort` (`mpd-dsh-adapter-plugin`), so a model
declaring NO reasoning efforts at all is sent none — the spawn runs instead of failing on a keyword
the provider cannot accept — while a model that declares efforts keeps the configured keyword.

### A read-only teammate is denied mechanically

The ten-name deny list is enforced on BOTH paths, from ONE exported constant
(`READONLY_DENY`), so the two can never drift:

- **single-call consult** — `mpd_role_spawn` passes `toolFilter: { deny: READONLY_DENY }` (unchanged);
- **team** — a tool guard resolves the CALLING agent's team membership through the adapter
  (`dsh.teamMembership(exec.agent)`) and denies any name in the list when the membership is
  role `teammate` AND its model-facing name normalises (lowercase, every run of
  non-alphanumerics → `-`, one optional trailing `-<digits>` team suffix) to a READ-ONLY
  roster member. The denial names the member and the rule, and points at the Lead or a worker
  member. The Lead, a worker member, a non-team agent and an unresolvable membership all pass
  through untouched; the guard never throws, never mutates and never widens.

This closes the measured defect of the retired profile-carried `toolDeny`: a teammate staged
as "Explorer" without the filter kept `write`/`edit`/`bash`.

**The deny list is pruned by the HARNESS, once, before the spawn.** `tools.restrict()` rejects the
WHOLE list when a single name is not registered in the profile, so one unregistered entry (the two
`mcp__lsp__*` names on a host without `cclsp`) killed EVERY read-only spawn of both the roster and the
workmate library — measured 2026-10-10, and that broken front door is what pushed the captain onto the
harness's generic `subagent` tool. The adapter's `restrictToolsTolerant` applies the CANONICAL list to
the calling agent's own scope and releases it in the same synchronous turn, so the harness's own
verdict is the only pruner: the names it reports as unknown are pruned, exactly ONE retry is allowed,
and any second failure is rethrown. `READONLY_DENY` itself is unchanged, the two packages' lists stay
identical (asserted by `roles.test.ts`), and the list is still NEVER pre-filtered with a `hasTool`
probe (AGENTS.md §13). A pruned name is reported once on the row's log.

### The delegation gate and the reconnaissance guard (RESTORED 2026-10-20)

This row installs TWO `tools.guard` callbacks beside the read-only one: a **captain-investigation guard**
(the `mpd` preset's top-level session DELEGATES reconnaissance, so `read`/`grep`/`glob` on a SOURCE path
are refused while the documentation band stays readable — `.mpd/**`, `docs/**`, `evidence/**`,
`agent-references/**`; ANY `AGENT.md`/`AGENTS.md`/`CLAUDE.md` by BASENAME at any depth, inside this
workspace OR outside its root, because a sibling project's instruction file is the motivating read; and
at the workspace root ONLY `README.md`, `README.zh-CN.md`, `CHANGELOG.md` and `LICENSE*.md` — those two
README spellings exactly, since there is no `README*` glob. A path is judged by its SPELLING (symlinks
are never resolved), and a `..` segment is admitted ONLY when the basename is one of the three
instruction files; every other `..` stays refused. The refusal text advertises that whole band, so a
reader learns the true boundary instead of a shorter one; knob `captain.investigation`, `"deny"` default
| `"allow"`) and a **delegation gate** (a call to `subagent`, `subagent_fork` or `workflow` is refused
with a sentence naming `mpd_role_spawn`, the workmate library, Agent Teams and `send_message` — with
the qualifier that `send_message` continues only an EXISTING TEAM child, never a finished consult
(consults are one-shot); knob `delegation.gate`, `"deny"` default | `"captain"` | `"allow"`).

**The CELL PLANNER inherits the same band, and its reconnaissance is delegated too.** A cellwork seat
named `cell-planner` is refused `read`/`grep`/`glob` on a source path; the refusal names the two
delegation routes — `cellwork_recon` with `Explorer`/`Researcher`, or `mpd_role_spawn` with a read-only
roster role — and the cellwork plugin imports the same three band lists, pinned by a parity test that
imports both modules (no runtime cross-package import). The planner's instantiation prompt carries the
guidance verbatim (`PLANNER_RECON_LINES`, spliced by the cellwork plugin), so the rule is read before the
first interview question; the guard is what enforces it.

**The delegation gate's preset exemption is TOP-LEVEL ONLY.** A top-level session of another preset (the
deployment default `cordis` included) keeps its own spawn habits, while MEMBER AND CHILD sessions stay
covered WHATEVER preset they run — their delegation belongs to the captain's path, and a child's preset
must not re-open the official spawn tools. The investigation guard is scoped by `sessionIsMpdCaptain`
(top-level AND the `mpd` preset), so it never applies to another preset's session at any rank. The gate
is keyed on the preset-free `sessionRank`, and its mode picks coverage inside that scope: `deny` (the
default) covers the `mpd` preset's top-level session plus every member/child/headerless session,
`captain` limits the rule to the top-level session, and `allow` releases it entirely.

WHY THEY CAME BACK. The 2026-10-17 ruling withdrew both together with the persona restoration ("one
agent, its whole tool pack, steered by the persona prompt"). The measured consequence: the captain did
every search itself, the roster/team tools went unused, and the session's context inflated one file read
at a time. The 2026-10-20 ruling split that bundle — the LONG PROMPT stays, the two DECISIONAL guards
return — and the persona now leads with the rule, so the first move is delegation rather than a refused
`read`. The write path is deliberately UNCHANGED: `write`/`edit`/`bash` are not gated and the
verification law's write guard (`verify.mode`) stays withdrawn; what the law asks for is a DIFFERENT
agent's recorded verdict, which is a discipline, not a hook.

The diagnostic is the boot line — the restored guards report their MODE, the withdrawn one its absence:

```
[mpd-roles] team plane: readOnlyGuard=installed deny=10   captainInvestigation=deny   delegationGate=deny   verifyGate=absent reason=withdrawn:2026-10-17-user-ruling(verify.mode)   askUserQuestion=installed rosterSection=agent-scoped order=605 sessionGate=mechanical
```

The restore is recorded in `.mpd/plans/restore-guard-discipline.md`; the QA cases that assert it are
`skills/dsh-qa/scripts/delegation-gate.ts` (refusal table, knob spellings, the roster front door) and
`skills/dsh-qa/scripts/captain-scope.ts` (the boot-line tokens, the shipped apply site, the persona).

### The session-start complexity gate (MECHANICAL by default again since 2026-10-20)

At a session's first pre-step the row evaluates the frozen predicate

```
trigger = explicit flag OR (matchedSignals >= 1)
```

with signals **A** (`team:` prefix or `!team`; the marker is CONSUMED from the goal text),
**B** (distinct deliverable verbs — the bound is per sensitivity row), **C** (ONE signal, fired by
enough of its three sub-signals: enumerated lines, distinct action verbs, action clauses), **D** (an
ACTIVE boulder work exists for the session workspace: `status: "active"` in `.mpd/boulder.json` —
a plan FILE alone is NOT a signal, repaired 2026-10-07 because the retired plan-file probe fired
in every session of this workspace), **E** (a CJK-scale instruction: Han characters AND distinct
action verbs, the lexicon carrying the delivery vocabulary a Chinese instruction actually uses) and
**F** (WORKSPACE SCALE: one bounded root listing finds a project manifest, a project directory and
at least 8 visible entries — evaluated on the `easy` row only). Every notice carries the marker
`[AgentTeams] Session-start team rule`.

`team.sensitivity` in `mpd.jsonc` selects the threshold row (`easy` — the DEFAULT — | `normal` |
`strict`); `normal` reproduces the pre-2026-10-22 predicate exactly — the same numbers AND the
pre-wave verb lexicons (the wave's new English and CJK verbs are invisible on that row) — and an
absent or unknown value reads `easy` (the gate never throws on configuration):

| sensitivity | B distinct verbs | C lines / verbs / clauses | E Han chars / verbs | F workspace scale |
|---|---|---|---|---|
| `easy` (default) | ≥ 2 | ≥ 2 / ≥ 2 / ≥ 2 (2-of-3) | ≥ 24 / ≥ 2 | on |
| `normal` | ≥ 4 | ≥ 3 / ≥ 3 / ≥ 3 (2-of-3) | ≥ 60 / ≥ 2 | off |
| `strict` | ≥ 6 | ≥ 4 / ≥ 4 / ≥ 4 (3-of-3) | ≥ 80 / ≥ 3 | off |

What a trigger DOES is selected per call by `team.gate` in `mpd.jsonc`: `mechanical` (**the DEFAULT since the
2026-10-20 restore**) | `advisory` | `off`.

- **mechanical** — the gate STAGES an APPROVABLE PLAN SHELL through the `agent_teams_plan` tool
  (0 members, 0 tasks: at the first pre-step there is no decomposition yet) and injects ONE
  user-role notice naming the plan id the call RETURNED. NOTHING is spawned: the plan is INERT
  until the captain extends it (`add_member` / `create_task`) and approves it with
  `agent_teams_plan {action:"approve"}`, which is what spawns the members and posts the tasks.
  While a plan for this session is already staged the gate reports that and stages nothing more —
  a second staging would archive the in-progress plan.
- **advisory** — without the `agent_teams_plan` tool mounted, or under `team.gate: "advisory"`, the
  ONE notice says `NO team was staged` and tells the captain to stage one itself at the moment the
  work warrants it.
- **off** — the listener returns immediately.

An explicit `team:` / `!team` request is signal **A** and travels the SAME route: under
`mechanical` it stages the shell too, and the marker is CONSUMED from the goal text. It is scoped
to top-level `mpd` sessions (a child session — subagent, teammate, workflow worker — and another
preset's session never get it), settles once per session, and a failure inside it leaves the step
untouched.

## Async consults and the consult deadman (2026-11-05, revised 2026-11-06)

`mpd_role_spawn` keeps its arguments and report shape, but its `status` may now also be
`"interrupted"`: every consult — blocking or background — is supervised.

| Tool | Behaviour |
|---|---|
| `mpd_role_spawn_async` | `{role, task, context?}` → `{consultId, role, state:"running"}` immediately; the child keeps running in the background. |
| `mpd_role_consult` | `list` (id, role, state, startedAt, elapsedMs); `wait` (`consultId`, `timeoutMs` ≤ 60 000 — the report when settled, `state:"running"` when not); `collect` (returns the settled report and releases it); `cancel` (interrupts that consult's child). |

Concurrency is capped by `MPD_DSH_CONSULT_MAX` (default `8`, the host's active-child limit): an
over-cap consult QUEUES and never throws. The cap is read per start.

**Deadman.** Every consult — blocking or background — is armed with a bound read at EVERY arm from
`consult.forceAfterMs`, falling back to `watchdog.forceAfterMs`, then `900000` ms. A declared `0`
disables the deadman, the same meaning `forceAfterMs` carries for the force supervisor. On expiry the
predicate is the force supervisor's, applied to this consult's own tool map:

- An OPEN `bash` call → NOT interrupted, at any age; one `consult-long-bash` record, then re-arm. This
  exemption has NO age bound — a legitimate verification run may take an hour.
- Any other OPEN tool younger than `watchdog.toolInFlightMaxMs` → activity; the deadman re-arms and
  records one `consult-tool-in-flight` line per open call.
- No open tool, or one past that bound → the supervisor writes
  `<ws>/.mpd/handoff/consult-<consultId>-<UTC instant>.md` (task, role, started, elapsed, the MEASURED
  idle duration that triggered the force, the last assistant message when the row observed one, the
  last tool calls with ≤ 400-character argument excerpts, a next step naming what to resume), then
  interrupts the child and settles the consult `status:"interrupted"` carrying the handoff path, the
  measured idle duration and the last observed activity.

The supervisor never interrupts the captain or another consult's child: it only ever calls its own
handle's `interrupt()`.

**Record lifetime.** A BACKGROUND consult is listed until it is collected or cancelled. A BLOCKING
`mpd_role_spawn` consult is listed while it runs and its record is released by its own caller the
moment the report (or the failure) has been read, so a long autoproject/cellwork session cannot grow
the registry.

**Read-only discipline.** The deny list is now TEN names: the eight write-capable tools plus
`mpd_role_spawn_async` and `mpd_role_consult` (`cancel` mutates another consult). A consult is still
a leaf: the child has the bundle's spawn tools denied in its own scope.
