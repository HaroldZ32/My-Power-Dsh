// T-73 (t24) — the composed-ticket WIPE, reproduced on the SETTLED revision and on the fixed tree.
//
// Acceptance item 1 requires the deterministic probe FIRST, on the settled revision, with the
// before/after record quoted. `lib/state.js` was clean at HEAD (`c826f16`) for the T-73 mechanism when
// this lane claimed `t24` — the only edits to it on the working tree are THIS lane's T-79/T-73 regions —
// so a scratch `lib/` whose `state.js` is HEAD's revision IS the as-committed module graph for this row.
//
// The fixture is the wave-1 probe's (`evidence/agent-teams/terminal-dispatch/20260917T023700Z/raw/
// output-wipe-probe.mjs`): one `kickMember` over an `in_progress` task holding a stored deliverable.
//
// Usage: bun evidence/agent-teams/composed-ticket-output/<stamp>/driver.mjs
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "../../../../")
const STATE_DIR = join(".mpd", "team")
const TEAM_ID = "t73-wipe-probe"
const CAPTAIN_ID = "session-captain-t73"
const MEMBER_ID = "member-t73"
const STORED_DELIVERABLE = "THE STORED DELIVERABLE — 9000 bytes of findings the member already recorded"

/** One kick over the wave-1 fixture. `variant` selects the assignee/case under test. */
async function probe(libDir, { status = "in_progress", assignee = "Architect", owner = "Architect" } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "mpd-t73-"))
    mkdirSync(join(dir, STATE_DIR, TEAM_ID, "inbox"), { recursive: true })
    const now = Date.now()
    const teamFile = join(dir, STATE_DIR, TEAM_ID, "team.json")
    writeFileSync(teamFile, `${JSON.stringify({
        id: TEAM_ID,
        name: "T-73 wipe probe",
        captainSessionId: CAPTAIN_ID,
        createdAt: now,
        approvedAt: now,
        phase: "running",
        taskSeq: 1,
        members: [{ name: "Architect", id: MEMBER_ID, role: "worker", joinedAt: now, status: "idle" }],
        tasks: [{
            id: "t1",
            subject: "work t1",
            assignee: owner,
            dependencies: [],
            status,
            attempt: 1,
            attemptId: "attempt-t1-1",
            output: STORED_DELIVERABLE,
            createdAt: now,
            updatedAt: now,
        }],
    }, null, 2)}\n`)
    const before = JSON.parse(readFileSync(teamFile, "utf8")).tasks[0]
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: dir } } }
    const deliveries = []
    const live = new Map([[CAPTAIN_ID, captain], [MEMBER_ID, { id: MEMBER_ID, status: "idle", session: { header: { cwd: dir } } }]])
    const ctx = {
        agents: { get: (id) => live.get(id) },
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        on: () => () => undefined,
        subagents: { prompt: async () => { deliveries.push(1); return { messageId: "m" } } },
    }
    const { installTeamScheduler } = await import(pathToFileURL(join(libDir, "scheduler.js")).href)
    const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })
    await scheduler.kickMember(dir, TEAM_ID, assignee, captain)
    const after = JSON.parse(readFileSync(teamFile, "utf8")).tasks[0]
    rmSync(dir, { recursive: true, force: true })
    return {
        case: `${status}/${owner === assignee ? "same-owner" : "handover"}`,
        outputBefore: before.output,
        outputAfter: after.output ?? null,
        wiped: after.output === undefined,
        statusBefore: before.status,
        statusAfter: after.status,
        attemptBefore: before.attempt,
        attemptAfter: after.attempt,
        deliveries: deliveries.length,
    }
}

const scratch = mkdtempSync(join(tmpdir(), "mpd-t73-head-lib-"))
const result = { driver: "composed-ticket-output (T-73)", headCommit: "", cases: {} }
try {
    result.headCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim()
    cpSync(join(REPO, "packages/mpd-agent-teams-plugin/lib"), join(scratch, "lib"), { recursive: true })
    symlinkSync(join(REPO, "packages/mpd-agent-teams-plugin/_deps"), join(scratch, "_deps"), "dir")
    const headState = execFileSync("git", ["show", "HEAD:packages/mpd-agent-teams-plugin/lib/state.js"], { cwd: REPO, encoding: "utf8" })
    writeFileSync(join(scratch, "lib", "state.js"), headState)
    result.headStateBytes = Buffer.byteLength(headState)

    const trees = [
        { label: "HEAD (pre-fix state.js)", libDir: join(scratch, "lib") },
        { label: "fixed tree", libDir: join(REPO, "packages/mpd-agent-teams-plugin/lib") },
    ]
    for (const tree of trees) {
        result.cases[tree.label] = {
            "in_progress + SAME owner (the wave-1 fixture)": await probe(tree.libDir),
            "in_progress + HANDOVER to another seat": await probe(tree.libDir, { owner: "Reviewer" }),
            "pending task (a NEW generation) dispatched": await probe(tree.libDir, { status: "pending", owner: undefined }),
        }
    }
}
finally {
    rmSync(scratch, { recursive: true, force: true })
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
