// Composition probe: call the harness's OWN loader composition with the two anchors and print which
// bundle package directory / patch files it reads. NO plugin code is executed; this is COMPOSITION.
//
// Usage: node .tmp-mount-check/probe-anchor.mjs <profileDir>
import { createRequire } from "node:module"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

/** The sandbox profile directory the launcher would boot. */
const profileDir = resolve(process.argv[2] ?? "")
/** The global `dsh` CLI package.json — `INSTALL_ANCHOR` in lib/profile-boot-C14i-8IN.js:119. */
const INSTALL_ANCHOR = "/home/haroldzhao/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh/package.json"
const appBoot = await import(pathToFileURL("/home/haroldzhao/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js").href)

/** Package dir `resolveBundleDir` would pick for a given anchor (the loader's own function, replayed). */
function replayResolve(anchor, name) {
  for (const searchPath of createRequire(anchor).resolve.paths(name) ?? []) {
    const candidate = join(searchPath, name)
    if (existsSync(join(candidate, "package.json"))) return candidate
  }
  return ""
}

for (const [label, anchor] of [["install-anchor (global dsh CLI)", INSTALL_ANCHOR], ["profile-anchor", join(profileDir, "package.json")]]) {
  console.log("=== " + label + " ===")
  console.log("anchor=" + anchor)
  const picked = replayResolve(anchor, "@mpd-dsh/mpd")
  console.log("resolveBundleDir-like pick=" + picked + " version=" + (picked === "" ? "-" : JSON.parse(readFileSync(join(picked, "package.json"), "utf8")).version))
  try {
    const profile = appBoot.loadProfileDirectory("dsh", profileDir, anchor)
    for (const layer of profile.layers) {
      console.log("layer " + layer.packageName + " packageDir=" + layer.packageDir + " patchPaths=" + JSON.stringify(layer.patchPaths))
    }
    const composed = appBoot.composeEntries(profile.layers.flatMap((layer) => layer.patches))
    const ids = composed.map((row) => row.id)
    console.log("composed rows=" + ids.length + " mpd-cellwork present=" + String(ids.includes("mpd-cellwork")) + " mpd-bootstrap present=" + String(ids.includes("mpd-bootstrap")))
  } catch (error) {
    console.log("loadProfileDirectory FAILED: " + (error instanceof Error ? error.message : String(error)))
  }
}

// Arm 3: the per-bundle fallthrough the loader documents (install anchor FIRST, then the profile),
// simulated for the ONE bundle whose installation-level copy is stale. The other bundles keep the
// installation anchor, so this is not the reduced two-layer composition of the arm above.
{
  console.log("=== arm 3: install anchor for in-box bundles, profile anchor for @mpd-dsh/mpd ===")
  const base = appBoot.loadProfileDirectory("dsh", profileDir, INSTALL_ANCHOR)
  const profileOnly = appBoot.loadProfileDirectory("dsh", profileDir, join(profileDir, "package.json"))
  const mpdLayer = profileOnly.layers.find((layer) => layer.packageName === "@mpd-dsh/mpd")
  const mixed = base.layers.map((layer) => layer.packageName === "@mpd-dsh/mpd" ? mpdLayer : layer)
  for (const layer of mixed) console.log("layer " + layer.packageName + " packageDir=" + layer.packageDir)
  const composed = appBoot.composeEntries(mixed.flatMap((layer) => layer.patches))
  const ids = composed.map((row) => row.id)
  console.log("composed rows=" + ids.length + " mpd-cellwork present=" + String(ids.includes("mpd-cellwork")))
}
