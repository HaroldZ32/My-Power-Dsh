import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DshPromptSection } from "../../mpd-dsh-adapter-plugin/src/index"
import { installProjectContext } from "../src/project-context"
import { readContextFragment, readContextStructure } from "../src/project-context-sources"
import { buildProjectContext, PROJECT_CONTEXT_BYTES } from "../src/project-context-view"
import { type TeamRecord, type TeamTaskRecord, writeTeam } from "../src/team-store"

/** A compact authoritative work row with one explicit source path and shared exact ref. */
function task(id: string, owner: string, scope: string, given: Partial<TeamTaskRecord> = {}): TeamTaskRecord {
  return { id, owner, subject: `Work ${id}`, description: "Context private: memo\nContext shared: {\"key\":\"interface\",\"revision\":2,\"appliesTo\":\"v2\"}", kind: "work", status: "in_progress", blockedBy: [], writeScopes: [scope], revision: 3, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...given }
}

test("caption and source bytes stay in their role budgets under heavy UTF-8 and observed pressure", () => {
  /** An eagerly-sized subject, owner scope and note would crowd out the next action. */
  const long = "😀汉字".repeat(400)
  /** The captain builder remains safe even if a caller supplies optional member data by mistake. */
  const build = (role: "captain" | "member", pressured: boolean): string => buildProjectContext({
    role, pressured, goal: { id: "G1", revision: 1, objective: long, phase: "active", maxGoalRounds: 1 },
    tasks: [task("T2", "worker", "src.ts", { subject: long })],
    notes: [{ key: "private", text: "PRIVATE-CANARY" }],
    fragment: { path: "src.ts", bytes: 10, prefixSha256: "a".repeat(64), text: "FILE-CANARY" },
  })
  expect(Buffer.byteLength(build("captain", false))).toBeLessThanOrEqual(PROJECT_CONTEXT_BYTES.captain)
  expect(build("captain", false)).not.toContain("PRIVATE-CANARY")
  expect(build("captain", false)).not.toContain("FILE-CANARY")
  expect(build("member", false)).toContain("FILE-CANARY")
  expect(Buffer.byteLength(build("member", false))).toBeLessThanOrEqual(PROJECT_CONTEXT_BYTES.member)
  expect(Buffer.byteLength(build("member", true))).toBeLessThanOrEqual(PROJECT_CONTEXT_BYTES.pressured)
  expect(build("member", true)).not.toContain("FILE-CANARY")
})

test("source reader omits missing, symlinked, globbed, binary and hidden state safely", () => {
  /** Separate synthetic roots make a link-out false positive visible. */
  const root = mkdtempSync(join(tmpdir(), "mpd-context-source-"))
  try {
    mkdirSync(join(root, "ws"))
    /** The caller's actual checkout. */
    const workspace = join(root, "ws")
    writeFileSync(join(root, "outside.txt"), "OUTSIDE")
    writeFileSync(join(workspace, ".env"), "HIDDEN")
    writeFileSync(join(workspace, "source.dat"), Buffer.from([0, 0xff]))
    writeFileSync(join(workspace, "readable.ts"), "export const FileCanary = 1\n".repeat(100))
    symlinkSync(join(root, "outside.txt"), join(workspace, "link.ts"))
    expect(readContextFragment(workspace, ["missing", "../outside.txt", ".env", "link.ts", "**/*.ts", "source.dat"])).toBeUndefined()
    expect(readContextFragment(workspace, ["missing", "readable.ts"])).toMatchObject({ bytes: 440, path: "readable.ts" })
    writeFileSync(join(workspace, "package.json"), '{bad')
    expect(readContextStructure(workspace)).toBeUndefined()
    writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "qa-package", type: "module", exports: { "./api": "./src.ts" }, secret: "META-PRIVATE" }))
    expect(readContextStructure(workspace)?.summary).toBe("name=qa-package; type=module; exports=./api")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("one native context reauthenticates each request and releases on disposal", () => {
  /** Each board and file source belongs only to this synthetic project. */
  const root = mkdtempSync(join(tmpdir(), "mpd-context-hook-"))
  /** The actual holder passed through the fake adapter's lifecycle. */
  const captain = { id: "C", session: { id: "C", header: { cwd: root } } }
  /** Two equally real agent handles with distinct durable identities. */
  const worker = { id: "A", session: { id: "A", header: { cwd: root } } }
  /** An unrelated live caller with its own scope. */
  const helper = { id: "B", session: { id: "B", header: { cwd: root } } }
  /** One native context entry from the common registry, recorded as a test double. */
  const registry: DshPromptSection[] = []
  /** Current active executor handle of the worker, mutable to exercise loss of binding. */
  let current = "A"
  /** Record all private reads so the captain and helper cannot sneak one through. */
  const reads: unknown[] = []
  try {
    writeFileSync(join(root, "a.ts"), "A-OWN-FILE")
    writeFileSync(join(root, "peer.ts"), "PEER-FILE")
    /** Real durable record path and read semantics, with synthetic session handles. */
    const record: TeamRecord = {
      version: 1, teamId: "qa-team", name: "QA", description: "Project objective", leadSessionId: "C", phase: "active",
      createdAt: "2026-01-01T00:00:00Z", nextMemberNumber: 2, nextTaskNumber: 3,
      members: [{ id: "M1", name: "worker", executorRef: "A", description: "", status: "running", spawnedAt: "2026-01-01T00:00:00Z" }],
      tasks: [task("T1", "worker", "a.ts", { blockedBy: ["T0"] }), task("T0", "captain", "", { note: "receipt.md", status: "completed" }), task("T2", "other", "peer.ts")],
    }
    writeTeam(root, record)
    /** Mount the hook using seams controlled independently by the test. */
    const dispose = installProjectContext({
      workspaceRoot: () => root,
      liveAgentExact: () => captain,
      goalState: () => ({ id: "G1", objective: "host-current-goal", revision: 2, phase: "active", maxGoalRounds: 1 }),
      contextPressure: () => ({ ratio: null, usedTokens: null, windowTokens: null, provenance: "unavailable" }),
      registerPromptContext: (section) => { registry.push(section); return () => { registry.length = 0 } },
    }, {
      identity: { resolveSeat: ({ sessionId }) => sessionId === "C" || sessionId === current
        ? { kind: "member", projectId: "p", projectRoot: root, checkoutRoot: root, memberId: sessionId, teamId: record.teamId, memberName: sessionId === "C" ? "captain" : "worker", seat: sessionId === "C" ? "captain" : "member" }
        : { kind: "denied" } },
      memory: () => ({
        recallKey: (exec: { agent: unknown }) => { reads.push(exec.agent); return { found: true, value: "PRIVATE-A" } },
        contextFact: () => ({ revision: 2, appliesTo: "v2", source: "src/api@rev", text: "PUBLIC-INTERFACE" }),
      }),
      warn: () => undefined,
    })
    /** The fake provider assembles the single registered context for the real calling identity. */
    function assemble(agent: unknown): string {
      /** The registered content is lazily evaluated by the request assembler. */
      const section = registry[0]
      if (typeof section?.text !== "function") throw new Error("missing dynamic context")
      return section.text({ agent })
    }
    expect(registry).toHaveLength(1)
    expect(assemble(captain)).toContain("host-current-goal")
    expect(assemble(captain)).toContain("PUBLIC-INTERFACE")
    expect(assemble(captain)).not.toContain("PRIVATE-A")
    expect(assemble(captain)).not.toContain("A-OWN-FILE")
    expect(assemble(worker)).toContain("PRIVATE-A")
    expect(assemble(worker)).toContain("A-OWN-FILE")
    expect(assemble(worker)).toContain("receipt.md")
    expect(assemble(worker)).not.toContain("PEER-FILE")
    expect(reads.every((agent) => agent === worker)).toBe(true)
    expect(assemble(helper)).toBe("")
    expect(assemble(undefined)).toBe("")
    current = "new-handle"
    expect(assemble(worker)).toBe("")
    dispose()
    expect(registry).toHaveLength(0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
