# JavaScript → TypeScript conversion, plugin regularisation, and the standing QA gates

Wave record. Machine-readable companion: [`result.json`](./result.json).

## What the user asked for

1. Turn the project into a **fully regular DeepSeek Harness (cordis) plugin**.
2. Convert **every JavaScript source to TypeScript**, with **precise type declarations** and a
   **precise comment on every variable / constant / function / class**.
3. Mounting must go through **`cordis.patch.yml` + the profile mechanism only** — the plugin is an
   independent package the profile references; DSH itself is never modified.
4. Standing QA, checked every time: **no `cordis` in `dependencies` / `peerDependencies` /
   `optionalDependencies`** (by name; the optional field is not an exemption) and **no
   `preinstall` / `install` / `postinstall` / `prepare`** script name.
5. The user must be able to install with **one command**; npm publication is prepared but not yet
   performed (the registry is the maintainer's step).

## Result

| Item | Outcome |
|---|---|
| TypeScript census in wave scope | **345 `.ts`, 1 `.mjs`** — the single remaining `.mjs` is the generated `skills/visual-qa/scripts/visual-qa.mjs` |
| Conversion volume | 155 `.mjs` + 3 `.js` deleted, 162 new `.ts`, 185 modified `.ts` |
| JavaScript kept on purpose | `packages/*/dist/**`, the generated visual-qa bundle, the adopted `mpd-agent-teams-plugin/lib/**` + `_deps/**`, and fixture DATA (`skills/ultimate-browsing/engine/templates/*.js`, `tests/golden/fixtures/*.js`) |
| Typecheck | `tsgo --noEmit` (root, covering `packages/*/{src,test,self-fix-tests}`, `scripts/`, `skills/*/scripts/`, `docker/`, `tests/`, `templates/`, `extensions/`) → **0 diagnostics**; the wave started at 84 |
| Declaration comments | `bun run verify:comments` → **PASS**, 349 files / 27 202 declarations / **0 violations**; the wave started at 8 376 violations |
| Unit tests | `bun test packages` → **1248 pass / 0 fail**; the adopted self-fix suite **151 / 0**; bundle plugin **101 / 0** |
| Install-time rules | `bun run verify:manifest --pack` → **PASS**: no `cordis` in any dependency field, no lifecycle script name, `npm pack` lists 1134 files with 0 required paths absent |

## Gates, all green on the frozen tree

`bash .qa-tmp/endgame.sh` runs 17 steps and **every one exits 0**: reference sweep (and its
idempotence), manual-path audit, citation claims, canonical dist rebuild, dist freshness (23/23
byte-identical), the wave's single `VENDOR_LOCK.json` re-pin, vendor, typecheck, the unit suite, every
QA script's `--self-test`, the plugin manifest (with `--pack`), the declaration-comment gate, row
parity (33 ids), doc pairs (41 pairs, 419 links, 0 dead), pack closure (1201 files compared, 1201
identical, 0 drift) and the 7-member aggregate `bun run verify:gates`.

## Real-machine verification (the user's final step)

Two Docker lanes on a bare `ubuntu:24.04`, driven by `node scripts/docker-e2e.ts`:

| Lane | What it installs | Result |
|---|---|---|
| `source` | the checkout (`dsh plugin --profile web add .`) | **ok=true, 42 passed, 0 failed**, 1 NULL (a live LLM turn needs credentials) |
| `oneclick` | the **published** package | **ok=true, 44 passed, 0 failed**, 3 NULL (two not-applicable in one-click mode, one the credential-bound LLM turn) |

Both lanes assert the mount, not just the install: the package reconciles into the profile through
`cordis.patch.yml`, every `mpd` row activates, the tools register, the real TUI boots on a real PTY,
and the harness's own session store records `agentPreset=mpd`. Evidence stamps:
`evidence/docker/client-install/2026-09-28T17-01-54Z` and
`evidence/docker/client-install-oneclick/2026-09-28T16-57-01Z` (the source lane was re-run after the
last write so both stamps describe the same frozen tree).

## Install (what the user gets)

```sh
dsh plugin --profile web add github:HaroldZ32/My-Power-Dsh   # one command, from GitHub
dsh plugin remove @mpd-dsh/mpd                               # one command, uninstall
```

`npm publish --dry-run` also passes (`@mpd-dsh/mpd@0.11.1`, 7.6 MB packed / 1134 files), so switching
the install line to `… add @mpd-dsh/mpd` is a registry step, not a code change.

## Tradeoffs and deliberate limits

- **The published dependency closure is build-script-free.** pnpm 11 hard-exits with
  `ERR_PNPM_IGNORED_BUILDS` when a dependency carries an unapproved build script, and the CLI
  `dsh plugin add` has no approval channel, so `dsh-better-sidebar` is an optional peer + devDependency
  and the two binary-resolving optional dependencies left the published closure. A published install
  therefore does **not** bring the sidebar host; the sidebar row's mount guard disables itself cleanly.
- **Adopted upstream code stays JavaScript** — `packages/mpd-agent-teams-plugin/{lib,_deps}/**` is
  MIT-licensed vendored bytes whose delta registry is byte-matched; converting it would break the
  provenance and the applier.
- **Vendored `lib/types/*.d.ts` are stale** against the delta-patched tree, so consumers use per-import
  `@ts-expect-error TS7016` with a reason rather than an authored ambient shim (measured: a shim would
  be a hand-maintained mirror of vendored code).
- **Generated and fixture artifacts stay JavaScript on purpose**, as declared in `AGENTS.md` §6.
- **Nothing was committed.** The wave is a working-tree change set; the single git writer is the
  captain, and the commit is the maintainer's call.
