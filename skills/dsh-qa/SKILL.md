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
   `evidence/<domain>/<slug>/<timestamp>/`.
4. **--self-test**: every helper script ships `--self-test` (offline, no network, no real API).
5. **Language**: all descriptions, logs, and script strings are English.

## Cases (grow per phase)

| slug | domain | assertion | phase |
|---|---|---|---|
| mount-assert | bundle mount | --dump-config contains/lacks expected plugin rows | P0 |
| llm-dual-track | DeepSeek dual-track | deepseek-official and pi-ai deepseek routes both serve a real headless task | P1 |
| skill-load | skills | skill catalog visible + content loaded | P2 |
| mcp-call | MCP | mcp__ast_grep__*/mcp__lsp__* callable with server responses | P3 |
| preset-register | presets | mpd-* presets resolve via user root .agent-presets | P4 |
| install-profile | installer | install-profile --yes into sandbox + boot auto-loads rows | P4 |
| codegraph-smoke | codegraph | binary resolve -> init -> mcp__codegraph__explore real call | P4+ |
| tool-output-validation | plugin tools | mpd_config_get / mpd_boulder_status return host-validated lossless JSON (no "not lossless JSON" / "must be an object" errors); evidence per defect under evidence/fix/<slug>/ | C5/C7 |
| skill-catalog-probe | plan-d install | staged install -> mpd-bootstrap copies skills to $DSH_HOME/skills -> real headless skill load of svn-master works | Plan D |

## Run

```bash
bun run test:qa                          # all self-tests
node skills/dsh-qa/scripts/mount-assert.mjs --self-test
node skills/dsh-qa/scripts/<case>.mjs    # one real case (isolated DSH_HOME)
```
