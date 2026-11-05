# Release v0.17.4 — the supervision wave

Record of the release sweep, the staged npm publication and its one outstanding human step.

## Identity

| Field | Value |
|---|---|
| Version | `0.17.4` in all three carriers (`package.json`, `dsh-plugin.json`, `dsh-distribution.json`) |
| Release commit | `2c2f4a96` (release branch `release/v0.17.4`) |
| Master merge | `f2fc7db4` (`release: v0.17.4 — …`), merged `--no-ff` from `release/v0.17.4` |
| Annotated tag | `v0.17.4` (pushed) |
| Dev back-merge | `ea51a37e` (`master (v0.17.4)` back into `dev`) |
| GitHub Release | <https://github.com/HaroldZ32/My-Power-Dsh/releases/tag/v0.17.4> (not draft, not prerelease) |
| npm stage id | `13799395-562f-45c9-9e92-ed435a9fac95` — **staged, NOT public** |

## Static gates (run on the release commit)

| Gate | Observed |
|---|---|
| `bun run verify:gates` | PASS — 9/9 members green |
| `node scripts/verify-no-host-override.ts` | PASS — 0/0 collide with 214 host rows |
| `node scripts/verify-manual-paths.ts` | PASS — resolved=157 |
| `bun test packages` | **3607 pass / 0 fail** (240 files) |
| `bun run test:qa` | all self-tests passed |
| `bun run typecheck` | exit 0 |
| `node scripts/install-profile.ts --dry-run` | DRY-RUN done (nothing written) |
| `node scripts/pack-mpd.ts` + `verify-pack-closure.ts` | pack staged; closure **650 files compared, 650 identical, 0 drift** |

## Docker real-machine lanes (rootless Docker 29.8.2 / 29.9.2)

| Lane | Result | Evidence |
|---|---|---|
| `--mode source --require-docker --live` | **202 PASS / 0 FAIL** (pack freshness + its falsifiability control, live headless turn, `ui.replyRendered`) | `evidence/docker/client-install/2026-11-05T14-40-40Z/` |
| `--mode source --require-docker --no-browser` | **161 PASS / 0 FAIL** | `evidence/docker/client-install/2026-11-05T14-55-18Z/` |
| `--mode oneclick --require-docker --live` | **201 PASS / 0 FAIL** (incl. `pack.staticCoherence`: 661 carried files byte-identical; `oneclick.filesAllowlist`; `oneclick.distByteIdentical` 35/35) | `evidence/docker/client-install-oneclick/2026-11-05T15-31-34Z/` |

**First oneclick attempt** (`evidence/docker/client-install-oneclick/2026-11-05T15-05-55Z/`, left untracked):
`pack.staticCoherence` FAILED with `drifted=AGENTS.md,CHANGELOG.md,README.md,README.zh-CN.md,
dsh-distribution.json,dsh-plugin.json` — the lane builds a scratch git repository from the SHARED working
tree, and the tree was switched from `master` to `dev` (back-merge) while it ran. Re-run with the tree
pinned to `master`: green. This was a measurement race, not an artifact defect.

## Publishing — staged, approval pending

The `v0.17.4` tag push ran `.github/workflows/publish.yml` in STAGE mode: it asserted
`v<package.json version> == tag`, packed 1195 files (11.3 MB), published provenance to the sigstore
transparency log, and reported:

```
+ @mpd-dsh/mpd@0.17.4 (staged with id 13799395-562f-45c9-9e92-ed435a9fac95)
npm notice stage package @mpd-dsh/mpd@0.17.4 has been staged with tag latest
```

The workflow's own `npm stage list` step exits 401 by design (the trusted-publisher OIDC token cannot run
`npm stage` subcommands), so the id above comes from the staging step's output.

**The APPROVE step needs the maintainer's 2FA and cannot be a CI dispatch** — the workflow's approve mode
preflights `npm whoami` and refuses without a human credential; the local `~/.npmrc` token in this
environment is stale (`npm whoami` → 401). Run, as the maintainer:

```sh
npm stage approve 13799395-562f-45c9-9e92-ed435a9fac95
# then verify propagation before announcing:
npm view @mpd-dsh/mpd version
```

Nothing is public until that approval; `latest` does not move and no installable version exists yet.

## Bounds

- No cross-process supervision: a child started by another `dsh` process is invisible to this one.
- The `forceAfterMs` front-door residual: the knob is in the patch row config, mpd-config's
  `SettingsSchema` and the README table, but not in the shared `FIELDS` render list (the web settings card
  mirrors that list with count pins in `mpd-bundle-plugin`, outside the wave's scope); it is named as a
  residual in the package README.
- The release page was created before the stage approval, as §11 orders (announce, then publish); its text
  states that the registry version becomes installable on approval.
