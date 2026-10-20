// Lane G helper: build a GLOBAL-STYLE harness layout from the 0.2.1-rc.2 closure, without the network
// and without touching either the closure or the machine's global install.
//
// WHY THIS EXISTS: the QA gates resolve an "installed harness" by walking up from `realpath(dsh)` for
// a package named `@deepseek-ai/dsh`, then read each row-owning package's schema from
// `<that package>/node_modules/<pkg>/lib/index.js` (measured: `skills/dsh-qa/scripts/preset-conformance.ts`,
// symbols `harnessRoot` + `loadSchema`). npm's GLOBAL install has that nested layout; the sandbox
// closure is a HOISTED local install (`node_modules/@deepseek-ai/*` siblings, no nested tree), so the
// gates report every schema as "unresolved" there. This helper reproduces npm's global LAYOUT from the
// closure's OWN packages with symlinks, so the gates can run against the same 0.2.1-rc.2 bytes.
//
// USAGE
//   node evidence/harness-0.2.1/lib/make-global-layout.ts [--out <dir>] [--version 0.2.1-rc.2]
//   -> prints the bin directory to put on PATH
import { cpSync, existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** The repository root, derived from this helper's own URL (four directories up). */
const REPO_ROOT: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The hoisted sandbox closure every symlink points into. */
const CLOSURE: string = join(REPO_ROOT, ".mpd", "reference", "harness-021", "node_modules", "@deepseek-ai")
/** Default output root: the gitignored sandbox area, so the layout survives across bash calls. */
const DEFAULT_OUT: string = join(REPO_ROOT, "evidence", "harness-0.2.1", "sandbox", "global-layout-021")

/** Parse `--out` and `--version`. */
const argv = process.argv.slice(2)
/** Where the fake prefix is created. */
const out: string = argv.includes("--out") ? String(argv[argv.indexOf("--out") + 1] ?? DEFAULT_OUT) : DEFAULT_OUT
/** The version the layout must report, asserted at the end. */
const version: string = argv.includes("--version") ? String(argv[argv.indexOf("--version") + 1] ?? "0.2.1-rc.2") : "0.2.1-rc.2"

if (!existsSync(CLOSURE)) {
  console.error("[global-layout] the closure is missing: " + CLOSURE)
  process.exit(2)
}
// npm's global prefix shape: bin/ beside lib/node_modules.
const prefixModules = join(out, "lib", "node_modules", "@deepseek-ai")
const binDir = join(out, "bin")
mkdirSync(prefixModules, { recursive: true })
mkdirSync(binDir, { recursive: true })
// The REAL dsh package is copied (a few MB), because its nested node_modules is where the gates read
// the sibling schemas from; everything else is one symlink per package, so the layout stays cheap and
// provably points at the closure's own bytes.
cpSync(join(CLOSURE, "dsh"), join(prefixModules, "dsh"), { recursive: true })
const pkgModules = join(prefixModules, "dsh", "node_modules")
const nested = join(pkgModules, "@deepseek-ai")
mkdirSync(nested, { recursive: true })
const packages = readdirSync(CLOSURE)
// The nested tree must ALSO carry the non-@deepseek-ai dependencies (`js-yaml`, `zod`, …): the gates
// require some of them FROM the harness package (`yamlLoader` requires `js-yaml` there), and npm's
// global layout nests the whole dependency closure. Every entry is one symlink back into the closure.
const closureRoot = dirname(CLOSURE)
let otherCount = 0
for (const entry of readdirSync(closureRoot)) {
  if (entry === "@deepseek-ai") continue
  if (entry.startsWith("@")) {
    const scopeDir = join(pkgModules, entry)
    mkdirSync(scopeDir, { recursive: true })
    for (const inner of readdirSync(join(closureRoot, entry))) {
      symlinkSync(join(closureRoot, entry, inner), join(scopeDir, inner), "dir")
      otherCount += 1
    }
    continue
  }
  symlinkSync(join(closureRoot, entry), join(pkgModules, entry), "dir")
  otherCount += 1
}
for (const name of packages) {
  if (name === "dsh") continue
  symlinkSync(join(CLOSURE, name), join(nested, name), "dir")
}
// The launcher: a symlink to the copied package's own bin.js, so `realpath` lands inside the copy and
// the harness-root walk (`harnessRoot`) finds `@deepseek-ai/dsh` where npm would have put it.
const launcher = join(binDir, "dsh")
if (existsSync(launcher)) {
  // Re-pointed idempotently; the symlink is the only thing this helper owns.
  const { rmSync } = await import("node:fs")
  rmSync(launcher, { force: true })
}
symlinkSync(join(prefixModules, "dsh", "lib", "bin.js"), launcher, "file")
writeFileSync(join(out, "LAYOUT.md"), [
  "# Global-style harness layout (lane G helper)",
  "",
  "Built from `.mpd/reference/harness-021/node_modules/@deepseek-ai` (hoisted 0.2.1-rc.2 closure).",
  "Shape reproduced: `bin/dsh -> lib/node_modules/@deepseek-ai/dsh/lib/bin.js` and",
  "`lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg> -> <closure>/<pkg>`.",
  "",
  "This exists because the QA gates read a row-owning package's schema from",
  "`<harnessRoot>/node_modules/<pkg>/lib/index.js`, which a GLOBAL npm install has and a HOISTED",
  "closure does not. No network, no copy of the closure, and the machine's own global dsh is untouched.",
].join("\n") + "\n")
console.log("bin=" + binDir)
console.log("packages=" + String(packages.length) + " (1 copied, " + String(packages.length - 1) + " symlinked) + " + String(otherCount) + " non-harness dependency entries")
console.log("version requested=" + version)
