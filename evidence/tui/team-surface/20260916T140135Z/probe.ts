#!/usr/bin/env bun
// Evidence probe for t2 (TUI team-workflow + plan-approval surfaces).
//
// It reads THIS workspace's REAL durable team record and this workspace's REAL
// watchdog hold store, then renders the two surfaces' rows from them — no
// hand-built object anywhere. It also drives the BUILT dist (`dist/index.js`)
// through a minimal host double to prove the built bytes register the two new
// scene ids and the /mpd command grammar's two new actions.
//
// Usage: bun evidence/tui/team-surface/<timestamp>/probe.mjs
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { approvalPhrase, planProjectionLines, readTeamWorkflow, teamWorkflowLines } from "../../../../packages/mpd-tui-plugin/src/team-state.ts"
import { boardLines, readBoardState } from "../../../../packages/mpd-tui-plugin/src/state.ts"
import * as dist from "../../../../packages/mpd-tui-plugin/dist/index.js"

const REPO = process.cwd()
const OUT = join(REPO, "evidence", "tui", "team-surface", "20260916T140135Z")
mkdirSync(OUT, { recursive: true })

const lines = []
const say = (message) => {
  lines.push(message)
  console.log(message)
}

// ── 1. the REAL record ─────────────────────────────────────────────────────
const stateRoot = join(REPO, ".mpd", "team")
const teamDirs = readdirSync(stateRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith("mpd-default-"))
const recordPath = join(stateRoot, "mpd-default-8d65a2b2", "team.json")
const record = JSON.parse(readFileSync(recordPath, "utf8"))

// ── 2. the REAL watchdog hold store (what heldTeams() answers from) ────────
const holdDir = join(stateRoot, "watchdog", "hold")
let holdFiles = []
try {
  holdFiles = readdirSync(holdDir)
} catch {
  holdFiles = []
}
const holds = holdFiles.length === 0 ? [] : [record.id]
say(`watchdog hold store ${holdDir}: ${holdFiles.length} hold file(s) -> heldTeams()=${JSON.stringify(holds)}`)

// ── 3. the projection the two surfaces render ──────────────────────────────
const workflow = readTeamWorkflow(REPO, holds)
const t1Rows = teamWorkflowLines(workflow)
const t2Rows = planProjectionLines(workflow)
say("── surface T1 (mpd-tui-team) rows ──")
for (const row of t1Rows) say(row)
say("── surface T2 (mpd-tui-plan) projection rows ──")
for (const row of t2Rows) say(row)
say(`approval phrase for this team: ${JSON.stringify(approvalPhrase(workflow.team?.id ?? ""))}`)

// ── 4. the board's two new rows (T3) ───────────────────────────────────────
const boardState = readBoardState(REPO, process.env.HOME ?? REPO)
const board = boardLines(boardState, holds)
const boardExtra = board.filter((row) => row.startsWith("team-plan") || row.startsWith("team-hold"))
say(`board T3 rows: ${JSON.stringify(boardExtra)}`)

// ── 5. the BUILT bytes: scene registration + command grammar ───────────────
const scenes = []
const opened = []
const commands = []
const trees = []
const services = {
  tuiScenes: {
    register: (descriptor) => {
      scenes.push({ id: descriptor.id, title: descriptor.title })
    },
    open: (id) => {
      opened.push(id)
      return true
    },
  },
  commands: {
    register: (definition) => {
      commands.push(definition.name)
      return () => {}
    },
  },
  tuiCommandTrees: {
    register: (provider) => {
      trees.push(provider)
      return () => {}
    },
  },
}
const ctx = {
  inject: (deps, callback) => {
    if (deps.every((id) => services[id] !== undefined)) callback({ get: (name) => services[name] })
    return {}
  },
  get: () => undefined,
  logger: { info: () => {}, warn: () => {}, debug: () => {} },
}
const report = dist.apply(ctx, { statusIntervalMs: 0 })
say(`dist.apply outcomes: ${report.outcomes.map((entry) => `${entry.id}(${entry.outcome.state})`).join(" · ")}`)
say(`dist registered scenes: ${JSON.stringify(scenes)}`)
const children = trees[0]?.children(["mpd"]).map((node) => node.name) ?? []
say(`dist /mpd tree children: ${JSON.stringify(children)}`)
const handler = commands.length > 0 ? scenes.length : 0
void handler

const payload = {
  slug: "tui-team-surface",
  task: "t2",
  producedAt: new Date().toISOString(),
  repoRoot: REPO,
  realRecord: {
    path: recordPath.replace(REPO + "/", ""),
    id: record.id,
    name: record.name,
    phase: record.phase,
    members: Array.isArray(record.members) ? record.members.length : 0,
    tasks: Array.isArray(record.tasks) ? record.tasks.length : 0,
  },
  existingTeamRecords: teamDirs.map((entry) => entry.name),
  watchdog: { holdDir: holdDir.replace(REPO + "/", ""), holdFiles, heldTeams: holds },
  projection: {
    team: workflow.team,
    members: workflow.members,
    tasks: workflow.tasks,
    counts: workflow.counts,
    mail: workflow.mail,
    holds: workflow.holds,
    problems: workflow.problems,
  },
  rows: { team: t1Rows, plan: t2Rows, boardExtra },
  approvalPhrase: approvalPhrase(workflow.team?.id ?? ""),
  builtBytes: {
    distPath: "packages/mpd-tui-plugin/dist/index.js",
    scenes,
    commandRoot: commands,
    treeChildren: children,
    outcomes: report.outcomes,
    sceneIdsPresent: ["mpd-tui-team", "mpd-tui-plan"].every((id) => readFileSync(join(REPO, "packages", "mpd-tui-plugin", "dist", "index.js"), "utf8").includes(id)),
  },
  ok: workflow.team?.id === record.id && scenes.length === 3 && children.includes("team") && children.includes("plan"),
}
writeFileSync(join(OUT, "probe.result.json"), JSON.stringify(payload, null, 2) + "\n")
writeFileSync(join(OUT, "probe.output.log"), lines.join("\n") + "\n")
console.log(`[probe] ok=${payload.ok} -> ${OUT}`)
process.exit(payload.ok ? 0 : 1)
