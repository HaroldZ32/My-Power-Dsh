// OPT-2 (user decision 2026-09-13, binding): residual cleanup + gate ordering.
//
// 1. A residual team is EXACTLY `staged && !approvedAt && tasks.length === 0`.
//    Anything approved/running, and any staged team that already carries tasks,
//    must never be reclaimed.
// 2. Reclamation is ARCHIVAL (a directory rename into <stateRoot>/archive/<id>/),
//    never a raw delete, and it produces a manifest.
// 3. The preset states the gate ordering: the complexity gate runs BEFORE the
//    sizing doctrine, so sizing can never be what creates a team.
import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { isResidual } from "../../../scripts/reclaim-staged-teams.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")

const base = () => ({ id: "t", name: "probe", captainSessionId: "session-c", createdAt: Date.now(), phase: "staged", members: [], tasks: [] })

test("OPT-2 classification: only empty staged unapproved teams are residual", () => {
    expect(isResidual(base())).toBe(true)
    // approved staged -> protected
    expect(isResidual({ ...base(), approvedAt: Date.now() })).toBe(false)
    // running/unapproved/empty -> NOT residue (it is live work)
    expect(isResidual({ ...base(), phase: "running" })).toBe(false)
    // staged WITH tasks -> protected (a plan may still be under review)
    expect(isResidual({ ...base(), tasks: [{ id: "t1" }] })).toBe(false)
    // unreadable/partial records are never reclaimed
    expect(isResidual(undefined)).toBe(false)
    expect(isResidual({ ...base(), tasks: undefined })).toBe(false)
})

test("OPT-2: reclamation archives residue, protects live teams, and emits a manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "mpd-opt2-"))
    const ws = join(root, "ws")
    const stateRoot = join(ws, ".mpd", "team")
    const write = (id, record) => {
        mkdirSync(join(stateRoot, id, "inbox"), { recursive: true })
        writeFileSync(join(stateRoot, id, "team.json"), JSON.stringify({ ...base(), id, ...record }, null, 2))
    }
    try {
        write("residue-a", {})
        write("residue-b", {})
        write("live-running", { phase: "running", approvedAt: Date.now(), tasks: [{ id: "t1", status: "pending", dependencies: [] }] })
        write("live-approved-staged", { approvedAt: Date.now() })
        write("staged-with-tasks", { tasks: [{ id: "t1", status: "pending", dependencies: [] }] })
        const before = readFileSync(join(stateRoot, "live-running", "team.json"), "utf8")
        const out = execFileSync(process.execPath, [join(repoRoot, "scripts", "reclaim-staged-teams.mjs"), "--apply", "--workspace", ws], { encoding: "utf8" })
        // the CLI prints the manifest JSON then a human summary line; take the JSON
        const lines = out.split("\n")
        const end = lines.findIndex((line) => line.startsWith("[reclaim-staged-teams]"))
        const manifest = JSON.parse(lines.slice(0, end === -1 ? lines.length : end).join("\n"))
        expect(manifest.reclaimable).toBe(2)
        expect(manifest.reclaimed).toBe(2)
        // residue is ARCHIVED (never rm'd): the live path is gone, the archive copy exists
        expect(existsSync(join(stateRoot, "residue-a"))).toBe(false)
        expect(existsSync(join(stateRoot, "archive", "residue-a", "team.json"))).toBe(true)
        expect(existsSync(join(stateRoot, "archive", "residue-b", "team.json"))).toBe(true)
        // live teams are byte-identical and still live
        expect(existsSync(join(stateRoot, "live-running", "team.json"))).toBe(true)
        expect(readFileSync(join(stateRoot, "live-running", "team.json"), "utf8")).toBe(before)
        expect(existsSync(join(stateRoot, "live-approved-staged", "team.json"))).toBe(true)
        expect(existsSync(join(stateRoot, "staged-with-tasks", "team.json"))).toBe(true)
        // the manifest names every decision
        const byId = Object.fromEntries(manifest.manifest.map((entry) => [entry.teamId, entry]))
        expect(byId["residue-a"].archived).toBe(true)
        expect(byId["live-running"].residual).toBe(false)
        expect(byId["live-running"].archived).toBe(false)
        expect(byId["staged-with-tasks"].residual).toBe(false)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("OPT-2: a dry run reclaims nothing", () => {
    const root = mkdtempSync(join(tmpdir(), "mpd-opt2-dry-"))
    const ws = join(root, "ws")
    const stateRoot = join(ws, ".mpd", "team")
    try {
        mkdirSync(join(stateRoot, "residue", "inbox"), { recursive: true })
        writeFileSync(join(stateRoot, "residue", "team.json"), JSON.stringify({ ...base(), id: "residue" }, null, 2))
        const out = execFileSync(process.execPath, [join(repoRoot, "scripts", "reclaim-staged-teams.mjs"), "--workspace", ws], { encoding: "utf8" })
        const lines = out.split("\n")
        const end = lines.findIndex((line) => line.startsWith("[reclaim-staged-teams]"))
        const manifest = JSON.parse(lines.slice(0, end === -1 ? lines.length : end).join("\n"))
        expect(manifest.apply).toBe(false)
        expect(manifest.reclaimable).toBe(1)
        expect(manifest.reclaimed).toBe(0)
        expect(existsSync(join(stateRoot, "residue", "team.json"))).toBe(true)
        expect(existsSync(join(stateRoot, "archive"))).toBe(false)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("OPT-2 ordering: the preset puts the gate BEFORE the sizing doctrine", () => {
    const preset = readFileSync(join(repoRoot, "presets", "mpd", "agent.cordis.yml"), "utf8")
    const gate = preset.indexOf("SESSION STARTUP RULE")
    const sizing = preset.indexOf("AGENT TEAM ROUTING")
    expect(gate).toBeGreaterThan(-1)
    expect(sizing).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(sizing)
    // the old unconditional invariant must be gone, and the ordering stated
    expect(preset).not.toMatch(/every session\s+MUST start inside a team/i)
    expect(preset).toMatch(/PRE-STEP/)
    expect(preset).toMatch(/can never force a team into existence/)
})
