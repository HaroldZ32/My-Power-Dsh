// docker/ui/team-fixture.mts — write ONE mpd team record into a workspace so the Web Team tab and the
// TUI team scene have a board to render.
//
// THE CLI HALF. The board SHAPES live as values in `team-fixture-records.mts` so a test can assert
// them; this file only parses the arguments, writes the record and updates the workspace index. It is
// copied into the container by `docker/ui/seed-team-fixture.sh` and run there:
//   node team-fixture.mts <sessionId> <workspace> [normal|malformed]
//
// IT IS A FIXTURE AND IS DECLARED AS ONE: it hand-writes the shape `TeamRecord` /
// `TeamMemberRecord` / `TeamTaskRecord` declare in `packages/mpd-team-core-plugin/src/team-store.ts`,
// and it asserts NO product claim. The install path is proven by `scripts/docker-e2e.ts` and the tool
// path by the QA cases; what it buys is a board the GUI can be graded against.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildRecord } from "./team-fixture-records.mts"
import type { FixtureBoard, FixtureRecord } from "./team-fixture-records.mts"
/**
 * Write one board into a workspace and bind it to a session.
 *
 * EXPORTED so a caller that has just created a session can seed THAT EXACT session, which is the only
 * way to make the seeded board the one a panel renders: MEASURED 2026-10-05, the Web app picks the
 * NEWEST session of a workspace and the capture creates a fresh one on every run, so a board seeded
 * BEFORE the run was always one session stale — the panel showed its empty state, correctly, and the
 * capture looked like a broken graph. Seeding from inside the run (as soon as the driver knows the id)
 * removes the race entirely.
 * @param board - which board shape to write.
 * @param sessionId - the session the team is bound to.
 * @param workspace - the workspace root the surfaces read.
 * @returns the record that was written.
 */
export function seedBoard(board: FixtureBoard, sessionId: string, workspace: string): FixtureRecord {
  /** The record this call writes. */
  const record: FixtureRecord = buildRecord(board, sessionId)
  /** `.mpd/team` under the workspace the surfaces read. */
  const teamRoot: string = join(workspace, ".mpd", "team")
  mkdirSync(join(teamRoot, "teams"), { recursive: true })
  writeFileSync(join(teamRoot, "teams", `${record.teamId}.json`), JSON.stringify(record, null, 2))
  // The per-workspace index is the reader's FAST path; without it the reader falls back to the newest
  // record whose `leadSessionId` matches — writing it makes the fixture exercise the path the panel
  // usually takes.
  const indexPath: string = join(teamRoot, "teams.json")
  /** The index as it stands, or an empty one when there is none to read. */
  let index: { version: number; active: Record<string, string> } = { version: 1, active: {} }
  if (existsSync(indexPath)) {
    try {
      index = JSON.parse(readFileSync(indexPath, "utf8")) as { version: number; active: Record<string, string> }
    } catch {
      // A corrupt index is replaced rather than propagated: the fixture must not fail on bookkeeping.
      index = { version: 1, active: {} }
    }
  }
  index.active = { ...(index.active ?? {}), [sessionId]: record.teamId }
  writeFileSync(indexPath, JSON.stringify(index, null, 2))
  return record
}

// ── THE CLI RUNS ONLY WHEN THIS FILE IS THE ENTRY POINT ──────────────────────────────────────────
// A plain `import` must not execute it: MEASURED 2026-10-05, a consumer that imported `seedBoard` got
// the usage line and an `exit(2)` instead of a function, because the argument check sat at module top
// level. The test this module exists for imports it, so the guard is not optional.
if (process.argv[1] !== undefined && process.argv.slice(2).length >= 2) {
  /** The `[sessionId, workspace, board]` this run was invoked with. */
  const [sessionId, workspace, boardArgument]: (string | undefined)[] = process.argv.slice(2)
  if (workspace === undefined) {
    process.stderr.write("usage: node team-fixture.mts <sessionId> <workspace> [normal|malformed]\n")
    process.exit(2)
  }
  /** The validated board shape; anything else is the normal board. */
  const board: FixtureBoard = boardArgument === "malformed" ? "malformed" : "normal"
  /** The record this run writes; the CLI is a thin wrapper over {@link seedBoard}. */
  const record: FixtureRecord = seedBoard(board, sessionId, workspace)
  process.stdout.write(`seeded ${record.teamId} (board=${board}) for session ${sessionId}: ${record.tasks.length} tasks, ${record.members.length} members\n`)
}
