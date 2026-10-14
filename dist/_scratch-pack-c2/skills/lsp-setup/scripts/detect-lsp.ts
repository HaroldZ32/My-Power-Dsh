#!/usr/bin/env bun
// detect-lsp.ts <targetDir> [--json] — scan a directory for source languages and
// report, per detected language: the builtin LSP server, whether its executable
// is on PATH, an install hint, and whether a project LSP config references it.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { delimiter, extname, join, sep } from "node:path"
import process from "node:process"

import { LANGUAGES, type LanguageServer, PROJECT_CONFIG_FILES } from "./lsp-server-table.ts"

/** Directory names the language scan never descends into. */
const SKIP_DIRECTORIES = new Set<string>([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"out",
	"target",
	".venv",
	"venv",
	"vendor",
	".cache",
	"__pycache__",
	".turbo",
	"coverage",
])

/** Upper bound on files visited by one scan, so an enormous tree cannot hang the command. */
const MAX_FILES = 50_000

// Mirrors effectiveExtension() in packages/lsp-tools-mcp/src/lsp/effective-extension.ts:
// extensionless Dockerfile/Containerfile resolve to .dockerfile (exact-case basenames).
const BASENAME_EXTENSIONS: Record<string, string> = {
	Dockerfile: ".dockerfile",
	Containerfile: ".dockerfile",
}

/** Presence and `lsp`-section contents of one candidate config file. */
interface ConfigFileState {
	/** Config path as spelled in the project-config table, relative to the scanned root. */
	readonly path: string
	/** Whether that file exists under the scanned root. */
	readonly exists: boolean
	/** Keys of the file's `lsp` object; empty when it is absent, unreadable or not an object. */
	readonly serverIds: readonly string[]
}

/** One detected language together with its server's install state. */
interface DetectionResult {
	/** The table row for the detected language. */
	readonly server: LanguageServer
	/** Executable probed on PATH: the first word of the row's command. */
	readonly executable: string
	/** Whether that executable resolved to a file. */
	readonly installed: boolean
	/** Absolute path of the executable, null when it was not found. */
	readonly resolvedPath: string | null
	/** Config files that reference this server id, in scan order. */
	readonly configuredIn: readonly string[]
}

/** Collect the lower-case extensions of every file under the root, skipping the ignored directories and stopping at the file cap. */
function collectExtensions(root: string): ReadonlySet<string> {
	/** Extensions collected so far. */
	const found = new Set<string>()
	/** Directories still to visit; the walk is iterative so a deep tree cannot overflow the stack. */
	const stack: string[] = [root]
	/** Files examined so far, bounded by the file cap. */
	let visited = 0

	while (stack.length > 0) {
		/** Directory currently being read. */
		const current = stack.pop()
		if (current === undefined) break

		/** Its entries, or an empty list when the directory cannot be read. */
		let entries: string[]
		try {
			entries = readdirSync(current)
		} catch {
			continue
		}

		for (const entry of entries) {
			if (visited >= MAX_FILES) return found
			/** Absolute path of the entry. */
			const fullPath = join(current, entry)

			/** What the entry is; `other` covers symlinks and entries whose stat failed. */
			let kind: "dir" | "file" | "other" = "other"
			try {
				/** The entry's stat result, used to classify it. */
				const stat = statSync(fullPath)
				kind = stat.isDirectory() ? "dir" : stat.isFile() ? "file" : "other"
			} catch {
				continue
			}

			if (kind === "dir") {
				if (!SKIP_DIRECTORIES.has(entry)) stack.push(fullPath)
			} else if (kind === "file") {
				visited += 1
				/** Lower-cased extension; the basename table is consulted first so an extensionless Dockerfile still maps. */
				const ext = (BASENAME_EXTENSIONS[entry] ?? extname(entry)).toLowerCase()
				if (ext.length > 0) found.add(ext)
			}
		}
	}

	return found
}

/** The non-empty entries of PATH, in order. */
function pathDirectories(): readonly string[] {
	return (process.env["PATH"] ?? "").split(delimiter).filter((dir: string) => dir.length > 0)
}

/** Absolute path of an executable found on PATH (or at a path-qualified command), null when no candidate is a file. */
function resolveExecutable(command: string): string | null {
	/** Candidate executable suffixes: PATHEXT entries on Windows, one empty suffix elsewhere. */
	const extensions =
		process.platform === "win32" ? (process.env["PATHEXT"]?.split(";") ?? [".EXE", ".CMD", ".BAT"]) : [""]
	/** Candidate executable paths: the command as given when it holds a separator, otherwise one per PATH directory. */
	const bases = command.includes("/") || command.includes(sep) ? [command] : pathDirectories().map((dir: string) => join(dir, command))

	for (const base of bases) {
		for (const ext of extensions) {
			/** Executable path with the current suffix appended. */
			const candidate = ext.length > 0 ? `${base}${ext}` : base
			try {
				if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
			} catch {
				continue
			}
		}
	}
	return null
}

/** Narrow an unknown JSON value to a plain object, excluding null and arrays. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Server ids referenced by a config file's `lsp` object; empty for a missing, unreadable or non-object document. */
function parseConfiguredServerIds(path: string): readonly string[] {
	/** The parsed JSON document. */
	let parsed: unknown
	try {
		parsed = JSON.parse(readFileSync(path, "utf-8"))
	} catch {
		return []
	}
	if (!isRecord(parsed)) return []
	/** The document's `lsp` value, which must itself be an object to name servers. */
	const lsp = parsed["lsp"]
	return isRecord(lsp) ? Object.keys(lsp) : []
}

/** Probe every candidate config file under the root and report its state. */
function readConfigState(root: string): readonly ConfigFileState[] {
	return PROJECT_CONFIG_FILES.map((relative: string): ConfigFileState => {
		/** Absolute path of the candidate file, used only for the existence check and the read. */
		const path = join(root, relative)
		if (!existsSync(path)) return { path: relative, exists: false, serverIds: [] }
		return { path: relative, exists: true, serverIds: parseConfiguredServerIds(path) }
	})
}

/** One result per table row whose extensions appear in the scanned tree. */
function detect(root: string, configState: readonly ConfigFileState[]): readonly DetectionResult[] {
	/** The extension set collected from the root. */
	const extensions = collectExtensions(root)
	/** Results accumulated in table order. */
	const results: DetectionResult[] = []

	for (const server of LANGUAGES) {
		if (!server.extensions.some((ext: string) => extensions.has(ext))) continue

		/** Executable probed for this server. */
		const executable = server.command[0] ?? server.serverId
		/** Where that executable was found, null when it is missing. */
		const resolvedPath = resolveExecutable(executable)
		/** Config files that name this server id. */
		const configuredIn = configState
			.filter((state) => state.serverIds.includes(server.serverId))
			.map((state) => state.path)

		results.push({ server, executable, installed: resolvedPath !== null, resolvedPath, configuredIn })
	}

	return results
}

/** Render the human-readable report: config summary, one line per detected language, then the missing-server roll-up. */
function renderReport(root: string, results: readonly DetectionResult[], configState: readonly ConfigFileState[]): string {
	/** Report lines, in output order. */
	const lines: string[] = [`LSP setup scan: ${root}`]
	/** One-line summary of the candidate config files. */
	const configSummary = configState
		.map((state) => `${state.path} (${state.exists ? `present: ${state.serverIds.length} server(s)` : "absent"})`)
		.join(", ")
	lines.push(`Config files: ${configSummary}`, "")

	if (results.length === 0) {
		lines.push("No languages with a builtin LSP server were detected here.")
		return lines.join("\n")
	}

	lines.push("DETECTED LANGUAGES (primary builtin server per language)")
	for (const result of results) {
		/** Fixed-width OK/MISS marker for the report's status column. */
		const mark = result.installed ? "OK  " : "MISS"
		/** Installed or not-installed phrase, naming the resolved path when there is one. */
		const state = result.installed ? `installed (${result.resolvedPath})` : "NOT installed"
		/** Where the server is configured, or `builtin-default` when no config file names it. */
		const config = result.configuredIn.length > 0 ? `configured in ${result.configuredIn.join(", ")}` : "builtin-default"
		lines.push(`[${mark}] ${result.server.language.padEnd(12)} server=${result.server.serverId}  exe=${result.executable}  ${state}  ${config}`)
		if (!result.installed) lines.push(`        install: ${result.server.installHint}`)
	}

	/** Detected servers whose executable is not installed. */
	const missing = results.filter((result) => !result.installed)
	lines.push(
		"",
		missing.length === 0
			? `All ${results.length} detected server(s) installed.`
			: `${missing.length}/${results.length} server(s) NOT installed: ${missing.map((m) => m.server.language).join(", ")}`,
		"Next: read references/<language>/README.md, then configure .codex/lsp-client.json AND .opencode/lsp.json.",
	)
	return lines.join("\n")
}

/** Entry point: resolve the target directory, print the JSON or human report, and exit 2 when the directory does not exist. */
function main(): void {
	/** Command-line arguments after the script path. */
	const args = process.argv.slice(2)
	/** Whether `--json` was requested. */
	const wantsJson = args.includes("--json")
	/** Target directory: the first non-flag argument, or the cwd when there is none. */
	const root = args.find((arg: string) => !arg.startsWith("--")) ?? process.cwd()

	if (!existsSync(root)) {
		process.stderr.write(`detect-lsp: target directory does not exist: ${root}\n`)
		process.exit(2)
	}

	/** Config-file state for the target root. */
	const configState = readConfigState(root)
	/** Detection results for the target root. */
	const results = detect(root, configState)

	if (wantsJson) {
		process.stdout.write(`${JSON.stringify({ root, configState, results }, null, 2)}\n`)
		return
	}
	process.stdout.write(`${renderReport(root, results, configState)}\n`)
}

main()
