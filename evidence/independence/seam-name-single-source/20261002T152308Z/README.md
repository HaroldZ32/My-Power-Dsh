# LANE D — independence: single-sourced seam names + the counted-inventory gate

Plan: `.mpd/plans/mpd-seam-convergence.md` TODO 4 (acceptance A1.3 / A2.1).
Captured: 2026-10-02, UTC 15:23–15:28Z. Repository: `my-power-dsh` @ `dev` working tree.

## 1. What was changed

### 1.1 The adapter is the ONE source of the harness seam names

`packages/mpd-dsh-adapter-plugin/src/index.ts` gained nine declared constants, a set, a union type and
one helper, all immediately after the row's own `inject` declaration:

* `DSH_SEAM_TOOLS`, `DSH_SEAM_SUBAGENTS`, `DSH_SEAM_SKILLS`, `DSH_SEAM_AGENTS`, `DSH_SEAM_COMMANDS`,
  `DSH_SEAM_SESSIONS`, `DSH_SEAM_WEB_SERVER`, `DSH_SEAM_WEB_RUNTIME`, `DSH_SEAM_AGENT_PRESETS`;
* `DSH_SEAM_NAMES` (the readonly set a gate iterates — the coupling gate imports it, so the gate and
  the rows share ONE vocabulary);
* `DshSeamName` (the union), and `dshSeamInject(...names)` returning a FRESH `string[]` with the ids
  verbatim.

### 1.2 The rows

15 rows had their `export const inject` rewritten onto those constants. No behaviour change is
claimed — it is MEASURED (`dist-inject-runtime.txt`): every rebuilt `dist/index.js` was imported and
its `inject` printed, and the arrays carry the identical strings:

```
mpd-boulder-plugin        inject=["tools"]
mpd-roles-plugin          inject=["tools","subagents"]
mpd-roster-provider-plugin inject=["subagents"]
mpd-bootstrap-plugin      inject=["skills"]
mpd-better-sidebar-host   inject=["webServer","sessions","webRuntime","tools"]
mpd-ext-plugin            inject=["tools","skills"]
```

Edited: `mpd-boulder-plugin`, `mpd-comment-checker-plugin`, `mpd-config-plugin`, `mpd-hashline-plugin`,
`mpd-memory-plugin`, `mpd-modelchain-plugin`, `mpd-team-compact-plugin`, `mpd-tools-plugin`,
`mpd-roles-plugin`, `mpd-ulw-plugin`, `mpd-workmate-plugin`, `mpd-roster-provider-plugin`,
`mpd-bootstrap-plugin`, `mpd-better-sidebar-host`, `mpd-ext-plugin`.

**`mpd-ext-plugin` keeps its `REQUIRED_SEAMS` shape on purpose.** `REQUIRED_SEAMS` is now
`[DSH_SEAM_TOOLS, DSH_SEAM_SKILLS] as const` and `inject` still reads `[...REQUIRED_SEAMS]`, because
`skills/dsh-qa/scripts/extension-lifecycle.ts` mutates the exact built text
`var inject = [...REQUIRED_SEAMS];` for its pre-fix negative control. Verified present after the
rebuild (`grep -c` = 1). Its two unit-test assertions (`core.test.ts:397`, `:430`) still hold.

NOT edited, by scope: `mpd-team-core-plugin/src/index.ts` and `mpd-team-watchdog-plugin/src/index.ts`
(Lane E, per the captain's scope lock), `packages/mpd-tui-plugin/**` (Lane A), and
`mpd-qa-roles-probe/src/index.ts` — the last is the named QA-probe residual in `docs/independence.md`
§7; it still spells `["agentPresets", "tools"]`.

### 1.3 The gate

`packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` — modelled on the
existing D6 precedent (`no-direct-team-access.test.ts`): comment-stripped scan, original line
reporting, loud declared out-of-band section, `--self-test` with a seeded violation, registered as an
ordinary bun test. It adds `--print-inventory` (read-only re-freeze) and `insideString()` (a match
inside a message string is not a call site — measured on the mpd-ext warn line).

Three classes: `cross-package-import`, `global-write`, `harness-service-provide`.

**Frozen inventory: 14 entries** (`inventory-printed.txt`), keyed `file :: normalized line text`,
never by line number. 47 more couplings are the EXEMPT class (imports of a sanctioned adapter
package) — printed loudly, allowed to grow, never frozen.

## 2. Evidence

| File | What it shows |
|---|---|
| `gate-selftest.log` | `--self-test`: **PASS (14/14)** — every rule reddens on its seeded violation and stays silent on the control |
| `gate-red-empty-inventory.log` | the REAL band against an empty inventory: **FAIL (14 new, 0 stale)**, exit 1 |
| `gate-red-seeded-real-band.log` | a real seeded coupling (`packages/mpd-zz-coupling-seed`) in the real tree: **FAIL (1 new)**, naming file+line+target |
| `gate-green-after-seed-removal.log` | the same tree after the seed was removed: **PASS**, exit 0 |
| `gate-green.log` | the final band: **PASS**, 26 packages, 114 `.ts` files, 14 frozen, 47 sanctioned |
| `dist-inject-runtime.txt` | every rebuilt dist imported; `inject` identical to the pre-change literals |
| `build-logs/*.log` | the 16 canonical repo-root `bun build` invocations, all exit 0 |
| `verify-dist-fresh.log` | 17 of 23 targets FRESH; 6 STALE — attribution below |
| `stale-dist-attribution.log` | the 6 STALE artefacts diffed: 4 carry ONLY bun's codegen signature (bun@1.4.0 → 1.4.2: `config2`→`config`, a different `__toCommonJS` preamble), 2 are rows other lanes are editing in place |
| `package-tests/*.log` | `bun test` for all 16 touched packages: **0 failures** (adapter 168 pass) |
| `typecheck.log` | 51 errors, 0 in any file this lane touched (47 = Lane A's in-flight `mpd-tui-plugin`, 4 = pre-existing) |
| `verify-comments.log` + `verify-comments-adapter-only.log` | repo-wide: 20 violations, ALL in Lane A's new `mpd-tui-adapter-plugin/src/index.ts`; scoped to this lane's package: **PASS** |
| `verify-docs.log` + `verify-docs-after-doc-edit.log` | `ok docs/independence.md`; the single violation is `package-no-readme:packages/mpd-tui-adapter-plugin` (Lane A, in flight) |
| `heading-tree.txt` | EN and zh-CN heading structures identical (level + section number) |
| `changed-files.sha256.txt` | every changed source/doc/dist file with its settled sha256 |

## 3. Red-state attribution (all three are OTHER lanes' in-flight files)

* `bun run typecheck` exit 1 — 47 errors in `packages/mpd-tui-plugin/**` (Lane A mid-migration) + 4
  pre-existing in `skills/programming/scripts/typescript/check-no-excuse-rules.ts` (that file imports
  `typescript/unstable/ast`; no `node_modules/typescript` in this checkout).
* `bun run verify:comments` exit 1 — 20 violations, 1 file:
  `packages/mpd-tui-adapter-plugin/src/index.ts`.
* `bun run verify:docs` exit 1 — 1 violation: `package-no-readme:packages/mpd-tui-adapter-plugin`.
* `node scripts/verify-dist-fresh.ts` exit 1 — 6 STALE, none caused by a content change from this
  edit (see `stale-dist-attribution.log`). `mpd-tui-plugin`'s fresh build FAILS to compile, which is
  Lane A's in-flight state, not a Lane D artefact.

## 4. Not verified

* No end-to-end boot was run: this lane changed no patch row and no runtime behaviour, so the
  mounting-boot gates belong to the lanes that did (plan F3/F4).
* `bun run verify:gates` and `bun run test:qa` were NOT run (out of the brief's gate list, and the
  tree is mid-wave across three lanes).
* The doc's §5 debt number (6 files / 65,846 bytes) is measured from disk; the `_deps/schemastery`
  tree was NOT touched.
