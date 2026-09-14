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
import { TEAM_ACTIVATION_PROMPT, TEAM_MEMBER_PROMPT, installTeamCapabilities } from "../lib/capabilities.js"
import { CAPTAIN_TOOL_NAMES } from "../lib/tool-names.js"

const CAPTAIN_PROMPT = "captain protocol body"

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "mpd-capabilities-"))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeJson(path: string, value: unknown) {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

function makeAgent(id: string, workspace: string) {
  const restrictions: { deny?: string[] }[] = []
  const disposers: (() => void)[] = []
  const agent: Record<string, unknown> = {
    id,
    status: "idle",
    session: { header: { cwd: workspace } },
  }
  agent.ctx = {
    agent,
    tools: { restrict: (filter: { deny?: string[] }) => { restrictions.push(filter); return () => undefined } },
    effect: (cb: () => (() => void) | undefined, _label?: string) => { const d = cb(); if (typeof d === "function") disposers.push(d) },
  }
  return { agent, restrictions, disposers }
}

function makeCtx(agents: unknown[]) {
  const sections: { name: string; order: number; text: (input: { agent?: unknown }) => string }[] = []
  const handlers = new Map<string, (payload: { agent: unknown }) => void>()
  const warnings: string[] = []
  const disposers: (() => void)[] = []
  const ctx = {
    systemPrompt: { section: (definition: typeof sections[number]) => { sections.push(definition) } },
    on: (name: string, cb: (payload: { agent: unknown }) => void) => { handlers.set(name, cb); return () => undefined },
    effect: (cb: () => (() => void) | undefined, _label?: string) => { const d = cb(); if (typeof d === "function") disposers.push(d) },
    agents: { list: () => [...agents] },
    logger: { warn: (...args: unknown[]) => { warnings.push(args.map(String).join(" ")) } },
  }
  return { ctx, sections, handlers, warnings, disposers }
}

function install(workspace: string, ctx: unknown, isPendingMember: (agent: unknown) => boolean) {
  installTeamCapabilities(ctx, {
    stateDir: ".agent-teams",
    isPendingMember,
    order: 117,
    captainPrompt: () => CAPTAIN_PROMPT,
  })
}

describe("agent-scoped AgentTeams instructions", () => {
  test("the captain gets the activation prompt, the member gets member rules", () => {
    const ws = makeWorkspace()
    try {
      const { agent: captain } = makeAgent("session-captain", ws.dir)
      const { agent: member } = makeAgent("member-1", ws.dir)
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
    const ws = makeWorkspace()
    try {
      const { agent: member, restrictions } = makeAgent("member-1", ws.dir)
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
    const ws = makeWorkspace()
    try {
      writeJson(join(ws.dir, ".agent-teams", "retired-members.json"), ["retired-member"])
      const { agent: retired } = makeAgent("retired-member", ws.dir)
      const { ctx, sections } = makeCtx([retired])
      install(ws.dir, ctx, () => false)
      expect(sections[0].text({ agent: retired })).toBe(TEAM_MEMBER_PROMPT)
    } finally {
      ws.cleanup()
    }
  })

  test("a live team record decides membership without any spawn filter", () => {
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
      const { agent: member } = makeAgent("member-alpha", ws.dir)
      const { agent: captain } = makeAgent("session-captain", ws.dir)
      const { ctx, sections } = makeCtx([member, captain])
      install(ws.dir, ctx, () => false)
      expect(sections[0].text({ agent: member })).toBe(TEAM_MEMBER_PROMPT)
      expect(sections[0].text({ agent: captain })).toContain(CAPTAIN_PROMPT)
    } finally {
      ws.cleanup()
    }
  })

  test("damaged state warns and falls back to the captain protocol instead of throwing", () => {
    const ws = makeWorkspace()
    try {
      writeJson(join(ws.dir, ".agent-teams", "retired-members.json"), { not: "an array" })
      const { agent } = makeAgent("member-1", ws.dir)
      const { ctx, sections, warnings } = makeCtx([agent])
      install(ws.dir, ctx, () => false)
      expect(sections[0].text({ agent })).toContain(CAPTAIN_PROMPT)
      expect(warnings.join("\n")).toContain("capability hydration failed")
    } finally {
      ws.cleanup()
    }
  })

  test("agents created after install are attached on agent/session-start", () => {
    const ws = makeWorkspace()
    try {
      const { ctx, handlers, sections } = makeCtx([])
      install(ws.dir, ctx, () => false)
      const { agent: late } = makeAgent("member-late", ws.dir)
      handlers.get("agent/session-start")?.({ agent: late })
      expect(sections[0].text({ agent: late })).toContain(CAPTAIN_PROMPT)
    } finally {
      ws.cleanup()
    }
  })
})
