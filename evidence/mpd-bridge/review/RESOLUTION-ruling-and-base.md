# t36 addendum 2 — FINAL duplicate-key ruling, file-derived base, single registration

Judged revision (all six files hashed at judgement time, tree settled across the runs below):

| file | sha256 (prefix) |
|---|---|
| `packages/mpd-config-plugin/src/jsonc-edit.ts` | `cf279efa82a90e17…` |
| `packages/mpd-config-plugin/src/index.ts` | `e89179338d47c5fb…` |
| `packages/mpd-config-plugin/dist/index.js` | `15733c1e0791aee1…` |
| `packages/mpd-tui-plugin/src/settings.ts` | `70e1d4752b261c56…` |
| `packages/mpd-tui-plugin/test/two-plugin-ownership.test.ts` | `1f1362cb8c292de1…` |
| `skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs` | `4474be1e00523d06…` |

## 1. Duplicate keys — the tree MATCHES the captain's FINAL ruling

Driven directly against the shipped code (`raw/duplicate-rule-probe.mjs`), input
`{"ulw":{"maxRounds":3,"maxRounds":7}}`:

- **UNSET** (`surgicalDelete`) → `ok:true`, **both** occurrences spliced in one descending-span pass
  (`occurrencesRemaining: 0`). Source evidence: `jsonc-edit.ts:513` `locateAllLeaves` + the
  "CAPTAIN'S DELTA vs the design" comment, and the wholesale refusal when any span cannot be proven.
- **SET** (`surgicalEdit`) → `ok:true`, the **LAST** occurrence edited (`"maxRounds": 9`) while the first
  is preserved (`"maxRounds": 3`), and the result carries the warning with **every occurrence line**:
  `{ reason: "duplicate-key", lines: [3, 4], detail: "key \"ulw.maxRounds\" appears 2 times at lines 3, 4;
  the last occurrence is the effective value and was updated" }`.
- **Refusal** stays for unprovable spans and duplicated INTERMEDIATE keys
  (`jsonc-edit.ts:355` → `ambiguous-intermediate`, naming the occurrence count and lines), plus
  `unparsable` and read-only targets (read-only re-measured earlier: `denied`/`EACCES`, bytes unchanged).
- Tests: `bun test packages/mpd-config-plugin` → **67 pass / 0 fail** (matches the captain's number
  exactly), including the `:170/:203/:216` rule tests and the `DELETE` sentinel.

**Statement required by the captain: the tree matches the note, in both directions.**

## 2. File-derived base — implemented, and its limitation is disclosed honestly

- Registration moved to `mpd-config-plugin` (`src/index.ts:511` `baseForNamespace()`), through the
  adapter seam (`dsh.settingsRegister`), with the captain's cardinality rule: **1 root → that workspace's
  file; 0 roots → the mount-time root; N roots → NO file base invented** (`base: undefined`,
  `reason: "ambiguous-multi-root"`, an explicit warn + `states()` surfacing).
- **Falsifying observation captured from the running host, in my own sandbox:** the mutate response
  carried `"base":{"hashline":{"maxDiffChars":35000},"ulw":{"maxRounds":6}}` with **no settings leaf** —
  the FILE value 35000, not the schema default 20000 (lane check **W13 = ok**, `[settings-bridge] PASS`).
- **Disclosure vs limitation:** the host exposes no disposal handle for a live registration, so the base
  is fixed for the process lifetime — recorded in the source comment AND user-visibly consistent with the
  shipped hint ("a save writes `<workspace>/.mpd/mpd.jsonc` … and takes effect for the mpd plugins **after
  a restart**"). The restart clause is exactly the honest consequence of the fixed base, so the
  disclosures match the limitation.
- **Residual, judged and contained:** with N live roots the screen falls back to schema defaults while
  the file may hold other values. It is NOT an overwrite hazard, because a save in that state is
  REFUSED (`ambiguous-multi-root`, no file written — re-measured in my own run: A2 "NO file changed",
  A3 `skipped:'ambiguous-multi-root'`, A4 both candidates named). The hazard therefore cannot reach disk;
  the user-visible defect is a temporarily misleading screen, surfaced by the warn + `states()`.

## 3. Exactly one registration — implemented as a guarded fallback

`packages/mpd-tui-plugin/src/settings.ts:150-164` no longer registers unconditionally: it returns early
when `configPluginPresent(ctx)` **or** when the namespace is already served, logging "mpd-config owns the
registration — fallback skipped (design §10.1)", and registers only as a fallback when no other registrant
exists. `bun test packages/mpd-tui-plugin/test/two-plugin-ownership.test.ts` → **4 pass / 0 fail** against
the double that throws on duplicates (the host's own behaviour, `dsh-settings/lib/index.js:283`).

## 4. Revision boundary for the earlier W11/W12 red (as requested)

- **Red (twice):** config `src/index.ts 559eb3e0…`, `dist 225c171b…`, lane pre-16:41 — measured while t39
  was rewriting `mpd-config-plugin` (its source files were replaced/renamed during that window).
- **Green:** config `src/index.ts e8917933…`, `dist 15733c1e…`, lane lib `4474be1e…` — W1–W13 all ok,
  hashes unchanged across the run.

So the W11/W12 red belongs to a churn window and is **explained by the revision boundary**, not left as a
defect: the raw payload in the red runs already carried the value, and the settled revision passes the
same assertions including W13.
