// Boulder core: the persisted data contract of the durable work ledger.
//
// Written here for wave de-omo C against the shape the shipped ledger already stores, so an existing
// `.mpd/boulder.json` keeps resuming. Every field a writer emits is declared here; the reader also
// TOLERATES the absence of the optional halves, because a record on disk may predate this writer.

/** The whole ledger file `.mpd/boulder.json`: a `works` map plus the top-level mirror of its active entry. */
export interface BoulderState {
  /** Shape discriminator; writers stamp `2`, and a pre-`works` record may omit it entirely. */
  schema_version?: 2
  /** Id of the work the top-level mirror reflects; absent on a legacy record, where the reader picks the newest instead. */
  active_work_id?: string
  /** Every work of this workspace keyed by `work_id`, which is what lets a second plan resume after another took the mirror. */
  works?: Record<string, BoulderWorkState>
  /** Plan file of the mirrored work, stored exactly as the caller passed it (usually workspace-relative). */
  active_plan: string
  /** ISO-8601 instant the mirrored work started; the baseline every `elapsed_ms` is measured from. */
  started_at: string
  /** ISO-8601 instant the mirrored work finished; absent while it is still running. */
  ended_at?: string
  /** Wall-clock duration of the mirrored work in milliseconds, derived from its two instants on completion. */
  elapsed_ms?: number
  /** Lifecycle of the mirrored work; a missing or unknown value is reported as `active`. */
  status?: BoulderWorkStatus
  /** ISO-8601 instant of the mirrored work's last mutation; resume ordering falls back to `started_at`. */
  updated_at?: string
  /** Sessions that ever touched the mirrored work, each in `platform:`-prefixed form. */
  session_ids: string[]
  /** How each of those sessions joined, keyed by the normalized session id. */
  session_origins?: Record<string, "direct" | "appended">
  /** Slug of the mirrored work's plan file name; doubles as its display name and its work-id prefix. */
  plan_name: string
  /** Agent that started the mirrored work, when the caller named one. */
  agent?: string
  /** Git worktree the mirrored work's plan resolves against, when it was started in one. */
  worktree_path?: string
  /** Per-task timers of the mirrored work, keyed by the plan's task key (`1`, `F1`, …). */
  task_sessions?: Record<string, TaskSessionState>
}

/** How a session entered a work: `direct` for the session that recorded itself, `appended` for one a caller attaches to an existing work. */
export type BoulderSessionOrigin = "direct" | "appended"

/** Work lifecycle; `active` and `paused` stay resumable, `completed` and `abandoned` are terminal. */
export type BoulderWorkStatus = "active" | "completed" | "paused" | "abandoned"

/** Per-task timer lifecycle; starting writes `running`, ending writes `completed`, and nothing here writes `cancelled`. */
export type BoulderTaskStatus = "running" | "completed" | "cancelled"

/** One entry of the ledger's `works` map, carrying its own sessions and timers so parallel plan runs stay independent. */
export interface BoulderWorkState {
  /** Stable key of this work inside `works`: a generated `<slug>-<hex>`, or `<slug>-legacy` for one synthesized from a pre-`works` record. */
  work_id: string
  /** Plan file this work is bound to, as the caller passed it. */
  active_plan: string
  /** Slug of that plan file's name; the work's display name and its work-id prefix. */
  plan_name: string
  /** Lifecycle of this work; absent and unknown both count as still active in the resume filters. */
  status?: BoulderWorkStatus
  /** ISO-8601 instant this work started; the baseline its `elapsed_ms` is measured from. */
  started_at: string
  /** ISO-8601 instant this work finished; absent while it is still running. */
  ended_at?: string
  /** Wall-clock duration of this work in milliseconds, derived from its two instants on completion. */
  elapsed_ms?: number
  /** ISO-8601 instant of this work's last mutation; "newest work" selection falls back to `started_at`. */
  updated_at?: string
  /** Sessions attached to this work, deduplicated and each in `platform:`-prefixed form. */
  session_ids: string[]
  /** How each attached session joined, keyed by the normalized session id. */
  session_origins?: Record<string, BoulderSessionOrigin>
  /** Agent that started this work, when the caller named one. */
  agent?: string
  /** Git worktree this work's plan resolves against, when it was started in one. */
  worktree_path?: string
  /** Per-task timers of this work, keyed by the plan's task key (`1`, `F1`, …). */
  task_sessions?: Record<string, TaskSessionState>
}

/** Checklist counts of one plan file, recomputed from its markdown on every read and never persisted. */
export interface PlanProgress {
  /** Checkbox items the parser recognized; zero for a missing, unreadable or checkbox-less plan. */
  total: number
  /** Recognized items whose box is ticked. */
  completed: number
  /** True only for a plan holding at least one recognized item and no unticked one, so an empty plan is never "complete". */
  isComplete: boolean
}

/** Checklist view that also names the next actionable item, which is what the status tool shows for a resumed plan. */
export interface PlanChecklist {
  /** Checkbox items the parser recognized; zero for a missing, unreadable or checkbox-less plan. */
  total: number
  /** Recognized items whose box is ticked. */
  completed: number
  /** Recognized items still unticked; `completed + remaining === total` holds by construction. */
  remaining: number
  /** Label of the first unticked item in document order, or null when every item is ticked or none was recognized. */
  nextTaskLabel: string | null
}

/** One per-task timer: which plan task it is, which session holds it, and how long that session ran. */
export interface TaskSessionState {
  /** Plan task this timer belongs to: the TODO number (`1`) or the final-wave id (`F1`). */
  task_key: string
  /** Task label as recorded, i.e. the plan's `F1. Audit the diff` form when the plan parser produced it. */
  task_label: string
  /** Task title as recorded, with the plan's `N. ` / `F<n>. ` id prefix stripped when parsed from a plan. */
  task_title: string
  /** Normalized, `platform:`-prefixed id of the session currently holding the timer. */
  session_id: string
  /** Agent holding the timer; an upsert that omits it does not carry the stored value over. */
  agent?: string
  /** Free-form grouping supplied by the caller; an upsert that omits it does not carry the stored value over. */
  category?: string
  /** ISO-8601 instant the timer was started; absent on a record an upsert never started. */
  started_at?: string
  /** ISO-8601 instant the timer was ended; absent while it is still running. */
  ended_at?: string
  /** Wall-clock duration in milliseconds between the two instants above, written only when the timer ends. */
  elapsed_ms?: number
  /** Timer lifecycle; `running` after a start and `completed` after an end. */
  status?: BoulderTaskStatus
  /** ISO-8601 instant of this record's last upsert, refreshed by every timer mutation. */
  updated_at: string
}

/** One resumable work as the status tool reports it: display fields plus the counts and progress computed at read time. */
export interface BoulderWorkResumeOption {
  /** Stable key of the work inside the ledger. */
  work_id: string
  /** Display name of the work, i.e. its plan file's slug. */
  plan_name: string
  /** Plan file the work is bound to, as recorded at start. */
  active_plan: string
  /** Git worktree the work's plan resolves against, when it has one. */
  worktree_path?: string
  /** Lifecycle of the work; a stored value outside the known set is reported as `active` rather than omitted. */
  status: BoulderWorkStatus
  /** ISO-8601 instant the work started. */
  started_at: string
  /** ISO-8601 instant of the work's last mutation, falling back to `started_at` when none was recorded. */
  updated_at: string
  /** ISO-8601 instant the work finished; absent while it is still running. */
  ended_at?: string
  /** Wall-clock duration of the work in milliseconds, once it has finished. */
  elapsed_ms?: number
  /** How many sessions are attached to the work (`session_ids.length`). */
  session_count: number
  /** Checklist progress read from the work's plan file while this option was built. */
  progress: PlanProgress
  /** True when this work is the one the ledger's top-level mirror currently reflects. */
  is_current_mirror: boolean
}

/** Pointer to one top-level plan task, used to name the next actionable item of a plan file. */
export interface TopLevelTaskRef {
  /** Stable identity `<section>:<lowercased id>`, e.g. `todo:1` or `final-wave:f1`. */
  key: string
  /** Plan section the task was found under, which is what chose its checkbox grammar. */
  section: "todo" | "final-wave"
  /** Plan-local id as written in the plan: `1`, `2`, … for TODOs and `F1`/`f1` for final-wave items, case preserved. */
  label: string
  /** Task text with its id prefix stripped. */
  title: string
}
