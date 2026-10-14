# Repository layout — the map of `AGENTS.md` §3

Agent-facing reference (English-only by the bundle's language policy; `bun run verify:docs` does not
discover this tree). **On demand — never auto-injected**: not named `AGENT.md`/`AGENTS.md`/`CLAUDE.md`,
so the workspace instruction loader never reads it.

Moved out of `AGENTS.md` §3 on 2026-10-08 by the de-omo wave E instruction-budget split: the manual is
injected into every session under a hard 65,536-byte budget and had fallen to 243 bytes of margin. `§N`
citations below refer to `AGENTS.md` sections, whose numbering is stable. The BINDING rules that lived
beside this map — the instruction budget paragraph and the "each package README is the contract"
sentence — STAYED in §3; this file is the map, not a specification, and where the two differ the manual
wins.

Tree moved VERBATIM (byte count and sha256 recorded in
`evidence/de-omo/licence/<timestamp>/result.json`):

```
mpd-dsh/
├── AGENTS.md                     # this manual
├── README.md / README.zh-CN.md   # public overview, bilingual pair (inheritance declared in README)
├── PLAN.md                       # port plan (Track A/B)
├── LICENSE.md / LICENSE-NOTICES.md
├── VENDOR_LOCK.json              # vendored asset fingerprints (+ the upstream recorded as a _note historical reference)
├── package.json                  # THE BUNDLE MANIFEST (name @mpd-dsh/mpd): dsh.bundle.patch
│                                 #   (an ARRAY of the bundle patch + the preset patch) + dsh.client
│                                 #   + exports -> `dsh plugin add .` is the whole install
├── cordis.patch.yml              # THE host-plane patch layer, at the package ROOT (standard layout)
├── tsconfig.json                 # root tsgo config (covers packages/*/src/**/*.ts)
├── presets/                      # mpd.patch.yml: the `preset-mpd` row (@deepseek-ai/dsh-agent-preset,
│                                 #   inline plugin list). The retired directory form is gone.
├── scripts/                      # gates, packer, installer, extension CLI, vendor + delta appliers
│                                 #   + lib/repo.ts: the shared primitives every script imports
├── packages/                     # one dir per plugin package (src/ + dist/ + README.md each);
│   ├── mpd-dsh-adapter-plugin/   # THE single contact surface with harness seams (§6)
│   ├── mpd-roles-plugin/         # the specialist roster + mpd_roles_* + the mpdRoles service
│   ├── mpd-verify-plugin/        # THE VERIFICATION LAW (§5): the ledger under .mpd/verify/, the five
│   │                             #   mpd_verify_* tools, the record validator and the receipt probe
│   ├── mpd-workmate-plugin/      # durable evolving agent library (~/.mpd/workmate)
│   ├── mpd-ulw-plugin/           # C2 ultrawork v2 engine: mpd_ultrawork + /ulw, /ultrawork
│   ├── mpd-mcp-astgrep / mpd-mcp-codegraph / mpd-mcp-gitbash / mpd-mcp-lsp / mpd-mcp-shared /
│   │                             # the MCP servers: AST search, code graph, git-bash, LSP, shared libs
│   ├── mpd-tools-plugin/         # B1: write guard, output truncation, edit-error recovery
│   ├── mpd-hashline-plugin/      # C3: anchored edit discipline (vendored hashline-core)
│   ├── mpd-boulder-plugin/       # C5: durable work ledger (vendored boulder-state); anchors a goal
│   ├── mpd-goal-plugin/          # C8: the persisted-GOAL bridge — mpd_goal_* + the `mpdGoal` service
│   │                             #   ULW/boulder auto-anchor from (`goal.*`, the anchors sidecar)
│   ├── mpd-config-plugin/        # C7: the mpd.jsonc runtime config layer (read by the plugins above)
│   ├── mpd-memory-plugin/        # C6: git/svn-backed memory + the reflection state machine
│   ├── mpd-comment-checker-plugin/ # C4: comment/docstring detection (opt-in binary)
│   ├── mpd-modelchain-plugin/    # B4: mpd_modelchain_resolve + mpd_memory_save/recall
│   ├── mpd-codegraph-plugin/     # binary resolve + project init + the mpd-codegraph command
│   ├── mpd-bootstrap-plugin/     # serves <bundle>/skills by reference; cleans legacy (<=0.2.6) copies
│   ├── mpd-team-watchdog-plugin/ # stall detection: the member record-stream fold, heartbeat store,
│   │                             #   WARN->ESCALATE ladder, preserving hold (NEW DISPATCH only)
│   ├── mpd-team-compact-plugin/  # compacts FINISHED teams (never the captain); ledger in .mpd/team-compact
│   ├── mpd-team-core-plugin/     # THE TEAM RECORD + WORKFLOW + the `mpdTeams` service (W1)
│   ├── mpd-roster-provider-plugin/ # per-member model routing for OFFICIAL teammates: registers
│   │                             #   the `mpd-roster` subagent provider the team tool row points at
│   ├── mpd-ext-plugin/           # the extension interface (row `mpd-ext`, service `mpdExtensions`)
│   ├── mpd-tui-adapter-plugin/   # THE MPD<->DSH-TUI contact surface (`mpdTui`): the ONE file that may
│   │                             #   name a `ctx.tui*` seam, plus the R5 file log sink
│   ├── mpd-tui-plugin/           # the DSH-TUI edition's surface package (never names a `ctx.tui*` seam)
│   ├── mpd-bundle-plugin/        # bundle web-compat: the @mpd-dsh/mpd no-op main + the combined web client
│   └── mpd-qa-roles-probe/       # QA-only probe: mpd preset resolve + mpdRoles roster
├── extensions/                   # <bundle>/extensions/*/mpd-ext.json + the DISABLED mpd-ext-example
├── skills/                       # dsh-qa + our own cordis-dev + 16 ported upstream skills + svn-master
│                                 #   (SERVED by reference; cordis-dev adapts the harness's 创造模式 skills)
├── templates/                    # plugin/extension scaffolds shipped by the packer
├── tests/                        # overlays/ (keep empty when rows live in the bundle) + golden/
├── docs/                         # human-facing docs (BILINGUAL EN + zh-CN); hub is docs/index.md
│                                 #   plan records + internal QA/golden docs are EXEMPT from the
│                                 #   bilingual rule (the §3 policy the gate cites)
├── agent-references/             # ON-DEMAND agent-facing reference (never auto-injected)
└── evidence/                     # QA evidence: <domain>/<slug>/<timestamp>/ (records, language as produced)
```
