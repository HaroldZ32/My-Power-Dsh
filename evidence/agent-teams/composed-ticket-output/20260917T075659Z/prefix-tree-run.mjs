// Acceptance item 3, the harder half: does the ARM itself FAIL on the pre-fix tree?
//
// The arm's in-file control proves the fix is falsifiable (the wipe reappears when the new condition is
// neutralised). This driver proves the stronger statement the contract asks for: run the SAME arm file
// against a tree whose `lib/state.js` is HEAD's revision — as-committed, pre-fix — and a test fails.
//
// Usage: bun evidence/agent-teams/composed-ticket-output/<stamp>/prefix-tree-run.mjs
import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "../../../../")
const PKG = "packages/mpd-agent-teams-plugin"
const ARM = "composed-ticket-output-preserved.test.mjs"

const scratch = mkdtempSync(join(tmpdir(), "mpd-t73-prefix-tree-"))
const out = { driver: "prefix-tree-run (T-73 acceptance item 3)", headCommit: "", arm: "", runs: {} }
try {
    out.headCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim()
    // A scratch PACKAGE tree: current lib/ and arm, but `state.js` at HEAD's revision.
    cpSync(join(REPO, PKG), join(scratch, "pkg"), {
        recursive: true,
        filter: (src) => !src.includes(`${PKG}/dist`) && !src.includes(`${PKG}/test`),
    })
    const headState = execFileSync("git", ["show", `HEAD:${PKG}/lib/state.js`], { cwd: REPO, encoding: "utf8" })
    writeFileSync(join(scratch, "pkg", "lib", "state.js"), headState)
    out.arm = join(scratch, "pkg", "self-fix-tests", ARM)
    out.headStateBytes = Buffer.byteLength(headState)
    out.armExists = readFileSync(out.arm, "utf8").length > 0

    // bun test writes its report to STDERR; both streams are read, and the raw tails are kept so a
    // zero-output reading can never be mistaken for a pass (measured: stdout carries only the banner).
    const summarize = (run) => {
        const report = `${run.stdout ?? ""}\n${run.stderr ?? ""}`
        return {
            exit: run.status,
            failed: (report.match(/\(fail\)/g) ?? []).length,
            passed: (report.match(/\(pass\)/g) ?? []).length,
            failedCases: [...report.matchAll(/\(fail\) ([^\n]*)/g)].map((match) => match[1]),
            tail: report.trim().split("\n").slice(-3),
        }
    }
    out.runs["pre-fix tree (HEAD state.js)"] = summarize(spawnSync("bun", ["test", `self-fix-tests/${ARM}`], { cwd: join(scratch, "pkg"), encoding: "utf8", timeout: 180_000 }))
    out.runs["fixed tree"] = summarize(spawnSync("bun", ["test", `self-fix-tests/${ARM}`], { cwd: join(REPO, PKG), encoding: "utf8", timeout: 180_000 }))
}
finally {
    rmSync(scratch, { recursive: true, force: true })
}
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
