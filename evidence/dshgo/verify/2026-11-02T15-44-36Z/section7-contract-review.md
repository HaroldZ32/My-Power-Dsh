# §7 visual-language review — contract vs dsh-Go 1.0.9, and what exists to review

Reviewer lane, 2026-11-02. Subject: `.mpd/plans/dshgo-native-parity.md` §7 (BINDING, user-set) as it
meets the pinned app documentation, plus the wave's state on `feature/mpd-dshgo-native-parity`.
Raw command output and exit codes: `output.log` in this directory. Executable checklist:
`probe-section7.mjs` (`--self-test` exit 0, four arms including a negative control).

## What was measured

| fact | measurement |
|---|---|
| branch state | `HEAD == dev == 1fb7f457`, zero tracked modifications at 15:46:56Z |
| D1 (`dshgo-view.ts`) | appeared at 23:46 while this review ran; 44,343 → 45,051 bytes by 23:48; untracked |
| D2 (`mpd-team.json`, second panel, strip, capsules, menu) | ABSENT; manifest reports `panels:["mpd"]`, `strip:[]`, actions `[]` |
| D1 gate (`scripts/verify-dshgo-views.ts`) | ABSENT |
| D3/D4 (the v2 panel trees §7 governs) | ABSENT (T2 pending) |
| team board | T1 `in_progress`, T2–T7 `pending` |
| `check.mjs <repo root>` | **exit 1** — `错误 /dsh/bundle/patch：不是 DSH 组合包`, `提示 /engines/dsh` |
| `check.mjs dsh-go/views/mpd.json` | exit 0 — `能显示` |
| `check.mjs --json .` | `manifest.state "ok"`, `manifest.issues []`, `panels 1` |
| deliberately non-conforming v2 view | **exit 0** (named colour + numeric padding + two primaries) |

Docs read (pinned clone `.mpd/recon/dsh-go` at `8fe1c1c`): `docs/plugins/styles.md`,
`components.md`, `inputs.md`, `design-rules.md`, `versions.md`,
`sdk/plugin-kit/schema/view.schema.json`, `sdk/plugin-kit/lib/check.js`, `lib/style-check.js`,
`lib/messages.json`.

## Rule-by-rule: is every §7.2 rule buildable as written?

| §7.2 rule | authority | verdict |
|---|---|---|
| 1. `accent:"app"` at every panel root; named colour / `#RRGGBB` forbidden | styles.md "颜色与实际背景" (`accent:"app"` follows 设置›主题; root-only); `$defs.accent` = `"app" | named | #hex`; `check` previews `#4B67B4` | **legal**; the app auto-corrects contrast in dark mode, so a correction note per distinct background is normal |
| 2. one hero per tab: `stack` + `style{card:"tinted",padding:"M",gap:"S"}`, title `title`/`bold`, one-line `caption`, key metrics | styles.md container table (`tinted` = theme colour 10 % light / 16 % dark over content background); text table (`caption` = 13 px) | **legal** |
| 3. other sections `surface` (secondary `outlined`), `padding:"M"`, `gap:"S"`, header `subtitle`/`semibold`, `divider` between groups, `spacer` before actions | styles.md; inputs.md "结构与展示" (`divider` no props, `spacer size S|M|L`) | **legal** (one trap: `spacer` S/M/L = 8/16/24 dp, unlike `padding`/`gap` 8/12/16) |
| 4. metrics in a v2 `grid`, 2 columns, inside the section card | inputs.md (`grid` children + `columns` 1–4, default 2) | **legal** |
| 5. `badge`/`tone` always carry a word | inputs.md (`badge` requires `text`, ≤ 200) | **legal and machine-enforced** — a `badge` without `text` is a checker error |
| 6. members = `avatar` (**initials**) + name + mode; tasks = `badge` + `progress` + `timeline` (v1: `steps`) | inputs.md (`avatar`: `src`, `alt?`; 48 dp square; icon when the image is missing; **no caption**); `$defs.node` has no text/initial slot | **NOT buildable** — see H1. `badge`/`progress`/`timeline` are legal |
| 7. `emptyState` with title + one sentence, never a blank tab | components.md (`emptyState`: title ≤ 40, message ≤ 120, ≤ 1 button) | **legal** |
| 8. at most one `style:"primary"` per view | design-rules.md ("至多一个 primary"); styles.md ("`style:"primary"` 会降为描边并记诊断") | **legal**, but the diagnostic is per styled action ("此样式由 App 保留，已忽略"); `plugViewOnePrimary` never fires, because every plugin action style is ignored |
| 9. spacing only S/M/L; no numeric sizes; `maxLines` on long free text | styles.md (numeric padding/gap is a diagnostic downgrade); text table (`maxLines` 1–20) | **legal** |
| 10. the v1 fallback stays legible (sections → titled text, badges → text, grid → list) | versions.md (v1 ignores `accent`/`style`; v2 components need `adaptView`); D1's `adaptView` | **legal as a shape, but the current implementation loses the numbers** — see H2 |

## Findings

### Blocker

**B1 — there is no v2 panel to review.** D3/D4 (the trees §7 governs) do not exist; T2 is `pending`.
A §7 verdict recorded now would be about a fixture, not about the product. The checklist is ready and
was exercised on a kit-built fixture, but T7's §7 half must be re-run on the landed panels.

**B2 — §6.1/§7.3's "`check.mjs` exit 0" is unachievable with this manifest, and "fixing" it would break
the bundle.** `sdk/plugin-kit/lib/check.js` (`packageIssues`) requires
`typeof pkgJson.dsh.bundle.patch === "string"`; this repo declares the ARRAY
(`./cordis.patch.yml`, `./presets/mpd.patch.yml`) that AGENTS.md §8 and `scripts/install-profile.ts`
depend on. Measured exit 1 at 15:46Z with two package diagnostics only (one error, one warn) and a
`manifest.state "ok"` plus a clean static view. Changing `dsh.bundle.patch` to a string to please the
checker would silently drop the `mpd` preset layer — a far worse defect than a red gate. The contract
must name the evidence it really wants: (a) each declared static view checked alone (exit 0), (b)
`--json` with `manifest.state === "ok"`, `manifest.issues.length === 0` and exactly the two known
package diagnostics recorded as accepted with reason, (c) built live trees piped to `check.mjs -`.
Adding `engines.dsh` (versions.md calls it the supported field) would clear the warn and is the
writers' call; the patch-array error cannot be cleared without a harness-side change.

### High

**H1 — §7.2 rule 6 asks for "avatar (initials)", which the app cannot draw.** `inputs.md` defines
`avatar` as `src` + `alt?` only: a 48 dp square image with an icon fallback, explicitly *no caption*.
Measured: `{"type":"avatar","text":"AB","tone":"info"}` returns exit 0 with one note
(`图片只收插件资源 asset:<路径>…`), the `text` property is silently ignored, and the node renders as
the fallback icon — so a member list built to rule 6 silently loses its initials, with a diagnostic
that reads as a colour/source nit. An asset-based avatar instead needs real image bytes plus a
manifest `assets` entry, which the contract never budgets. Direction: amend rule 6 to
`badge`/`text` initials (theme-token, no asset, and it keeps the v1 fallback trivial), or state that
`avatar` is icon-only and budget the asset.

**H2 — `adaptView`'s `grid → list` fallback drops every metric value.** Measured on a kit-built,
checker-clean §7 panel: the hero's
`grid[metric{label:"Ready",value:3}, metric{label:"Active",value:1}]` becomes
`list[{title:"Ready"},{title:"Active"}]`, and the second hero's `metric{Parked,0}` becomes
`list[{title:"Parked"}]`. Rule 10 requires meaning to survive without styles; here the numbers — the
entire reason a hero exists (rules 2 and 4) — vanish on any app below 1.0.9. The cause is `wordsOf` in
`adaptView`'s grid branch preferring `label` and never reading `value`. Direction: in that branch map a
`metric` child to `{title: label, trailing: String(value)}` (`list` rows support `trailing`) or to
`subtitle`, and keep `wordsOf` for the other children. This is a D1 fix, and it also gives the §7.2
rule-10 evidence something real to assert.

### Medium

**M1 — the kit's `DshGoAvatarProps` promises `caption` and `aspect`, which `avatar` does not execute.**
`image` has those; `avatar` is a fixed 48 dp square with no caption. The checker is silent on unknown
node properties (the schema's `node` has no `additionalProperties:false`), so the over-promise is
invisible. Direction: drop them from the type, or mark them ignored.

**M2 — `divider(props: { size })` accepts a prop the app's `divider` does not take** (it has none).
Same silent-ignore class as M1; `spacer.size` is correct.

**M3 — rule 1 is not enforced by the app checker.** A named colour exits 0 (measured). D1's
`panelView()`/`style()` already make it *unrepresentable through the kit* — good — but that guarantee
is only as strong as the kit being the sole author. The repo gate must assert it on BUILT trees
(`probe-section7.mjs` rules `ACCENT`/`COLOUR`, or their equivalent in `verify-dshgo-views.ts`).

**M4 — the app checker cannot see the live trees in the invocation §6.1 names.**
`checkPlugin()` checks the declared STATIC view files; the live v2 functions are reached only by
`--load`, which imports `exports["."]` (this repo's bundle entry, not a single plugin) and expects a
plain `ctx.dshGo` registration — not the adapter seam. The path that works today, used for the
fixture: build the tree in a test and pipe it to `check.mjs -`. Require that per lane, for both the v2
tree and its `adaptView` fallback.

**M5 — §7.3's "read the diagnostics" needs an exit code of its own.** The checker passes
non-conforming designs (numeric padding, named colour, two primaries: exit 0). Exit 0 therefore says
"legal and inside budget", never "§7-compliant". The §7 assertions must become a gate, not a reading.

### Nits

- N1 `spacer` S/M/L = 8/16/24 dp vs `padding`/`gap` 8/12/16 — same letters, different rhythm.
- N2 the `tabs → stack` fallback emits the tab label as a bare `text` and the hero repeats its own
  title, so the v1 tree says "Board" twice before the first number.
- N3 `accent:"app"` always yields a dark-mode contrast note (`#4B67B4` → `#7B8FC8` / `#899BCE`, once
  per distinct background). Expected; report as accepted, never "fix" by hard-coding a colour.
- N4 `style:"primary"` yields one "reserved, ignored" note per styled action; `plugViewOnePrimary`
  never fires.
- N5 `adaptView` copies a node's `title` onto its replacement even at non-root positions (the
  `emptyState → text` case carries `title`), where the app reads `title` on the root only.

## The four checklist items, answered

1. **`accent:"app"` at every v2 root / no named colour** — not applicable yet (no v2 panel root
   exists). The kit makes it structural: the fixture's root is `accent:"app"`, and the checker's only
   accent output is the dark-mode contrast note. Assertion ready: probe `ACCENT` + `COLOUR`.
2. **§7.2 structural rules** — not verifiable on a deliverable. The probe implements eleven of them
   with a self-test and a negative control; a kit-built conforming fixture passes, the planted
   violation fixture fails as designed.
3. **v1 `adaptView` legibility** — measured and it fails rule 10 for metrics (H2), while the rest of
   the downgrade is sound (styles and accent stripped, `v: 1`, tabs/badge/emptyState/inputs → text,
   `divider`/`spacer` dropped, actions kept).
4. **Checker exit 0 and its diagnostics** — the repo root exits 1 (the patch-array false positive plus
   the `engines.dsh` warn; the first must be accepted with a reason, the second can be closed); each
   static view exits 0; a legal v2 tree exits 0 with the accent dark-mode note and the primary
   "reserved" notes; a deliberately non-conforming tree also exits 0. No colour correction was
   emitted by the kit itself: `style()` refuses every non-`accent` colour, so a correction on a built
   tree would indicate a hand-written node bypassing the kit.

## Declined to judge

- The rendered visual result. No Flutter app here and `preview.mjs` needs Flutter: **UNPROVEN**, as
  §7.3 says. What is provable is v2 legality, theme-token-only, budget and the checker's acceptance.
- The quality of the copy (rule 7's "designed copy") and its bilingual wording.
- Whether a binding-driven tab is empty at runtime — that is decided on the pushed model.
- Whether `card:"tinted"` reads as "designed": the app owns the material; taste is not a gate.

## Bounds

- Documentation pinned at `.mpd/recon/dsh-go` commit `8fe1c1c`; the 1.0.9 target is the contract's
  claim, not re-derived here (the clone carries no app pubspec).
- The only source read is D1's `dshgo-view.ts`, and it was still being written (44,343 → 45,051 bytes
  between 23:46 and 23:48). Those findings are observed-state findings at
  `2026-11-02T15:48:57Z`, not a frozen-hash review. No D2–D7 code exists to read.
- No commit, branch or manifest change: evidence only under `evidence/dshgo/verify/2026-11-02T15-44-36Z/`.

## Verdict

**REQUEST CHANGES** — on the contract (§7.2 rule 6 cannot be built as written; §6.1/§7.3's checker
exit-0 wording is a false gate for this manifest; §7.1 should say each lever's nesting) and on the D1
kit (H2, M1, M2) — with the implementation review **BLOCKED** on T2: the accent guarantee is sound and
the platform is legal, but the only §7 checker available passes deliberately non-conforming views and
the single fallback rule that carries the hero's meaning currently loses it.
