# Red gates G1–G5 — branch `fix/surfaces-config`

Wave register: `evidence/review/defect-wave-20261006/FINDINGS.md`, read from the committed blob
`9504aa61` (the file is not on this branch's disk). My half is the **red gates** section: G1–G5.
Findings S1–S9 (the first writer's) and T*/E* are out of scope and were not touched.

Scope actually written: `skills/dsh-qa/scripts/{bundle-lifecycle,extension-lifecycle,preset-register}.ts`,
`skills/programming/scripts/typescript/check-no-excuse-rules.ts` + the new
`skills/programming/scripts/typescript/typescript-unstable.d.ts`, and this evidence directory.
No `packages/**` file was written. `dist/mpd-package/**` (G5) is gitignored by `.gitignore:12`.

## Baseline → after

| Gate | Baseline (captain's sweep) | After this work | Where |
|---|---|---|---|
| `bun run test:qa` | FAIL — 3 of 48 (`bundle-lifecycle`, `extension-lifecycle`, `preset-register`) | **1 of 48** — the three G cases are green; the one red is `agent-teams-messaging` on the PENDING re-pin (below) | `outputs/test-qa.log` |
| `bun run typecheck` | FAIL — 4 errors in `skills/programming/**` | **0 errors, exit 0** | `outputs/typecheck.log` |
| `bun run verify:docs` | green | green (`failed=0 violations=0 dead=0`) | `outputs/verify-docs.log` |
| `bun run verify:comments` | green | green (`VERDICT: PASS`) | `outputs/verify-comments.log` |
| `bun run verify:gates` | FAIL — `vendor` needs an upstream checkout | **7/8 members pass; `vendor` alone fails** on the absent `MPD_UPSTREAM_ROOT` (environmental, unchanged) | `outputs/verify-gates.log`, `outputs/verify-vendor.log` |
| `node scripts/verify-pack-closure.ts` | FAIL — 2 TREE-DRIFT (stale local pack) | see the G5 section | `outputs/pack-closure.log` |

---

## G1 — `bundle-lifecycle` asserted a RETIRED expectation

**Conclusion.** The ASSERTION was stale, not the code. `skills/dsh-qa/scripts/bundle-lifecycle.ts`
required a column-0 `- id: agent-preset-registry` in `cordis.patch.yml` with `default: mpd`. The
shipped patch has neither: `9e91beb3` ("one adapter per plane, zero host overrides", 2026-10-03,
DEV-ONLY) removed that id-target under the strict zero-override decision, because the id is declared
by a HOST layer (`@deepseek-ai/dsh-web-app`'s own patch) and an id-target REPLACES the host's
`default: standard` — the policy `scripts/verify-no-host-override.ts` now enforces. The patch file
says so in its own header; the shipped bundle is additive-only (`presets/mpd.patch.yml`, the
`preset-mpd` row) and making `mpd` the deployment default is a USER action (`docs/preset-default.md`).

**Change.** The check became a pure predicate over patch TEXT, `presetContractViolations(mainPatch,
presetPatch)`, with three legs: (a) NO `- id: agent-preset-registry` at column 0; (b) NO row whose
`name:` is `@deepseek-ai/dsh-agent-presets`; (c) the `preset-mpd` row on
`@deepseek-ai/dsh-agent-preset` still declares `config.id: mpd` and its inline `plugins:` list. File
header and the self-test's summary line were updated to describe the shipped contract.

**Observed.**
- before: `FAIL: self-test: the agent-preset-registry id-target (default: mpd) is missing from the bundle patch`
- after: `ok: … preset-selection contract (NO host-owned agent-preset-registry id-target, no retired
  preset-ROOT row, preset-mpd row with config.id: mpd; 3 negative controls redden) …` → `exit=0`
  (`outputs/g1-self-test.log`)

**FALSIFIER (what reddens it now).** Three in-process negative controls run on every `--self-test`
(each `fail()`s if it does NOT redden): re-adding `- id: agent-preset-registry` at column 0; adding a
row named `@deepseek-ai/dsh-agent-presets`; stripping `config.id: mpd` from the `preset-mpd` row. Plus
an END-TO-END control over the real file: the retired id-target appended to `cordis.patch.yml` makes
the case exit 1 with `[id-target] the main patch id-targets \`agent-preset-registry\` at column 0 — a
HOST-owned id; this bundle is additive-only`, and the file was restored byte-identically
(`sha256 4bc05f0c…` before == after). Transcript: `outputs/falsifier-e2e.log`.

## G2 — `extension-lifecycle` asserted a contract R5 SUPERSEDED

**Conclusion.** The ASSERTION was stale, not the code. The case required `/FATAL/` on the row's
STDOUT when a seam is unavailable. That predates R5 ("no MPD diagnostic may reach the terminal"),
which is itself gated by `packages/mpd-dsh-adapter-plugin/test/no-terminal-writes.test.ts` (a NEW
`console.*` / `process.stdout.write` in an MPD runtime path fails it). The two were in DIRECT
conflict: a row satisfying the old case would fail the R5 gate. The row is R5-correct today —
`warn()` in `packages/mpd-ext-plugin/src/index.ts` routes through `rowLogLine("mpd-ext", …)`, which
appends to `<workspace>/.mpd/logs/mpd-ext.log`. Measured in a sandboxed root: the row wrote
**nothing** to stdout and the log file carried both FATAL lines (the seam self-check and the
`only 0/4 tools registered` derivation).

**Change.** `seamRegressionCheck` now applies the built row against the hostile ctx inside a
sandboxed workspace root (the adapter's documented `DSH_WORKSPACE_ROOT` operator/QA override; the
env var and every replaced console/stream writer are restored in a `finally`) and asserts four
things: `inject` declares `tools` + `skills`; the ROW'S OWN LOG FILE carries `/FATAL/`; the terminal
writes observed (console `log/info/warn/error/debug`, `process.stdout.write`,
`process.stderr.write`) are EMPTY; and the log does NOT carry the `mpdExtensions provided` success
summary. Two mutants were added to the self-test's falsifier set.

**Observed.** before: `FAIL: an unavailable seam must be reported LOUDLY on stdout, not only through
ctx.logger.warn`. After, `exit=0` with the four mutants' reasons printed (`outputs/g2-self-test.log`):
```
mutant pre-fix inject        -> the built row must declare the seams it registers through (inject must include tools and skills; got [])
mutant muted row log         -> an unavailable seam must be reported LOUDLY in the row's own log (…/.mpd/logs/mpd-ext.log), not only through ctx.logger.warn — R5 sends every MPD diagnostic to <workspace>/.mpd/logs/, never to the terminal
mutant terminal write added  -> R5: an MPD row must write NOTHING to the terminal, but this row wrote ["console.log: [mpd-ext] FATAL: the harness seams are unavailable"]
mutant forced success branch -> the success summary must never be logged when the four tools did not register
```

**FALSIFIER (what reddens it now), both directions.** The FILE direction: muting the row's file sink
(the compiled `rowLogLine("mpd-ext", text2)` call removed) reddens it. The TERMINAL direction: adding
one `console.log` on the FATAL path reddens it while the file leg stays green — so the two halves are
separately checked, not one check wearing two names. The false-success half: forcing the success
branch reddens it. All three run on every `--self-test`.

## G3 — `preset-register` devFlavor MCP operand mismatch

**Conclusion.** The EXPECTATION was stale, not the rewrite. The failing loop pinned four MCP launchers
that the dev-flavored main patch must carry checkout-absolute, and one fixture still named
`packages/mpd-mcp-gitbash/dist/cli.js`. The SHIPPED `cordis.patch.yml` names
`packages/mpd-mcp-gitbash/dist/launch.js` — commit `7c1076f3` ("ship the MCP launchers as built
artifacts") rewrote that operand, and the other three rows already read `dist/launch.js`. The rewrite
itself is correct and uniform (it consumes the whole packed `"/node_modules/@mpd-dsh/mpd/…` operand
plus the `baseUrl` prefix, which is why three of the four fixtures matched). The stale name still
passed the loop's `existsSync` leg because the LEGACY `dist/cli.js` is still pinned in
`VENDOR_LOCK.json` as a single-file build artifact — the file exists; it is simply no longer the
operand the patch ships.

**Change.** The fixture entry is now `mpd-mcp-gitbash/dist/launch.js`, moved into a named
`MCP_LAUNCHERS` list with the why-comment (never derived from the patch — a derived expectation would
re-state the rewrite instead of checking it). The operand test became the pure predicate
`missingMcpOperands(text)` with a negative control: the patch as DECLARED (before `devFlavor`) must
carry NONE of the four checkout-absolute operands, or the control fails.

**Observed.** before: `FAIL: devFlavor MCP operand is not the checkout-absolute
mpd-mcp-gitbash/dist/cli.js`. After: `ok: roster fixtures + 2 declared bundle patches rewritten to
checkout-absolute operands + preset row intact + retired preset-root service absent` → `exit=0`
(`outputs/g3-self-test.log`).

**FALSIFIER (what reddens it now).** Reverting the shipped git-bash operand to the legacy
`dist/cli.js` makes the case exit 1 with `devFlavor MCP operand is not the checkout-absolute
mpd-mcp-gitbash/dist/launch.js`, and the un-rewritten-patch control fails if the rewrite ever stops
consuming the packed operand. Both were executed; the patch was restored byte-identically
(`sha256 4bc05f0c…` before == after). Transcript: `outputs/falsifier-e2e.log`.

## G4 — `typecheck`: 4 errors in the vendored `skills/programming` corpus

**Conclusion.** The SCRIPT was stale relative to this repository's installed toolchain — the file
itself, not the expectation. The root cause is a one-package name: this repository deliberately
installs NO package named `typescript` (its TypeScript 5 alias is `typescript5`, so nothing shadows a
caller's TypeScript 7 — CHANGELOG "A canonical TypeScript plugin"), while the TypeScript 7 API it
DOES install is `@typescript/native-preview` — the package behind `node_modules/.bin/tsgo`, the
compiler `bun run typecheck` runs — which publishes the same `unstable/ast` + `unstable/async`
subpaths. So the static `typescript/unstable/*` imports resolved to nothing (TS2307 ×3), and
`node.modifiers?.some((m) => …)` inherited `any` from the unresolved AST module (TS7006).

**Change (the preferred resolution fix, not an exclusion).**
1. `skills/programming/scripts/typescript/typescript-unstable.d.ts` — a vendored, type-only shim that
   maps the two `typescript/unstable/*` specifiers onto `@typescript/native-preview/unstable/*`. It
   emits nothing, changes no runtime resolution, and the reason is written in the file (including
   that a corpus refresh from upstream drops it and re-reddens the gate).
2. `check-no-excuse-rules.ts` — the runtime resolution now walks a declared candidate list,
   `TS7_PACKAGES = ["typescript", "@typescript/native-preview"]`, caller-first, and the exit-2 message
   names every candidate tried. This is the "guarded dynamic import with a declared fallback" half:
   it makes the checker actually usable against THIS repository instead of exiting 2.
   `tsconfig.json` is UNCHANGED — no exclusion was taken.

**Observed.**
- before: `error TS2307 … 'typescript/unstable/ast'` ×2, `'typescript/unstable/async'` ×1,
  `error TS7006: Parameter 'm' implicitly has an 'any' type` → `exit=1`.
- after: `$ tsgo --noEmit` with no diagnostics → `exit=0` (`outputs/typecheck.log`).
- runtime, caller = this repo (which has no `typescript`): `node
  skills/programming/scripts/typescript/check-no-excuse-rules.ts <clean file>` → `No violations in 1
  file(s).` exit 0; on a file containing `as any` → `[no-any-assertion] …` exit 1; the same command
  from the committed `HEAD` copy → `error: cannot resolve "typescript" …` exit 2.
- runtime, caller with NEITHER package: still exit 2, now naming both candidates:
  `Tried: typescript (not resolvable from the caller), @typescript/native-preview (not resolvable from
  the caller).`

**Bound.** Upstream's third contract case ("the caller genuinely lacks typescript → exit 2") still
holds only when the caller lacks BOTH names. That widening is deliberate and stated in the script's
header: `@typescript/native-preview` IS the TypeScript 7 API, so a caller providing it is not a caller
lacking TypeScript 7.

## G5 — re-pack the local artifact

`dist/mpd-package` is GITIGNORED (`.gitignore:12`), so this is a local artifact, not a commit.
Re-packed with `npm run pack` AFTER every other write on this branch; the reading is in
`outputs/pack-closure.log` and is repeated here:

`npm run pack` → `[pack-mpd] staged package -> …/dist/mpd-package (out-dir source: default
(<repo>/dist/mpd-package))`, exit 0, 1248 files (`outputs/pack.log`).

BEFORE (`outputs/pack-closure-before.log`, exit 1, stamp `2026-10-04T04:11:29.290Z`) — the two
TREE-DRIFT entries the register named, nothing else:
```
TREE-DRIFT - docs/ differs from the source tree - dropped by the pack: plan-webui-tui-i18n.md; not in the source: (none)
TREE-DRIFT - agent-references/ differs from the source tree - dropped by the pack: glossary.md, installer-and-profiles.md, overview-and-provenance.md, plugin-authoring.md, qa-discipline.md; not in the source: (none)
```

AFTER (`outputs/pack-closure.log`, **exit 0**) — no TREE-DRIFT line at all, and the freshness
discriminator T-26 names is empty:
```
TREE-DRIFT count: 0
[verify-pack-closure] ok: … content bytes: 1234 file(s) compared, 1234 identical, 0 drift,
0 expected-after-pack; completeness: 450 declared source file(s) compared, 449 present,
1 declared exemption(s), 0 absent; pack stamp 2026-10-06T13:09:24.542Z …
```
New stamp: **`2026-10-06T13:09:24.542Z`** (was `2026-10-04T04:11:29.290Z`). The pack was run TWICE —
the first re-pack, then once more after a review-driven `finally` fix inside the G2 helper — and the
reading above is the SECOND (final) pack, so it is the one that is last. The pack writes nothing into
the tracked tree: the one file it generates (`validator.js`) lands inside the gitignored
`dist/mpd-package/` (`.gitignore:12`), and `node scripts/verify-dist-fresh.ts` still reports
`29/29 targets fresh` after it (`outputs/dist-fresh-post-pack.log`, exit 0).

The integration bound from the register still holds: the pack is derived from ONE tree, so after all
three branches merge, one more re-pack must land at integration — the pack cannot be green for three
divergent trees at once.

---

## THE RE-PIN

**A VENDOR_LOCK re-pin IS REQUIRED.** `skills/**` is the single-writer tree and my four files are its
only change on this branch (3 edited + 1 added = 334 → 335 files). `node scripts/repin-vendor.ts`
(DRY RUN, uncaptained flags only — nothing was written) derives exactly one asset delta:

```
asset skills: locked 501534fa38c273a31a42dae9c1977b2da28803fd0880b9597b52bd176f2b0244 / 334
              computed f8d30d9665d8ca98fb9f6e052d996b03c15c407840fea5e08ec775022b3cdfb1 / 335 (1 file LF-normalized)
asset packages/mpd-agent-teams-plugin/_deps: in sync — no change
DRY RUN: 1 asset(s) would be re-pinned; nothing was written
```
(`outputs/repin-vendor-dry-run.log`. The `--write` flag is the captain's step and was NOT run;
`VENDOR_LOCK.json` was NOT hand-edited.)

Consequence measured: `bun run test:qa` now reports ONE red case, `agent-teams-messaging.ts`, whose
own assertion is the freshness of that lock —
`[agent-teams-messaging] FAIL: VENDOR_LOCK skills asset is stale: lock=334/501534fa38c2 tree=335/f8d30d9665d8 (re-pin in the same commit, AGENTS.md §9)`.
It is the re-pin gate firing on my skills edit, and it is expected to clear with the captain's single
re-pin. NOTE: that case `fail()`s at the lock assertion and stops there, so whether its REMAINING
assertions pass is UNVERIFIED until the re-pin lands.

## Named, not implied fine

- **The three REAL runs did NOT go green, and none of the three failures is caused by this work.**
  - `bundle-lifecycle` real arm: blocked in the INSTALL step by
    `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK … Read-only file system (os error 30)` from
    `dsh plugin add` → `pnpm add`. Reproduced with ZERO QA code involved (plain `pnpm add` in a
    scratch dir); it succeeds with the real `HOME` and fails with a sandboxed `HOME`, i.e. QA's HOME
    isolation against this session's workspace-write file sandbox. Every `.qa-reloc/bundle-lifecycle-*`
    sandbox since 2026-10-04 (six of them, three predating this branch's edits) lacks `pnpm-store`,
    so the install step has been failing the same way throughout. The real arm's assertions were never
    reached, so they are UNVERIFIED here.
  - `preset-register` real arm: `ok=false` in ALL FOUR recorded runs — `2026-10-06T02:48`, `04:10`,
    `10:57` (all BEFORE my edit) and `13:01` — with the identical shape (`presetLine` empty,
    `exit=0`, no home copies). Pre-existing; my change touched the self-test arm only.
  - `extension-lifecycle` real arm: `install=true main=false failure=false isolation=false packed=true`
    in four runs from `2026-10-04T04:08` onward, with the SAME main-arm reason before and after my
    edit: `the harness recorded no tool/call for mpd_ext_list (answer-only narration is not tool
    evidence)`. Pre-existing; my change touched the self-test arm only.
  - These generated two evidence directories of their own (`evidence/dsh-qa/preset-register/2026-10-06T13-01-14.800Z/`,
    `evidence/extensions/extension-lifecycle/2026-10-06T13-01-14.962Z/`); they are honest records of
    the red runs and are left in place for the captain to keep or drop.
- `node scripts/verify-vendor.ts` cannot pass on this machine at all
  (`upstream checkout not found at /home/haroldzhao`); not chased, per the task.
- `bun test packages` was NOT run: no `packages/**` file was written by this half, and the first
  writer's 774-test green reading already covers the tree.
