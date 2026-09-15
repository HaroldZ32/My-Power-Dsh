# Admission consequence — stated explicitly in three places (captain-ordered)

Digest: **`sha256:824b74f8a4f88e5b6e71200f9cc4b76183a91c446271cdc2122275503b7870db`**
(from `sha256:7701c48c…`, the t22 value). Disclosure-only: the only changed top-level key is
`x-mpd-tui-surfaces` (`raw/manifest-check.json` → `changedTopLevelKeys: ["x-mpd-tui-surfaces"]`,
`identicalOutsideDisclosure: true`; `raw/dsh-plugin.diff`).

## The consequence, as now recorded in the three required places

> With the four `session.*.intercept` permissions declared and denied by default by the vendored
> registry, and no `<DATA_DIR>/extension-grants.json` grant row for `com.mpd-dsh.mpd-tui`, the
> host's `negotiate()` returns **`waiting_authorization` (PERMISSION_NOT_GRANTED)** — the
> **expected** admission result for this bundle while no grant row exists, not an anomaly.
> `admitInternal` accepts only `compatible`/`compatible_degraded` and throws otherwise
> (`plugin-host.js:391-395`), so **no component identity is bound** and **our rows stay
> `undeclared` in the host's effect ledger until then**. Declaring the four is deliberate: the
> host's decision guard resolves an intercept permission per event at subscribe time
> (`decision-guard.js`) and admission cross-checks the declaration against the DecisionEvents
> requirement, so a manifest that omitted them could never activate the seam even after grants —
> ready-but-not-activated, not ready-but-permanently-impossible.

1. **Manifest** — `dsh-plugin.json` → `x-mpd-tui-surfaces.decisionEvents`. The new clauses are
   `EXPECTED, NOT ANOMALOUS: … our rows stay `undeclared` in the effect ledger UNTIL a grant row
   exists` and the deliberate-declaration rationale. Machine-checked present exactly once each in
   `raw/manifest-check.json` → `disclosureContent`.
2. **This evidence write-up** — this file, plus the pre-existing chain in
   `…/20260915T061016Z/RESULT.md` (t22) and `…/20260915T062202Z/PACKAGING.md` (packaging).
3. **t5 output** — t5 is terminal and members cannot amend a terminal task, so the sentence was
   handed to the captain verbatim for the delivery report (message of this pass, and repeated
   below for the record):

   > "dsh-plugin.json declares all four `session.*.intercept` permissions deliberately: the host's
   > decision guard needs a STATIC permission, so omitting them would make the seam permanently
   > impossible rather than ready-but-not-activated. With those four denied by default and no
   > `<DATA_DIR>/extension-grants.json` row keyed `com.mpd-dsh.mpd-tui`, the EXPECTED admission
   > result is `waiting_authorization` (no identity bound, our rows `undeclared` in the effect
   > ledger) until a grant row exists; `bun run typecheck` and the manifest structure check pass,
   > and the host's own `/plugins check` prints exactly that state plus the grant hint."

## Measured on this digest (nothing softened)

| Check | Result |
|---|---|
| `raw/manifest-check.json` | declarations identical outside the `x-` key; all ten required keys; id pattern ok; `provides`/`requires.services` absent; pinned `@dsh-std/manifest` accepts + projects |
| `raw/verify.log` | `bun run typecheck` exit 0; contract `node -e` structure check → `manifest structure ok` exit 0 |
| `raw/admission-static.json` | `parse ok`, `validatePlugin ok`, `specDataResolved: true`, negotiation **`waiting_authorization`** with exactly the four declared permissions denied at `tui/input`, `tui/rewind-prompt`, `tui/session-switch`, `tui/compact` |
| `raw/final-plugins-check.pane.txt` | live TUI `/plugins check` on THIS digest: `协商结果：waiting_authorization (PERMISSION_NOT_GRANTED: …)` + `授权方法：在 ~/.dsh-tui/extension-grants.json … "com.mpd-dsh.mpd-tui" …` |
| `raw/final-preset.pane.txt` | live TUI `/preset` on THIS digest: `❯ MPD (Main Working Agent)（默认） ✓` |

No measurement contradicted the expectation, so nothing was weakened.

## The two tracked files — attribution (as the captain asked)

- `scripts/pack-mpd.mjs`: the `PLUGIN_PKGS` entry `"mpd-tui-plugin"` (line 51, +9 lines with the
  defect-class comment) was authored by **the Lead's t17 repair, not by this worker**; it was read
  and left byte-unchanged. This worker's only edit in that file is the `cpAssets()` per-package
  asset table (`+20` lines, themes/skills) and its reader note — a different function, no
  `PLUGIN_PKGS` change. Integrity signal: `PLUGIN_PKGS` parses to 17 elements with **one**
  `mpd-tui-plugin` element and **no** duplicates; `node --check` ok.
- `scripts/install-profile.mjs`: the `mpd-tui` mirror row (`:172-177`, comment "DSH-TUI edition
  (t5)") **was authored by this worker** under t5 — the Lead's forensics is right, and this is not
  a regression. `node scripts/verify-rows-parity.mjs` → exit 0, `24 row ids match … mpd-tui …`.

### The captain's grep assertion (important correction)

`grep -c '"mpd-tui-plugin"' scripts/pack-mpd.mjs` prints **2**, never 1 — by design:
line 51 is the `PLUGIN_PKGS` array element (the Lead's) and line 132 is this worker's asset-table
key `"mpd-tui-plugin": ["themes","skills"]`. **The array integrity signal is the element count, not
the raw grep:** `PLUGIN_PKGS` has 17 elements, one of them `mpd-tui-plugin`, 0 duplicates
(`raw/grep-assertion.log`), and R11 asserts the class property across every patch row
(`R11 ok: 16 patch rows present in pack-mpd PLUGIN_PKGS`). A reader note inside the file records
this so the count cannot be misread as a re-added/duplicated entry.
