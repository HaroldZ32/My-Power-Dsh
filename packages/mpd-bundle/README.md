# mpd-bundle
**English** | [中文](./README.zh-CN.md)

The bundle's host-plane patch layer is `cordis.patch.yml`, and it sits at the **repository ROOT**
(the standard cordis bundle layout — `package.json` declares it as the first
`dsh.bundle.patch` entry). It mounts every mpd-dsh plugin row —
MCP servers (ast-grep / git-bash / lsp / codegraph + the remote context7 / grep.app rows),
the B/C-line plugins (mpd-config first so the mpdConfig service is visible to the rows
below, then mpd-dsh-adapter / mpd-tools / modelchain / roles / ulw / hashline /
boulder / comment-checker / codegraph / memory / workmate), the bundle's OWN team plane
(`mpd-team-core` / `mpd-team-watchdog` / `mpd-team-compact`), the `mpd-web-compat` self-row
(`name: '@mpd-dsh/mpd'` — the loader entry that carries the bundle's web client),
mpd-bootstrap provisioning, and the THREE official Agent Teams rows (`mpd-agent-team`,
`mpd-tool-agent-team`, `mpd-ui-agent-team`, plus the `mpd-roster-provider` row the tool row points
at). The vendored `agent-teams` body is **NOT mounted** — no loader row names
`packages/mpd-agent-teams-plugin` any more.

The waveform-read rows (`mcp-wave-mcp` / `mcp-traceweave`) are **not mounted**: they wrap
external Python MCP servers and stay commented out in `cordis.patch.yml:92-123` together
with their install steps, so a machine without those binaries boots unchanged.

The bundle ships ONE preset (`mpd`, the main working agent), declared as the **`preset-mpd` ROW** in
`presets/mpd.patch.yml` — the second entry of `dsh.bundle.patch`: it configures `dsh-agent-instructions`
with `instructionFileCandidates: [AGENT.md, AGENTS.md, CLAUDE.md]` so every project
session attempts to read AGENT.md, and it declares native tool presentation. (The retired
preset-DIRECTORY form under `packages/mpd-bootstrap-plugin/presets/` does not exist any more: the
harness 0.1.7-rc.2 preset model is one row per preset, carrying the child list inline.) The
specialists exist as a subagent roster (`mpd-roles-plugin`), not as presets.

## Session-start team gate (binding)

A session starts with **NO team** — a team is not a precondition of a session. The frozen predicate is
evaluated at the session's first pre-step and enforced mechanically by `mpd-roles-plugin` on the
official plugin's seams:

```
trigger = explicit flag OR (matchedSignals >= 1)
```

- The explicit flag (**A**) is a `team:` prefix or a token-boundary `!team`; the marker is CONSUMED, so
  it never reaches the model as goal text.
- The soft signals are (**B**) ≥ 4 distinct deliverable verbs, (**C**) ONE signal satisfied by 2 of its
  3 sub-signals (≥ 3 enumerated lines, ≥ 3 distinct action verbs, ≥ 3 action clauses), and (**D**) an
  ACTIVE boulder work for the session workspace (`status: "active"` in `.mpd/boulder.json`) — a plan
  FILE alone is NOT a signal (the retired plan-file probe fired in every session of this workspace).
- **Not triggered** → the session runs solo; no team, no notice.

`team.gate` in `mpd.jsonc` selects what a TRIGGER does, resolved PER CALL: `mechanical` (the default) |
`advisory` | `off`.

- **mechanical** → the gate STAGES an APPROVABLE PLAN SHELL through the bundle's OWN `agent_teams_plan`
  tool — 0 members, 0 tasks, `approval: required` — and injects exactly ONE notice carrying the marker
  `[AgentTeams] Session-start team rule`, naming the plan id the call RETURNED. **NOTHING is spawned**:
  the shell is INERT until the captain extends it (`add_member` / `create_task`, each member's prompt
  from `mpd_role_persona`) and approves it with `agent_teams_plan {action:"approve"}` — approval is what
  materialises the team record and raises the members through the bundle's NATIVE executor. While a plan
  is already staged for that session the gate says so and does not stage a second one (a second staging
  would archive the in-progress plan).
- **advisory** — also the effective behaviour when `agent_teams_plan` is not mounted — the ONE notice
  says `NO team was staged`, and the captain stages the team itself when the work warrants it.
- **off** → the listener returns immediately.

An explicit `team:` / `!team` request is signal **A** and travels the SAME route (under `mechanical` it
stages the shell too). The gate is scoped to top-level `mpd` sessions — a subagent/member session
(`parentSession` set) never qualifies, and neither does another preset's session — settles once per
session, and a failure inside it leaves the step untouched. The `mpd` preset persona carries the
matching SESSION STARTUP RULE, so the captain behaves correctly whether or not the gate fired.

**RETIRED — kept as history, not as configuration.** This section used to document the vendored
`agent-teams` plugin's `sessionTeamPolicy` / `autoRoute` knobs, its provisioned **"MPD Default"** team
staged by `agent_teams_create(approval="required", profile="mpd")`, and its `mode: auto | instruct`
opt-ins. No loader row mounts that plugin any more, and none of those keys, tools or that staged-team
flow exists in a shipped session.

## Configuration plane

The team plane's own configuration is the gate's key plus the rows' own:

- `team.gate` — `mechanical` (default) | `advisory` | `off`, read PER CALL by `mpd-roles-plugin`.
- The official `mpd-agent-team` row carries its limits from the patch: `maxMembers: 16`,
  `maxTasks: 256`, `maxPendingMessagesPerMember: 64`, `maxMessageBytes: 32768`,
  `disposalTimeoutMs: 5000`.
- `mpd-team-core` owns the team record under `<workspace>/.mpd/team/`: `teams/<id>.json`, the
  `staging/<sessionId>.json` slot a staged plan lives in, and the archived plans.

The retired vendored row's upstream-aligned limits (`maxParallelMembers`, `maxMessagesPerRun`,
`maxWallClockMinutes`, `maxMemberTurns`, `messagePayloadMaxBytes`, `recipientUnreadMaxBytes`,
`mailboxPollIntervalMs`, `memberMaxDepth`, `stateDir`, `enforcement`) are HISTORY: they exist only in
`packages/mpd-agent-teams-plugin/lib/index.ts`, which no row mounts.

## TUI composition

The same patch also composes the TUI edition: the `mpd-tui` row mounts
`@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js` (that package ships no patch of its own, so
this row is the only mount and no composition can duplicate the loader entry id).

Preset selection has **TWO** id-targets, one per plane, both naming the same package with
`config.default: mpd`:
- `agent-preset-registry` — the row `dsh-web-app` inserts for the web/base composition;
- `dsh-tui-agent-preset-registry` — the SCOPED row `dsh-tui` mints for its own composition.

The second is not redundant: a `dsh-tui` profile composes no `dsh-web-app` layer, so the first
target is skipped there (`patch: entry agent-preset-registry not found`) and the TUI's own row would
keep `default: standard` — while nothing in that composition declares a `standard` preset
(`@deepseek-harness-tui/dsh-tui@0.12.0` declares no `@deepseek-ai/dsh-agent-preset` row at all —
measured 2026-10-02: its own scoped registry row still carries `default: standard`, while the only
preset directory that release ships is `presets/liangshen/`), so every new TUI session would ask
for a preset that does not exist. Each id exists in exactly ONE composition, so the other profile
only logs a not-found warning and applies nothing; an id-target assigns only the keys this file
carries and skips `id`, so the TUI row's own compiled-DISABLED expression survives untouched.
Harness 0.1.7-rc.2 removed the preset-ROOT rows this file used to target (`agent-presets` /
`dsh-tui-agent-presets`, both naming the deleted `@deepseek-ai/dsh-agent-presets` package).
A composition that carries no such row — the headless profile, or a `dsh-tui` plane that mints a
differently-named registry row — logs `patch: entry agent-preset-registry not found` and keeps its
own default; the `mpd` preset itself is declared by the second patch file
(`presets/mpd.patch.yml`, row `preset-mpd`), which no composition has to opt into separately.