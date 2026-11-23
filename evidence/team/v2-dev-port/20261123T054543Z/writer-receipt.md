# V2 runtime port writer receipt

The candidate is based on `origin/dev` at `e86764c0` on `feature/v2-runtime-recovery`. The November 23 runtime patch and four captain wake files supply the input. The port covers Cellwork two-board reseed and guarded same-owner wake, Team plan admission and DAG materialization, and the captain’s one-shot wake and in-turn wait. This receipt records writer-side checks. The mounted behavior verdict belongs to a separate verifier.

## Port decisions

`git apply --check` identified six non-applicable paths. The writer applied the rest without `--index` and byte-compared the four new files with their input copies using `cmp`. The writer reconciled the V2 hunks in `plan-store.ts`, `team-actions.ts`, `team-web.ts`, `agent-references/supervision.md`, and `presets/mpd.patch.yml` in place. The sixth path, `VENDOR_LOCK.json`, was regenerated on dev with the authorized re-pin command.

Dev lacks the resumable Team approval checkpoint introduced in `b5bb7a63` and `4ff9cde0` from PR #119. This port runs the new validation before dev’s existing approval effects, uses the shared resolver to bind staged references to actual board IDs, and returns the warning through dev’s tool and Web approval paths. The corresponding test exercises forward edge and repair-source materialization through dev approval. The imported live-append test checks that a completed task’s history stays intact. The approval-retry control requires the PR #119 checkpoint and was excluded from this candidate. No runtime dependency on PR #119 was required for the scoped V2 behaviors. The two branches edit overlapping approval paths.

New approvals refuse unresolved and ambiguous staged blockers before side effects. Bulk all-root plans need explicit independence. Generic append-only root plans can still proceed with an advisory. The strict rules and existing record formats are covered by the imported tests.

## Replay and results

Run from the candidate root with its installed dependencies, Bun 1.4.0 at `.toolchain/node_modules/.bin/bun`, and DSH 0.2.2-rc.5 first on `PATH`. The three generated outputs were built with the repository-root arguments below.

```sh
for pkg in mpd-cellwork-plugin mpd-dsh-adapter-plugin mpd-team-core-plugin; do
  .toolchain/node_modules/.bin/bun build "packages/$pkg/src/index.ts" --target node --format esm --outfile "packages/$pkg/dist/index.js"
done
sha256sum packages/mpd-{cellwork,dsh-adapter,team-core}-plugin/dist/index.js VENDOR_LOCK.json
```

| File | SHA-256 |
| --- | --- |
| `packages/mpd-cellwork-plugin/dist/index.js` | `6f38495cb06a2919e2cf948dc4b96813eaa12abd66bf3c793dfd71691022d4d9` |
| `packages/mpd-dsh-adapter-plugin/dist/index.js` | `000aaa547de62247681b8a332a25960d87439432eae066b832876e9e3295284b` |
| `packages/mpd-team-core-plugin/dist/index.js` | `3320696adeb35e58a21713750abc5d72dabac0641c72da28dec5b339e7fc9d77` |
| `VENDOR_LOCK.json` | `14a03307e2d2da2959827dff968e2366bfa8ef0011488c7cc9825be99daac8e9` |

`node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step` updated only `skills.treeSha` at line 8, from `a093c32355ed2e5c3cdf5408557c4db50c81104de996961b4f1d17e161061440` to `1db578117f9d08ecce753396b71b46092070250ae5cdc377786151274234689d`. The skills count remained 393.

| Command | Observed result |
| --- | --- |
| `.toolchain/node_modules/.bin/bun test ./packages/mpd-team-core-plugin ./packages/mpd-cellwork-plugin ./packages/mpd-dsh-adapter-plugin` | Exit 0. 1,563 passed across 112 files. |
| `.toolchain/node_modules/.bin/bun test ./packages/mpd-team-core-plugin/test/task-dependency-guard.test.ts ./packages/mpd-team-core-plugin/test/team-record.test.ts ./packages/mpd-team-core-plugin/test/captain-wake.test.ts` | Exit 0. 86 passed across three files. |
| `.toolchain/node_modules/.bin/bun run typecheck` | Exit 0. `tsgo --noEmit` passed. |
| `node scripts/verify-dist-fresh.ts` | Exit 0. 35 of 35 targets fresh and deterministic. The prebuilt CodeGraph server is outside the rebuild map. |
| `node scripts/verify-vendor.ts` | Exit 0. All eight shipped assets matched. |
| `node scripts/verify-comment-coverage.ts` | Exit 0. 652 TypeScript files and 60,182 declarations checked. |
| `node scripts/verify-docs-parity.ts` | Exit 0. 61 pairs and zero unresolved links. |
| `node scripts/verify-rows-parity.ts` | Exit 0. 37 row IDs match. |
| `node scripts/verify-plugin-manifest.ts --pack` | Exit 0. 1,276 files in dry-run pack and all runtime paths present. |
| `node scripts/verify-no-host-override.ts` | Exit 0. Zero bundle ID targets of 226 host row IDs. |
| `node scripts/install-profile.ts --dry-run --dsh-home "$scratch/dsh-home"` | Exit 0 with `HOME="$scratch/user-home"` and a fresh scratch directory. |
| `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | Exit 0. 33 host rows conformed to installed schemas, parity 28/28 and six negative controls rejected. |
| `node skills/dsh-qa/scripts/surface-pin.ts --self-test` and `node skills/dsh-qa/scripts/surface-pin.ts` | Both exit 0. The static pin found the `wake` verb and parameter, and mutation controls exercised `wake`, `fence`, and `end`. |
| `.toolchain/node_modules/.bin/bun ./skills/dsh-qa/scripts/team-dispatch-guard.ts --out "$scratch/dispatch"` | Exit 0. All 20 fixture and real-store checks passed. |
| `git diff --check` | Exit 0. |

For a credential-free real Web mount, create a fresh scratch directory with a `user-home` subdirectory, use an available local port, and run the existing conformance driver. It creates separate homes and workspace roots for both arms. The positive arm authenticated to the local gateway, created an `mpd` session with HTTP 200, found `agentPreset=mpd` in the persisted session header, and found zero mount-failure signatures. Its deliberate invalid-persona arm returned `agent-preset/invalid`. The command exited 0. This boot checks preset mounting. Behavioral event delivery and same-owner live recovery are measured separately.

```sh
MPD_QA_PRESET_PORT=43023 env -u DEEPSEEK_API_KEY -u OPENAI_API_KEY -u ANTHROPIC_API_KEY \
  HOME="$scratch/user-home" DSH_HOME="$scratch/user-home/.dsh" \
  node skills/dsh-qa/scripts/preset-conformance.ts
```

## Broader checks with limits

| Command | Observed result |
| --- | --- |
| `.toolchain/node_modules/.bin/bun test` | Exit 1. 4,442 passed, six skipped, 29 failed and ten errors across 321 files. Unfiltered discovery included historical `evidence/` fixtures, with missing imports and unrelated fixture failures. The unchanged CodeGraph fallback-to-cwd test also timed out. |
| `bun test ./packages` with the pinned Bun directory and pinned DSH directory on `PATH` | Exit 1. 4,220 passed, six skipped and one failed across 269 files. The unchanged `mpd-mcp-shared` real toolchain probe expected `sg` to fail its ast-grep probe, but the installed wrapper passed. |
| `bun run test:qa` with the pinned Bun and DSH directories on `PATH` | Exit 1. One of 58 cases failed. The unchanged `codegraph-smoke.ts` case rejects fixture paths under `.mpd`, which includes this worktree. Four cases printed prerequisite skips for the staged pack or external TUI spec checkout. |
| `node scripts/verify-manual-paths.ts` | Exit 1 on `.git/HEAD`, since this linked worktree uses a `.git` file. Running the same gate with `--manual` pointing at the `e86764c0` text and `--root` pointing at the same worktree gave the same single unresolved path. The additional `agent-references/supervision.md` link resolved. |

## Candidate file inventory

- Root and reference files `AGENTS.md`, `VENDOR_LOCK.json`, and `agent-references/supervision.md`.
- Bilingual documentation `docs/cellwork.md`, `docs/cellwork.zh-CN.md`, `docs/user-guide.md`, `docs/user-guide.zh-CN.md`, and both READMEs in each of `packages/mpd-cellwork-plugin` and `packages/mpd-team-core-plugin`.
- Cellwork sources `src/caller.ts`, `src/protocol-core.ts`, `src/protocol.ts`, tests `test/reseed-binding.test.ts` and `test/supervise-lossless.test.ts`, and `dist/index.js` in `packages/mpd-cellwork-plugin`.
- Adapter source `src/index.ts` and `dist/index.js` in `packages/mpd-dsh-adapter-plugin`.
- Team sources `src/dependency-guard.ts`, `src/index.ts`, `src/plan-store.ts`, `src/team-actions.ts`, `src/team-web.ts`, and `src/tool-cards.ts`, tests `test/task-dependency-guard.test.ts`, `test/team-record.test.ts`, `test/tool-dag-surface.test.ts`, and `test/tool-surface.test.ts`, and `dist/index.js` in `packages/mpd-team-core-plugin`.
- Preset guidance `presets/mpd.patch.yml` and the sole skill corpus edit `skills/dsh-qa/scripts/surface-pin.ts`.

The four untracked product files to stage are `packages/mpd-team-core-plugin/src/captain-event-wait.ts`, `packages/mpd-team-core-plugin/src/captain-wake-store.ts`, `packages/mpd-team-core-plugin/src/captain-wake.ts`, and `packages/mpd-team-core-plugin/test/captain-wake.test.ts`. This receipt is also untracked at handoff. The untracked `node_modules` symlink is local tooling. Raw runs and session details were kept in ignored scratch directories. The Git index was empty at handoff.
