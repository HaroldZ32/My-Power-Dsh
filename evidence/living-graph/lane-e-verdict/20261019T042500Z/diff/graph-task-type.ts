export interface GraphTask {
  /** The task id the drawing labels and the caller focuses by. */
  id: string
  /** The task title, truncated to whatever the geometry allows. */
  subject: string
  /** `requirement` | `work` | `review` | `repair` | `integration`, abbreviated for the label. */
  kind?: string
  /** The RENDERED state `team-state.ts` computed: completed|running|failed|blocked|open|cancelled. */
  visual: string
  /** Owner display name, absent when nobody holds it. */
  assignee?: string
  /** Ids this task is blocked by, in board order. */
  dependencies: readonly string[]
  /** Longest dependency path (0 = a root); the boxes view's RANK. */
  depth: number
  /** Attempt counter, when the record carries one. */
  attempt?: number
}
