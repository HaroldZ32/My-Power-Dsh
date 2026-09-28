// t48 — P1d arms: the READ tool reports every same-identity/same-recipient match at ANY age, and the
// SEND gate refuses an unconfirmed repeat while NAMING the record. Each arm is runnable alone.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// The vendored `lib/*.js` modules this file drives are adopted upstream JavaScript: they ship no
// declaration file that describes the DELTA-PATCHED tree (the mpd deltas add exported functions and
// record fields the upstream `lib/types/*.d.ts` do not know about), and that tree is outside this
// lane's write scope. Each import below therefore carries `@ts-expect-error` with its reason, which
// is self-retiring: the day a declaration covers the module, the directive becomes a loud unused
// directive instead of a silent suppression. Every shape this file relies on is declared at its own
// use site.
// @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note above).
import { registerAgentTeamsTools } from "../lib/tools.js"
// @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note above).
import { readMailbox } from "../lib/state.js"

/** One tool definition as the registration double records it, with the schema surface the arms read. */
interface ToolDefinition {
    /** The tool's registered name, which is also the map key. */
    readonly name: string
    /** The compiled argument schema the escape-hatch assertions read. */
    readonly parameters: { readonly properties: Record<string, { readonly default?: unknown }> }
    /**
     * Run one call against the registry.
     *
     * @param args - the tool arguments the arm supplies.
     * @param exec - the execution context, carrying the captain the call runs as.
     * @returns the decoded tool result, whose fields are tool-specific.
     */
    execute(args: Record<string, unknown>, exec: { readonly agent: unknown }): Promise<ToolCallResult>
}

/** One match the read-only pre-send check reports for an identical, unread record. */
interface MailboxMatch {
    /** The matched record's id. */
    readonly id: string
    /** The matched record's send instant in epoch milliseconds. */
    readonly ts: number
    /** How long ago the record was sent, in milliseconds. */
    readonly age_ms: number
    /** How many sends the record now stands for. */
    readonly dup_count: number
    /** Whether the record is still inside the configured fold window. */
    readonly within_fold_window: boolean
}

/** The decoded result of one tool call: the fields are tool-specific, so each arm reads its own. */
interface ToolCallResult {
    /** The stored message's id, which a folded repeat must equal. */
    readonly message_id?: string
    /** The pre-send check's matches, one per same-identity record at any age. */
    readonly matches?: readonly MailboxMatch[]
    /** The dedup window the check applied, in milliseconds. */
    readonly window_ms?: number
    /** The instant the check ran, as an ISO-8601 UTC stamp. */
    readonly checked_at?: string
}

/** The captain double the tool calls are executed as. */
interface CaptainLike {
    /** The captain's session id, which keys the mailbox and the agent lookup. */
    readonly id: string
    /** The captain's lifecycle status. */
    readonly status: string
    /** The model route the vendored spawn path would read. */
    readonly options: { readonly provider: string; readonly model: string }
    /** The session header carrying the workspace the state root resolves from. */
    readonly session: { readonly header: { readonly cwd: string }; readonly requestHeader: () => undefined }
}

/** The team id the mailbox files are keyed by. */
const TEAM = "t48-gate"
/** The captain's session id, which the fixture writes into the team record. */
const CAPTAIN = "session-captain"
/** The member seat name the arms address their sends to. */
const MEMBER = "Architect"
/** The state directory name the fixture resolves under its temporary workspace. */
const STATE_DIR = join(".mpd", "team")

/** Write a one-captain team record and register the real tools against a double context. */
function fixture(): { stateRoot: string; captain: CaptainLike; tools: Map<string, ToolDefinition> } {
/** The temporary workspace this fixture's state root lives under. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t48-"))
/** The resolved team-state root the mailbox and the tools are keyed by. */
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, TEAM, "inbox"), { recursive: true })
    writeFileSync(join(stateRoot, TEAM, "team.json"), JSON.stringify({
        id: TEAM, name: "t48 gate probe", captainSessionId: CAPTAIN, createdAt: 1, taskSeq: 1, phase: "running",
        members: [{ id: "session-member", name: MEMBER, role: "engineer", status: "idle", joinedAt: 1 }], tasks: [],
    }, null, 2))
/** The captain double the tool calls are executed as. */
    const captain = { id: CAPTAIN, status: "idle", options: { provider: "p", model: "m" }, session: { header: { cwd: workspace }, requestHeader: () => undefined } }
/** The definitions the registration double captured, keyed by tool name. */
    const tools = new Map()
/** The context double the vendored registration path drives. */
    const ctx = {
        tools: { register: (definition: ToolDefinition) => tools.set(definition.name, definition) },
        agents: { get: (id: string) => (id === captain.id ? captain : undefined), list: () => [captain] },
        subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {}, getProvider: () => undefined, list: () => [] },
        effect: () => () => undefined, on: () => () => undefined,
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        get: () => undefined,
    }
    registerAgentTeamsTools(ctx, { stateDir: STATE_DIR, provider: "subagent-spawn" })
    return { stateRoot, captain, tools }
}

/** Resolve a call to its refusal message; an unrefused call yields undefined. */
const refusalOf = (promise: Promise<ToolCallResult>): Promise<string | undefined> => promise.then(() => undefined, (error) => String(error?.message ?? error))

test("P1d: an UNCHECKED identical send is REFUSED, and the refusal NAMES the record with its age", async () => {
/** The fixture's roots and its captured tool definitions. */
    const { stateRoot, captain, tools } = fixture()
/** The registered send tool; the fixture above registered it, so the lookup cannot miss. */
    const send = tools.get("agent_teams_send_message")!
/** The first, unchecked send of the payload. */
    const first = await send.execute({ to: MEMBER, content: "identical payload" }, { agent: captain })
    expect(first.message_id).toBeTypeOf("string")
/** The refusal the second, identical send earns. */
    const refusal = await refusalOf(send.execute({ to: MEMBER, content: "identical payload" }, { agent: captain }))
    expect(refusal).toMatch(/would repeat an existing message/)
    expect(refusal).toMatch(/age \d+ ms/)
    expect(refusal).toMatch(/dupCount 1/)
    expect(refusal).toMatch(/agent_teams_mailbox_check/)
    // nothing was written by the refusal
    expect((await readMailbox(stateRoot, TEAM, MEMBER)).length).toBe(1)
})

test("P1d: the READ tool reports the match at ANY age with id/ts/age/dupCount, the window and the moment", async () => {
/** The fixture's roots and its captured tool definitions. */
    const { stateRoot, captain, tools } = fixture()
/** The registered send tool; the fixture above registered it, so the lookup cannot miss. */
    const send = tools.get("agent_teams_send_message")!
/** The registered read-only pre-send check; registered by the fixture above. */
    const check = tools.get("agent_teams_mailbox_check")!
    await send.execute({ to: MEMBER, content: "an old payload" }, { agent: captain })
/** The check's report for a payload that was sent a moment earlier. */
    const report = await check.execute({ recipient: MEMBER, content: "an old payload" }, { agent: captain })
    expect(report.matches!.length).toBe(1)
/** The single match the report carries, read field by field below. */
    const [match] = report.matches!
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
/** The fixture's roots and its captured tool definitions. */
    const { stateRoot, captain, tools } = fixture()
/** The registered send tool; the fixture above registered it, so the lookup cannot miss. */
    const send = tools.get("agent_teams_send_message")!
/** The registered read-only pre-send check; registered by the fixture above. */
    const check = tools.get("agent_teams_mailbox_check")!
/** The first send, which the checked repeat must fold into. */
    const first = await send.execute({ to: MEMBER, content: "payload" }, { agent: captain })
    await check.execute({ recipient: MEMBER, content: "payload" }, { agent: captain })
/** The checked-and-confirmed repeat, which folds instead of being refused. */
    const folded = await send.execute({ to: MEMBER, content: "payload", confirm_duplicate: true }, { agent: captain })
    expect(folded.message_id).toBe(first.message_id)
/** The mailbox after the fold, where exactly one record remains. */
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
