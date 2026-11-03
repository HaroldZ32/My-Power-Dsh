// T21 — THE EXAMPLES' CHART DISCIPLINE: a per-member bar chart, and no fold for a tiny team.
//
// The chart shape is borrowed from the app's own plugin examples (`examples/plugins/<name>/lib/view.js`):
// a `chart` sits right after the hero numbers, names its series, and carries a `caption` saying what it
// counts. The fold threshold exists because the round-2 graph folded a two-line block.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** This evidence directory. */
const E = import.meta.dirname

/** The per-tree measurements `build-trees.ts` wrote. */
const measured = JSON.parse(readFileSync(join(E, "measure.json"), "utf8"))

/** The result this directory certifies. */
const result = {
  lane: "T21 — Borrow the examples' chart discipline: per-member bar chart + no fold for tiny teams",
  at: new Date().toISOString(),
  findings: [
    {
      id: "C1 — per-member bar chart",
      from: "examples/plugins/<name>/lib/view.js: `{ type: 'chart', kind: 'bar', categories, series: [{ name, values }], caption }` right after the metric row",
      built: "Board gets a `Work per member` section: `chart({ kind: 'bar', categories: member names, series: [{ name: 'Tasks', values: rows owned }], caption: 'Board rows owned, by member' })`. Literal categories/values (the panel rebuilds when the roster or a task status changes, which the T10 #9 signature already detects). No members ⇒ NO chart (an empty axis is not a chart).",
      where: "packages/mpd-bundle-plugin/src/dshgo-views.ts memberChartOf + boardTab"
    },
    {
      id: "C2 — no fold for tiny teams",
      from: "round 2 wrapped a two-line block in a `collapsible`",
      built: "`graphNeedsFold(layers)` folds only when the block would hide the board: more than 6 task rows OR more than 3 layers. Below that the `codeBlock` renders directly inside its section; the v1 `steps` branch is unchanged.",
      where: "packages/mpd-bundle-plugin/src/dshgo-graph.ts graphNeedsFold / GRAPH_FOLD_MIN_TASKS / GRAPH_FOLD_MIN_LAYERS + dshgo-views.ts boardTab"
    }
  ],
  measured,
  delta: { teamV2: "3792 B / 44 nodes / depth 5 -> 4091 B / 47 nodes / depth 4", teamV1: "2458 / 36 / 4 -> 2689 / 39 / 4", mpd: "unchanged (3313 / 41 / 5)" },
  tests: [
    "a TINY team (2 tasks) gets a bare codeBlock and NO collapsible; a 7-task board gets exactly one collapsible",
    "the bar chart counts rows per member: categories = roster, series = [2, 1] for the fixture, kind 'bar', a non-empty caption",
    "an empty roster draws NO chart"
  ],
  docDebtClosed: "packages/mpd-bundle-plugin/README.{md,zh-CN.md}: the T20 graph sentence had been REVERTED by a concurrent write (the file was back to the pre-graph text), so the graph + chart text was re-applied and both bullets rewritten clean",
  gates: [
    { id: "bun test packages/mpd-bundle-plugin packages/mpd-dsh-adapter-plugin", exit: 0, observed: "681 pass, 0 fail" },
    { id: "bun run typecheck", exit: 0, observed: "0 errors" },
    { id: "node scripts/verify-comment-coverage.ts", exit: 0, observed: "PASS" },
    { id: "bun run verify:docs", exit: 0, observed: "pairs=55 failed=0 violations=0 dead=0 — PASS" },
    { id: "node scripts/verify-dshgo-views.ts", exit: 0, observed: "PASS" },
    { id: "node scripts/verify-dist-fresh.ts", exit: 0, observed: "34/34 fresh" },
    { id: "bun run verify:gates", exit: 0, observed: "9/9 members green" },
    { id: "app checker", exit: 0, observed: "both static views + all four live trees exit 0" }
  ],
  bounds: [
    "NO RENDER: no Flutter SDK / CJK test fonts in this session — the chart and the fold decision are proven by the tree assertions, the app's own `chart` contract (bar, ≤60 points, ≤6 series, `caption`) and the checker's exit code, not by a PNG.",
    "The chart measures ROWS OWNED, not effort or time: the board carries no estimate, so a bar of task counts is the only honest series. Tasks with no owner are not charted (the board shows them with a dash).",
    "The fold threshold (6 rows / 3 layers) is a judgement call, stated as a constant so it can be tuned in one place."
  ]
}

writeFileSync(join(E, "result.json"), JSON.stringify(result, null, 2) + "\n")
console.log("result.json written")
