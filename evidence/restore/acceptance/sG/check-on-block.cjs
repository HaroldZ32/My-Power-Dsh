// check-on-block — the structural check behind sG's workflow edit.
//
// WHY: `node scripts/verify-workflows.ts` proves the file is LOADABLE YAML with a sane job/step
// shape, but it says nothing about WHICH triggers the `on:` block carries or whether the job's own
// keys still hold their values. This script asserts exactly that, with the same class of parser the
// gate uses (a real YAML parser, never a line scan), and fails loudly on any mismatch.
//
// Usage: node check-on-block.cjs <path-to-js-yaml> <path-to-workflow>
// Exit codes: 0 every assertion held · 1 at least one assertion failed · 2 runner error.
const fs = require("node:fs")

const [parserPath, workflowPath] = process.argv.slice(2)
if (!parserPath || !workflowPath) {
  console.error("usage: node check-on-block.cjs <path-to-js-yaml> <path-to-workflow>")
  process.exit(2)
}

const yaml = require(parserPath)
const doc = yaml.load(fs.readFileSync(workflowPath, "utf8"))

const results = []
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  results.push({ name, ok, actual, expected })
}

const job = doc.jobs["docker-e2e"]
const runStep = job.steps.find((step) => typeof step.run === "string")
const uploadStep = job.steps.find(
  (step) => typeof step.uses === "string" && step.uses.startsWith("actions/upload-artifact"),
)

check("on is a mapping (not the YAML 1.1 boolean true)", typeof doc.on, "object")
check("on: has exactly these three triggers, in file order", Object.keys(doc.on), [
  "workflow_dispatch",
  "schedule",
  "pull_request",
])
check("pull_request: branches", doc.on.pull_request.branches, ["dev"])
check("pull_request: paths", doc.on.pull_request.paths, [
  "docker/**",
  "scripts/docker-e2e.ts",
  ".github/workflows/docker-e2e.yml",
  "skills/**",
  "packages/**",
  "presets/**",
  "cordis.patch.yml",
  "package.json",
])
check("schedule: cron unchanged", doc.on.schedule[0].cron, "41 3 * * *")
check("workflow_dispatch: npm_registry input unchanged", doc.on.workflow_dispatch.inputs.npm_registry, {
  description:
    "Registry to use INSTEAD of the official one (e.g. https://registry.npmmirror.com). Empty = let the lane probe the official registry and fall back to its own mirror.",
  required: false,
  default: "",
  type: "string",
})
check("job: runs-on unchanged", job["runs-on"], "ubuntu-24.04")
check("job: timeout-minutes unchanged", job["timeout-minutes"], 60)
check("job: permissions unchanged", doc.permissions, { contents: "read" })
check("lane step: name unchanged", runStep.name, "Docker real-machine acceptance (source mode, no API key, no browser)")
check("lane step: timeout-minutes unchanged", runStep["timeout-minutes"], 50)
check(
  "lane step: command and flags unchanged",
  runStep.run,
  "node scripts/docker-e2e.ts --mode source --require-docker --allow-rootful-docker --no-browser",
)
check("artifact upload: action unchanged", uploadStep.uses, "actions/upload-artifact@v7")
check("artifact upload: condition unchanged", uploadStep.if, "always()")
check("artifact upload: name unchanged", uploadStep.with.name, "docker-e2e-stamp-${{ github.run_attempt }}")
check("artifact upload: path unchanged", uploadStep.with.path, "evidence/docker/client-install*/")
check("artifact upload: retention-days unchanged", uploadStep.with["retention-days"], 14)

for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `\n  expected: ${JSON.stringify(r.expected)}\n  actual:   ${JSON.stringify(r.actual)}`}`)
}
const failed = results.filter((r) => !r.ok).length
console.log(`[check-on-block] ${results.length - failed}/${results.length} assertions held`)
process.exit(failed === 0 ? 0 : 1)
