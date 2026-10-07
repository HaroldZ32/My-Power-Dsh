// SCRATCH PROBE (Reviewer) — does an oversized radius really bulge into a box? Not a deliverable.
import { readFileSync } from "node:fs"
import ts from "typescript5"

/** The WEB view's own source. */
const SRC = readFileSync("packages/mpd-bundle-plugin/src/team-view.ts", "utf8")
/** The stripped factory. */
const stripped = ts.transpileModule(SRC, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
/** The WEB module. */
const view = new Function("return (" + stripped.trim().replace(/;$/, "") + ")")()({}).createTeamView({ react: null, statePath: "/p" })
/** The dependency table of a rank-skipping board, in pure Chinese subjects. */
const DEPS: Record<string, string[]> = { T1: [], T2: [], T3: [], T4: [], T5: [], T6: ["T2"], T7: ["T2", "T3", "T4", "T6"], T8: ["T7"], T9: ["T2", "T3", "T4", "T5", "T6"], T10: ["T7", "T8", "T9"] }
/** The payload rows. */
const board = Object.keys(DEPS).map((id, i) => ({ id, subject: "纯中文的任务主题" + id, kind: "work", status: "pending", visual: "open", blockedBy: DEPS[id], failedBy: [], depth: i }))
/** The declared geometry table, read from the source. */
const GEO = { column: 168, inset: 4, nodeHeight: 42, nodeGap: 10, pad: 4 }
/** Whether one segment enters a box interior, by Liang-Barsky. */
function seg(f: { x: number; y: number }, t: { x: number; y: number }, b: { left: number; top: number; width: number; height: number }): boolean {
  const left = b.left + 1 + 1e-6, right = b.left + b.width - 1 - 1e-6, top = b.top + 1 + 1e-6, bottom = b.top + b.height - 1 - 1e-6
  if (right <= left || bottom <= top) return false
  let en = 0, ex = 1
  const dx = t.x - f.x, dy = t.y - f.y
  const clip = (p: number, q: number): boolean => { if (p === 0) return q >= 0; const r = q / p; if (p < 0) { if (r > ex) return false; if (r > en) en = r } else { if (r < en) return false; if (r < ex) ex = r } return true }
  if (!clip(-dx, f.x - left)) return false
  if (!clip(dx, right - f.x)) return false
  if (!clip(-dy, f.y - top)) return false
  if (!clip(dy, bottom - f.y)) return false
  return ex > en
}
for (const radius of [undefined, 0, 6, 20, 60, 200]) {
  const g = view.layout(board, radius)
  const boxes = g.nodes.map((n: { task: { id: string }; rank: number; row: number }) => ({ id: n.task.id, left: n.rank * GEO.column + g.inset, top: GEO.pad + n.row * (GEO.nodeHeight + GEO.nodeGap), width: GEO.column - g.inset * 2, height: GEO.nodeHeight }))
  let invasions = 0, samples = 0, curved = 0, qc = 0
  for (const e of g.edges) {
    samples += e.curve.points.length
    if (e.curve.points.length > e.segments.length + 1) curved++
    if (/[QqCc]/.test(e.curve.d)) qc++
    for (let i = 1; i < e.curve.points.length; i++) for (const b of boxes) if (seg(e.curve.points[i - 1], e.curve.points[i], b)) invasions++
  }
  console.log(`radius=${radius}: edges=${g.edges.length} samples=${samples} curvedEdges=${curved} withQC=${qc} invasions=${invasions}`)
}
process.exit(0)
