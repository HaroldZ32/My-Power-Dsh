// VISUAL ROUND 2: three tabs per panel, and a hero grid that gets two columns at phone width.
//
// Both fixes are derived from the APP'S OWN layout code (`.mpd/recon/dsh-go/app`), not from taste: the
// tab bar and the control grid each compute their own column count from the available width, and both
// had silently dropped to a single column/tab row at 390 px. The measurements quoted here are read from
// `lib/ui/chat/dsh_ui/dsh_ui_plugin_choice.dart` (DshUiTabBar) and
// `lib/ui/chat/dsh_ui/dsh_ui_plugin_controls.dart` (DshUiControlChoices.fit).
import { writeFileSync } from "node:fs"
import { join } from "node:path"

/** This evidence directory. */
const E = import.meta.dirname

/** The two findings of this round. */
const findings = [
  {
    id: "W1 — three tabs per panel",
    observed: "AFTER T12 the labels were short but the strips STILL wrapped: Workbench showed three tabs plus a fourth on row 2, Team likewise.",
    appRule: "DshUiTabBar calls DshUiControlChoices.fit(count: labels.length, columns: 4, width, minimum: 80*scale, gap: 0): n = max(1, min(count, 4)); while (n > 1 && width / n < 80) n--; then it lays the labels out in ROWS of n. At phone width the view's content box is under 320 px, so n = 3 and EVERY fourth label lands on a second row regardless of its length. Label shortening could not fix a row-count the width decides.",
    fix: "Each panel now declares THREE tabs. Workbench: Overview | Ask | Library (the workmate library and the memory list merge into one read-only Library tab — the same kind of surface, and the honest grouping). Team: Board | Detail | Watch (the roster moved into the Board tab as a second section). Chinese labels: 总览 | 问题 | 资料库 and 看板 | 详情 | 看门狗.",
    where: "packages/mpd-bundle-plugin/src/dshgo-copy.ts (3-tuples + libraryCaption/agentsHeading/memoryHeading), src/dshgo-views.ts (buildMpdView/buildTeamView + libraryTab + memberRow), dsh-go/views/mpd.json, dsh-go/views/mpd-team.json",
    test: "“THREE tabs, each with exactly ONE tinted hero” (both panels) and “every tab label fits ONE line at a 390 px viewport” (now 3 labels ≤ 8 chars, strip ≤ 24, both languages)"
  },
  {
    id: "W2 — the hero grid gets two columns",
    observed: "The metric grid rendered ONE CELL PER ROW at 390 px even though the view set `columns: 2`.",
    appRule: "the grid case passes node.columns and minimumCellWidth = dshUiPluginContentMinWidth = 136 * textScale to the same fit(); with gap 8 it keeps two columns only while (width - 8) / 2 >= 136 * textScale. Inside a `tinted` hero the card's padding leaves ~300 px, which is under that threshold, so the grid stacks — the `columns` prop is a CEILING, never a floor.",
    fix: "The tiles moved OUT of the hero card and became the tab's first full-width element; the hero keeps the title, the caption and the completion bar. At the panel's own width the two cells clear the threshold. Applied to Overview, Board, Watch and Library's hero (which no longer carries a tile).",
    where: "packages/mpd-bundle-plugin/src/dshgo-views.ts overviewTab / boardTab / watchdogTab",
    test: "“the hero does NOT hold the metric grid, so the grid gets the panel's full width (repair T18)” — fails if a grid is nested inside a tinted node again, and still asserts every metric sits inside a grid"
  }
]

/** The result this directory certifies. */
const result = {
  lane: "T18 — Visual round 2: three tabs per panel and a hero grid that actually gets two columns",
  at: new Date().toISOString(),
  source: "the app's own layout rules (DshUiTabBar / DshUiControlChoices.fit) + the 390x900 renders of round 1",
  findings,
  measured: {
    before: { mpdV2: "3831 B / 48 nodes / 4 tabs", teamV2: "4389 B / 55 nodes / 4 tabs" },
    after: { mpdV2: "3313 B / 41 nodes / 3 tabs", teamV2: "4001 B / 50 nodes / 3 tabs" },
    fallbacks: { mpdV1: "2054 B / 35 nodes", teamV1: "2547 B / 44 nodes" },
    lint: "lintDesign v2 on both live trees and v1 on both fallbacks: [] findings in all four",
    checker: "both declared static views and all four live trees piped to check.mjs - --budget panel: exit 0 each"
  },
  gates: [
    { id: "bun test packages/mpd-bundle-plugin packages/mpd-dsh-adapter-plugin", exit: 0, observed: "675 pass, 0 fail" },
    { id: "bun run typecheck", exit: 0, observed: "tsgo --noEmit clean" },
    { id: "node scripts/verify-comment-coverage.ts", exit: 0, observed: "PASS" },
    { id: "bun run verify:docs", exit: 0, observed: "pairs=55 failed=0 violations=0 dead=0 — PASS" },
    { id: "node scripts/verify-dshgo-views.ts", exit: 0, observed: "PASS" },
    { id: "node scripts/verify-dist-fresh.ts", exit: 0, observed: "34/34 targets fresh (two targets rebuilt with the pinned toolchain)" },
    { id: "bun run verify:gates", exit: 0, observed: "9/9 members green" }
  ],
  docsUpdated: [
    "docs/drive-surface.md — both panels described with three tabs, plus the two MEASURED rules (tab strip rows, grid column threshold) and why label shortening was not enough",
    "docs/drive-surface.zh-CN.md — the same, in Chinese",
    "docs/user-guide.md §16.1 + docs/user-guide.zh-CN.md — the user-facing tab list and the one-line reason for three"
  ],
  bounds: [
    "NO RENDER AGAIN: this session has no Flutter SDK and no CJK test fonts, so the after-state cannot be photographed here. The evidence is the app's own layout arithmetic plus structural assertions (tab count, label lengths, tiles outside the tinted node, node/byte deltas). The captain should re-take the two 390x900 PNGs from a Flutter checkout before calling the visual result proven.",
    "The merge choices are DESIGN decisions I made inside the captain's instruction: Library = workmates + memory; the roster moved under Board. If either grouping is wrong, the fix is a copy change plus a section order, not a structural rewrite.",
    "The grid threshold is read from the app checkout in `.mpd/recon/dsh-go/app` (version pinned there). A different app version could move it; the regression arm pins OUR side of the contract (grid outside the padded card), not the app's number."
  ]
}

writeFileSync(join(E, "result.json"), JSON.stringify(result, null, 2) + "\n")
console.log("result.json written")
