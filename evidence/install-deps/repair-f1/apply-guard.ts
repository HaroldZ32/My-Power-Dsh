#!/usr/bin/env node
// t11 repair helper: carry ONE guard body (guard.source.txt) into BOTH carriers —
// `packages/mpd-bundle/cordis.patch.yml` (the `disabled: !!js "<json>"` scalar of the
// `mpd-better-sidebar` row) and `scripts/install-profile.mjs` (`const SIDEBAR_GUARD = "<json>"`).
// It rewrites only those two lines, prints the before/after sha256 of both files and asserts
// byte parity, so the installer's own --self-test can keep asserting the same invariant.
//
// Live-boot measurement is NOT this script's job (see ledger.mjs).
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..")
const GUARD = readFileSync(join(HERE, "guard.source.txt"), "utf8").replace(/\n$/, "")
const PATCH = join(REPO, "packages", "mpd-bundle", "cordis.patch.yml")
const INSTALLER = join(REPO, "scripts", "install-profile.mjs")
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex")

if (GUARD.includes('"') || GUARD.includes("\\") || GUARD.includes("\n")) {
  console.error("[apply-guard] FAIL: the guard body must stay a single line with no double quote and no backslash (YAML double-quoted scalar + JSON.stringify parity)")
  process.exit(1)
}
const literal = JSON.stringify(GUARD)

const before = { patch: sha(PATCH), installer: sha(INSTALLER) }
let patchText = readFileSync(PATCH, "utf8")
patchText = patchText.replace(/^ {6}disabled: !!js ".*"$/m, "      disabled: !!js " + literal)
writeFileSync(PATCH, patchText)
let installerText = readFileSync(INSTALLER, "utf8")
installerText = installerText.replace(/^const SIDEBAR_GUARD = ".*"$/m, "const SIDEBAR_GUARD = " + literal)
writeFileSync(INSTALLER, installerText)

const afterPatch = readFileSync(PATCH, "utf8")
const afterInstaller = readFileSync(INSTALLER, "utf8")
const inPatch = afterPatch.includes("disabled: !!js " + literal)
const inInstaller = afterInstaller.includes("const SIDEBAR_GUARD = " + literal)
const rowLine = afterPatch.split("\n").find((line) => line.includes("disabled: !!js "))
const report = {
  guardBytes: Buffer.byteLength(GUARD),
  guardSha256: createHash("sha256").update(GUARD).digest("hex"),
  before,
  after: { patch: sha(PATCH), installer: sha(INSTALLER) },
  parity: { inPatch, inInstaller, patchLineBytes: rowLine === undefined ? 0 : Buffer.byteLength(rowLine) },
}
console.log(JSON.stringify(report, null, 2))
if (!inPatch || !inInstaller) {
  console.error("[apply-guard] FAIL: the guard body did not land in both carriers")
  process.exit(1)
}
console.log("[apply-guard] ok: one guard body carried into the bundle patch and the installer")
