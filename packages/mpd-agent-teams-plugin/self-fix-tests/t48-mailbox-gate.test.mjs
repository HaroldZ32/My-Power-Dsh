// t48 — P1d arms: the READ tool reports every same-identity/same-recipient match at ANY age, and the
// SEND gate refuses an unconfirmed repeat while NAMING the record. Each arm is runnable alone.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerAgentTeamsTools } from "../lib/tools.js"
import { readMailbox } from "../lib/state.js"

const TEAM = "t48-gate"
const CAPTAIN = "session-captain"
const MEMBER = "Architect"
const STATE_DIR = join(".mpd", "team")

function fixture() {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t48-"))
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, TEAM, "inbox"), { recursive: true })
    writeFileSync(join(stateRoot, TEAM, "team.json"), JSON.stringify({
        id: TEAM, name: "t48 gate probe", captainSessionId: CAPTAIN, createdAt: 1, taskSeq: 1, phase: "running",
        members: [{ id: "session-member", name: MEMBER, role: "engineer", status: "idle", joinedAt: 1 }], tasks: [],
    }, null, 2))
    const captain = { id: CAPTAIN, status: "idle", options: { provider: "p", model: "m" }, session: { header: { cwd: workspace }, requestHeader: () => undefined } }
    const tools = new Map()
    const ctx = {
        tools: { register: (definition) => tools.set(definition.name, definition) },
        agents: { get: (id) => (id === captain.id ? captain : undefined), list: () => [captain] },
        subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {}, getProvider: () => undefined, list: () => [] },
        effect: () => () => undefined, on: () => () => undefined,
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        get: () => undefined,
    }
    registerAgentTeamsTools(ctx, { stateDir: STATE_DIR, provider: "subagent-spawn" })
    return { stateRoot, captain, tools }
}

const refusalOf = (promise) => promise.then(() => undefined, (error) => String(error?.message ?? error))

test("P1d: an UNCHECKED identical send is REFUSED, and the refusal NAMES the record with its age", async () => {
    const { stateRoot, captain, tools } = fixture()
    const send = tools.get("agent_teams_send_message")
    const first = await send.execute({ to: MEMBER, content: "identical payload" }, { agent: captain })
    expect(first.message_id).toBeTypeOf("string")
    const refusal = await refusalOf(send.execute({ to: MEMBER, content: "identical payload" }, { agent: captain }))
    expect(refusal).toMatch(/would repeat an existing message/)
    expect(refusal).toMatch(/age \d+ ms/)
    expect(refusal).toMatch(/dupCount 1/)
    expect(refusal).toMatch(/agent_teams_mailbox_check/)
    // nothing was written by the refusal
    expect((await readMailbox(stateRoot, TEAM, MEMBER)).length).toBe(1)
})

test("P1d: the READ tool reports the match at ANY age with id/ts/age/dupCount, the window and the moment", async () => {
    const { stateRoot, captain, tools } = fixture()
    const send = tools.get("agent_teams_send_message")
    const check = tools.get("agent_teams_mailbox_check")
    await send.execute({ to: MEMBER, content: "an old payload" }, { agent: captain })
    const report = await check.execute({ recipient: MEMBER, content: "an old payload" }, { agent: captain })
    expect(report.matches.length).toBe(1)
    const [match] = report.matches
    expect(match.id).toBeTypeOf("string")
    expect(typeof match.ts).toBe("number")
    expect(typeof match.age_ms).toBe("number")
    expect(match.dup_count).toBe(1)
    expect(match.within_fold_window).toBe(true)
    expect(report.window_ms).toBe(30 * 60 * 1000)
    expect(report.checked_at).toMatch(/T.*Z$/)
    // a check that finds NOTHING is also a check: it must not write anything
    const none = await check.execute({ recipient: MEMBER, content: "never sent" }, { agent: captain })
    expect(none.matches).toEqual([])
    expect((await readMailbox(stateRoot, TEAM, MEMBER)).length).toBe(1)
})

test("P1d: checked-and-confirmed is ALLOWED and FOLDS; different content is NEVER blocked; the escape is explicit only", async () => {
    const { stateRoot, captain, tools } = fixture()
    const send = tools.get("agent_teams_send_message")
    const check = tools.get("agent_teams_mailbox_check")
    const first = await send.execute({ to: MEMBER, content: "payload" }, { agent: captain })
    await check.execute({ recipient: MEMBER, content: "payload" }, { agent: captain })
    const folded = await send.execute({ to: MEMBER, content: "payload", confirm_duplicate: true }, { agent: captain })
    expect(folded.message_id).toBe(first.message_id)
    const records = await readMailbox(stateRoot, TEAM, MEMBER)
    expect(records.length).toBe(1)
    expect(records[0].dupCount).toBe(2)
    // different content needs no check and no flag
    const other = await send.execute({ to: MEMBER, content: "genuinely different" }, { agent: captain })
    expect(other.message_id).not.toBe(first.message_id)
    // the escape cannot be set implicitly: it is declared with no default and only an explicit true opens it
    expect(Object.keys(send.parameters.properties)).toContain("confirm_duplicate")
    expect(send.parameters.properties.confirm_duplicate.default).toBeUndefined()
})
