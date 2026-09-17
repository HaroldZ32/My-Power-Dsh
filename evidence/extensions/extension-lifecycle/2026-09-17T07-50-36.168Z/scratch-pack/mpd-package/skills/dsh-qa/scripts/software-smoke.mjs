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
import { createServer } from "node:http"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
// LANDED FORM: import { sandboxWorkspace, assertSessionsSandboxed } from "./lib/workspace-isolation.mjs"
import { sandboxWorkspace, assertSessionsSandboxed } from "./lib/workspace-isolation.mjs"
import { credentialEnv } from "./lib/credentials.mjs"

const SLUG = "software-smoke"
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
if (!existsSync(join(repoRoot, "package.json"))) { console.error("[" + SLUG + "] FAIL: repo root not found"); process.exit(1) }

// ---------------------------------------------------------------------------
// The fixture: a small deterministic game. Last stone wins; take 1..3 from one pile.
// `move` answers one position, `play` prints a full deterministic self-play transcript.
// The MUTATION POINT comment marks the single line the control lane replaces.
// ---------------------------------------------------------------------------
const GAME_SRC = [
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
const MUTATION_POINT = "  const win = optimalMoves(p) // MUTATION POINT: optimality policy"
const GAME_MUTANT = GAME_SRC.replace(MUTATION_POINT, "  const win = [] // MUTATION: optimality policy removed")
const PROBES = ["3,4,5", "1,2,3", "7,5,3", "2,2,0"]

// ---------------------------------------------------------------------------
// The oracle: an INDEPENDENT implementation of the game rules, reading only the fixture's
// documented output format (never its internals).
// ---------------------------------------------------------------------------
const xor = (p) => p.reduce((a, b) => a ^ b, 0)
const parseState = (text) => text.split(",").map((s) => Number(s.trim()))
const terminal = (p) => p.every((n) => n === 0)

/** Classify and check ONE declared move against the rules. */
function checkMove(before, mv) {
  const problems = []
  if (mv === null) {
    if (!terminal(before)) problems.push("declared no move in a non-terminal position " + before.join(","))
    return { problems, after: before }
  }
  const [pile, count] = mv
  if (!(pile >= 0 && pile < before.length)) problems.push("pile index out of range: " + pile)
  if (!(count >= 1 && count <= 3)) problems.push("take count outside 1..3: " + count)
  if (pile >= 0 && pile < before.length && count > before[pile]) problems.push("took " + count + " from a pile of " + before[pile])
  const after = before.slice()
  if (pile >= 0 && pile < before.length) after[pile] -= count
  if (xor(before) !== 0 && xor(after) !== 0) problems.push("non-optimal move from winning position " + before.join(",") + " -> " + after.join(","))
  if (xor(before) === 0 && !terminal(before)) {
    // Documented losing-position policy: take 1 from the first non-empty pile.
    const firstNonEmpty = before.findIndex((n) => n > 0)
    if (pile !== firstNonEmpty || count !== 1) problems.push("losing position " + before.join(",") + ": expected the documented fallback move, got pile " + pile + " count " + count)
  }
  return { problems, after }
}

/** Replay a full self-play transcript; returns the winner the RULES give, plus every violation. */
function replay(transcript, startPiles) {
  const problems = []
  const lines = transcript.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
  let state = startPiles.slice()
  let expectedTurn = 1
  let plies = 0
  let winner = null
  for (const line of lines) {
    const w = /^winner P([12])$/.exec(line)
    if (w) { winner = Number(w[1]); continue }
    const m = /^ply (\d+) P([12]) takes (\d+) from pile (\d+) -> ([\d,]+)$/.exec(line)
    if (!m) { problems.push("unparsable transcript line: " + JSON.stringify(line)); continue }
    const [, plyNo, turn, count, pile, afterText] = m
    if (Number(plyNo) !== plies + 1) problems.push("ply numbering broken at " + line)
    if (Number(turn) !== expectedTurn) problems.push("turn order broken at " + line)
    const before = state
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
function selfTest() {
  const fail = (msg) => { console.error("[" + SLUG + " self-test] FAIL: " + msg); process.exit(1) }
  const die = mkdtempSync(join(tmpdir(), "mpd-" + SLUG + "-st-"))
  const game = join(die, "nim.mjs")
  const mutant = join(die, "nim-mutant.mjs")
  writeFileSync(game, GAME_SRC)
  writeFileSync(mutant, GAME_MUTANT)

  if (GAME_SRC.split(MUTATION_POINT).length !== 2) fail("the mutation point is not unique in the fixture")
  if (GAME_MUTANT === GAME_SRC) fail("the control fixture was not mutated")
  const winner = xor(parseState(PROBES[0])) !== 0
  if (!winner) fail("fixture premise: " + PROBES[0] + " must be a first-player win")

  const run = (file, args) => spawnSync(process.execPath, [file, ...args], { encoding: "utf8", timeout: 60000 })
  const playA = run(game, ["play", "--seed", "7"])
  const playB = run(game, ["play", "--seed", "7"])
  if (playA.status !== 0) fail("fixture self-play exited " + playA.status + ": " + playA.stderr.slice(0, 200))
  if (playA.stdout !== playB.stdout) fail("fixture self-play is not deterministic across two runs")
  const live = replay(playA.stdout, [3, 4, 5])
  if (live.problems.length > 0) fail("oracle rejected the fixture's own transcript: " + live.problems.join(" | "))
  if (live.winner !== 1) fail("optimal first player must win 3,4,5 with optimal play, oracle says winner P" + live.winner)

  for (const probe of PROBES) {
    const r = run(game, ["move", "--piles", probe, "--seed", "7"])
    if (r.status !== 0) fail("fixture move exited " + r.status + " for " + probe)
    const m = /^move (\d+) (\d+)$/.exec(r.stdout.trim())
    const mv = m ? [Number(m[1]), Number(m[2])] : null
    const { problems } = checkMove(parseState(probe), mv)
    if (problems.length > 0) fail("oracle rejected the fixture's move for " + probe + ": " + problems.join(" | "))
  }

  // FALSIFIABILITY: the same oracle over the mutated fixture MUST report an optimality violation.
  const negA = run(mutant, ["play", "--seed", "7"])
  if (negA.status !== 0) fail("mutated fixture exited " + negA.status)
  const neg = replay(negA.stdout, [3, 4, 5])
  const optimalityHit = neg.problems.some((p) => p.includes("non-optimal move from winning position"))
  if (!optimalityHit) fail("control failed: the oracle did NOT flag the mutated (non-optimal) fixture: " + JSON.stringify(neg))
  const negMove = run(mutant, ["move", "--piles", PROBES[0], "--seed", "7"])
  const negParsed = /^move (\d+) (\d+)$/.exec(negMove.stdout.trim())
  const negCheck = checkMove(parseState(PROBES[0]), negParsed ? [Number(negParsed[1]), Number(negParsed[2])] : null)
  if (!negCheck.problems.some((p) => p.includes("non-optimal move"))) fail("control failed for the `move` lane: the mutated fixture was accepted")

  console.log("[" + SLUG + " self-test] ok: fixture semantics + deterministic self-play (winner P" + live.winner + ", " + live.plies + " plies) + " + PROBES.length + " oracle probes green, mutation control RED (" + neg.problems.length + " violation(s))")
}

// ---------------------------------------------------------------------------
// The real lane: one sandboxed dsh session whose tools really create and run the game.
// ---------------------------------------------------------------------------
function makeStub(gameSource) {
  const trace = []
  let stage = "idle"
  const sse = (res, payload) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" })
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
    res.write("data: [DONE]\n\n")
    res.end()
  }
  const chunk = (delta, finish) => ({ id: "chatcmpl-software-smoke", object: "chat.completion.chunk", created: 1, model: "probe", choices: [{ index: 0, delta, finish_reason: finish ?? null }] })
  const toolCall = (id, name, args) => chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] })
  const BASH = [
    "node nim.mjs play --seed 7 > play-a.txt 2>&1; node nim.mjs play --seed 7 > play-b.txt 2>&1;",
    'cmp -s play-a.txt play-b.txt && echo "DETERMINISTIC" || echo "NONDETERMINISTIC";',
    'echo "--- play ---"; cat play-a.txt; echo "--- probes ---";',
    'for p in 3,4,5 1,2,3 7,5,3 2,2,0; do echo "PROBE $p"; node nim.mjs move --piles $p --seed 7; done',
  ].join(" ")
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (c) => { body += c })
    req.on("end", () => {
      let parsed = {}
      try { parsed = JSON.parse(body) } catch { /* keep {} */ }
      const tools = Array.isArray(parsed.tools) ? parsed.tools : []
      const toolNames = tools.map((t) => t?.function?.name ?? t?.name).filter((n) => typeof n === "string")
      const messages = Array.isArray(parsed.messages) ? parsed.messages : []
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
    listen: () => new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port))),
    close: () => server.close(),
  }
}

function runAsync(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.on("data", (d) => { out += d })
    child.stderr.on("data", (d) => { out += d })
    child.on("error", (err) => resolve({ status: -1, out: out + "\nspawn error: " + err.message }))
    child.on("close", (status) => resolve({ status, out }))
  })
}

function runReal() {
  return (async () => {
    const ts = new Date().toISOString().replaceAll(":", "-")
    const outDir = join(repoRoot, "evidence", "dsh-qa", SLUG, ts)
    mkdirSync(outDir, { recursive: true })
    const sandbox = mkdtempSync(join(tmpdir(), "mpd-" + SLUG + "-"))
    const dshHome = join(sandbox, "dsh-home")
    const runHome = join(sandbox, "run-home")
    mkdirSync(dshHome, { recursive: true })
    mkdirSync(runHome, { recursive: true })
    const ws = sandboxWorkspace(sandbox)
    const env = credentialEnv({ ...process.env, DSH_HOME: dshHome, HOME: runHome, DEEPSEEK_API_KEY: "sk-software-smoke-local-stub"  })
    if (dshHome.startsWith(homedir() + "/.dsh")) { console.error("[" + SLUG + "] FAIL: isolation assertion"); process.exit(1) }

    const inst = await runAsync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", dshHome, "--profile", "mpd-headless", "--skip-toolchain"], { env, cwd: ws, timeout: 900000 })
    const steps = { install: { ok: inst.status === 0, exit: inst.status, tail: inst.out.slice(-400) } }
    if (inst.status !== 0) return finish(steps, outDir, sandbox, "", inst.out)

    const stub = makeStub(GAME_SRC)
    const port = await stub.listen()
    const patchPath = join(dshHome, "cordis.patch.yml")
    const patch = readFileSync(patchPath, "utf8") + ["", "- id: llm-deepseek", "  config:", `    baseURL: http://127.0.0.1:${port}/v1`, "    apiKeyEnv: DEEPSEEK_API_KEY", ""].join("\n")
    writeFileSync(patchPath, patch)

    const run = await runAsync("dsh", ["--profile", "mpd-headless", "Create nim.mjs from the provided content and run the deterministic self-play and position probes with bash."], { env, cwd: ws, timeout: 900000 })
    stub.close()
    const toolMsgs = stub.trace.flatMap((c) => c.toolResults)
    const writeResult = toolMsgs.find((t) => /<path>.*nim\.mjs<\/path>/.test(t) || /Created file/.test(t)) ?? ""
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
    const written = existsSync(join(ws, "nim.mjs")) ? readFileSync(join(ws, "nim.mjs"), "utf8") : ""
    steps.artifact = {
      ok: false,
      exists: written !== "",
      contentMatches: written === GAME_SRC,
      deterministic: /^DETERMINISTIC$/m.test(bashResult),
    }
    // The real result: the transcript the SESSION's bash tool produced, replayed by the oracle.
    const play = bashResult.split("--- play ---")[1]?.split("--- probes ---")[0]?.trim() ?? ""
    const verdict = play ? replay(play, [3, 4, 5]) : { problems: ["no transcript in the bash tool result"], winner: null, plies: 0 }
    const probes = {}
    for (const probe of PROBES) {
      const seg = bashResult.split("PROBE " + probe)[1]?.split("PROBE ")[0]?.trim().split("\n")[0]?.trim() ?? ""
      const m = /^move (\d+) (\d+)$/.exec(seg)
      const check = checkMove(parseState(probe), m ? [Number(m[1]), Number(m[2])] : null)
      probes[probe] = { output: seg, problems: check.problems }
    }
    steps.artifact.optimal = verdict.problems.length === 0 && Object.values(probes).every((p) => p.problems.length === 0)
    steps.artifact.ok = steps.artifact.exists && steps.artifact.contentMatches && steps.artifact.deterministic && steps.artifact.optimal
    steps.artifact.oracle = { winner: verdict.winner, plies: verdict.plies, problems: verdict.problems, probes }
    try {
      steps.isolation = { ok: true, ...assertSessionsSandboxed(dshHome, sandbox, { label: SLUG }) }
    } catch (err) {
      steps.isolation = { ok: false, error: String(err) }
    }
    return finish(steps, outDir, sandbox, run.out, run.out)
  })()
}

function finish(steps, outDir, sandbox, fullOutput, extraLog) {
  const allOk = Object.values(steps).every((s) => s.ok !== false)
  const isolation = steps.isolation ?? { ok: true, skipped: "lane aborted before the assertion" }
  steps.isolation = isolation
  const allOkFinal = allOk && isolation.ok !== false
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOkFinal, slug: SLUG, sandbox, steps }, null, 2) + "\n")
  writeFileSync(join(outDir, "output.log"), fullOutput + "\n" + (extraLog ?? "") + "\n")
  console.log("[" + SLUG + "] ok=" + allOkFinal + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 300))
  process.exit(allOkFinal ? 0 : 1)
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
