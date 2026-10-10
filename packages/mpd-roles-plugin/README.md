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
- `mpd_roles_list` — the roster, one line per role: name, route, and what it does.
- `mpd_role_spawn` — one-shot consult: spawn one role as a subagent (roster
  persona + route + write-deny toolFilter for read-only roles). The spawned
  subagent is **labelled with the role's name** (`Architect`,
  `Deep Worker`), never with `role-<id>-<random>`.
- `mpd_role_persona` — fetch the persona text for spawn surfaces that take
  persona as text (the official Agent Teams `spawn_teammate` takes it as the
  teammate's `prompt`).

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
are not named in the `mpd:roster` section below. They stay fully usable: one-shot through
`mpd_role_spawn`, as a **workmate BASE template**, and a Lead that knows one can still stage
it with `spawn_teammate` by passing its `mpd_role_persona` text.

## Team mode

Multi-member team work is NOT built here: **staging** runs on the mpd plan plane (`agent_teams_plan`,
owned by `mpd-team-core-plugin`) and the members themselves ride the **official Agent Teams plugin**
(`@deepseek-ai/dsh-experimental-agent-team` + `-tool-agent-team` + `-client-ui-agent-team`,
mounted by this bundle's `mpd-agent-team` / `mpd-tool-agent-team` / `mpd-ui-agent-team` rows),
whose Lead creates teammates with `spawn_teammate` and opens their lanes with `team_task_create`.
This row contributes the ROSTER side of that path — every call through `mpd-dsh-adapter`:

| Contract | How this row implements it |
|---|---|
| the roster reaches the Lead | an **AGENT-SCOPED** `mpd:roster` system-prompt section (order `605`, immediately after the harness's `TEAM_POLICY` at 600), registered for a top-level `mpd` session only — never host-plane (that would inject the roster into every session this process serves), never a teammate's or another preset's session |
| a teammate's persona | the section names `spawn_teammate` and `mpd_role_persona`: the Lead passes the member's persona text as the prompt |
| a READ-ONLY teammate's discipline | a TOOL GUARD (below), registered through the adapter |
| the session-start complexity gate | an `agent/pre-step` listener that STAGES an approvable plan shell by default (below) |

**Model routing stays on the one-shot path.** `TeamService` forwards only `{prompt, parent}`
to `ctx.subagents.startContinuable` (`docs/plan-0.1.7-adaptation.md` §3), so a teammate
inherits the Lead's route and no provider/persona/tool filter can be attached to it. The
`teamModels.slot*` routes therefore apply to `mpd_role_spawn` / `mpd_workmate_spawn` (which
pass explicit `agentOptions`), and the roster section says exactly that instead of promising
a route the harness cannot deliver.

### A read-only teammate is denied mechanically

The seven-name deny list is enforced on BOTH paths, from ONE exported constant
(`READONLY_DENY`), so the two can never drift:

- **one-shot** — `mpd_role_spawn` passes `toolFilter: { deny: READONLY_DENY }` (unchanged);
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

### The delegation gate (the official spawn tools are not the delegation path)

`delegation-gate.ts` registers ONE `tools.guard` callback through the adapter: a call to `subagent`,
`subagent_fork` or `workflow` is REFUSED with a sentence that names the sanctioned routes
(`mpd_role_spawn`, `mpd_workmate_match` + `mpd_workmate_spawn`, Agent Teams, `send_message`). The knob
is `delegation.gate` in `mpd.jsonc`:

- **deny** (default) — the captain AND every member session are refused, because an escape hatch a
  member can still use is not a discipline;
- **captain** — only the workspace's TOP-LEVEL session is refused;
- **allow** — the gate is released entirely.

The gate is keyed on §5's PRESET-FREE session rank, so it holds for every session in a workspace that
mounts this bundle, whatever preset the profile assigned. Preset-plane omission is deliberately NOT
used: the live top-level session on this deployment runs a preset this bundle does not own (`cordis`),
so a guard is the portable denial and mounting the bundle is the opt-in. The row's boot line reports
`delegationGate=<mode>` (or `delegationGate=absent reason=…` when the harness exposes no `tools.guard`
seam).

**Honest bound:** the guard reads the TOOL CALL at dispatch, so a tool the roster never publishes is
trivially covered, while a session on a profile WITHOUT this bundle mounted has no gate at all — and it
cannot stop a model from TRYING another tool.

The `mpd` preset's persona carries a short STANDING WORKING DISCIPLINE list (close a hypothesis
repeated twice, inspection tool over speculation, next operation only, concurrent independent calls,
ephemeral shell calls, verify against actual output, YAGNI/PDCA) adapted from `dsh-liangshen`
(Apache-2.0) — ideas only, no upstream bytes ship.

### The session-start complexity gate (mechanical by default)

At a session's first pre-step the row evaluates the frozen predicate

```
trigger = explicit flag OR (matchedSignals >= 1)
```

with signals **A** (`team:` prefix or `!team`; the marker is CONSUMED from the goal text),
**B** (≥ 4 distinct deliverable verbs), **C** (ONE signal, fired by ≥ 2 of its three
sub-signals: ≥ 3 enumerated lines, ≥ 3 distinct action verbs, ≥ 3 action clauses) and **D** (an
ACTIVE boulder work exists for the session workspace: `status: "active"` in `.mpd/boulder.json` —
a plan FILE alone is NOT a signal, repaired 2026-10-07 because the retired plan-file probe fired
in every session of this workspace). Every notice carries the marker
`[AgentTeams] Session-start team rule`.

What a trigger DOES is selected per call by `team.gate` in `mpd.jsonc`: `mechanical` (the default)
| `advisory` | `off`.

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