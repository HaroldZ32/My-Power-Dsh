# L4 — published signatures of `packages/mpd-tui-plugin/src/subagent-rows.ts`

Durable artifact for lanes **L2** (`panel-dag.ts`) and **L6** (web plane), both blocked on L4 (task T2).
The module is the ONE place the TUI builds subagent rows: the sidebar page and the full-screen merged
scene consume it, so the two surfaces cannot drift on what a row says or when it stops being drawn.

Back-compat: `subagent-scene.ts` still RE-EXPORTS every symbol below (the `subagent-scene.ts` import
path keeps working while `panel-dag.ts` migrates). New code should import from `./subagent-rows.js`.

## Types

```ts
/** One subagent row as the TUI renders it. */
export interface SubagentRowView {
  agentId?: string        // host id, kept for the interrupt path only
  description: string     // sanitized; "(no description)" when the host reported none
  mode: string            // one-shot | continuable | unknown — DATA ONLY, never drawn (D7)
  status: string          // starting | running | completed | failed | cancelled | unknown
  startedAt?: number      // epoch ms (was an ISO string before L4)
  endedAt?: number        // epoch ms, `endedAt ?? completedAt` (was an ISO string before L4)
  live: boolean           // status is running/starting
  failed: boolean         // status is failed/cancelled
  parentSessionId?: string// NEVER drawn; the "another session's row" correlation field
}

/** One projected row plus the raw host entry the detail view re-reads. */
export interface SubagentRowEntry { view: SubagentRowView; entry: unknown }

/** One drawn row of the section; `rowIndex` indexes the DRAWN rows, not the raw catalog. */
export interface SubagentSectionRow { text: string; header?: boolean; dim?: boolean; rowIndex?: number }

/** One team of THIS session, reduced to the two facts the burn rule's team arm needs. */
export interface SubagentTeamScope { members: readonly string[]; ended: boolean }

/** Everything the burn projection needs — all of it the surface already holds. */
export interface SubagentRowFilter {
  now: number                          // the render clock (epoch ms), ONE per render
  teams?: readonly SubagentTeamScope[] // this session's own team scope(s)
  sessionId?: string                   // the session whose catalog is drawn
}
```

## Constants

```ts
export const SUBAGENT_ROW_GRACE_MS = 60_000  // how long a terminal row stays visible (pinned by test)
export const MERGED_ROW_MAX_CELLS = 4000     // one row's cell budget (moved here from the scene)
```

## Functions

```ts
subagentRowFilter(workflow: unknown, sessionId: string | undefined, now?: number): SubagentRowFilter
// The ONE wiring call: builds the filter from the session-scoped TeamWorkflow + the session id.

subagentSectionRows(source: unknown, filter?: SubagentRowFilter): SubagentSectionRow[]
// Project + burn-filter + build the section. `rowIndex` addresses the DRAWN rows.

subagentSectionOf(rows: readonly SubagentRowView[], now?: number): SubagentSectionRow[]
// The section over an already-filtered row list (used by the scene, which needs the same list twice).

visibleSubagentRows(source: unknown, filter?: SubagentRowFilter): SubagentRowView[]
visibleSubagentEntries(source: unknown, filter?: SubagentRowFilter): SubagentRowEntry[]
filterSubagentEntries(entries: readonly SubagentRowEntry[], filter?: SubagentRowFilter): SubagentRowEntry[]
// The projection without the section; order preserved.

subagentRowVisible(view: SubagentRowView, filter?: SubagentRowFilter): boolean
// The burn rule for ONE row. NO filter ⇒ always true (the declared back-compat default).

subagentRowEntries(source: unknown): SubagentRowEntry[]   // unfiltered projection
subagentRows(source: unknown): SubagentRowView[]          // unfiltered rows
subagentRowView(entry: unknown): SubagentRowView | undefined
subagentTeamScope(workflow: unknown): SubagentTeamScope | undefined

subagentRowLine(row: SubagentRowView, now?: number): string   // the COMPACT line (D7)
subagentRowAge(at: number, now: number): string               // `<1s` | `Ns` | `Nm` | `Nh` | `Nd` | `?`
glyphOf(row: SubagentRowView): string                         // 🟡 ⚪ 🔴 🟢
safeRow(value: unknown): string                               // stripControl + clampCells
```

## Recipes

**L2 — the sidebar (`panel-dag.ts`, its own write scope).** Replace the import with

```ts
import { subagentRowFilter, subagentSectionRows, type SubagentSectionRow } from "./subagent-rows.js"
```

and at the call site (the `workflow` local is already in scope):

```ts
section = subagentSectionRows(
  panelSnapshot(props?.host),
  subagentRowFilter(workflow, sessionIdOf(panelSnapshot(props?.host)), Date.now()),
)
```

`now` is the render clock: pass `Date.now()` (or the page's own tick) so the grace window and the ages
are the same instant for every row. Do NOT widen `subagentRowVisible` with a new input — everything it
needs is in the filter.

**L6 — the web plane.** The TUI module cannot be imported across the package boundary; the web change
is its own implementation of the SAME two rules, read off the same facts:
- ended team (`record.endedAt !== undefined`) ⇒ its member cards stop being presented;
- ages render `Ns` / `Nm` / `Nh` / `Nd` (`subagentRowAge`'s thresholds: <1 s ⇒ `<1s`, then 60 s/60 min/
  24 h buckets); no ISO instant in a rendered card.
The TUI-side reference implementation is `packages/mpd-tui-plugin/src/subagent-rows.ts` (`teamVerdict`,
`subagentRowAge`).

## No `index.ts` dependency

Nothing needs threading from `packages/mpd-tui-plugin/src/index.ts`: the merge scene builds the filter
from the `TeamWorkflow` it already refreshes (its `team.phase === "ended"` is exactly the record's
`endedAt !== undefined`), from `sessionIdOf(channel)`, and from its own clock. The scene factory's new
`now` parameter is OPTIONAL with a wall-clock default, so `scenes.ts`'s existing four-argument call needs
no change (L3 may pass a clock if it wants one).
