# Plan — wave `de-vendor-and-verify-law` (ACTIVE)

Branch: `feature/de-vendor-and-verify-law`, cut from `dev` at `cae00e5a` (which now carries the
PR #12 DAG work recovered by PR #13). ONE pull request to `dev`, bilingual body (English first).
This file is the wave's FROZEN CONTRACT: every lane reads it, no lane edits it.

## The user's instruction (verbatim, 2026-10-07)

> 脱去该项目对于Oh-my-openagent与dsh-agent-teams项目的源码的所有依赖及检查，文档里只写参考鸣谢与License；验证当前工作量门，现在貌似用户只要不提，不论如何都不会建队；不论如何工作量，帮我找一个办法尽量避免面向用户的主代理去直接写/验证代码，做这些事情由子代理去干，并且该插件的PRESET硬要求无论什么模式下，A写出来的一部分代码必须由B验证，两agent必须独立，且要求不直接看代码只看文档，若有问题打回去改

## Requirements conference — owner decisions (binding)

| # | Question | Owner's decision |
|---|---|---|
| 1 | The ported skill corpus (`skills/**`, 335 files) | **KEEP the corpus**; remove only the checks bound to the upstream IDENTITY. The corpus is this repository's own content now. |
| 2 | Upstream checks + the MCP build dependency | **Delete the identity checks outright** (VENDOR_LOCK identity fields, `verify-vendor` sections 1–3, the CI checkout step). The three MCP servers' sources are **snapshotted into this repo** so nothing outside the repository is ever needed again. |
| 3 | The vendored `dsh-agent-teams` body | **Relocate, then delete**: the schemastery validator (imported by four shipped plugins) and the prebuilt browser client bundle (used by the web team page) move into mpd-owned homes as our own code, keeping the MIT acknowledgement. |
| 4 | Enforcement strength for "the main agent must not write/verify code" | **HARD gate**: the top-level `mpd` agent's `write`/`edit` on CODE files is mechanically refused unless a delegation+verification loop is armed. A **counted** escape hatch exists; every use logs a row line. |
| 5 | The verifier's boundary ("docs only, never the code") | **Three layers + a two-way ratchet**: a blind bundle (contract + docs + a content-free artifact probe), a tool envelope (path-scoped read allowlist, NO `bash`, a whitelisted gate runner), and a ratchet that unlocks implementation reading ONLY after a FAIL verdict is recorded. |
| 6 | Scope of the A/B law | **EVERY mode** — solo, one-shot `mpd_role_spawn`, official team, ULW, ralph, workflow, headless. |

## Workstreams and lanes

| Lane | Workstream | Owner role | Write scope (disjoint) |
|---|---|---|---|
| A | W1 upstream decoupling + MCP source snapshot | Senior Engineer | `scripts/verify-vendor.ts`, `scripts/repin-vendor.ts`, `scripts/build-mcp.ts`, `scripts/bootstrap.ts`, `.github/workflows/gates.yml`, `VENDOR_LOCK.json`, `vendor/mcp-src/**`, `package.json` (description only) |
| B | W2 vendored-body strip + relocation | Deep Worker | `packages/mpd-agent-teams-plugin/**` (delete), `packages/mpd-schemastery/**` (new home), `packages/mpd-bundle-plugin/**`, `packages/mpd-config-plugin/**`, `packages/mpd-team-watchdog-plugin/**`, `packages/mpd-tui-plugin/src/**`, `bun.lock`, `scripts/{vendor-agent-teams,patch-agent-teams-fixes,patch-agent-teams-client,build-mpd-client,pack-mpd,reclaim-staged-teams,verify-dist-fresh,verify-pack-closure,verify-docs-parity,verify-comment-coverage,install-profile,run-qa-lanes}.ts`, `tsconfig.json`, `docker/**` |
| C | W3 complexity gate (why no team was ever created) | Junior Engineer | `packages/mpd-roles-plugin/src/complexity-gate.ts` + its tests, `skills/**` (THE WAVE'S SINGLE SKILLS WRITER — see below) |
| D | W4 the verification law | Lead | `packages/mpd-verify-plugin/**` (new), `packages/mpd-roles-plugin/src/verify-guard.ts` (new) + `src/index.ts`, `packages/mpd-team-core-plugin/src/**`, `presets/mpd.patch.yml`, `packages/mpd-dsh-adapter-plugin/src/index.ts` (only if a seam is genuinely missing) |
| E | Independent verification of every lane, doc-only | Reviewer | `.mpd/verify/**` (its own records only) |

`AGENTS.md` is owned by **Lane D** (single writer). `dist/**`, `dist/mpd-package/**` and
`VENDOR_LOCK.json` are DERIVED surfaces owned by the **integration task** (T-88).

## W3 — the measured root cause (do not re-derive)

`packages/mpd-roles-plugin/src/complexity-gate.ts` freezes `trigger = explicit flag OR
(matchedSignals >= 1)`. Its signals are English-centric: `CLAUSE_SEPARATOR_PATTERN` is
`/[\n\r;:,.]/u` and never splits on `、，。；：`, and the CJK verb lexicon is tiny. Applied to the
user's own Chinese instruction the predicate yields B=0, C1=0, C2=1, C3=0, and signal D reads the
`completed` boulder ledger — so **no trigger, no staged shell, no team, whatever the workload**.
That is the reported defect. The fix must be calibrated in BOTH directions over a corpus that gains
the user's verbatim instruction as a positive case.

## W4 — the law, in one paragraph

Code written by A is verified by B, where B is a DIFFERENT agent, B works from the frozen contract
and the docs (never from the implementation), B's evidence is black-box (gate/test output plus a
content-free artifact probe), B records `verdict` BEFORE any implementation reading, a FAIL unlocks
a counted implementation-reading window for diagnosis only, and a FAIL bounces the work back to a
writer as a `kind=repair` task with `sourceTaskId`/`sourceFindingIds`. A PASS with no cited doc
sources and no gate evidence is REFUSED by the record validator.

## Acceptance criteria

1. `node scripts/verify-vendor.ts` is GREEN on a machine with no upstream checkout, no network and no
   `.mpd-dsh/upstream`; every identity claim is gone from the exit code; the asset fingerprints this
   repo SHIPS still bind; a corrupted fingerprint still FAILS.
2. No file in the tree reads, copies, patches, fingerprints or audits `oh-my-openagent` sources or
   the `dsh-agent-teams` body; `.github/workflows/gates.yml` fetches no baseline; `bun install
   --frozen-lockfile` is green with the body deleted; `typecheck`, `bun test packages` and
   `node scripts/pack-mpd.ts` are green.
3. Attribution survives: `LICENSE-NOTICES.md`, `README.md`/`README.zh-CN.md` carry the
   acknowledgement of both upstreams; no functional claim of upstream parity remains.
4. The complexity gate fires on the user's own verbatim Chinese instruction (staged shell, named
   plan id) and still does NOT fire on the frozen simple prompts; both directions are asserted by
   `node skills/dsh-qa/scripts/session-start-team.ts --self-test` plus a live boot.
5. The law is mechanical: a top-level `mpd` agent's `write`/`edit` on a code path is DENIED while no
   delegation is armed, the counted escape works and logs, a verification record with
   `verifierId === writerId` or with an empty `sources[]` is REFUSED, a FAIL produces a repair task,
   and the verifier's `bash`/source-read attempts are DENIED.
6. Every lane's output carries an independent doc-only verification record produced by Lane E, and
   every FAIL has a repair task rather than a silent fix.
7. The wave's gates: `bun run verify:gates`, `bun test`, `bun run typecheck`, `bun run test:qa`,
   `bun run verify:docs`, `bun run verify:manifest`, `bun run verify:comments`,
   `node scripts/verify-manual-paths.ts`, `node scripts/pack-mpd.ts`, and the Docker lane LAST with
   `--require-docker`.

## Risks / order of operations

- **`skills/**` has ONE writer per wave** (§9). Lane C owns it; every other lane REQUESTS skills
  edits from Lane C and performs none itself. Exactly ONE `repin-vendor` re-pin per wave.
- The relocation must land in the SAME commit as the deletion, or `typecheck`/`bun test` redden.
- Deleting the body makes several gates VACUOUS (green with no subject) rather than red; each must be
  either re-pointed at a real subject or the vacuity must be declared in the PR body.
- `verify-docs-parity.ts` reads `packages/mpd-agent-teams-plugin/lib/mpd-deltas.ts` for its delta
  count derivation; its absence path was never exercised — Lane B must exercise it.
- The hard guard ships disabled for THIS wave's own writers: it takes effect at the next boot, so the
  wave can still be implemented by members. The default flips ON in the same PR; the captain restarts
  afterwards.
- Nothing is committed by a member: the captain is the ONE git writer (§5).

## Non-goals

- Deleting the ported skill corpus (owner decision 1).
- Removing the OFFICIAL `@deepseek-ai/dsh-experimental-*` team packages — they are the host's plugin
  and what team mode runs on; only the VENDORED `dsh-agent-teams` body is stripped.
- Chasing any upstream synchronisation.

## Captain's amendments, recorded mid-wave (2026-10-07)

1. **A3's "provenance + MIT notice" clause is CORRECTED — it was factually wrong.** Measured at the
   pinned commit by Lane A: `oh-my-openagent`'s own `LICENSE.md` is **SUL-1.0** (the licence this
   repository inherits); **6 of the 7** snapshotted packages declare NO licence field; only
   `lsp-daemon` self-declares MIT. The snapshot therefore records the MEASURED facts
   (`vendor/mcp-src/README.md`), and the MIT acknowledgement in this wave belongs to the
   dsh-agent-teams RELOCATION (Lane B). **A licence claim must never outrun the bytes.**
2. **`vendor/mcp-src/**` is deliberately NOT in `package.json`'s `files`.** It is a build-time input
   for a CHECKOUT; the published package ships the built `dist/` — not the ability to rebuild it from
   source. Declared bound, stated in the snapshot README and in the PR body.
3. **`package.json`'s `description` drops the word "pinned"**, which overstates the relationship now
   that no identity check exists: it reads "upstream reference: oh-my-openagent 8c57e46 — historical,
   no synchronisation owed". Owner: Lane B (Lane A finished before it landed; `package.json` is a
   single-writer file).
4. **`docs/plan-*.md` mentions of `MPD_UPSTREAM_ROOT` are PAST PROCESS RECORDS and must NOT be
   rewritten** — they describe what was true when they were written. Only the LIVE docs
   (`docs/development.md` + its `zh-CN` twin, whose vendor row still claims the gate needs the
   variable) get corrected.
