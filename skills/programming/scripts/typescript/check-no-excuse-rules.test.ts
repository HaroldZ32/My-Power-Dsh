import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

// Regression for lazycodex#111: the script must resolve the TypeScript API
// from the caller project (cwd) when run from an installed skill cache.

/** Absolute path of the script under test. */
const scriptSource = join(import.meta.dir, "check-no-excuse-rules.ts")
/** Require rooted at this test file, used to locate the declared native preview. */
const repoRequire = createRequire(import.meta.url)
/** Directory of the real TypeScript 7 native preview package linked into the caller. */
const nativePreviewDir = dirname(repoRequire.resolve("@typescript/native-preview/package.json"))

/** Root of the temporary tree holding the fake skill cache and the two caller projects. */
let tempRoot = ""
/** Copy of the script under test inside the fake skill cache. */
let cachedScript = ""
/** Caller project that provides the TypeScript 7 native preview in its own node_modules. */
let callerDir = ""
/** Caller project without a TypeScript 7 API, used for the resolution-failure case. */
let callerWithoutTypescriptDir = ""

/** Run the cached copy of the script against one target file inside `cwd`; utf8 encoding makes the captured stdout and stderr strings. */
function runNoExcuse(cwd: string, target: string): SpawnSyncReturns<string> {
	return spawnSync(process.execPath, ["--no-install", cachedScript, target], {
		cwd,
		encoding: "utf8",
		timeout: 60_000,
	})
}

describe("#given the no-excuse script is executed from an installed ~/.codex-style skill cache", () => {
	beforeAll(() => {
		// One caller project provides the real TypeScript 7 API and one has no compiler.
		tempRoot = realpathSync(mkdtempSync(join(tmpdir(), "no-excuse-cache-repro-")))
		/** Directory of the fake installed skill cache, outside any project. */
		const cacheDir = join(tempRoot, ".codex", "skills", "programming", "scripts", "typescript")
		mkdirSync(cacheDir, { recursive: true })
		cachedScript = join(cacheDir, "check-no-excuse-rules.ts")
		copyFileSync(scriptSource, cachedScript)

		callerDir = join(tempRoot, "caller-project")
		/** Scope directory that matches the preview package's installed name. */
		const scopeDir = join(callerDir, "node_modules", "@typescript")
		mkdirSync(scopeDir, { recursive: true })
		symlinkSync(nativePreviewDir, join(scopeDir, "native-preview"), "junction")
		writeFileSync(join(callerDir, "clean.ts"), "export const answer: number = 42\n")
		writeFileSync(join(callerDir, "violating.ts"), "const x = foo as any\nexport default x\n")

		callerWithoutTypescriptDir = join(tempRoot, "caller-without-typescript")
		mkdirSync(callerWithoutTypescriptDir, { recursive: true })
		writeFileSync(join(callerWithoutTypescriptDir, "clean.ts"), "export const answer: number = 42\n")
	})

	afterAll(() => {
		rmSync(tempRoot, { recursive: true, force: true })
	})

	// A generous timeout: the first run does a cold TypeScript program load in a
	// spawned subprocess, which can exceed bun test's 5s default on a cold cache
	// (matches the 60s spawnSync ceiling). This bounds the subprocess, it does not
	// wait on wall-clock time as behavior.
	test("#when the caller provides the native preview #then the CLI resolves it and exits 0", () => {
		// when no-excuse runs from the cache copy against the caller project
		const result = runNoExcuse(callerDir, "clean.ts")

		// then the CLI uses the caller's TypeScript 7 API and the clean file passes
		expect(result.error).toBeUndefined()
		expect(result.status).toBe(0)
		expect(result.stdout).toContain("No violations in 1 file(s).")
	}, 60_000)

	test("#when a checked file violates the rules #then violations are still reported with exit 1", () => {
		// when no-excuse runs against a file containing `as any`
		const result = runNoExcuse(callerDir, "violating.ts")

		// then the existing CLI behavior is unchanged
		expect(result.error).toBeUndefined()
		expect(result.status).toBe(1)
		expect(result.stderr).toContain("[no-any-assertion]")
	}, 60_000)

	test("#when the caller has no TypeScript 7 API #then it explains how to fix resolution and exits 2", () => {
		// when no-excuse runs from a caller project with no local compiler
		const result = runNoExcuse(callerWithoutTypescriptDir, "clean.ts")

		// then the diagnostic identifies the caller, the failed probes and the install command
		expect(result.error).toBeUndefined()
		expect(result.status).toBe(2)
		expect(result.stderr).toContain(`cannot resolve the TypeScript 7 API from the caller project (${callerWithoutTypescriptDir})`)
		expect(result.stderr).toContain("Tried: typescript (not resolvable from the caller), @typescript/native-preview (not resolvable from the caller)")
		expect(result.stderr).toContain("bun add -d @typescript/native-preview")
	}, 60_000)
})
