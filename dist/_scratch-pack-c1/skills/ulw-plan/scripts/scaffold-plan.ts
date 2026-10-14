#!/usr/bin/env node
// scaffold-plan.ts - generate the ulw-plan draft + plan skeleton deterministically.
//
// Zero external dependencies (node:fs/path/process/url builtins only) so it runs
// byte-identically under `node` and `bun` on macOS, Linux, and Windows with no uv
// bootstrap, no npm/pip install, and no POSIX-shell or python3 precondition - the
// two things genuinely not guaranteed on native Windows across harnesses.
//
// Usage:  node "<skill-root>/scripts/scaffold-plan.ts" <slug> [--clear|--unclear] [--draft-only] [--review-required] [--reset [--force]]
//
// RESUME-SAFE: run it ONCE at plan generation. A plain re-run on an existing
// ulw-plan artifact is a NO-OP success (it never overwrites your appended todos),
// so a model resuming after compaction cannot crash the turn or clobber the plan.
// Destructive overwrite is reserved behind --reset, and --reset refuses to discard
// a hand-edited file unless --force is also passed.
//
// WRITE BOUNDARY: the prometheus-md-only hook gates Write/Edit but NOT Bash, so
// this node:fs script writes out of band of that hook. It self-guards THIS script's
// own writes to resolve under .mpd/ (it does not, and cannot, contain other Bash
// commands; it only guarantees the mandated generator never escapes .mpd). Mirrors the upstream prometheus path-policy (see README provenance).

import { lstat, mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

/** One guarded write's outcome: where it landed and what happened to it. */
interface WriteResult {
	/** The workspace-relative artifact path that was written (or deliberately left untouched). */
	relPath: string;
	/** `created` (new file), `reset` (overwritten), or `exists` (a re-run left the artifact alone). */
	status: "created" | "reset" | "exists";
}

/** The parsed command line: the artifact slug plus every flag this generator understands. */
interface PlanArgs {
	/** The artifact slug, which is also the plan/draft file name. */
	slug: string;
	/** The recorded intent verdict (`clear`, `unclear`, or `unspecified` when no flag was passed). */
	intent: string;
	/** Whether `--reset` was passed: overwrite an existing artifact instead of treating it as a no-op. */
	reset: boolean;
	/** Whether `--force` was passed: with `--reset`, discard hand edits instead of refusing. */
	force: boolean;
	/** Whether `--draft-only` was passed: stop after the draft, before the plan skeleton. */
	draftOnly: boolean;
	/** Whether `--review-required` was passed: record the pending review request in the draft. */
	reviewRequired: boolean;
}

/** The inputs of `scaffold`: the parsed args funneled into one object. */
interface ScaffoldOptions {
	/** The artifact slug, which is also the plan/draft file name. */
	slug: string;
	/** The recorded intent verdict (`clear`, `unclear`, or `unspecified`). */
	intent: string;
	/** Overwrite an existing artifact instead of treating the re-run as a no-op. */
	reset?: boolean;
	/** With `reset`, discard hand edits instead of refusing to overwrite them. */
	force?: boolean;
	/** Create only the draft, and skip the plan skeleton. */
	draftOnly?: boolean;
	/** Record the pending review request in the draft frontmatter. */
	reviewRequired?: boolean;
}

/** Whether a filesystem error means "the path does not exist" - a normal, non-fatal outcome here. */
function isMissing(error: unknown): boolean {
	// A cast is used because `code` is read off a value that has no static shape.
	return error !== null && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT";
}

// The canonical AI-plan section headers, in order. references/full-workflow.md
// documents this exact list; a build-time test asserts the two never drift.
export const PLAN_SECTION_HEADERS: readonly string[] = [
	"## TL;DR (For humans)",
	"## Scope",
	"## Verification strategy",
	"## Execution strategy",
	"## Todos",
	"## Final verification wave",
	"## Commit strategy",
	"## Success criteria",
];

/** The final-verification rows every generated plan must carry, in the order they are listed. */
export const FINAL_VERIFICATION_ITEMS: readonly string[] = [
	"F1. Plan compliance audit",
	"F2. Code quality review",
	"F3. Real manual QA",
	"F4. Scope fidelity",
];

/** The only slug shape a plan artifact may carry: lowercase letters, digits and hyphens. */
const SLUG_PATTERN: RegExp = /^[a-z0-9][a-z0-9-]{0,79}$/;

/**
 * Parse the command line into a slug plus the intent/review/reset flags.
 *
 * @param argv - The raw `process.argv` (the first two entries are the executable and this script).
 * @returns The parsed slug and flags.
 * @throws When the slug is missing, malformed, or an unknown flag/extra argument is passed.
 */
export function parseArgs(argv: readonly string[]): PlanArgs {
	// Everything after `node <script>`: the slug plus flags, in the caller's order.
	const rest = argv.slice(2);
	// The artifact slug; the first non-flag argument wins, a second one is an error.
	let slug: string | undefined;
	// The intent verdict as recorded in the draft frontmatter; `unspecified` until a flag says otherwise.
	let intent = "unspecified";
	// Whether `--force` was passed (only meaningful together with `--reset`).
	let force = false;
	// Whether `--reset` was passed (destructive: overwrites an existing artifact).
	let reset = false;
	// Whether `--draft-only` was passed (the plan skeleton is skipped).
	let draftOnly = false;
	// Whether `--review-required` was passed (the draft carries the pending review request).
	let reviewRequired = false;
	for (const arg of rest) {
		if (arg === "--clear") intent = "clear";
		else if (arg === "--unclear") intent = "unclear";
		else if (arg === "--reset") reset = true;
		else if (arg === "--force") force = true;
		else if (arg === "--draft-only") draftOnly = true;
		else if (arg === "--review-required") reviewRequired = true;
		else if (arg.startsWith("--")) throw new Error(`unknown flag: ${arg}`);
		else if (slug === undefined) slug = arg;
		else throw new Error(`unexpected argument: ${arg}`);
	}
	if (!slug) throw new Error('usage: scaffold-plan.ts <slug> [--clear|--unclear] [--draft-only] [--review-required] [--reset [--force]]');
	if (!SLUG_PATTERN.test(slug)) {
		throw new Error(`invalid slug "${slug}" - use lowercase letters, digits, and hyphens only`);
	}
	return { slug, intent, reset, force, draftOnly, reviewRequired };
}

// Resolve a project-relative path and confine it under .mpd/ - the script's own
// enforcement of the prometheus planner write boundary.
/**
 * Resolve a project-relative path and confine it under `.mpd/`.
 *
 * @param cwd - The workspace root the write is measured against.
 * @param relPath - The project-relative artifact path the caller wants to write.
 * @returns The resolved absolute path.
 * @throws When the path escapes the workspace, leaves `.mpd/`, or is not a `.md` file.
 */
export function resolveSafePath(cwd: string, relPath: string): string {
	// The absolute path the caller asked for, before any boundary check.
	const resolved = resolve(cwd, relPath);
	// The same path relative to the workspace root: `..` is what an escape looks like from here.
	const rel = relative(cwd, resolved);
	if (rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(`refused: path escapes the workspace root: ${relPath}`);
	}
	if (!/(^|[/\\])\.mpd([/\\]|$)/i.test(rel)) {
		throw new Error(`refused: ulw-plan may only write under .mpd/: ${relPath}`);
	}
	if (!resolved.toLowerCase().endsWith(".md")) {
		throw new Error(`refused: ulw-plan may only write .md files: ${relPath}`);
	}
	return resolved;
}

/**
 * Assert that `child` resolves inside `parent`.
 *
 * @param parent - The boundary directory (already resolved).
 * @param child - The path that must stay inside it.
 * @param message - The refusal message thrown when it does not.
 */
function assertContainedPath(parent: string, child: string, message: string): void {
	// The candidate's path relative to its boundary; a leading `..` is the escape signature.
	const rel = relative(parent, child);
	if (rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(message);
	}
}

/**
 * Create a directory tree without ever traversing a symlink (each component is `lstat`-ed first).
 *
 * @param dir - The directory to create.
 * @param stopAt - The boundary directory that must never be replaced by a symlink.
 * @throws When a component is a symlink, is not a directory, or the walk leaves the boundary.
 */
async function mkdirWithoutSymlinks(dir: string, stopAt: string): Promise<void> {
	if (dir === stopAt) return;
	// The parent that must exist (and be symlink-free) before this component can be created.
	const parent = dirname(dir);
	if (parent === dir || relative(stopAt, dir).startsWith("..") || isAbsolute(relative(stopAt, dir))) {
		throw new Error(`refused: path escapes the workspace root: ${dir}`);
	}
	await mkdirWithoutSymlinks(parent, stopAt);
	// The component's own lstat: `null` means it does not exist yet, so it is created below.
	const stat = await lstat(dir).catch((err: unknown) => {
		if (isMissing(err)) return null;
		throw err;
	});
	if (stat) {
		if (stat.isSymbolicLink()) {
			throw new Error(`refused: path component is a symlink: ${dir}`);
		}
		if (!stat.isDirectory()) {
			throw new Error(`refused: path component is not a directory: ${dir}`);
		}
		return;
	}
	await mkdir(dir);
}

/**
 * Assert that a write target's PARENT directory is safe: inside the workspace, inside `.mpd/`, and
 * inside both of them again after symlinks are resolved.
 *
 * @param cwd - The workspace root the write is measured against.
 * @param target - The absolute artifact path about to be written.
 * @throws When any containment check fails.
 */
async function assertSafeWriteParent(cwd: string, target: string): Promise<void> {
	// The workspace root with every symlink already resolved (the real-path boundary).
	const workspaceReal = await realpath(cwd);
	// The workspace root as spelled, used for the lexical containment checks.
	const workspaceRoot = resolve(cwd);
	// The `.mpd/` state root the plan artifacts must stay under.
	const mpdRoot = resolve(cwd, ".mpd");
	// The directory that must already exist (and be safe) before the artifact is written.
	const parent = dirname(target);
	assertContainedPath(workspaceRoot, parent, `refused: path escapes the workspace root: ${target}`);
	assertContainedPath(mpdRoot, parent, `refused: ulw-plan may only write under .mpd/: ${target}`);
	await mkdirWithoutSymlinks(parent, workspaceRoot);
	// The same boundaries after resolution, which is what catches a symlinked component.
	const mpdReal = await realpath(mpdRoot);
	// The target's parent, with symlinks resolved, for the real-path checks below.
	const parentReal = await realpath(parent);
	assertContainedPath(workspaceReal, parentReal, `refused: path escapes the workspace root through symlinks: ${target}`);
	assertContainedPath(mpdReal, parentReal, `refused: ulw-plan may only write under .mpd/ through real paths: ${target}`);
}

/**
 * Refuse to write through a symlink: the artifact itself must not be a link to somewhere else.
 *
 * @param target - The absolute artifact path about to be written.
 * @throws When the target exists and is a symbolic link.
 */
async function assertSafeWriteTarget(target: string): Promise<void> {
	// The target's own lstat: `null` means "does not exist yet", which is always safe to create.
	const stat = await lstat(target).catch((err: unknown) => {
		if (isMissing(err)) return null;
		throw err;
	});
	if (stat?.isSymbolicLink()) {
		throw new Error(`refused: target is a symlink: ${target}`);
	}
}

// A file this script previously emitted (plan skeleton or draft), used to make a
// plain re-run a safe no-op instead of a crash or a clobber.
/**
 * Whether an existing file is one this generator emitted (a plan skeleton or a draft).
 *
 * @param content - The file's current text.
 * @returns True when the content carries the emitted artifact's own markers.
 */
export function isUlwArtifact(content: string): boolean {
	// The plan skeleton's two defining markers (top and bottom sections).
	const isPlan = content.includes("## TL;DR (For humans)") && content.includes("## Final verification wave");
	// The draft's two defining markers (its title and its approval gate).
	const isDraft = content.includes("# Draft:") && content.includes("## Approval gate");
	return isPlan || isDraft;
}

/**
 * Build the durable draft: the compaction-safe resume point, written before any plan exists.
 *
 * @param slug - The artifact slug (also the plan file name).
 * @param intent - The intent verdict recorded in the frontmatter (`clear` / `unclear` / `unspecified`).
 * @param options - `reviewRequired` additionally records the pending review request.
 * @returns The complete draft file content.
 */
export function buildDraft(slug: string, intent: string, { reviewRequired = false }: { reviewRequired?: boolean } = {}): string {
	// The intent-specific note recorded under "Open assumptions".
	const assumptionsNote =
		intent === "unclear"
			? "Intent is UNCLEAR: research resolves ambiguity, defaults are adopted (not asked), and each is surfaced in the plan's human TL;DR for veto."
			: "Record any default you adopt instead of asking, so the user can veto it at the gate.";
	// The review block of the frontmatter: the full pending-review record, or the no-review form.
	const reviewState = reviewRequired
		? `review_required: true
plan_path: .mpd/plans/${slug}.md
plan_sha256: null
review_round_id: null
pending-action: write and review .mpd/plans/${slug}.md
review:
  momus:
    status: pending
    workspace_root: null
    runtime_home: null
    target: .mpd/plans/${slug}.md
    round_id: null
    plan_sha256: null
    launch_id: null
    session: null
    result: null
  independent:
    status: pending
    workspace_root: null
    runtime_home: null
    target: .mpd/plans/${slug}.md
    round_id: null
    plan_sha256: null
    launch_id: null
    session: null
    result: null`
		: `review_required: false
pending-action: write .mpd/plans/${slug}.md`;
	return `---
slug: ${slug}
status: drafting
intent: ${intent}
${reviewState}
approach: <fill: the approach you intend to plan>
---

# Draft: ${slug}

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->

## Open assumptions (announced defaults)
<!-- ${assumptionsNote} -->
<!-- assumption | adopted default | rationale | reversible? -->

## Findings (cited - path:lines)

## Decisions (with rationale)

## Scope IN

## Scope OUT (Must NOT have)

## Open questions

## Approval gate
status: drafting
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
`;
}

/**
 * Build the plan skeleton that task batches are APPENDED into after approval.
 *
 * @param slug - The artifact slug, which titles the plan.
 * @param intent - The intent verdict, which selects the TL;DR decisions line.
 * @returns The complete plan skeleton content.
 */
export function buildPlanSkeleton(slug: string, intent: string): string {
	// The intent-specific decisions line of the human TL;DR.
	const decisionsLine =
		intent === "unclear"
			? "**Decisions I made for you:** <fill last - the best-practice defaults you adopted; the user vetoes any here>"
			: "**Decisions to sanity-check:** <fill last - the few choices worth a human glance>";
	return `# ${slug} - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**What you'll get:** <fill last - deliverables in human terms, 1-2 sentences>

**Why this approach:** <fill last - the one or two load-bearing decisions and why>

**What it will NOT do:** <fill last - 1-3 plain lines mirroring Must NOT have>

**Effort:** <Quick | Short | Medium | Large | XL>
**Risk:** <Low | Medium | High> - <one-line driver>
${decisionsLine}

Your next move: <fill - e.g. approve, or run a high-accuracy review>. Full execution detail follows below.

---

> TL;DR (machine): <1 line - effort, risk, deliverables>

## Scope
### Must have
### Must NOT have (guardrails, anti-slop, scope boundaries)

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: <TDD | tests-after | none> + framework
- Evidence: <attemptDir>/task-<N>-${slug}.<ext> (attemptDir = currentAttemptDir from 'mpd-agent-toolkit ulw-loop status --json', .mpd/evidence/ulw/<session>/<goalId>/a<attempt>; outside ulw-loop use .mpd/evidence/)

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [ ] 1. <title>
  What to do / Must NOT do: <...>
  Parallelization: Wave <N> | Blocked by: <...> | Blocks: <...>
  References (executor has NO interview context - be exhaustive): <src/path:lines>
  Acceptance criteria (agent-executable): <exact command or assertion>
  QA scenarios (name the exact tool + invocation): happy + failure, Evidence <attemptDir>/task-1-${slug}.<ext>
  Commit: <Y/N> | <type>(<scope>): <summary>

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
${FINAL_VERIFICATION_ITEMS.map((item) => `- [ ] ${item}`).join("\n")}

## Commit strategy

## Success criteria
`;
}

// Resume-safe write: plain re-run on an existing ulw-plan artifact is a no-op
// success; --reset overwrites but refuses to discard a hand-edited file unless
// --force is also passed.
/**
 * Write one artifact with every guard applied: path boundary, symlink refusal, and the resume-safe
 * no-op/`--reset`/`--force` contract.
 *
 * @param cwd - The workspace root the write is measured against.
 * @param relPath - The project-relative artifact path to write.
 * @param content - The content to write when the guards allow it.
 * @param options - `reset` overwrites an existing artifact; `force` additionally discards hand edits.
 * @returns The artifact's relative path and what happened to it.
 * @throws When the path is unsafe, or the existing file is neither a ulw-plan artifact nor (with
 *   `--reset --force`) an acceptable loss.
 */
export async function writeGuarded(cwd: string, relPath: string, content: string, { reset = false, force = false }: { reset?: boolean; force?: boolean } = {}): Promise<WriteResult> {
	// The resolved, boundary-checked absolute path this write will target.
	const target = resolveSafePath(cwd, relPath);
	await assertSafeWriteParent(cwd, target);
	await assertSafeWriteTarget(target);
	// The file's current text, or `null` when it does not exist yet (the normal first run).
	const existing = await readFile(target, "utf8").catch(() => null);
	if (existing && existing.trim() !== "") {
		if (!reset) {
			if (isUlwArtifact(existing)) return { relPath, status: "exists" };
			throw new Error(`refused: ${relPath} exists and is not a ulw-plan artifact (pass --reset to overwrite)`);
		}
		if (existing.trim() !== content.trim() && !force) {
			throw new Error(`refused: ${relPath} has edits that differ from a fresh skeleton; pass --reset --force to discard them`);
		}
	}
	await writeFile(target, content, "utf8");
	// A re-run over an existing artifact reports `reset`; a first write reports `created`.
	const status: "created" | "reset" = existing ? "reset" : "created";
	return { relPath, status };
}

/**
 * Generate the requested artifacts (draft, and the plan skeleton unless `--draft-only`).
 *
 * @param cwd - The workspace root the writes are measured against.
 * @param options - The slug, intent verdict and the reset/force/draft-only/review flags.
 * @returns One result per artifact, draft first.
 */
export async function scaffold(cwd: string, { slug, intent, reset = false, force = false, draftOnly = false, reviewRequired = false }: ScaffoldOptions): Promise<WriteResult[]> {
	// The draft's workspace-relative path (the compaction-safe resume point).
	const draftRel = join(".mpd", "drafts", `${slug}.md`);
	// The draft write's outcome.
	const draft = await writeGuarded(cwd, draftRel, buildDraft(slug, intent, { reviewRequired }), { reset, force });
	if (draftOnly) return [draft];
	// The plan skeleton's workspace-relative path.
	const planRel = join(".mpd", "plans", `${slug}.md`);
	// The plan write's outcome.
	const plan = await writeGuarded(cwd, planRel, buildPlanSkeleton(slug, intent), { reset, force });
	return [draft, plan];
}

/** The CLI entry point: parse the args, generate the artifacts, and print the next action. */
async function main(): Promise<void> {
	// The parsed slug and flags for this invocation.
	const { slug, intent, reset, force, draftOnly, reviewRequired } = parseArgs(process.argv);
	// The write outcomes, draft first (the plan is absent under `--draft-only`).
	const results = await scaffold(process.cwd(), { slug, intent, reset, force, draftOnly, reviewRequired });
	for (const r of results) process.stdout.write(`${r.status}: ${r.relPath}\n`);
	// Whether anything was written; a pure no-op re-run reports the "left untouched" instruction.
	const created = results.some((r) => r.status !== "exists");
	process.stdout.write(
		draftOnly
			? `next: record intent, findings, decisions, review state, and the approval gate in the draft; create the plan only after approval.\n`
			: created
			? `next: record findings/decisions in the draft, then APPEND task batches into the "## Todos" region of the plan; fill "## TL;DR (For humans)" LAST.\n`
			: `skeleton already present - left untouched. APPEND task batches into the "## Todos" region; the human "## TL;DR (For humans)" stays on top.\n`,
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main().catch((err: unknown) => {
		process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(1);
	});
}
