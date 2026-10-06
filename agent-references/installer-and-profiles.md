# Installer & profiles (the full former §8 body)

Agent-facing reference (English-only by the bundle's language policy; `bun run verify:docs` does not
discover this tree). **On demand — never auto-injected**: this file is deliberately not named
`AGENT.md`/`AGENTS.md`/`CLAUDE.md`, so the workspace instruction loader never reads it. `§N` citations
below refer to `AGENTS.md` sections, whose numbering is stable.

Provenance: moved from `AGENTS.md` §8 ("Installer & Profiles") on 2026-10-06 by the instruction-budget split (the
manual must stay under the harness's 65,536-byte workspace-instruction budget, and it was already
over at the previous HEAD). The block below is reproduced VERBATIM — its byte count and sha256 are
recorded in `evidence/gates/agents-budget/20261006T085805Z/result.json`. `AGENTS.md` §8 carries the BINDING rules and points
here for the full body; where the two differ, the manual wins.

## The former §8 body (verbatim)

## 8. Installer & Profiles

### The mounting contract — BINDING (user-set)

**A row reaches the harness ONLY through `cordis.patch.yml` + the profile mechanism.** Concretely:
(a) the deliverable is an INDEPENDENT PACKAGE (`@mpd-dsh/mpd`) whose `dsh.bundle.patch` array names its
patch layers — this bundle's `cordis.patch.yml` (host rows) and
`presets/mpd.patch.yml` (the `mpd` preset as an ordinary row); (b) the profile mechanism is the only
way in: `dsh plugin --profile <p> add <spec>` installs the package, `reconcile` validates that the patch
files load and appends the package name to `dsh.profile.bundles`, and the rows resolve from
`<profile>/node_modules`; (c) this repository NEVER edits DSH sources, NEVER writes a profile by hand
and NEVER pushes a row into `<DSH_HOME>` (the retired escape hatches — a home `cordis.patch.yml`, a
copied `skills/` tree, a preset directory — are dev/QA flows or removed outright); (d) uninstall is the
mirror image, one command, leaving no residue except the user's own `~/.mpd/workmate`. A capability
that arrives by any other route is a defect, not a shortcut — `verify-plugin-manifest --pack` plus the
Docker lane hold this line.

### Primary flow: ONE command, no extra step

- **The USER-facing install is ONE command against the PUBLISHED package — no clone, no build:**
  `dsh plugin --profile web add github:HaroldZ32/My-Power-Dsh` (or `… add @mpd-dsh/mpd` once it is on
  the registry). The harness hands the spec to pnpm in `<DSH_HOME>/profiles/<profile>/`; pnpm packs it
  through the manifest's **`files` allowlist**, then `reconcile` reads the installed package's
  `dsh.bundle.patch` files, validates that they load, and appends the package name to
  `dsh.profile.bundles` — that pair is what makes the mount travel through `cordis.patch.yml` + the
  profile mechanism and NOTHING else. Proof: the live lane (`node scripts/docker-e2e.ts --mode
  oneclick --spec github:HaroldZ32/My-Power-Dsh`) on a bare `ubuntu:24.04`. The allowlist keeps the
  download small: 100.9 MB without it, 7.6 MB / 1134 files with it.
- **A plain `github:<owner>/<repo>` spec resolves the repository's DEFAULT BRANCH.** Measured
  2026-09-28: it served `master` while the wave sat on `dev`, so the install ran OLD code and failed on a
  dependency that branch still declared. An installable wave is RELEASED to the default branch (§11); a
  dev install must name the ref (`github:<owner>/<repo>#dev`).
- **`cd <repo> && dsh plugin --profile web add .`** is the whole install from a CHECKOUT. The repo root
  IS the bundle package: `package.json` is named `@mpd-dsh/mpd` and declares
  `dsh.bundle.patch` (an ARRAY: `./cordis.patch.yml` then
  `./presets/mpd.patch.yml`), `dsh.client`
  (`platform: web`), the `exports` map the rows resolve through (`./packages/*`,
  `./skills/*`, `./presets/*`, and the `client` subpath
  `packages/mpd-bundle-plugin/client.js`) and the toolchain `optionalDependencies`.
  `dsh plugin remove @mpd-dsh/mpd` is the matching one-command uninstall.
- **The published dependency closure is BUILD-SCRIPT-FREE on purpose**: pnpm 11 hard-exits on
  unapproved dependency build scripts (`ERR_PNPM_IGNORED_BUILDS`) and the CLI `dsh plugin add` has no
  approval channel (`plugin_manager`'s `approvedBuilds` is the Web/MCP path only). So
  `dsh-better-sidebar` is an optional PEER + a `devDependency` (its `node-pty` postinstall is the
  offending script; its row's mount guard disables it when absent), and `@ast-grep/cli` +
  `@code-yeongyu/comment-checker` left `optionalDependencies` — their launchers resolve from
  `PATH`/`.toolchain`. The `mpd-oneclick` service keeps this honest.
- Every path-bearing patch value resolves through the loader's `baseUrl` (the profile
  directory), so the same patch works for a checkout install (`<profile>/node_modules/@mpd-dsh/mpd`
  → the repo) and for a packed install. The three official Agent Teams packages are declared
  `dependencies` of this bundle and mounted by this bundle's own rows (`healProfileModuleFallback`
  materializes that closure before the loader runs); the `mpd` preset
  and the skill corpus are SERVED by reference (the `preset-mpd` row → the inline plugin list,
  `mpd-bootstrap` → `<bundle>/skills`) — no home copy, so uninstall leaves no residue.
  Only user data stays: the workmate library under `~/.mpd/workmate`.
- **`node scripts/pack-mpd.ts` (alias `npm run pack`) is the RELEASE step, not an install step.** It
  assembles the relocatable `dist/mpd-package/` (tarball installs: `dsh plugin --profile web add
  dist/mpd-package`) from the built dists, `skills/` + `presets/`, `extensions/`, `templates/`, the
  `docs/` pairs, `agent-references/` and `scripts/`, declared in `files`; a checkout install never
  needs it.
- **After a code change:** rebuild the touched package's `dist/` (`bun build …`) and
  restart dsh — a `link:` install reads the checkout directly. Re-pack only when the
  distribution artifact must be refreshed, and bump `package.json` version for releases.

### Dev/QA flow (legacy): `scripts/install-profile.ts`

- `node scripts/install-profile.ts --yes [--profile mpd|mpd-headless] [--dsh-home X] [--skip-toolchain]`.
  Default is `--dry-run`: print, never write. `--dsh-home` enables isolated QA installs.
- What it writes: profile manifest (base + web-app/headless), home `cordis.patch.yml` with absolute
  paths (existing rows id-targeted, new rows via `insert:`), presets → `$DSH_HOME/.agent-presets/`,
  toolchain if missing. Superseded by the packed bundle for user installs.
- Never run the installer against the real home from a QA context; that is what `--dsh-home` is for.

