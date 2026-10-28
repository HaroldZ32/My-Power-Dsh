// R3/R4 reproduction — the codegraph platform-bundle predicate on REAL layouts, both anchors.
//
// Why this file exists: the repair contract requires F3's disposition to rest on MEASUREMENT of a
// real layout, not on argument, with BOTH outcomes named (anchored probe accepts a healthy shim;
// the unanchored probe — the pre-repair behaviour — rejects it). This script builds those layouts on
// disk, imports BOTH the repaired resolver and the pre-repair snapshot
// (`old-bin-resolve-6d2ddc8d.ts`), and asserts the published claims. It exercises the dangerous
// direction (false REJECT of a healthy candidate) and the original bug (false ACCEPT of a shim whose
// platform bundle cannot serve), plus the win32 two-file rule from finding F1.
//
// Expected values below are the CONTRACT's claims; a mismatch exits 1.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { codegraphPlatformPackage, hasCodegraphPlatformBundle } from "../../../../packages/mpd-mcp-shared/bin-resolve.ts"
import { hasCodegraphPlatformBundle as preRepairHasCodegraphPlatformBundle } from "./old-bin-resolve-6d2ddc8d.ts"

/** The platform package name this host would install (`@colbymchenry/codegraph-<os>-<arch>`). */
const platformPackage: string = codegraphPlatformPackage(process.platform, process.arch)
/** Its path segments, so it can be joined under a `node_modules`. */
const platformParts: string[] = platformPackage.split("/")
/** The launcher file the POSIX platform package carries. */
const posixLauncher: string = join("bin", "codegraph")

/** Create a file (and its parents) and return the path. */
function touch(path: string): string {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, "")
  return path
}

/** A fresh temp root for one layout. */
function layoutRoot(name: string): string {
  return mkdtempSync(join(tmpdir(), "mpd-r3-" + name + "-"))
}

/** Count the assertions that did not match, printing each one. */
let failures = 0
/** Assert one observed value against the contract's expected value. */
function check(label: string, observed: unknown, expected: unknown): void {
  const ok = JSON.stringify(observed) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log((ok ? "PASS " : "FAIL ") + label + " :: observed=" + JSON.stringify(observed) + " expected=" + JSON.stringify(expected))
}

// ---------------------------------------------------------------------------------------------------
// 1. REAL unhoisted (nested) layout: `.bin/codegraph` is a SYMLINK into a vendor package, and the
//    platform package lives under the TARGET package's own node_modules — unreachable from `.bin`.
// ---------------------------------------------------------------------------------------------------
{
  const root: string = layoutRoot("nested")
  const vendorPkg: string = join(root, "vendor", "@colbymchenry", "codegraph")
  const shim: string = touch(join(vendorPkg, "npm-shim.js"))
  writeFileSync(join(vendorPkg, "package.json"), JSON.stringify({ name: "@colbymchenry/codegraph", bin: { codegraph: "npm-shim.js" } }))
  touch(join(vendorPkg, "node_modules", ...platformParts, posixLauncher))
  const binDir: string = join(root, "node_modules", ".bin")
  mkdirSync(binDir, { recursive: true })
  const binLink: string = join(binDir, "codegraph")
  symlinkSync(relative(binDir, shim), binLink)

  console.log("== nested layout ==")
  console.log("root=" + root)
  console.log("bin link=" + binLink + " -> " + realpathSync(binLink))
  console.log(".bin's node_modules entries=" + JSON.stringify(readdirSync(join(binDir, ".."))))
  check("nested: the link's realpath is the vendor shim", realpathSync(binLink), shim)
  check("nested: the platform package is NOT under .bin's node_modules", existsSync(join(binDir, "..", ...platformParts)), false)
  check("nested: repaired default (anchored at the link target) ACCEPTS the healthy shim", hasCodegraphPlatformBundle(binLink), true)
  check("nested: identity anchor (pre-repair search from .bin) REJECTS it — the false REJECT", hasCodegraphPlatformBundle(binLink, { anchor: (path: string): string => path }), false)
  check("nested: the PRE-REPAIR resolver REJECTS the healthy shim (the arm fails on old behaviour)", preRepairHasCodegraphPlatformBundle(binLink), false)
}

// ---------------------------------------------------------------------------------------------------
// 2. FLAT (hoisted) layout: both anchors reach the platform package, which is why the bug was hidden.
// ---------------------------------------------------------------------------------------------------
{
  const root: string = layoutRoot("flat")
  const pkg: string = join(root, "node_modules", "@colbymchenry", "codegraph")
  const shim: string = touch(join(pkg, "npm-shim.js"))
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@colbymchenry/codegraph", bin: { codegraph: "npm-shim.js" } }))
  touch(join(root, "node_modules", ...platformParts, posixLauncher))
  const binDir: string = join(root, "node_modules", ".bin")
  mkdirSync(binDir, { recursive: true })
  const binLink: string = join(binDir, "codegraph")
  symlinkSync(relative(binDir, shim), binLink)

  console.log("== flat layout (the accidental-green shape) ==")
  check("flat: repaired default accepts", hasCodegraphPlatformBundle(binLink), true)
  check("flat: identity anchor ALSO accepts (the bug hid here)", hasCodegraphPlatformBundle(binLink, { anchor: (path: string): string => path }), true)
  check("flat: pre-repair resolver accepts", preRepairHasCodegraphPlatformBundle(binLink), true)
}

// ---------------------------------------------------------------------------------------------------
// 3. BROKEN nested layout: the platform bundle is missing entirely. The repaired predicate must still
//    REJECT (the original bug — false ACCEPT — stays closed), and the capability must fall through.
// ---------------------------------------------------------------------------------------------------
{
  const root: string = layoutRoot("broken")
  const vendorPkg: string = join(root, "vendor", "@colbymchenry", "codegraph")
  const shim: string = touch(join(vendorPkg, "npm-shim.js"))
  writeFileSync(join(vendorPkg, "package.json"), JSON.stringify({ name: "@colbymchenry/codegraph", bin: { codegraph: "npm-shim.js" } }))
  const binDir: string = join(root, "node_modules", ".bin")
  mkdirSync(binDir, { recursive: true })
  const binLink: string = join(binDir, "codegraph")
  symlinkSync(relative(binDir, shim), binLink)

  console.log("== broken nested layout (no platform package) ==")
  check("broken: repaired default REJECTS the unusable shim (no false ACCEPT)", hasCodegraphPlatformBundle(binLink), false)
}

// ---------------------------------------------------------------------------------------------------
// 4. F1 — win32 needs BOTH `node.exe` and `lib/dist/bin/codegraph.js`. No Windows host exists here,
//    so the platform is INJECTED and the resolution is faked (the contract's bound); the expected
//    values are the finding's own two-file requirement.
// ---------------------------------------------------------------------------------------------------
{
  /** A resolver that answers only the specifiers ending with one of `available`. */
  const only = (...available: string[]): ((spec: string) => string | null) => (spec: string): string | null =>
    available.some((suffix: string): boolean => spec.endsWith(suffix)) ? "/pretend/present" : null
  console.log("== F1 win32 two-file rule (injected platform; BOUND: no Windows host) ==")
  check("win32: runtime only -> repaired false", hasCodegraphPlatformBundle("/pretend/npm-shim.js", { platform: "win32", arch: "x64", resolve: only("/node.exe") }), false)
  check("win32: app entry only -> repaired false", hasCodegraphPlatformBundle("/pretend/npm-shim.js", { platform: "win32", arch: "x64", resolve: only("/lib/dist/bin/codegraph.js") }), false)
  check("win32: both -> repaired true", hasCodegraphPlatformBundle("/pretend/npm-shim.js", { platform: "win32", arch: "x64", resolve: only("/node.exe", "/lib/dist/bin/codegraph.js") }), true)
  check("win32: runtime only -> PRE-REPAIR true (the false ACCEPT F1 closes)", preRepairHasCodegraphPlatformBundle("/pretend/npm-shim.js", { platform: "win32", arch: "x64", resolve: only("/node.exe") }), true)
}

console.log(failures === 0 ? "R3/R4 REPRODUCTION: PASS" : "R3/R4 REPRODUCTION: FAIL (" + failures + " mismatch(es))")
process.exit(failures === 0 ? 0 : 1)
