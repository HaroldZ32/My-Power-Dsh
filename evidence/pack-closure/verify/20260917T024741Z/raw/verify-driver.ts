// t28 — INDEPENDENT verification of lanes E+F. Three artifact legs + the packed CLI + the RED
// reproduction + the harness-close claims. Every reading is recorded with the moment and the
// revision it belongs to; nothing here trusts a prior number (231/235/6/32 included).
import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "../../../../..")
const PACKED = join(REPO, "dist/mpd-package")
const GENERATED = new Set(["package.json", "cordis.patch.yml", "packages/mpd-ext-plugin/dist/validator.js"])
const WHOLESALE = ["skills", "presets", "extensions", "docs", "templates", "agent-references"]
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex")
const now = () => new Date().toISOString()
const lines = []
const log = (t) => { lines.push(t); console.log(t) }
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return { exit: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}
const report = { task: "t28", started_at: now(), repo: REPO, legs: {}, findings: [] }
const finding = (id, text, reading) => { report.findings.push({ id, text, reading }); log(`FINDING ${id}: ${text}`) }

// ── settled revision ────────────────────────────────────────────────────────────────────────
report.revision = {
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(),
  dirty_paths: execFileSync("git", ["status", "--porcelain"], { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean).length,
  fingerprints: Object.fromEntries(["packages/mpd-dsh-adapter-plugin/src/index.ts", "packages/mpd-ext-plugin/src/index.ts", "packages/mpd-team-watchdog-plugin/src/machine.ts", "packages/mpd-agent-teams-plugin/lib/tools.js", "scripts/pack-mpd.mjs", "scripts/verify-pack-closure.mjs", "scripts/mpd-ext.mjs"].map((p) => [p, sha(join(REPO, p))])),
}
log(`revision: HEAD=${report.revision.head.slice(0, 7)} dirty=${report.revision.dirty_paths} at ${now()}`)

// ── pre-flight: the freshness gate (the tree the pack will ship) ────────────────────────────
const fresh = run("node", ["scripts/verify-dist-fresh.mjs"])
report.legs.dist_freshness = { exit: fresh.exit, tail: fresh.out.trim().split("\n").slice(-3).join(" | ") }
log(`dist freshness: exit=${fresh.exit} — ${report.legs.dist_freshness.tail}`)
if (fresh.exit !== 0) {
  finding("F-1", "the packing input tree is NOT dist-fresh: the artifact ships whatever dist/ holds, so the packed workmate dist is stale at this revision (t23's routed residual: one canonical rebuild). Reported, not repaired — the dist belongs to another lane's inScope.", report.legs.dist_freshness.tail)
}

// ── the pack itself (clean state: the packer rmSync's its outDir) ────────────────────────────
const before = existsSync(PACKED) ? statSync(PACKED).mtimeMs : null
const pack = run("npm", ["run", "pack"])
report.legs.pack = { exit: pack.exit, stdout_tail: pack.out.trim().split("\n").slice(-6), out_mtime_after: statSync(PACKED).mtimeMs, out_existed_before: before !== null }
log(`npm run pack: exit=${pack.exit}; outDir mtime ${report.legs.pack.out_mtime_after}`)
if (pack.exit !== 0) finding("F-2", "`npm run pack` did not exit 0", pack.out.slice(-800))

// ── LEG (a): directional content equality, artifact -> source (3 generated files allowlisted) ─
{
  let compared = 0; const drift = []; const missingSource = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) { walk(p); continue }
      const rel = relative(PACKED, p).split("\\").join("/")
      if (GENERATED.has(rel)) continue
      compared += 1
      const src = join(REPO, rel)
      if (!existsSync(src)) missingSource.push(rel)
      else if (sha(p) !== sha(src)) drift.push(rel)
    }
  }
  walk(PACKED)
  report.legs.a_directional = { compared, drift_count: drift.length, drift, missing_source_count: missingSource.length, missing_source: missingSource }
  log(`LEG (a): compared=${compared} drift=${drift.length} no-source=${missingSource.length}`)
  for (const d of drift) log(`  drift: ${d}`)
  // The intentional rewrites must be exactly the three allowlisted files, compared against their
  // TRUE sources where one exists (the packed-form patch has no root counterpart: its source is
  // packages/mpd-bundle/cordis.patch.yml, and validator.js is generated sidecar material).
  const GENERATED_SOURCE = {
    "package.json": "package.json",
    "cordis.patch.yml": "packages/mpd-bundle/cordis.patch.yml",
    "packages/mpd-ext-plugin/dist/validator.js": null,
  }
  for (const rel of GENERATED) {
    const p = join(PACKED, rel)
    if (!existsSync(p)) { finding("F-3a", `allowlisted generated file absent from the artifact: ${rel}`, rel); continue }
    const sourceRel = GENERATED_SOURCE[rel]
    if (sourceRel === null) { log(`  generated ${rel}: present (generated sidecar, no source counterpart by design)`); continue }
    const same = sha(p) === sha(join(REPO, sourceRel))
    log(`  generated ${rel}: vs ${sourceRel} — ${same ? "identical (allowlist unnecessary)" : "differs (allowlist justified: packed-form rewrite)"}`)
  }
  if (drift.length > 0) finding("F-3", `LEG (a) drift on ${drift.length} artifact file(s): a packed copy is content-stale (pack-time vs writer timing). Each is either a pre-pack writer (re-pack fixes) or a packer bug — listed with names so the remedy is decidable.`, drift.slice(0, 40).join(", "))
  if (missingSource.length > 0) finding("F-4", `LEG (a) found ${missingSource.length} artifact file(s) with NO source counterpart (generated beyond the allowlist?)`, missingSource.slice(0, 40).join(", "))
}

// ── LEG (c): completeness over the SIX WHOLESALE groups (the captain's final scoping) ───────
{
  const perGroup = {}
  for (const g of WHOLESALE) {
    const missing = []
    const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else { const rel = relative(REPO, p).split("\\").join("/"); if (!existsSync(join(PACKED, rel))) missing.push(rel) } } }
    walk(join(REPO, g))
    perGroup[g] = { missing: missing.length, files: missing.slice(0, 10) }
  }
  report.legs.c_completeness = perGroup
  log(`LEG (c): ${JSON.stringify(Object.fromEntries(Object.entries(perGroup).map(([k, v]) => [k, v.missing])))}`)
  const total = Object.values(perGroup).reduce((n, v) => n + v.missing, 0)
  if (total > 0) finding("F-5", `LEG (c) completeness: ${total} source file(s) in the six wholesale groups are ABSENT from the artifact. Ambiguous between drift (source newer than the pack) and omission (the packer dropped it) until a pack-time record exists — that is what T-63(i)'s self-consistency map resolves, and it is not in this tree.`, JSON.stringify(perGroup))
}

// ── LEG (b): presence/name/set — the closure checker, its negative control, packed parity ───
{
  const closure = run("node", ["scripts/verify-pack-closure.mjs"])
  report.legs.b_closure = { exit: closure.exit, tail: closure.out.trim().split("\n").slice(-2).join(" | ") }
  log(`LEG (b) closure: exit=${closure.exit} — ${report.legs.b_closure.tail}`)
  if (closure.exit !== 0) finding("F-6", "`node scripts/verify-pack-closure.mjs` did not exit 0 on the clean pack", closure.out.slice(-800))

  const packedParity = run("node", ["scripts/verify-docs-parity.mjs", "--root", PACKED])
  const repoParity = run("node", ["scripts/verify-docs-parity.mjs"])
  const packedLine = packedParity.out.trim().split("\n").slice(-1)[0]
  const repoLine = repoParity.out.trim().split("\n").slice(-1)[0]
  report.legs.b_parity = { packed_exit: packedParity.exit, packed_line: packedLine, repo_exit: repoParity.exit, repo_line: repoLine }
  log(`LEG (b) parity packed: exit=${packedParity.exit} — ${packedLine}`)
  log(`LEG (b) parity repo  : exit=${repoParity.exit} — ${repoLine}`)
  if (!/pairs=37/.test(repoLine)) finding("F-7", "the repo docs parity no longer reads pairs=37", repoLine)
  if (packedParity.exit !== 0) finding("F-8", "the PACKED docs parity is red (expect 35/35 after a post-writer re-pack)", packedLine)

  // the REFERENCES seeded omission on a BYTE-COPY of the real artifact
  const copyRoot = mkdtempSync(join(tmpdir(), "t28-copy-"))
  const copy = join(copyRoot, "mpd-package")
  cpSync(PACKED, copy, { recursive: true })
  const victim = join(copy, "agent-references", "troubleshooting.md")
  rmSync(victim)
  const seeded = run("node", ["scripts/verify-pack-closure.mjs", "--source-root", REPO, "--packed", copy])
  report.legs.b_seeded_omission = { exit: seeded.exit, names_file: seeded.out.includes("troubleshooting.md"), names_kind: seeded.out.includes("REFERENCES"), tail: seeded.out.trim().split("\n").slice(-2).join(" | ") }
  log(`LEG (b) seeded omission: exit=${seeded.exit} namesFile=${seeded.out.includes("troubleshooting.md")} kind=REFERENCES:${seeded.out.includes("REFERENCES")}`)
  if (seeded.exit !== 1 || !seeded.out.includes("troubleshooting.md")) finding("F-9", "the seeded REFERENCES omission did not fail loudly naming the file", report.legs.b_seeded_omission.tail)
  rmSync(copyRoot, { recursive: true, force: true })
}

// ── byte-identity per group (diff -rq), recording exit codes and line counts ────────────────
{
  const groups = ["agent-references", "docs", "templates", "packages", "skills", "presets", "extensions", "scripts"]
  const identity = {}
  for (const g of groups) {
    const r = run("diff", ["-rq", g, join("dist/mpd-package", g)])
    const out = r.out.trim()
    const differing = out.split("\n").filter((l) => l.startsWith("Files ") )
    const onlyIn = out.split("\n").filter((l) => l.startsWith("Only in "))
    identity[g] = { exit: r.exit, lines: out === "" ? 0 : out.split("\n").length, differing: differing.length, only_in: onlyIn.length, sample: [...differing, ...onlyIn].slice(0, 8) }
  }
  const rootReadme = { exit: run("diff", ["-q", "README.md", join("dist/mpd-package", "README.md")]).exit }
  report.legs.byte_identity = { groups: identity, root_readme: rootReadme }
  log(`byte-identity: ${JSON.stringify(Object.fromEntries(Object.entries(identity).map(([k, v]) => [k, `${v.exit}/${v.lines}L(diff=${v.differing},only=${v.only_in})`])))}`)
  const unexpected = Object.entries(identity).filter(([g, v]) => ["agent-references", "docs", "templates", "skills", "presets", "extensions", "scripts"].includes(g) && v.exit !== 0)
  if (unexpected.length > 0) finding("F-10", `byte-identity red for group(s) ${unexpected.map(([g]) => g).join(", ")} — for the wholesale groups this is content drift (re-pack timing) or a packer bug`, JSON.stringify(unexpected.map(([g, v]) => [g, v.sample])))
}

// ── the packed CLI, run INSIDE the packed tree ──────────────────────────────────────────────
{
  const cli = join(PACKED, "scripts", "mpd-ext.mjs")
  const validate = run("node", [cli, "validate", join(PACKED, "extensions", "mpd-ext-example")], { cwd: PACKED })
  const selfTest = run("node", [cli, "--self-test"], { cwd: PACKED })
  const scaffoldDir = mkdtempSync(join(tmpdir(), "t28-scaffold-"))
  const scaffold = run("node", [cli, "scaffold", "verify-probe", "--dir", scaffoldDir], { cwd: PACKED })
  report.legs.cli = {
    validate: { exit: validate.exit, tail: validate.out.trim().split("\n").slice(-2).join(" | ") },
    self_test: { exit: selfTest.exit, tail: selfTest.out.trim().split("\n").slice(-2).join(" | ") },
    scaffold: { exit: scaffold.exit, tail: scaffold.out.trim().split("\n").slice(-2).join(" | "), produced: existsSync(join(scaffoldDir, "verify-probe")) ? readdirSync(join(scaffoldDir, "verify-probe")).slice(0, 8) : [] },
  }
  log(`packed CLI: validate=${validate.exit} self-test=${selfTest.exit} scaffold=${scaffold.exit}`)
  for (const [name, r] of Object.entries(report.legs.cli)) if (r.exit !== 0) finding("F-11", `packed CLI \`${name}\` exited ${r.exit} INSIDE the packed tree`, r.tail)
  rmSync(scaffoldDir, { recursive: true, force: true })
}

// ── RED: the PRE-CHANGE artifact, rebuilt read-only from HEAD ───────────────────────────────
{
  const scratch = mkdtempSync(join(tmpdir(), "t28-red-"))
  const archive = join(scratch, "tree.tar")
  const tar = run("git", ["archive", "-o", archive, "HEAD"])
  mkdirSync(join(scratch, "tree"), { recursive: true })
  const untar = run("tar", ["-xf", archive, "-C", join(scratch, "tree")])
  report.legs.red = { archive_exit: tar.exit, untar_exit: untar.exit, tree: join(scratch, "tree") }
  if (tar.exit === 0 && untar.exit === 0) {
    const redPack = run("npm", ["run", "pack"], { cwd: join(scratch, "tree") })
    const redPacked = join(scratch, "tree", "dist", "mpd-package")
    const redCli = join(redPacked, "scripts", "mpd-ext.mjs")
    report.legs.red.pack_exit = redPack.exit
    if (redPack.exit === 0 && existsSync(redCli)) {
      const redRun = run("node", [redCli, "validate", join(redPacked, "extensions", "mpd-ext-example")], { cwd: redPacked })
      report.legs.red.cli_exit = redRun.exit
      report.legs.red.cli_output = redRun.out.trim().split("\n").slice(-4)
      report.legs.red.module_not_found = /Cannot find module .*packages\/mpd-ext-plugin\/src\/registry\.ts/.test(redRun.out)
      log(`RED: pre-change packed CLI exit=${redRun.exit} module-not-found=${report.legs.red.module_not_found}`)
      log(`  ${report.legs.red.cli_output.join(" || ")}`)
      if (!report.legs.red.module_not_found) finding("F-12", "the RED reading did NOT reproduce on the pre-change artifact — the claimed pre-fix failure cannot be confirmed at HEAD", JSON.stringify(report.legs.red))
    } else finding("F-12b", "the RED tree could not be packed", redPack.out.slice(-400))
  } else finding("F-12c", "git archive/tar failed for the RED tree", JSON.stringify({ tar: tar.exit, untar: untar.exit, out: (tar.out + untar.out).slice(-300) }))
  rmSync(scratch, { recursive: true, force: true })
}

report.finished_at = now()
report.ok = report.findings.filter((f) => !["F-1", "F-5", "F-8"].includes(f.id)).length === 0
writeFileSync(join(HERE, "result.json"), JSON.stringify(report, null, 2) + "\n")
writeFileSync(join(HERE, "output.log"), lines.join("\n") + "\n")
log(`driver done at ${report.finished_at}; findings=${report.findings.length}`)
