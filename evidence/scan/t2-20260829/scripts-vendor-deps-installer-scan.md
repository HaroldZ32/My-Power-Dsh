# t2 scan — scripts, vendor, deps & installer logic (Researcher, 2026-08-29)

Scope per team DAG: `scripts/*`, VENDOR_LOCK.json, deps (package.json/bun.lock), installer
logic (install-profile.mjs / pack-mpd.mjs / vendor-agent-teams.mjs / bootstrap.mjs /
build-mcp.mjs / build-mpd-client.mjs), bundle patch consistency.

## Gate evidence collected

| Check | Command | Result |
|---|---|---|
| vendor gate (pinned checkout) | `MPD_UPSTREAM_ROOT=/root/dshProj/my-power-dsh/.mpd-dsh/upstream node scripts/verify-vendor.mjs` | PASS — commit 8c57e463…, version 5.0.0-beta.20, stats 9131 files/1470231 loc, all 6 asset fingerprints OK |
| installer self-test | `node scripts/install-profile.mjs --self-test` | PASS |
| installer real write (isolated) | `node scripts/install-profile.mjs --yes --dsh-home .qa-reloc/qa-install --skip-toolchain` | PASS — home patch parses as YAML, web-compat shim `@mpd-dsh/mpd` written, `mpd` preset copied, agent-teams row carries verbatim `profiles.mpd` roster (`taskPlanning: captain`) |
| bootstrap | `MPD_UPSTREAM_ROOT=… node scripts/bootstrap.mjs` | PASS |
| pack staging (inspect only) | read `dist/mpd-package/` | staged `cordis.patch.yml` == dev patch, no dev-path leaks, manifest exports/optionalDeps correct |
| upstream provenance | read `.mpd-dsh/upstream` (pinned 8c57e46) | `packages/omo-config-core` exists; `packages/mpd-config-core` does NOT; sources import `@oh-my-opencode/{mcp-stdio-core,utils,omo-config-core,lsp-core}` (24 sites) |

Environment note: `/root/dshProj/oh-my-openagent` is the OLD snapshot (f3642fc, beta.18);
the pinned checkout lives at `.mpd-dsh/upstream` (gitignored). The legacy default
`MPD_UPSTREAM_ROOT || repoRoot/../../..` resolves to `/` here — documented fallback,
improvement: auto-detect `.mpd-dsh/upstream`.

## Findings

### BLOCKER

- **B1 `scripts/build-mcp.mjs:23`** — `CORE` lists `"mpd-config-core"`; upstream ships only
  `packages/omo-config-core`. `cpSync` (line 48) throws ENOENT → script always crashes.
  Proven: `node -e` cpSync → `ENOENT lstat '.mpd-dsh/upstream/packages/mpd-config-core'`;
  introduced by scrub commit `7d8f910`.
- **B2 `scripts/build-mcp.mjs:54`** — `node_modules/@the upstream host` replaced the real npm
  scope `@oh-my-opencode` (same scrub). Upstream sources import `@oh-my-opencode/*` →
  module resolution impossible even after B1. Net effect: mpd-mcp-{astgrep,gitbash,lsp}
  dists can never be regenerated (current dists are pre-scrub builds, BUILD.lock
  `builtAt 2026-08-26T05:04:38Z`, textually patched by the scrub; no gate runs build-mcp).

### HIGH (user-facing provenance/legal corruption from scrub 7d8f910)

- **H1 `LICENSE.md:5`** — SUL-1.0 text garbled: "the the upstream host Software" (upstream
  original: "oh-my-opencode Software"). Ships in `dist/mpd-package/LICENSE.md`.
- **H2 vendored ATTRIBUTION files** (must stay verbatim per AGENTS.md):
  `skills/ultimate-browsing/ATTRIBUTION.md:3,41`, `skills/ulw-research/ATTRIBUTION.md:3,4`,
  `skills/frontend/ATTRIBUTION.md:3,6,120` — `@oh-my-opencode/shared-skills` →
  `@the upstream host/shared-skills`; grammar breaks "the the upstream project project".
- **H3** `skills/coding-agent-sessions/SKILL.md:20` — "OpenCode / the upstream project
  (formerly the upstream host)" (nonsense, added post-scrub in 5679fc4);
  `skills/ast-grep/README.md:133` — link display text garbled.

### MEDIUM

- **M1 `.gitignore`** — `.credentials.yaml` NOT ignored although scrub message claims
  "gains .credentials.yaml and .cg-qa/"; only `.cg-qa/` added. `git check-ignore
  .credentials.yaml` exit 1. Security-hardening gap (accidental `git add .`).
- **M2 `scripts/pack-mpd.mjs:30-37`** — cpDist silently `continue`s on missing plugin/MCP
  dist → bundle ships without the plugin and pack still prints PASS; should fail loudly.
- **M3 `scripts/vendor-agent-teams.mjs:50-66`** — rewrite misses `require("…")` and
  double-quoted `import "…"` forms; residual report (113-116) matches only `from` patterns.
  Evidence: `packages/mpd-agent-teams-plugin/_deps/schemastery/lib/index.cjs:1` retains bare
  `require("@deepseek-ai/cosmokit")` (latent: CJS require of schemastery would fail).

### LOW

- **L1** `scripts/verify-vendor.mjs:10` and `scripts/bootstrap.mjs:26` — "the the upstream" typos.
- **L2** `scripts/build-mcp.mjs:32` — `const want = entry.split("@")[1]` unused (dead code;
  "prefer exact version" comment unimplemented).
- **L3** legacy installer drift vs bundle: MCP rows lack `toolCallTimeoutMs`; no
  `mcp-context7`/`mcp-grepapp` rows; success message says "mpd-* presets" while only the
  `mpd` preset ships (`presets/mpd-headless` does not exist; the mpd preset is
  mode-agnostic so headless profiles still work — wording only).
- **L4** `tests/golden/out/plans/mpd-summary-plan.md:8` — garbled prose
  ("Neither upstream the upstream project (the locked commit nor the dev branch)");
  `tests/golden/out/` also holds `hello.txt`/`integration-review.md` (possible residue).
- **L5** `VENDOR_LOCK.json` `lockedAt` (2026-08-26) stale vs scrub refresh (2026-08-27).
- **L6** pack ships `packages/mpd-agent-teams-plugin/{test,self-fix-tests}/` in the bundle (bloat).

## Suggested fix cluster (for Lead t4)

Cluster "scrub/placeholder repair": restore real names in B2/H1/H2/H3 + fix B1 CORE entry
(`omo-config-core`), update `relocate-smoke.mjs:21` sentinel accordingly, add
`.credentials.yaml` to .gitignore (M1), make pack-mpd fail on missing dist (M2), extend
vendor-agent-teams rewrites to `require("…")` forms (M3), then re-run vendor gate
(asset treeSha will change for skills — deliberate re-lock with evidence).
