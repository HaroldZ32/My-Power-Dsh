// T11 ARM A: the relative-specifier audit. The CodeRabbit findings 12–14 and 16–20 are `.ts`
// extension repairs (n=16 had a `.js` specifier naming a file that does not exist), plus a same-class
// sweep of six more files. The audit reports, per named file, whether a relative specifier lacked the
// extension BEFORE the fix commit and whether it still does at HEAD — then scans every package source
// for any remaining offender.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(dirname(dirname(dirname(HERE))))

/** Every relative specifier in a source text, with the line it sits on. */
function relativeSpecifiers(text) {
  const out = []
  const patterns = [/from\s+["']([^"']+)["']/g, /import\s*\(\s*["']([^"']+)["']\s*\)/g, /require\s*\(\s*["']([^"']+)["']\s*\)/g]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const spec = match[1]
      if (!spec.startsWith("./") && !spec.startsWith("../")) continue
      const line = text.slice(0, match.index ?? 0).split("\n").length
      out.push({ spec, line })
    }
  }
  return out
}

/** The offenders in one file: relative specifiers whose target is not spelled with a `.ts`/`.cts` name. */
function offendersOf(text) {
  return relativeSpecifiers(text).filter(({ spec }) => !/\.(ts|cts|mts)$/.test(spec) && !/\.json$/.test(spec))
}

/** The files the 20 findings (and the same-class sweep) name. */
const NAMED = [
  "packages/mpd-memory-plugin/src/dshgo-cards.ts",
  "packages/mpd-memory-plugin/src/index.ts",
  "packages/mpd-team-core-plugin/src/index.ts",
  "packages/mpd-team-watchdog-plugin/src/actions.ts",
  "packages/mpd-verify-plugin/src/dshgo-cards.ts",
  "packages/mpd-verify-plugin/src/tools.ts",
  "packages/mpd-workmate-plugin/src/dshgo-cards.ts",
  "packages/mpd-workmate-plugin/src/index.ts",
  "packages/mpd-autoproject-plugin/src/boulder/dshgo-cards.ts",
  "packages/mpd-bundle-plugin/src/dshgo-panel.ts",
  "packages/mpd-bundle-plugin/src/dshgo-surfaces.ts",
  "packages/mpd-bundle-plugin/src/dshgo-team-panel.ts",
  "packages/mpd-bundle-plugin/src/dshgo-views.ts",
  "packages/mpd-bundle-plugin/src/dshgo-copy.ts",
]

/** Reads one file at a revision (`""` = the working tree). */
function atRevision(file, revision) {
  if (revision === "") return readFileSync(join(REPO, file), "utf8")
  return execFileSync("git", ["-C", REPO, "show", `${revision}:${file}`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })
}

/** Every `.ts` file under a package's src. */
function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sourceFiles(path, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(path)
  }
  return out
}

const perFile = NAMED.map((file) => {
  const before = offendersOf(atRevision(file, "HEAD~1"))
  const after = offendersOf(atRevision(file, ""))
  return { file, before: before.map((o) => `${o.spec}:${o.line}`), after: after.map((o) => `${o.spec}:${o.line}`) }
})

/** Every remaining offender across every package's source. */
const remaining = []
for (const pkg of readdirSync(join(REPO, "packages"))) {
  let files
  try {
    files = sourceFiles(join(REPO, "packages", pkg, "src"))
  } catch {
    continue
  }
  for (const file of files) {
    for (const offender of offendersOf(readFileSync(file, "utf8"))) {
      remaining.push(`${relative(REPO, file)}:${offender.line} → ${offender.spec}`)
    }
  }
}

const out = {
  at: new Date().toISOString(),
  head: execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  named: perFile,
  namedFixed: perFile.filter((entry) => entry.before.length > 0 && entry.after.length === 0).length,
  namedStillOffending: perFile.filter((entry) => entry.after.length > 0),
  remainingOffendersRepoWide: remaining,
  ok: perFile.every((entry) => entry.after.length === 0) && remaining.length === 0,
}
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
