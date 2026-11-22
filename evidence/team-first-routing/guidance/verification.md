# T3 guidance verification

The old persona said, “When the gate does NOT trigger, run the session WITHOUT A TEAM: do not create a team and do not invent one.” The replacement asks the captain to identify owners, dependencies, write scopes, integration and verification for the whole request before the first consult. A follow-up inherits scope from the conversation. Substantial coordinated work goes through an appropriate live board or a populated, approved plan with owner dispatch. Activation and delivery need their own confirmation. Isolated work and a single bounded scope question retain the one-shot route.

The preset, repository manual, agent references and English/zh-CN guidance distinguish the inert plan shell, startup signals, completed-call staging and the concurrent public role/workmate check. The runtime owner confirmed the eligibility, configuration and default threshold used in the text. The operational fallback keeps consultations serial where the team surface is unavailable and asks the captain to identify verification gaps. The historical trace is in [historical-routing.md](./historical-routing.md).

## Instruction budget

Baseline sampled before T3 edits. Final values sampled at `2026-11-22T17:55:05Z` following the checks. Raw persona size covers content lines of the `prefix: >-` body with their original indentation and line endings, excluding the delimiter and trailing blank separator.

| Input | Before | After | Change |
|---|---:|---:|---:|
| `AGENTS.md` bytes | 61,750 | 60,887 | −863 |
| `AGENTS.md` margin below 65,536 bytes | 3,786 | 4,649 | +863 |
| Preset persona raw body bytes | 16,613 | 16,507 | −106 |
| Persona body bytes excluding initial 16-column indentation | 15,701 | 15,563 | −138 |

| Input | Baseline SHA-256 | Final SHA-256 |
|---|---|---|
| `AGENTS.md` | `09b3b1a9416c83900b5c6dbcb3d3be97c78cb5a9094334a878bc3473abacc8d4` | `7c802cc056db5a9dc645d8b2a2380930c2766141b86a22217c5806ae3f5c5ad1` |
| `presets/mpd.patch.yml` | `e5220560847869dcdcb33877a1ce2da7c76eee50d2c58901b9f3959bb410a17a` | `f632919b99162815402c2993a66d6d7bcba2b34ef1f99a16363948dbead325be` |

## Commands and observed results

Commands ran from the repository root with Node `v24.21.0` and `.qa-tmp/dsh-022/bin` prepended to `PATH`. Its `dsh --version` was `0.2.2-rc.5`, matching the distribution manifest's `host-base`. The pinned Bun was `.toolchain/node_modules/.bin/bun` version `1.4.0`.

| Command | Exit | Observed result |
|---|---:|---|
| `node scripts/verify-manual-paths.ts` | 0 | 166 resolved, 0 unresolved (baseline 165 resolved, 0 unresolved). [Log](./manual-paths.after.log) |
| `.toolchain/node_modules/.bin/bun run verify:docs` | 0 | 61 pairs, 0 failed, 0 violations, 0 dead links. [Log](./docs.after.log) |
| `.toolchain/node_modules/.bin/bun run verify:rows` | 0 | 37 row ids match the two patch layers. [Log](./rows.after.log) |
| `node scripts/verify-no-host-override.ts` | 0 | 0 collisions with 226 host-declared row ids. [Log](./no-host-override.after.log) |
| `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | 0 | 33 schema-checked rows, parity 28/28, persona prefix true, 6/6 negative controls. [Log](./preset-conformance.after.log) |
| `.toolchain/node_modules/.bin/bun skills/dsh-qa/scripts/session-start-team.ts --self-test` | 0 | Existing pure predicate and persona literal checks passed. Four negative controls reddened. [Log](./session-start-team.after.log) |
| `git diff --check -- <T3 tracked paths>` | 0 | No whitespace findings. |

At `2026-11-22T18:08:11Z` the two instruction-file hashes still matched. After the runtime author confirmed the exact behavior, the docs and references were aligned on the first-turn-only F hint, the later repair signal's prior-activity requirement, and `TEAM_FIRST` recovery. They distinguish an absent Team tool, which bypasses the overlap check, from unavailable plan inspection or staging, which can still defer excess calls. The bilingual docs gate and scoped diff check were repeated and both exited 0.

Pre-edit logs for manual paths, doc parity, preset conformance and the startup rule are alongside the post-edit logs. These writer checks cover instruction bytes, bilingual parity, row ids and the existing offline prompt and predicate contracts. This lane's baseline record is retrospective. The integrated runtime and isolated mounted team delivery are the separate reviewer task T4.
