#!/usr/bin/env node
// docker/lib/reply-verdict.ts — decide what a Web transcript REALLY rendered after the send.
//
// WHY THIS IS A MODULE AND NOT A REGEX IN THE LANE (2026-10-14, FINDING F1). `docker/lib/browser-lane.ts`
// recorded `ui.replyRendered = true` in a container that had rendered NO reply. Its predicate was
// `/\bDONE\b/.test(seen) || transcriptGrew`, and BOTH halves were reachable without a turn:
//
//   * `DONE` is in the prompt the lane itself types ("… then reply with exactly: DONE"), so the user's own
//     bubble satisfied it the moment it was painted;
//   * the "transcript grew" half counted the turn's FAILURE PANEL, which is growth the model never wrote.
//
// The authoritative run is the witness: `ui.replyRendered` recorded `before=225 after=619 done=true`
// while `ui-02-sent.png` and `ui-03-reply.png` are BYTE-IDENTICAL (`sha256 7264554d…bd017`) and the
// screenshot shows `This turn failed  llm-deepseek: no API key for provider route "deepseek-official";
// store DEEPSEEK_API_KEY through the MISSING_CREDENTIAL credentials service`.
//
// WHAT MAKES A REPLY, then: the region of the transcript that the lane's own prompt cannot produce, minus
// the failure panel, must carry the turn's OWN output — the answer the prompt asked for as a line of its
// own, or a rendered mention of the tool the prompt asked the model to call. Growth alone is never a
// reply, and the prompt's own `DONE` never is.
//
// THE PANEL IS READ THE SAME WAY (CodeRabbit finding on PR #42, 2026-10-15): the failure panel that
// counts is the one the CURRENT turn painted — a line whose normalized form was NOT already on screen
// before the send. Scanning the whole post-send capture let a panel the previous turn had left there end
// the lane's wait at `ui.replyRendered` and record a credential bound before the current reply rendered.
// A panel the current turn really painted still binds, and the row's `raw` names a stale one as such.
//
// THE THIRD ANSWER IS THE HONEST ONE FOR A CREDENTIAL-FREE CONTAINER: when no reply rendered AND the
// panel names the missing credential, this is a DECLARED BOUND (the lane records `null` with that
// reason), not a pass and not a bundle defect. A failure that does NOT name the credential stays red —
// the bound is a named prerequisite, never a general excuse.
//
// PURE: no I/O, no browser, no network. `node docker/lib/reply-verdict.ts --self-test` drives every arm
// offline against transcripts transcribed from the run above, including the pre-fix predicate as a
// NEGATIVE CONTROL (it must still green on the fixture this module refuses).
import { fileURLToPath } from "node:url"

/** The three answers this classifier can give about a post-send transcript. */
type ReplyKind = "reply" | "credential-bound" | "no-reply"

/** What the classifier reads: the two body-text captures and the prompt the lane typed. */
interface ReplyInput {
  /** The body text captured immediately BEFORE the send. */
  readonly before: string
  /** The body text captured after the send (the same capture the lane loops on). */
  readonly after: string
  /** The prompt the lane typed into the composer, verbatim. */
  readonly prompt: string
}

/** The classifier's verdict, with every field the lane's row needs. */
interface ReplyVerdict {
  /** `reply` (a turn output rendered), `credential-bound` (no reply, missing credential), `no-reply`. */
  readonly kind: ReplyKind
  /** Whether the reply region carries the answer the prompt asked for as the WHOLE content of a line. */
  readonly done: boolean
  /** Whether the reply region carries a rendered mention of the tool the prompt asked for. */
  readonly tool: boolean
  /** The failure panel's own text, quoted and bounded, or "" when the transcript carries no panel. */
  readonly failure: string
  /** The credential prerequisite the panel names (`MISSING_CREDENTIAL`), or "" when it names none. */
  readonly credential: string
  /** One-line witness, quoted into the row's reason. */
  readonly detail: string
  /** The row's `raw` observation: the lengths and flags the verdict was read from. */
  readonly raw: string
}

/** The shortest line that can still be a VERBATIM slice of the prompt (the bubble, or the SPA's echo). */
const ECHO_SLICE_MIN = 12
/** The shortest line judged by word coverage instead of by being a literal slice of the prompt. */
const ECHO_PARAPHRASE_MIN = 40
/** The share of a long line's words that must come from the prompt for it to count as the prompt's echo. */
const ECHO_COVERAGE = 0.8
/** The failure panel's own sentence: the GUI renders it when a turn ends in failure. */
const FAILURE_PANEL = /this turn failed/i
/** The bare section label the panel renders above its body. */
const FAILURE_LABEL = /^\s*failed\s*$/i
/** The credential prerequisite, in the spellings the harness's own panels use. */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /MISSING_CREDENTIAL/i,
  /no API key for provider route/i,
  /(?:store|set|export)\s+[A-Z0-9_]*API_KEY[\s\S]{0,80}credential/i,
]
/** The label a credential bound is reported under, which is the harness's own reason code. */
const CREDENTIAL_LABEL = "MISSING_CREDENTIAL"
/** The tool the lane's prompt asks the model to call; a rendered mention can only come from a turn. */
const TOOL_NAME = "mpd_config_get"
/** The prompt's own answer shape: `DONE` as the WHOLE content of a line, never inside a sentence. */
const STANDALONE_DONE = /^[\s\-*•]*done[.!]?$/i
/** How much of a quoted line is kept, so a reason stays one readable line. */
const QUOTE_MAX = 240

/** The line's comparable form: whitespace collapsed, lowercased, trailing ellipsis/dots stripped. */
function normalize(line: string): string {
  return line.replace(/\s+/g, " ").trim().toLowerCase().replace(/[\s.\u2026]+$/, "").trim()
}

/** The non-empty, trimmed lines of a captured body text. */
function linesOf(text: string): readonly string[] {
  return text.split("\n").map((line) => line.trim()).filter((line) => line !== "")
}

/** The word list a coverage test compares against, keeping underscores so `mpd_config_get` stays one word. */
function wordsOf(text: string): readonly string[] {
  return text.split(/[^a-z0-9_]+/).filter((word) => word !== "")
}

/**
 * Whether a transcript line is the lane's own prompt coming back.
 *
 * TWO SHAPES, and both are needed: the sent bubble carries the prompt VERBATIM, while the sidebar's
 * session entry carries a TRUNCATED echo (`Call the mpd_config_get tool …`) that is a literal slice of
 * the prompt but too short for a coverage test to be meaningful. A line is the prompt's echo when it is
 * a long-enough slice of the prompt, or when it is long enough for a paraphrase and draws most of its
 * words from the prompt. A genuine one-word reply (`DONE`) passes NEITHER test: it is too short for the
 * slice floor and far too short for the paraphrase floor, which is exactly why the prompt's own `DONE`
 * cannot be mistaken for the answer while a real answer still can.
 *
 * @param line - One trimmed transcript line.
 * @param prompt - The normalized prompt the lane typed.
 * @returns True when the line is attributable to the prompt rather than to a turn's output.
 */
function isPromptEcho(line: string, prompt: string): boolean {
  /** The line's comparable form. */
  const candidate = normalize(line)
  if (candidate === "" || prompt === "") return false
  if (candidate.length >= ECHO_SLICE_MIN && prompt.includes(candidate)) return true
  if (candidate.length < ECHO_PARAPHRASE_MIN) return false
  /** The line's words, and the prompt's own vocabulary. */
  const words = wordsOf(candidate)
  /** The words the prompt already supplies. */
  const vocabulary = new Set(wordsOf(prompt))
  /** How many of the line's words the prompt supplies. */
  const covered = words.filter((word) => vocabulary.has(word)).length
  return words.length > 0 && covered / words.length >= ECHO_COVERAGE
}

/** Whether a transcript line belongs to the turn's failure panel rather than to a reply. */
function isFailureLine(line: string): boolean {
  return FAILURE_PANEL.test(line) || FAILURE_LABEL.test(line)
}

/**
 * The transcript lines that could hold a reply: NEW since the pre-send capture, not the prompt's echo,
 * and not the failure panel.
 *
 * @param before - The pre-send body text.
 * @param after - The post-send body text.
 * @param prompt - The prompt the lane typed.
 * @returns The reply region, in page order.
 */
function replyRegion(before: string, after: string, prompt: string): readonly string[] {
  /** The prompt in comparable form, computed once. */
  const promptNormalized = normalize(prompt)
  /** The comparable form of every line already on screen before the send. */
  const alreadySeen = new Set(linesOf(before).map((line) => normalize(line)))
  return linesOf(after).filter((line) => {
    /** The line's comparable form. */
    const key = normalize(line)
    if (key === "" || alreadySeen.has(key)) return false
    if (isPromptEcho(line, promptNormalized)) return false
    if (isFailureLine(line)) return false
    return true
  })
}

/**
 * The failure panel's own text that is NEW since the pre-send capture, or "" when the post-send capture
 * carries none.
 *
 * THE PRE-SEND SUBTRACTION IS LOAD-BEARING (CodeRabbit finding on PR #42, 2026-10-15). Scanning every
 * post-send line read a panel the PREVIOUS turn had left on screen as if the current turn had just
 * painted it, so a stale panel terminated the lane's wait at `ui.replyRendered` and recorded a
 * `credential-bound` row before the current reply could render. A line is the current turn's only when
 * its normalized form is NOT already in the pre-send capture — the same subtraction `replyRegion` does,
 * which keeps this module's two judgements consistent.
 *
 * @param before - The pre-send body text (the capture the stale panel would already be in).
 * @param after - The post-send body text.
 * @returns The new panel's sentence (preferred, because it names the cause), else its bare label, else "".
 */
function failureText(before: string, after: string): string {
  /** The comparable form of every line already on screen before the send. */
  const alreadySeen = new Set(linesOf(before).map((line) => normalize(line)))
  /** The post-send lines the current turn really added. */
  const fresh = linesOf(after).filter((line) => !alreadySeen.has(normalize(line)))
  /** The panel's sentence, preferred because it names the cause. */
  const body = fresh.find((line) => FAILURE_PANEL.test(line))
  if (body !== undefined) return body.slice(0, QUOTE_MAX)
  /** The bare section label, used only when the sentence is absent. */
  const label = fresh.find((line) => FAILURE_LABEL.test(line))
  return label === undefined ? "" : label.slice(0, QUOTE_MAX)
}

/** The credential prerequisite a failure text names, or "" when it names none. */
function credentialOf(failure: string): string {
  return failure !== "" && CREDENTIAL_PATTERNS.some((pattern) => pattern.test(failure)) ? CREDENTIAL_LABEL : ""
}

/** The first reply-region line that is the prompt's own answer shape, or undefined. */
function doneLine(region: readonly string[]): string | undefined {
  return region.find((line) => STANDALONE_DONE.test(line))
}

/** The first reply-region line that renders the tool the prompt asked for, or undefined. */
function toolLine(region: readonly string[]): string | undefined {
  return region.find((line) => line.includes(TOOL_NAME))
}

/**
 * Judge a post-send transcript.
 *
 * Precedence is deliberate: a rendered reply WINS over a panel (a turn that failed after rendering
 * something did render it), a credential bound is reported ONLY when nothing rendered, and every other
 * silent transcript stays `no-reply` so the lane can redden on it.
 *
 * @param input - The pre-send text, the post-send text and the prompt.
 * @returns The verdict, with the flags, the quoted panel and the row's `raw` observation.
 */
function judgeReply(input: ReplyInput): ReplyVerdict {
  /** The lines that could hold a reply. */
  const region = replyRegion(input.before, input.after, input.prompt)
  /** The prompt's own answer, when a line of the reply region carries it. */
  const answer = doneLine(region)
  /** The rendered tool mention, when the reply region carries one. */
  const tool = toolLine(region)
  /** The failure panel's text the CURRENT turn added, or "". */
  const failure = failureText(input.before, input.after)
  /** The panel already on screen before the send, which is stale and binds nothing. */
  const stale = failureText("", input.before)
  /** The credential label the panel names, or "". */
  const credential = credentialOf(failure)
  /** The row's `raw` observation. */
  const raw = `before=${input.before.length} after=${input.after.length} growth=${input.after.length - input.before.length} done=${answer !== undefined} tool=${tool !== undefined} region=${region.length} failure=${failure === "" ? "none" : "yes"} staleFailure=${stale === "" ? "none" : "yes"}`
  if (answer !== undefined) {
    return { kind: "reply", done: true, tool: tool !== undefined, failure, credential, raw, detail: `the reply region carries the answer as its own line: ${JSON.stringify(answer)}` }
  }
  if (tool !== undefined) {
    return { kind: "reply", done: false, tool: true, failure, credential, raw, detail: `the reply region renders the tool the prompt asked for: ${JSON.stringify(tool.slice(0, QUOTE_MAX))}` }
  }
  if (credential !== "") {
    return { kind: "credential-bound", done: false, tool: false, failure, credential, raw, detail: `no reply rendered; the turn's own panel names the missing credential: ${JSON.stringify(failure)}` }
  }
  /** Why nothing rendered: a non-credential failure, or growth that carried no turn output at all. */
  const why = failure === ""
    ? `the transcript grew by ${input.after.length - input.before.length} chars without a reply line and without a NEW failure panel${stale === "" ? "" : " (a failure panel was already on screen before the send and is stale, so it bound nothing)"}`
    : `the turn failed for a reason that is NOT the missing credential: ${JSON.stringify(failure)}`
  return { kind: "no-reply", done: false, tool: false, failure, credential, raw, detail: why }
}

/** The PRE-FIX predicate, kept verbatim as the self-test's negative control. */
function preFixPredicate(before: string, after: string): boolean {
  return /\bDONE\b/.test(after) || after.length > before.length + 40
}

// ── the self-test: every arm offline, against transcripts from the authoritative run ─────────────
//
// THE FIXTURES ARE TRANSCRIPTIONS, NOT BYTE-EXACT CAPTURES: every line below was read off
// `evidence/docker/client-install/2026-10-14T13-51-46Z/ui-shots/ui-03-reply.png` (and the run's own
// record, `before=225 after=619 done=true`), and the arms assert the SHAPES the classifier keys on,
// never a character count. A future run's chrome will differ; that is why nothing here tests lengths.

/** The landing page as the run's pre-send capture holds it (the run measured `before=225` chars). */
const BEFORE_SEND = [
  "deepseek harness",
  "New Session",
  "Plugins",
  "Workspaces",
  "ws",
  "Settings",
  "Describe what you want to build, / commands, @ files or sessions",
].join("\n")

/** The prompt, byte-identical to the lane's `PROMPT`. */
const PROMPT_TEXT = "Call the mpd_config_get tool once (it takes no arguments), then reply with exactly: DONE"

/** The user's own bubble, as the GUI paints it: the prompt on ONE line. */
const PROMPT_BUBBLE = PROMPT_TEXT

/** The sidebar's session entry: the SPA's own TRUNCATED echo of the prompt. */
const SIDEBAR_ECHO = "Call the mpd_config_get tool …"

/** The chrome the open-session view adds, transcribed from `ui-03-reply.png`: no reply among it. */
const CHROME = ["Agent Team", "Standard mode", "Chat", "Trajectory", "13:54", "Workspace Write", "Message or run a task, / commands, @ files or sessions", "1 turns 1 steps"]

/** The failure panel of the credential-free run, transcribed from `ui-03-reply.png`. */
const FAILURE_LINES = [
  "Failed",
  'This turn failed llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the MISSING_CREDENTIAL credentials service (the web Models page writes it), or export DEEPSEEK_API_KEY in the launching environment',
]

/** A non-credential failure panel, as the control for the declared bound. */
const OTHER_FAILURE_LINES = ["Failed", "This turn failed llm-deepseek: MALFORMED_RESPONSE after 3 attempts"]

/** Join page blocks into one body-text capture. */
function page(...blocks: readonly (readonly string[])[]): string {
  return blocks.flat().join("\n")
}

/** One self-test arm: its name, what it feeds the classifier, and what it requires back. */
interface Arm {
  /** The arm's name, printed as `[reply-verdict] <NAME>=true|false`. */
  readonly name: string
  /** The classifier's input for this arm. */
  readonly input: ReplyInput
  /** The kind this arm requires. */
  readonly expect: ReplyKind
  /** Whether this arm requires a standalone answer line. */
  readonly expectDone: boolean
  /** Whether this arm requires a rendered tool mention. */
  readonly expectTool: boolean
}

/** Build one arm from an input and its expectations. */
function arm(name: string, input: ReplyInput, expect: ReplyKind, expectDone: boolean, expectTool: boolean): Arm {
  return { name, input, expect, expectDone, expectTool }
}

/** Run the self-test and return the process exit code (0 pass, 1 any arm failed). */
function selfTest(): number {
  /** The credential-free transcript: the prompt echo plus the failure panel, and NOTHING else. */
  const credentialFree = page([PROMPT_BUBBLE, SIDEBAR_ECHO], CHROME, FAILURE_LINES)
  /** The transcript that carries the prompt's own `DONE` and nothing else — the reported false green. */
  const promptEchoOnly = page([PROMPT_BUBBLE], CHROME)
  /** One arm per rule this module claims to enforce. */
  const arms: readonly Arm[] = [
    arm("credential-free-transcript-is-a-bound", { before: BEFORE_SEND, after: credentialFree, prompt: PROMPT_TEXT }, "credential-bound", false, false),
    arm("prompt-own-done-is-not-a-reply", { before: BEFORE_SEND, after: promptEchoOnly, prompt: PROMPT_TEXT }, "no-reply", false, false),
    arm("sidebar-echo-is-not-a-tool-render", { before: BEFORE_SEND, after: page([SIDEBAR_ECHO], CHROME), prompt: PROMPT_TEXT }, "no-reply", false, false),
    arm("growth-alone-is-not-a-reply", { before: BEFORE_SEND, after: page([PROMPT_BUBBLE], CHROME, ["some other sentence the prompt never contained"]), prompt: PROMPT_TEXT }, "no-reply", false, false),
    arm("standalone-done-is-a-reply", { before: BEFORE_SEND, after: page([PROMPT_BUBBLE], CHROME, ["DONE"]), prompt: PROMPT_TEXT }, "reply", true, false),
    arm("tool-render-is-a-reply", { before: BEFORE_SEND, after: page([PROMPT_BUBBLE], CHROME, ['mpd_config_get {} → {"ok":true}']), prompt: PROMPT_TEXT }, "reply", false, true),
    arm("other-failure-is-not-a-bound", { before: BEFORE_SEND, after: page([PROMPT_BUBBLE], CHROME, OTHER_FAILURE_LINES), prompt: PROMPT_TEXT }, "no-reply", false, false),
    arm("a-pre-send-done-is-not-new", { before: page([BEFORE_SEND], ["DONE"]), after: page([BEFORE_SEND], ["DONE"], [PROMPT_BUBBLE]), prompt: PROMPT_TEXT }, "no-reply", false, false),
    arm("reply-wins-over-a-panel", { before: BEFORE_SEND, after: page([PROMPT_BUBBLE], FAILURE_LINES, ["DONE"]), prompt: PROMPT_TEXT }, "reply", true, false),
    // THE PRE-SEND SUBTRACTION'S TWO ARMS (CodeRabbit finding on PR #42). The pair is deliberate: the
    // first is the defect the subtraction repairs (a STALE panel must bind nothing), the second is the
    // behaviour the subtraction must NOT lose (a panel the current turn painted still binds).
    arm("stale-failure-line-alone-does-not-bind", { before: page([BEFORE_SEND], FAILURE_LINES), after: page([BEFORE_SEND], FAILURE_LINES, [PROMPT_BUBBLE]), prompt: PROMPT_TEXT }, "no-reply", false, false),
    arm("new-failure-line-does-bind", { before: BEFORE_SEND, after: page([PROMPT_BUBBLE], FAILURE_LINES), prompt: PROMPT_TEXT }, "credential-bound", false, false),
  ]
  /** How many arms disagreed with their expectation. */
  let failed = 0
  for (const entry of arms) {
    /** This arm's verdict. */
    const verdict = judgeReply(entry.input)
    /** Whether this arm's verdict matches what it requires. */
    const ok = verdict.kind === entry.expect && verdict.done === entry.expectDone && verdict.tool === entry.expectTool
    if (!ok) failed++
    console.log(`[reply-verdict] ${entry.name}=${ok}`)
    console.log(`[reply-verdict]   kind=${verdict.kind} expected=${entry.expect} ${verdict.raw} preFixWouldGreen=${preFixPredicate(entry.input.before, entry.input.after)}`)
    console.log(`[reply-verdict]   detail=${verdict.detail}`)
  }
  // THE NEGATIVE CONTROL OF THE WHOLE MODULE: the PRE-FIX predicate must STILL green on both transcripts
  // this module refuses. If it ever stops doing so, the fixture no longer reproduces the reported defect
  // and every arm above is measuring something else.
  /** Whether the pre-fix predicate greens on the credential-free fixture (it must). */
  const preFixGreensOnBound = preFixPredicate(BEFORE_SEND, credentialFree)
  /** Whether the pre-fix predicate greens on the prompt-echo-only fixture (it must). */
  const preFixGreensOnEcho = preFixPredicate(BEFORE_SEND, promptEchoOnly)
  console.log(`[reply-verdict] PRE_FIX_GREENS_ON_CREDENTIAL_FREE_FIXTURE=${preFixGreensOnBound}`)
  console.log(`[reply-verdict] PRE_FIX_GREENS_ON_PROMPT_ECHO_ONLY=${preFixGreensOnEcho}`)
  console.log(`[reply-verdict] ARMS=${arms.length} PASSED=${arms.length - failed} FAILED=${failed}`)
  if (!preFixGreensOnBound || !preFixGreensOnEcho) {
    console.log("[reply-verdict] FAIL: the fixtures no longer reproduce the reported false green, so the arms above prove nothing")
    return 1
  }
  return failed === 0 ? 0 : 1
}

/** The CLI body runs only for the direct invocation, never when the lane imports the pure functions. */
const CLI = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (CLI && process.argv.includes("--self-test")) process.exit(selfTest())
if (CLI) {
  console.error("usage: node docker/lib/reply-verdict.ts --self-test")
  process.exit(2)
}

export { judgeReply }
export type { ReplyInput, ReplyKind, ReplyVerdict }

