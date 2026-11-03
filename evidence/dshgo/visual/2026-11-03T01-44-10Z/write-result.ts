// VISUAL ROUND 3: the roster as ONE list line per member.
//
// The defect and the fix are both read off the app's `_RowView` (lib/ui/chat/dsh_ui/dsh_ui_widgets.dart):
// a `row` lays its children out in `floor((width + gap) / (need + gap))` columns, where `need` is the
// WIDEST child's minimum width (metric 96, progress 140, text/badge 160, nested layout/list 200). At a
// phone's ~300 px that is one column for anything text-sized, so badge + stack + badge stacked into
// three fragments per member.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** This evidence directory. */
const E = import.meta.dirname

/** The per-tree measurements `build-trees.ts` wrote. */
const measured = JSON.parse(readFileSync(join(E, "measure.json"), "utf8"))

/** The result this directory certifies. */
const result = {
  lane: "T19 — Visual round 3: member rows must be one line each",
  at: new Date().toISOString(),
  finding: {
    observed: "each member rendered as THREE stacked fragments (initials badge, then a name/mode stack, then a state badge) instead of one row.",
    appRule: "`_RowView` computes `need = max(child minimum widths)` — metric 96, progress 140, text/badge 160, nested layout/list 200 — then `columns = clamp(floor((width + gap) / (need + gap)), 1, children.length)`. The member row's stack child is a nested layout (200), so at ~300 px it gets ONE column and every child takes its own line.",
    fix: "the roster is now ONE `list` per member: title `DW · Deep Worker` (initials first, so the badge's meaning survives as text), the state word as `trailing`, `tone` for the semantic colour, NO subtitle. A list item cannot wrap into fragments, so each member is exactly one line.",
    where: "packages/mpd-bundle-plugin/src/dshgo-views.ts memberLine (replaces memberRow) + boardTab",
    test: "“member rows are ONE line each: initials+name as the title, the state WORD as trailing (repair T19)” — asserts no subtitle, a non-empty trailing word, the exact `DW · Deep Worker` title, AND that the tree contains no `row` node at all"
  },
  measured,
  delta: { teamV2: "4001 B / 50 nodes / depth 6 -> 3452 B / 39 nodes / depth 4", teamV1: "2547 B / 44 / 6 -> 2299 B / 33 / 4", mpd: "unchanged (3313 B / 41 / 5)" },
  docsUpdated: [
    "packages/mpd-bundle-plugin/README.md + README.zh-CN.md — the team panel's tab list was STILL the four-tab text (a T18 gap) and is now three, with the one-line roster; the 'member initials are a badge' sentence is corrected in both halves",
    "docs/drive-surface.md + .zh-CN.md — the same badge sentence corrected"
  ],
  gates: [
    { id: "bun test packages/mpd-bundle-plugin packages/mpd-dsh-adapter-plugin", exit: 0, observed: "675 pass, 0 fail" },
    { id: "bun run typecheck", exit: 0, observed: "0 errors" },
    { id: "node scripts/verify-comment-coverage.ts", exit: 0, observed: "PASS" },
    { id: "bun run verify:docs", exit: 0, observed: "pairs=55 failed=0 violations=0 dead=0 — PASS" },
    { id: "node scripts/verify-dshgo-views.ts", exit: 0, observed: "PASS" },
    { id: "node scripts/verify-dist-fresh.ts", exit: 0, observed: "34/34 fresh (the bundle target rebuilt)" },
    { id: "bun run verify:gates", exit: 0, observed: "9/9 members green" },
    { id: "app checker", exit: 0, observed: "both static views + all four live trees exit 0" }
  ],
  bounds: [
    "NO RENDER: this session still has no Flutter SDK and no CJK test fonts, so the one-line result is proven by the app's own column arithmetic plus the tree assertion, not by a PNG. Re-take the 390x900 pair from a Flutter checkout before calling it visually proven.",
    "The initials moved from a `badge` NODE to the row's title text. That is what makes one line possible: any badge/text child forces a 160 px minimum, and three of them cannot share a phone row. If the badge's visual weight matters more than the line count, the trade is tabs/sections, not a row.",
    "The Board tab now carries the task list AND the roster. Both are `list` sections, so the tab stays compact (39 nodes), but it is a scrolling tab on a phone."
  ]
}

writeFileSync(join(E, "result.json"), JSON.stringify(result, null, 2) + "\n")
console.log("result.json written")
