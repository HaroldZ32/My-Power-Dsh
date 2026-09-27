# Contributing to my-power-dsh

**English** | [中文](./CONTRIBUTING.zh-CN.md)

Thanks for taking the time to contribute. This repository is a DeepSeek Harness (DSH) plugin bundle,
and it is developed under a small set of binding rules that are worth reading before your first pull
request: every delivered capability is a plugin, a change without evidence on disk is not done, and
every human-facing document ships in English **and** Simplified Chinese.

The authoritative conventions live in [`AGENTS.md`](./AGENTS.md) (English, agent- and
maintainer-facing) and the working detail in [`docs/development.md`](./docs/development.md). This
file is the contributor's entry point; where it and `AGENTS.md` disagree, `AGENTS.md` wins.

By contributing you agree that your contribution is distributed under the repository's licence,
**SUL-1.0** ([`LICENSE.md`](./LICENSE.md)).

## Table of contents

- [Ways to contribute](#ways-to-contribute)
- [Development setup](#development-setup)
- [Build](#build)
- [Tests](#tests)
- [Gates](#gates)
- [Git model](#git-model)
- [Documentation rules](#documentation-rules)
- [Evidence](#evidence)
- [Reporting issues](#reporting-issues)
- [Submitting a pull request](#submitting-a-pull-request)
- [Licence](#licence)

## Ways to contribute

- **Report a bug** — a minimal reproduction (the exact command, the observed result, the expected
  one) is the most valuable thing you can send.
- **Fix documentation** — typos, dead links, unclear instructions. Remember the bilingual rule
  below: a change to an English doc updates its `*.zh-CN.md` twin in the same commit.
- **Write an extension** — the extension interface lets a package contribute skills, flows, MCP
  servers and specialists without touching the core. Start with
  [`docs/extension-authoring-guide.md`](./docs/extension-authoring-guide.md) and
  [`docs/extensions.md`](./docs/extensions.md).
- **Fix or extend the bundle** — a plugin package under `packages/`, a new gate under `scripts/`, or
  a QA case under `skills/dsh-qa/`.

## Development setup

### Requirements

- **Node.js** and **Bun** (`1.4.0`, the version recorded by `buildToolchain` in `package.json`).
- **DeepSeek Harness (DSH)** installed, with a `web` or `headless` profile and model credentials —
  some QA cases boot a real session with the machine's provider route.
- **git**.

### Clone and install dependencies

```bash
git clone https://github.com/HaroldZ32/My-Power-Dsh.git
cd My-Power-Dsh
bun install
```

`bun install` materializes the declared runtime dependencies, including `dsh-better-sidebar`, whose
transitive `node-pty` needs `node-gyp`. Where `node-gyp` is unavailable:

```bash
bun add dsh-better-sidebar@0.19.0-alpha.1 --ignore-scripts
```

Only the sidebar's terminal panel degrades.

### Repository layout

| Path | Holds |
|---|---|
| `packages/` | one directory per plugin package (`src/`, committed `dist/`, the bilingual `README` pair) |
| `packages/mpd-bundle/cordis.patch.yml` | the bundle patch: every plugin, MCP and sidebar row |
| `presets/mpd.patch.yml` | the `mpd` preset row |
| `scripts/` | gates, the packer, the installer and the extension CLI |
| `skills/` | the served skill corpus (including `skills/dsh-qa`) |
| `extensions/`, `templates/` | the shipped extension root and the scaffold |
| `tests/`, `evidence/` | golden fixtures and the QA evidence tree |
| `docs/`, `agent-references/` | human-facing docs (bilingual) and on-demand agent references (English-only) |

## Build

The committed `dist/` files are build products. Rebuild the package you changed **from the repository
root**, with path-qualified arguments:

```bash
bun build packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js
```

A multi-entry package repeats that command per entry. The canonical form matters: `bun build` writes
module paths relative to the working directory into the artifact, and `node scripts/verify-dist-fresh.mjs`
reproduces those exact bytes — a build run from inside a package directory is reported STALE.

Other build entry points:

```bash
node scripts/build-mcp.mjs          # MCP servers, offline from in-repo sources
node scripts/build-mpd-client.mjs   # the combined web client, after agent-teams client changes
node scripts/pack-mpd.mjs           # RELEASE only: the relocatable dist/mpd-package/ artifact
```

A new plugin package must also be added to the `PLUGIN_PKGS` allowlist in `scripts/pack-mpd.mjs`, or a
packed install ships without it and dies at boot with `ERR_MODULE_NOT_FOUND`.

## Tests

```bash
bun run typecheck            # root tsgo --noEmit, covers every package
bun test packages            # per-package unit tests, offline (mock ctx, no DSH binary, no model)
bun test packages/<pkg>      # one package
bun run test:qa              # every QA case's offline --self-test
bun run test:qa:all          # the real/live lane (real DSH boots and/or a provider)
```

State-touching tests set `process.env.HOME` to a temporary directory; plugins read `$HOME` directly.

## Gates

`bun run verify:gates` is the fast aggregate over the static gates. Run it before opening a pull
request, and run the specific gate below when your change touches its subject:

| Gate | Command |
|---|---|
| Fast aggregate (static gates) | `bun run verify:gates` |
| Vendor baseline and asset fingerprints | `bun run verify:vendor` |
| `dist/` freshness (deterministic rebuild-and-diff) | `node scripts/verify-dist-fresh.mjs` |
| Bundle rows and preset parity | `bun run verify:rows` and `node skills/dsh-qa/scripts/preset-conformance.mjs --self-test` |
| Documentation pairs, heading tree, link targets | `bun run verify:docs` |
| Packed artifact closure | `node scripts/verify-pack-closure.mjs` |
| Installer (dry run) | `node scripts/install-profile.mjs --dry-run` |
| Extension CLI | `bun scripts/mpd-ext.mjs --self-test` and `bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example` |
| Boot check (mount) | a real boot in an isolated `DSH_HOME` + sandbox `HOME`: `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` or `node skills/dsh-qa/scripts/preset-conformance.mjs` |

Two rules keep the gates meaningful:

- **`--dump-config` proves composition only, never a plugin load.** It does not execute plugin code,
  so it cannot witness an apply or schema abort. Anything about plugin *behaviour* needs a mounting
  boot or a real tool call.
- **A gate without evidence on disk is not complete.** Record the run under
  `evidence/<domain>/<slug>/<timestamp>/` (`result.json` + `output.log`) and commit it with the
  change.

### QA isolation

QA never touches the real `~/.dsh` or the real `~/.mpd/workmate`:

- `DSH_HOME=<mktemp>` — credentials are copied in once and the sandbox path is asserted;
- `HOME=<sandbox>` — skill roots and the workmate library resolve through `HOME`;
- a sandbox **workspace** — every workspace-scoped root resolves from the session workspace, so each
  spawn and `session/create` payload carries an explicit sandbox cwd.

## Git model

| Branch | Purpose | Rules |
|---|---|---|
| `master` | release line | release merges only; never commit or push directly |
| `dev` | integration | feature and fix branches merge here; all gates must pass |
| `feature/<slug>` | capabilities | branch from `dev`, kebab-case, atomic commits with evidence |
| `fix/<slug>` | defects | branch from `dev`, one defect per branch, with reproduction evidence |

- Commit format: `<type>(<scope>): <summary>` (`feat`/`fix`/`docs`/`test`/`chore`/`release`).
- Merge with `--no-ff` and a descriptive message; never rebase a published branch.
- A fix cites the defect it repairs and lands only after its evidence exists.
- **One writer per working tree.** If several people (or agents) share a checkout, exactly one of them
  runs `commit`/`checkout`/`merge`/`reset`; everyone else edits files and runs gates.
- **`skills/**` has one writer per wave.** Every `skills/**` edit invalidates the corpus fingerprint
  in `VENDOR_LOCK.json`, and the single re-pin (`node scripts/repin-vendor.mjs --write
  --i-know-this-is-the-captains-step`) lands in the same commit as the change that invalidated it.

## Documentation rules

- **Bilingual, always.** Every human-facing document — the root `README.md`, everything under
  `docs/`, and every `packages/*/README.md` — ships an English file and a `简体中文` twin named
  `*.zh-CN.md`, and each file carries its language switch link directly under the title.
- **A change to one updates both in the same commit.** `bun run verify:docs` enforces the pair, the
  heading tree (levels and order must be identical), real CJK content in the Chinese file, and the
  resolution of every relative link and image target.
- **Agent-facing content is English-only.** `AGENTS.md`, `agent-references/**` and every code comment
  and docstring stay in English.
- **Keep the structure standard.** The root README is the product page (features, requirements,
  install, quick start, usage, configuration, FAQ, contributing, changelog, licence); the hub is
  [`docs/index.md`](./docs/index.md). Images live under `docs/assets/images/`.
- **Cite code by symbol, never by line number** — a line pointer rots as soon as the file is edited.

## Evidence

A change is complete when its evidence is committed next to it:

```
evidence/<domain>/<slug>/<timestamp>/result.json
evidence/<domain>/<slug>/<timestamp>/output.log
```

Evidence logs must never contain credentials, tokens or private data.

## Reporting issues

- **Bugs and feature requests** — open an issue. Include the exact command, the observed result, the
  expected result, your DSH profile and the bundle version.
- **Security reports** — do **not** open a public issue. Use GitHub's private vulnerability reporting
  from the repository's **Security** tab; if it is unavailable, open a short issue stating that you
  have a security report and ask for a private channel, without disclosing the details. The full
  policy, including which code is in scope, is [`SECURITY.md`](./SECURITY.md).
- **Questions** — read [`README.md`](./README.md) and the [`docs/`](./docs/index.md) hub first; the
  README's FAQ covers the common install and configuration problems.

This project does not ship credentials, and neither should your report, your patch or your evidence.

## Submitting a pull request

1. Branch from `dev` (`feature/<slug>` or `fix/<slug>`).
2. Make one focused change; keep unrelated refactors out of it.
3. Run the gates that cover your change — at minimum `bun run typecheck`, `bun test packages` and
   `bun run verify:docs` (for any documentation edit); use `bun run verify:gates` for the static set.
4. Commit with `<type>(<scope>): <summary>` and include your evidence directory.
5. Open the pull request and fill in the template: what changed, why, how it was verified, and which
   gates produced evidence on disk.

Small pull requests get reviewed — and merged — quickly; large ones that mix a feature, a refactor
and a documentation rewrite do not.

## Licence

The repository is licensed under **SUL-1.0** ([`LICENSE.md`](./LICENSE.md)); the adopted
`agent-teams` component keeps its own MIT licence, which covers that component only. See
[`LICENSE-NOTICES.md`](./LICENSE-NOTICES.md) for the complete notices.
