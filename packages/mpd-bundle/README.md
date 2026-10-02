# mpd-bundle
**English** | [中文](./README.zh-CN.md)

The bundle's host-plane patch layer is `cordis.patch.yml`, and it sits at the **repository ROOT**
(the standard cordis bundle layout — `package.json` declares it as the first
`dsh.bundle.patch` entry). It mounts every mpd-dsh plugin row —
MCP servers (ast-grep / git-bash / lsp / codegraph + the remote context7 / grep.app rows),
the B/C-line plugins (mpd-config first so the mpdConfig service is visible to the rows
below, then mpd-dsh-adapter / mpd-tools / modelchain / roles / ulw / hashline /
boulder / comment-checker / codegraph / memory / workmate), the `mpd-web-compat` self-row
(`name: '@mpd-dsh/mpd'` — the loader entry that carries the bundle's web client),
mpd-bootstrap provisioning, and the adopted `agent-teams` row (`stateDir: .mpd/team`).

The waveform-read rows (`mcp-wave-mcp` / `mcp-traceweave`) are **not mounted**: they wrap
external Python MCP servers and stay commented out in `cordis.patch.yml:92-123` together
with their install steps, so a machine without those binaries boots unchanged.

The bundle ships ONE preset (`mpd`, the main working agent; assets under
`packages/mpd-bootstrap-plugin/presets/mpd`): it configures `dsh-agent-instructions`
with `instructionFileCandidates: [AGENT.md, AGENTS.md, CLAUDE.md]` so every project
session attempts to read AGENT.md, and it declares native tool presentation. The
specialists exist as a subagent roster (`mpd-roles-plugin`), not as presets.

## Session-start team gate (binding)

A session starts with **NO team** — a team is not a precondition of a session
(upstream parity: the upstream team mode ships disabled by default). What is enforced
mechanically by the adopted agent-teams plugin is an **advisory complexity gate**
(`sessionTeamPolicy` config, implementation in
`packages/mpd-agent-teams-plugin/lib/session-start.ts`), not prompt guidance alone:

- `mode: off` (the default) means "no auto-provision and no unconditional notice".
  The decoupled mechanical gate is `autoRoute: true` (default enabled).
- At the session's first pre-step the gate evaluates
  `trigger = explicit flag OR (matchedSignals >= 1)`:
  the explicit flag is a `team:` prefix or `!team` (the marker is consumed, so it
  never reaches the model as goal text), and the soft signals are
  (B) ≥4 distinct deliverable verbs, (C) ≥3 enumerated steps / action verbs /
  clauses, (D) a `.mpd/plans/*.md` artifact for this workspace.
- **Not triggered** → the session runs solo; no team, no notice.
- **Triggered by a soft signal** → the gate **stages nothing**: it injects exactly one
  advisory notice carrying the marker `[AgentTeams] Session-start team rule`, naming the
  fired signals and stating that **no team was staged**. The captain stages one with
  `agent_teams_create(approval="required", profile="mpd")` at the moment the work
  actually warrants it, or continues solo and says so. A session that already has a team
  (resume) simply stays in it.
- **Explicit `team:` / `!team`** → provisioning is unchanged: the staged default team
  **"MPD Default"** (profile `mpd`, `approval: required` — members are only roster rows
  and spawn after the user reviews and approves the Web plan) is provisioned with the
  routed-by-the-gate notice. The `/agent-teams` command stages the same way.
- Scope: `presets: [mpd]` covers mpd-preset sessions plus sessions without any preset
  (headless direct runs); subagent/member sessions (`parentSession` set) never qualify.
- The gate runs on the PRE-STEP, **before** the preset's sizing doctrine, so the
  sizing rule can no longer appear only after a team already exists.
- The policy settles once per session: a team deleted mid-session is never recreated,
  and a team the captain creates afterwards is never fought over.
- The `mpd` preset persona carries the matching SESSION STARTUP RULE so the captain
  behaves correctly whether or not the gate fired.

Keep the legacy behaviour by opting in explicitly: `mode: auto` provisions the
default team unconditionally, and `mode: instruct` injects the instruction notice
without creating anything. Both values are preserved.

## Configuration plane

The row also carries the upstream-aligned limits (measured against the upstream
`team_mode`), all absent-safe and defaulting to the frozen local values:
`maxMembers: 16` (local ceiling kept), `maxParallelMembers: 8`,
`maxMessagesPerRun: 10000`, `maxWallClockMinutes: 120`, `maxMemberTurns: 500`,
`messagePayloadMaxBytes: 32768` (min 1024), `recipientUnreadMaxBytes: 262144`
(min 1024), `mailboxPollIntervalMs: 3000` (min 500), `memberMaxDepth: 1`,
`stateDir: .mpd/team`, and `enforcement: enforce` (over-limit sends are blocked;
`observe` logs only — the upstream semantics).

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