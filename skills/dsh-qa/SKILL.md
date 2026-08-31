---
name: dsh-qa
description: "QA the my-power-dsh bundle against the REAL dsh binary in strict isolation. Every case must prove a plugin row is mounted (via dsh --dump-config) or a real tool call succeeds, write evidence to evidence/<domain>/<slug>/, and ship helper scripts that pass --self-test. Use whenever a bundle/plugin change, a DeepSeek route smoke, an MCP wire-up, an installer change, or a preset registration needs verification."
metadata:
  short-description: Isolated QA for the my-power-dsh bundle on the real DeepSeek Harness binary
---

# dsh-qa

QA skill: verify my-power-dsh bundle/plugin behavior with the real `dsh` binary in a **strictly isolated**
DSH_HOME, writing evidence to `evidence/<domain>/<slug>/`. Structure mirrors upstream
the upstream host QA skills.

## Hard rules

1. **Isolation**: every case creates a temp DSH_HOME (`mktemp -d`) and boots inside it; never read/write the
   real `~/.dsh`. Scripts must assert the sandbox path.
2. **Provability**: assert that plugin rows are mounted (substring/structure assertions on
   `dsh --dump-config`) or that a real call succeeded (tool/skill/MCP executed and result asserted).
3. **Evidence**: each case writes `result.json` + raw output to
   `evidence/<domain>/<slug>/<timestamp>/`. Old evidence without a
   `result.json` (e.g. `evidence/dsh-qa/bline/2026-08-26T07-35-55.364Z/`,
   `evidence/plan-f/roles-subagent/2026-08-28T03-50-53/`) counts as incomplete;
   historical artifacts are never rewritten.
4. **--self-test**: every helper script ships `--self-test` (offline, no network, no real API).
5. **Language**: all descriptions, logs, and script strings are English.

## Cases (grow per phase)

| slug | domain | assertion | phase |
|---|---|---|---|
| mount-assert | bundle mount | --dump-config contains/lacks expected plugin rows | P0 |
| llm-dual-track | DeepSeek dual-track | deepseek-official and pi-ai deepseek routes both serve a real headless task | P1 |
| mcp-call | MCP | mcp__ast_grep__*/mcp__lsp__* callable with server responses | P3 |
| preset-register | roster | mpd main preset resolves via user root .agent-presets + mpdRoles serves the 11-role OMO roster | P4/refactor |
| codegraph-smoke | codegraph | binary resolve -> init -> mcp__codegraph__explore real call | P4+ |
| agent-teams-adopt | agent-teams adopt | installer writes bundle dep + stateDir override (.mpd/team); composed config contains the row; real headless AgentTeams run creates team state + archives on delete; web profile serves /plugins/dsh-agent-teams/state | Plan C/C1 |
| ultrawork-smoke | ultrawork | plan gate, execution rounds, verification gate, quality-gate ledger in one real headless session | Plan C/C2 |
| plan-c-smoke | plan-c live | one headless session exercising mpd_config_get + mpd_boulder_* + mpd_hashline_* together | Plan C |
| memory-smoke | memory engine | real headless mpd_memory_write -> commit -> mpd_memory_read -> reflection hint | Plan C/C6 |
| vision-smoke | multimodal | deterministic PNG fixture + real DeepSeek vision API call, image-grounded answer asserted; route id vs official catalog | Plan C/C8 |
| tool-output-validation | plugin tools | mpd_config_get / mpd_boulder_status return host-validated lossless JSON (no "not lossless JSON" / "must be an object" errors); evidence per defect under evidence/fix/<slug>/ | C5/C7 |
| skill-catalog-probe | plan-d install | staged install -> mpd-bootstrap copies skills to $DSH_HOME/skills -> real headless skill load of svn-master works | Plan D |
| relocate-smoke | plan-d relocate | staged bundle installs with ZERO fixed checkout paths; dump-config no dev-path leak; real headless boot | Plan D/P5 |
| team-route-rewire | plan-e team route | staged install serves agent-teams from the bundle (first-class main code @mpd-dsh/mpd/packages/mpd-agent-teams-plugin, no @nanmicoder npm dep); agent-teams row mounted (stateDir .mpd/team, normal-named `mpd` roster profile); installed mpd preset carries the AGENT.md convention + specialist rosters (mpd_role_spawn) and routes team work to agent_teams_*; real headless boot passes | Plan E/refactor |
| workmate-library | plan-f workmate | legacy install mounts mpd-roles/workmate/bootstrap; real headless boot runs init->list->spawn->reflect->match against a SANDBOX HOME; asserts ~/.mpd/workmate files in the sandbox and that the real home is untouched | Plan F/workmate |
| workmate-team-member | plan-f workmate team | real headless team run: workmate alice joins via agent_teams_add_member; asserts the member reports the injected memory (PINEAPPLE42) AND self-reflects (memory gains a second entry / uses>=2); real home untouched | Plan F/workmate |
| web-client-adapt | plan-f web client | manual-copy web boot proves the @mpd-dsh/mpd client entry appears in the boot graph (mpd-web-compat self-row), /plugins/@mpd-dsh/mpd/client.js serves and registers the matching id, /plugins/mpd-workmate/list + /init answer and create under a SANDBOX HOME; real home untouched | Plan F/workmate |
| rtl-verif | RTL dev phase-1 | isolated checkout boot: headless --dump-config mounts the committed bundle rows mpd-verif + mcp-wave-mcp + mcp-traceweave + mcp-lsp (t9 wiring — no overlay); segment-B rebuild asserted on the shipped lsp cli (BOTH builtin HDL servers: verible-verilog-ls + slang-server); the mpd_verif_* core then runs a golden adder fixture on REAL verilator in the SAME sandbox env (backends probe, venv iron-rule status, lint with zero diagnostics, cocotb Makefile-flow sim seed 4242 → results.xml smoke_add pass, 1-case regress results.json); VCD asserted on disk (never .fst); system python still cocotb-free after the run; real home untouched | Plan A/B (RTL phase 1) |
| session-start-team | fix session-start rule | isolated headless boot: installer row + composed config carry sessionTeamPolicy (mode auto, profile mpd, MPD Default); a TRIVIAL prompt run ("reply hello-ok", no team words) leaves .mpd/team/<id>/team.json staged with the 11-member mpd roster — the session mechanically started inside a team; best-effort session-log assert of the startup notice marker; real home untouched | fix/session-start-team |
| rtl-ip-profile | RTL IP workflow | bundle patch ships the rtl-ip roster profile (7 members, four-stage flow markers) + rtl-ip-flow skill + 4 document templates + bilingual guide; composed boot shows the profile in the agent-teams row config | RTL IP flow |

## Run

```bash
bun run test:qa                          # all self-tests
node skills/dsh-qa/scripts/mount-assert.mjs --self-test
node skills/dsh-qa/scripts/<case>.mjs    # one real case (isolated DSH_HOME)
```
