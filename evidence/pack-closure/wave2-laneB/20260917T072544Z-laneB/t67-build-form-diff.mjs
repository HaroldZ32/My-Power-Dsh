#!/usr/bin/env node
// T-67 evidence: the two build FORMS produce different path comments for the SAME source, which is
// why a committed `dist/` can only ever match ONE of them and why `verify-dist-fresh` flags the other
// STALE. The entries are DERIVED from the package's own `scripts.build` (the canonical string in the
// manifest IS the input), never from a hand-copied entry list.
//
// usage: node t67-build-form-diff.mjs [<pkg>]        (run from the repository root)
// exit 0 = the two forms DIFFER for at least one entry (the T-67 disagreement is confirmed, measured)
// exit 1 = the forms are byte-equivalent in their path comments (the finding would be FALSIFIED)
// exit 2 = the manifest is not in the canonical form / is unparseable (nothing to compare)
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const repo = process.cwd()
const pkg = process.argv[2] ?? "mpd-ext-plugin"
const manifestPath = join(repo, "packages", pkg, "package.json")
const build = JSON.parse(readFileSync(manifestPath, "utf8"))?.scripts?.build
if (typeof build !== "string" || build.trim() === "") {
  console.error("no scripts.build in packages/" + pkg + "/package.json")
  process.exit(2)
}

const prefix = "packages/" + pkg + "/"
const rawSegments = build.split("&&").map((s) => s.trim()).filter((s) => s !== "")
// The cwd anchor is part of the sanctioned form (it is what makes the same repo-root command runnable
// from the package directory too): drop it from the COMMAND under test and record it separately.
let anchor = null
if (rawSegments.length > 0 && /^cd(\s|$)/.test(rawSegments[0]) && !/bun\s+build/.test(rawSegments[0])) anchor = rawSegments.shift()
const pairs = []
for (const raw of rawSegments) {
  const segment = raw.trim()
  if (segment === "") continue
  const entry = segment.match(/bun\s+build\s+(\S+)/)?.[1]
  const out = segment.match(/--outfile\s+(\S+)/)?.[1]
  if (entry === undefined || out === undefined) {
    console.error("cannot parse build segment: " + segment)
    process.exit(2)
  }
  if (!entry.startsWith(prefix) || !out.startsWith(prefix)) {
    console.error("manifest is NOT in the canonical repo-root form: " + segment)
    process.exit(2)
  }
  pairs.push({ entry, out, relEntry: entry.slice(prefix.length), outName: out.split("/").pop() })
}

/** Every `// <module path>` line bun emits for the modules it bundled, in file order. */
const comments = (file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("// ") && /\.(ts|tsx|js|mjs|cjs|json)$/.test(line.trim()))
    .map((line) => line.trim())

const scratch = mkdtempSync(join(tmpdir(), "mpd-buildform-"))
const report = {
  schema: "laneB/t67-build-form-diff/1",
  captured_at: new Date().toISOString(),
  package: pkg,
  cwd_anchor: anchor,
  derived_from: "packages/" + pkg + "/package.json scripts.build",
  claim_under_test: "a package-directory build and the canonical repo-root build of the SAME source differ in the artifact's path comments (AGENTS.md §6)",
  entries: [],
  forms_identical: null,
}
try {
  for (const pair of pairs) {
    const outA = join(scratch, "repo-root-" + pair.outName)
    const outB = join(scratch, "package-dir-" + pair.outName)
    execFileSync("bun", ["build", pair.entry, "--target", "node", "--format", "esm", "--outfile", outA], { cwd: repo, stdio: ["ignore", "ignore", "inherit"] })
    execFileSync("bun", ["build", pair.relEntry, "--target", "node", "--format", "esm", "--outfile", outB], { cwd: join(repo, "packages", pkg), stdio: ["ignore", "ignore", "inherit"] })
    const a = comments(outA)
    const b = comments(outB)
    const onlyA = a.filter((x) => !b.includes(x))
    const onlyB = b.filter((x) => !a.includes(x))
    let committed = null
    try {
      const c = comments(join(repo, pair.out))
      committed = {
        file: pair.out,
        comments: c.length,
        distinct: new Set(c).size,
        equals_repo_root_form: JSON.stringify(c) === JSON.stringify(a),
        equals_package_dir_form: JSON.stringify(c) === JSON.stringify(b),
      }
    } catch {
      committed = null
    }
    report.entries.push({
      entry: pair.entry,
      repo_root_form: { command: "bun build " + pair.entry + " --target node --format esm --outfile <tmp>", cwd: repo, comments: a.length, distinct: new Set(a).size, list: a },
      package_dir_form: { command: "bun build " + pair.relEntry + " --target node --format esm --outfile <tmp>", cwd: join(repo, "packages", pkg), comments: b.length, distinct: new Set(b).size, list: b },
      only_in_repo_root_form: onlyA,
      only_in_package_dir_form: onlyB,
      diff_lines: onlyA.length + onlyB.length,
      committed_dist: committed,
    })
  }
  report.forms_identical = report.entries.every((e) => e.diff_lines === 0)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
console.log(JSON.stringify(report, null, 2))
process.exit(report.forms_identical ? 1 : 0)
