#!/usr/bin/env node
// docker/lib/team-project-verdict.ts — grade the SMALL PROJECT a live team was asked to build.
//
// WHY THIS EXISTS. `live-verdict.ts` grades a TURN (a completed turn, a parsed tool call, a text
// block). That is the right subject for "did the model call a tool", and it is the wrong subject for
// "did a TEAM finish a project": the artifacts of a team are a record in `<workspace>/.mpd/team/`,
// the files its members wrote, and the test they ran. This reader grades those artifacts on disk so
// neither plane's narration (a chat bubble, a TUI pane) can carry the verdict by itself.
//
// IT IS THE SHARED READER for BOTH planes: the Web lane (a prompt typed into the browser composer)
// and the TUI lane (keystrokes typed into the PTY) both end with the same on-disk artifacts, so both
// invoke this file with their own `--label`. The optional `--pane` arm additionally asserts the TUI
// scene names the REAL team, which is the one fact a pane can prove and the record cannot.
//
// Rows (all prefixed `teamproject.`):
//   record      a team record the prompt asked for exists (matched by name and/or `--since`)
//   members     at least two members were raised, EVERY one carries a native-executor handle, and
//               none failed — a team of names is not a team
//   executor    at least one member carries a native-executor handle
//   board       at least two shared tasks were posted AND at least one dependency edge joins them
//   completed   every posted task reached `completed`, and every completed task's owner is one of
//               the team's own members (a lead closing a member's row alone does not green this)
//   session     the record is bound to the LIVE session the plane drove (null when the lane could
//               not report one — the driver's required-row gate treats that as a miss)
//   files       the project's required files exist, are non-empty, and were WRITTEN after the step
//               started (`--since`), so a re-run cannot green on a previous run's project
//   test        the team's own test passes AND a VERIFIER-OWNED assertion of `sum(2, 3) === 5`
//               passes against the team's module — a vacuous test cannot carry the project
//   pane        (TUI, optional) the captured scene names the real team and draws its task ids
//
// USAGE
//   node docker/lib/team-project-verdict.ts --workspace <ws> --project <dir> --state <ndjson>
//        --label web|tui --team-name <name> [--since <epochMs>] [--session <id>] [--pane <file>]
//   node docker/lib/team-project-verdict.ts --self-test
//
// Exit: 0 when every row it wrote is true, 1 when any is false, 2 on bad usage.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** This file's own path, which the self-test re-invokes so the real CLI path is exercised. */
const SELF = fileURLToPath(import.meta.url)
/** Whether any row this process wrote is false; it becomes the process exit code. */
let sawFailure = false

/** One assertion row, byte-identical in shape to what the entrypoint's `record()` appends. */
interface VerdictRow {
  /** Assertion name, e.g. `teamproject.files`. */
  readonly name: string
  /** true pass, false fail, null not attempted. */
  readonly ok: boolean | null
  /** Human reason the reader attached. */
  readonly reason: string
  /** Observed value quoted beside the verdict. */
  readonly raw: string
}

/** One member of the team record, as this reader uses it. */
interface TeamMember {
  /** The member's store id (`m1`, `m2`, …); the fixture and the record both carry it. */
  readonly id?: string
  /** Display name, e.g. `Senior Engineer`. */
  readonly name?: string
  /** Lifecycle state the record carries. */
  readonly status?: string
  /** The native executor's handle; its presence proves a teammate was really raised. */
  readonly executorRef?: string
}

/** One shared task, as this reader uses it. */
interface TeamTask {
  /** Board id (`T1`, `T2`, …). */
  readonly id?: string
  /** One-line subject. */
  readonly subject?: string
  /** Board state; `completed` is the one terminal value this reader accepts as done. */
  readonly status?: string
  /** The member credited with the work — a display name or the member's executor handle. */
  readonly owner?: string
  /** Ids of the tasks that must close first; only references matching a task on this board count. */
  readonly blockedBy?: readonly string[]
}

/** The subset of a persisted team record this reader needs. */
interface TeamRecord {
  /** Record id. */
  readonly teamId?: string
  /** The team's name, which is how the prompt's own request is matched. */
  readonly name?: string
  /** The session that approved it, keyed by the store's own `sessionKey` (the id, or `workspace`). */
  readonly leadSessionId?: string
  /** ISO instant the record was created. */
  readonly createdAt?: string
  /** Lifecycle phase. */
  readonly phase?: string
  /** The raised roster. */
  readonly members?: readonly TeamMember[]
  /** The shared board. */
  readonly tasks?: readonly TeamTask[]
}

/** Read `--<flag> <value>` off the command line, or `fallback` when absent/valueless. */
function arg(flag: string, fallback: string = ""): string {
  // LAST WINS, the usual CLI convention: a caller that appends an override (the self-test does exactly
  // that when it re-invokes this file) must be able to replace a default passed earlier on the line.
  /** The flag token index, or -1 when the caller never passed it. */
  const index = process.argv.lastIndexOf("--" + flag)
  return index === -1 || index + 1 >= process.argv.length ? fallback : process.argv[index + 1]
}

/** JSON-escape one string for the NDJSON row line. */
function jsonEscape(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

/** Append one row to a state file, remembering whether it reddened the read. */
function emit(stateFile: string, row: VerdictRow): void {
  if (row.ok === false) sawFailure = true
  if (stateFile === "") return
  appendFileSync(stateFile, `{"name":"${jsonEscape(row.name)}","ok":${row.ok === null ? "null" : row.ok},"reason":"${jsonEscape(row.reason)}","raw":"${jsonEscape(row.raw)}"}\n`)
}

/** The error message of an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The non-empty files of a directory, with their stat times; `[]` when the directory is absent. */
function listRecords(teamsDir: string): Array<{ file: string; path: string; mtime: number }> {
  if (!existsSync(teamsDir)) return []
  /** The candidates, filtered to files this reader can stat. */
  const found: Array<{ file: string; path: string; mtime: number }> = []
  for (const file of readdirSync(teamsDir)) {
    if (!file.endsWith(".json")) continue
    /** The candidate path this iteration reads. */
    const path = join(teamsDir, file)
    try {
      if (!statSync(path).isFile()) continue
      found.push({ file, path, mtime: statSync(path).mtimeMs })
    } catch {
      // An unreadable candidate is skipped rather than taking the whole read down.
    }
  }
  return found
}

/** Parse one record, or undefined when the bytes are not a usable team record. */
function readRecord(path: string): TeamRecord | undefined {
  try {
    /** The parsed body, still untyped until the fields below are read. */
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    return parsed as TeamRecord
  } catch {
    return undefined
  }
}

/** The instant a record was created, falling back to the file's mtime when `createdAt` is unusable. */
function createdAtMs(record: TeamRecord, mtime: number): number {
  /** The parsed body, still untyped until the fields below are read. */
  const parsed = typeof record.createdAt === "string" ? Date.parse(record.createdAt) : Number.NaN
  return Number.isFinite(parsed) ? parsed : mtime
}

/** The file's stat, or undefined when it is absent or not a regular file. */
function fileStat(path: string): { size: number; mtimeMs: number } | undefined {
  try {
    /** The file stat, or undefined when it is absent. */
    const stat = statSync(path)
    return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : undefined
  } catch {
    return undefined
  }
}

/** The tail of a command's combined output, single-lined and bounded for a row's `raw`. */
function tail(text: string, max: number = 400): string {
  /** The output with line breaks flattened so a row stays one line. */
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length <= max ? flat : "…" + flat.slice(flat.length - max)
}

/**
 * Run one `node --test` subject and report its exit code and combined output.
 * @param testFile - the test file to execute.
 * @param cwd - the working directory (the project, so relative imports inside it resolve).
 * @returns the exit status (null on a signal) and the combined output.
 */
function runTestFile(testFile: string, cwd: string): { status: number | null; output: string } {
  /** The test process, whose exit code and output are the subject. */
  const run = spawnSync(process.execPath, ["--test", testFile], { cwd, encoding: "utf8", timeout: 120_000 })
  return { status: run.status, output: `${run.stdout ?? ""}\n${run.stderr ?? ""}` }
}

/**
 * The VERIFIER-OWNED assertion: import the team's `sum.ts` and check `sum(2, 3) === 5`.
 *
 * WHY A SECOND TEST: the team's own test file can be vacuous (`test("x", () => {})`), so running it
 * proves the file loads, not that the module works. This test is written by the VERIFIER, imports the
 * team's module by absolute file URL, and cannot be edited by the team.
 * @param projectDir - the team's project directory.
 * @returns the exit status, output, and the temporary test file's path.
 */
function runVerifierSum(projectDir: string): { status: number | null; output: string; file: string } {
  /** The verifier test file this process writes, then removes. */
  const file = join(tmpdir(), `mpd-team-verifier-sum-${process.pid}.test.ts`)
  /** The team module as a file URL, so the verifier test imports the REAL file. */
  const moduleUrl = pathToFileURL(join(projectDir, "sum.ts")).href
  writeFileSync(file, [
    'import { test } from "node:test"',
    'import assert from "node:assert/strict"',
    `import { sum } from ${JSON.stringify(moduleUrl)}`,
    'test("verifier: sum(2, 3) === 5", () => { assert.equal(sum(2, 3), 5) })',
    "",
  ].join("\n"))
  try {
    /** The test process, whose exit code and output are the subject. */
    const run = runTestFile(file, projectDir)
    return { ...run, file }
  } finally {
    rmSync(file, { force: true })
  }
}

/** The main read. Every row is written exactly once, so a missing fact can never be silently dropped. */
function main(): void {
  /** The workspace whose .mpd/team tree is read. */
  const workspace = arg("workspace")
  /** The project directory, absolute or relative to the workspace. */
  const project = arg("project")
  /** The lane assertion file this read appends to. */
  const stateFile = arg("state")
  /** The plane this read grades (web or tui). */
  const label = arg("label", "team")
  /** The team name the prompt asked the model to use. */
  const teamName = arg("team-name")
  /** Epoch ms; records older than this are ignored (0 keeps everything). */
  const since = Number(arg("since", "0")) || 0
  /** The live session id, when the lane knows it. */
  const sessionId = arg("session")
  /** An optional captured TUI pane, whose text is asserted against the real team. */
  const paneFile = arg("pane")
  if (workspace === "") {
    console.error("[team-project] usage: team-project-verdict.ts --workspace <dir> --project <dir> --state <file> --label <web|tui> --team-name <name> [--since <ms>] [--session <id>] [--pane <file>]")
    process.exitCode = 2
    return
  }
  /** The team records directory this workspace's store owns. */
  const teamsDir = join(workspace, ".mpd", "team", "teams")
  /** Every parseable candidate, with the instant it belongs to. */
  const candidates = listRecords(teamsDir)
    .map((entry) => {
      /** This candidate's parsed record, when it parses. */
      const record = readRecord(entry.path)
      return record === undefined ? undefined : { ...entry, record, at: createdAtMs(record, entry.mtime) }
    })
    .filter((entry): entry is { file: string; path: string; mtime: number; record: TeamRecord; at: number } => entry !== undefined)
  // THE MATCH IS NAME FIRST, THEN TIME. A name the prompt asked for is the strongest identity; the
  // `--since` bound keeps a leftover record of the SAME name from a previous run from answering for
  // this one. Both are applied together when the caller supplies both, which is what the lanes do.
  /** Records matching the requested name AND created after --since. */
  const scoped = candidates.filter((entry) => (teamName === "" ? true : entry.record.name === teamName) && (since === 0 ? true : entry.at >= since))
  /** The newest scoped record, or undefined when none matched. */
  const chosen = scoped.length === 0 ? undefined : scoped.reduce((best, entry) => (entry.at >= best.at ? entry : best))
  /** The record's members, defaulted so every downstream read is total. */
  const members = chosen?.record.members ?? []
  /** The record's tasks, defaulted likewise. */
  const tasks = chosen?.record.tasks ?? []
  /** The absolute project directory (a relative --project resolves against the workspace). */
  const projectDir = project === "" ? join(workspace, "team-project") : (project.startsWith("/") ? project : join(workspace, project))
  emit(stateFile, {
    name: `teamproject.record.${label}`,
    ok: chosen !== undefined,
    reason: chosen !== undefined
      ? `a team record the ${label} prompt asked for exists in this workspace`
      : `no team record named "${teamName || "<any>"}" was created after the step started (${since || "any time"}); the model never approved a plan — records present: ${candidates.map((entry) => `${entry.record.name ?? "?"}@${new Date(entry.at).toISOString()}`).join(", ") || "none"}`,
    raw: chosen === undefined ? `dir=${teamsDir} since=${since} wanted=${teamName || "<any>"} found=${candidates.length}` : `file=${chosen.file} teamId=${chosen.record.teamId ?? "?"} name=${chosen.record.name ?? "?"} createdAt=${chosen.record.createdAt ?? "?"} phase=${chosen.record.phase ?? "?"}`,
  })
  // THE ROSTER IS RAISED, NOT NAMED. Every requested member must carry an executor handle and none may
  // be `failed`: a plan of two names with one handle is one teammate, whatever the roster length says.
  /** Members with no executor handle: names are not raised teammates. */
  const unraised = members.filter((member) => (member.executorRef ?? "") === "")
  /** Members the approval recorded as failed to raise. */
  const failedMembers = members.filter((member) => member.status === "failed")
  emit(stateFile, {
    name: `teamproject.members.${label}`,
    ok: chosen === undefined ? null : members.length >= 2 && unraised.length === 0 && failedMembers.length === 0,
    reason: chosen === undefined ? "not measured: no record matched, so no roster could be read"
      : members.length < 2 ? `the team raised only ${members.length} member(s); the prompt asked for two`
        : unraised.length > 0 ? `member(s) carry NO executor handle: ${unraised.map((member) => member.name ?? "?").join(", ")} — names are not teammates`
          : failedMembers.length > 0 ? `member(s) failed to raise: ${failedMembers.map((member) => member.name ?? "?").join(", ")}`
            : `the team raised ${members.length} members, every one with a native-executor handle`,
    raw: members.map((member) => `${member.name ?? "?"}[${member.status ?? "?"}]${(member.executorRef ?? "") === "" ? "=UNRAISED" : "=raised"}`).join(", ") || "none",
  })
  emit(stateFile, {
    name: `teamproject.executor.${label}`,
    ok: chosen === undefined ? null : members.some((member) => (member.executorRef ?? "") !== ""),
    reason: chosen === undefined ? "not measured: no record matched" : members.some((member) => (member.executorRef ?? "") !== "") ? "at least one member carries a native-executor handle, so the team was really raised" : "no member carries an executorRef — approval recorded names but raised nobody",
    raw: members.map((member) => `${member.name ?? "?"}=${(member.executorRef ?? "").slice(0, 16) || "<none>"}`).join(", ") || "none",
  })
  // THE BOARD DRAWS AT LEAST ONE REAL EDGE. A `blockedBy` reference only counts when it names another
  // task ON THIS BOARD, so the assertion reads the dependency the prompt asked for rather than the
  // presence of two unrelated rows.
  /** The board task ids, the only references a blockedBy edge may name. */
  const boardIds = new Set(tasks.map((task) => task.id ?? "").filter((id) => id !== ""))
  /** Resolvable dependency edges, written as `blocker->dependent`. */
  const edges = tasks.flatMap((task) => (task.blockedBy ?? []).filter((reference) => boardIds.has(reference)).map((reference) => `${reference}->${task.id ?? "?"}`))
  emit(stateFile, {
    name: `teamproject.board.${label}`,
    ok: chosen === undefined ? null : tasks.length >= 2 && edges.length >= 1,
    reason: chosen === undefined ? "not measured: no record matched"
      : tasks.length < 2 ? `the board carries only ${tasks.length} task(s); the prompt asked for two`
        : edges.length === 0 ? "the board carries no resolvable dependency edge — the second task is not blocked by the first"
          : `the board carries ${tasks.length} shared tasks and ${edges.length} dependency edge(s)`,
    raw: `${tasks.map((task) => `${task.id ?? "?"}:${task.status ?? "?"}`).join(", ") || "none"} edges=${edges.join(",") || "none"}`,
  })
  // OWNERSHIP: a completed row must be credited to a member of THIS team. The record stores a member's
  // display name on a declared owner, and the claiming session's id (which IS the executor handle) when
  // the member claimed it, so both spellings are accepted.
  /** Every spelling a completed task may credit: member name or executor handle. */
  const memberKeys = new Set(members.flatMap((member) => [member.name ?? "", member.executorRef ?? ""]).filter((key) => key !== ""))
  /** Tasks that have not reached completed. */
  const unfinished = tasks.filter((task) => task.status !== "completed")
  /** Completed tasks credited to nobody on this roster. */
  const unowned = tasks.filter((task) => task.status === "completed" && !memberKeys.has(task.owner ?? ""))
  emit(stateFile, {
    name: `teamproject.completed.${label}`,
    ok: chosen === undefined ? null : tasks.length > 0 && unfinished.length === 0 && unowned.length === 0,
    reason: chosen === undefined ? "not measured: no record matched"
      : tasks.length === 0 ? "the board is empty"
        : unfinished.length > 0 ? `${unfinished.length}/${tasks.length} task(s) are not completed: ${unfinished.map((task) => `${task.id ?? "?"}(${task.subject ?? "?"})=${task.status ?? "?"}`).join(", ")}`
          : unowned.length > 0 ? `completed task(s) are credited to NO member of this team: ${unowned.map((task) => `${task.id ?? "?"}=${task.owner ?? "<none>"}`).join(", ")}`
            : `every one of the ${tasks.length} tasks reached completed and is credited to a member`,
    raw: tasks.map((task) => `${task.id ?? "?"}=${task.status ?? "?"} owner=${task.owner ?? "<none>"}`).join(", ") || "none",
  })
  // THE SESSION BINDING IS ALWAYS RECORDED, even when the lane could not report an id: the row's
  // presence is what the driver's required-row gate reads, and a null with its reason is honest.
  emit(stateFile, {
    name: `teamproject.session.${label}`,
    ok: chosen === undefined ? null : sessionId === "" ? null : chosen.record.leadSessionId === sessionId,
    reason: chosen === undefined ? "not measured: no record matched"
      : sessionId === "" ? "not measured: the lane did not report the live session id, so the record's binding could not be checked (name + --since is the only identity)"
        : chosen.record.leadSessionId === sessionId ? "the record is bound to the live session this lane drove"
          : `the record is bound to "${chosen.record.leadSessionId ?? "?"}", not this lane's session "${sessionId}" — it cannot be evidence about this turn`,
    raw: `record=${chosen?.record.leadSessionId ?? "?"} session=${sessionId || "<not reported>"}`,
  })
  // FRESHNESS: the files must have been written AT OR AFTER the step began, so a re-run cannot green on
  // a previous run's project while the fresh team wrote nothing.
  /** The project files the prompt asked for, in the order a reader checks them. */
  const requiredFiles = ["sum.ts", "sum.test.ts", "REVIEW.md"]
  /** Each required file with its presence and write instant. */
  const fileReads = requiredFiles.map((file) => {
    /** The candidate path this iteration reads. */
    const path = join(projectDir, file)
    /** The file stat, or undefined when it is absent. */
    const stat = fileStat(path)
    return { file, path, present: stat !== undefined && stat.size > 0, mtime: stat?.mtimeMs ?? 0 }
  })
  /** The required files that are absent or empty. */
  const missingFiles = fileReads.filter((entry) => !entry.present)
  /** Required files that predate this step, so a previous run cannot answer for it. */
  const staleFiles = since === 0 ? [] : fileReads.filter((entry) => entry.present && entry.mtime < since)
  emit(stateFile, {
    name: `teamproject.files.${label}`,
    ok: missingFiles.length === 0 && staleFiles.length === 0,
    reason: missingFiles.length > 0 ? `missing or empty project file(s): ${missingFiles.map((entry) => entry.file).join(", ")}`
      : staleFiles.length > 0 ? `project file(s) predate this step — a previous run's work cannot answer for this team: ${staleFiles.map((entry) => entry.file).join(", ")}`
        : "the team's project files exist, carry content and were written during this step",
    raw: `dir=${projectDir} files=${fileReads.map((entry) => `${entry.file}:${entry.present ? new Date(entry.mtime).toISOString() : "absent"}`).join(",")} since=${since || "any"}`,
  })
  // THE PROJECT WORKS, OR IT DOES NOT: the team's own test AND a verifier-owned assertion must pass.
  /** The team's own test file read, when present. */
  const teamTest = fileReads.find((entry) => entry.file === "sum.test.ts")
  if (teamTest === undefined || !teamTest.present) {
    emit(stateFile, { name: `teamproject.test.${label}`, ok: false, reason: "the test file is missing, so the project cannot be shown to work", raw: `dir=${projectDir}` })
  } else {
    /** The team's own test run: it proves the file loads, not that the module works. */
    const own = runTestFile(teamTest.path, projectDir)
    /** The verifier's own sum(2, 3) === 5 run against the team's module. */
    const verifier = runVerifierSum(projectDir)
    /** Both tests passed, which is the one statement this row may make. */
    const ok = own.status === 0 && verifier.status === 0
    emit(stateFile, {
      name: `teamproject.test.${label}`,
      ok,
      reason: ok ? "the team's own test passes AND the verifier's own sum(2, 3) === 5 assertion passes against the team's module"
        : own.status !== 0 ? `the team's own test failed (exit ${own.status ?? "signal"}): ${tail(own.output)}`
          : `the verifier's own sum(2, 3) === 5 assertion failed against the team's module (exit ${verifier.status ?? "signal"}): ${tail(verifier.output)} — a vacuous or wrong module cannot carry the project`,
      raw: `team=${own.status ?? "signal"} verifier=${verifier.status ?? "signal"} file=${teamTest.path} ${tail(verifier.output, 200)}`,
    })
  }
  // THE PANE ARM IS TUI-ONLY AND OPTIONAL. The record proves the team; the pane proves the SCENE drew
  // that team and not a fixture — the team scene's own title carries `<name> (<id>)`, and its graph
  // header plus the boxed task ids are the drawing this arm checks.
  if (paneFile !== "") {
    /** The captured pane, or "" when it cannot be read. */
    let pane = ""
    try { pane = readFileSync(paneFile, "utf8") } catch { pane = "" }
    /** The team name the scene must name. */
    const wantedName = chosen?.record.name ?? teamName
    /** Task ids the scene must draw. */
    const wantedIds = tasks.map((task) => task.id ?? "").filter((id) => id !== "")
    /** Ids absent from the pane, spelled as the drawing spells them. */
    const missingIds = wantedIds.filter((id) => !new RegExp(`(^|[^A-Za-z0-9])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`).test(pane))
    /** Whether the scene's own header is on the pane. */
    const hasHeader = pane.includes("task dependency graph")
    /** Whether the scene names the real team. */
    const hasTeam = wantedName !== "" && pane.includes(wantedName)
    emit(stateFile, {
      name: `teamproject.pane.${label}`,
      ok: pane !== "" && hasHeader && hasTeam && missingIds.length === 0,
      reason: pane === "" ? `the pane capture ${paneFile} could not be read` : !hasHeader ? "the captured pane carries no team-scene header (`task dependency graph`), so the scene never opened" : !hasTeam ? `the scene does not name the live team "${wantedName}" — it is drawing something else` : missingIds.length > 0 ? `the scene does not draw task id(s): ${missingIds.join(", ")}` : "the TUI scene draws the live team's own name, header and task ids",
      raw: `pane=${paneFile} chars=${pane.length} header=${hasHeader} team=${hasTeam} ids=${wantedIds.join(",") || "none"} missing=${missingIds.join(",") || "none"}`,
    })
  }
  if (sawFailure) process.exitCode = 1
}

/** One fixture workspace the self-test builds. */
interface Fixture {
  /** The fixture's scratch root. */
  root: string
  /** The project directory inside it. */
  project: string
  /** The captured pane file. */
  pane: string
}

/** The overrides a negative arm applies to the passing fixture. */
interface FixtureOverrides {
  /** Replacement roster. */
  members?: readonly TeamMember[]
  /** Replacement board. */
  tasks?: readonly TeamTask[]
  /** Replacement `sum.ts` body. */
  sum?: string
  /** Replacement `sum.test.ts` body. */
  test?: string
  /** Replacement pane text. */
  pane?: string
}

/**
 * Build a passing fixture: a two-member raised team, a two-task blocked/completed board with member
 * owners, a working `sum.ts`, a real test, a non-empty review, and a pane naming the team.
 * @param overrides - optional mutations for a negative arm.
 * @returns the fixture's paths.
 */
function makeFixture(overrides: FixtureOverrides = {}): Fixture {
  /** The fixture's scratch root. */
  const root = mkdtempSync(join(tmpdir(), "mpd-team-verdict-selftest-"))
  /** The fixture workspace the store tree lives under. */
  const ws = join(root, "ws")
  /** The project directory, absolute or relative to the workspace. */
  const project = join(ws, "team-project")
  mkdirSync(join(ws, ".mpd", "team", "teams"), { recursive: true })
  mkdirSync(project, { recursive: true })
  /** This candidate's parsed record, when it parses. */
  const record = {
    version: 1,
    teamId: "t1",
    name: "live-team-self",
    description: "self-test",
    leadSessionId: "s1",
    createdAt: new Date().toISOString(),
    phase: "active",
    members: overrides.members ?? [
      { id: "m1", name: "Senior Engineer", status: "running", executorRef: "a1" },
      { id: "m2", name: "Reviewer", status: "running", executorRef: "a2" },
    ],
    tasks: overrides.tasks ?? [
      { id: "T1", subject: "implement", status: "completed", owner: "a1", blockedBy: [] },
      { id: "T2", subject: "review", status: "completed", owner: "Reviewer", blockedBy: ["T1"] },
    ],
    nextMemberNumber: 3,
    nextTaskNumber: 3,
  }
  writeFileSync(join(ws, ".mpd", "team", "teams", "t1.json"), JSON.stringify(record))
  writeFileSync(join(project, "sum.ts"), overrides.sum ?? "export function sum(a: number, b: number): number { return a + b }\n")
  writeFileSync(join(project, "sum.test.ts"), overrides.test ?? 'import { test } from "node:test"\nimport assert from "node:assert/strict"\nimport { sum } from "./sum.ts"\ntest("sum", () => { assert.equal(sum(2, 3), 5) })\n')
  writeFileSync(join(project, "REVIEW.md"), "PASS\n")
  /** The captured pane, or "" when it cannot be read. */
  const pane = join(root, "pane.txt")
  writeFileSync(pane, overrides.pane ?? "MPD team — live-team-self (t1)\ntask dependency graph\n T1  T2 \n")
  return { root, project, pane }
}

/** One parsed self-test row, narrowed to the fields an arm reads. */
interface SelftestRow {
  /** Assertion name. */
  name: string
  /** The verdict: true pass, false fail, null not attempted. */
  ok: boolean | null
}

/** Run the CLI against a fixture and return its parsed rows by name. */
function runFixture(fixture: Fixture, extra: readonly string[]): { rows: Map<string, SelftestRow>; status: number | null } {
  /** The NDJSON file this fixture run appends its rows to. */
  const state = join(fixture.root, "state.ndjson")
  /** The test process, whose exit code and output are the subject. */
  const run = spawnSync(process.execPath, [SELF, "--workspace", join(fixture.root, "ws"), "--project", "team-project", "--state", state, "--label", "web", "--team-name", "live-team-self", "--session", "s1", "--pane", fixture.pane, ...extra], { encoding: "utf8" })
  /** The parsed rows by name. */
  const rows = new Map<string, SelftestRow>()
  for (const line of (existsSync(state) ? readFileSync(state, "utf8") : "").split("\n")) {
    if (line.trim() === "") continue
    try {
      /** One parsed fixture row. */
      const row = JSON.parse(line) as SelftestRow
      rows.set(row.name, row)
    } catch {
      // A corrupt fixture row fails the arm that reads it.
    }
  }
  return { rows, status: run.status }
}

/** The offline self-test: every arm runs the REAL CLI against a fixture, so no helper can drift. */
function selfTest(): void {
  /** Every arm this self-test runs, in order. */
  const checks: Array<{ name: string; ok: boolean; detail: string }> = []
  /** Record one arm and its detail. */
  const check = (name: string, ok: boolean, detail: string = ""): void => { checks.push({ name, ok, detail }) }
  /** Fixtures built, removed after the arms run. */
  const created: Fixture[] = []
  /** Build a fixture and remember it for cleanup. */
  const fixture = (overrides: FixtureOverrides = {}): Fixture => {
    /** The fixture this call built, remembered so the finally block can remove it. */
    const made = makeFixture(overrides)
    created.push(made)
    return made
  }
  try {
    // 1. the happy path: every row true, exit 0.
    /** The passing fixture run every arm is compared against. */
    const happy = runFixture(fixture(), [])
    /** The row suffixes every plane verdict writes. */
    const expected = ["record", "members", "executor", "board", "completed", "session", "files", "test", "pane"]
    check("the happy fixture records every row and all are true", expected.every((suffix) => happy.rows.get(`teamproject.${suffix}.web`)?.ok === true) && happy.rows.size === expected.length, JSON.stringify([...happy.rows.entries()]))
    check("the happy fixture exits 0", happy.status === 0)
    // 2. a record the name does not match: record false, derived rows null (not false-by-accident).
    /** A run that asks for a name no record carries. */
    const foreign = runFixture(fixture(), ["--team-name", "some-other-team"])
    check("a foreign name reddens record and nulls the derived rows", foreign.rows.get("teamproject.record.web")?.ok === false && foreign.rows.get("teamproject.members.web")?.ok === null)
    // 3. freshness: files written BEFORE the since bound redden the files row.
    /** A run whose since bound postdates the files it reads. */
    const future = runFixture(fixture(), ["--since", String(Date.now() + 60_000)])
    check("files older than --since redden the files row (a previous run's work cannot answer)", future.rows.get("teamproject.files.web")?.ok === false)
    // 4. a wrong module behind a passing team test: the team's own test greens, the VERIFIER's own
    //    assertion reddens — the whole reason the second test exists.
    /** A team test that passes while the module is WRONG. */
    const vacuous = runFixture(fixture({ sum: "export function sum(a: number, b: number): number { return a - b }\n" }), [])
    check("a wrong module reddens the test row via the verifier's own assertion", vacuous.rows.get("teamproject.test.web")?.ok === false, String(vacuous.rows.get("teamproject.test.web")?.ok))
    // 5. an unraised member: names alone are not a team.
    /** Members with no executor handle: names are not raised teammates. */
    const unraised = fixture({ members: [
      { id: "m1", name: "Senior Engineer", status: "running", executorRef: "a1" },
      { id: "m2", name: "Reviewer", status: "failed" },
    ] })
    check("a member without a handle (and a failed one) reddens the members row", runFixture(unraised, []).rows.get("teamproject.members.web")?.ok === false)
    // 6. a completed task credited to nobody on the roster: ownership is part of "the team did it".
    /** A completed task credited to nobody on the roster. */
    const noOwner = fixture({ tasks: [
      { id: "T1", subject: "implement", status: "completed", owner: "outsider", blockedBy: [] },
      { id: "T2", subject: "review", status: "completed", owner: "Reviewer", blockedBy: ["T1"] },
    ] })
    check("a task credited to a non-member reddens the completed row", runFixture(noOwner, []).rows.get("teamproject.completed.web")?.ok === false)
    // 7. no dependency edge: two unrelated tasks are not the DAG the prompt asked for.
    /** Two tasks with no dependency between them. */
    const noEdge = fixture({ tasks: [
      { id: "T1", subject: "implement", status: "completed", owner: "a1", blockedBy: [] },
      { id: "T2", subject: "review", status: "completed", owner: "Reviewer", blockedBy: [] },
    ] })
    check("a board with no resolvable edge reddens the board row", runFixture(noEdge, []).rows.get("teamproject.board.web")?.ok === false)
    // 8. the pane arm: a scene that does not name the team is not evidence about that team.
    /** A scene that names a different team. */
    const badPane = fixture({ pane: "MPD team — something-else (x)\ntask dependency graph\n T1  T2 \n" })
    check("a pane that names another team reddens the pane row", runFixture(badPane, []).rows.get("teamproject.pane.web")?.ok === false)
    // 9. the session row is PRESENT even when the lane reports no id (null with a reason).
    /** A run that reports no session id. */
    const noSession = fixture()
    /** The state file for the no-session run. */
    const noSessionState = join(noSession.root, "state-nosession.ndjson")
    /** The no-session run itself, read for its exit code. */
    const noSessionRun = spawnSync(process.execPath, [SELF, "--workspace", join(noSession.root, "ws"), "--project", "team-project", "--state", noSessionState, "--label", "web", "--team-name", "live-team-self"], { encoding: "utf8" })
    /** The session row it must write anyway, as a null with a reason. */
    const sessionRow = (existsSync(noSessionState) ? readFileSync(noSessionState, "utf8") : "").split("\n").filter(Boolean).map((line) => JSON.parse(line) as SelftestRow).find((row) => row.name === "teamproject.session.web")
    check("the session row is always written, as null when no id was reported", noSessionRun.status === 0 && sessionRow !== undefined && sessionRow.ok === null)
  } catch (error) {
    check("the self-test itself did not throw", false, messageOf(error))
  } finally {
    for (const made of created) rmSync(made.root, { recursive: true, force: true })
  }
  for (const entry of checks) console.log(`[team-project-verdict] ${entry.ok ? "ok  " : "FAIL"} ${entry.name}${entry.detail ? ` :: ${entry.detail}` : ""}`)
  /** The arms that did not hold. */
  const failed = checks.filter((entry) => !entry.ok)
  if (failed.length > 0) {
    console.error(`[team-project-verdict] self-test FAILED ${failed.length}/${checks.length}`)
    process.exitCode = 1
    return
  }
  console.log(`[team-project-verdict] self-test PASS: ${checks.length}/${checks.length} arms`)
}

if (process.argv.includes("--self-test")) selfTest()
else main()
