// Proves the agent-scoped capability layer: a member must receive the member
// instructions (never the captain protocol) and must not be able to call
// captain-only business tools, including after a cold resume where no spawn
// filter is installed in this process.
//
// Regression this locks (observed on a live 2026-09-10 team): every spawned
// member's system prompt carried the captain protocol ("you are the captain of
// a multi-agent team"), because the usage section was global, and the
// spawn-time deny list missed `agent_teams_approve` / `agent_teams_edit_plan`.
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// The adopted capability layer is vendored JavaScript with no declaration file, so the installer
// and the two prompt constants arrive untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { TEAM_ACTIVATION_PROMPT, TEAM_MEMBER_PROMPT, installTeamCapabilities } from "../lib/capabilities.js"
// The adopted tool-name table is vendored JavaScript with no declaration file.
// @ts-expect-error vendored JavaScript has no declaration file
import { CAPTAIN_TOOL_NAMES } from "../lib/tool-names.js"

/** Captain-protocol body the fixture returns; the arms assert only where it appears and where not. */
const CAPTAIN_PROMPT = "captain protocol body"

/** One system-prompt section the capability layer registered, as this fixture records it. */
type PromptSection = {
  /** Section name; the layer's usage section must register under `agent-teams:usage`. */
  readonly name: string
  /** Registration order, which the layer places at the team-capability band. */
  readonly order: number
  /** Renders the section for one agent: member rules, or the captain protocol. */
  readonly text: (input: { agent?: unknown }) => string
}

/** The plugin-context seams `installTeamCapabilities` needs, each recorded by this fixture. */
type CapabilityCtx = {
  /** System-prompt seam the capability layer registers its usage section on. */
  readonly systemPrompt: { readonly section: (definition: PromptSection) => void }
  /** Event seam; handlers are captured so an arm can fire `agent/session-start` itself. */
  readonly on: (name: string, handler: (payload: { agent: unknown }) => void) => () => void
  /** Effect seam: the body runs once and any disposer it returns is collected. */
  readonly effect: (cb: () => (() => void) | undefined, label?: string) => void
  /** Agent-registry seam the cold-resume hydration walk lists. */
  readonly agents: { readonly list: () => unknown[] }
  /** Logger seam; warnings are collected so an arm can assert the degrade path. */
  readonly logger: { readonly warn: (...args: unknown[]) => void }
}

/** Temp workspace plus its teardown, so every arm cleans up the state root it wrote. */
function makeWorkspace(): { dir: string; cleanup: () => void } {
  /** Fresh temp directory standing in for the session workspace. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-capabilities-"))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Writes one JSON fixture file, creating the parent directory it lives under. */
function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

/** One session stub carrying the ctx seams the capability layer reads, plus what it recorded. */
function makeAgent(id: string, workspace: string): { agent: Record<string, unknown>; restrictions: { deny?: string[] }[]; disposers: (() => void)[] } {
  /** Every tool filter the layer applied, in order; the deny list is the unit under test. */
  const restrictions: { deny?: string[] }[] = []
  /** Disposers collected from the effect seam, so a teardown bug cannot leak silently. */
  const disposers: (() => void)[] = []
  /** The stub session; its workspace `cwd` roots every state read the layer performs. */
  const agent: Record<string, unknown> = {
    id,
    status: "idle",
    session: { header: { cwd: workspace } },
  }
  agent.ctx = {
    agent,
    tools: { restrict: (filter: { deny?: string[] }) => { restrictions.push(filter); return () => undefined } },
    effect: (cb: () => (() => void) | undefined, _label?: string) => {
      /** Disposer the effect body returned; only a function is worth collecting. */
      const d = cb()
      if (typeof d === "function") disposers.push(d)
    },
  }
  return { agent, restrictions, disposers }
}

/** A plugin-context stub whose seams record what the capability layer registered. */
function makeCtx(agents: unknown[]): { ctx: CapabilityCtx; sections: PromptSection[]; handlers: Map<string, (payload: { agent: unknown }) => void>; warnings: string[]; disposers: (() => void)[] } {
  /** Usage sections the layer registered; the arms render them directly. */
  const sections: PromptSection[] = []
  /** Registered event handlers by name, so an arm can fire `agent/session-start` itself. */
  const handlers = new Map<string, (payload: { agent: unknown }) => void>()
  /** Logger output, joined by the arms to assert the degraded paths. */
  const warnings: string[] = []
  /** Disposers collected from the effect seam. */
  const disposers: (() => void)[] = []
  /** The stub context, exposing exactly the seams the capability layer touches. */
  const ctx: CapabilityCtx = {
    systemPrompt: { section: (definition: typeof sections[number]) => { sections.push(definition) } },
    on: (name: string, cb: (payload: { agent: unknown }) => void) => { handlers.set(name, cb); return () => undefined },
    effect: (cb: () => (() => void) | undefined, _label?: string) => {
      /** Disposer the effect body returned; only a function is worth collecting. */
      const d = cb()
      if (typeof d === "function") disposers.push(d)
    },
    agents: { list: () => [...agents] },
    logger: { warn: (...args: unknown[]) => { warnings.push(args.map(String).join(" ")) } },
  }
  return { ctx, sections, handlers, warnings, disposers }
}

/** Installs the capability layer against the fixture, with the state root every arm shares. */
function install(workspace: string, ctx: unknown, isPendingMember: (agent: unknown) => boolean): void {
  installTeamCapabilities(ctx, {
    stateDir: ".agent-teams",
    isPendingMember,
    order: 117,
    captainPrompt: () => CAPTAIN_PROMPT,
  })
}

describe("agent-scoped AgentTeams instructions", () => {
  test("the captain gets the activation prompt, the member gets member rules", () => {
    /** Temp workspace the arm's two session stubs are rooted at. */
    const ws = makeWorkspace()
    try {
      /** Captain session stub; the activation prompt plus the captain protocol must land on it. */
      const { agent: captain } = makeAgent("session-captain", ws.dir)
      /** Member session stub; member rules must land on it instead of the captain protocol. */
      const { agent: member } = makeAgent("member-1", ws.dir)
      /** Fixture context plus the sections the layer registers on it. */
      const { ctx, sections } = makeCtx([captain, member])
      install(ws.dir, ctx, (agent) => agent === member)

      expect(sections).toHaveLength(1)
      expect(sections[0].name).toBe("agent-teams:usage")
      expect(sections[0].order).toBe(117)
      expect(sections[0].text({ agent: captain })).toBe(`${TEAM_ACTIVATION_PROMPT}\n\n${CAPTAIN_PROMPT}`)
      expect(sections[0].text({ agent: member })).toBe(TEAM_MEMBER_PROMPT)
      // An agent outside any team scope still sees the captain protocol.
      expect(sections[0].text({})).toBe(`${TEAM_ACTIVATION_PROMPT}\n\n${CAPTAIN_PROMPT}`)
    } finally {
      ws.cleanup()
    }
  })

  test("a member is denied every captain-only business tool", () => {
    /** Temp workspace the arm's session stub is rooted at. */
    const ws = makeWorkspace()
    try {
      /** Member session stub plus the tool filters the layer applied to it. */
      const { agent: member, restrictions } = makeAgent("member-1", ws.dir)
      /** Fixture context the layer installs against. */
      const { ctx } = makeCtx([member])
      install(ws.dir, ctx, () => true)

      expect(restrictions).toHaveLength(1)
      expect(restrictions[0].deny).toEqual([...CAPTAIN_TOOL_NAMES])
      // The two operations the spawn-time deny list used to miss.
      expect(restrictions[0].deny).toContain("agent_teams_approve")
      expect(restrictions[0].deny).toContain("agent_teams_edit_plan")
      // Member operations stay available.
      expect(restrictions[0].deny).not.toContain("agent_teams_update_task")
      expect(restrictions[0].deny).not.toContain("agent_teams_claim_task")
      expect(restrictions[0].deny).not.toContain("agent_teams_send_message")
      expect(restrictions[0].deny).not.toContain("agent_teams_status")
    } finally {
      ws.cleanup()
    }
  })

  test("cold-resumed members are recognized from the durable retired index", () => {
    /** Temp workspace whose retired-member index the arm pre-seeds. */
    const ws = makeWorkspace()
    try {
      writeJson(join(ws.dir, ".agent-teams", "retired-members.json"), ["retired-member"])
      /** Retired session stub; the durable index alone must classify it as a member. */
      const { agent: retired } = makeAgent("retired-member", ws.dir)
      /** Fixture context plus the sections the layer registers on it. */
      const { ctx, sections } = makeCtx([retired])
      install(ws.dir, ctx, () => false)
      expect(sections[0].text({ agent: retired })).toBe(TEAM_MEMBER_PROMPT)
    } finally {
      ws.cleanup()
    }
  })

  test("a live team record decides membership without any spawn filter", () => {
    /** Temp workspace whose live team record the arm writes. */
    const ws = makeWorkspace()
    try {
      writeJson(join(ws.dir, ".agent-teams", "team-1", "team.json"), {
        id: "team-1",
        name: "Team One",
        captainSessionId: "session-captain",
        createdAt: Date.now(),
        phase: "running",
        taskSeq: 0,
        members: [{ name: "Alpha", id: "member-alpha", joinedAt: Date.now(), status: "idle" }],
        tasks: [],
      })
      /** Session stub listed as a member of the live team record. */
      const { agent: member } = makeAgent("member-alpha", ws.dir)
      /** Session stub named as the team's captain. */
      const { agent: captain } = makeAgent("session-captain", ws.dir)
      /** Fixture context plus the sections the layer registers on it. */
      const { ctx, sections } = makeCtx([member, captain])
      install(ws.dir, ctx, () => false)
      expect(sections[0].text({ agent: member })).toBe(TEAM_MEMBER_PROMPT)
      expect(sections[0].text({ agent: captain })).toContain(CAPTAIN_PROMPT)
    } finally {
      ws.cleanup()
    }
  })

  test("damaged state warns and falls back to the captain protocol instead of throwing", () => {
    /** Temp workspace holding a deliberately malformed retired-member index. */
    const ws = makeWorkspace()
    try {
      writeJson(join(ws.dir, ".agent-teams", "retired-members.json"), { not: "an array" })
      /** Session stub the damaged index cannot classify. */
      const { agent } = makeAgent("member-1", ws.dir)
      /** Fixture context plus the sections and warnings the arm asserts on. */
      const { ctx, sections, warnings } = makeCtx([agent])
      install(ws.dir, ctx, () => false)
      expect(sections[0].text({ agent })).toContain(CAPTAIN_PROMPT)
      expect(warnings.join("\n")).toContain("capability hydration failed")
    } finally {
      ws.cleanup()
    }
  })

  test("agents created after install are attached on agent/session-start", () => {
    /** Temp workspace the late session stub is rooted at. */
    const ws = makeWorkspace()
    try {
      /** Fixture context, its captured handlers, and the sections the layer registers. */
      const { ctx, handlers, sections } = makeCtx([])
      install(ws.dir, ctx, () => false)
      /** Session stub created only after the layer was already installed. */
      const { agent: late } = makeAgent("member-late", ws.dir)
      handlers.get("agent/session-start")?.({ agent: late })
      expect(sections[0].text({ agent: late })).toContain(CAPTAIN_PROMPT)
    } finally {
      ws.cleanup()
    }
  })
})
