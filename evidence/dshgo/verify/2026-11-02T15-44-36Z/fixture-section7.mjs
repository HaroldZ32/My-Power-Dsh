// REVIEW FIXTURE, not product code. Builds one §7.2-conforming panel with the D1 kit and
// downgrades it, so the reviewer can feed BOTH trees to the app checker and to probe-section7.mjs.
// The point is the v1 fallback: `grid` becomes `list`, and the numbers a metric carries must
// survive that rewrite (§7.2 rule 10, "meaning survives without styles").
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  actions, adaptView, badge, BUDGETS, emptyState, grid, measureView, metric, panelView, progress, stack, tabs, text,
} from "../../../../packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts"

const here = dirname(fileURLToPath(import.meta.url))

/** One hero: the tinted card rule 2 asks for, with the metrics in a grid (rule 4). */
const hero = (title, caption, metrics) => stack([
  text(title, { style: { size: "title", weight: "bold" } }),
  text(caption, { style: { size: "caption", maxLines: 1 } }),
  grid(metrics, { columns: 2 }),
], { style: { card: "tinted", padding: "M", gap: "S" } })

/** A body section: surface card, subtitle header, a badge that carries its word, a progress. */
const body = stack([
  text("Tasks", { style: { size: "subtitle", weight: "semibold" } }),
  badge({ text: "in progress", tone: "info" }),
  progress(60, { label: "Done", caption: "3 of 5" }),
], { style: { card: "surface", padding: "M", gap: "S" } })

const view = panelView({
  style: { gap: "M" },
  children: [
    tabs([
      {
        label: "Board",
        children: [
          hero("Board", "3 ready · 1 active", [
            metric({ label: "Ready", value: 3 }),
            metric({ label: "Active", value: 1 }),
          ]),
          body,
          actions([{ label: "Refresh", action: "refresh", primary: true }]),
        ],
      },
      {
        label: "Questions",
        children: [
          hero("Questions", "nothing parked", [metric({ label: "Parked", value: 0 })]),
          emptyState({ title: "No question parked", message: "A question shows up here when the team asks one." }),
        ],
      },
    ]),
  ],
})

const old = adaptView(view, { app: "1.0.8" })
const measured = measureView(view)
writeFileSync(join(here, "fixture-v2.json"), `${JSON.stringify(view, null, 2)}\n`)
writeFileSync(join(here, "fixture-v1.json"), `${JSON.stringify(old, null, 2)}\n`)
process.stdout.write(`v2 bytes=${measured.bytes} nodes=${measured.nodes} depth=${measured.depth} budget=${JSON.stringify(BUDGETS.panel)}\n`)
process.stdout.write(`v2 fits=${JSON.stringify(measureView(view)) === JSON.stringify(measured) ? "measured" : "?"} accent=${JSON.stringify(view.accent)} v=${JSON.stringify(view.v)}\n`)
process.stdout.write(`v1 root v=${JSON.stringify(old.v)} accent=${JSON.stringify(old.accent)} keys=${Object.keys(old).join(",")}\n`)
process.stdout.write(`v1 grid->list: ${JSON.stringify((old.children?.[0]?.items?.[0]?.children ?? []).find((node) => node.type === "list") ?? null)}\n`)
process.stdout.write(`v1 any style left: ${JSON.stringify(JSON.stringify(old).includes('"style"'))}\n`)
process.stdout.write("fixture-v2.json + fixture-v1.json written\n")
