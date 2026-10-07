# Docker real-machine lane — what the extended run verifies, and what it found

**Domain:** the Docker acceptance lane (`scripts/docker-e2e.ts`, `docker/**`).
**Scope of this record:** the wave that made the lane drive every shipped plane with a REAL model turn
and a REAL browser, and the two defects that wave surfaced.

## Final verdict of the wave (rootless Docker, `--mode all --live --require-docker`)

| Lane | Evidence | Verdict |
|---|---|---|
| checkout (`source`) | `evidence/docker/client-install/2026-10-03T17-59-02Z/result.json` | **94 / 94 passed, 0 failed, 0 null** — boot 13/13, live 27/27, ui 8/8, tui 20/20, install 3/3, compose 4/4 |
| published package (`oneclick`) | `evidence/docker/client-install-oneclick/2026-10-03T18-04-03Z/result.json` | **96 passed, 0 failed**, 2 null (both documented "not applicable in one-click mode") — `boot.mcpTools` 1/1 after the launcher fix |

Both lanes were run on the FINAL tree with the literal flags of the release checklist:
`node scripts/docker-e2e.ts --mode all --live --require-docker --require-browser`.

The driver's aggregate for that run: `--mode all: source=0 oneclick=1 -> 1` BEFORE the fix and
`source=0 oneclick=0 -> 0` AFTER it. Both runs are kept: the second one is the wave's verdict, the
first is the evidence that the arm which found the defect actually reddens.

The source lane's green run is the usability proof: Chromium typed a prompt into the real composer and
the rendered reply is `evidence/docker/client-install/2026-10-03T17-33-17Z/ui-shots/ui-03-reply.png`
— a session titled "MPD config retrieval request", the assistant's `DONE`, `Completed in 1s`, and zero
console/page errors.

## Why the lane was extended

The lane's only model-dependent assertion was `boot.llmTurn`, and it was credential-gated: every
recorded run reported `boot.llmTurn: null` ("not attempted: a live LLM turn needs provider credentials
and this container stages none"). 52 of 53 assertions passed while no model token had ever been
produced — so a defect that lives entirely inside an SSE stream (a model streaming an unparseable
tool-call payload, `MALFORMED_RESPONSE`) was structurally invisible.
See `evidence/web/malformed-tool-json/` for that defect's own record.

## What one run now covers

| Plane | Driven how | Verdict read from |
|---|---|---|
| Web, agent | `POST /api/session/prompt` on the RUNNING app | session store (`live.web.*`, 7 arms) |
| Web, GUI | Chromium: load, select workspace, type, send, wait for the reply; then the Agent Teams sidebar and Settings→MPD | page text + console/page errors (`ui.*`, 8 arms) |
| TUI | the real `dsh-tui` on a real PTY under tmux; the prompt is TYPED into the pane | session store (`live.tui.*`, 7 arms) + the pre-existing `tui.*` group (19) |
| Headless | `dsh --profile headless <prompt>` | session store (`live.headless.*`, 7 arms), `boot.llmTurn`, `live.teamRecord`, `live.nativeExecutor` |
| Capability | — | `boot.mcpTools` (the three mounted `mcp-client` rows), `boot.mpdTools`, the team routes |

`--mode all` runs both install lanes (checkout + published package). `--live` stages the credential
once, before the boot, and is a HARD ERROR without a key. `--no-browser` skips Chromium. A `null` in an
arm the caller asked for is reported as `UNMEASURED` and turns the exit code into 3.

## Defect 1 — the published install ships a bundle whose MCP servers cannot start

**Measured:** `evidence/docker/client-install-oneclick/2026-10-03T17-23-54Z/result.json`
(`boot.mcpTools` FALSE, `MCP_TOOLS=0/3 MISSING=mcp__ast_grep__search,mcp__lsp__status,mcp__codegraph__codegraph_explore`)
against `evidence/docker/client-install/2026-10-03T17-18-48Z/result.json` where the same arm is TRUE
(`MCP_TOOLS=3/3`).

**Cause, proven locally** (not inferred): the rows launch the launcher through the PROFILE path —
`<profileDir>/node_modules/@mpd-dsh/mpd/packages/mpd-mcp-<x>/launch.ts` — and Node refuses to strip
types for any resolved path under `node_modules`:

```
$ node .qa-tmp/proof/launch.ts                      # outside node_modules
type-stripping OK 1
$ node .qa-tmp/proof/node_modules/x/launch.ts       # the packed-install layout
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is currently unsupported
for files under node_modules
```

- **checkout lane** installs a `link:` — the profile entry is a SYMLINK, so the realpath is the
  checkout and stripping works → 3/3.
- **oneclick lane** (and therefore the user's documented one-command install
  `dsh plugin --profile web add github:HaroldZ32/My-Power-Dsh`) installs a REAL COPY under
  `node_modules` → every MCP child dies → 0/3.

This is the same rule `agent-references/troubleshooting.md` records for the 32 `.js` files that remain
in the tree; `packages/mpd-mcp-*/launch.ts` and `packages/mpd-mcp-shared/*.ts` are NOT on that list.

**Why the lane had not caught it:** the oneclick arm asserted the launcher's PRESENCE
(`oneclick.requiredPaths` checks `packages/mpd-mcp-astgrep/launch.ts` exists) and passed — presence is
not executability. `boot.mcpTools` is the arm that runs the server.

**FIXED.** The four launchers moved to `packages/mpd-mcp-<x>/src/launch.ts` and now SHIP AS BUILT
ARTIFACTS at `packages/mpd-mcp-<x>/dist/launch.js` — the same shape the other 24 installed entries
have, so `verify-dist-fresh` covers them (24 -> 28 targets, all fresh) and the Docker lane's
`docker/lib/rebuild.ts` rebuilds them from source before installing.

Four things made it more than a move:

- **The adopted server must stay EXTERNAL.** `bun build` follows a literal dynamic import and inlined
  the whole adopted CLI (measured: a 96 KB bundle ending in `init_cli()`). Each launcher now reaches its
  adopted entry through a NAMED CONSTANT (`const ADOPTED_ENTRY: string = "./cli.js"`), which the bundler
  leaves alone; the path resolves at runtime beside the built launcher.
- **`bundleRootFrom` counted hops.** `<bundle>/packages/<pkg>/launch.ts` plus two `..` IS the bundle
  root, but the built `dist/launch.js` lands on `<bundle>/packages` — a wrong root silently disables the
  `.toolchain` tier. It now WALKS up to the ancestor whose `package.json` names `@mpd-dsh/mpd`, keeps the
  old two-hop answer as the fallback, and has three test arms (new depth, old depth, no bundle).
- **Two coupled gates saw the move.** The R5 `no-terminal-writes` exemption list is path-keyed (four
  entries updated); the independence inventory scans the band `packages/mpd-*/src/**`, so the six
  launcher→`mpd-mcp-shared` couplings became VISIBLE for the first time — recorded with a comment
  saying the coupling is old and the scan's coverage is what grew.
- **The row is what the harness executes**, so all four `args` now name `dist/launch.js`, and the
  oneclick lane's `requiredPaths` list, the QA dev-flavor rewrite list and the three README pairs were
  updated with it.

Proven locally against a fake packed layout before any container ran: the old `.ts` launcher from
`node_modules` dies with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, and all four
`dist/launch.js` files from the SAME layout exit 0 with no module error.

## Defect 2 — a live verdict graded another lane's artifact

**Measured:** `evidence/docker/client-install/2026-10-03T16-23-40Z/result.json` — `live.teamRecord`
PASSED with `file=tui-scene.json`, a TUI FIXTURE, while `live.nativeExecutor` FAILED against that same
fixture's empty handles. The live headless turn it claimed to grade had produced its own record; the
lookup took whatever `find … -print -quit` returned first.

**Fixed:** the lookup is now the newest record by mtime with a hard requirement that it postdate the
step, and every other verdict is scoped by session + `--since`.

## Defect 3 (in the apparatus) — three bugs this wave found in its own new code

Each was caught by the lane turning red, and each is now fixed and covered:

1. **Server-dependent lanes ran after the boot was stopped** — `http=000` / `ERR_CONNECTION_REFUSED`.
   The Web live turn and the browser lane now run ABOVE the "stop the boot" line.
2. **A spawned teammate's session outranked its parent** — the headless arm read
   `turns=1 completed=0 tools=0 texts=0` while the team record proved the turn had worked. The picker
   now prefers `delegationDepth === 0`.
3. **A crashed lane recorded nothing** — the reporter printed "not reached" instead of a cause. The
   browser lane now emits explicit `not attempted (exit N)` rows when it produces no verdict, and the
   headless step echoes its own log into the evidence.

## Not a defect: the headless preset row

`dsh --profile headless` reports `preset-mpd … pending (waiting for service: agentPresets)` because the
`agentPresets` service comes from `@deepseek-ai/dsh-agent-preset-registry`, declared ONLY by the
`dsh-web-app` bundle. `dsh-headless` declares no registry, so this bundle's preset row cannot activate
there. The arm records the CAUSE (`live.headlessPresetRow`), so a pending row for any other reason —
the real failure mode — still reddens.
