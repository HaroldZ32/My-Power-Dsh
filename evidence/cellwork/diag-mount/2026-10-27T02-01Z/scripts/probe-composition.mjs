// Composition probe — the row count and the `mpd-cellwork` row, measured with the harness's OWN
// loader functions and the SAME install anchor the real dsh-tui host passes
// (`profileBoot.INSTALL_ANCHOR`, read from `@deepseek-ai/dsh/profile-boot` — the module the host
// contract resolves). NO plugin code runs here: this is COMPOSITION, and it is reported as such —
// the real-boot half of the claim lives in ../boot and ../registration.
//
// Usage: node probe-composition.mjs <profileDir> <outDir>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

/** The sandbox profile directory the launcher boots. */
const profileDir = resolve(process.argv[2] ?? "")
/** Where the probe's own artifacts go. */
const outDir = resolve(process.argv[3] ?? "")
mkdirSync(outDir, { recursive: true })
/** The global dsh installation the host resolves `@deepseek-ai/dsh` from (no profile-local copy exists). */
const GLOBAL_DSH = "/home/haroldzhao/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh"
const appBoot = await import(pathToFileURL(join(GLOBAL_DSH, "node_modules/@deepseek-ai/dsh-app-boot/lib/index.js")).href)
const profileBoot = await import(pathToFileURL(join(GLOBAL_DSH, "lib/profile-boot.js")).href)
/** Lines printed and written to the log. */
const lines = []
const say = (line) => { lines.push(line); console.log(line) }

say("== the anchor the real dsh-tui host uses ==")
say("profileBoot module=" + join(GLOBAL_DSH, "lib/profile-boot.js"))
say("INSTALL_ANCHOR=" + profileBoot.INSTALL_ANCHOR)
say("profileDir=" + profileDir)
say("the profile carries no @deepseek-ai/dsh of its own: " + String(!existsSync(join(profileDir, "node_modules/@deepseek-ai/dsh/package.json"))))

/** Compose one arm: load the profile through the harness loader, then compose its patches. */
const arm = (label, installAnchor) => {
  say("")
  say("=== " + label + " ===")
  say("installAnchor=" + installAnchor)
  const profile = appBoot.loadProfileDirectory("dsh", profileDir, installAnchor)
  for (const layer of profile.layers) {
    let version = "?"
    try { version = JSON.parse(readFileSync(join(layer.packageDir, "package.json"), "utf8")).version } catch { /* unreadable */ }
    say("layer " + layer.packageName + " version=" + version)
    say("  packageDir=" + layer.packageDir)
    say("  patchPaths=" + JSON.stringify(layer.patchPaths))
  }
  say("skippedBundles=" + JSON.stringify(profile.skippedBundles))
  say("user layer patch=" + profile.patchPath + " entries=" + String(profile.patches.length))
  // The SAME two-step the boot performs: compose each layer's patches, bundle layers only —
  // last round's 152-row install-anchor arm was measured this way, so the comparison is exact.
  const composed = appBoot.composeEntries(profile.layers.flatMap((layer) => layer.patches))
  const ids = composed.map((row) => row.id)
  say("composed bundle-layer rows=" + ids.length)
  say("mpd-cellwork present=" + String(ids.includes("mpd-cellwork")))
  if (ids.includes("mpd-cellwork")) {
    const row = composed.find((entry) => entry.id === "mpd-cellwork")
    say("mpd-cellwork at composed index " + String(ids.indexOf("mpd-cellwork")) + " name=" + JSON.stringify(row.name) + " config=" + JSON.stringify(row.config))
  }
  // The full tree a real boot ends up with: bundle layers, then the profile's own user layer.
  const full = appBoot.composeEntries([...profile.layers.flatMap((layer) => layer.patches), ...profile.patches])
  const fullIds = full.map((row) => row.id)
  say("composed rows INCLUDING the profile user layer=" + fullIds.length + " mpd-cellwork present=" + String(fullIds.includes("mpd-cellwork")))
  writeFileSync(join(outDir, label + ".rows.txt"), fullIds.join("\n") + "\n")
  return { label, installAnchor, rows: ids.length, fullRows: fullIds.length, ids, fullIds, layers: profile.layers.map((layer) => ({ packageName: layer.packageName, packageDir: layer.packageDir, patchPaths: layer.patchPaths })) }
}

/** The decisive arm: the anchor the real host passes. */
const real = arm("real-install-anchor", profileBoot.INSTALL_ANCHOR)

// THE BOOT'S OWN CALL: `prepareHostRoot` calls `profileBoot.prepareProfile(profile, true, undefined)`,
// whose body is `loadProfile(NAME, name, INSTALL_ANCHOR, undefined, { userLayer: true })`. Replaying
// loadProfile with the same anchor and the sandbox DSH_HOME is that call, step for step.
say("")
say("=== boot-call-path (appBoot.loadProfile, exactly what prepareProfile runs) ===")
const dshHome = resolve(process.argv[4] ?? join(profileDir, "..", ".."))
const loaded = appBoot.loadProfile("dsh", "dsh-tui", profileBoot.INSTALL_ANCHOR, dshHome)
for (const layer of loaded.layers) say("layer " + layer.packageName + " packageDir=" + layer.packageDir)
const bootComposed = appBoot.composeEntries([...loaded.layers.flatMap((layer) => layer.patches), ...loaded.patches])
const bootIds = bootComposed.map((row) => row.id)
say("loadProfile+composeEntries rows=" + String(bootIds.length) + " mpd-cellwork present=" + String(bootIds.includes("mpd-cellwork")))
writeFileSync(join(outDir, "boot-call-path.rows.txt"), bootIds.join("\n") + "\n")

// The contrast arm: the profile as its own anchor. It is NOT a valid composition on this machine
// (the in-box `@deepseek-ai/dsh-base` resolves only through the installation), which is exactly why
// the loader consults the install anchor first — it is a control, not a second answer.
const profileOnly = arm("profile-anchor-control", join(profileDir, "package.json"))

say("")
say("== verdict ==")
say("real arm (install anchor, bundle layers) rows=" + String(real.rows) + " cellwork=" + String(real.ids.includes("mpd-cellwork")))
say("boot-call-path (the host's own loadProfile call) rows=" + String(bootIds.length) + " cellwork=" + String(bootIds.includes("mpd-cellwork")))
say("profile-anchor CONTROL rows=" + String(profileOnly.rows) + " — invalid by construction (dsh-base is installation-owned)")

writeFileSync(join(outDir, "probe-composition.log"), lines.join("\n") + "\n")
writeFileSync(join(outDir, "probe-composition.json"), JSON.stringify({ installAnchor: profileBoot.INSTALL_ANCHOR, real, profileOnly }, null, 2) + "\n")
