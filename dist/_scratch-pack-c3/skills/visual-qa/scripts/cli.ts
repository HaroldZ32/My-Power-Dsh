import { readFileSync } from "node:fs"

import { diffImages } from "./image-diff.ts"
import { decodePng } from "./png-decode.ts"
import { checkTui } from "./tui-grid.ts"
import type { ImageDiffResult, TuiCheckResult } from "./types"

/** Usage error: raised for bad arguments or an unknown command, and printed verbatim as `visual-qa error: …`. */
export class CliError extends Error {
	/** Stable class name, kept as a literal so a caller can identify the error without `instanceof`. */
	readonly name = "CliError"
}

/** Column count `tui-check` assumes when the arguments carry no `--cols` flag. */
const DEFAULT_COLUMNS = 80
/** The flag that overrides the assumed capture width. */
const COLS_FLAG = "--cols"

/** Decode both PNG paths and diff them; throws {@link CliError} when either positional argument is missing. */
export function runImageDiff(args: readonly string[]): ImageDiffResult {
	/** First positional argument: path of the reference image. */
	const referencePath = args[0]
	/** Second positional argument: path of the image under test. */
	const actualPath = args[1]
	if (referencePath === undefined || actualPath === undefined) {
		throw new CliError("usage: image-diff <reference.png> <actual.png>")
	}
	/** The decoded reference image. */
	const reference = decodePng(readFileSync(referencePath))
	/** The decoded image under test. */
	const actual = decodePng(readFileSync(actualPath))
	return diffImages(reference, actual)
}

/** Read `--cols N` or `--cols=N` from the arguments, falling back to {@link DEFAULT_COLUMNS}; a value that is not a positive integer is a usage error. */
function parseColumns(args: readonly string[]): number {
	for (let index = 0; index < args.length; index++) {
		/** The argument under inspection. */
		const arg = args[index] ?? ""
		if (arg === COLS_FLAG) {
			/** Column count parsed from the separate-argument form `--cols N`. */
			const parsed = Number(args[index + 1])
			if (!Number.isInteger(parsed) || parsed <= 0) {
				throw new CliError(`${COLS_FLAG} requires a positive integer`)
			}
			return parsed
		}
		if (arg.startsWith(`${COLS_FLAG}=`)) {
			/** Column count parsed from the inline form `--cols=N`. */
			const parsed = Number(arg.slice(COLS_FLAG.length + 1))
			if (!Number.isInteger(parsed) || parsed <= 0) {
				throw new CliError(`${COLS_FLAG} requires a positive integer`)
			}
			return parsed
		}
	}
	return DEFAULT_COLUMNS
}

/** Read the capture file and measure it against the requested width; a missing path, or a flag where the path belongs, is a usage error. */
export function runTuiCheck(args: readonly string[]): TuiCheckResult {
	/** First positional argument: path of the terminal capture to measure. */
	const capturePath = args[0]
	if (capturePath === undefined || capturePath.startsWith("--")) {
		throw new CliError("usage: tui-check <capture.txt> [--cols N]")
	}
	/** The capture file's contents, decoded as UTF-8. */
	const text = readFileSync(capturePath, "utf8")
	return checkTui(text, parseColumns(args.slice(1)))
}

/** Dispatch the first argument to its subcommand; an unknown name is a usage error naming the two accepted commands. */
export function run(argv: readonly string[]): ImageDiffResult | TuiCheckResult {
	/** The subcommand name; undefined when the CLI was invoked with no arguments at all. */
	const command = argv[0]
	/** Everything after the subcommand name, passed through as that command's own arguments. */
	const rest = argv.slice(1)
	switch (command) {
		case "image-diff":
			return runImageDiff(rest)
		case "tui-check":
			return runTuiCheck(rest)
		default:
			throw new CliError(`unknown command "${command ?? ""}"; expected "image-diff" or "tui-check"`)
	}
}

/** Entry point: write the JSON verdict on success, or the message plus exit code 1 on a thrown error. */
function main(argv: readonly string[]): void {
	try {
		/** The verdict produced by the dispatched subcommand. */
		const result = run(argv)
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
	} catch (error) {
		/** Failure text, taken from the error or coerced from a non-Error throw. */
		const message = error instanceof Error ? error.message : String(error)
		process.stderr.write(`visual-qa error: ${message}\n`)
		process.exitCode = 1
	}
}

if (import.meta.main) {
	main(process.argv.slice(2))
}
