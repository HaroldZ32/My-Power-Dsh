#!/usr/bin/env bun
// web-card-catalog lane — STEP 1: build the isolated sandbox home.
//
// Faithful copy of the REAL installed web profile (`~/.dsh/profiles/web`) into
// `<evidence>/sandbox/dsh-home/profiles/web`, plus the sibling `<profiles>/node_modules` link farm
// the loader resolves rows through. Everything mutable lives INSIDE the sandbox: DSH_HOME, HOME and
// the workspace. The real home is only ever READ (`cp`/`readlink`), never written.
//
// Two symlinks inside the copied profile point OUT of the tree with RELATIVE targets
// (`node_modules/@mpd-dsh/mpd -> ../../../../../dshProj/my-power-dsh` and
// `node_modules/oh-my-opencode -> ../../../../dshProj/oh-my-openagent`). A copy at a different
// directory depth (T-54) breaks them, so they are REWRITTEN to the same absolute targets they
// resolve to in the real home — the copy keeps pointing at the same source trees.
//
// Credentials: `~/.dsh/settings.yaml` (declares the opencode-go provider) and
// `~/.dsh/.credentials.yaml` are copied ONCE into the sandbox. Nothing in this script or its output
// ever prints key material — credential resolution is reported as a boolean only.
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

const EVID = resolve(dirname(new URL(import.meta.url).pathname), ".")
const SAND = join(EVID, "sandbox")
const REAL = join(homedir(), ".dsh")
const DSH_HOME = join(SAND, "dsh-home")
const USER_HOME = join(SAND, "user-home")
const WS = join(SAND, "workspace")
const PROFILE_SRC = join(REAL, "profiles", "web")
const PROFILE_DST = join(DSH_HOME, "profiles", "web")

const out = { step: "sandbox", evid: EVID, sandbox: SAND, realHomeRead: REAL }
const say = (line) => { console.log("[sandbox] " + line) }

if (!existsSync(PROFILE_SRC)) {
  out.ok = false
  out.error = "the installed web profile is absent: " + PROFILE_SRC
  writeFileSync(join(EVID, "raw", "step1-sandbox.json"), JSON.stringify(out, null, 2) + "\n")
  console.log(JSON.stringify(out, null, 2))
  process.exit(2)
}

// A clean sandbox every run: the profile copy is 443 MB and a stale tree would silently mix two
// boots' state (the fixture workspace, the credential copy, the node_modules links).
rmSync(SAND, { recursive: true, force: true })
mkdirSync(DSH_HOME, { recursive: true })
mkdirSync(USER_HOME, { recursive: true })
mkdirSync(WS, { recursive: true })

// ── the profile itself ────────────────────────────────────────────────────────────────────────
const t0 = Date.now()
cpSync(PROFILE_SRC, PROFILE_DST, { recursive: true, dereference: false, verbatimSymlinks: true })
const profileCopyMs = Date.now() - t0
say("profile copied in " + String(profileCopyMs) + " ms -> " + PROFILE_DST)

// The sibling link farm (`~/.dsh/profiles/node_modules`): 196 entries, all ABSOLUTE symlinks into
// the dsh installation, so a `cp -a` is depth-safe. Kept because it is what the real home has and a
// row resolution difference between sandbox and real home would be an isolation leak in the other
// direction (an artifact of the sandbox, not of the product).
const siblingSrc = join(REAL, "profiles", "node_modules")
const siblingDst = join(DSH_HOME, "profiles", "node_modules")
let siblingCopied = false
if (existsSync(siblingSrc)) {
  cpSync(siblingSrc, siblingDst, { recursive: true, dereference: false, verbatimSymlinks: true })
  siblingCopied = true
  say("sibling profiles/node_modules copied -> " + siblingDst)
}

// ── heal the two escaping RELATIVE symlinks (T-54) ────────────────────────────────────────────
const healed = []
// `readdirSync({withFileTypes:true})` never follows a symlink, so this walk cannot loop and cannot
// escape the tree it was given.
function scanSymlinks(root) {
  const found = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) found.push(path)
      else if (entry.isDirectory()) stack.push(path)
    }
  }
  return found
}
for (const link of scanSymlinks(PROFILE_DST)) {
  const target = readlinkSync(link)
  if (target.startsWith("/")) continue
  // The SAME link in the REAL home defines where the relative target points; resolving it against
  // the COPY would land inside the sandbox (the copy sits at a different depth). So the absolute
  // destination is read from the real tree first and only then written into the copy.
  const mirror = join(PROFILE_SRC, link.slice(PROFILE_DST.length + 1))
  const resolved = lstatSync(mirror, { throwIfNoEntry: false }) !== undefined
    ? resolve(dirname(mirror), readlinkSync(mirror))
    : resolve(dirname(link), target)
  // A relative link that stays INSIDE the profile is preserved correctly by the copy (the internal
  // structure is identical), so it is left alone. Only the ones that escape the profile need the
  // absolute destination from the real tree.
  if (resolved.startsWith(PROFILE_SRC + "/")) continue
  rmSync(link, { force: true })
  symlinkSync(resolved, link)
  healed.push({ link: link.slice(SAND.length + 1), was: target, now: resolved })
}
say("healed " + String(healed.length) + " escaping relative symlink(s): " + healed.map((h) => h.now).join(", "))

// ── ONE-TIME credential/config copies ────────────────────────────────────────────────────────
const settingsSrc = join(REAL, "settings.yaml")
const credsSrc = join(REAL, ".credentials.yaml")
const settingsCopied = existsSync(settingsSrc)
const credentialsCopied = existsSync(credsSrc)
if (settingsCopied) copyFileSync(settingsSrc, join(DSH_HOME, "settings.yaml"))
if (credentialsCopied) copyFileSync(credsSrc, join(DSH_HOME, ".credentials.yaml"))

// Credential presence as a BOOLEAN only — the reference name is read, never the secret.
let credentialsCarryRef = false
if (credentialsCopied) {
  const text = await Bun.file(join(DSH_HOME, ".credentials.yaml")).text()
  credentialsCarryRef = text.includes("OPENCODE_GO_API_KEY")
}
const settingsCarryProvider = settingsCopied
  ? (await Bun.file(join(DSH_HOME, "settings.yaml")).text()).includes("opencode-go")
  : false

// ── isolation assertions (all three roots INSIDE the sandbox, none under the real home) ───────
const realHomePrefix = join(homedir(), ".dsh")
const roots = { DSH_HOME, HOME: USER_HOME, workspace: WS }
const outside = Object.entries(roots).filter(([, value]) => !value.startsWith(SAND))
const underReal = Object.entries(roots).filter(([, value]) => value === realHomePrefix || value.startsWith(realHomePrefix + "/"))
if (outside.length > 0) throw new Error("isolation assertion failed: not inside the sandbox: " + JSON.stringify(outside))
if (underReal.length > 0) throw new Error("isolation assertion failed: points at the real home: " + JSON.stringify(underReal))
if (DSH_HOME.startsWith(realHomePrefix)) throw new Error("isolation assertion failed: DSH_HOME under the real home")
mkdirSync(join(WS, ".mpd"), { recursive: true })

// The bundle must resolve to THIS repository (it is a read-only source tree, not sandbox state).
const bundleLink = join(PROFILE_DST, "node_modules", "@mpd-dsh", "mpd")
out.bundleResolvesTo = existsSync(bundleLink) ? readlinkSync(bundleLink) : "MISSING"
if (out.bundleResolvesTo !== resolve(EVID, "../../..")) {
  say("WARNING: the copied profile's bundle link does not resolve to this repository: " + out.bundleResolvesTo)
}

Object.assign(out, {
  ok: outside.length === 0 && underReal.length === 0,
  profile: { src: PROFILE_SRC, dst: PROFILE_DST, copyMs: profileCopyMs },
  siblingNodeModulesCopied: siblingCopied,
  healedSymlinks: healed,
  copies: { settingsYaml: settingsCopied, credentialsYaml: credentialsCopied },
  credentialBooleanOnly: {
    credentialsFileCopied: credentialsCopied,
    carriesOpencodeGoApiKeyRef: credentialsCarryRef,
    settingsYamlCarriesOpencodeGoProvider: settingsCarryProvider,
  },
  roots,
  isolation: { allInsideSandbox: outside.length === 0, noneUnderRealHome: underReal.length === 0 },
})
writeFileSync(join(EVID, "raw", "step1-sandbox.json"), JSON.stringify(out, null, 2) + "\n")
console.log(JSON.stringify({ ok: out.ok, sandbox: SAND, healed: healed.length, copyMs: profileCopyMs }, null, 2))
