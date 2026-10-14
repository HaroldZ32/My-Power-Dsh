#!/usr/bin/env bun
// verify-lsp.ts <file> [--timeout=ms] — perform a real LSP diagnostics roundtrip
// for <file> through the lsp-tools-mcp engine and report ok/fail with error text.
// The engine source is located by walking up from this script and the cwd, so
// run it inside the upstream checkout/worktree (where the LSP engine source exists).

import { existsSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

/** Repository-relative path of the engine's tools module, located by walking up from this script and the cwd. */
const ENGINE_TOOLS = "packages/lsp-tools-mcp/src/tools.ts"
/** Repository-relative path of the request-context module the engine expects callers to run inside. */
const ENGINE_CONTEXT = "packages/lsp-tools-mcp/src/request-context.ts"
/** Repository-relative path of the module owning the default LSP manager this script disposes. */
const ENGINE_MANAGER = "packages/lsp-tools-mcp/src/lsp/manager.ts"
/** Diagnostics timeout in milliseconds when `--timeout=` is absent. */
const DEFAULT_TIMEOUT_MS = 60_000

/** The subset of the engine's tool result this script reads. */
interface ToolExecutionResult {
	/** Text blocks the tool produced; their texts are joined for the report. */
	readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>
	/** Engine-level failure flag; true is reported as FAIL. */
	readonly isError?: boolean
	/** Structured detail payload, narrowed before use. */
	readonly details?: unknown
}

/** The diagnostics-details fields this script interprets. */
interface DiagnosticsDetails {
	/** Whether the engine scanned a single file or a directory. */
	readonly mode: "file" | "directory"
	/** Number of diagnostics the engine reported. */
	readonly totalDiagnostics: number
	/** Human error text when the engine failed. */
	readonly error?: string
	/** Machine-readable failure class, used to choose the FAIL wording. */
	readonly errorKind?: "missing_dependency" | "no_files" | "invalid_path"
}

/** The module shape loaded from the tools path. */
interface ToolsModule {
	/** Run diagnostics for one file path and optional severity filter; the signal aborts the request. */
	readonly executeLspDiagnostics: (params: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolExecutionResult>
}

/** The module shape loaded from the request-context path. */
interface ContextModule {
	/** Run `fn` with the engine's per-request context (cwd and environment) installed. */
	readonly runWithRequestContext: <T>(context: { cwd?: string; env?: Record<string, string> }, fn: () => T) => T
}

/** The module shape loaded from the manager path. */
interface ManagerModule {
	/** Release the engine's default LSP manager so the process can exit. */
	readonly disposeDefaultLspManager: () => Promise<void>
}

/** Search this script's directory and the cwd upwards for a repository-relative file; null when neither walk finds it. */
function findUp(relativeTarget: string): string | null {
	/** The two directories the upward walks begin at. */
	const starts = [dirname(fileURLToPath(import.meta.url)), process.cwd()]
	for (const start of starts) {
		/** Directory currently being tested in this walk. */
		let current = start
		while (true) {
			/** The target path inside the current directory. */
			const candidate = join(current, relativeTarget)
			if (existsSync(candidate)) return candidate
			/** Parent directory; equal to the current one at the filesystem root, which ends the walk. */
			const parent = dirname(current)
			if (parent === current) break
			current = parent
		}
	}
	return null
}

/** Copy the process environment into a plain string map, dropping entries whose value is undefined. */
function buildEnv(): Record<string, string> {
	/** The copied environment. */
	const env: Record<string, string> = {}
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) env[key] = value
	}
	return env
}

/** Structural narrowing for the engine's details payload: a non-null object carrying both required fields. */
function isDiagnosticsDetails(value: unknown): value is DiagnosticsDetails {
	return typeof value === "object" && value !== null && "mode" in value && "totalDiagnostics" in value
}

/** Resolve a repository-relative engine module and import it dynamically; throws the not-found error when the walk finds nothing. */
async function loadModule<T>(relativeTarget: string): Promise<T> {
	/** Absolute path of the located module. */
	const path = findUp(relativeTarget)
	if (path === null) {
		throw new EngineNotFoundError(relativeTarget)
	}
	return (await import(pathToFileURL(path).href)) as T
}

/** Raised when the engine source cannot be located; the entry point turns it into exit code 3 with a SKIP line. */
class EngineNotFoundError extends Error {
	/** The engine module path or specifier that could not be located. */
	readonly target: string

	/** Record which module was missing and build the SKIP message naming it. */
	constructor(target: string) {
		super(`lsp-tools-mcp engine not found (looked for ${target}). Run verify-lsp.ts inside the upstream checkout/worktree.`)
		this.target = target
		this.name = "EngineNotFoundError"
	}
}

/** Parse `--timeout=<ms>`; an absent or non-positive value falls back to the default timeout. */
function parseTimeout(args: readonly string[]): number {
	/** The first `--timeout=` argument, undefined when none was given. */
	const flag = args.find((arg) => arg.startsWith("--timeout="))
	if (flag === undefined) return DEFAULT_TIMEOUT_MS
	/** The millisecond value read from that flag. */
	const parsed = Number.parseInt(flag.slice("--timeout=".length), 10)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

/** Load the engine, run one diagnostics roundtrip under the request context and report it; returns the process exit code. */
async function run(filePath: string, timeoutMs: number): Promise<number> {
	/** The engine's tools module. */
	const tools = await loadModule<ToolsModule>(ENGINE_TOOLS)
	/** The engine's request-context module. */
	const context = await loadModule<ContextModule>(ENGINE_CONTEXT)
	/** The engine's manager module. */
	const manager = await loadModule<ManagerModule>(ENGINE_MANAGER)
	/** The target file as an absolute path. */
	const absolute = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath)

	try {
		/** Abort signal bounding the engine call to the requested timeout. */
		const signal = AbortSignal.timeout(timeoutMs)
		/** The engine's tool result. */
		const result = await context.runWithRequestContext({ cwd: process.cwd(), env: buildEnv() }, () =>
			tools.executeLspDiagnostics({ filePath: absolute, severity: "all" }, signal),
		)
		/** The narrowed details payload, or null when the engine returned something else. */
		const details = isDiagnosticsDetails(result.details) ? result.details : null
		/** The result's text blocks joined with newlines. */
		const text = result.content.map((part) => part.text).join("\n")

		if (details?.errorKind === "missing_dependency") {
			process.stdout.write(`FAIL ${absolute}: language server not installed\n${text}\n`)
			return 1
		}
		if (result.isError === true || details?.errorKind === "invalid_path" || details?.errorKind === "no_files") {
			process.stdout.write(`FAIL ${absolute}: ${details?.error ?? text}\n`)
			return 1
		}

		/** Diagnostic count for the success line; 0 when the engine returned no details. */
		const count = details?.totalDiagnostics ?? 0
		process.stdout.write(`OK ${absolute}: LSP roundtrip succeeded (${count} diagnostic(s))\n${text}\n`)
		return 0
	} finally {
		await manager.disposeDefaultLspManager()
	}
}

/** Entry point: validate the file argument and map every failure class to its exit code (2 usage, 3 engine missing, 1 failed roundtrip). */
async function main(): Promise<void> {
	/** Command-line arguments after the script path. */
	const args = process.argv.slice(2)
	/** Target file: the first non-flag argument, undefined when none was given. */
	const filePath = args.find((arg) => !arg.startsWith("--"))
	if (filePath === undefined) {
		process.stderr.write("Usage: bun verify-lsp.ts <file> [--timeout=ms]\n")
		process.exit(2)
	}
	if (!existsSync(filePath) || !statSync(filePath).isFile()) {
		process.stderr.write(`verify-lsp: not a file: ${filePath}\n`)
		process.exit(2)
	}

	try {
		/** Exit code of the finished roundtrip. */
		const code = await run(filePath, parseTimeout(args))
		process.exit(code)
	} catch (error) {
		if (error instanceof EngineNotFoundError) {
			process.stderr.write(`SKIP: ${error.message}\n`)
			process.exit(3)
		}
		process.stderr.write(`FAIL ${filePath}: ${error instanceof Error ? error.message : String(error)}\n`)
		process.exit(1)
	}
}

await main()
