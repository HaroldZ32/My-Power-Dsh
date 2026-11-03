// THE BOARD'S DEPENDENCY GRAPH: a LAYERED layout rendered as monospace text (v2) or steps (v1).
//
// WHY A TEXT GRAPH AND NOT A GRAPH WIDGET: view v2 has no node/edge component, and the app executes no
// layout of ours — so a dependency graph has to BE the characters. `codeBlock` renders them monospaced
// and `collapsible` folds the block away when it is not wanted, which is the whole vocabulary this
// surface offers. Older apps get `steps`, one step per layer, because `codeBlock` is v2-only.
//
// THE LAYOUT RULE: a task's level is 0 when nothing on the board blocks it, else one more than the
// highest level among its blockers. That is the classic longest-path layering, computed by relaxation
// with a pass cap so a CYCLIC board renders instead of hanging (a cycle simply stops rising).
//
// WHAT IT DELIBERATELY IS NOT: it does not draw boxes or diagonal edges. A phone-width code block is
// about forty characters, and box art either wraps or needs horizontal scrolling; `L2 T3 Ship it <-T2`
// keeps the level, the id, the subject and the incoming edges on one readable line.
import type { DshGoStep } from "../../mpd-dsh-adapter-plugin/src/dshgo-view"
import type { TeamPanelTask } from "./dshgo-views"

/** One level of the layout: its depth from the roots, and the tasks that sit at it. */
export interface GraphLayer {
  /** 0 for a root task, 1 for a child of a root, and so on. */
  readonly level: number
  /** The tasks at this level, in board order. */
  readonly tasks: readonly TeamPanelTask[]
}

/** How many characters of a task's subject the graph prints before clipping. */
export const GRAPH_SUBJECT_CHARS = 18

/** How many task lines the graph prints before it stops and counts the rest. */
export const GRAPH_MAX_LINES = 20

/** How many layers the v1 `steps` fallback may carry (the component's own limit is 12). */
export const GRAPH_MAX_STEPS = 12

/** Above this many tasks the graph is folded away; a tiny board shows it directly. */
export const GRAPH_FOLD_MIN_TASKS = 6

/** Above this many layers the graph is folded away, because the block is taller than the fold saves. */
export const GRAPH_FOLD_MIN_LAYERS = 3

/**
 * Whether the graph is worth folding away.
 *
 * A FOLD AROUND TWO LINES IS NOISE: it costs a tap to reveal what was already readable, and it hides the
 * one thing a small team opens the tab for. The fold appears only when the block would push the board off
 * the phone's first screen — more than {@link GRAPH_FOLD_MIN_TASKS} rows or more than
 * {@link GRAPH_FOLD_MIN_LAYERS} layers.
 * @param layers - the layout {@link layerGraphOf} produced.
 * @returns true when the caller should wrap the block in a `collapsible`.
 */
export function graphNeedsFold(layers: readonly GraphLayer[]): boolean {
  /** How many task lines the graph prints. */
  const tasks = layers.reduce((total, layer) => total + layer.tasks.length, 0)
  return tasks > GRAPH_FOLD_MIN_TASKS || layers.length > GRAPH_FOLD_MIN_LAYERS
}

/**
 * The on-board blockers of one task: ids that name a row of this board.
 * @param task - the task whose blockers are resolved.
 * @param known - every id on the board.
 * @returns the blocker ids that exist on the board, in the order the record lists them.
 */
function blockersOf(task: TeamPanelTask, known: ReadonlySet<string>): string[] {
  /** The task's declared blockers, kept only when the board actually holds them. */
  const declared = task.dependencies === "" ? [] : task.dependencies.split(",").map((id) => id.trim())
  return declared.filter((id) => id !== "" && known.has(id))
}

/**
 * Lay a board out in dependency levels.
 *
 * The level rises by relaxation: every pass lifts a task above its highest blocker, and the pass count
 * is capped at the task count so a cyclic board terminates at the depth it reached.
 * @param tasks - the board's tasks, in board order.
 * @returns the levels, ascending, each holding the tasks that sit at it.
 */
export function layerGraphOf(tasks: readonly TeamPanelTask[]): GraphLayer[] {
  /** Every id the board holds, so a blocker that names nothing is ignored (the same rule the ready list uses). */
  const known = new Set(tasks.map((task) => task.id))
  /** The level computed for each task, starting at 0. */
  const level = new Map<string, number>(tasks.map((task) => [task.id, 0]))
  for (let pass = 0; pass < tasks.length; pass += 1) {
    /** Whether this pass raised anything, i.e. whether another pass can still change the layout. */
    let raised = false
    for (const task of tasks) {
      /** The blockers of this task that name a real row. */
      const blocked = blockersOf(task, known)
      if (blocked.length === 0) continue
      /** The level this task must sit above. */
      const wanted = Math.max(...blocked.map((id) => level.get(id) ?? 0)) + 1
      if ((level.get(task.id) ?? 0) < wanted) {
        level.set(task.id, wanted)
        raised = true
      }
    }
    if (!raised) break
  }
  /** The deepest level any task reached. */
  const deepest = tasks.reduce((max, task) => Math.max(max, level.get(task.id) ?? 0), 0)
  /** The layers, in ascending order, skipping any level nothing sits at. */
  const layers: GraphLayer[] = []
  for (let depth = 0; depth <= deepest; depth += 1) {
    /** The tasks at this depth, in board order. */
    const at = tasks.filter((task) => (level.get(task.id) ?? 0) === depth)
    if (at.length > 0) layers.push({ level: depth, tasks: at })
  }
  return layers
}

/**
 * Render the layered graph as monospace lines.
 * @param layers - the layout {@link layerGraphOf} produced.
 * @returns one line per task plus, past {@link GRAPH_MAX_LINES}, one line naming the remainder.
 */
export function graphLinesOf(layers: readonly GraphLayer[]): string[] {
  /** The task entries flattened from the layers, in reading order. */
  const entries = layers.flatMap((layer) => layer.tasks.map((task) => ({ level: layer.level, task })))
  if (entries.length === 0) return ["(no tasks)"]
  /** The printed lines. */
  const lines: string[] = []
  for (const { level, task } of entries.slice(0, GRAPH_MAX_LINES)) {
    /** The subject, clipped so a long title cannot push the edges off the line. */
    const subject = task.subject.length <= GRAPH_SUBJECT_CHARS ? task.subject : task.subject.slice(0, GRAPH_SUBJECT_CHARS - 1) + "…"
    /** The incoming edges, empty for a root task. */
    const from = task.dependencies === "" ? "" : " <-" + task.dependencies.split(",").map((id) => id.trim()).filter((id) => id !== "").join(",")
    lines.push("L" + String(level) + " " + task.id + " " + subject + from)
  }
  if (entries.length > GRAPH_MAX_LINES) lines.push("+" + String(entries.length - GRAPH_MAX_LINES) + " more")
  return lines
}

/**
 * The v1 fallback: one `steps` entry per layer, since `codeBlock` does not exist before view v2.
 * @param layers - the layout {@link layerGraphOf} produced.
 * @returns at most {@link GRAPH_MAX_STEPS} steps, each naming its layer and the ids it holds.
 */
export function graphStepsOf(layers: readonly GraphLayer[]): DshGoStep[] {
  return layers.slice(0, GRAPH_MAX_STEPS).map((layer) => ({
    label: "L" + String(layer.level),
    detail: layer.tasks.map((task) => task.id).join(" "),
    status: layer.level === 0 ? "done" : "todo",
  }))
}
