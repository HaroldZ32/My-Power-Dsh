// Measurement for finding 5 (tui-team-surface.ts session selection).
//
// Runs the PRE-FIX selection and the fixed `preferFreshSessionId` over the SAME synthetic header set,
// so the difference the fix makes is a printed number, not a claim. The pre-fix expression is
// reproduced verbatim here (it is gone from the source): it calls `liveSessionId` N times, which reads
// the STORE and answers the same NEWEST id every time, so `.find(...)` could only ever return that
// newest id — and only when it happened to be in `fresh`.
//
// Run: bun evidence/tui/dsh-tui-015/coderabbit/skills/fresh-session-measure.ts
import { preferFreshSessionId } from "../../../../../skills/dsh-qa/scripts/tui-team-surface.ts"
import type { SessionHeaderRecord } from "../../../../../skills/dsh-qa/scripts/lib/tui-lane.ts"

/** The workspace every synthetic header is keyed to. */
const WS = "/qa/sandbox/ws"
/** Build one synthetic session header. */
const header = (sessionId: string, mtimeMs: number, cwd: string = WS): SessionHeaderRecord => ({ projectKey: "--qa-", sessionId, file: "/qa/" + sessionId, sha256: "sha256:0", mtimeMs, agentPreset: "mpd", cwd })

/** THIS run's fresh session, OLDER than the neighbour's warm one. */
const ownFresh = header("own-fresh", 2_000)
/** A previous lane's session for the same workspace, NEWER than this run's. */
const neighbourWarm = header("neighbour-warm", 3_000)
/** The pre-fix selection, reproduced verbatim against a newest-overall reader. */
const preFixSelect = (headers: readonly SessionHeaderRecord[], fresh: readonly string[]): string | undefined => {
  /** The newest workspace-matching id, which is what the pre-fix `liveSessionId` answered. */
  const newest = headers.filter((entry) => entry.cwd === WS).sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.sessionId
  return fresh.map(() => newest).find((candidate) => candidate !== undefined && fresh.includes(candidate))
}

/** The header sets and fresh deltas the two selections are compared on. */
const cases: ReadonlyArray<{ readonly label: string; readonly headers: readonly SessionHeaderRecord[]; readonly fresh: readonly string[] }> = [
  { label: "warm root: newest is the neighbour, this run has one fresh session", headers: [ownFresh, neighbourWarm], fresh: ["own-fresh"] },
  { label: "two fresh sessions of this run (newest fresh must win)", headers: [ownFresh, header("own-fresh-2", 2_500), neighbourWarm], fresh: ["own-fresh", "own-fresh-2"] },
  { label: "no fresh session this run (caller's newest fallback owns the result)", headers: [ownFresh, neighbourWarm], fresh: [] },
]

for (const c of cases) {
  const preFix = preFixSelect(c.headers, c.fresh) ?? "(none)"
  const fixed = preferFreshSessionId(c.headers, c.fresh, WS) ?? "(none)"
  console.log(c.label)
  console.log("  pre-fix selection  = " + preFix)
  console.log("  fixed selection    = " + fixed)
}
