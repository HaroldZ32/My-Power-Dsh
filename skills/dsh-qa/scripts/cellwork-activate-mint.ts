#!/usr/bin/env bun
// Case cellwork-activate-mint — release 0.18.2 defect ① (promoted from the exploratory
// `probe-d1-autoend-arm` under evidence/release/0.18.2/).
//
// WHAT IT PROVES. mpd-roles' `autoEndCleanTerminal` gate ends a clean-terminal board, and a cell's
// PLANNING board is exactly that between the split's acceptance and `cellwork_activate`. The measured
// field failure was:
//
//   cellwork_activate could not raise "Deep Worker": no team is staged in this session — call
//   agent_teams_create first
//
// because activation had no minting path. This case drives the REAL rows in-process:
//   * the REAL `mpd-team-core-plugin` registers the five team tools and publishes `mpdTeams` /
//     `mpdTeamActions`; its approval writes a REAL record under `<ws>/.mpd/team/teams/`;
//   * the REAL `mpd-cellwork-plugin` registers `/cellwork` and the flow tools;
//   * the planning team is created, approved and then ENDED through the REAL
//     `agent_teams_control {action:"end"}` verb — the same call the auto-end gate makes;
//   * `cellwork_activate` must MINT a second team through `agent_teams_plan {action:"create"}` +
//     one member + `approve`, land the split on it, and persist BOTH ids (`teamId` = execution board,
//     `planningTeamId` = the ended staging board).
//
// The NEGATIVE CONTROL runs the same flow with a LIVE planning board: it must be addressed IN PLACE
// (no second team record, no `create` call), so the arm cannot pass by minting unconditionally.
//
// BOUND: no `dsh` binary and no model are used. This is an in-process run over the bundle's own source
// with the harness seams stubbed (executor spawn/send, verify plane, roster/config services); the team
// records, the plan store, the cell state and the journal are the REAL files those rows write.
//
// PREREQ: absent-runtime packages/mpd-cellwork-plugin/src/activate.ts "this lane is in-process over the bundle's own source (no dsh spawn)"
//
// Usage:
//   bun skills/dsh-qa/scripts/cellwork-activate-mint.ts --self-test
//   bun skills/dsh-qa/scripts/cellwork-activate-mint.ts [--out <dir>]
// Evidence -> evidence/dsh-qa/cellwork-activate-mint/<timestamp>/{result.json,output.log}
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { exitOnRefusal, refuseOverwrite, writeImmutable } from "./lib/immutable-output.ts"
import { apply as applyTeamCore } from "../../../packages/mpd-team-core-plugin/src/index.ts"
import { apply as applyCellwork } from "../../../packages/mpd-cellwork-plugin/src/index.ts"
import { readTeam } from "../../../packages/mpd-team-core-plugin/src/team-store.ts"
import { readActiveCell, statePath, type CellState } from "../../../packages/mpd-cellwork-plugin/src/state.ts"

/** The lane slug: the case name and the evidence directory name. */
const SLUG = "cellwork-activate-mint"
/** The captain's session id: the approving session every team call is authorized as. */
const CAPTAIN = "session-captain-mint"
/** One complete requirements document, all six sections filled. */
const COMPLETE_REQUIREMENTS = [
  "# Requirements",
  "## Goal",
  "Ship a widget.",
  "## Non-goals",
  "No mobile app.",
  "## Users / consumers",
  "The CLI user.",
  "## Constraints",
  "No new dependencies.",
  "## Acceptance criteria",
  "The widget renders and its test passes.",
  "## Open questions",
  "None.",
].join("\n")

/** One fake live agent: the session id the team tools read, and its workspace header. */
interface FakeAgent {
  /** The agent id; the session readers fall back to it. */
  id: string
  /** The session the workspace root resolves from. */
  session: { id: string; header: { cwd: string } }
  /** The turn seam the `/cellwork` command's `invocation.submit` binds to (a no-op here). */
  followup?: (message: unknown) => void
}

/** One captured tool definition. */
interface CapturedTool {
  /** The registered name. */
  name: string
  /** The runner, called with `{ name, agent }` as its exec. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** One captured command definition. */
interface CapturedCommand {
  /** The registered name, without a slash. */
  name: string
  /** The handler the adapter wrapped. */
  handler: (invocation: unknown) => { kind: "error" | "success"; text: string }
}

/** The fake composition one arm drives. */
interface Harness {
  /** The temp workspace every root resolves to. */
  workspace: string
  /** The captain's handle. */
  captain: FakeAgent
  /** Every captured tool definition, by name. */
  tools: Map<string, CapturedTool>
  /** Every captured command definition, by name. */
  commands: Map<string, CapturedCommand>
  /** Drive one registered tool by name as a given agent. */
  call: (name: string, args: Record<string, unknown>, agent?: unknown) => Promise<Record<string, unknown>>
  /** The answers `executor.send` recorded (dispatch evidence, not asserted here). */
  sends: Array<{ handle: string; text: string }>
  /** How many `agent_teams_plan {action:"create"}` calls the composition has answered. */
  creates: () => number
  /** Restore the process env and remove the sandbox. */
  dispose: () => void
}

/** One arm's verdict, printed and written to evidence. */
interface Arm {
  /** The frozen assertion id. */
  id: string
  /** What the arm asserts, in one line. */
  claim: string
  /** Whether every assertion held. */
  ok: boolean
  /** The observed facts, quoted into the evidence. */
  observed: string
}

/**
 * The roster the fake `mpdRoles` service serves, with distinguishable persona texts.
 *
 * The names are the production roster labels the split's `ownerRole` values use.
 */
const ROSTER = [
  { name: "Planner", persona: "PLANNER PERSONA" },
  { name: "Lead", persona: "LEAD PERSONA" },
  { name: "Senior Engineer", persona: "SENIOR ENGINEER PERSONA" },
  { name: "Reviewer", persona: "REVIEWER PERSONA" },
  { name: "Deep Worker", persona: "DEEP WORKER PERSONA" },
]

/** The roles the fake route service has a usable `agentRoutes` entry for. */
const ROUTED = ["Planner", "Lead", "Senior Engineer", "Reviewer", "Deep Worker"]

/**
 * The two code tasks and their reviews, exactly the split the QA arm activates.
 *
 * @returns the four task submissions.
 */
function splitTasks(): Array<Record<string, unknown>> {
  return [
    { key: "auth-core", subject: "Implement the auth core", description: "Add the token store.", kind: "work", ownerRole: "Senior Engineer", writeScopes: ["src/auth/"], blockedBy: [], inputs: [], verify: true },
    { key: "auth-review", subject: "Review the auth core", description: "Blind review.", kind: "review", ownerRole: "Reviewer", writeScopes: [], blockedBy: ["auth-core"], inputs: [], verify: false },
    { key: "cli-core", subject: "Implement the CLI", description: "Add the command.", kind: "work", ownerRole: "Deep Worker", writeScopes: ["src/cli/"], blockedBy: [], inputs: [], verify: false },
    { key: "cli-review", subject: "Review the CLI", description: "Blind review.", kind: "review", ownerRole: "Reviewer", writeScopes: [], blockedBy: ["cli-core"], inputs: [], verify: false },
  ]
}

/**
 * Build the fake composition: the REAL team-core and cellwork rows applied against stub harness seams.
 *
 * @param workspace - the sandbox workspace every call is scoped to.
 * @returns the harness an arm drives.
 */
function makeHarness(workspace: string): Harness {
  /** Every captured tool definition, by name. */
  const tools = new Map<string, CapturedTool>()
  /** Every captured command definition, by name. */
  const commands = new Map<string, CapturedCommand>()
  /** Every message the fake executor "delivered". */
  const sends: Array<{ handle: string; text: string }> = []
  /** How many plan `create` calls the registry has answered. */
  let creates = 0
  /** The services the fake context answers; `provide` adds the rows' OWN services here. */
  const services: Record<string, unknown> = {}
  /** The captain's handle. */
  const captain: FakeAgent = { id: CAPTAIN, session: { id: CAPTAIN, header: { cwd: workspace } }, followup: (): void => {} }
  /** The tool registry double the adapter binds to. */
  const toolsService = {
    /**
     * Capture one tool definition.
     * @param definition - the definition.
     * @returns the disposer.
     */
    register(definition: CapturedTool): () => void { tools.set(definition.name, definition); return (): void => {} },
    /**
     * Resolve one captured definition by name, which is what `hasTool` probes.
     * @param name - the tool name.
     * @returns the definition, or undefined.
     */
    get(name: string): CapturedTool | undefined { return tools.get(name) },
    /**
     * Install one guard predicate (every arm here tests the flow, not the guard).
     * @returns the disposer.
     */
    guard(): () => void { return (): void => {} },
    /**
     * Execute one code-defined tool in-process.
     * @param input - the call the adapter forwards.
     * @returns the raw result the adapter projects.
     */
    async execute(input: { name: string; arguments?: Record<string, unknown>; agent?: unknown }): Promise<unknown> {
      // THE REGISTRY ANSWERS IN THE HARNESS TOOL-RESULT SHAPE (`{isError, value}`), which is what the
      // adapter's `projectToolResult` projects; a bare payload would read as `value: undefined`.
      /** Thrown refusals are converted to the same result shape the harness uses. */
      const settle = async (work: Promise<unknown>): Promise<{ isError: boolean; value?: unknown; error?: string }> => {
        try {
          return { isError: false, value: await work }
        } catch (error) {
          return { isError: true, error: error instanceof Error ? error.message : String(error) }
        }
      }
      if (input.name === "agent_teams_plan" && String(input.arguments?.action ?? "") === "create") creates += 1
      // THE REAL TEAM TOOLS ANSWER FIRST: cellwork's activation calls them through `dsh.executeTool`.
      const team = tools.get(input.name)
      if (team !== undefined) return await settle(team.execute(input.arguments ?? {}, { agent: input.agent, name: input.name }))
      // THE VERIFY PLANE IS THE ONE STUB: this case's subject is the TEAM mint, not loop arming.
      if (input.name === "mpd_verify_open") {
        /** The loop id the stub mints. */
        const loopId = "loop-mint-" + String(Math.random().toString(36).slice(2, 8))
        return { isError: false, value: { loopId, writer: { kind: "delegate" }, verifier: { id: "unbound" }, scope: input.arguments?.scope, expiresAt: "later" } }
      }
      return { isError: false, value: {} }
    },
  }
  /** The services the fake context answers BEFORE the rows publish their own. */
  Object.assign(services, {
    tools: toolsService,
    commands: {
      /**
       * Capture one command definition.
       * @param definition - the definition.
       * @returns the disposer.
       */
      register(definition: CapturedCommand): () => void { commands.set(definition.name, definition); return (): void => {} },
    },
    agents: { list: (): FakeAgent[] => [captain] },
    mpdRoles: {
      list: (): Array<{ name: string; persona: string }> => ROSTER.map((entry) => ({ ...entry })),
      get: (key: string): { name: string; persona: string } | null => ROSTER.find((entry) => entry.name.toLowerCase() === key.toLowerCase()) ?? null,
    },
    mpdConfig: {
      get: (key: string): unknown => key === "cellwork.planning.analysts" ? 0 : undefined,
      agentRouteResolutionOf: (role: string): unknown => ROUTED.includes(role)
        ? { ok: true, route: { provider: "deepseek-official", model: "deepseek-flash" } }
        : { ok: false, reason: "unconfigured", missing: ["agentRoutes." + role + ".provider"] },
    },
    llm: {
      listProviders: (): Array<{ id: string; name: string }> => [{ id: "deepseek-official", name: "DeepSeek" }],
      listModels: (): Array<{ id: string; name: string }> => [{ id: "deepseek-flash", name: "Flash" }],
      resolveModelInfo: (): unknown => ({ context: { contextWindow: 1000000 }, defaultMaxTokens: 8192 }),
    },
    subagents: {
      providers: (): string[] => ["spawn"],
      /**
       * Raise either the one-shot consult or a durable team member.
       * @param spec - the activation spec the adapter built.
       * @returns the child handle the adapter records as the member's `executorRef`.
       */
      async startActivation(spec: Record<string, unknown>): Promise<unknown> {
        /** The member name the team spawn's label encodes (`<name> · <teamId>`). */
        const name = String(spec.label ?? "").split(" · ")[0]
        return { childId: "handle-" + name, result: Promise.resolve({ output: "", structured: undefined, stopReason: null }), dispose: async (): Promise<void> => {} }
      },
      /**
       * Deliver one message to a member handle.
       * @param _caller - the authorizing agent.
       * @param handle - the member handle.
       * @param blocks - the message content.
       */
      async sendMessage(_caller: unknown, handle: string, blocks: unknown): Promise<void> {
        /** The text the adapter forwarded. */
        const text = Array.isArray(blocks) ? blocks.map((block) => typeof block === "object" && block !== null && typeof (block as { text?: unknown }).text === "string" ? String((block as { text: string }).text) : "").join("") : String(blocks ?? "")
        sends.push({ handle, text })
      },
    },
  })
  /** The minimal cordis context both rows read: two harness seams, the services, and `provide`. */
  const ctx = {
    tools: toolsService,
    /**
     * Run one cleanup callback at registration time, as a real `ctx.effect` does.
     * @param fn - the callback.
     */
    effect(fn: () => unknown): void { fn() },
    /**
     * Resolve one service; an unknown name is an absent service.
     * @param id - the service id.
     * @returns the service, or undefined.
     */
    get(id: string): unknown { return services[id] },
    /**
     * Publish a service to later rows (team-core's `mpdTeams` / `mpdTeamActions`).
     * @param id - the service id.
     * @param value - the service value.
     */
    provide(id: string, value: unknown): void { services[id] = value },
    /** Subscribe to a host event; nothing emits in this lane. */
    on(): void {},
    /** Declare an injected dependency; the rows are applied in order here. */
    inject(): void {},
  }
  // THE WORKSPACE ROOT IS PINNED for the whole arm: `apply` and the log sink resolve it before any
  // tool exec carries a header cwd, and the arm must never write the repository's own `.mpd/`.
  const previousRoot = process.env.DSH_WORKSPACE_ROOT
  process.env.DSH_WORKSPACE_ROOT = workspace
  applyTeamCore(ctx as never)
  applyCellwork(ctx as never, {})
  return {
    workspace,
    captain,
    tools,
    commands,
    sends,
    creates: (): number => creates,
    call: async (name: string, args: Record<string, unknown>, agent: unknown = captain): Promise<Record<string, unknown>> => {
      /** The registered tool, or a thrown error naming what WAS registered. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error("no tool " + JSON.stringify(name) + " was registered")
      return await tool.execute(args, { name, agent }) as Record<string, unknown>
    },
    dispose: (): void => {
      if (previousRoot === undefined) delete process.env.DSH_WORKSPACE_ROOT
      else process.env.DSH_WORKSPACE_ROOT = previousRoot
      rmSync(workspace, { recursive: true, force: true })
    },
  }
}

/**
 * Create a fresh sandbox workspace.
 *
 * @returns the absolute temp directory.
 */
function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "mpd-cellwork-mint-"))
}

/**
 * Read one cell's state file as it stands on disk.
 *
 * @param workspace - the workspace root.
 * @param cellId - the cell id.
 * @returns the parsed record.
 */
function stateOf(workspace: string, cellId: string): CellState {
  return JSON.parse(readFileSync(statePath(workspace, cellId), "utf8")) as CellState
}

/**
 * Read one member's executor handle from the REAL team record.
 *
 * @param workspace - the workspace root.
 * @param teamId - the team the member belongs to.
 * @param name - the member name.
 * @returns the recorded handle.
 */
function handleOf(workspace: string, teamId: string, name: string): string {
  /** The member row the record keeps. */
  const member = readTeam(workspace, teamId)?.members.find((candidate) => candidate.name === name)
  if (member?.executorRef === undefined) throw new Error("the record kept no handle for " + JSON.stringify(name))
  return member.executorRef
}

/**
 * The team records a workspace holds, by id.
 *
 * @param workspace - the workspace root.
 * @returns the team ids in file order.
 */
function teamIds(workspace: string): string[] {
  try {
    return readdirSync(join(workspace, ".mpd", "team", "teams")).filter((entry) => entry.endsWith(".json")).map((entry) => entry.slice(0, -5))
  } catch {
    return []
  }
}

/**
 * Drive one cell from `/cellwork` through an accepted split, staging the REAL planning team.
 *
 * @param h - the harness.
 * @returns the cell id and the approved planning team id.
 */
async function stageCell(h: Harness): Promise<{ cellId: string; planningTeamId: string }> {
  /** The `/cellwork` command. */
  const command = h.commands.get("cellwork")
  if (command === undefined) throw new Error("the /cellwork command was not registered")
  /** The command's own answer (the directive is submitted to a no-op turn seam). */
  const started = command.handler({ rawInput: "ship the minted widget", agent: h.captain })
  if (started.kind !== "success") throw new Error("the /cellwork command refused: " + started.text)
  /** The cell the command wrote. */
  const active = readActiveCell(h.workspace)
  if (!active.ok || active.cell === null) throw new Error("no active cell after /cellwork")
  /** The cell id. */
  const cellId = active.cell.state.cellId
  // `cellwork_start` STAGES the planning team through the REAL plan tool (create + members + tasks +
  // approve); the approval writes the real record this arm later ends.
  const began = await h.call("cellwork_start", {})
  if (began.ok !== true) throw new Error("cellwork_start refused: " + String(began.error))
  /** The planning team the start recorded. */
  const planningTeamId = String(stateOf(h.workspace, cellId).teamId ?? "")
  if (planningTeamId === "") throw new Error("cellwork_start recorded no planning team")
  // The planner and splitter sessions are the handles the REAL approval minted (our stub executor).
  const finalized = await h.call("cellwork_requirements", { action: "finalize", content: COMPLETE_REQUIREMENTS }, { id: handleOf(h.workspace, planningTeamId, "cell-planner"), session: { id: handleOf(h.workspace, planningTeamId, "cell-planner"), header: { cwd: h.workspace } } })
  if (finalized.ok !== true) throw new Error("cellwork_requirements refused: " + String(finalized.error))
  /** The splitter's live handle. */
  const splitter = { id: handleOf(h.workspace, planningTeamId, "cell-splitter"), session: { id: handleOf(h.workspace, planningTeamId, "cell-splitter"), header: { cwd: h.workspace } } }
  /** The splitter's submission: the accepted verdict activation later materialises. */
  const submitted = await h.call("cellwork_split", { action: "submit", tasks: splitTasks() }, splitter)
  if (submitted.ok !== true || submitted.accepted !== true) throw new Error("cellwork_split refused: " + String(submitted.error ?? submitted.findings ?? "not accepted"))
  return { cellId, planningTeamId }
}

/**
 * The POSITIVE arm: the planning team is ended through the REAL terminal verb, then activation mints.
 *
 * @returns the arm's verdict.
 */
async function mintArm(): Promise<Arm> {
  /** The sandbox this arm owns. */
  const workspace = sandbox()
  /** The harness, disposed in the `finally`. */
  const h = makeHarness(workspace)
  try {
    /** The staged cell. */
    const { cellId, planningTeamId } = await stageCell(h)
    // THE AUTO-END, through the REAL verb the mpd-roles gate calls: the planning board is clean-terminal
    // after the split is accepted, and `agent_teams_control end` stamps `endedAt` on its record.
    const ended = await h.call("agent_teams_control", { action: "end", team_id: planningTeamId, reason: "board clean-terminal — auto-ended by re-team gate" })
    if (ended.ok === false) return { id: "mint", claim: "an ended planning board is replaced by a minted execution board", ok: false, observed: "agent_teams_control end refused: " + String(ended.error) }
    /** The ended record as it stands before activation. */
    const dead = readTeam(workspace, planningTeamId)
    // THE SUBJECT: activation must MINT, not answer "no team is staged in this session".
    const activated = await h.call("cellwork_activate", {})
    /** The cell record after activation. */
    const after = stateOf(workspace, cellId)
    /** Every team record after the pass. */
    const ids = teamIds(workspace)
    /** The minted record, when a second team exists. */
    const mintedId = ids.find((id) => id !== planningTeamId) ?? ""
    /** The minted record. */
    const minted = mintedId === "" ? undefined : readTeam(workspace, mintedId)
    /** The ended record after the pass (it must be untouched). */
    const stillDead = readTeam(workspace, planningTeamId)
    /** The activation journal row. */
    const journal = readFileSync(join(workspace, ".mpd", "cellwork", cellId, "journal.jsonl"), "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>).find((row) => row.event === "activate")
    /** Whether every assertion held. */
    const ok = activated.ok === true
      && dead?.endedAt !== undefined
      && mintedId !== ""
      && minted?.phase !== "ended"
      && (minted?.tasks.length ?? 0) === 4
      && after.teamId === mintedId
      && after.planningTeamId === planningTeamId
      && after.phase === "executing"
      && after.activatedRevision === 1
      && Object.keys(after.activatedTasks).length === 4
      && stillDead?.endedAt === dead?.endedAt
      && journal?.mintedTeamId === mintedId
      && journal?.planningTeamId === planningTeamId
    return {
      id: "mint",
      claim: "after the clean-terminal auto-end, cellwork_activate mints a FRESH execution team and succeeds",
      ok,
      observed: "activate.ok=" + String(activated.ok) + (activated.ok === true ? "" : " error=" + String(activated.error))
        + " dead=" + String(planningTeamId) + "(endedAt=" + String(dead?.endedAt ?? "(none)") + ")"
        + " minted=" + (mintedId === "" ? "(none)" : mintedId) + "(phase=" + String(minted?.phase ?? "(none)") + ", tasks=" + String(minted?.tasks.length ?? 0) + ")"
        + " cell.teamId=" + String(after.teamId) + " cell.planningTeamId=" + String(after.planningTeamId)
        + " phase=" + String(after.phase) + " revision=" + String(after.activatedRevision)
        + " deadRecordUntouched=" + String(stillDead?.endedAt === dead?.endedAt)
        + " journal.mintedTeamId=" + String(journal?.mintedTeamId ?? "(none)"),
    }
  } finally {
    h.dispose()
  }
}

/**
 * The NEGATIVE CONTROL: a LIVE planning board is addressed in place and no second team is minted.
 *
 * @returns the arm's verdict.
 */
async function liveArm(): Promise<Arm> {
  /** The sandbox this arm owns. */
  const workspace = sandbox()
  /** The harness, disposed in the `finally`. */
  const h = makeHarness(workspace)
  try {
    /** The staged cell, whose planning team is still LIVE. */
    const { cellId, planningTeamId } = await stageCell(h)
    /** The `create` calls staging already made, so the delta measures activation alone. */
    const createsBefore = h.creates()
    /** The activation that must mint. */
    const activated = await h.call("cellwork_activate", {})
    /** The cell record after the pass. */
    const after = stateOf(workspace, cellId)
    /** Every team record after the pass. */
    const ids = teamIds(workspace)
    /** Whether every assertion held. */
    const ok = activated.ok === true
      && ids.length === 1
      && ids[0] === planningTeamId
      && after.teamId === planningTeamId
      && after.planningTeamId === ""
      && after.phase === "executing"
      // The live board carries the planning rows AND the four activation rows.
      && (readTeam(workspace, planningTeamId)?.tasks.length ?? 0) >= 4
      // NO MINT VERB WAS SPENT: the normal path never calls `agent_teams_plan {action:"create"}`.
      && h.creates() - createsBefore === 0
    return {
      id: "live",
      claim: "NEGATIVE CONTROL: a live planning board is addressed in place (no second team, no mint)",
      ok,
      observed: "activate.ok=" + String(activated.ok) + (activated.ok === true ? "" : " error=" + String(activated.error))
        + " teams=" + String(ids.length) + "[" + ids.join(",") + "]"
        + " cell.teamId=" + String(after.teamId) + " cell.planningTeamId=" + String(after.planningTeamId)
        + " phase=" + String(after.phase) + " boardTasks=" + String(readTeam(workspace, planningTeamId)?.tasks.length ?? 0)
        + " createsDuringActivation=" + String(h.creates() - createsBefore),
    }
  } finally {
    h.dispose()
  }
}

/**
 * Run both arms in fresh sandboxes.
 *
 * @returns the arms, positive first.
 */
async function arms(): Promise<Arm[]> {
  return [await mintArm(), await liveArm()]
}

/**
 * The offline self-test: both arms, no evidence directory, exit 0 only when both hold.
 *
 * @returns the exit code.
 */
async function selfTest(): Promise<number> {
  /** The arms' verdicts. */
  const all = await arms()
  for (const arm of all) console.log((arm.ok ? "ok  " : "FAIL") + " (" + arm.id + ") " + arm.claim + " — " + arm.observed)
  /** Whether both arms held. */
  const ok = all.every((arm) => arm.ok)
  console.log("[" + SLUG + "] " + (ok ? "SELF-TEST PASS" : "SELF-TEST FAIL") + " (" + String(all.filter((arm) => arm.ok).length) + "/" + String(all.length) + " arms)")
  return ok ? 0 : 1
}

/**
 * The lane entry point: `--self-test`, else the real lane with evidence.
 *
 * @param argv - the process arguments after the script name.
 * @returns the exit code.
 */
async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes("--self-test")) return await selfTest()
  /** The `--out` position, when the caller pinned one. */
  const outIndex = argv.indexOf("--out")
  /** The requested evidence directory, or undefined to derive one. */
  const requested = outIndex >= 0 ? argv[outIndex + 1] : undefined
  if (requested !== undefined) refuseOverwrite(requested, { label: "evidence dir", remedy: "pass a fresh --out directory" })
  /** The arms' verdicts. */
  const all = await arms()
  /** The printed lines, also written to `output.log`. */
  const lines = all.map((arm) => (arm.ok ? "ok  " : "FAIL") + " (" + arm.id + ") " + arm.claim + " — " + arm.observed)
  for (const line of lines) console.log(line)
  /** Whether both arms held. */
  const ok = all.every((arm) => arm.ok)
  /** The derived evidence directory. */
  const dir = requested ?? join(process.cwd(), "evidence", "dsh-qa", SLUG, new Date().toISOString().replace(/[:.]/g, "-"))
  mkdirSync(dir, { recursive: true })
  writeImmutable(join(dir, "result.json"), JSON.stringify({ case: SLUG, ok, arms: all }, null, 2) + "\n")
  writeImmutable(join(dir, "output.log"), lines.join("\n") + "\n")
  console.log("[" + SLUG + "] " + (ok ? "PASS" : "FAIL") + " — evidence -> " + dir)
  return ok ? 0 : 1
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => exitOnRefusal(error, SLUG),
)
