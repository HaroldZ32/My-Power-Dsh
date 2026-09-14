// t32 self-fix tests: B5 inScope directory semantics + B6 completion-gate error list.
// Run: bun test packages/mpd-agent-teams-plugin/self-fix-tests
import { test, expect } from "bun:test"
import { pathMatchesScope, classifyChangedPath, evaluateQualityCompletion } from "../lib/quality-gates.js"

// ---------- B5: unified directory-prefix semantics ----------
test("B5: a directory pattern covers its contents WITHOUT a trailing slash", () => {
    expect(pathMatchesScope("packages/mpd-agent-teams-plugin/self-fix-tests/quality-loop.test.mjs", "packages/mpd-agent-teams-plugin/self-fix-tests")).toBe(true)
    expect(pathMatchesScope("skills/dsh-qa/scripts/mount-assert.mjs", "skills/dsh-qa/scripts")).toBe(true)
    expect(pathMatchesScope("a/b/c.js", "a")).toBe(true)
    expect(pathMatchesScope("a/b/c.js", "a/b")).toBe(true)
})

test("B5: trailing slash and non-trailing slash are equivalent", () => {
    expect(pathMatchesScope("packages/x/y.js", "packages/x")).toBe(true)
    expect(pathMatchesScope("packages/x/y.js", "packages/x/")).toBe(true)
    expect(pathMatchesScope("packages/x", "packages/x")).toBe(true)
    expect(pathMatchesScope("packages/x", "packages/x/")).toBe(true)
})

test("B5: exact file patterns still match exactly, siblings and suffixes do not", () => {
    expect(pathMatchesScope("lib/a.js", "lib/a.js")).toBe(true)
    expect(pathMatchesScope("lib/b.js", "lib/a.js")).toBe(false)
    // prefix boundary is a '/' — a file pattern never bleeds into siblings/suffixes
    expect(pathMatchesScope("lib/a.js.map", "lib/a.js")).toBe(false)
    expect(pathMatchesScope("lib/a.jsx", "lib/a.js")).toBe(false)
})

test("B5: root pattern matches everything; illegal/absolute patterns never match", () => {
    expect(pathMatchesScope("any/deep/path.ts", ".")).toBe(true)
    expect(pathMatchesScope("any/deep/path.ts", "./")).toBe(true)
    expect(pathMatchesScope("x", "/abs/path")).toBe(false)
    expect(pathMatchesScope("x", "~/.dsh")).toBe(false)
})

test("B5: classifyChangedPath — directory inScope covers files, outOfScope wins", () => {
    expect(classifyChangedPath("packages/foo/bar.js", ["packages/foo"])).toBe("in_scope")
    expect(classifyChangedPath("packages/foo/vendor/x.js", ["packages/foo"], ["packages/foo/vendor"])).toBe("out_of_scope")
    expect(classifyChangedPath("packages/other/x.js", ["packages/foo"])).toBe("undeclared")
    expect(classifyChangedPath("packages/foo/vendor/x.js", ["packages/foo"], ["packages/foo/vendor/"])).toBe("out_of_scope")
})

// ---------- B6: complete completion-gate error list ----------
function implementationTask(inScope, outOfScope = []) {
    return {
        id: "t9", kind: "implementation", status: "in_progress", inScope, outOfScope,
        acceptance: ["done"], verify: ["true"],
    }
}
function completionUpdate(changedPaths) {
    return {
        status: "completed",
        acceptanceResults: [{ criterion: "done", status: "passed", evidence: "e" }],
        commandsRun: [{ command: "true", status: "passed", exitCode: 0, evidence: "e" }],
        changedPaths,
    }
}

test("B6: completion reports ALL undeclared paths at once with the owning task id and a fix hint", () => {
    const gate = evaluateQualityCompletion(
        implementationTask(["packages/a/"]),
        completionUpdate(["packages/a/ok.js", "packages/b/bad1.js", "packages/c/bad2.js"]),
    )
    expect(gate.ok).toBe(false)
    expect(gate.error).toContain("t9")
    expect(gate.error).toContain("packages/b/bad1.js is undeclared")
    expect(gate.error).toContain("packages/c/bad2.js is undeclared")
    expect(gate.error).toContain("2 changed path(s) not covered by inScope")
    expect(gate.error).toContain('add the path(s) to inScope, or use a directory prefix pattern')
    // the in-scope path must NOT be listed as an offender
    expect(gate.error).not.toContain("packages/a/ok.js")
})

test("B6: completion passes when a directory pattern (no trailing slash) covers every changed path", () => {
    const gate = evaluateQualityCompletion(
        implementationTask(["packages/mpd-agent-teams-plugin/self-fix-tests"]),
        completionUpdate(["packages/mpd-agent-teams-plugin/self-fix-tests/a.test.mjs", "packages/mpd-agent-teams-plugin/self-fix-tests/README.md"]),
    )
    expect(gate.ok).toBe(true)
})
