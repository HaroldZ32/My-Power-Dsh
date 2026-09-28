/** Root shape of the persisted ledger `.mpd/boulder.json`: the active work mirrored at the top level plus the full `works` map. */
export interface BoulderState {
  /** Discriminator for the multi-work shape; written as 2 on every mutation and never read back by this bundle. */
  schema_version?: 2
  /** Work whose fields the top-level mirror reflects; absent on a ledger written before `works`, where the read path then selects the newest one. */
  active_work_id?: string
  /** Every recorded work keyed by `work_id`, so a plan can be resumed after another one took over the mirror. */
  works?: Record<string, BoulderWorkState>
  /** Plan file of the mirrored work, recorded exactly as the caller passed it (usually workspace-relative). */
  active_plan: string
  /** ISO-8601 instant the mirrored work started; the baseline `elapsed_ms` is measured from. */
  started_at: string
  /** ISO-8601 instant the mirrored work was completed; absent while it is still running. */
  ended_at?: string
  /** Wall-clock duration in milliseconds of the mirrored work, computed from `started_at`/`ended_at` on completion. */
  elapsed_ms?: number
  /** Lifecycle of the mirrored work; a work built from this mirror is reported as `active` when the value is missing or unknown. */
  status?: BoulderWorkStatus
  /** ISO-8601 instant of the mirrored work's last mutation; resume ordering falls back to `started_at`. */
  updated_at?: string
  /** Sessions that ever touched the mirrored work, each normalized to a `platform:`-prefixed id. */
  session_ids: string[]
  /** How each listed session joined, keyed by the normalized session id, so an inheriting session is distinguishable. */
  session_origins?: Record<string, "direct" | "appended">
  /** Slug of the mirrored work's plan file name; the work's display name and work-id prefix. */
  plan_name: string
  /** Agent that started the mirrored work, when the caller supplied one. */
  agent?: string
  /** Git worktree the mirrored work's plan resolves against, when it was started in one. */
  worktree_path?: string
  /** Per-task timers of the mirrored work, keyed by the plan's top-level task key (`1`, `F1`, …). */
  task_sessions?: Record<string, TaskSessionState>
}

/** How a session id entered a work: `direct` (the default) for the session that recorded itself, `appended` for one a caller marks as joining a work that already existed. */
export type BoulderSessionOrigin = "direct" | "appended"
/** Work lifecycle: `active`/`paused` are resumable and listed as resume options, `completed`/`abandoned` are terminal. */
export type BoulderWorkStatus = "active" | "completed" | "paused" | "abandoned"
/** Per-task timer lifecycle: `startTaskTimer` writes `running`, `endTaskTimer` writes `completed`, and this bundle never writes `cancelled`. */
export type BoulderTaskStatus = "running" | "completed" | "cancelled"

/** One entry of `BoulderState.works`, carrying its own sessions and timers so parallel plan runs stay independent. */
export interface BoulderWorkState {
  /** Stable key of this work inside `works`: the plan slug plus a random hex suffix, or `<slug>-legacy` for a work synthesized from a pre-`works` ledger. */
  work_id: string
  /** Plan file this work is bound to, exactly as the caller passed it. */
  active_plan: string
  /** Slug of the plan file name, used as the work's display name and as the `work_id` prefix. */
  plan_name: string
  /** Lifecycle of this work; undefined counts as still active in the active/resume filters. */
  status?: BoulderWorkStatus
  /** ISO-8601 instant this work started; the baseline `elapsed_ms` is measured from. */
  started_at: string
  /** ISO-8601 instant this work was completed; absent while it is still running. */
  ended_at?: string
  /** Wall-clock duration in milliseconds of this work, computed from `started_at`/`ended_at` on completion. */
  elapsed_ms?: number
  /** ISO-8601 instant of this work's last mutation; "newest work" selection falls back to `started_at`. */
  updated_at?: string
  /** Sessions attached to this work, deduplicated and normalized to `platform:`-prefixed ids. */
  session_ids: string[]
  /** How each attached session joined, keyed by the normalized session id. */
  session_origins?: Record<string, BoulderSessionOrigin>
  /** Agent that started this work, when the caller supplied one. */
  agent?: string
  /** Git worktree this work's plan resolves against, when it was started in one. */
  worktree_path?: string
  /** Per-task timers of this work, keyed by the plan's top-level task key (`1`, `F1`, …). */
  task_sessions?: Record<string, TaskSessionState>
}

/** Checklist counts of one plan file, derived from its markdown on every read and never persisted. */
export interface PlanProgress {
  /** Checkbox items the parser recognized; zero for a missing, unreadable or checkbox-less plan. */
  total: number
  /** Recognized items whose checkbox is ticked; `total - completed` is the work left. */
  completed: number
  /** True only for a plan with at least one recognized item and no unticked one, so an empty plan is never "complete". */
  isComplete: boolean
}

/** Checklist view that also names the next actionable item, the value the status tool shows for a resumed plan. */
export interface PlanChecklist {
  /** Checkbox items the parser recognized; zero for a missing, unreadable or checkbox-less plan. */
  total: number
  /** Recognized items whose checkbox is ticked. */
  completed: number
  /** Recognized items that are still unticked; `completed + remaining === total` always holds. */
  remaining: number
  /** Label of the first unticked item in document order, or null when every item is ticked or none was recognized. */
  nextTaskLabel: string | null
}

/** One per-task timer: which plan task it is, which session holds it, and how long that session ran. */
export interface TaskSessionState {
  /** Plan task key this timer belongs to: the TODO number (`1`) or the final-wave id (`F1`). */
  task_key: string
  /** Task label as recorded, i.e. the plan's `F1. Audit the diff` form when it came from the plan parser. */
  task_label: string
  /** Task title as recorded, with the plan's `N. ` / `F<n>. ` id prefix stripped when parsed from the plan. */
  task_title: string
  /** Normalized, `platform:`-prefixed session id of the timer's current holder. */
  session_id: string
  /** Agent that holds the timer; not carried over by an upsert that omits it, so the value can be lost on re-upsert. */
  agent?: string
  /** Free-form grouping supplied by the caller; not carried over by an upsert that omits it. */
  category?: string
  /** ISO-8601 instant the timer was started; absent on a record created by an upsert that never started it. */
  started_at?: string
  /** ISO-8601 instant the timer was ended; absent while it is still running. */
  ended_at?: string
  /** Wall-clock duration in milliseconds between `started_at` and `ended_at`, computed only when the timer ends. */
  elapsed_ms?: number
  /** Timer lifecycle; `running` after start and `completed` after end. */
  status?: BoulderTaskStatus
  /** ISO-8601 instant of this record's last upsert, refreshed on every timer mutation. */
  updated_at: string
}

/** One resumable work as the status tool reports it: display fields plus the counts and progress computed at read time. */
export interface BoulderWorkResumeOption {
  /** Stable key of the work inside the ledger. */
  work_id: string
  /** Display name of the work (the plan file's slug). */
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
  /** ISO-8601 instant the work was completed; absent while it is still running. */
  ended_at?: string
  /** Wall-clock duration in milliseconds of the work, once it has finished. */
  elapsed_ms?: number
  /** How many sessions have been attached to the work (`session_ids.length`). */
  session_count: number
  /** Checklist progress read from the work's plan file when this option was built. */
  progress: PlanProgress
  /** True when this work is the one the top-level mirror of the ledger currently reflects. */
  is_current_mirror: boolean
}

/** Pointer to one top-level plan task, used to name the next actionable item of a plan file. */
export interface TopLevelTaskRef {
  /** Stable identity `<section>:<lowercased id>`, e.g. `todo:1` or `final-wave:f1`. */
  key: string
  /** Plan section the task was found under, which is what the two checkbox grammars are chosen by. */
  section: "todo" | "final-wave"
  /** Plan-local id as written in the plan: `1`, `2`, … for TODOs and `F1`/`f1` for final-wave items (case preserved). */
  label: string
  /** Task text with the id prefix stripped. */
  title: string
}
