# mpd-bundle
**English** | [中文](./README.zh-CN.md)

DSH bundle aggregation package: `cordis.patch.yml` mounts every mpd-dsh plugin row —
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
The specialists exist as a subagent roster (`mpd-roles-plugin`), not as presets.

## Session-start team gate (binding)

A session starts with **NO team** — a team is not a precondition of a session
(upstream parity: the upstream team mode ships disabled by default). What is enforced
mechanically by the adopted agent-teams plugin is a **complexity gate**
(`sessionTeamPolicy` config, implementation in
`packages/mpd-agent-teams-plugin/lib/session-start.js`), not prompt guidance alone:

- `mode: off` (the default) means "no auto-provision and no unconditional notice".
  The decoupled mechanical gate is `autoRoute: true` (default enabled).
- At the session's first pre-step the gate evaluates
  `trigger = (matchedSignals >= 2) OR explicit flag`:
  the explicit flag is a `team:` prefix or `!team` (the marker is consumed, so it
  never reaches the model as goal text), and the soft signals are
  (B) ≥4 distinct deliverable verbs, (C) ≥3 enumerated steps / action verbs /
  clauses, (D) a `.mpd/plans/*.md` artifact for this workspace.
- **Not triggered** → the session runs solo; no team, no notice.
- **Triggered** → the staged default team **"MPD Default"** (profile `mpd`,
  `approval: required` — members are only roster rows and spawn after the user
  reviews and approves the Web plan) is provisioned, and exactly one startup
  notice is injected saying the session was routed by the gate (never that a team
  is mandatory). A session that already has a team (resume) simply stays in it.
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