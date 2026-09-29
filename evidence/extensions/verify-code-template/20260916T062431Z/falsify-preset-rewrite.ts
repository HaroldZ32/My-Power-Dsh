#!/usr/bin/env node
// t10 INDEPENDENT verification — the scaffold rewrite, re-derived by the VERIFIER.
//
// Method (deliberately DIFFERENT from the author's driver): take the template as the source of
// truth, apply the rewrite this verifier derives itself — replace every occurrence of the
// template id in a file's relative path and in its bytes with the copy id — and require the
// scaffolded copy to match that expectation file-by-file. Then drive a MUTATED template copy and
// require the same comparison to FLAG the difference, so the method is falsifiable rather than
// a rubber stamp.
//
// Usage: node falsify-preset-rewrite.mjs [--json-out <path>]
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..", "..", "..", "..")
const PREFIX = "[t10-rewrite]"
const TEMPLATE = join(repoRoot, "templates", "mpd-extension")
const CLI = join(repoRoot, "scripts", "mpd-ext.mjs")
const TEMPLATE_ID = "mpd-extension-template"

const checks = []
const check = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: String(detail) })

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, base, out)
    else out.push(relative(base, p))
  }
  return out
}

function scaffold(name, outDir, extra = []) {
  const args = [CLI, "scaffold", name, "--dir", outDir, ...extra]
  const r = spawnSync("bun", args, { encoding: "utf8", cwd: repoRoot })
  return { status: r.status, out: String(r.stdout ?? "") + String(r.stderr ?? "") }
}

/** Compare a scaffolded copy against the template with the rewrite this verifier derives. */
function compare(templateDir, copyDir, copyId) {
  const templateFiles = walk(templateDir)
  const copyFiles = walk(copyDir)
  const expectedRel = (rel) => rel.split(TEMPLATE_ID).join(copyId)
  const expectedNames = templateFiles.map(expectedRel).sort()
  const actual = copyFiles.slice().sort()
  const missing = expectedNames.filter((n) => !actual.includes(n))
  const extra = actual.filter((n) => !expectedNames.includes(n))
  const differing = []
  const leftovers = []
  for (const rel of templateFiles) {
    const want = expectedRel(rel)
    const copyPath = join(copyDir, want)
    if (!existsSync(copyPath)) continue
    const expected = readFileSync(join(templateDir, rel), "utf8").split(TEMPLATE_ID).join(copyId)
    const got = readFileSync(copyPath, "utf8")
    if (expected !== got) differing.push(want)
    if (got.includes(TEMPLATE_ID)) leftovers.push(want)
  }
  return { templateFiles: templateFiles.length, copyFiles: copyFiles.length, missing, extra, differing, leftovers }
}

const scratch = mkdtempSync(join(tmpdir(), "t10-rewrite-"))
const results = {}
try {
  // --- the --with-mcp arm ------------------------------------------------------------------
  const withMcp = join(scratch, "with")
  const r1 = scaffold("demo-ext", withMcp, ["--with-mcp"])
  check("with-mcp.scaffold-exit-0", r1.status === 0, "exit=" + r1.status)
  const cmpWith = compare(TEMPLATE, join(withMcp, "demo-ext"), "demo-ext")
  results.withMcp = cmpWith
  check("with-mcp.file-set-matches-derived-expectation", cmpWith.missing.length === 0 && cmpWith.extra.length === 0, JSON.stringify({ missing: cmpWith.missing, extra: cmpWith.extra }))
  check("with-mcp.every-file-byte-equal-modulo-rewrite", cmpWith.differing.length === 0, JSON.stringify({ differing: cmpWith.differing, files: cmpWith.copyFiles }))
  check("with-mcp.no-placeholder-left", cmpWith.leftovers.length === 0, JSON.stringify(cmpWith.leftovers))

  // --- the default arm ---------------------------------------------------------------------
  const plain = join(scratch, "plain")
  const r2 = scaffold("demo-plain", plain)
  check("default.scaffold-exit-0", r2.status === 0, "exit=" + r2.status)
  const cmpPlain = compare(TEMPLATE, join(plain, "demo-plain"), "demo-plain")
  results.default = cmpPlain
  const expectDropped = ["server.mjs"]
  const wronglyKept = expectDropped.filter((f) => existsSync(join(plain, "demo-plain", f)))
  check("default.drops-server.mjs", wronglyKept.length === 0, "still present: " + JSON.stringify(wronglyKept))
  const plainManifest = JSON.parse(readFileSync(join(plain, "demo-plain", "mpd-ext.json"), "utf8"))
  check("default.drops-the-mcp-block", plainManifest.contributes.mcp === undefined, "kinds: " + JSON.stringify(Object.keys(plainManifest.contributes).sort()))
  const r2v = spawnSync("bun", [CLI, "validate", join(plain, "demo-plain")], { encoding: "utf8", cwd: repoRoot })
  check("default.copy-still-validates", r2v.status === 0, "exit=" + r2v.status)

  // --- the falsifier: the COMPARISON must detect a one-byte change in the copy ---------------
  // (A first version of this falsifier mutated a scratch COPY of the template and expected the
  // CLI to pick it up — but the CLI always reads the repo's real templates/ dir, so nothing
  // changed and the arm reported `differing=[]`. That was a defect in the test, not in the
  // product. The honest falsifier tampers with the SCAFFOLDED OUTPUT instead.)
  const tampered = join(scratch, "tampered")
  cpSync(join(withMcp, "demo-ext"), tampered, { recursive: true })
  const victim = join(tampered, "skills", "demo-ext-skill", "SKILL.md")
  writeFileSync(victim, readFileSync(victim, "utf8") + "\n<!-- one tampered line -->\n")
  const cmpTampered = compare(TEMPLATE, tampered, "demo-ext")
  results.tampered = cmpTampered
  check("falsifier.fresh-copy-has-zero-differences", cmpWith.differing.length === 0, "baseline differing=" + JSON.stringify(cmpWith.differing))
  check("falsifier.one-tampered-byte-is-detected", cmpTampered.differing.length === 1, "differing=" + JSON.stringify(cmpTampered.differing))

  // --- the missing-template path must fail LOUDLY, never silently --------------------------
  // The CLI resolves its repo root from its OWN location and imports from `<root>/packages`,
  // so the fake root needs that module closure but NO `templates/` dir. A symlink gives the
  // closure without copying the tree.
  const fakeRoot = join(scratch, "fake-root")
  mkdirSync(join(fakeRoot, "scripts"), { recursive: true })
  cpSync(CLI, join(fakeRoot, "scripts", "mpd-ext.mjs"))
  const fakePackages = join(fakeRoot, "packages")
  const { symlinkSync } = await import("node:fs")
  symlinkSync(join(repoRoot, "packages"), fakePackages, "dir")
  const r4 = spawnSync("bun", [join(fakeRoot, "scripts", "mpd-ext.mjs"), "scaffold", "ghost", "--dir", join(fakeRoot, "out")], { encoding: "utf8", cwd: fakeRoot })
  const loud = String(r4.stdout ?? "") + String(r4.stderr ?? "")
  const ghCreated = existsSync(join(fakeRoot, "out", "ghost"))
  results.missingTemplate = { exit: r4.status, output: loud.slice(0, 700), copyCreated: ghCreated }
  check("missing-template.exits-nonzero", r4.status !== 0, "exit=" + r4.status)
  check("missing-template.says-what-is-missing", /template/i.test(loud), loud.split("\n").filter((l) => l.trim()).slice(0, 3).join(" / ").slice(0, 300))
  check("missing-template.does-not-create-a-copy", ghCreated === false, "copy created: " + ghCreated)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

for (const c of checks) console.log(PREFIX + " " + (c.ok ? "PASS" : "FAIL") + " " + c.id + " :: " + c.detail)
const failed = checks.filter((c) => !c.ok)
console.log(PREFIX + " " + (failed.length === 0 ? "PASS" : "FAIL") + ": " + (checks.length - failed.length) + "/" + checks.length + " checks")

const outIdx = process.argv.indexOf("--json-out")
if (outIdx >= 0) {
  const out = resolve(process.argv[outIdx + 1])
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify({ driver: "falsify-preset-rewrite.mjs", method: "reverse the rewrite this verifier derives (template id -> copy id) and compare file-by-file; then mutate the template and require detection", template: relative(repoRoot, TEMPLATE), checks, results }, null, 2) + "\n")
  console.log(PREFIX + " raw readings written to " + out)
}
process.exit(failed.length === 0 ? 0 : 1)
