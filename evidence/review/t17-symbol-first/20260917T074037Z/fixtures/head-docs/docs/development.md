# Development Guide

**English** | [中文](development.zh-CN.md)

How to build, test, QA, pack and release this repository.

## 1. Repo layout

```
├── AGENTS.md              binding manual (read FIRST)
├── README.md / docs/      public overview + this documentation set (docs/index.md is the hub)
├── package.json           root scripts (workspaces: packages/*)
├── tsconfig.json          root tsgo config (covers packages/*/src/**/*.ts)
├── VENDOR_LOCK.json       upstream commit/version/stats + asset fingerprints
├── scripts/
│   ├── pack-mpd.mjs       assemble dist/mpd-package/ (Plan D bundle)
│   ├── build-mpd-client.mjs  compose the combined web client (client.js)
│   ├── build-mcp.mjs      offline build of the ast-grep/git-bash/lsp MCP servers
│   ├── vendor-agent-teams.mjs  materialize the adopted agent-teams server closure (_deps/)
│   ├── install-profile.mjs    legacy installer (default dry-run; --dsh-home for QA)
│   ├── mpd-ext.mjs        extension developer CLI: validate / scaffold / list / --self-test
│   ├── bootstrap.mjs      preflight + vendor check (P0-era, kept as checks)
│   └── verify-vendor.mjs  blocking vendor gate
├── packages/              one package per plugin (src/ + dist/ + README.md)
├── extensions/            the bundle-shipped extension discovery root + the disabled reference extension
├── skills/                ported skill corpus + dsh-qa (QA skill)
├── tests/                 QA overlays + golden fixtures
└── evidence/              <domain>/<slug>/<timestamp>/{result.json, output.log}
```

## 2. Build

Per plugin (zero runtime deps preferred):

```bash
bun build packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js
```

Then, for the bundle:

```bash
node scripts/build-mpd-client.mjs   # regenerate packages/mpd-bundle-plugin/client.js (after agent-teams client changes)
node scripts/pack-mpd.mjs          # RELEASE only: regenerate the relocatable dist/mpd-package/
```

A local install needs no pack step: the repo root manifest IS the bundle package, so
`dsh plugin add .` (in the repo root) installs everything; after a code change rebuild the
touched `dist/` and restart dsh.

MCP servers are built by `node scripts/build-mcp.mjs` (offline from in-repo sources).

**Extension assets need no build.** `packages/mpd-ext-plugin` is an ordinary plugin package
(rebuild its `dist/` after a source change like any other), while the packages that *use* the
interface ship as plain directories under `extensions/<id>/` with an `mpd-ext.json` manifest and
their assets — no compilation step, and the developer CLI runs straight from the TypeScript
sources (`bun scripts/mpd-ext.mjs …`), so the CLI can never validate a stale copy of the rules.
Inside a **packed** artifact there are no sources, so the CLI falls back to the compiled validator
entry the packer emits (`packages/mpd-ext-plugin/dist/validator.js`): `validate`, `scaffold`,
`list`, `--self-test` and `--validator` all run from `dist/mpd-package/` (bun or plain node), and
`--validator` prints which entry a run actually loaded (T-51).
A NEW plugin package must also be added to the `PLUGIN_PKGS` allowlist inside
`scripts/pack-mpd.mjs`, or a packed install ships without it and dies at boot with
`ERR_MODULE_NOT_FOUND`.

**Harness seams (binding, AGENTS.md §6):** a plugin row must not call `ctx.tools`,
`ctx.subagents`, `ctx.skills` or `ctx.agentPresets` directly. Every row goes through
`packages/mpd-dsh-adapter-plugin` (`const dsh = ctx.get("mpdDsh") ?? createDshAdapter(ctx)`),
so a harness release that reshapes a seam is fixed in that one package: edit
`packages/mpd-dsh-adapter-plugin/src/index.ts`, rebuild it, re-pack — consumers pick the
new mounted instance up without changes. Its unit tests
(`packages/mpd-dsh-adapter-plugin/test/adapter.test.ts`) fake both a full and an empty
harness, which is the fastest way to add a seam.

## 3. Tests

```bash
bun run typecheck                        # root tsgo --noEmit (covers all packages)
bun test packages                        # per-package unit tests (mock ctx drives tools)
bun test packages/<pkg>                  # one package
```

Test convention (see `packages/mpd-roles-plugin/test/roles.test.ts`,
`packages/mpd-workmate-plugin/test/workmate.test.ts`): a `makePlugin()` builds a mock
`ctx` (`tools.register` captures definitions, `subagents.start` returns a stub result,
`provide` records services, `get` returns fixtures) and drives `apply(ctx)` — pure
offline, no DSH binary, no model. State-touching tests set `process.env.HOME` to a
temp dir (bun caches `os.homedir()`, so plugins read `$HOME` directly).

## 4. QA (real DSH boots, strictly isolated)

The QA skill is `skills/dsh-qa` (`SKILL.md`). Every case script ships `--self-test`
(offline) plus a real isolated boot; evidence goes to
`evidence/<domain>/<slug>/<timestamp>/`.

| Case | Proves | How to run (from an approved permission context) |
|---|---|---|
| `mount-assert` | bundle rows present/absent in `--dump-config` | `bun run test:qa` (all self-tests) |
| `preset-register` | mpd preset resolves FROM the bundle-served root (no `$DSH_HOME/.agent-presets` copy) + roster serves 11 roles | `node skills/dsh-qa/scripts/preset-register.mjs` |
| `bundle-lifecycle` | ONE command from the checkout (`dsh plugin add <repo root>`, no pack step) installs the whole unit → real boot serves preset + skills from the installed bundle and proves the harness adapter (`ADAPTER_SEAMS`, `ADAPTER_TOOL_CALL=ok`) → `dsh plugin remove` leaves no residue | `node skills/dsh-qa/scripts/bundle-lifecycle.mjs` |
| `skill-catalog-probe` | installed bundle serves the skill catalog (18 bundled skills, fixture loads) with no `$DSH_HOME/skills` copy | `node skills/dsh-qa/scripts/skill-catalog-probe.mjs` |
| `relocate-smoke` | relocated bundle serves preset + corpus, no dev-path leak, no home copy | `node skills/dsh-qa/scripts/relocate-smoke.mjs` |
| `team-route-rewire` | staged bundle install → agent-teams row composed → probe boot → web `/plugins/dsh-agent-teams/state` 200 | `node skills/dsh-qa/scripts/team-route-rewire.mjs` |
| `workmate-library` | init→list→spawn→reflect→match against a sandbox HOME; the self-test also pins the rename/delete host routes, the service surface and the §D reason matrix | `node skills/dsh-qa/scripts/workmate-library.mjs` |
| `workmate-team-member` | workmate-backed member injection + self-reflect in a live team | `node skills/dsh-qa/scripts/workmate-team-member.mjs` |
| `web-client-adapt` | the `@mpd-dsh/mpd` boot-graph client entry + client.js ids + workmate host routes (incl. the client's rename/delete URLs) | `node skills/dsh-qa/scripts/web-client-adapt.mjs` |
| `preset-conformance` | every harness-owned row config (preset + bundle patch + QA overlays) conforms to the INSTALLED harness schemas, the `mpd` preset's row set equals the installed `standard` preset's, and a real session created with `agentPreset: "mpd"` MOUNTS — with a negative control that must fail | `node skills/dsh-qa/scripts/preset-conformance.mjs` |
| `software-smoke` | software dev flow: a REAL headless mpd session (local OpenAI-shaped stub, throwaway key — no provider credential) writes a tiny deterministic game with the `write` tool and runs it with the `bash` tool in a SANDBOX workspace; the case replays the REAL transcript through its own oracle (legality, optimality, winner, determinism) and requires the mutation control to go RED | `node skills/dsh-qa/scripts/software-smoke.mjs` |
| `tui-mount` | the REAL dsh-TUI boot: the bundle as the third patch layer (`dsh.profile.bundles` = [dsh-base, dsh-tui, @mpd-dsh/mpd]), the `mpd-tui` row composed, ZERO apply-crash signatures in the raw log, the status line rendered, and the boot's own session record carrying `agentPreset: "mpd"` | `bun skills/dsh-qa/scripts/tui-mount.mjs` |
| `tui-panels` | each of the seven activation-gated TUI surfaces really RENDERS (status line, `/mpd status`, the `/mpd` completion tree, the board scene, the renderer row, the `/settings` section with its bridge+restart disclosure, and the managed dialog) — a surface that renders nothing FAILS the lane; the lane also proves `/mpd` never reached the model, and re-runs its engine on a deliberately impossible expectation as a negative control | `bun skills/dsh-qa/scripts/tui-panels.mjs` |
| `tui-admission` | the HOST's own pinned admission algorithm against the bundle-level `dsh-plugin.json`: vendored `@dsh-std/manifest` parse + projection + the host's `validatePlugin` + five-state `negotiate`, then the host's `/plugins check` driven inside a live TUI; the spec-data root must RESOLVE first, and three negative controls are recorded | `bun skills/dsh-qa/scripts/tui-admission.mjs` |
| `tui-distribution` | `dsh-distribution.json` validated by the dsh-distribution protocol's OWN conformance CLI from an in-sandbox copy of the protocol repo; when its build cannot complete, the exact blocker is recorded and the descriptor is marked NOT fully validated rather than approximated as a pass | `bun skills/dsh-qa/scripts/tui-distribution.mjs` |
| `tui-spec-conformance` | the HOST's own pinned conformance suite against our manifest and a captured host descriptor, with the suite revision and every input digest recorded, and the three-way sha256 identity of the payload re-measured | `bun skills/dsh-qa/scripts/tui-spec-conformance.mjs` |
| `tui-settings-bridge` | the TUI arm of the settings bridge, judged against the BUILT bytes: every `/settings` hint carries the post-bridge disclosure (`a save writes <workspace>/.mpd/mpd.jsonc … after a restart`), the pre-bridge "not bridged" sentence is DELETED, the `no-live-session` runtime notice is present AND wired into the status-line composition, and the TUI dist performs ZERO filesystem writes | `bun skills/dsh-qa/scripts/tui-settings-bridge.mjs` |

| `agent-teams-adopt` (historical C1) | MIT notice + adoption wiring | `node skills/dsh-qa/scripts/agent-teams-adopt.mjs` |
| `extension-lifecycle` (**new**) | the extension interface on a REAL mounted boot (sandboxed `DSH_HOME` + `HOME` + session cwd; the rows are composed from THIS checkout, and the model step is answered by a local OpenAI-shaped stub, so no provider credential is needed): a data-plane extension in `<sandbox-ws>/.mpd/extensions/` appears in `mpd_ext_list`, its flow loads, its role spawns, a broken extension of each kind leaves the good ones working, and two sessions with different cwds on one host see only their own project extensions | `bun skills/dsh-qa/scripts/extension-lifecycle.mjs` |
| `extension-mcp-bridge` (**new**) | the runtime stdio MCP bridge on the same REAL mounted boot + stub recipe: a declared server publishes `mcp__<server>__<tool>` in both tool-list readings and a real tool call succeeds, while the dead/hang/schema/dup arms prove one failing server never breaks the others | `bun skills/dsh-qa/scripts/extension-mcp-bridge.mjs` |

Both cases import ONE shared proof helper, `skills/dsh-qa/scripts/extension-isolation.mjs` — the local OpenAI-shaped stub model, the sandbox/boot recipe, the session-evidence readers and the multi-session isolation arm. It is deliberately **not a case row** (verbatim in `skills/dsh-qa/SKILL.md`): it has **no lane mode** — invoked without `--self-test` it does nothing and exits 0 — and its only offline proof is its own `--self-test`, `bun skills/dsh-qa/scripts/extension-isolation.mjs --self-test`, which checks the stub protocol, the descriptor contract, the shipped example and the boot recipe without booting a session. That is also why it is not enumerated as a case in `package.json`'s `test:qa:all`.

Two npm scripts, two lanes (t8): `bun run test:qa` runs EVERY case's offline `--self-test`;
`bun run test:qa:all` runs the REAL lane of the heavy/live subset, enumerated by name in
`package.json` (criterion: the case needs a real headless dsh boot and/or a live provider).
The allowlist is explicit so a new case is never silently treated as heavy.

**TUI lanes and the TUI packaging path.** The six DSH-TUI cases above ship the usual offline
`--self-test`, but their LIVE legs need a real terminal: `dsh-tui` refuses to boot when stdout is not a
TTY, so they drive the UI inside tmux and capture panes — which is why they are not part of
`bun run test:qa`'s self-test sweep (`docs/tui.md` §2). The packaging step ships the TUI flavor too:
`node scripts/pack-mpd.mjs` writes `packages/mpd-tui-plugin/{dist/**, README.md, README.zh-CN.md,
themes/mpd-tui.json, skills/mpd-tui/SKILL.md}` into `dist/mpd-package/` and keeps the packed patch's
`mpd-tui` row as the resolvable specifier `@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js`; the
install is the ordinary one (`dsh plugin --profile dsh-tui add <repo | dist/mpd-package>`).

**NOT-CLAIMED discipline for the TUI edition.** With no TTY and no browser in this environment the
render-acceptance criteria are recorded as **not-claimed**, never as "passed": `docs/tui.md` §10 carries
the list, and each lane records the limitation it could not drive (a keystroke leg, a browser render)
instead of substituting a proxy. Passing format or parser validation is not a safety or behaviour
verdict — keep compatibility, verification level and restrictions as separate statements.

**QA hard rules** (AGENTS.md §7): sandbox `DSH_HOME=<mktemp>`; copy credentials once;
assert the sandbox path; never touch the real `~/.dsh`; workmate cases additionally
sandbox `HOME` (`~/.mpd/workmate` is a user-approved HOME-scoped exception).

**Live-model steps need the configured provider route** — QA boots with the machine's
DSH credentials. Locally that means running the real cases with `DEEPSEEK_API_KEY`
present in the process environment (the running DSH host has it from `~/.bashrc`;
shell subprocesses do not — export it explicitly in the case command).

**Web cases**: use the manual-copy flow (copy `dist/mpd-package/` into a sandbox
profile `node_modules/@mpd-dsh/mpd`) when pnpm store access is unavailable; the packed
`dsh plugin add` flow is the primary one.

## 5. Gates (AGENTS.md §4)

| Gate | Command |
|---|---|
| Vendor | `node scripts/verify-vendor.mjs` (needs `MPD_UPSTREAM_ROOT`) |
| Tests | `bun test packages` + `bun run typecheck` |
| QA self-tests | `bun run test:qa` + each case `--self-test` |
| QA real cases | `node skills/dsh-qa/scripts/<case>.mjs` |
| Installer | `node scripts/install-profile.mjs --dry-run` / `--self-test` |
| Boot check (MOUNT) | a boot that really applies the rows in an isolated `DSH_HOME` + sandbox `HOME`: `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` (host rows) / `node skills/dsh-qa/scripts/preset-conformance.mjs` (the `mpd` preset's standing mount). `node scripts/dump-config.mjs --profile <p>` (the repo wrapper, which prints that warning itself) composes rows only and is NOT this gate (AGENTS.md §4) |
| Extension CLI | `bun scripts/mpd-ext.mjs --self-test` (offline) + `bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example` (exit 0; a deliberately broken extension must exit 1 with per-item errors) |

No evidence on disk for a gate = the change is not complete.

## 6. Release flow

1. Land the release's changes on `dev` first — `feature/<slug>` / `fix/<slug>` branches, each with
   its evidence committed. `master` only ever receives release merges.
2. Branch `release/vX.Y.Z` from `dev`; bump the version in `package.json` (and any version
   reference in this documentation set) and write the changelog note.
3. Full gate sweep, all green and on disk: `node scripts/verify-vendor.mjs`, `bun run typecheck`,
   `bun test packages`, `bun run test:qa` (every case's offline `--self-test`), the real-lane
   subset `bun run test:qa:all`, and the boot check (§5: `preset-conformance` plus the mount
   proof — never `--dump-config` alone).
4. **`VENDOR_LOCK.json` pairing rule**: a `skills/**` change invalidates the corpus `treeSha`, and
   the re-pin lands in the SAME commit as that change. `skills/**` has ONE writer per wave, so a
   wave has exactly one re-pin — verify it is present, and that no `skills/**` change is committed
   without it.
5. Packaging: `npm run pack` (`node scripts/pack-mpd.mjs`) assembles the relocatable
   `dist/mpd-package/`. Check the packed tree actually contains every plugin dist, the
   `extensions/` assets, the scaffold `templates/`, the `docs/` pairs (`node scripts/verify-docs-parity.mjs
   --root dist/mpd-package`) and `scripts/mpd-ext.mjs` (a missing `PLUGIN_PKGS` entry is a silent
   exit-0 with a broken boot). Since the 2026-09-17 packaging change this is checked, not eyeballed:
   `node scripts/verify-pack-closure.mjs` asserts the packer's root-asset table and, when the
   artifact exists, that every declared asset arrived, `docs/`+`templates/`+`agent-references/`
   match the source file for file, the three named reference files (`index.md`,
   `troubleshooting.md`, `agent-teams-deltas.md`) are present, the packed manifest's
   `files`/`exports` agree with what is on disk, and the CLI's compiled validator entry is present.
6. Merge `--no-ff` into `master` with a `release: vX.Y.Z …` message, create the annotated tag
   (`git tag -a vX.Y.Z`), and push `master` + the tag (and `dev`).

## 7. Git model

`master` (release, merge-only) ← `dev` (integration) ← `feature/<slug>` / `fix/<slug>`.
Commits: `<type>(<scope>): <summary>`; merges `--no-ff` with a descriptive message;
never rebase published branches; fixes cite the defect and land with reproduction
evidence.

## 8. Vendoring & baseline

- `scripts/vendor-agent-teams.mjs` re-materializes the adopted agent-teams server
  runtime closure (`packages/mpd-agent-teams-plugin/_deps/`) from the host installation
  (`DSH_HOST_NM`), rewriting bare `@deepseek-ai/*` + `zod` imports to relative paths —
  the client bundle keeps bare imports (the web app bundler provides them).
- `VENDOR_LOCK.json` pins the upstream commit/version + asset fingerprints;
  `verify-vendor.mjs` blocks on mismatch. Upstream is never chased — a baseline change
  needs a deliberate branch + evidence.

## 9. Common pitfalls (from real incidents)

| Pitfall | Fix |
|---|---|
| Bundle client never appears in the web GUI | the patch must contain the `mpd-web-compat` self-row (`name: '@mpd-dsh/mpd'`) AND the manifest must have `main`/`exports["."]` → mpd-bundle-plugin. Regenerate with `node scripts/build-mpd-client.mjs && node scripts/pack-mpd.mjs` |
| `mpd_workmate_*` / `mpd_modelchain_resolve` miss `mpdRoles` | read the service lazily inside tool execute (not at apply time) |
| QA boots fail `ERR_SQLITE_ERROR unable to open database file` | pnpm store lives outside the workspace; use the manual-copy web flow or run with the approved wider access |
| `os.homedir()` ignores a test's `HOME` | bun caches it; read `process.env.HOME` first in plugins |
| QA evidence with secrets | scan evidence logs for key material before committing |
| Workmate written to the real HOME in QA | always boot web/headless QA with `HOME=<sandbox>` |
