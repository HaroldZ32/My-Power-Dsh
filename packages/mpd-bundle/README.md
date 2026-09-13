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
OMO-origin agents exist as a subagent roster (`mpd-roles-plugin`), not as presets.

## Session-start team rule (binding)

Every qualifying session MUST begin inside a team — either the auto-provisioned
default team or one the captain creates. The rule is enforced mechanically by the
adopted agent-teams plugin (`sessionTeamPolicy` config, implementation in
`packages/mpd-agent-teams-plugin/lib/session-start.js`), not by prompt guidance alone:

- On the first step of a session that leads no team, `mode: auto` provisions the
  staged default team **"MPD Default"** (profile `mpd`, `approval: required` — members
  are only roster rows and spawn after the user reviews and approves the Web plan), and
  injects a startup notice into the conversation telling the captain the session runs
  through that team. A session that already has a team (resume) simply stays in it.
- Scope: `presets: [mpd]` covers mpd-preset sessions plus sessions without any preset
  (headless direct runs); subagent/member sessions (`parentSession` set) never qualify.
- The policy settles once per session: a team deleted mid-session is never recreated,
  and a team the captain creates afterwards is never fought over.
- The `mpd` preset persona carries the matching SESSION STARTUP RULE so the captain
  behaves as captain from the first turn.

Set `sessionTeamPolicy.mode: off` (or remove the key) to disable the rule entirely;
`mode: instruct` keeps the mechanical startup notice but does not auto-create a team.