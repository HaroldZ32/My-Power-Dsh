// T-61 pre-fix reproduction driver (wave 2, lane A) — the AS-COMMITTED call path.
//
// Ruling 3 of `.mpd/plans/friction-p2-wave-captain-log.md` (A-1) requires every "today it
// swallows / today it lands" reading to be REPRODUCED on the settled revision before the fix is
// believed. `git status` showed `lib/tools.js` clean at HEAD (`c826f16`) when this lane started,
// so `git show HEAD:…/lib/tools.js` IS the pre-fix module. This driver materialises a scratch
// module tree (current `lib/` with ONLY that file replaced by its HEAD revision, `_deps/`
// symlinked), registers the REAL tool against a fixture team.json, sends the exact wave-1 payload
// (`acceptance_results`, snake_case) and prints: the call's return, the record's before/after
// sha256, and the stored content.
//
// Usage: bun evidence/agent-teams/unknown-args/<stamp>/driver.mjs
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "../../../../")
const STATE_DIR = join(".mpd", "team")
const TEAM_ID = "prefix-probe"
const CAPTAIN_ID = "session-captain-prefix"
const MEMBER_ID = "session-member-prefix"

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")

function fixture() {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t61-head-"))
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, TEAM_ID, "inbox"), { recursive: true })
    const now = Date.now()
    const record = {
        id: TEAM_ID,
        name: "pre-fix probe",
        captainSessionId: CAPTAIN_ID,
        createdAt: now,
        taskSeq: 1,
        phase: "running",
        members: [{ id: MEMBER_ID, name: "Architect", role: "worker", status: "idle", joinedAt: now }],
        tasks: [{
            id: "t1",
            subject: "hold the deliverable",
            status: "in_progress",
            assignee: "Architect",
            dependencies: [],
            attempt: 1,
            attemptId: "att-1",
            createdAt: now,
            updatedAt: now,
            kind: "implementation",
            objective: "carry the payload",
            inScope: ["evidence/**"],
            acceptance: ["nothing is dropped"],
            verify: ["bun test"],
            output: "PART 1/2",
        }],
    }
    const teamFile = join(stateRoot, TEAM_ID, "team.json")
    writeFileSync(teamFile, JSON.stringify(record, null, 2))
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
    const member = { id: MEMBER_ID, status: "busy", session: { header: { cwd: workspace } } }
    return { workspace, teamFile, captain, member }
}

const scratch = mkdtempSync(join(tmpdir(), "mpd-t61-head-mod-"))
const result = { driver: "unknown-args/pre-fix (HEAD tools.js)", headCommit: "", variants: [] }
try {
    result.headCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim()
    const headTools = execFileSync("git", ["show", "HEAD:packages/mpd-agent-teams-plugin/lib/tools.js"], { cwd: REPO, encoding: "utf8" })
    cpSync(join(REPO, "packages/mpd-agent-teams-plugin/lib"), join(scratch, "lib"), { recursive: true })
    symlinkSync(join(REPO, "packages/mpd-agent-teams-plugin/_deps"), join(scratch, "_deps"), "dir")
    writeFileSync(join(scratch, "lib", "tools.js"), headTools)
    result.headToolsSha256 = createHash("sha256").update(headTools).digest("hex")

    for (const variant of [
        { label: "HEAD (pre-fix)", toolsPath: join(scratch, "lib", "tools.js") },
        { label: "fixed tree", toolsPath: join(REPO, "packages/mpd-agent-teams-plugin/lib/tools.js") },
    ]) {
        const box = fixture()
        const mod = await import(pathToFileURL(variant.toolsPath).href)
        const tools = new Map()
        const ctx = {
            tools: { register: (definition) => { tools.set(definition.name, definition) } },
            agents: { get: () => undefined, list: () => [box.captain, box.member] },
            subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
            effect: () => () => undefined,
            on: () => () => undefined,
            logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
            get: () => undefined,
        }
        mod.registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
        const update = tools.get("agent_teams_update_task")
        const before = sha256(box.teamFile)
        let outcome
        try {
            const value = await update.execute(
                { task_id: "t1", status: "in_progress", attempt_id: "att-1", acceptance_results: [{ criterion: "x", status: "passed" }] },
                { agent: box.member },
            )
            outcome = { threw: false, returned: value }
        }
        catch (error) {
            outcome = { threw: true, message: String(error && error.message ? error.message : error) }
        }
        const after = JSON.parse(readFileSync(box.teamFile, "utf8"))
        const task = after.tasks[0]
        result.variants.push({
            label: variant.label,
            toolsPath: variant.toolsPath,
            outcome,
            recordSha256Before: before,
            recordSha256After: sha256(box.teamFile),
            recordByteIdentical: before === sha256(box.teamFile),
            storedAcceptanceResults: task.acceptanceResults ?? null,
            storedOutput: task.output,
            storedStatus: task.status,
        })
        rmSync(box.workspace, { recursive: true, force: true })
    }
}
finally {
    rmSync(scratch, { recursive: true, force: true })
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
