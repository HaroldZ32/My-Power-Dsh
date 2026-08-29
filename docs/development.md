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
│   ├── bootstrap.mjs      preflight + vendor check (P0-era, kept as checks)
│   └── verify-vendor.mjs  blocking vendor gate
├── packages/              one package per plugin (src/ + dist/ + README.md)
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
node scripts/pack-mpd.mjs          # regenerate dist/mpd-package/
```

MCP servers are built by `node scripts/build-mcp.mjs` (offline from in-repo sources).

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
| `preset-register` | mpd preset resolves + roster serves 11 roles | `node skills/dsh-qa/scripts/preset-register.mjs` |
| `team-route-rewire` | staged bundle install → agent-teams row composed → live boot → web `/plugins/dsh-agent-teams/state` 200 | `node skills/dsh-qa/scripts/team-route-rewire.mjs` |
| `workmate-library` | init→list→spawn→reflect→match against a sandbox HOME | `node skills/dsh-qa/scripts/workmate-library.mjs` |
| `workmate-team-member` | workmate-backed member injection + self-reflect in a live team | `node skills/dsh-qa/scripts/workmate-team-member.mjs` |
| `web-client-adapt` | the `@mpd-dsh/mpd` boot-graph client entry + client.js ids + workmate host routes | `node skills/dsh-qa/scripts/web-client-adapt.mjs` |
| `agent-teams-adopt` (historical C1) | MIT notice + adoption wiring | `node skills/dsh-qa/scripts/agent-teams-adopt.mjs` |

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
| Boot check | `dsh --profile <p> --dump-config` in an isolated DSH_HOME |

No evidence on disk for a gate = the change is not complete.

## 6. Git model

`master` (release, merge-only) ← `dev` (integration) ← `feature/<slug>` / `fix/<slug>`.
Commits: `<type>(<scope>): <summary>`; merges `--no-ff` with a descriptive message;
never rebase published branches; fixes cite the defect and land with reproduction
evidence.

## 7. Vendoring & baseline

- `scripts/vendor-agent-teams.mjs` re-materializes the adopted agent-teams server
  runtime closure (`packages/mpd-agent-teams-plugin/_deps/`) from the host installation
  (`DSH_HOST_NM`), rewriting bare `@deepseek-ai/*` + `zod` imports to relative paths —
  the client bundle keeps bare imports (the web app bundler provides them).
- `VENDOR_LOCK.json` pins the upstream commit/version + asset fingerprints;
  `verify-vendor.mjs` blocks on mismatch. Upstream is never chased — a baseline change
  needs a deliberate branch + evidence.

## 8. Common pitfalls (from real incidents)

| Pitfall | Fix |
|---|---|
| Bundle client never appears in the web GUI | the patch must contain the `mpd-web-compat` self-row (`name: '@mpd-dsh/mpd'`) AND the manifest must have `main`/`exports["."]` → mpd-bundle-plugin. Regenerate with `node scripts/build-mpd-client.mjs && node scripts/pack-mpd.mjs` |
| `mpd_workmate_*` / `mpd_modelchain_resolve` miss `mpdRoles` | read the service lazily inside tool execute (not at apply time) |
| QA boots fail `ERR_SQLITE_ERROR unable to open database file` | pnpm store lives outside the workspace; use the manual-copy web flow or run with the approved wider access |
| `os.homedir()` ignores a test's `HOME` | bun caches it; read `process.env.HOME` first in plugins |
| QA evidence with secrets | scan evidence logs for key material before committing |
| Workmate written to the real HOME in QA | always boot web/headless QA with `HOME=<sandbox>` |
