// mpd-project-init unit tests: the write-once scaffold, every silent skip, the top-level
// classification and the pre-step wiring. Fixtures are temp directories; no real HOME and
// no real workspace is ever touched.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, parse } from "node:path"

import type { DshAgentPreStep, DshLiveAgent, DshPreStepDecision } from "../../mpd-dsh-adapter-plugin/src/index"
import {
  AGENT_FILE,
  LOG_FILE,
  MARKER_FILE,
  agentScaffold,
  apply,
  initializeProject,
  installProjectInit,
  isTopLevelSession,
} from "../src/index"

/** Every temp directory this file created, drained in `afterEach` so no fixture leaks. */
const sandboxes: string[] = []

afterEach(() => {
  for (const root of sandboxes.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Materialize one temp workspace: `files` maps a relative path to its body.
 * @param files the fixture files to create, parents included.
 * @returns the absolute temp root.
 */
function tempRoot(files: Record<string, string> = {}): string {
  /** A fresh temp root per case, so no fixture can see another case's files. */
  const root = mkdtempSync(join(tmpdir(), "mpd-project-init-"))
  sandboxes.push(root)
  for (const [relative, body] of Object.entries(files)) {
    /** The absolute path of one fixture file to create. */
    const target = join(root, relative)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, body)
  }
  return root
}

/** One listener a fake adapter recorded, with the agent handle it was scoped to. */
interface RegisteredListener {
  /** The agent handle the row registered against. */
  agent: unknown
  /** The `agent/pre-step` listener the row installed. */
  listener: (payload: DshAgentPreStep, decision: DshPreStepDecision) => undefined
}

/** The adapter slice the row uses, plus the calls it made, for the wiring cases. */
interface FakeAdapter {
  /** The fake adapter object handed to the row, shaped like the `Pick<DshAdapter, …>` slice. */
  dsh: {
    registerAgentPreStep: (agent: unknown, listener: RegisteredListener["listener"]) => () => void
    liveAgents: () => DshLiveAgent[]
    onEvent: (event: string, handler: (payload: unknown) => void) => () => void
    workspaceRoot: (exec?: { agent?: unknown }) => string
    rowLog: (name: string, line: string) => void
  }
  /** Every listener the row registered. */
  registered: RegisteredListener[]
  /** Every `agent/*` event the row subscribed to. */
  events: string[]
  /** The handler the row installed for each event, so a case can dispatch the lifecycle event itself. */
  handlers: Map<string, (payload: unknown) => void>
  /** Agent handles whose scope DISPOSER the row actually invoked — one entry per call. */
  disposedAgents: unknown[]
  /** Every line the row sent to its file log. */
  logged: string[]
}

/**
 * Build a fake adapter over a fixed agent list.
 * @param agents the live agents the row should discover.
 * @param rootOf the workspace a given agent resolves to.
 * @param explode when true, `workspaceRoot` throws (the contained-failure case).
 * @returns the fake adapter and its recorded calls.
 */
function fakeAdapter(agents: DshLiveAgent[], rootOf: (agent: unknown) => string, explode: boolean = false): FakeAdapter {
  /** The calls the row made, captured by the closures below. */
  const state: FakeAdapter = { dsh: undefined as unknown as FakeAdapter["dsh"], registered: [], events: [], handlers: new Map(), disposedAgents: [], logged: [] }
  state.dsh = {
    registerAgentPreStep: (agent: unknown, listener: RegisteredListener["listener"]): (() => void) => {
      state.registered.push({ agent, listener })
      // Record the teardown itself: a test must be able to prove the disposer RAN, not merely that
      // the disposer map entry disappeared (CodeRabbit round 2).
      return (): void => {
        state.disposedAgents.push(agent)
      }
    },
    liveAgents: (): DshLiveAgent[] => agents,
    onEvent: (event: string, handler: (payload: unknown) => void): (() => void) => {
      state.events.push(event)
      state.handlers.set(event, handler)
      return (): void => {
        // A no-op subscription: the row only needs it to exist.
      }
    },
    workspaceRoot: (exec?: { agent?: unknown }): string => {
      if (explode) throw new Error("workspace resolver unavailable")
      return rootOf(exec?.agent)
    },
    rowLog: (_name: string, line: string): void => {
      state.logged.push(line)
    },
  }
  return state
}

describe("initializeProject", () => {
  test("an empty directory gets AGENT.md, the marker and ONE log line", () => {
    /** The fresh workspace this case inspects. */
    const root = tempRoot()
    /** The branch the function reports. */
    const result = initializeProject(root)
    expect(result.status).toBe("created")
    expect(result.reason).toBe("created")
    expect(result.file).toBe(join(root, AGENT_FILE))
    expect(readFileSync(join(root, AGENT_FILE), "utf8")).toContain("mpd-project-init")
    /** The provenance marker the next run reads. */
    const marker = JSON.parse(readFileSync(join(root, MARKER_FILE), "utf8"))
    expect(marker.plugin).toBe("mpd-project-init")
    expect(marker.file).toBe(AGENT_FILE)
    expect(typeof marker.createdAt).toBe("string")
    /** The one diagnostic line, under the workspace's own log directory. */
    const log = readFileSync(join(root, LOG_FILE), "utf8").trim().split("\n")
    expect(log.length).toBe(1)
    expect(log[0]).toContain("created " + AGENT_FILE)
  })

  test("a dotfiles-only directory (a fresh `git init`) counts as a project", () => {
    /** A fresh repository: nothing but a `.git` directory. */
    const root = tempRoot({ ".git/config": "[core]\n" })
    expect(initializeProject(root).status).toBe("created")
  })

  test("a manifest-only directory counts as a project", () => {
    /** Visible content plus a manifest, no `.git`. */
    const root = tempRoot({ "package.json": "{}\n" })
    expect(initializeProject(root).status).toBe("created")
  })

  test("an existing AGENTS.md skips and writes nothing", () => {
    /** The workspace already carrying project instructions. */
    const root = tempRoot({ "AGENTS.md": "# Project manual\n" })
    /** The branch the function reports. */
    const result = initializeProject(root)
    expect(result.status).toBe("skipped")
    expect(result.reason).toBe("instructions-present")
    expect(() => readFileSync(join(root, AGENT_FILE))).toThrow()
    expect(() => readFileSync(join(root, MARKER_FILE))).toThrow()
  })

  test("the instruction-file match is case-insensitive and never overwrites", () => {
    /** A lower-cased instruction file must still cancel the scaffold. */
    const root = tempRoot({ "agent.md": "KEEP THIS\n" })
    /** The branch the function reports. */
    const result = initializeProject(root)
    expect(result.reason).toBe("instructions-present")
    expect(readFileSync(join(root, "agent.md"), "utf8")).toBe("KEEP THIS\n")
    expect(() => readFileSync(join(root, AGENT_FILE))).toThrow()
  })

  test("HOME is never treated as a project", () => {
    /** An empty directory standing in for the user's home. */
    const root = tempRoot()
    /** The branch the function reports. */
    const result = initializeProject(root, { home: root })
    expect(result.status).toBe("skipped")
    expect(result.reason).toBe("home-or-root")
    expect(() => readFileSync(join(root, AGENT_FILE))).toThrow()
  })

  test("the filesystem root is never treated as a project", () => {
    /** The platform's filesystem root ("/" or "C:\\"). */
    const root = parse(process.cwd()).root
    expect(initializeProject(root).reason).toBe("home-or-root")
  })

  test("an existing marker skips a workspace that already ran", () => {
    /** A workspace already stamped by a previous session. */
    const root = tempRoot({ [MARKER_FILE]: "{\"version\":1}\n" })
    /** The branch the function reports. */
    const result = initializeProject(root)
    expect(result.status).toBe("skipped")
    expect(result.reason).toBe("already-initialized")
    expect(() => readFileSync(join(root, AGENT_FILE))).toThrow()
  })

  test("a directory that is not project-like skips", () => {
    /** Visible content with neither `.git` nor a manifest. */
    const root = tempRoot({ "notes.txt": "scratch\n" })
    /** The branch the function reports. */
    const result = initializeProject(root)
    expect(result.status).toBe("skipped")
    expect(result.reason).toBe("not-a-project")
    expect(() => readFileSync(join(root, AGENT_FILE))).toThrow()
  })
})

describe("agentScaffold", () => {
  test("carries the provenance comment and states no invented command", () => {
    /** A fixed instant, so the provenance line is deterministic. */
    const at = new Date("2026-10-22T00:00:00.000Z")
    /** The rendered scaffold under test. */
    const body = agentScaffold(at)
    expect(body.startsWith("<!-- Generated once by mpd-project-init")).toBe(true)
    expect(body).toContain(at.toISOString())
    for (const heading of [
      "## 1. Read first",
      "## 2. Plan before acting",
      "## 3. Small diffs",
      "## 4. Commands",
      "## 5. Verification",
      "## 6. Git discipline",
      "## 7. Delegation and evidence",
      "## 8. Security",
    ]) {
      expect(body).toContain(heading)
    }
    // Every command this file mentions is an OBVIOUS placeholder: the scaffold never states a
    // command as fact for a project it knows nothing about.
    /** The lines of the Commands section that name a command. */
    const commandLines = body
      .slice(body.indexOf("## 4. Commands"), body.indexOf("## 5. Verification"))
      .split("\n")
      .filter((line: string): boolean => line.startsWith("- "))
    expect(commandLines.length).toBeGreaterThan(0)
    for (const line of commandLines) expect(line).toContain("<fill in:")
  })
})

describe("isTopLevelSession", () => {
  test("a seeded fork with a parent link and depth 0 IS top-level", () => {
    /** The user's own working session shape (T-92). */
    const agent = { session: { header: { parentSession: "p", isSeeded: true, delegationDepth: 0 } } }
    expect(isTopLevelSession(agent)).toBe(true)
  })

  test("a recorded subagent origin is a child", () => {
    expect(isTopLevelSession({ session: { header: { origin: "subagent", delegationDepth: 0 } } })).toBe(false)
  })

  test("a delegation depth of 1 or more is a child", () => {
    expect(isTopLevelSession({ session: { header: { delegationDepth: 1 } } })).toBe(false)
  })

  test("a headerless agent fails closed", () => {
    expect(isTopLevelSession({})).toBe(false)
    expect(isTopLevelSession(undefined)).toBe(false)
  })
})

describe("installProjectInit", () => {
  test("registers per agent, and ONLY a top-level session writes", () => {
    /** The top-level session's workspace. */
    const root = tempRoot()
    /** The subagent handle: a listener is registered, but the classification refuses it. */
    const child = { id: "child", session: { header: { origin: "subagent", cwd: root } } }
    /** The top-level handle this case expects to write. */
    const captain = { id: "captain", session: { header: { cwd: root, delegationDepth: 0 } } }
    /** The fake adapter over both agents. */
    const fake = fakeAdapter([child, captain], (agent: unknown) => String((agent as { session: { header: { cwd: string } } }).session.header.cwd))
    /** The install outcome under test. */
    const install = installProjectInit(fake.dsh)
    expect(install.installed).toBe(true)
    expect(install.disposers.size).toBe(2)
    expect(fake.events).toEqual(["agent/created", "agent/disposed"])
    /** The child's listener, which must stay silent. */
    const childListener = fake.registered.find((entry: RegisteredListener): boolean => entry.agent === child)!.listener
    expect(childListener({}, {})).toBeUndefined()
    expect(() => readFileSync(join(root, AGENT_FILE))).toThrow()
    /** The captain's listener, which must create the scaffold once. */
    const captainListener = fake.registered.find((entry: RegisteredListener): boolean => entry.agent === captain)!.listener
    expect(captainListener({}, {})).toBeUndefined()
    expect(readFileSync(join(root, AGENT_FILE), "utf8")).toContain("# AGENT.md")
    // A second step of the same session never re-inspects: the log still carries ONE line.
    expect(captainListener({}, {})).toBeUndefined()
    expect(readFileSync(join(root, LOG_FILE), "utf8").trim().split("\n").length).toBe(1)
    expect(install.acted.has(captain)).toBe(true)
    expect(install.acted.has(child)).toBe(false)
  })

  test("a throwing workspace resolver never breaks the step", () => {
    /** The workspace the failing resolver would have answered. */
    const root = tempRoot()
    /** A top-level agent whose workspace resolution will throw. */
    const captain = { id: "captain", session: { header: { cwd: root, delegationDepth: 0 } } }
    /** The exploding fake adapter. */
    const fake = fakeAdapter([captain], () => root, true)
    /** The install outcome under test. */
    const install = installProjectInit(fake.dsh)
    /** The captain's listener. */
    const listener = fake.registered[0].listener
    expect(() => listener({}, {})).not.toThrow()
    expect(listener({}, {})).toBeUndefined()
    expect(fake.logged.some((line: string): boolean => line.includes("pre-step failed"))).toBe(true)
    expect(install.acted.has(captain)).toBe(true)
  })

  test("a disposed agent is dropped from BOTH the acted set and the disposer map", () => {
    /** The workspace the disposed session carried. */
    const root = tempRoot()
    /** A top-level agent that runs one pre-step and is then disposed. */
    const captain = { id: "captain", session: { header: { cwd: root, delegationDepth: 0 } } }
    /** The fake adapter recording the lifecycle handler. */
    const fake = fakeAdapter([captain], () => root)
    /** The install outcome under test. */
    const install = installProjectInit(fake.dsh)
    /** The captain's pre-step listener, fired so `acted` gains an entry for a LIVE agent. */
    const listener = fake.registered[0].listener
    listener({}, {})
    expect(install.acted.has(captain)).toBe(true)
    // A live agent's disposer must not have run yet: the fake records every invocation, so the
    // assertions below prove the teardown RAN rather than merely that both map entries vanished.
    expect(fake.disposedAgents.length).toBe(0)
    // The disposal path must clear the acted entry too: it holds the agent HANDLE, so keeping it
    // after disposal would retain a dead agent for the life of the process (CodeRabbit #3).
    /** The `agent/disposed` handler the row subscribed. */
    const disposed = fake.handlers.get("agent/disposed")
    if (disposed === undefined) throw new Error("the row subscribed no agent/disposed handler")
    disposed({ agent: captain })
    expect(fake.disposedAgents).toEqual([captain])
    expect(install.acted.has(captain)).toBe(false)
    expect(install.disposers.has(captain)).toBe(false)
    // Teardown is idempotent: a repeated disposal must not invoke the disposer a second time.
    disposed({ agent: captain })
    expect(fake.disposedAgents.length).toBe(1)
  })

  test("apply() installs the listeners through the mounted adapter", () => {
    /** A fresh workspace the row never writes to in this arm (the agent is a child). */
    const root = tempRoot()
    /** A subagent handle, so the wiring case proves registration without a write. */
    const child = { id: "child", session: { header: { origin: "subagent", cwd: root } } }
    /** The fake adapter the ctx resolves as `mpdDsh`. */
    const fake = fakeAdapter([child], () => root)
    /** The row's cordis-shaped context: only the adapter service is read. */
    const ctx = { get: (service: string): unknown => (service === "mpdDsh" ? fake.dsh : undefined) }
    apply(ctx)
    expect(fake.registered.length).toBe(1)
    expect(fake.events).toEqual(["agent/created", "agent/disposed"])
  })
})
