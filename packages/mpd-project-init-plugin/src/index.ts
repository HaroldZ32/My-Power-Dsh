// mpd-project-init: one-time AGENT.md scaffold for a NEW project (R3, team-gate wave).
//
// WHAT IT DOES — on the FIRST `agent/pre-step` of a TOP-LEVEL session it inspects the
// session's workspace and, only when that workspace is a fresh project carrying no
// agent-instruction file, writes ONE generic English `AGENT.md` (never overwriting),
// records `<workspace>/.mpd/project-init.json` and appends ONE line to
// `<workspace>/.mpd/logs/mpd-project-init.log`.
//
// WHAT IT NEVER DOES — it writes nothing for a subagent/member session, for HOME or the
// filesystem root, when any of AGENT.md / AGENTS.md / CLAUDE.md already exists (matched
// case-insensitively), when the marker already exists, or when the directory is not
// project-like (visible content with neither `.git` nor a project manifest). Every one
// of those is SILENT: no file, no log line, no notice to the model.
//
// BOUND, stated once and repeated in the README: the harness loads agent instructions
// when a session STARTS, so an `AGENT.md` written during this session's first pre-step
// is injected in the NEXT session. It is never retroactive.
//
// Every harness seam is reached through `mpd-dsh-adapter` (AGENTS.md §6): this file names
// no `ctx.tools` / `ctx.agents` / `ctx.*` service and resolves the workspace root through
// the adapter's ONE `workspaceRoot(exec)` helper.
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, parse, resolve } from "node:path"
import { createLazyDshAdapter, dshSeamInject } from "../../mpd-dsh-adapter-plugin/src/index"
import type { DshAdapter, DshAgentPreStep, DshPreStepDecision, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"

/** Cordis plugin id; the bundle patch mounts this row as `mpd-project-init`. */
export const name = "mpd-project-init"

// The row needs no harness SERVICE at apply time: its only delivery surface is the
// agent-scoped pre-step listener, reached through the adapter, and its only state is the
// session workspace. An empty inject list keeps the row loadable on every composition.
/** Harness services required before `apply` runs: none (the adapter resolves every seam). */
export const inject = dshSeamInject()

/** Row config, every key optional; the bundle patch mounts the row with NO config. */
export type Config = {
  /** Set `false` to disable the row on a deployment that does not want a scaffold (default `true`). */
  enabled?: boolean
}

/** Tuning seams for {@link initializeProject}; every one has a production default. */
export interface ProjectInitOptions {
  /** Home directory treated as never-a-project (default: `os.homedir()`); named so a test can sandbox it. */
  home?: string
  /** Clock for the provenance date, the marker and the log line (default: the real clock). */
  now?: () => Date
}

/** What ONE workspace inspection did, so a test and a caller can assert the branch taken. */
export interface ProjectInitResult {
  /** `created` when AGENT.md was written by this call; `skipped` for every guard. */
  status: "created" | "skipped"
  /** Machine-readable branch token: `created`, `home-or-root`, `already-initialized`, … */
  reason: string
  /** The absolute workspace root that was inspected. */
  root: string
  /** Absolute path of the written AGENT.md, present only with `status: "created"`. */
  file?: string
}

/** The install outcome, exposed so a mount lane or a unit test can assert the wiring. */
export interface ProjectInitInstall {
  /** Always true: a refused registration degrades per agent instead of failing the row. */
  installed: boolean
  /** Agent handles already evaluated; the second pre-step of one agent never re-inspects. */
  acted: Set<unknown>
  /** One disposer per agent whose scope carries this row's listener. */
  disposers: Map<unknown, () => void>
}

/** The file this row writes; the ONLY name it ever creates. */
export const AGENT_FILE = "AGENT.md"

/** Workspace-relative marker recording that this plugin already ran for the workspace. */
export const MARKER_FILE = join(".mpd", "project-init.json")

/** Workspace-relative diagnostic file receiving this row's ONE creation line. */
export const LOG_FILE = join(".mpd", "logs", "mpd-project-init.log")

/** The diagnostic/log base name, matching the `[mpd-project-init]` line prefix. */
export const LOG_NAME = "mpd-project-init"

/** Agent-instruction files whose PRESENCE cancels the scaffold (matched case-insensitively). */
export const INSTRUCTION_FILES: readonly string[] = ["AGENT.md", "AGENTS.md", "CLAUDE.md"]

/**
 * Project manifests that make a non-empty directory PROJECT-LIKE. Kept in step with the
 * `team.sensitivity` signal F list (`packages/mpd-roles-plugin/src/complexity-gate.ts`) on
 * purpose: "a project" must mean the same thing to the scaffold and to the gate.
 */
export const PROJECT_MANIFESTS: readonly string[] = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "Gemfile",
  "mix.exs",
  "pubspec.yaml",
  "CMakeLists.txt",
]

/**
 * Clamp a thrown value to printable text; the message when it carries one, else `String`.
 * @param error the thrown value, of any shape.
 * @returns printable text, never empty for a non-null value.
 */
function errorText(error: unknown): string {
  /** The value's own message, read through a one-property view because it is `unknown`. */
  const message = (error as { message?: unknown } | undefined)?.message
  return message === undefined ? String(error) : String(message)
}

/**
 * List one directory's entry names, or `undefined` when it cannot be read.
 * @param root the absolute directory to list.
 * @returns the entry names in host order, or `undefined` on any read error.
 */
function entryNames(root: string): string[] | undefined {
  try {
    return readdirSync(root)
  } catch {
    return undefined
  }
}

/**
 * Whether a directory is PROJECT-LIKE enough to receive a scaffold.
 *
 * The contract, in the order it is applied: an EMPTY or DOTFILES-ONLY directory (a brand-new
 * repository, including one that only carries `.git`) is a project being started, so it
 * qualifies. A directory with VISIBLE content qualifies only with a `.git` entry or one of
 * {@link PROJECT_MANIFESTS}; without either it is not a project (a downloads folder, a notes
 * directory) and the scaffold stays away. Case-insensitive on the manifest names so a
 * Windows checkout behaves like a Linux one.
 * @param root the absolute directory root.
 * @param entries the root's already-listed entry names.
 * @returns whether a scaffold may be written here.
 */
export function isProjectLike(root: string, entries: readonly string[]): boolean {
  /** Entries a user would SEE: everything that does not start with a dot. */
  const visible = entries.filter((entry: string): boolean => !entry.startsWith("."))
  if (visible.length === 0) return true
  /** A `.git` entry of either kind (directory or worktree file) makes the tree a repository. */
  const hasGit = entries.includes(".git") || existsSync(join(root, ".git"))
  if (hasGit) return true
  /** Lower-cased visible names, so the manifest comparison is case-insensitive. */
  const lowered = new Set(visible.map((entry: string): string => entry.toLowerCase()))
  return PROJECT_MANIFESTS.some((manifest: string): boolean => lowered.has(manifest.toLowerCase()))
}

/**
 * Whether ONE agent handle is this workspace's TOP-LEVEL session — never a subagent.
 *
 * The predicate is the §5 captain classification, re-stated here because the roster package
 * does not export it across the package boundary (AGENTS.md §6 forbids a cross-package source
 * import): a session is a CHILD iff the harness recorded `origin: "subagent"` or a
 * `delegationDepth` of `1` or more; a missing header fails CLOSED (not top-level); every
 * other session — a seeded fork with a parent link and depth 0 included — is top-level.
 * Preset names are never read here (T-92).
 * @param agent the live agent handle, opaque to this row.
 * @returns whether the session is top-level, i.e. a candidate for the scaffold.
 */
export function isTopLevelSession(agent: unknown): boolean {
  try {
    /** The agent's session header, the only place the delegation facts are recorded. */
    const header = (agent as { session?: { header?: Record<string, unknown> } } | undefined)?.session?.header
    if (header === undefined || header === null) return false
    /** A recorded subagent origin is the first delegation fact. */
    if (String(header.origin ?? "") === "subagent") return false
    /** The recorded delegation depth is the second; a non-number is not "1 or more". */
    const depth = Number(header.delegationDepth)
    return !(depth >= 1)
  } catch {
    return false
  }
}

/**
 * Render the generic English AGENT.md this row writes ONCE.
 *
 * Every claim is true of any repository, and every project-specific value is an obvious
 * `<fill in: …>` placeholder — this scaffold must never invent a command, a runtime or a
 * policy the workspace does not have. The first line is the provenance comment naming the
 * generating row and the moment of creation.
 * @param at the creation instant, used in the provenance comment.
 * @returns the complete file body, newline-terminated.
 */
export function agentScaffold(at: Date): string {
  return [
    "<!-- Generated once by mpd-project-init (my-power-dsh) on " + at.toISOString() + ".",
    "     This file is a starting point: edit it freely. The plugin never overwrites it,",
    "     and it will not create another instruction file in this workspace. -->",
    "",
    "# AGENT.md",
    "",
    "Operating instructions for any AI agent working in this repository. Replace every",
    "`<fill in: ...>` placeholder with this project's real value; never guess one.",
    "",
    "## 1. Read first",
    "",
    "- At the start of every session, read this file, then the paths it names below.",
    "- Prefer this repository's own docs, tests and build files over assumptions. When a",
    "  document and the code disagree, report the conflict instead of silently picking one.",
    "",
    "## 2. Plan before acting",
    "",
    "- State the goal in one sentence, then list the steps you will take.",
    "- Keep a todo list for any task with two or more steps, and update it as steps finish.",
    "- Surface open questions and assumptions before making a large change.",
    "",
    "## 3. Small diffs",
    "",
    "- Make the smallest change that satisfies the request; no drive-by refactors and no",
    "  reformatting of code you did not need to touch.",
    "- Match the style, naming and structure already in the tree.",
    "",
    "## 4. Commands",
    "",
    "Fill in the real commands for this project:",
    "",
    "- Install dependencies: `<fill in: e.g. bun install>`",
    "- Build: `<fill in: the build command>`",
    "- Test: `<fill in: the test command>`",
    "- Type check and lint: `<fill in: the typecheck/lint command>`",
    "- Format: `<fill in: the formatter command>`",
    "",
    "## 5. Verification",
    "",
    "- Re-run the checks that cover your change and quote the observed output.",
    "- Never edit a test or a gate to make a change pass; fix the cause or report the defect.",
    "",
    "## 6. Git discipline",
    "",
    "- Work on a branch, never directly on the main branch.",
    "- Use a commit format such as `<type>(<scope>): <summary>`.",
    "- Open a pull request describing what changed, the evidence, the checks run and any",
    "  unverified bound.",
    "- One writer per working tree; never rewrite published history.",
    "",
    "## 7. Delegation and evidence",
    "",
    "- Split large work into bounded tasks with a written contract and a separate review.",
    "- Keep requirement, implementation and review as separate records.",
    "- Record evidence (command, observed result, path) on disk; a claim without evidence is",
    "  incomplete.",
    "",
    "## 8. Security",
    "",
    "- Never commit or echo secrets, tokens or credentials.",
    "- Keep generated logs and evidence free of secret material.",
    "",
  ].join("\n")
}

/**
 * Inspect ONE workspace and, only when every guard passes, write the scaffold.
 *
 * Order matters and is part of the contract: HOME/root, then the marker, then an existing
 * instruction file, then the project-likeness test, and only then the write. The write uses
 * the `wx` flag, so an AGENT.md that appeared between the check and the write is never
 * overwritten (`EEXIST` degrades to the same silent skip). The marker and the log line are
 * written only after the file exists, and every fs failure is contained: this function is
 * called from a pre-step and must never throw into the harness.
 * @param root the workspace root to inspect (resolved to an absolute path internally).
 * @param options the home/clock seams (see {@link ProjectInitOptions}).
 * @returns the branch taken, with the written path when one was created.
 */
export function initializeProject(root: string, options: ProjectInitOptions = {}): ProjectInitResult {
  /** The absolute workspace root every path below is resolved against. */
  const absolute = resolve(root)
  /** The home directory this row never treats as a project. */
  const home = resolve(options.home ?? homedir())
  /** One instant shared by the provenance comment, the marker and the log line. */
  const at = (options.now ?? ((): Date => new Date()))()
  if (absolute === home) return { status: "skipped", reason: "home-or-root", root: absolute }
  // `parse(root).root === root` is true exactly for a filesystem root ("/", "C:\\"), never
  // for a directory inside it.
  if (parse(absolute).root === absolute) return { status: "skipped", reason: "home-or-root", root: absolute }
  /** The marker path recording a previous run. */
  const marker = join(absolute, MARKER_FILE)
  if (existsSync(marker)) return { status: "skipped", reason: "already-initialized", root: absolute }
  /** The root's entries, or undefined when the directory cannot be read (skip, never guess). */
  const entries = entryNames(absolute)
  if (entries === undefined) return { status: "skipped", reason: "unreadable", root: absolute }
  /** Lower-cased entry names, so the instruction-file check is case-insensitive. */
  const lowered = new Set(entries.map((entry: string): string => entry.toLowerCase()))
  /** The first instruction file already present, if any. */
  const existing = INSTRUCTION_FILES.find((candidate: string): boolean => lowered.has(candidate.toLowerCase()))
  if (existing !== undefined) return { status: "skipped", reason: "instructions-present", root: absolute }
  if (!isProjectLike(absolute, entries)) return { status: "skipped", reason: "not-a-project", root: absolute }
  /** The file this call may create; the only write target of the whole row. */
  const target = join(absolute, AGENT_FILE)
  try {
    // The marker's parent first: a failed directory creation must stop us before AGENT.md
    // exists, so a workspace is never left with an unmarked scaffold.
    mkdirSync(join(absolute, ".mpd"), { recursive: true })
    writeFileSync(target, agentScaffold(at), { encoding: "utf8", flag: "wx" })
  } catch (error) {
    /** A concurrent writer's `EEXIST`, or any fs refusal, is a silent skip. */
    const code = (error as { code?: unknown } | undefined)?.code
    return {
      status: "skipped",
      reason: code === "EEXIST" ? "instructions-present" : "write-failed",
      root: absolute,
    }
  }
  /** The provenance record: which row created which file, and when. */
  const record = {
    version: 1,
    plugin: LOG_NAME,
    file: AGENT_FILE,
    createdAt: at.toISOString(),
  }
  try {
    writeFileSync(marker, JSON.stringify(record, null, 2) + "\n", "utf8")
    mkdirSync(join(absolute, ".mpd", "logs"), { recursive: true })
    appendFileSync(
      join(absolute, LOG_FILE),
      "[" + LOG_NAME + "] " + at.toISOString() + " created " + AGENT_FILE + " in " + absolute + "\n",
      "utf8",
    )
  } catch {
    // The scaffold exists, which is the point; a failed marker/log write is reported by the
    // caller's own result (status stays "created") and never undoes the file.
  }
  return { status: "created", reason: "created", root: absolute, file: target }
}

/**
 * Install the row: ONE `agent/pre-step` listener per live/new agent, registered in that
 * agent's OWN scope through the adapter — the only registration site delivery reaches
 * (measured 2026-09-27, recorded in `mpd-roles-plugin/src/session-gate.ts`).
 *
 * Qualification happens INSIDE the listener, not at registration: the session header that
 * carries the delegation facts is authoritative at step time, and a header that is still
 * being populated at `agent/created` must not cost a legitimate session its scaffold. Fall
 * the classification closed, the listener simply returns `undefined` and the step continues.
 * @param dsh the adapter slice this row uses: the scoped listener, the live agents, the
 *   event bus and the ONE workspace-root resolver.
 * @param options the home/clock seams forwarded to {@link initializeProject}.
 * @returns the install outcome (the acted registry and one disposer per agent).
 */
export function installProjectInit(
  dsh: Pick<DshAdapter, "registerAgentPreStep" | "liveAgents" | "onEvent" | "workspaceRoot" | "rowLog">,
  options: ProjectInitOptions = {},
): ProjectInitInstall {
  /** Agent handles already evaluated; a second pre-step of one agent never re-inspects. */
  const acted = new Set<unknown>()
  /** One disposer per agent whose scope carries this row's listener. */
  const disposers = new Map<unknown, () => void>()

  /**
   * Tear one agent's listener down; a failed disposer must not break agent disposal.
   * @param agent the agent whose scope registration is released.
   * @returns nothing.
   */
  function release(agent: unknown): void {
    /** This agent's disposer, or undefined when it never carried a listener. */
    const dispose = disposers.get(agent)
    if (dispose === undefined) return
    disposers.delete(agent)
    try {
      dispose()
    } catch {
      // A refused teardown is not worth a warning: the listener's `acted` guard is inert.
    }
  }

  /**
   * Build the listener bound to ONE agent handle.
   *
   * The agent comes from the REGISTRATION, never from the payload (a payload may omit it),
   * and the handler always returns `undefined`: this row observes the step and never amends
   * the harness's decision.
   * @param agent the agent whose scope carries this listener.
   * @returns the `agent/pre-step` listener.
   */
  function stepHandler(agent: unknown): (payload: DshAgentPreStep, decision: DshPreStepDecision) => undefined {
    return (payload: DshAgentPreStep, decision: DshPreStepDecision): undefined => {
      // The step's own objects are unused on purpose: the row writes files under the
      // workspace and must not influence the messages or the decision.
      void payload
      void decision
      if (acted.has(agent)) return undefined
      if (!isTopLevelSession(agent)) return undefined
      acted.add(agent)
      try {
        // `workspaceRoot` reads exactly one field of the exec — the live agent — so a
        // minimal exec carrying it is the adapter's documented agent-scoped call. The cast
        // is needed because `DshToolExec`'s other fields are optional but present in its type.
        const root = dsh.workspaceRoot({ agent } as DshToolExec)
        initializeProject(root, options)
      } catch (error) {
        // A scaffold failure never breaks a step. The diagnostic goes to the ROW's own file
        // log through the adapter helper, never to a terminal (AGENTS.md §6, R5).
        try {
          dsh.rowLog(LOG_NAME, "[" + LOG_NAME + "] pre-step failed: " + errorText(error))
        } catch {
          // A logging seam that throws is dropped: nothing about this row may reach a terminal.
        }
      }
      return undefined
    }
  }

  /**
   * Register the listener for ONE agent handle, at most once per handle.
   * @param agent the live agent to scope the listener to.
   * @returns nothing.
   */
  function register(agent: unknown): void {
    if (agent === undefined || agent === null || disposers.has(agent)) return
    try {
      /** The scope's own disposer, or a no-op when the seam returned none. */
      const dispose = dsh.registerAgentPreStep(agent, stepHandler(agent))
      disposers.set(agent, typeof dispose === "function" ? dispose : (): void => {
        // A seam that returns no disposer still leaves the agent registered once.
      })
    } catch {
      // A refused scope registration degrades per agent; the boot and other sessions continue.
    }
  }

  // Already-live agents (a reload, a row applied mid-process) first, then every new one.
  for (const agent of dsh.liveAgents()) register(agent)
  /**
   * Subscribe to one agent lifecycle event, degrading silently when the bus is absent.
   * @param event the event name.
   * @param handler the payload receiver.
   * @returns nothing.
   */
  function subscribe(event: string, handler: (payload: unknown) => void): void {
    try {
      dsh.onEvent(event, handler)
    } catch {
      // A missing event bus leaves the LIVE registrations above in place.
    }
  }
  subscribe("agent/created", (payload: unknown) => register((payload as { agent?: unknown } | undefined)?.agent ?? payload))
  subscribe("agent/disposed", (payload: unknown) => release((payload as { agent?: unknown } | undefined)?.agent ?? payload))
  return { installed: true, acted, disposers }
}

/**
 * Cordis entry point: install the one-time scaffold listener.
 * @param ctx the row's cordis context (every harness seam is resolved through the adapter).
 * @param config the row config; `enabled: false` disables the row.
 * @returns nothing.
 */
export function apply(ctx: unknown, config: Config = {}): void {
  if (config.enabled === false) return
  // The LAZY adapter: this row may apply before `mpdDsh` is ACTIVE, and every use below
  // happens at pre-step time, so resolution is deferred and a transient miss is not cached.
  /** The adapter this row reaches every seam through. */
  const dsh: DshAdapter = createLazyDshAdapter(ctx, { label: LOG_NAME })
  installProjectInit(dsh)
}
