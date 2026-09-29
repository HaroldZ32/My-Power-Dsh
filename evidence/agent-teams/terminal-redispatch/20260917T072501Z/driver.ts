// T-79 STATE HALF — the AS-COMMITTED (pre-fix) reading, on the HEAD revision of `lib/`.
//
// Ruling 3 (`.mpd/plans/friction-p2-wave-captain-log.md`, A-1) requires the "today it lands" reading
// to be reproduced on the settled revision. `lib/{tools,state,quality-gates}.js` were clean at HEAD
// (`c826f16`) when this lane started, so replacing exactly those three files in a scratch copy of
// `lib/` reproduces the pre-fix module graph byte-for-byte for this item.
//
// Readings taken, for BOTH trees:
//   1. `beginTaskAttempt(completedTask, member)` — the rotation primitive the scheduler's compose
//      calls (`lib/scheduler.js`, `const attemptId = beginTaskAttempt(task, currentMember.name)`).
//   2. `agent_teams_update_task` on a terminal task presenting a capability that is NOT the stored
//      one (the wave-2 replay shape) — answered SUCCESS pre-fix, refused after.
//
// Usage: bun evidence/agent-teams/terminal-redispatch/<stamp>/driver.mjs
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "../../../../")
const STATE_DIR = join(".mpd", "team")
const TEAM_ID = "terminal-redispatch-prefix"
const CAPTAIN_ID = "session-captain-t79"
const STORED_ATTEMPT = "35503430-5a3b-4306-b6f2-d38d416cb438"
const HEAD_FILES = ["tools.js", "state.js", "quality-gates.js"]

const terminalTask = () => ({
    id: "t1",
    subject: "work the replayed ticket",
    assignee: "",
    dependencies: [],
    status: "completed",
    attempt: 1,
    attemptId: STORED_ATTEMPT,
    createdAt: 1,
    updatedAt: 1,
    output: "earned summary",
    verdict: "pass",
})

function fixture() {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t79-pre-"))
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, TEAM_ID, "inbox"), { recursive: true })
    writeFileSync(join(stateRoot, TEAM_ID, "team.json"), `${JSON.stringify({
        id: TEAM_ID,
        name: "t79 prefix",
        captainSessionId: CAPTAIN_ID,
        createdAt: 1,
        approvedAt: 1,
        phase: "running",
        taskSeq: 1,
        members: [{ name: "Architect", id: "member-t79", role: "worker", status: "idle", joinedAt: 1 }],
        tasks: [{ ...terminalTask(), assignee: undefined }],
    }, null, 2)}\n`)
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
    return { workspace, stateRoot, captain }
}

const scratch = mkdtempSync(join(tmpdir(), "mpd-t79-head-lib-"))
const result = { driver: "terminal-redispatch/pre-fix (HEAD lib)", headCommit: "", headFiles: {}, variants: [] }
try {
    result.headCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim()
    cpSync(join(REPO, "packages/mpd-agent-teams-plugin/lib"), join(scratch, "lib"), { recursive: true })
    symlinkSync(join(REPO, "packages/mpd-agent-teams-plugin/_deps"), join(scratch, "_deps"), "dir")
    for (const name of HEAD_FILES) {
        const head = execFileSync("git", ["show", `HEAD:packages/mpd-agent-teams-plugin/lib/${name}`], { cwd: REPO, encoding: "utf8" })
        writeFileSync(join(scratch, "lib", name), head)
        result.headFiles[name] = { bytes: Buffer.byteLength(head) }
    }

    for (const variant of [
        { label: "HEAD (pre-fix)", libDir: join(scratch, "lib") },
        { label: "fixed tree", libDir: join(REPO, "packages/mpd-agent-teams-plugin/lib") },
    ]) {
        const state = await import(pathToFileURL(join(variant.libDir, "state.js")).href)
        const tools = await import(pathToFileURL(join(variant.libDir, "tools.js")).href)

        // 1. the rotation primitive
        const victim = terminalTask()
        let rotation
        try {
            const minted = state.beginTaskAttempt(victim, "Architect")
            rotation = {
                refused: false,
                mintedAttemptId: minted,
                statusAfter: victim.status,
                attemptAfter: victim.attempt,
                attemptIdAfter: victim.attemptId,
                outputAfter: victim.output,
            }
        }
        catch (error) {
            rotation = {
                refused: true,
                message: String(error.message),
                statusAfter: victim.status,
                attemptAfter: victim.attempt,
                attemptIdAfter: victim.attemptId,
                outputAfter: victim.output,
            }
        }

        // 2. the tool path: a terminal task updated with a capability that is not the stored one
        const box = fixture()
        const registered = new Map()
        const ctx = {
            tools: { register: (definition) => { registered.set(definition.name, definition) } },
            agents: { get: (id) => (id === CAPTAIN_ID ? box.captain : undefined), list: () => [box.captain] },
            subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
            effect: () => () => undefined,
            on: () => () => undefined,
            logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
            get: () => undefined,
        }
        tools.registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
        const update = registered.get("agent_teams_update_task")
        let toolOutcome
        try {
            const value = await update.execute(
                { task_id: "t1", status: "completed", attempt_id: "attempt-from-the-replayed-ticket", output: "earned summary" },
                { agent: box.captain },
            )
            toolOutcome = { threw: false, returned: value }
        }
        catch (error) {
            toolOutcome = { threw: true, message: String(error.message) }
        }
        const stored = JSON.parse(readFileSync(join(box.stateRoot, TEAM_ID, "team.json"), "utf8")).tasks[0]
        // JSON drops `undefined`, so the wipe is stated explicitly instead of being inferred
        // from an absent key.
        rotation.outputWiped = victim.output === undefined

        result.variants.push({
            label: variant.label,
            libDir: variant.libDir,
            rotation,
            toolOutcome,
            storedAfter: { status: stored.status, attempt: stored.attempt, attemptId: stored.attemptId, output: stored.output },
        })
        rmSync(box.workspace, { recursive: true, force: true })
    }
}
finally {
    rmSync(scratch, { recursive: true, force: true })
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
