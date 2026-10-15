#!/usr/bin/env node
// f2-reply-verdict-arms.mjs — the controls for FINDING (2): the failure judgement must compare the
// post-send capture against the PRE-SEND capture, so a stale failure panel cannot bind.
//
// No Docker, no network, no browser. What runs is the SHIPPED module, `docker/lib/reply-verdict.ts`,
// and its own `--self-test`; the NEGATIVE CONTROL is a copy of that same file with the comparison
// LOCALLY REVERTED (the pre-fix `failureText(after)` reading restored), so the two runs differ by the
// revert alone and nothing else.
//
// Usage: node evidence/tui/dsh-tui-015/coderabbit/docker/f2-reply-verdict-arms.mjs
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** The repository root, resolved from this driver's own location (…/evidence/tui/<slug>/coderabbit/docker). */
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..")
/** The shipped classifier under test. */
const SHIPPED = join(REPO, "docker", "lib", "reply-verdict.ts")
/** The shipped call site the control reverts: pre-fix, the panel was read from `after` alone. */
const CALL_SITE = "failureText(input.before, input.after)"
/** The pre-fix call site the revert restores (an empty pre-send capture = "scan the whole capture"). */
const PRE_FIX_CALL_SITE = 'failureText("", input.after)'
/** The arm that the defect reddens: a stale panel alone must NOT bind. */
const STALE_ARM = "stale-failure-line-alone-does-not-bind"
/** The arm the revert must leave GREEN: a panel the current turn painted still binds. */
const NEW_ARM = "new-failure-line-does-bind"
/** How many arms the shipped self-test is expected to carry (9 before this repair + these 2). */
const EXPECTED_ARMS = 11

/** How many checks disagreed with their expectation. */
let failed = 0

/**
 * Check one expectation and print it.
 *
 * @param name - The check's name, printed as `[f2] <name>=true|false`.
 * @param ok - Whether the expectation held.
 * @param detail - One line of observed evidence.
 */
function check(name, ok, detail) {
  if (!ok) failed++
  console.log(`[f2] ${name}=${ok}${detail === "" ? "" : " — " + detail}`)
}

/**
 * Run one `--self-test` and read the arm lines out of it.
 *
 * @param file - The classifier file to run.
 * @returns The exit code, the raw output and the per-arm booleans.
 */
function runSelfTest(file) {
  const run = spawnSync(process.execPath, [file, "--self-test"], { encoding: "utf8", timeout: 60_000 })
  /** The output, both streams, so a crash is not read as a silent pass. */
  const output = (run.stdout ?? "") + (run.stderr ?? "")
  /** Every arm's name and its boolean. */
  const arms = new Map()
  for (const line of output.split("\n")) {
    const match = /^\[reply-verdict\] ([a-z0-9-]+)=(true|false)$/.exec(line.trim())
    if (match !== null) arms.set(match[1], match[2] === "true")
  }
  /** The `ARMS=n PASSED=n FAILED=n` summary line, or "". */
  const summary = /ARMS=(\d+) PASSED=(\d+) FAILED=(\d+)/.exec(output)?.[0] ?? ""
  return { code: run.status, output, arms, summary }
}

// ── arm 1: the SHIPPED classifier carries both new arms and passes all of them ───────────────────────
const shipped = runSelfTest(SHIPPED)
check("shipped-self-test-exit-0", shipped.code === 0, `exit=${shipped.code} ${shipped.summary}`)
check("shipped-arms-count", shipped.summary === `ARMS=${EXPECTED_ARMS} PASSED=${EXPECTED_ARMS} FAILED=0`, shipped.summary)
check("shipped-stale-arm-green", shipped.arms.get(STALE_ARM) === true, `${STALE_ARM}=${shipped.arms.get(STALE_ARM)}`)
check("shipped-new-arm-green", shipped.arms.get(NEW_ARM) === true, `${NEW_ARM}=${shipped.arms.get(NEW_ARM)}`)
check("shipped-reads-the-pre-send-capture", readFileSync(SHIPPED, "utf8").includes(CALL_SITE), `call site: ${CALL_SITE}`)
// The stale arm's OWN row must say the panel was seen and is stale — the honest record of why nothing bound.
check(
  "shipped-stale-arm-raw-names-the-stale-panel",
  /stale-failure-line-alone-does-not-bind=true\n\[reply-verdict\]   kind=no-reply .*failure=none staleFailure=yes/.test(shipped.output),
  "raw carries failure=none staleFailure=yes",
)

// ── arm 2: the NEGATIVE CONTROL — the comparison reverted locally reddens the stale arm ──────────────
/** A scratch copy of the shipped module, so the revert never touches the tree. */
const scratch = mkdtempSync(join(tmpdir(), "f2-arms-"))
/** Where the reverted copy lives. */
const revertedPath = join(scratch, "reply-verdict.ts")
/** The shipped bytes. */
const shippedSource = readFileSync(SHIPPED, "utf8")
copyFileSync(SHIPPED, revertedPath)
// THE LOCAL REVERT: compare nothing against the pre-send capture, exactly as the pre-fix module did.
const revertedSource = shippedSource.replace(CALL_SITE, PRE_FIX_CALL_SITE)
writeFileSync(revertedPath, revertedSource)
/** The shipped vs reverted diff, to prove the two runs differ by the revert alone. */
const diff = spawnSync("diff", ["-u", SHIPPED, revertedPath], { encoding: "utf8" })
/** The diff's changed lines, minus the two file headers. */
const changed = (diff.stdout ?? "").split("\n").filter((line) => /^[+-][^+-]/.test(line))
check("revert-applied-exactly-once", revertedSource !== shippedSource && revertedSource.split(PRE_FIX_CALL_SITE).length === 2, `changedLines=${changed.length} ${JSON.stringify(changed)}`)

/** The reverted classifier's self-test. */
const control = runSelfTest(revertedPath)
check("control-exit-1", control.code === 1, `exit=${control.code} ${control.summary}`)
check("control-stale-arm-RED", control.arms.get(STALE_ARM) === false, `${STALE_ARM}=${control.arms.get(STALE_ARM)} (the stale panel binds again, which is the defect)`)
check("control-new-arm-still-GREEN", control.arms.get(NEW_ARM) === true, `${NEW_ARM}=${control.arms.get(NEW_ARM)} (the revert reddens the stale arm ONLY, so the arm is specific)`)
check(
  "control-stale-arm-binds-on-the-stale-panel",
  /stale-failure-line-alone-does-not-bind=false\n\[reply-verdict\]   kind=credential-bound .*failure=yes staleFailure=yes/.test(control.output),
  "the reverted classifier reads the PRE-SEND panel as a fresh credential bound",
)

console.log(`[f2] FAILED=${failed}`)
console.log(`[f2] scratch=${scratch}`)
process.exit(failed === 0 ? 0 : 1)
