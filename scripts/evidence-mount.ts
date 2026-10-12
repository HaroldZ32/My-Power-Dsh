#!/usr/bin/env node
// The `evidence:mount` npm script's shell-free entry point. The mount assertion needs an expectation
// whose text carries embedded single quotes (`name: '@deepseek-ai/dsh-llm'`), and a value like that
// only survives a shell when it is quoted — cmd.exe, PowerShell and POSIX sh disagree on HOW. A plain
// ASCII path survives all three, so the value lives here as an argv element the shell never parses.
//
// Usage: node scripts/evidence-mount.ts [extra mount-assert arguments, e.g. --self-test]
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** Directory holding this shim (`<root>/scripts`), so the case is resolved from any cwd. */
const here: string = dirname(fileURLToPath(import.meta.url))

/**
 * The row substring the mount assertion must find in the composer dump. The single quotes are part of
 * the dumped text and are what keeps `@deepseek-ai/dsh-llm` distinct from the `…-deepseek` row (the
 * discrimination the case's own fixture self-test pins), so they cannot be dropped for portability.
 */
const EXPECTED_ROW: string = "name: '@deepseek-ai/dsh-llm'"

/**
 * Run the dsh-qa `mount-assert` case with that expectation, forwarding any extra arguments.
 * @returns The case's exit status: 0 when the row was asserted, non-zero when it failed to be.
 */
function runMountAssert(): number {
  // The case script, reached as <root>/scripts -> <root>/skills/dsh-qa/scripts.
  const caseScript = join(here, "..", "skills", "dsh-qa", "scripts", "mount-assert.ts")
  // The child's argv as a LIST: no shell is involved, so no quoting rule can mangle the expectation.
  const argv = [caseScript, "--expect", EXPECTED_ROW, ...process.argv.slice(2)]
  // stdout/stderr stay attached, so the case's own evidence path and verdict reach the caller as-is.
  const run = spawnSync(process.execPath, argv, { stdio: "inherit" })
  return run.status ?? 1
}

process.exit(runMountAssert())
