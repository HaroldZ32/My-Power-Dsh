# F11 writer report — `skills/dsh-qa/scripts/bundle-lifecycle.ts`

UTC: 2026-10-20T10:14:44Z. Scope: this ONE file (no other file edited; no git write command run).

## Landed (F11 as written)

`runReal()` now creates three sandbox dirs and pins five sandbox-pointing env keys:

- `runDir = <sandbox>/run` → `XDG_RUNTIME_DIR` (the pnpm store OPERATION lock root)
- `npmCache = <sandbox>/npm-cache` → `npm_config_cache`
- `pnpmHome = <sandbox>/pnpm-home` → `PNPM_HOME`
- existing: `DSH_HOME = <sandbox>/home`, `HOME = <sandbox>/userhome`

The same five keys/values are recorded as `env` in the case's `result.json` (provenance for a future
FAIL). The credential key that `credentialEnv` injects is deliberately NOT recorded (AGENTS.md §10).

Effect measured: the install step that the audit sweep recorded as
`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` now completes (`install.ok: true`).

## Additional change required by the DoD's `bun` invocation (flag for the captain)

`dshAppSpec()` boots the harness with `process.execPath`, which is **bun** when the case is run with
`bun`. Bun cannot host this harness: measured `dsh: fatal uncaught exception: host preparation failed:
node-addon-require-builtin unsupported`. Under bun the case now spawns the `dsh` launcher shim instead
(its `#!/usr/bin/env node` makes the app a direct node child); under `node` the original
`dshAppSpec` path is unchanged. Without this the lane cannot boot at all under the DoD's command.

## Commands and observed results

| Command | Result |
|---|---|
| `bun skills/dsh-qa/scripts/bundle-lifecycle.ts --self-test` | exit 0 — `[bundle-lifecycle self-test] ok: …` (3 negative controls redden) |
| `bun skills/dsh-qa/scripts/bundle-lifecycle.ts` | exit **1** — `ok=false`; `result.json` written (see below) |
| `bun run typecheck` | exit 0 |
| `bun scripts/verify-comment-coverage.ts --file skills/dsh-qa/scripts/bundle-lifecycle.ts` | exit 0 — `VERDICT: PASS` |

## Why the real lane is still red (three pre-existing, out-of-contract assertions)

Each was reproduced independently of the F11 edit; none is caused by the sandbox env.

1. **`composed` — `default: mpd` is not the shipped contract.** `scripts/dump-config.ts` reports the
   host layer's `agent-preset-registry config.default: standard`; the bundle ships `preset-mpd`
   ADDITIVELY and never id-targets that host-owned row (zero-override decision, `presets/mpd.patch.yml`
   header, `verify-no-host-override`). The case's `composed.ok` demands `default: mpd`, so it can only
   pass by contradicting the contract. The same case's uninstall step already asserts
   `default: standard` — the two legs disagree.
2. **`boot.adapterProvided` / `boot.corpusFromBundle` — the evidence moved from stdout to the row log.**
   `rowLogLine()` writes to `<workspace>/.mpd/logs/<row>.log`, and the sink also rebinds fd 2 into that
   file. Measured in a sandbox with cwd=`<sandbox>`: the two markers exist in
   `.mpd/logs/mpd-dsh-adapter.log` and `.mpd/logs/mpd-bootstrap.log` and occur **0 times** in the
   `boot.log` the case reads — that file holds only stdout (the QA probe lines).
3. **`uninstall` — a benign empty pnpm scope dir is counted as residue.** After `dsh plugin remove`,
   pnpm 12.14.0 leaves `node_modules/@mpd-dsh/` as an EMPTY directory (the `mpd` link itself is gone).
   The residue loop records the parent `@mpd-dsh` path as residue, so `uninstall.ok` is false.

Repaired reproductions of (1) and (3), and the row-log locations for (2), were measured in
`.qa-reloc/probe-lifecycle` with the same env (that scratch dir was removed afterwards).

## Residual risks / hand-back

- The real lane cannot reach exit 0 without editing those three assertions. That is contract-level work
  (assertion 1 in particular must follow the shipped zero-override rule), so it is handed back rather
  than improvised here.
- This lane changes `skills/**`: the corpus `treeSha` is invalidated; the captain owns the wave's single
  `repin-vendor.ts --write --i-know-this-is-the-captains-step`.
- The bun boot fallback is an extra 9-line change needed for the DoD's `bun` command; revert it if the
  captain prefers the lane be documented as `node`-only.
