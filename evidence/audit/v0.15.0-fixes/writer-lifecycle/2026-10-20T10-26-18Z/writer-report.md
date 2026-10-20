# F11 + F12 writer report — `skills/dsh-qa/scripts/bundle-lifecycle.ts`

UTC: 2026-10-20T10:26:18Z. Scope: this ONE file (no other file edited; no git write command run).

## Landed

**F11 (sandbox env).** `runReal()` creates `<sandbox>/run`, `<sandbox>/npm-cache`,
`<sandbox>/pnpm-home` and spawns every child with `XDG_RUNTIME_DIR=<sandbox>/run`,
`npm_config_cache=<sandbox>/npm-cache`, `PNPM_HOME=<sandbox>/pnpm-home` (plus the existing
`DSH_HOME`/`HOME`). The five sandbox keys/values are recorded as `env` in `result.json`; the
credential key injected by `credentialEnv` is deliberately not recorded (§10). The audit's
`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` install failure is gone.

**Bun launcher fallback (kept per F12).** `dshAppSpec()` boots with `process.execPath`, which is bun
under `bun`, and bun cannot host this harness (`host preparation failed:
node-addon-require-builtin unsupported`). Under bun the case spawns the `dsh` launcher shim (its
`#!/usr/bin/env node` keeps the app a direct node child); node runs keep the original path.

**F12 (three stale assertions), same file:**

1. `composed`: now asserts the HOST default stays `standard` (`composed.includes("default: standard")`)
   and that the `mpd` preset is composed (`id: preset-mpd` + `@deepseek-ai/dsh-agent-preset`); it no
   longer demands `default: mpd`, which only a forbidden host id-target could produce.
2. Boot markers: the case reads `adapterEvidence = <sandbox>/.mpd/logs/mpd-dsh-adapter.log` and
   `bootstrapEvidence = <sandbox>/.mpd/logs/mpd-bootstrap.log`, each falling back to `boot.log` only
   when that row log is absent. `adapterProvided` and the corpus-path regex now use those; probe
   lines (`PRESET_*`, seams, tool call, verdict) still come from `boot.log`, where the probe writes.
3. Uninstall residue: new `isResidue(path)` helper — anything present except an EMPTY directory. The
   empty `node_modules/@mpd-dsh/` scope dir pnpm 12 leaves after pruning its last package is no longer
   residue; a surviving package, symlink or non-empty dir still is.

## Commands and observed results

| Command | Result |
|---|---|
| `bun skills/dsh-qa/scripts/bundle-lifecycle.ts --self-test` | exit 0 — `[bundle-lifecycle self-test] ok: …` (3 negative controls redden) |
| `bun skills/dsh-qa/scripts/bundle-lifecycle.ts` | **exit 0 — `[bundle-lifecycle] PASS`**, `result.json` `ok: true`, every step ok |
| `bun run typecheck` | exit 0 |
| `bun scripts/verify-comment-coverage.ts --file skills/dsh-qa/scripts/bundle-lifecycle.ts` | exit 0 — `VERDICT: PASS` |

Green-run steps: `install ok:true`, `composed ok:true`, `boot ok:true` (all eight checks true,
probe PASS), `noHomeCopy ok:true`, `layerDurability ok:true`, `uninstall ok:true` with `residue: []`.

## Evidence layout

- `result.json`, `output.log`, `boot.log` — the GREEN run (`evidence/dsh-qa/bundle-lifecycle/2026-10-20T10-25-58.033Z`).
- `result-before-f12.json`, `output-before-f12.log` — the F11-only run that was red on exactly the
  three assertions F12 repairs (`evidence/dsh-qa/bundle-lifecycle/2026-10-20T10-11-49.711Z`).
- `self-test.log` — the `--self-test` output above.

## Residual risks

- `skills/**` changed → the corpus `treeSha` is invalidated; the captain owns the wave's single
  `repin-vendor.ts --write --i-know-this-is-the-captains-step`.
- The case still hard-codes the port 3197 and boots the full bundle; a host already holding that port
  would redden the `http` check (pre-existing behaviour, untouched).
- `noPresetRefusal` still inspects `boot.log` only; row-log refusals (if any appeared there) would not
  be seen. Untouched, as F12 does not ask for it.
