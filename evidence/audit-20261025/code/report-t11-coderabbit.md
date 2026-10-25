# code-fixer — T11 CodeRabbit repair report (PR #66)

Lane `code-fixer` · branch `fix/audit-20261025` · contract AMENDMENT 4 of
`.mpd/plans/audit-20261025-fixes.md` (findings #4, #5, #7, #8, #9).
No git write command was run. `packages/mpd-bundle-plugin/client.js` was NOT rebuilt (captain's).

## 0. Gate state at the end of this task

| Command | Observed | Log |
|---|---|---|
| `bun test packages` | 2458 pass / 6 skip / **1 fail** — the artifact-bound arm `the disclosure sentences are unchanged and still rendered with the new rows`, EXPECTED until the captain rebuilds `client.js` (declared by the captain, not a source defect) | `t11-test-packages.log` |
| `bun run typecheck` | exit **0** | `t11-typecheck.log` |
| `bun run verify:comments` | PASS — 444 files / 39 789 declarations | `t11-verify-comments.log` |
| `bun run verify:manifest` | PASS incl. `component-ref-version` / `component-ref-dependencies` | `t11-verify-manifest.log` |
| `node scripts/verify-plugin-manifest.ts --self-test` | `self-test PASS (7 arms, each with a clean control; the component-ref arm also refuses its three vacuous shapes)` | `t11-manifest-selftest.log` |
| `bun run test:qa` | `[test:qa] all self-tests passed` — exit **0** | `t11-test-qa.log` |
| `node scripts/verify-dist-fresh.ts` | **ok: 33/33 targets fresh** (each rebuilt twice, byte-identical) — measured 2026-10-25T13:4xZ, i.e. after the captain's integration rebuild; my earlier T4 measurement of 6 stale is superseded | `t11-verify-dist-fresh.log` |

## 1. #5 — dead literals under `BRIDGE_RESTART_LIMIT` (CONFIRMED, my defect)

`packages/mpd-config-plugin/src/settings-schema.ts` held FOUR adjacent string literals under
`export const BRIDGE_RESTART_LIMIT =`: ASI keeps the first as the value and every following line is a
discarded expression statement, so a reader of the source saw text the process never used (and the
emitted `dist` carried the same shape).

Fix: the three strays are DELETED; the constant is one literal of 381 chars, and the browser mirror
(`packages/mpd-bundle-plugin/src/settings-card.ts`) contains it byte-identically (checked by importing
the constant and `String.prototype.includes` over the mirror's source).

Regression guard added (`packages/mpd-config-plugin/test/settings-defaults.test.ts`):
`the declaration cannot lose text to ASI > no line is a BARE string literal directly after another
(the CodeRabbit #5 shape)` — it scans `settings-schema.ts` for two consecutive comma-less literal
lines (array elements carry a comma, so they are not flagged) and has its own negative control.
This arm WOULD have caught the defect: with four adjacent literals, three offenders exist.

## 2. #4 — the disclosure promised a file write the default save path never makes (CONFIRMED in code)

Evidence (opened in this session, not restated from the finding):
- `packages/mpd-config-plugin/src/index.ts` subscribes `onSettingsDocumentUpdated(ENTRY_CONFIG_ID, …)`
  where `ENTRY_CONFIG_ID = "mpd-config"`; its own comment states "Deliberately NO file write-back on
  this path: the entry document is the host's own store … persistence of an entry save is the host's",
  and the handler only re-loads `state`.
- The `<workspace>/.mpd/mpd.jsonc` write-back lives behind the LEGACY `SETTINGS_NS = "mpd"` listener,
  and `registerNamespace` REFUSES that registration on the pinned harness
  (`settingsModelRetired = true`, one boot warning "the namespace-registry model is RETIRED"), so the
  write-back is dormant here.

**Exact final texts (byte-identical in `settings-schema.ts` and the browser mirror), for the reviewer:**

`BRIDGE_DISCLOSURE` (842 chars):
> a save from this form persists in the HOST's settings document and writes NO .mpd/mpd.jsonc — the
> host owns that store and this row re-reads it on every save; a <workspace>/.mpd/mpd.jsonc write
> happens only on a host that still serves the RETIRED legacy `mpd` namespace, where each save's
> changed leaves go to the live session workspace(s). The config service re-resolves on every settings
> save and on a watched edit of the project file, and WHICH knobs take the new value in the RUNNING
> process — no restart — depends on how each one reads it: teamModels.slot\*, modelchain.\*, watchdog.\*,
> team.stateDir, team.gate, team.sensitivity, captain.investigation and delegation.gate are read per
> use, and tui.dashboardKey is live ONE WAY (a saved false disables the Ctrl+A takeover at once; a
> saved true cannot arm a takeover the row config disabled)

`BRIDGE_RESTART_LIMIT` (381 chars, UNCHANGED by T11 beyond the #5 de-duplication):
> the other half of that list, so nobody reads it as a blanket: hashline.\*, commentChecker.\*, ulw.\*,
> memory.\*, boulder.dir and goal.\* are captured by their plugins at mount instead of reading the live
> config service per use, so a new value for any of them waits for the next dsh boot (the file and the
> settings document still receive it at once, and each row names the key it writes)

`BRIDGE_NOT_LOST` (204 chars — the "never lost" claim is KEPT, its tail corrected):
> the value is never lost: it is stored in the host settings document and the config layer applies it
> to every workspace immediately — and because this path writes no file, it never waits for a live
> session

`BRIDGE_SECTION_NOTICE` (1429 chars) = `BRIDGE_DISCLOSURE + " " + BRIDGE_RESTART_LIMIT + " " +
BRIDGE_NOT_LOST` (both halves, then the not-lost clause).

Mirrors a reviewer must check: `packages/mpd-bundle-plugin/src/settings-card.ts` (`BRIDGE_DISCLOSURE`,
`BRIDGE_RESTART_LIMIT`, `NOT_LOST`) and the QA byte copies `TUI_DISCLOSURE_LIVE` /
`TUI_DISCLOSURE_CAPTURED` / `TUI_NOT_LOST` / `PERSISTENCE_HALF` in
`skills/dsh-qa/scripts/lib/settings-bridge-lane.ts` (with a drift check that re-reads the schema source
in `selfTest()`).

Same false claim, same class, one extra site fixed: the header of
`packages/mpd-tui-plugin/src/settings.ts` still said the section's namespace saves are "BRIDGED (t35) …
and rewrites the value into `<workspace>/.mpd/mpd.jsonc`". It now states the entry-config reality and
points at the dormant legacy path.

Pins retargeted to the truth (`persists in the HOST's settings document`, `writes NO .mpd/mpd.jsonc`,
`RETIRED legacy \`mpd\` namespace`, `<workspace>/.mpd/mpd.jsonc`): `settings-card.test.ts` (4 arms),
`mpd-tui-plugin/test/plugin.test.ts` (1 arm), the QA lane's `S1`/`T1`/`W2e` arms and their fixtures,
`PERSISTENCE_HALF` mutants (one new mutant proves a dist that keeps the words but drops the save-path
truth REDDENS), and `tui-settings-bridge.ts`'s header.

## 3. #7 — `checkComponentRefs` passed VACUOUSLY (CONFIRMED)

`scripts/verify-plugin-manifest.ts`: the first cut returned `ok` whenever nothing FAILED to compare, so
three shapes passed while checking nothing. Each is now refused by name (rule `component-ref`, and
`component-ref-version` is red):

1. **unreadable document** — `dsh-distribution.json` missing/unparseable → "the distribution document is
   missing or unreadable, so no component ref could be compared";
2. **no `distribution.version`** — every self-urn is UNCHECKED → refused instead of blessed;
3. **no self-urn ref at all** — `compared === 0` → "a gate that cannot compare must not bless".

`--self-test` proves all three one at a time (`ok component-ref vacuity: an unreadable / versionless /
ref-less document is REFUSED, never blessed`) while the repository's real document stays green
(6 self-urns at 0.15.4, 8 ids, 0 dangling edges).

## 4. #8 / #9 — the pane lane (CONFIRMED; fixed structurally, with a DECLARED BOUND)

- **#8 prefix-only assertions.** The `/settings` row now pins 17 MATERIAL clauses instead of a prefix:
  the persistence half, each live group (`teamModels.slot*`, `modelchain.*`, `watchdog.*`,
  `team.stateDir`, `team.gate`, `team.sensitivity`, `captain.investigation`, `delegation.gate`), the
  one-way toggle, every mount-captured group (`hashline.*` + `commentChecker.*` + `ulw.*` + `memory.*` +
  `boulder.dir` + `goal.*`, as one ordered regex), the boot wait and `never lost`.
- **#9 the fixture was not truncated while the real pane is.** The lane now (a) IMPORTS the byte copies
  from the sibling QA lib (one copy, one drift check), (b) builds its reference pane from the real
  `MPD bundle · <SECTION_NOTICE>` sentence through a new `paneClip(text, width)` helper that ellipsizes
  exactly as the host does, and (c) DERIVES the width: `PANE_WIDTH = Math.max(560, SECTION_LINE.length
  + 40)` ≈ 1.47k columns. Two new self-test checks prove BOTH directions — at 560 the line is clipped
  (so the fixture can no longer be longer than reality), at the derived width it is complete (so no
  asserted clause is cut).

**THE BOUND (statement for the reviewer, agreed with the captain):** this is NOT a claim that the
notice is readable on a real terminal. The honest disclosure is ~1.43k chars, so a host that ellipsizes
the section description to one line will paint only its first part; the lane no longer lies about that
(it derives the width and reddens if a clause disappears), and the product follow-up is to SHORTEN or
WRAP the on-screen notice rather than to widen the pane further.

Self-tests after the change: `[tui-settings-bridge self-test] ok: 22 web-arm + 10 TUI-arm + 4
client-shape injected faults each flip their own check; all three synthetic green artifacts pass`;
`[tui-panels self-test] ok: 8 surfaces asserted, negative controls fail as required`.

## 5. Open items for the captain

1. **`packages/mpd-bundle-plugin/client.js` must be rebuilt** (captain's step; confirmed by them). Until
   then `bun test packages` reports exactly ONE red arm, `the disclosure sentences are unchanged and
   still rendered with the new rows`, because that arm reads the BUILT artifact while the schema mirror
   has already moved. Every other arm is green.
2. `dist` measured **33/33 fresh** on this tree; if another lane edits `packages/*/src` again before the
   PR, that lane's targets go stale and re-dating this evidence is the captain's call.
3. Recording still open from the wave (not mine to fix): the dead notice path
   (`BRIDGE_NO_WORKSPACE_NOTICE` / `BRIDGE_AMBIGUOUS_NOTICE` / the TUI `bridgeRead()` branch) — with no
   file write on the default path they are unreachable, which AMENDMENT 4 already records.

## 6. T15 — the stale lowercase pin the #4 repair left behind (one line)

`packages/mpd-bundle-plugin/test/settings-card.test.ts`, arm
`the disclosure sentences are unchanged and still rendered with the new rows`:
`expect(text).toContain("the config service re-resolves on every settings save")` went stale the moment
the save-path sentence was PREPENDED to `BRIDGE_DISCLOSURE` — the shipped text now reads
"… live session workspace(s). The config service re-resolves …", i.e. the clause opens a new sentence
with a capital `The`. The pin now carries the shipped spelling, with a comment saying why the boundary
moved; the material clause is unchanged. (The arm was red on the CURRENT tree — the rebuilt `client.js`
at 21:34 already carried the new bytes, so this was the last stale pin, not an artifact problem.)

Observed after the fix: `bun test packages` → **2459 pass / 6 skip / 0 fail** (40 682 expect() calls,
148 files) — exit **0** · `bun run typecheck` exit **0** · `bun run verify:comments` PASS.
Logs: `t15-test-packages.log`, `t15-typecheck.log`, `t15-verify-comments.log`.

## 7. T17 — reviewer T16-F1 (CODE half): the restart half's FILE parenthetical is scoped

Reviewer finding (verified by me in the two sentences side by side): the live half now says a
`<workspace>/.mpd/mpd.jsonc` write "happens only on a host that still serves the RETIRED legacy `mpd`
namespace", while `BRIDGE_RESTART_LIMIT`'s parenthetical still promised "(the file **and** the settings
document still receive it at once …)" — the tree contradicted itself in adjacent clauses.

**Editing sites (3 copies, byte-identical afterwards):**
`packages/mpd-config-plugin/src/settings-schema.ts` (`BRIDGE_RESTART_LIMIT`, now 442 chars, plus a doc
comment recording the asymmetry), `packages/mpd-bundle-plugin/src/settings-card.ts` (browser mirror) and
`skills/dsh-qa/scripts/lib/settings-bridge-lane.ts` (`TUI_DISCLOSURE_CAPTURED`, whose `selfTest()`
re-reads the schema source and FAILS on drift).

**New parenthetical (exact):**
> (the settings document receives it at once, and the file does too only on a host that still serves the
> legacy `mpd` namespace; each row names the key it writes)

**Pins retargeted so the claim cannot return** (presence of the scoped wording + ABSENCE of the
retracted one, at source, rendered and built-byte levels):
- `packages/mpd-config-plugin/test/settings-defaults.test.ts` (the constant's own gate),
- `packages/mpd-tui-plugin/test/plugin.test.ts` (`BRIDGE_RESTART_LIMIT`),
- `packages/mpd-bundle-plugin/test/settings-card.test.ts` twice: the card SOURCE arm and the RENDERED
  `R2-D1` paragraph arm,
- the QA lane gained `TUI_FILE_PARENTHETICAL_RETIRED` and two arms with their own mutants: `S3c`
  (static arm) and `T3c` (TUI-surface arm) — "the retracted FILE parenthetical is ABSENT". Self-tests
  now report `23 web-arm + 11 TUI-arm + 4 client-shape` injected faults, each flipping its own check.

**Observed on this tree:** `bun run typecheck` 0 · `bun run verify:comments` PASS ·
`bun run verify:manifest` PASS · `bun run test:qa` `all self-tests passed` ·
`bun test packages` 2458 pass / 6 skip / **1 fail** = `R2-D1` only, because it reads the BUILT
`client.js` and that artifact still carries the pre-scope parenthetical ·
`node scripts/verify-dist-fresh.ts` **3 of 33 STALE** (`mpd-config-plugin`, `mpd-roster-provider-plugin`,
`mpd-tui-plugin` — the `settings-schema` inlining fan-out).
Both are the captain's rebuild step (client + dist), not source defects; the same class as T15's
artifact lag. Logs: `t17-*.log`.

**Not mine in T16-F1:** the five DOC sites the reviewer listed (`packages/mpd-tui-plugin/README*`,
`packages/mpd-bundle-plugin/README*`, `docs/user-guide.md` + zh, `docs/tui.md` + zh, `docs/design.md` +
zh) belong to the docs/README lanes; this task covered the constant + mirror + QA copy + pins.
