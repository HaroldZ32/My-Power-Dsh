#!/usr/bin/env node
// t8 path disposition checker: assign EVERY git-status path (modified + untracked) to exactly
// one commit of the reconciled three-wave plan, and report anything unassigned. Ignored paths
// (.mpd/**, dist/mpd-package/**, .codegraph/**) never appear in git status and are listed
// separately as non-committable.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const OUT = join(dirname(fileURLToPath(import.meta.url)), "path-disposition.json")

const RULES = [
    { commit: 1, scope: "adapter workspace root", patterns: ["packages/mpd-dsh-adapter-plugin/", "packages/mpd-bootstrap-plugin/", "packages/mpd-roles-plugin/", "packages/mpd-tools-plugin/", "packages/mpd-qa-roles-probe/"] },
    { commit: 2, scope: "bline session workspace", patterns: ["packages/mpd-boulder-plugin/", "packages/mpd-config-plugin/", "packages/mpd-comment-checker-plugin/", "packages/mpd-memory-plugin/", "packages/mpd-modelchain-plugin/", "packages/mpd-ulw-plugin/", "packages/mpd-workmate-plugin/"] },
    { commit: 3, scope: "verif", patterns: ["packages/mpd-verif-plugin/", "evidence/fix/verif-tool-lossless/", "evidence/wave2/r1-gate-order/", "evidence/wave2/r1-f1-exec-forward/"] },
    { commit: 4, scope: "hashline", patterns: ["packages/mpd-hashline-plugin/", "evidence/hashline/"] },
    { commit: 5, scope: "qa + skills re-pin", patterns: ["skills/", "VENDOR_LOCK.json", "scripts/verify-vendor.mjs", "evidence/dsh-qa/", "evidence/wave2/qa-workspace-isolation/", "evidence/verification/t9-b2-b6/", "evidence/wave3/qa-harness-fidelity/"] },
    { commit: 6, scope: "mcp + codegraph", patterns: ["packages/mpd-mcp-astgrep/", "packages/mpd-mcp-codegraph/", "packages/mpd-mcp-shared/", "packages/mpd-codegraph-plugin/", "packages/mpd-bundle/", "scripts/pack-mpd.mjs", "evidence/wave2/b8-binary-resolution/", "evidence/wave3/codegraph-degrade-and-applytime/"] },
    { commit: 7, scope: "installer parity", patterns: ["scripts/install-profile.mjs", "scripts/verify-rows-parity.mjs", "package.json", "evidence/wave2/b9-installer-parity/"] },
    { commit: 8, scope: "agent-teams adopted deltas", patterns: ["packages/mpd-agent-teams-plugin/", "scripts/patch-agent-teams-fixes.mjs", "scripts/vendor-agent-teams.mjs", "evidence/wave2/adopted-tooling", "evidence/wave3/registry-redesign/", "evidence/wave3/t1-requirements/"] },
    { commit: 9, scope: "AGENTS.md", patterns: ["AGENTS.md"] },
    { commit: 10, scope: "evidence bulk", patterns: ["evidence/"] },
]

const porcelain = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 })
const entries = porcelain.split("\n").filter(Boolean).map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3) }))
const assigned = new Map(RULES.map((rule) => [rule.commit, []]))
const unassigned = []
for (const entry of entries) {
    const rule = RULES.find((candidate) => candidate.patterns.some((pattern) => entry.path === pattern || entry.path.startsWith(pattern)))
    if (rule === undefined) unassigned.push(entry.path)
    else assigned.get(rule.commit).push(entry.path)
}

const ignoredProbe = [".mpd/team/mpd-wave-3/team.json", ".mpd/memory", "dist/mpd-package/package.json", ".codegraph/x"]
const nonCommittable = ignoredProbe.map((path) => {
    try {
        const rule = execFileSync("git", ["check-ignore", "-v", path], { cwd: REPO, encoding: "utf8" }).trim()
        return { path, ignored: true, rule: rule.split("\t")[0] }
    }
    catch {
        return { path, ignored: false, rule: null }
    }
})

const summary = {
    branch: execFileSync("git", ["branch", "--show-current"], { cwd: REPO, encoding: "utf8" }).trim(),
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(),
    totalPaths: entries.length,
    modified: entries.filter((entry) => entry.status === "M").length,
    untracked: entries.filter((entry) => entry.status === "??").length,
    perCommit: RULES.map((rule) => ({ commit: rule.commit, scope: rule.scope, paths: assigned.get(rule.commit).length, sample: assigned.get(rule.commit).slice(0, 2) })),
    unassigned,
    nonCommittable,
    passed: unassigned.length === 0 && nonCommittable.every((entry) => entry.ignored),
}
writeFileSync(OUT, JSON.stringify(summary, null, 2) + "\n")
console.log(JSON.stringify(summary, null, 1))
process.exit(summary.passed ? 0 : 1)
