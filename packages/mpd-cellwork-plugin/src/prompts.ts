// THE ACTIVATION DIRECTIVE — the text `/cellwork` injects as the invoking agent's OWN next user turn.
//
// WHY A DIRECTIVE AT ALL: a command handler runs "without sending the command to the model", so
// returning a success status starts nothing. The command therefore submits ONE user-role message
// carrying this text (producer tag `mpd-cellwork`), which is the same seam `/ulw` uses.
//
// WHAT IT MUST ESTABLISH, and nothing more: the cell's identity, the objective, that the agent is now
// the CAPTAIN and what that costs it, the phase order with the tool that drives each phase, and how to
// leave. It deliberately does NOT restate the guard's clause-by-clause allowlist — the guard answers
// any refused call with that paragraph, so repeating it here would spend context on a list the model
// can always ask for.
//
// IT ALSO CARRIES THE PLANNER'S DELEGATION BLOCK ({@link PLANNER_RECON_LINES}, C5/D15): the prose lives
// here because this module owns the cell's words, and `staging.ts` spreads it into `plannerPrompt` so the
// instantiation prompt itself says reconnaissance is delegated — the mechanical arm is the guard's.
import { CELL_JOURNAL_FILE, CELL_REQUIREMENTS_FILE, CELL_STATE_FILE, cellDir, type CellState } from "./state"

/** The one line an empty `/cellwork` answers; it names the command and what it needs. */
export const CELLWORK_USAGE = "usage: /cellwork <objective> — starts cell-work for that objective: a dedicated "
  + "planner runs a Socratic requirements interview through you, the requirements are split into tasks whose "
  + "context cost the plugin MEASURES against the executing model's own window, and the team works, hands off, "
  + "compacts and promotes itself. `/cellwork` is the only way to start the mode."

/**
 * The planner's DELEGATION block: reconnaissance is delegated, never run by the planner itself (C5, D15).
 *
 * `staging.ts` spreads these lines into `plannerPrompt`, so the instantiation prompt says it in the
 * planner's own reading order — BEFORE it starts asking questions — while the enforcement lives in the
 * guard (`guard.ts`, the `cell-planner` arm), which refuses `read`/`grep`/`glob` on a source path and
 * answers with the same two routes.
 *
 * The block OPENS and CLOSES with an empty line so a caller can splice it between two sections without
 * owning the blank-line bookkeeping. Both delegation routes are named with their argument shapes, because
 * a prompt that says "delegate" without saying HOW teaches the planner to stall.
 */
export const PLANNER_RECON_LINES: readonly string[] = [
  "",
  "RECONNAISSANCE IS DELEGATED, NEVER RUN BY YOU: do not `read`, `grep` or `glob` the project's source",
  "yourself — the cellwork guard refuses exactly that (its refusal names the two routes below), and with",
  "reason. Your context is spent on the interview and the requirements document: a source tree read here is",
  "context the interview then lacks, while the REPORT you actually need is a hundred lines, not ten thousand.",
  "",
  "THE TWO ROUTES, both one-shot and READ-ONLY, and you consume the report rather than re-deriving it:",
  "1. `cellwork_recon` {role:\"Explorer\"|\"Researcher\", task} — the in-cell route. Its report comes straight",
  "   back to you and is journaled, and it forwards its own depth cap, so the host's nesting default never",
  "   refuses it. `Explorer` finds the file and the code; `Researcher` collects evidence and cites it.",
  "2. `mpd_role_spawn` {role:\"Explorer\"|\"Researcher\"|\"Architect\", task} — the roster route, for a",
  "   composition where the cellwork tool is not mounted. Same discipline: ONE bounded question, one report.",
  "",
  "THE BAND YOU MAY READ YOURSELF: `.mpd/**` (the cell record, the requirements file, the contracts),",
  "`docs/**`, `evidence/**`, `agent-references/**`; any `AGENT.md`, `AGENTS.md` or `CLAUDE.md` at any depth,",
  "inside this workspace or outside its root; and at the workspace root `README.md`, `README.zh-CN.md`,",
  "`CHANGELOG.md` and `LICENSE*.md`.",
  "",
]

/**
 * Build the activation directive for one freshly created cell.
 *
 * The text is deterministic from the cell record and the workspace so a test can assert on the facts it
 * must carry (the cell id, the objective, the state path) without pinning prose that will be edited.
 *
 * @param input - the cell record and the workspace root its directory lives under.
 * @returns the directive text.
 */
export function activationDirective(input: { state: CellState; workspace: string }): string {
  /** The cell record being announced. */
  const state = input.state
  /** The cell's own directory, which every later artifact lives under. */
  const dir = cellDir(input.workspace, state.cellId)
  return [
    "[mpd-cellwork] CELLWORK MODE IS ACTIVE — cell " + state.cellId,
    "",
    "The user started cell-work for this objective:",
    "  " + state.objective,
    "",
    "You are the CAPTAIN of this cell. From now on you DISPATCH ONLY: you do not edit files, run a shell,",
    "do reconnaissance or verify work. That is not advice — the cellwork guard refuses every other tool at",
    "the dispatch boundary with a message that names what you may call instead. Stage the work on the team,",
    "relay questions, and record what you learn with `mpd_memory_*`.",
    "",
    "PHASES (v1):",
    "1. requirements — `cellwork_start` stages the planner and splitter teammates and their two tasks. The",
    "   planner runs the Socratic interview: it mails you ONE question at a time, you put it to the user with",
    "   `ask_user_question`, and you mail the answer straight back. You author nothing and you answer nothing",
    "   yourself.",
    "2. split — when the requirements document is finalized, the splitter submits the task graph. The plugin",
    "   MEASURES every task (declared input bytes, the model's own window) and REFUSES an over-budget split",
    "   with a per-task breakdown that says what to cut. Nothing is guessed from a literal window.",
    "3. executing — `cellwork_activate` materialises the accepted split on the LIVE team record, writes one",
    "   frozen contract per code task and opens one verification loop per code task BEFORE dispatch. Dispatch",
    "   with `cellwork_dispatch`; ONLY the declared owner is paired, and a busy owner is reported, never",
    "   substituted.",
    "4. supervise — on every wake-up call `cellwork_status` / `cellwork_supervise`. A requirements change goes",
    "   to the planner, which bumps the revision and marks the current split STALE; the splitter re-submits.",
    "5. stop — `cellwork_stop` archives the cell and gives every tool back. Nothing is deleted.",
    "",
    "YOUR TOOLS IN THIS MODE: `cellwork_*` except `cellwork_handoff`, `agent_teams_*`, `ask_user_question`,",
    "`todo_write`, `mpd_memory_*`. Everything else is refused, and `cellwork_stop` is how you leave.",
    "",
    "STATE ON DISK (this is the record, not a suggestion): " + dir,
    "  " + CELL_STATE_FILE + " · " + CELL_JOURNAL_FILE + " · " + CELL_REQUIREMENTS_FILE,
    "",
    "FIRST STEP: call `cellwork_start` now, then wait for the planner's first question.",
  ].join("\n")
}
