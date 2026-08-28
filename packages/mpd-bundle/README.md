# mpd-bundle

DSH bundle aggregation package: `cordis.patch.yml` mounts every mpd-dsh plugin row —
MCP servers (ast-grep/git-bash/lsp/codegraph + remote context7/grep.app), the B/C-line
plugins (mpd-config first so the mpdConfig service is visible to the rows below,
mpd-tools / modelchain / roles / ulw / team / hashline / boulder / comment-checker /
codegraph / memory) and mpd-bootstrap provisioning.

The bundle ships ONE preset (`mpd`, the main working agent; assets under
`packages/mpd-bootstrap-plugin/presets/mpd`): it configures `dsh-agent-instructions`
with `instructionFileCandidates: [AGENT.md, AGENTS.md, CLAUDE.md]` so every project
session attempts to read AGENT.md, and it declares native tool presentation. The
OMO-origin agents exist as a subagent roster (`mpd-roles-plugin`), not as presets.