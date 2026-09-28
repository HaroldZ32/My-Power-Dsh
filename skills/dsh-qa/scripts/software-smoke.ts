#!/usr/bin/env node
// Landed by t8 from the t9 worked example with exactly the two landing deltas applied (house
// repo-root form, local workspace-isolation import) and the prototype's evidence-dir override
// dropped. The worked example itself was a scratch prototype and is not carried here.
//
// Case software-smoke: the mpd bundle's SOFTWARE development loop, end to end, on a tiny
// deterministic program (a small game) — where the retired RTL case proved the EDA toolchain
// path, this proves the write -> execute -> observe path with NO EDA/RTL toolchain in the loop.
//
// WHAT CARRIES THE PROOF (and what does not):
//   1. a REAL dsh process (mpd-headless, sandboxed DSH_HOME/HOME/workspace) whose model step is
//      answered by a local OpenAI-shaped stub (throwaway key, no provider credential). The stub
//      issues a real `write` tool call and then a real `bash` tool call, so the game is created
//      and executed by the SESSION's own tools, not by the case process.
//   2. the bash tool's REAL result (the transcript the program printed) is replayed through the
//      case's OWN oracle (independent implementation): every ply legal, every move from a winning
//      position leaves a losing position, the declared winner is the player who took the last
//      stone, and the game is deterministic across two runs in the same lane.
//   WHAT DOES NOT CARRY PROOF: "the session ran" (a tree that fails to apply or a missing tool
//   exits 0 in some lanes) and "the stub was called" — both fail the assertions below, because
//   the transcript has to arrive and has to survive the oracle.
//   FALSIFIABILITY: --self-test runs the SAME oracle over a MUTATED copy of the fixture
//   (optimality policy removed) and requires the oracle to go RED, so the assertion set is
//   proven capable of failing before it is trusted.
// --self-test is offline (no network, no model, no dsh).
import { spawn, spawnSync } from "node:child_process"
import type { SpawnSyncReturns } from "node:child_process"
import { createServer } from "node:http"
import type { ServerResponse } from "node:http"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { AddressInfo } from "node:net"
import { fileURLToPath } from "node:url"
// LANDED FORM: import { sandboxWorkspace, assertSessionsSandboxed } from "./lib/workspace-isolation.ts"
import { sandboxWorkspace, assertSessionsSandboxed } from "./lib/workspace-isolation.ts"
import { credentialEnv } from "./lib/credentials.ts"
import { DSH_MISSING, dshCommand } from "./lib/dsh-launcher.ts"
import type { Env } from "./lib/dsh-launcher.ts"

/** The case's slug, used in its banners and in its evidence directory name. */
const SLUG: string = "software-smoke"
/** The checkout root, derived from this script's own URL at `<root>/skills/dsh-qa/scripts/`. */
const repoRoot: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
if (!existsSync(join(repoRoot, "package.json"))) { console.error("[" + SLUG + "] FAIL: repo root not found"); process.exit(1) }

// ---------------------------------------------------------------------------
// The fixture: a small deterministic game. Last stone wins; take 1..3 from one pile.
// `move` answers one position, `play` prints a full deterministic self-play transcript.
// The MUTATION POINT comment marks the single line the control lane replaces.
// ---------------------------------------------------------------------------
/** The fixture program's source, which the session's own `write` tool puts on disk. */
const GAME_SRC: string = [
  "// nim.mjs - deterministic take-away game (Nim, 3 piles, take 1..3 from ONE pile, last stone wins).",
  "// usage: node nim.mjs move --piles 3,4,5 [--seed N]   -> \"move <pileIndex> <count>\" | \"move none\"",
  "//        node nim.mjs play [--seed N]                 -> one transcript line per ply + \"winner P1|P2\"",
  "const argv = process.argv.slice(2)",
  "const cmd = argv[0] || \"play\"",
  "function flag(name, dflt) { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt }",
  "function rng(seed) {",
  "  let s = (Math.abs(Number(seed)) >>> 0) || 1",
  "  return function () {",
  "    s ^= (s << 13); s >>>= 0",
  "    s ^= (s >>> 17)",
  "    s ^= (s << 5); s >>>= 0",
  "    return s / 4294967296",
  "  }",
  "}",
  "function nimSum(p) { return p.reduce(function (a, b) { return a ^ b }, 0) }",
  "function optimalMoves(p) {",
  "  const out = []",
  "  for (let i = 0; i < p.length; i++) {",
  "    for (let k = 1; k <= 3 && k <= p[i]; k++) {",
  "      const q = p.slice(); q[i] -= k",
  "      if (nimSum(q) === 0) out.push([i, k])",
  "    }",
  "  }",
  "  return out",
  "}",
  "function choose(p, rnd) {",
  "  const win = optimalMoves(p) // MUTATION POINT: optimality policy",
  "  if (win.length > 0) return win[Math.floor(rnd() * win.length)]",
  "  for (let i = 0; i < p.length; i++) if (p[i] > 0) return [i, 1]",
  "  return null",
  "}",
  "function parsePiles(text) {",
  "  if (!text) return null",
  "  const p = text.split(\",\").map(function (s) { return Number(s.trim()) })",
  "  if (p.some(function (n) { return !Number.isInteger(n) || n < 0 })) return null",
  "  return p",
  "}",
  "if (cmd === \"move\") {",
  "  const p = parsePiles(flag(\"--piles\", \"\"))",
  "  if (p === null) { console.error(\"usage: node nim.mjs move --piles a,b,c [--seed N]\"); process.exit(2) }",
  "  const mv = choose(p, rng(flag(\"--seed\", 1)))",
  "  console.log(mv === null ? \"move none\" : \"move \" + mv[0] + \" \" + mv[1])",
  "} else {",
  "  const rnd = rng(flag(\"--seed\", 1))",
  "  const piles = parsePiles(flag(\"--piles\", \"3,4,5\")) || [3, 4, 5]",
  "  const lines = []",
  "  let turn = 1",
  "  let ply = 0",
  "  while (piles.some(function (n) { return n > 0 })) {",
  "    const mv = choose(piles, rnd)",
  "    if (mv === null) break",
  "    piles[mv[0]] -= mv[1]",
  "    ply += 1",
  "    lines.push(\"ply \" + ply + \" P\" + turn + \" takes \" + mv[1] + \" from pile \" + mv[0] + \" -> \" + piles.join(\",\"))",
  "    if (!piles.some(function (n) { return n > 0 })) { lines.push(\"winner P\" + turn); break }",
  "    turn = turn === 1 ? 2 : 1",
  "  }",
  "  console.log(lines.join(\"\\n\"))",
  "}",
  "",
].join("\n")
/** The one fixture line the falsifiability control replaces to remove the optimality policy. */
const MUTATION_POINT: string = "  const win = optimalMoves(p) // MUTATION POINT: optimality policy"
/** The mutated fixture the control runs the same oracle over. */
const GAME_MUTANT: string = GAME_SRC.replace(MUTATION_POINT, "  const win = [] // MUTATION: optimality policy removed")
/** The positions the oracle probes, chosen so a winning and a losing start are both exercised. */
const PROBES: readonly string[] = ["3,4,5", "1,2,3", "7,5,3", "2,2,0"]

// ---------------------------------------------------------------------------
// The oracle: an INDEPENDENT implementation of the game rules, reading only the fixture's
// documented output format (never its internals).
// ---------------------------------------------------------------------------
/** The Nim-sum of a position: zero exactly when the player to move has lost with optimal play. */
const xor = (p: readonly number[]): number => p.reduce((a, b) => a ^ b, 0)
/** One `a,b,c` position string parsed into a mutable list of pile sizes. */
const parseState = (text: string): number[] => text.split(",").map((s) => Number(s.trim()))
/** Whether every pile is empty, i.e. the game is over. */
const terminal = (p: readonly number[]): boolean => p.every((n) => n === 0)

/** The verdict on one declared move: every rule violation found, plus the position it leaves. */
interface MoveCheck {
  /** The rule violations, empty when the move is legal and optimal. */
  readonly problems: string[]
  /** The position the move leaves; unchanged when no move was declared. */
  readonly after: readonly number[]
}

/**
 * Classify and check ONE declared move against the rules.
 * @param before The position the move is played from.
 * @param mv The declared move as `[pileIndex, count]`, or `null` for a declared pass.
 * @returns Every rule violation found, plus the position the move leaves.
 */
function checkMove(before: readonly number[], mv: readonly [number, number] | null): MoveCheck {
  // The rule violations found for this one move.
  const problems: string[] = []
  if (mv === null) {
    if (!terminal(before)) problems.push("declared no move in a non-terminal position " + before.join(","))
    return { problems, after: before }
  }
  // The declared move's pile index and the number of stones it takes.
  const [pile, count] = mv
  if (!(pile >= 0 && pile < before.length)) problems.push("pile index out of range: " + pile)
  if (!(count >= 1 && count <= 3)) problems.push("take count outside 1..3: " + count)
  if (pile >= 0 && pile < before.length && count > before[pile]) problems.push("took " + count + " from a pile of " + before[pile])
  // The position the move produces, changed only when the indices are in range.
  const after = before.slice()
  if (pile >= 0 && pile < before.length) after[pile] -= count
  if (xor(before) !== 0 && xor(after) !== 0) problems.push("non-optimal move from winning position " + before.join(",") + " -> " + after.join(","))
  if (xor(before) === 0 && !terminal(before)) {
    // Documented losing-position policy: take 1 from the first non-empty pile.
    // The index of the first pile that still holds a stone.
    const firstNonEmpty = before.findIndex((n) => n > 0)
    if (pile !== firstNonEmpty || count !== 1) problems.push("losing position " + before.join(",") + ": expected the documented fallback move, got pile " + pile + " count " + count)
  }
  return { problems, after }
}

/** The part of the oracle's verdict every caller reads, including the arm that has no final state. */
interface OracleSummary {
  /** Every rule violation the oracle found. */
  readonly problems: string[]
  /** The player the transcript declared as winner, or `null` when it declared none. */
  readonly winner: number | null
  /** How many plies the transcript contained. */
  readonly plies: number
}

/** The oracle's full verdict on a self-play transcript. */
interface ReplayVerdict extends OracleSummary {
  /** The position the replayed transcript ends in. */
  readonly finalState: readonly number[]
}

/**
 * Replay a full self-play transcript; returns the winner the RULES give, plus every violation.
 * @param transcript The `ply …` / `winner …` lines the fixture printed.
 * @param startPiles The position the transcript starts from.
 * @returns The rule violations, the declared winner, the ply count and the final position.
 */
function replay(transcript: string, startPiles: readonly number[]): ReplayVerdict {
  // The rule violations found while replaying.
  const problems: string[] = []
  // The transcript's non-blank lines, in printed order.
  const lines = transcript.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
  // The position the replay has reached, advanced by every ply.
  let state: readonly number[] = startPiles.slice()
  // The player whose turn the next ply must belong to.
  let expectedTurn = 1
  // How many plies have been replayed.
  let plies = 0
  // The winner the transcript declared, or `null` when it declared none.
  let winner: number | null = null
  for (const line of lines) {
    // The `winner P<n>` line, when this line is one.
    const w = /^winner P([12])$/.exec(line)
    if (w) { winner = Number(w[1]); continue }
    // The `ply …` line's captured fields, when this line is one.
    const m = /^ply (\d+) P([12]) takes (\d+) from pile (\d+) -> ([\d,]+)$/.exec(line)
    if (!m) { problems.push("unparsable transcript line: " + JSON.stringify(line)); continue }
    // The captured ply number, player, stone count, pile index and declared resulting state.
    const [, plyNo, turn, count, pile, afterText] = m
    if (Number(plyNo) !== plies + 1) problems.push("ply numbering broken at " + line)
    if (Number(turn) !== expectedTurn) problems.push("turn order broken at " + line)
    // The position this ply is played from.
    const before = state
    // The move's own verdict, plus the position it leaves.
    const { problems: moveProblems, after } = checkMove(before, [Number(pile), Number(count)])
    for (const p of moveProblems) problems.push("ply " + plyNo + ": " + p)
    if (after.join(",") !== afterText) problems.push("declared state " + afterText + " != replayed state " + after.join(","))
    state = after
    plies += 1
    expectedTurn = expectedTurn === 1 ? 2 : 1
  }
  if (!terminal(state) && winner !== null) problems.push("winner declared with stones remaining: " + state.join(","))
  if (terminal(state) && winner === null) problems.push("terminal state without a winner: " + state.join(","))
  if (winner !== null && winner !== (expectedTurn === 1 ? 2 : 1)) {
    problems.push("declared winner P" + winner + " is not the player who moved last (that was P" + (expectedTurn === 1 ? 2 : 1) + ")")
  }
  if (plies < 1 || plies > 15) problems.push("implausible ply count: " + plies)
  return { problems, winner, plies, finalState: state }
}

// ---------------------------------------------------------------------------
// --self-test (offline): fixture semantics + oracle GREEN on the fixture + oracle RED on the
// mutation, i.e. the assertion set is proven falsifiable before any lane depends on it.
// ---------------------------------------------------------------------------
/**
 * The offline arm: the fixture's own semantics, the oracle green on it, and the oracle red on the
 * mutated fixture.
 * @returns Nothing; the process exits non-zero at the first failure.
 */
function selfTest(): void {
  // Reports one failure and stops the self-test with a non-zero exit code.
  const fail = (msg: string): void => { console.error("[" + SLUG + " self-test] FAIL: " + msg); process.exit(1) }
  // The temp directory both fixture copies are written into.
  const die = mkdtempSync(join(tmpdir(), "mpd-" + SLUG + "-st-"))
  // The unmutated fixture, written out to be executed as a real program.
  const game = join(die, "nim.mjs")
  // The mutated fixture, which the falsifiability arm requires the oracle to reject.
  const mutant = join(die, "nim-mutant.mjs")
  writeFileSync(game, GAME_SRC)
  writeFileSync(mutant, GAME_MUTANT)

  if (GAME_SRC.split(MUTATION_POINT).length !== 2) fail("the mutation point is not unique in the fixture")
  if (GAME_MUTANT === GAME_SRC) fail("the control fixture was not mutated")
  // Whether the first probe really is a first-player win, which the oracle's premise needs.
  const winner = xor(parseState(PROBES[0])) !== 0
  if (!winner) fail("fixture premise: " + PROBES[0] + " must be a first-player win")

  // Runs one fixture program and captures its merged output.
  const run = (file: string, args: string[]): SpawnSyncReturns<string> => spawnSync(process.execPath, [file, ...args], { encoding: "utf8", timeout: 60000 })
  // The first self-play transcript.
  const playA = run(game, ["play", "--seed", "7"])
  // The second self-play transcript, which must be byte-identical to the first.
  const playB = run(game, ["play", "--seed", "7"])
  if (playA.status !== 0) fail("fixture self-play exited " + playA.status + ": " + playA.stderr.slice(0, 200))
  if (playA.stdout !== playB.stdout) fail("fixture self-play is not deterministic across two runs")
  // The oracle's verdict on the fixture's own transcript, which must be clean.
  const live = replay(playA.stdout, [3, 4, 5])
  if (live.problems.length > 0) fail("oracle rejected the fixture's own transcript: " + live.problems.join(" | "))
  if (live.winner !== 1) fail("optimal first player must win 3,4,5 with optimal play, oracle says winner P" + live.winner)

  for (const probe of PROBES) {
    // One probe position's `move` run.
    const r = run(game, ["move", "--piles", probe, "--seed", "7"])
    if (r.status !== 0) fail("fixture move exited " + r.status + " for " + probe)
    // The `move <pile> <count>` reply, when the fixture printed one.
    const m = /^move (\d+) (\d+)$/.exec(r.stdout.trim())
    // The declared move as a tuple, or `null` when the fixture declared none.
    const mv: readonly [number, number] | null = m ? [Number(m[1]), Number(m[2])] : null
    // The move's verdict, whose problems must be empty for the fixture to pass.
    const { problems } = checkMove(parseState(probe), mv)
    if (problems.length > 0) fail("oracle rejected the fixture's move for " + probe + ": " + problems.join(" | "))
  }

  // FALSIFIABILITY: the same oracle over the mutated fixture MUST report an optimality violation.
  // The mutated fixture's self-play transcript.
  const negA = run(mutant, ["play", "--seed", "7"])
  if (negA.status !== 0) fail("mutated fixture exited " + negA.status)
  // The oracle's verdict on the mutated transcript, which must carry a violation.
  const neg = replay(negA.stdout, [3, 4, 5])
  // Whether the verdict names the optimality policy the mutation removed.
  const optimalityHit = neg.problems.some((p) => p.includes("non-optimal move from winning position"))
  if (!optimalityHit) fail("control failed: the oracle did NOT flag the mutated (non-optimal) fixture: " + JSON.stringify(neg))
  // The mutated fixture's `move` reply, which must be rejected as well.
  const negMove = run(mutant, ["move", "--piles", PROBES[0], "--seed", "7"])
  // The mutated move as printed, when it parsed at all.
  const negParsed = /^move (\d+) (\d+)$/.exec(negMove.stdout.trim())
  // The mutated move's verdict, which must also carry a non-optimality violation.
  const negCheck = checkMove(parseState(PROBES[0]), negParsed ? [Number(negParsed[1]), Number(negParsed[2])] : null)
  if (!negCheck.problems.some((p) => p.includes("non-optimal move"))) fail("control failed for the `move` lane: the mutated fixture was accepted")

  console.log("[" + SLUG + " self-test] ok: fixture semantics + deterministic self-play (winner P" + live.winner + ", " + live.plies + " plies) + " + PROBES.length + " oracle probes green, mutation control RED (" + neg.problems.length + " violation(s))")
}

// ---------------------------------------------------------------------------
// The real lane: one sandboxed dsh session whose tools really create and run the game.
// ---------------------------------------------------------------------------
/** What one model request offered and carried back. */
interface StubTrace {
  /** The stub's stage when the request arrived. */
  readonly stage: string
  /** How many tools the request offered. */
  readonly toolCount: number
  /** Whether the request offered the `write` tool. */
  readonly hasWrite: boolean
  /** Whether the request offered the `bash` tool. */
  readonly hasBash: boolean
  /** How many tool results the request carried back. */
  readonly toolResultCount: number
  /** The tool results themselves, which the oracle replays. */
  readonly toolResults: string[]
}

/** One tool entry of an OpenAI-shaped request body. */
interface WireTool {
  /** The nested `function` object the provider's wire shape carries the tool name in. */
  readonly function?: { readonly name?: unknown }
  /** The flat spelling of the same name, which some provider builds use instead. */
  readonly name?: unknown
}

/** One conversation message of an OpenAI-shaped request body. */
interface WireMessage {
  /** The message's role, which decides whether it is a tool result. */
  readonly role?: unknown
  /** The message's payload: a string for a tool result, a list for anything else. */
  readonly content?: unknown
}

/** The slice of an OpenAI-shaped request body this stub reads. */
interface WireRequest {
  /** The tool list the request offered. */
  readonly tools?: WireTool[]
  /** The conversation the request carried. */
  readonly messages?: WireMessage[]
}

/** The local OpenAI-shaped stub: its recorded request trace and its lifecycle handles. */
interface ModelStub {
  /** One entry per model request, in arrival order. */
  readonly trace: StubTrace[]
  /** Starts the server on an ephemeral port and resolves that port. */
  readonly listen: () => Promise<number>
  /** Stops the server. */
  readonly close: () => void
}

/**
 * Build the stub that answers the session's model steps with real `write` and `bash` tool calls.
 * @param gameSource The fixture source the stub hands to the session's `write` tool.
 * @returns The stub's trace, its `listen` starter and its `close` stopper.
 */
function makeStub(gameSource: string): ModelStub {
  // One entry per model request, in arrival order.
  const trace: StubTrace[] = []
  // Which step of the write → execute conversation the stub answers next.
  let stage: string = "idle"
  // Answers one request with a single server-sent event carrying the payload.
  const sse = (res: ServerResponse, payload: unknown): void => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" })
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
    res.write("data: [DONE]\n\n")
    res.end()
  }
  // One streaming chat-completion chunk in the provider's wire shape.
  const chunk = (delta: Record<string, unknown>, finish?: string): Record<string, unknown> => ({ id: "chatcmpl-software-smoke", object: "chat.completion.chunk", created: 1, model: "probe", choices: [{ index: 0, delta, finish_reason: finish ?? null }] })
  // One streaming chunk whose delta carries a tool call.
  const toolCall = (id: string, name: string, args: Record<string, unknown>): Record<string, unknown> => chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] })
  // The single `bash` command that runs the game twice, diffs the runs and probes four positions.
  const BASH = [
    "node nim.mjs play --seed 7 > play-a.txt 2>&1; node nim.mjs play --seed 7 > play-b.txt 2>&1;",
    'cmp -s play-a.txt play-b.txt && echo "DETERMINISTIC" || echo "NONDETERMINISTIC";',
    'echo "--- play ---"; cat play-a.txt; echo "--- probes ---";',
    'for p in 3,4,5 1,2,3 7,5,3 2,2,0; do echo "PROBE $p"; node nim.mjs move --piles $p --seed 7; done',
  ].join(" ")
  // The one-shot OpenAI-shaped server the session's model steps are answered by.
  const server = createServer((req, res) => {
    // The request body accumulated from the chunks node hands the listener.
    let body = ""
    req.on("data", (c) => { body += c })
    req.on("end", () => {
      // The parsed request, `{}` while the body is not JSON.
      let parsed: WireRequest = {}
      try { parsed = JSON.parse(body) } catch { /* keep {} */ }
      // The tool list the request offered.
      const tools = Array.isArray(parsed.tools) ? parsed.tools : []
      // The names of those tools, from either wire spelling.
      const toolNames = tools.map((t) => t?.function?.name ?? t?.name).filter((n) => typeof n === "string")
      // The conversation the request carried.
      const messages = Array.isArray(parsed.messages) ? parsed.messages : []
      // The tool results that conversation already carries, as text.
      const toolResults = messages.filter((m) => m.role === "tool" || m.role === "tool_result").map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      trace.push({ stage, toolCount: toolNames.length, hasWrite: toolNames.includes("write"), hasBash: toolNames.includes("bash"), toolResultCount: toolResults.length, toolResults })
      if (tools.length === 0) return sse(res, chunk({ role: "assistant", content: "software-smoke" }))
      if (stage === "idle") { stage = "write-issued"; return sse(res, toolCall("call_write_1", "write", { file_path: "nim.mjs", content: gameSource })) }
      if (stage === "write-issued" && toolResults.length > 0) { stage = "bash-issued"; return sse(res, toolCall("call_bash_1", "bash", { command: BASH, description: "Run the deterministic game twice and probe positions" })) }
      return sse(res, chunk({ role: "assistant", content: "software-smoke-done" }, "stop"))
    })
  })
  return {
    trace,
    // `address()` answers the bound address once `listening` fired, so the assertion only drops
    // the `string | null` the type carries for the not-yet-bound case.
    listen: (): Promise<number> => new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as AddressInfo).port))),
    // `close` returns the server itself, so the block body discards that value as the contract did.
    close: (): void => { server.close() },
  }
}

/** What one child run needs: its environment, its cwd and its timeout. */
interface RunOptions {
  /** The child's environment, always a sandbox one. */
  readonly env: Env
  /** The child's working directory, always a sandbox path. */
  readonly cwd: string
  /** Milliseconds before the child is killed. */
  readonly timeout: number
}

/** What one child run produced. */
interface RunResult {
  /** The child's exit status; `-1` when nothing was spawned or the spawn itself failed. */
  readonly status: number | null
  /** stdout and stderr merged in arrival order. */
  readonly out: string
}

/**
 * Run one child to completion and capture its merged output.
 * @param cmd The command to run; `dsh` goes through the launcher resolver instead of the PATH.
 * @param args The argument vector.
 * @param opts The child's environment, cwd and timeout.
 * @returns The exit status and the merged output.
 */
function runAsync(cmd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    // The resolved command, or `null` when no `dsh` launcher exists on this machine.
    const spec = cmd === "dsh" ? dshCommand(args, opts.env ?? process.env) : { command: cmd, args }
    if (spec === null) { resolve({ status: -1, out: DSH_MISSING }); return }
    // The child, with both output streams piped back into this process.
    const child = spawn(spec.command, spec.args, { ...opts, stdio: ["ignore", "pipe", "pipe"] })
    // The merged output accumulated so far.
    let out = ""
    child.stdout.on("data", (d) => { out += d })
    child.stderr.on("data", (d) => { out += d })
    child.on("error", (err) => resolve({ status: -1, out: out + "\nspawn error: " + err.message }))
    child.on("close", (status) => resolve({ status, out }))
  })
}

/** The profile-install arm's record. */
interface InstallStep {
  /** Whether the installer exited zero. */
  ok: boolean
  /** The installer's exit status, or a negative sentinel when it never ran. */
  exit: number | null
  /** The tail of the installer's output, kept for the evidence record. */
  tail: string
}

/** The sandboxed session arm's record. */
interface SessionStep {
  /** Whether the session ran, offered both tools and returned both results. */
  ok: boolean
  /** The session process's exit status. */
  exit: number | null
  /** How many model requests the stub answered. */
  stubCalls: number
  /** Whether the `write` tool was ever offered to the model. */
  writeToolOffered: boolean
  /** Whether the `bash` tool was ever offered to the model. */
  bashToolOffered: boolean
  /** Whether the write tool's own result names the created file. */
  writeResultOk: boolean
  /** Whether the session reported a missing credential. */
  missingCredential: boolean
  /** Whether the session reported an authentication failure. */
  authFailed: boolean
}

/** The artifact arm: what the session's own tools produced on disk and in the transcript. */
interface ArtifactStep {
  /** Whether every artifact assertion passed; filled in once `optimal` is known. */
  ok?: boolean
  /** Whether the file the session wrote exists and is non-empty. */
  exists?: boolean
  /** Whether the written bytes are exactly the fixture source. */
  contentMatches?: boolean
  /** Whether the session's own bash run proved the program deterministic. */
  deterministic?: boolean
  /** Whether the oracle accepted the replayed transcript and every probe. */
  optimal?: boolean
  /** The oracle's verdict and the per-probe findings. */
  oracle?: unknown
}

/** The workspace-isolation assertion's verdict. */
interface IsolationStep {
  /** Whether the assertion passed; it throws instead of returning a failure. */
  ok: boolean
  /** How many session-store keys the check inspected, absent on the skipped arm. */
  checked?: number
  /** The inspected keys, so the record shows what was actually looked at. */
  keys?: string[]
  /** Why the assertion did not run, present only when the lane aborted early. */
  skipped?: string
  /** The thrown message, present only when the assertion failed. */
  error?: string
}

/** The live run's named arms, each carrying that arm's own evidence beside its pass flag. */
interface SmokeSteps {
  /** The profile-install arm. */
  install?: InstallStep
  /** The sandboxed session arm. */
  session?: SessionStep
  /** The produced-artifact arm, whose later fields the oracle fills in. */
  artifact?: ArtifactStep
  /** The workspace-isolation assertion. */
  isolation?: IsolationStep
}

/** One probed position's outcome: the fixture's own reply and the oracle's findings on it. */
interface ProbeOutcome {
  /** The `move …` line the session's bash tool printed for this position. */
  readonly output: string
  /** The oracle's findings, empty when the move is legal and optimal. */
  readonly problems: string[]
}

/** The live arm: one sandboxed dsh session whose own tools create and run the game. */
function runReal(): Promise<void> {
  return (async (): Promise<void> => {
    // The evidence directory stamp, in the filename-safe ISO form the QA tree uses.
    const ts = new Date().toISOString().replaceAll(":", "-")
    // The evidence directory this run writes into.
    const outDir = join(repoRoot, "evidence", "dsh-qa", SLUG, ts)
    mkdirSync(outDir, { recursive: true })
    // The temp sandbox root every path below lives under.
    const sandbox = mkdtempSync(join(tmpdir(), "mpd-" + SLUG + "-"))
    // The sandbox `DSH_HOME` the installer writes and the session store lives in.
    const dshHome = join(sandbox, "dsh-home")
    // The sandbox `HOME`, which keeps skill roots out of the real home.
    const runHome = join(sandbox, "run-home")
    mkdirSync(dshHome, { recursive: true })
    mkdirSync(runHome, { recursive: true })
    // The workspace the session's tools run in, never the real checkout.
    const ws = sandboxWorkspace(sandbox)
    // The child environment: sandboxed paths plus the throwaway key the local stub accepts.
    const env: Env = credentialEnv({ ...process.env, DSH_HOME: dshHome, HOME: runHome, DEEPSEEK_API_KEY: "sk-software-smoke-local-stub"  })
    if (dshHome.startsWith(homedir() + "/.dsh")) { console.error("[" + SLUG + "] FAIL: isolation assertion"); process.exit(1) }

    // The profile install, which must succeed before any session can boot.
    const inst = await runAsync(process.execPath, [join(repoRoot, "scripts", "install-profile.ts"), "--yes", "--dsh-home", dshHome, "--profile", "mpd-headless", "--skip-toolchain"], { env, cwd: ws, timeout: 900000 })
    // The arms recorded so far, keyed by arm name.
    const steps: SmokeSteps = { install: { ok: inst.status === 0, exit: inst.status, tail: inst.out.slice(-400) } }
    if (inst.status !== 0) return finish(steps, outDir, sandbox, "", inst.out)

    // The local model stub that answers the session's model steps.
    const stub = makeStub(GAME_SRC)
    // The ephemeral port the stub listens on.
    const port = await stub.listen()
    // The sandbox profile's patch file, to which the stub's base URL is appended.
    const patchPath = join(dshHome, "cordis.patch.yml")
    // The patch with the stub's base URL injected into the `llm-deepseek` row.
    const patch = readFileSync(patchPath, "utf8") + ["", "- id: llm-deepseek", "  config:", `    baseURL: http://127.0.0.1:${port}/v1`, "    apiKeyEnv: DEEPSEEK_API_KEY", ""].join("\n")
    writeFileSync(patchPath, patch)

    // The sandboxed session run, whose tools must create and execute the game.
    const run = await runAsync("dsh", ["--profile", "mpd-headless", "Create nim.mjs from the provided content and run the deterministic self-play and position probes with bash."], { env, cwd: ws, timeout: 900000 })
    stub.close()
    // Every tool result the stub saw, which is what the oracle reads.
    const toolMsgs = stub.trace.flatMap((c) => c.toolResults)
    // The `write` tool's own result, empty when the session never wrote the file.
    const writeResult = toolMsgs.find((t) => /<path>.*nim\.mjs<\/path>/.test(t) || /Created file/.test(t)) ?? ""
    // The `bash` tool's own result, empty when the session never ran the game.
    const bashResult = toolMsgs.find((t) => t.includes("PROBE 3,4,5")) ?? ""
    steps.session = {
      ok: run.status === 0 && stub.trace.some((c) => c.hasWrite) && stub.trace.some((c) => c.hasBash) && writeResult !== "" && bashResult !== "",
      exit: run.status,
      stubCalls: stub.trace.length,
      writeToolOffered: stub.trace.some((c) => c.hasWrite),
      bashToolOffered: stub.trace.some((c) => c.hasBash),
      writeResultOk: /Created file/.test(writeResult),
      missingCredential: run.out.includes("MISSING_CREDENTIAL"),
      authFailed: /AUTH:|Authentication Fails/.test(run.out),
    }
    // The file the session wrote, empty when it wrote nothing.
    const written = existsSync(join(ws, "nim.mjs")) ? readFileSync(join(ws, "nim.mjs"), "utf8") : ""
    steps.artifact = {
      ok: false,
      exists: written !== "",
      contentMatches: written === GAME_SRC,
      deterministic: /^DETERMINISTIC$/m.test(bashResult),
    }
    // The real result: the transcript the SESSION's bash tool produced, replayed by the oracle.
    // The transcript between the two markers the bash command prints.
    const play = bashResult.split("--- play ---")[1]?.split("--- probes ---")[0]?.trim() ?? ""
    // The oracle's verdict, or the finding that no transcript arrived at all.
    const verdict: OracleSummary = play ? replay(play, [3, 4, 5]) : { problems: ["no transcript in the bash tool result"], winner: null, plies: 0 }
    // One entry per probed position, keyed by the position string.
    const probes: Record<string, ProbeOutcome> = {}
    for (const probe of PROBES) {
      // This probe's own output segment from the bash transcript.
      const seg = bashResult.split("PROBE " + probe)[1]?.split("PROBE ")[0]?.trim().split("\n")[0]?.trim() ?? ""
      // The probe's `move <pile> <count>` reply, when it parsed at all.
      const m = /^move (\d+) (\d+)$/.exec(seg)
      // The probe's move verdict, which must carry no problems.
      const check = checkMove(parseState(probe), m ? [Number(m[1]), Number(m[2])] : null)
      probes[probe] = { output: seg, problems: check.problems }
    }
    steps.artifact.optimal = verdict.problems.length === 0 && Object.values(probes).every((p) => p.problems.length === 0)
    steps.artifact.ok = steps.artifact.exists && steps.artifact.contentMatches && steps.artifact.deterministic && steps.artifact.optimal
    steps.artifact.oracle = { winner: verdict.winner, plies: verdict.plies, problems: verdict.problems, probes }
    try {
      // The verdict already carries `ok: true`, so writing it last keeps the same value the
      // original spread order produced while stating the flag exactly once.
      steps.isolation = { ...assertSessionsSandboxed(dshHome, sandbox, { label: SLUG }), ok: true }
    } catch (err) {
      steps.isolation = { ok: false, error: String(err) }
    }
    return finish(steps, outDir, sandbox, run.out, run.out)
  })()
}

/**
 * Write the run's evidence and exit with its verdict.
 * @param steps The recorded arms, keyed by arm name.
 * @param outDir The evidence directory to write into.
 * @param sandbox The sandbox root, recorded so the evidence names its own isolation.
 * @param fullOutput The session's merged output.
 * @param extraLog Any further log text appended after it.
 * @returns Nothing; the process exits with the run's overall verdict.
 */
function finish(steps: SmokeSteps, outDir: string, sandbox: string, fullOutput: string, extraLog: string): void {
  // Whether every recorded arm passed (`ok: false` is the only failure marker).
  const allOk = Object.values(steps).every((s: { ok?: boolean }) => s.ok !== false)
  // The isolation verdict, defaulted when the lane aborted before the assertion.
  const isolation = steps.isolation ?? { ok: true, skipped: "lane aborted before the assertion" }
  steps.isolation = isolation
  // The run's overall verdict, which also requires that isolation assertion.
  const allOkFinal = allOk && isolation.ok !== false
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOkFinal, slug: SLUG, sandbox, steps }, null, 2) + "\n")
  writeFileSync(join(outDir, "output.log"), fullOutput + "\n" + (extraLog ?? "") + "\n")
  console.log("[" + SLUG + "] ok=" + allOkFinal + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 300))
  process.exit(allOkFinal ? 0 : 1)
}

// The command-line arguments, which decide between the offline self-test and the live lane.
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
