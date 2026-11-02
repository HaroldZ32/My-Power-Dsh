# W1-B1 — `ulw` → `autoproject` (no aliases) + boulder merged into the package

Lane: Senior Engineer (board row T3). Contract: `.mpd/plans/autoproject-refactor.md` §2-D1/D2, §4.1,
§5-W1-B, §7. Wave scope: rename + package merge ONLY — the engine cut (routing through
`mpd_role_spawn`, the weakened directive) is the NEXT task and was NOT touched.

## 1. What changed

**Package move (plain `mv`, no git command).**
`packages/mpd-ulw-plugin/` → `packages/mpd-autoproject-plugin/` (README pair and `dist/` travel with
it; the language-switch links are untouched and relative, so they still resolve — `verify:docs` PASS).

**Plugin identity and surface.**
- plugin `name` `mpd-ulw` → `mpd-autoproject`; package name `@mpd-dsh/ulw` → `@mpd-dsh/autoproject`.
- tool `mpd_ultrawork` → `mpd_autoproject`; the `mpd_ulw` ALIAS TOOL IS DELETED (no shim).
- commands `["ulw","ultrawork"]` → the SINGLE `/autoproject`; usage line and description rewritten
  (no "alias" sentence left).
- gesture pattern `/^(?:\/ulw|\/ultrawork)/` → `/^\/autoproject/`.
- state root `.mpd/ulw` → `.mpd/autoproject`; run id prefix `ulw-` → `autoproject-`.
- config keys `ulw.*` → `autoproject.*` (maxRounds/planDir/stateDir/provider/model/reviewerModel/maxReReviews).
- goal `source` tag `"ulw"` → `"autoproject"`; `rowLog` id `mpd-ulw` → `mpd-autoproject`.
- The two directive TEXTS (`DIRECTIVE`, `AUTOPROJECT_ACTIVATION_DIRECTIVE`) are kept VERBATIM as the
  contract requires; only the identifier `ULW_ACTIVATION_DIRECTIVE` was renamed.

**Boulder merge (D2).**
`packages/mpd-boulder-plugin/src/**` (incl. `vendor/**`, 13 files) → `packages/mpd-autoproject-plugin/src/boulder/**`;
`applyBoulder(ctx, {})` is called from the autoproject entry, so ONE row registers all six
`mpd_boulder_*` tools with their names, parameters, returns and `.mpd/boulder.json` ledger BYTE-IDENTICAL.
`packages/mpd-boulder-plugin/` is deleted (dist, manifest, tests, both READMEs — the docs fold is W5).
The moved vendor tree still matches its `VENDOR_LOCK.json` fingerprint (13 files, same `treeSha`), which
is the machine proof that this was a PURE MOVE.

**Rows / install / pack.**
`cordis.patch.yml`: row `mpd-ulw` → `mpd-autoproject` (config `{maxRounds: 3}`) at the new dist path;
the `mpd-boulder` row is DELETED. Mirrored in `scripts/install-profile.ts` (row list + both
`--self-test` literals) and `scripts/pack-mpd.ts` (`PLUGIN_PKGS`).

**Settings (C5 — the knob was renamed IN PLACE; the count stays 47).**
`settings-schema.ts`: zod group + `SETTINGS_KNOBS` path `["autoproject","maxRounds"]`; the
`BRIDGE_RESTART_LIMIT` sentence names `autoproject.*`. `settings-card.ts` mirrors it (its hand-written
FIELDS; it still does NOT import `SETTINGS_KNOBS`), and `client.js` was rebuilt with the documented
`node scripts/build-mpd-client.ts`.

**QA / docker surfaces.**
Cases renamed and updated: `skills/dsh-qa/scripts/ulw-command.ts` → `autoproject-command.ts`,
`lib/ulw-command-probe.ts` → `lib/autoproject-command-probe.ts`, `ultrawork-smoke.ts` →
`autoproject-smoke.ts` (import in `cellwork-command.ts` updated). `CONTRIBUTED_COMMANDS` 7 → 6 with the
single `autoproject` entry; `user-surface-mount.ts`, `settings-bridge-lane.ts`, `tui-settings-bridge.ts`,
`tui-panels.ts`, `plan-c-smoke.ts`, `tool-output-validation.ts`, `cases.json`, `SKILL.md` rows updated.
Docker: `probe.ts` CORE_TOOLS, `lib/report.ts` required user-surface rows (both old command rows collapse
into ONE `userSurface.command.autoproject`), `scripts/docker-e2e.ts` self-test literals + the frozen
replay fixture (below).

**Coupling inventory (C1).** Both frozen entries that named the old package were re-frozen to the new
file paths (no edge added or removed; the boulder→roles import moved one directory deeper, and the pinned
line text follows). `packages/mpd-goal-plugin/test/goal.test.ts` + its source comment take the new
`source` tag.

## 2. Gates — commands and OBSERVED results

| Command | Result |
|---|---|
| `bun test packages/mpd-autoproject-plugin packages/mpd-config-plugin packages/mpd-bundle-plugin packages/mpd-goal-plugin` | **481 pass, 0 fail** (27 files, exit 0) — `package-tests.log` |
| `bun run typecheck` (`tsgo --noEmit`) | **exit 0** — `typecheck.log` |
| `node scripts/verify-rows-parity.ts` | **exit 0**, 36 row ids, `mpd-autoproject` present, `mpd-boulder` gone — `verify-rows.log` |
| `node scripts/verify-plugin-manifest.ts` | **PASS**, 28 row module paths resolve, 0 missing — `verify-manifest.log` |
| `node scripts/verify-comment-coverage.ts` | one violation, in `packages/mpd-team-core-plugin/src/dispatch.ts` (ANOTHER lane, in flight); **zero in this lane's files** — `verify-comments.log` |
| `node scripts/verify-docs-parity.ts` | **PASS** (54 pairs, 0 dead links) — `verify-docs.log` |
| `node scripts/verify-vendor.ts` | **FAIL** — see §3 — `verify-vendor.log` |
| `node scripts/run-qa-selftests.ts` | **54 of 55 pass**; the one failure is `team-dispatch-guard.ts` (ANOTHER lane's in-flight `StagedPlan` v2) — `qa-selftests.log` |
| `node scripts/docker-e2e.ts --self-test` | **all arms passed** |
| `node skills/dsh-qa/scripts/user-surface-mount.ts --self-test` | 68 arms, 0 failed |
| `node skills/dsh-qa/scripts/plan-c-smoke.ts --self-test` | ok |
| `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | PASS — 32 harness rows conform, mpd preset 29 child rows, row parity 27/27 |
| residue grep (6 retired spellings) | 1 hit in this lane (`scripts/docker-e2e.ts:728`, an explanatory comment quoting the old names); code, rows, manifests, QA cases, docker all clean — `residue-grep.log` |

## 3. What is NOT proven / deliberately left

1. **`verify:vendor` is RED and the cure is the CAPTAIN's re-pin.** Two derived assets moved:
   the `skills` corpus `treeSha` (three QA scripts renamed — `skills/**` is fingerprinted as one tree)
   and `packages/mpd-bundle-plugin/client.js`'s `sha256` (rebuilt by the contract). Everything else is
   green, INCLUDING the moved boulder vendor tree. Cure: ONE
   `node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step` in the integration commit.
   The command refuses to run for a member, so this lane did not run it.
2. **No dist was rebuilt** (task rule + T-88): `packages/mpd-autoproject-plugin/dist/index.js` is still
   the pre-rename artifact, so it registers `mpd_ultrawork` until the captain's pinned-toolchain rebuild.
   Two QA self-tests would otherwise have reddened on that stale artifact; the smoke and
   `tool-output-validation` cases now say so LOUDLY and read the marker from `src` in that window
   (documented at the call site) instead of claiming a rebuild that did not happen.
3. **No REAL MOUNT boot of the merged row was run.** A mount would load the stale dist and prove
   nothing about the new source; the mount + `verify:dist-fresh` belong to integration after the rebuild.
4. **Docs are untouched by design.** The autoproject README pair still describes the old surface (it
   travelled with the package, links intact) and the W5 band still names the retired spellings; the
   residue log lists every one of them, classified.
5. **Two out-of-lane residues are reported, not edited:** `packages/mpd-cellwork-plugin/src/prompts.ts:5`
   (a comment; package owned by W2) and five comments/examples inside
   `packages/mpd-dsh-adapter-plugin/src/index.ts` (package owned by W0).
6. **Bundle behaviour is otherwise unchanged** — the engine still spawns directly, still carries the
   old prompt text and the old `ulw.provider/model/reviewerModel` knobs. That cut is W1-B2's task.

## 4. Test added

`packages/mpd-autoproject-plugin/test/commands.test.ts`:
- `the ONE /autoproject command is registered through the adapter seam, with no alias` — asserts exactly
  one registration, the name, the description free of an alias sentence, and a real submission.
- the last test now ALSO asserts all six `mpd_boulder_*` tool names are registered by the merged entry.
`commands.test.ts` self-test-level source checks assert the single `["autoproject"].map(` registration
shape and the ABSENCE of `"ultrawork"`/`"ulw"` command aliases in the plugin source.
