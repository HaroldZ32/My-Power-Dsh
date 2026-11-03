# Resolution — contract amendments of 2026-11-02, and what they leave open

This supersedes `result.json`'s verdict status, NOT its measurements: the original findings stay as
recorded. Re-read the amended contract (`.mpd/plans/dshgo-native-parity.md`, mtime 23:52) and measured
the new gate's feasibility in the same session.

## Finding status

| finding | status | evidence |
|---|---|---|
| B1 no v2 panel | **OPEN** (expected) | T2 `pending`; `panels:["mpd"]`, no `mpd-team.json`, no strip/actions |
| B2 checker exit 0 unachievable | **CLOSED — amended and measured feasible** | §6.1 now a three-run gate; see "Shell measurement" below |
| H1 avatar (initials) | **CLOSED — amended** | §7.2 rule 6 now "initials `badge` + name + mode (`avatar` is the IMAGE node and needs a `src`)" |
| H2 grid→list drops metric values | **ROUTED to T1** — open until the code shows `trailing` on the fallback row | §4 finding, not yet observable in `dshgo-view.ts` |
| M1 avatar `caption`/`aspect`; M2 `divider({size})` | **ROUTED to T1** | amend the kit types |
| M3 rule 1 unenforced by the checker | **ADDRESSED — new binding rule** | §7.3 `lintDesign` + `verify-dshgo-views.ts` |
| M4 checker blind to live trees | **ADDRESSED** | §6.1(c): every live tree and fallback piped to `check.mjs -` |
| M5 exit 0 ≠ §7-compliant | **ADDRESSED** | §7.3's "NECESSARY, NOT SUFFICIENT" + the lint gate |
| N1 spacer scale; N2 duplicate tab label | **ROUTED to T1** | |

## Shell measurement (§6.1(b), measured 2026-11-02T15:53Z)

A scratch shell was built under this evidence directory (not `.mpd/check-pkg`: the reviewer's write
scope is `evidence/**`; the lane must create its own) carrying the **real** `dshGo` block, a **copy** of
the real `dsh-go/views/mpd.json`, `dsh.bundle.patch` as a STRING and `engines.dsh`:

- shell → **exit 0**, `--json` reports `package: []`, `manifest.state "ok"`, `manifest.issues []`,
  `counts.panels 1`, the copied view `ok` (701 bytes, 4 components). The substitution is the SHELL only.
- **negative control**: the same shell with the real ARRAY patch → **exit 1**
  (`错误 /dsh/bundle/patch：不是 DSH 组合包`). The fixture is falsifiable, so the gate measures the
  manifest rather than the shell's luck.

## Two gaps the amendments leave

1. **`lintDesign`'s list is bans-only; four §7.2 rules are positive requirements and are not in it.**
   The enumerated checks cover rule 1 (colours), the numeric/spacing bans (rule 9 partly), one primary
   (rule 8), and the malformed-node cases. They do NOT cover **rule 2 (exactly one `card:"tinted"` hero
   per tab)**, **rule 4 (every `metric` inside a `grid`)**, **rule 7 (`emptyState` on a tab with no
   data)**, or **rule 9's `maxLines` on long free text**. A view that puts its metrics in bare rows,
   ships two heroes, or renders a blank tab still passes `lintDesign` as specified — and would then
   pass `verify-dshgo-views.ts`. Recommended direction: extend `lintDesign` with those four checks
   (they are static on a built tree), or adopt them from `probe-section7.mjs`, which already
   implements them and is self-tested with a negative control (external corroboration, per the
   captain's ruling).
2. **The v1 fallback's lint is vacuous unless it has a v1 mode.** After `stripDecoration` the colour and
   spacing bans can never fire, so running the same `lintDesign` on the fallback proves nothing about
   rule 10. The fallback needs its own assertions: no v2-only component survives, no `style`/`accent`
   key survives, every `text` still carries a word — and, for H2, that a metric's **value** survives
   the grid rewrite. `probe-section7.mjs --v1` implements the first three; H2 is the fourth.

## Note on the amended §6.1(b) wording

"(b) … with `dsh.bundle.patch` as a string and `engines.dsh` present" and the following paragraph's
"do NOT add it in this wave" are about two different packages: `engines.dsh` is present in the SHELL
only, never in the root `package.json`. One word ("in the shell") would prevent a writer from adding it
to the shipped manifest to make a run green.

## Bounds unchanged

The rendered look stays **UNPROVEN** (no Flutter app; `preview.mjs` needs Flutter). What is proven is
v2-legality, budget, theme-token-only, lint-cleanliness and checker acceptance — never the pixels.

## Amendment 2 — verified 2026-11-02T15:55:40Z (plan mtime 23:54:46, 22,821 B)

Checked in the file, not taken from the message: `lintDesign(view, options?: { version?: 1 | 2 })` is
specified with the bans, the four POSITIVE rules (rule 2 hero-per-tab, rule 4 metric-in-grid, rule 7
emptyState-on-data-less-tab, rule 9 maxLines), a version-1 mode with its own assertions, the H2 kit-test
requirement, and §6.1(b)'s "`engines.dsh` present **IN THE SHELL ONLY**".

Three precision notes for the writers, none of them a re-opening:

1. **Pin "v2-only component name" to the kit's exported `V2_ONLY_COMPONENTS`.** The general sentence
   already covers every one (`badge`, `tag`, `divider`, `spacer`, `codeBlock`, `gallery`, `collapsible`,
   `accordion`, `carousel`, `form`, …), and the enumerated list after it is a subset. Naming the constant
   is what stops the lint's list and the kit's list from drifting apart.
2. **Rule 7's "data-bearing child" is undefined, and a binding child is undecidable.** A `child` may be a
   binding (`{"$": "data.x"}`), so a tab built from bindings shows no data component statically and the
   lint would demand an `emptyState` for a tab that does have data at runtime. Enumerate the data-bearing
   components AND exempt a tab that contains a binding child; runtime emptiness stays the builder's duty.
3. **Rule 9's binding half must test the binding SHAPE, not a string prefix.** `text` may be
   `{"$": "data.…"}`; the lint should treat any object with a `$` key as a binding and require
   `maxLines` for it, whatever the path looks like.

Also worth one line in the gate's own README: `verify-dshgo-views.ts` lints the DECLARED static views in
v1 mode (correct — they are v1 by contract), so the v2 live trees are covered by the lane unit tests, not
by that gate. Nobody should read a green repo gate as "the v2 panels were linted".
