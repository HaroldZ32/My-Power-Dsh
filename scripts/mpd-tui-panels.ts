#!/usr/bin/env node
// User-run remedy for the sidebar panel-visibility defect. Run it yourself; the bundle never does.
//
// THE DEFECT IT REPAIRS, MEASURED on the installed dsh-tui 0.13.0 on a real PTY (evidence
// `evidence/dag/dag-edges-scroll/panel-visibility/20261006T145907Z/`): a plugin panel appears in the
// sidebar only when its final id is in the `dsh-tui.sidePanel.panels` CSV, and the host does append
// every successfully registered id on registration — but roughly 4.3 s later the `dsh-tui` row
// re-applies its CONFIG value (`applySidePanelPanels(config.sidePanel?.panels)`), which is the schema
// default `todo,jobs,agents` while the user layer is unset, so the appended ids are dropped and the
// sidebar paints the host's three builtins only — the reported symptom 「只有任务/待办/代理」.
//
// WHAT IT WRITES, AND WHERE — the SETTINGS USER LAYER, which is the profile's own patch file. That
// is the host's own resolution, not a guess: `dsh-config-editor`'s `ConfigEditor` answers
// `get documentPath() { return this.ownerContext.profileContext.patchPath }`, and `dsh-app-boot`
// builds that as `join(profileDir, PROFILE_PATCH_FILENAME)`. The script READS both installed sources
// and refuses to `--apply` when it cannot prove the path (see `proveSettingsDocument`).
//
// WHY THE IDS ARE DISCOVERED RATHER THAN SPELLED. A panel's final id is `<pluginId>:<slug>`, and the
// `<pluginId>` half is the HOST's: the host composes the caller's Component identity when the caller
// has one and its own `act<N>` fallback when it does not, and a loader ROW has none. MEASURED on the
// same boot: the registered ids were `act1:team`, `act1:dag`, `act1:workmate` — NOT `mpd-tui:*`,
// which is what every document claimed before this was captured. The only authority on the id is the
// host's own registration read-back, which the adapter records on every boot to
// `<workspace>/.mpd/logs/mpd-tui-panels.json`; this script reads that, and `--ids` overrides it.
//
// SAFETY: dry-run is the DEFAULT and prints the resolved absolute path and the exact block it would
// write; a write needs `--apply`. The write is atomic and keeps a `.bak-<stamp>` copy beside the
// document. Existing tokens are never removed and never reordered — the script only APPENDS ids the
// list is missing — so a user's own panel choices survive untouched. Adding an entry for a row the
// user layer does not carry yet REPLACES that row's whole config, so the script restates the
// inherited config VERBATIM from the composing bundle patch (including any `!!js` tags) rather than
// inventing a partial one.
//
// Usage:
//   node scripts/mpd-tui-panels.ts [--dsh-home <dir>] [--profile <name>] [--workspace <dir>]
//                                  [--ids a,b,c] [--apply]
//   node scripts/mpd-tui-panels.ts --self-test
//
// Exit: 0 dry run printed / write landed; 1 for an unprovable path, unprovable ids, or a failed
//       self-test arm.

import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** The prefix on every line this helper prints, so a log line names its producer. */
const TAG = "[mpd-tui-panels]"

/** The host package whose panel ids this script enables. */
const HOST_PACKAGE = "@deepseek-harness-tui/dsh-tui"

/** The key under a row's `config` that owns the enable CSV, and the leaf this script edits. */
const PANELS_SECTION = "sidePanel"
/** The leaf key inside {@link PANELS_SECTION} carrying the comma-separated id list. */
const PANELS_KEY = "panels"

/** Where the adapter records the ids it discovered, relative to the session workspace. */
const IDS_RECORD = join(".mpd", "logs", "mpd-tui-panels.json")

/** The compiled file `dsh-app-boot` names the profile patch by, read from the installed source. */
const APP_BOOT_FILE = join("dsh-app-boot", "lib", "index.js")
/** The compiled file `dsh-config-editor` answers `documentPath` from, read from the installed source. */
const CONFIG_EDITOR_FILE = join("dsh-config-editor", "lib", "index.js")

/** One merged enable list: the CSV to write plus what changed. */
export interface PanelMerge {
  /** The CSV to write: the existing tokens in their ORIGINAL order, then every missing id. */
  csv: string
  /** The ids that were missing; empty means the document already carries all of them. */
  added: readonly string[]
  /** The ids the document already carried. */
  present: readonly string[]
  /** The tokens the document carried, before the merge. */
  existing: readonly string[]
}

/**
 * Merge the discovered panel ids into an enable CSV.
 *
 * THE INVARIANTS: never removes a token, never reorders one, and appends our ids after the user's
 * list in registration order. Tokens are trimmed and lowercased the way the host's own
 * `normalizeSidePanelPanels` does, so the merge cannot fight the host's normalizer into a second,
 * different list. This is the document-side counterpart of the adapter's `mergePanelEnableIds`
 * (`packages/mpd-tui-adapter-plugin/src/index.ts`), which holds the same two invariants at runtime.
 * @param existing - the CSV the document carries, or `undefined` when the key is absent.
 * @param ids - the panel ids to enable, in registration order.
 * @returns the CSV to write plus what was added and what was already there.
 */
export function mergePanelIds(existing: string | undefined, ids: readonly string[]): PanelMerge {
  /** The user's tokens, normalized and deduped in first-seen order. */
  const tokens: string[] = []
  for (const token of (existing ?? "").split(",")) {
    /** One normalized token; the empty string is dropped so a trailing comma adds no slot. */
    const id = token.trim().toLowerCase()
    if (id !== "" && !tokens.includes(id)) tokens.push(id)
  }
  /** The requested ids the document does not carry yet, in the order they were discovered. */
  const added = ids.map((id) => id.trim().toLowerCase()).filter((id) => id !== "" && !tokens.includes(id))
  return { csv: [...tokens, ...added].join(","), added, present: ids.filter((id) => tokens.includes(id)), existing: tokens }
}

/** A row block inside a patch document: where it starts, and the lines it owns. */
export interface PatchRowBlock {
  /** 0-based index of the `- id: <row>` line. */
  readonly start: number
  /** 0-based index one past the last line of the block. */
  readonly end: number
  /** The leading whitespace of the `- id:` line, as the block's own indentation. */
  readonly indent: string
}

/**
 * Find the LAST block declaring `id: <rowId>` in one patch document.
 *
 * The LAST declaration is the effective one: `dsh-app-boot`'s `applyEntryPatches` assigns a patch's
 * `config` onto the entry, replacing whatever an earlier layer put there — so restating the first
 * match instead of the last would resurrect a superseded config.
 * @param text - the patch document's text.
 * @param rowId - the loader entry id to find.
 * @returns the block's bounds, or `undefined` when the document declares no such row.
 */
export function findRowBlock(text: string, rowId: string): PatchRowBlock | undefined {
  /** The document's lines, stripped of the trailing `\r` a Windows checkout may carry. */
  const lines = text.split("\n").map((line) => line.replace(/\r$/u, ""))
  /** The last block found; a later one supersedes it. */
  let found: PatchRowBlock | undefined
  for (let at = 0; at < lines.length; at += 1) {
    /** This line matched against the entry header shape, capturing the indent. */
    const header = /^(\s*)- id:\s*["']?([^\s"']+)["']?\s*$/u.exec(lines[at] ?? "")
    if (header === null || header[2] !== rowId) continue
    /** The header's own indentation, which every line of the block is deeper than. */
    const indent = header[1] ?? ""
    /** One past the block's last line: the next entry at the same or a shallower indent. */
    let end = lines.length
    for (let scan = at + 1; scan < lines.length; scan += 1) {
      /** The candidate line's leading whitespace. */
      const lead = /^(\s*)/u.exec(lines[scan] ?? "")?.[1] ?? ""
      if (/^\s*- /u.test(lines[scan] ?? "") && lead.length <= indent.length) { end = scan; break }
    }
    found = { start: at, end, indent }
  }
  return found
}

/** The outcome of editing one patch document: the new text plus the enable list it now carries. */
export interface EntryEdit {
  /** The document's new text. */
  readonly text: string
  /** The CSV the edited block now carries, or `undefined` when the edit could not be made. */
  readonly csv?: string
  /** The CSV the block carried before the edit, or `undefined` when the key was absent. */
  readonly previous?: string
  /** The ONE reason no edit was made, when none was. */
  readonly detail?: string
}

/**
 * Set `sidePanel.panels` inside one row block, leaving every other line of the document untouched.
 *
 * The edit is TEXTUAL on purpose: a patch block carries `!!js` tagged scalars that a parse-and-
 * re-serialize round trip would resolve into plain values, silently changing the row's behaviour.
 * Only the one leaf is written; the indentation is taken from the block itself, so the same routine
 * serves a top-level entry and one nested inside an `insert:` list.
 * @param text - the patch document's text.
 * @param rowId - the loader entry id whose block is edited.
 * @param csv - the enable CSV to write.
 * @param create - when true, append a block for `rowId` if the document declares none.
 * @returns the new text plus what the block carried before, or the reason nothing was written.
 */
export function writePanelsIntoDocument(text: string, rowId: string, csv: string, create: boolean = false): EntryEdit {
  /** The document's lines, ending with the empty string a trailing newline produces. */
  const lines = text.split("\n").map((line) => line.replace(/\r$/u, ""))
  /** The block to edit, when the document declares the row. */
  const block = findRowBlock(text, rowId)
  if (block === undefined) {
    if (!create) return { text, detail: `the document declares no row with id ${rowId}` }
    // A NEW block is the caller's business (it must restate the inherited config); this routine only
    // reports that the row is absent so the caller can compose that block and call back.
    return { text, detail: `the document declares no row with id ${rowId}` }
  }
  /** The block's own lines. */
  const body = lines.slice(block.start, block.end)
  /** The indent of a key directly under the `- id:` header. */
  const keyIndent = `${block.indent}  `
  /** The indent of a key under `config:`, which is one level deeper than the key itself. */
  const sectionIndent = `${keyIndent}  `
  /** The indent of a key under `sidePanel:`. */
  const leafIndent = `${sectionIndent}  `
  /** The index (within `body`) of the `config:` key, when the block carries one. */
  const configAt = body.findIndex((line) => line === `${keyIndent}config:`)
  if (configAt < 0) {
    return { text, detail: `the ${rowId} block carries no plain "config:" key this script can edit` }
  }
  /** The index (within `body`) of the `sidePanel:` key, when the block carries one. */
  const sectionAt = body.findIndex((line, at) => at > configAt && line === `${sectionIndent}${PANELS_SECTION}:`)
  /** The index (within `body`) of the existing leaf, when there is one. */
  const leafAt = sectionAt < 0
    ? -1
    : body.findIndex((line, at) => at > sectionAt && line.startsWith(`${leafIndent}${PANELS_KEY}:`))
  /** The CSV the block carried before the edit, `undefined` when the leaf was absent. */
  const previous = leafAt < 0 ? undefined : /^[^:]*:\s*(.*)$/u.exec(body[leafAt] ?? "")?.[1]?.trim().replace(/^["']|["']$/gu, "")
  /** The replacement text of the leaf line. */
  const leaf = `${leafIndent}${PANELS_KEY}: ${JSON.stringify(csv)}`
  if (leafAt >= 0) body[leafAt] = leaf
  else if (sectionAt >= 0) body.splice(sectionAt + 1, 0, leaf)
  else body.splice(configAt + 1, 0, `${sectionIndent}${PANELS_SECTION}:`, leaf)
  // A block with no body edit at all would rewrite the document with identical bytes; reporting the
  // no-op keeps `--apply` from churning a file the user owns.
  /** The document with the edited block spliced back in. */
  const next = [...lines.slice(0, block.start), ...body, ...lines.slice(block.end)].join("\n")
  return next === text ? { text, csv, previous } : { text: next, csv, previous }
}

/**
 * Read the `config:` block a bundle patch declares for one row, verbatim and re-indented.
 *
 * WHY VERBATIM. Adding a user-layer entry for a row the layer does not carry replaces that row's
 * WHOLE config (`dsh-app-boot`'s `applyEntryPatches` assigns `config`, it does not merge). The row
 * that owns the sidebar therefore has to be restated including everything the host bundle declared —
 * provider, effort, fullscreen, the `!!js` expressions that read `DSH_TUI_*` — and the only faithful
 * copy of that block is the TEXT the bundle patch already carries.
 * @param patchText - one bundle patch document's text.
 * @param rowId - the loader entry id to copy.
 * @returns the block's lines, re-indented to a top-level entry, or `undefined` when it has no config.
 */
export function inheritedConfigBlock(patchText: string, rowId: string): string[] | undefined {
  /** The declaring block's bounds. */
  const block = findRowBlock(patchText, rowId)
  if (block === undefined) return undefined
  /** The block's lines, with the `- id:` header separated from the keys beneath it. */
  const body = patchText.split("\n").map((line) => line.replace(/\r$/u, "")).slice(block.start, block.end)
  /** The index of the `config:` key inside the block. */
  const configAt = body.findIndex((line) => line === `${block.indent}  config:`)
  if (configAt < 0) return undefined
  /** The lines under `config:`, up to the end of the block. */
  const raw = body.slice(configAt + 1)
  // The block may end with blank lines that belong to the file's spacing, not to the config; keeping
  // them would push a blank line into the middle of the appended entry.
  while (raw.length > 0 && (raw[raw.length - 1] ?? "").trim() === "") raw.pop()
  /** How many leading spaces to strip: the declaring block's own indent, so its keys land at 4. */
  const strip = block.indent.length
  return raw.map((line) => (line.trim() === "" ? "" : line.slice(Math.min(strip, line.length))))
}

/** One composed entry: the config block a user-layer entry must restate, and where it came from. */
export interface ComposedEntry {
  /** The config's lines, re-indented to sit two spaces under `- id: <row>`. */
  readonly block: readonly string[]
  /** The bundle patch the block was copied out of verbatim. */
  readonly source: string
}

/**
 * Compose the user-layer entry for one row out of the profile's own bundle layers.
 *
 * The layers are walked in REVERSE bundle order because a later layer's patch replaces the earlier
 * one's `config` wholesale, so the last declaration is the effective one. The block is copied as
 * TEXT: it may carry `!!js` tagged scalars (`workspace: !!js process.env.DSH_TUI_WORKSPACE_TARGET ?? undefined`)
 * that a parse-and-re-serialize round trip would resolve into plain values, silently changing what the
 * row does on the next boot.
 * @param profileDir - the installed profile directory.
 * @param rowId - the loader entry id to restate.
 * @returns the composed block plus its source file, or the ONE reason it could not be composed.
 */
export function composeEntry(profileDir: string, rowId: string): ComposedEntry | { detail: string } {
  /** The profile manifest, which lists the bundles in composition order. */
  const manifest = join(profileDir, "package.json")
  /** The declared bundle names, in order. */
  let bundles: string[] = []
  try {
    /** The parsed manifest; only `dsh.profile.bundles` is read, narrowed rather than trusted. */
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { dsh?: { profile?: { bundles?: unknown } } }
    /** The declared list, accepted only when every entry is a string. */
    const declared = parsed.dsh?.profile?.bundles
    bundles = Array.isArray(declared) ? declared.filter((entry): entry is string => typeof entry === "string") : []
  } catch {
    return { detail: `cannot read ${manifest}` }
  }
  if (bundles.length === 0) return { detail: `${manifest} declares no dsh.profile.bundles` }
  for (const bundle of [...bundles].reverse()) {
    /** The bundle's package directory inside the profile. */
    const dir = join(profileDir, "node_modules", bundle)
    try {
      /** The bundle's manifest, whose `dsh.bundle.patch` names the patch files it contributes. */
      const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { dsh?: { bundle?: { patch?: unknown } } }
      /** The declared patch entry, accepted as one path or a list of them. */
      const patches = parsed.dsh?.bundle?.patch
      /** The patch file names this bundle contributes. */
      const files = typeof patches === "string" ? [patches] : Array.isArray(patches) ? patches.filter((entry): entry is string => typeof entry === "string") : []
      for (const file of files) {
        /** The patch file's absolute path. */
        const patch = resolve(dir, file)
        try {
          /** The block this patch declares for the row, if any. */
          const block = inheritedConfigBlock(readFileSync(patch, "utf8"), rowId)
          if (block !== undefined && block.length > 0) return { block, source: patch }
        } catch {
          // An unreadable patch file is a miss; the next layer may still declare the row.
        }
      }
    } catch {
      // A bundle the profile cannot resolve is a miss for this row.
    }
  }
  return { detail: `no bundle patch of ${profileDir} declares a config block for row ${rowId}` }
}

/**
 * Append a user-layer entry for one row, keeping the document's own trailing newline.
 * @param text - the document's text.
 * @param rowId - the loader entry id.
 * @param block - the config block's lines, already indented for a top-level entry.
 * @returns the document with the entry appended.
 */
export function appendEntry(text: string, rowId: string, block: readonly string[]): string {
  /** The document's lines; a trailing newline shows up as one final empty string. */
  const lines = text.split("\n")
  /** Whether the document ended with a newline, so the appended entry lands before the empty tail. */
  const trailing = lines.length > 0 && lines[lines.length - 1] === ""
  /** Everything before that tail. */
  const head = trailing ? lines.slice(0, -1) : lines
  /** The lines that make up the new entry. */
  const entry = [`- id: ${rowId}`, "  config:", ...block]
  return [...head, ...entry, ...(trailing ? [""] : [])].join("\n")
}

/** One discovered install location: where the settings document is, and how that was proved. */export interface SettingsLocation {
  /** The resolved DSH home the profile was found under. */
  readonly dshHome: string
  /** The profile name whose settings the run targets. */
  readonly profile: string
  /** The profile directory. */
  readonly profileDir: string
  /** The absolute settings document (`<profileDir>/cordis.patch.yml`). */
  readonly document: string
  /** The loader entry id whose `config.sidePanel.panels` the document edits. */
  readonly rowId: string
  /** Why `rowId` is what it is, so a reader can check the derivation. */
  readonly rowIdSource: string
  /** The statements that PROVED the document path, each naming its source. */
  readonly proof: readonly string[]
}

/** The result of resolving the install: the location, or the reasons it could not be proved. */
export interface LocationResolution {
  /** The location, present only when every required reading succeeded. */
  readonly location?: SettingsLocation
  /** The ONE reason the run cannot proceed, when it cannot. */
  readonly detail?: string
  /** What was read while trying, so a dry run can print the whole chain. */
  readonly notes: readonly string[]
}

/** `which <name>`, resolved through symlinks; `undefined` when the tool is not on `PATH`. */
function whichReal(name: string): string | undefined {
  try {
    /** The `which` answer; an absent tool exits non-zero and is a miss. */
    const found = spawnSync("which", [name], { encoding: "utf8" })
    if (found.status !== 0) return undefined
    /** The first non-empty line. */
    const path = (found.stdout ?? "").split("\n").map((line) => line.trim()).find((line) => line !== "")
    return path === undefined ? undefined : realpathSync(path)
  } catch {
    return undefined
  }
}

/**
 * Read the profile name out of the installed TUI launcher.
 *
 * The launcher declares it (`const PROFILE = 'dsh-tui'`), so the name is taken from the host rather
 * than assumed — a launcher that renames its profile moves this script with it.
 * @returns the declared profile name, or `undefined` when the launcher cannot be read.
 */
function launcherProfile(): string | undefined {
  /** The installed launcher's real path. */
  const launcher = whichReal("dsh-tui")
  if (launcher === undefined) return undefined
  try {
    /** The launcher's source. */
    const text = readFileSync(launcher, "utf8")
    return /^const PROFILE = ['"]([^'"]+)['"]/mu.exec(text)?.[1]
  } catch {
    return undefined
  }
}

/**
 * Read the installed `dsh` package root, which is where the two proving modules live.
 * @returns the `@deepseek-ai/dsh` directory, or `undefined` when `dsh` is not installed.
 */
function installedDshRoot(): string | undefined {
  /** The `dsh` launcher's real path. */
  const dsh = whichReal("dsh")
  if (dsh === undefined) return undefined
  // `<...>/lib/node_modules/@deepseek-ai/dsh/bin/dsh.js` -> `<...>/lib/node_modules/@deepseek-ai/dsh`.
  /** The candidate package root, two levels above the `bin/` directory. */
  const root = dirname(dirname(dsh))
  return existsSync(join(root, "package.json")) ? root : undefined
}

/**
 * Prove that `<profileDir>/cordis.patch.yml` IS the host's settings user layer.
 *
 * Both readings are taken from the INSTALLED sources, so a host release that moves the settings
 * document re-judges this script instead of leaving it writing to a path nobody reads any more:
 * `dsh-app-boot` names the patch file, and `dsh-config-editor` states that the settings service's
 * `documentPath` IS that patch path. Either reading failing means the path is UNPROVED, and the
 * caller refuses to write.
 * @param dshRoot - the installed `@deepseek-ai/dsh` package root.
 * @param profileDir - the profile directory the document must sit in.
 * @returns one sentence per successful reading, or the ONE reason the path is unproved.
 */
function proveSettingsDocument(dshRoot: string, profileDir: string): { proof: string[] } | { detail: string } {
  /** The nested node_modules the installed `dsh` resolves its own dependencies from. */
  const nested = join(dshRoot, "node_modules", "@deepseek-ai")
  /** The `dsh-app-boot` source that names the profile patch file. */
  const appBoot = join(nested, APP_BOOT_FILE)
  /** The `dsh-config-editor` source that defines `documentPath`. */
  const configEditor = join(nested, CONFIG_EDITOR_FILE)
  /** The filename `dsh-app-boot` declares, read from its compiled source. */
  let filename: string | undefined
  try {
    filename = /const PROFILE_PATCH_FILENAME = "([^"]+)"/u.exec(readFileSync(appBoot, "utf8"))?.[1]
  } catch {
    return { detail: `cannot read ${appBoot} to prove the settings document path` }
  }
  if (filename === undefined) return { detail: `${appBoot} no longer declares PROFILE_PATCH_FILENAME` }
  /** The document the proof predicts. */
  const predicted = join(profileDir, filename)
  /** True when `dsh-config-editor` still answers the settings document from the profile patch path. */
  let editorAgrees = false
  try {
    /** The editor's source, read whole: the two fragments below are its own wording. */
    const text = readFileSync(configEditor, "utf8")
    editorAgrees = text.includes("get documentPath()") && text.includes("profileContext.patchPath")
  } catch {
    return { detail: `cannot read ${configEditor} to prove the settings user layer is the profile patch` }
  }
  if (!editorAgrees) return { detail: `${configEditor} no longer answers documentPath from profileContext.patchPath` }
  return {
    proof: [
      `dsh-app-boot declares PROFILE_PATCH_FILENAME=${JSON.stringify(filename)} -> ${predicted} (read from ${appBoot})`,
      `dsh-config-editor answers \`documentPath\` from \`profileContext.patchPath\` (read from ${configEditor})`,
    ],
  }
}

/**
 * Resolve the install this run targets, and PROVE the document it would write.
 * @param dshHomeArg - the `--dsh-home` value, or `undefined`.
 * @param profileArg - the `--profile` value, or `undefined`.
 * @param workspace - the workspace whose `.mpd/logs` holds the adapter's id record.
 * @returns the location, or the reason it could not be resolved.
 */
function resolveLocation(dshHomeArg: string | undefined, profileArg: string | undefined, workspace: string): LocationResolution {
  /** What was read on the way, printed by a dry run so the chain is inspectable. */
  const notes: string[] = []
  /** The DSH home: the flag, then the env key the host itself reads, then the documented default. */
  const dshHome = resolve(dshHomeArg ?? process.env.DSH_HOME ?? join(homedir(), ".dsh"))
  notes.push(`DSH home: ${dshHome}${dshHomeArg !== undefined ? " (--dsh-home)" : process.env.DSH_HOME !== undefined ? " ($DSH_HOME)" : " (default ~/.dsh)"}`)
  if (!existsSync(dshHome)) return { detail: `the DSH home ${dshHome} does not exist`, notes }
  /** The declared profile name, from the launcher or the flag. */
  const declared = launcherProfile()
  notes.push(`launcher profile: ${declared ?? "(the installed dsh-tui launcher could not be read)"}`)
  /** The profile to target. */
  const profile = profileArg ?? declared
  if (profile === undefined) return { detail: "cannot read the profile name from the installed dsh-tui launcher; pass --profile", notes }
  /** The profile directory. */
  const profileDir = join(dshHome, "profiles", profile)
  if (!existsSync(join(profileDir, "package.json"))) return { detail: `no installed profile at ${profileDir}`, notes }
  /** The installed `dsh`, whose own modules prove the settings document. */
  const dshRoot = installedDshRoot()
  if (dshRoot === undefined) return { detail: "cannot find the installed `dsh` package (needed to prove the settings document path)", notes }
  notes.push(`installed dsh: ${dshRoot}`)
  /** The path proof, or its failure. */
  const proved = proveSettingsDocument(dshRoot, profileDir)
  if ("detail" in proved) return { detail: proved.detail, notes }
  notes.push(...proved.proof)
  /** The settings document. */
  const document = join(profileDir, "cordis.patch.yml")
  if (!existsSync(document)) return { detail: `the settings document ${document} does not exist`, notes }
  /** The host package's own manifest, read for the row id fallback. */
  const hostManifest = join(profileDir, "node_modules", HOST_PACKAGE, "package.json")
  if (!existsSync(hostManifest)) return { detail: `the profile does not carry ${HOST_PACKAGE}`, notes }
  /** The document's text, scanned for a row that already owns the sidebar section. */
  const text = readFileSync(document, "utf8")
  /** Every row id the user layer declares. */
  const rowIds = [...text.matchAll(/^(\s*)- id:\s*["']?([^\s"']+)["']?\s*$/gmu)].map((match) => match[2] ?? "")
  /** The id of a declared row that already carries `sidePanel`, i.e. a row the user has edited. */
  const existingRow = rowIds.find((id) => {
    /** That row's block bounds. */
    const found = findRowBlock(text, id)
    if (found === undefined) return false
    return text.split("\n").slice(found.start, found.end).some((line) => line.trim().startsWith(`${PANELS_SECTION}:`))
  })
  /** The row id this run edits. */
  const rowId = existingRow ?? basename(HOST_PACKAGE)
  return {
    location: {
      dshHome,
      profile,
      profileDir,
      document,
      rowId,
      rowIdSource: existingRow !== undefined
        ? `the user layer already carries ${PANELS_SECTION} on this row`
        : `derived from the host package name ${HOST_PACKAGE} (the settings namespace IS the loader entry id)`,
      proof: proved.proof,
    },
    notes,
  }
}

/** Read the ids the adapter recorded for one workspace. */
interface IdRecord {
  /** The ids, in registration order. */
  readonly ids: readonly string[]
  /** The record file that produced them. */
  readonly file: string
}

/**
 * Read the adapter's panel-id record for one workspace.
 * @param workspace - the workspace root whose `.mpd/logs` is probed.
 * @returns the record, or the ONE reason it could not be read.
 */
function readIdRecord(workspace: string): IdRecord | { detail: string } {
  /** The record file. */
  const file = join(workspace, IDS_RECORD)
  try {
    /** The parsed record; the shape is narrowed rather than trusted. */
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { panelIds?: unknown }
    /** The ids, kept only when they are a non-empty array of non-empty strings. */
    const ids = Array.isArray(parsed.panelIds)
      ? parsed.panelIds.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : []
    if (ids.length === 0) return { detail: `${file} carries no panel ids` }
    return { ids, file }
  } catch {
    return { detail: `${file} is missing or unreadable` }
  }
}

/** The resolved command line of one run. */
interface Options {
  /** `--dsh-home <dir>`. */
  readonly dshHome?: string
  /** `--profile <name>`. */
  readonly profile?: string
  /** `--workspace <dir>`; defaults to the current directory. */
  readonly workspace: string
  /** `--ids a,b,c`, overriding the adapter's record. */
  readonly ids?: string
  /** `--apply`; absent means dry run. */
  readonly apply: boolean
}

/**
 * Parse this script's own command line.
 * @param argv - the process arguments after the script path.
 * @returns the resolved options.
 */
function parseArgs(argv: readonly string[]): Options {
  /** One named string argument, or `undefined`. */
  const value = (name: string): string | undefined => {
    /** The flag's index; `-1` when absent. */
    const at = argv.indexOf("--" + name)
    return at < 0 ? undefined : argv[at + 1]
  }
  return {
    ...(value("dsh-home") === undefined ? {} : { dshHome: value("dsh-home") }),
    ...(value("profile") === undefined ? {} : { profile: value("profile") }),
    workspace: resolve(value("workspace") ?? process.cwd()),
    ...(value("ids") === undefined ? {} : { ids: value("ids") }),
    apply: argv.includes("--apply"),
  }
}

/**
 * Run one remedy pass: resolve, print, and (with `--apply`) write.
 * @param argv - the process arguments after the script path.
 * @returns the process exit code.
 */
function main(argv: readonly string[]): number {
  /** The parsed command line. */
  const options = parseArgs(argv)
  /** The resolved install, or the reason it could not be resolved. */
  const resolution = resolveLocation(options.dshHome, options.profile, options.workspace)
  for (const note of resolution.notes) console.log(`${TAG} ${note}`)
  if (resolution.location === undefined) {
    console.error(`${TAG} REFUSED: ${resolution.detail ?? "the settings document path could not be proved"}`)
    return 1
  }
  /** The proved location. */
  const location = resolution.location
  for (const line of location.proof) console.log(`${TAG} proof: ${line}`)
  console.log(`${TAG} settings document: ${location.document}`)
  console.log(`${TAG} row id: ${location.rowId} — ${location.rowIdSource}`)
  /** The discovered ids: the flag wins, the adapter's record is the default. */
  const record = options.ids !== undefined
    ? { ids: options.ids.split(",").map((id) => id.trim()).filter((id) => id !== ""), file: "--ids" }
    : readIdRecord(options.workspace)
  if (!("ids" in record)) {
    console.error(`${TAG} REFUSED: ${record.detail}. Boot the TUI once (the adapter records the ids it registered) or pass --ids <a,b,c>.`)
    return 1
  }
  console.log(`${TAG} panel ids (${record.file}): ${record.ids.join(",")}`)
  /** The document's text. */
  let text = readFileSync(location.document, "utf8")
  /** The block the document already carries for the row, `undefined` when the layer has none. */
  let block = findRowBlock(text, location.rowId)
  if (block === undefined) {
    // A user layer with no entry for the row: adding one REPLACES that row's whole config, so the
    // entry is composed from the bundle layer that declares it, verbatim, before anything is written.
    /** The composed config block and its source, or the reason it could not be composed. */
    const composed = composeEntry(location.profileDir, location.rowId)
    if ("detail" in composed) {
      console.error(`${TAG} REFUSED: ${composed.detail}`)
      console.error(`${TAG}   Open /settings once (any field) so the host writes the row's own config, then re-run this script.`)
      return 1
    }
    console.log(`${TAG} no user-layer entry for ${location.rowId}: restating the config from ${composed.source}`)
    text = appendEntry(text, location.rowId, composed.block)
    block = findRowBlock(text, location.rowId)
    if (block === undefined) {
      console.error(`${TAG} REFUSED: the composed entry could not be located in the document again`)
      return 1
    }
  }
  /** The block's own lines, the window every reading below is taken from. */
  const blockLines = text.split("\n").slice(block.start, block.end)
  /** The CSV the block carries now, `undefined` when the leaf is absent. */
  const current = blockLines.find((line) => line.trim().startsWith(`${PANELS_KEY}:`))?.split(":").slice(1).join(":").trim().replace(/^["']|["']$/gu, "")
  /** The merge this run would write. */
  const merge = mergePanelIds(current, record.ids)
  if (merge.added.length === 0) {
    console.log(`${TAG} already enabled: ${merge.csv}`)
    return 0
  }
  /** The edited document. */
  const edited = writePanelsIntoDocument(text, location.rowId, merge.csv)
  if (edited.csv === undefined) {
    console.error(`${TAG} REFUSED: ${edited.detail ?? "the block could not be edited"}`)
    return 1
  }
  console.log(`${TAG} ${PANELS_KEY} (before): ${current === undefined || current === "" ? "(unset)" : current}`)
  console.log(`${TAG} ${PANELS_KEY} (after):  ${merge.csv}`)
  console.log(`${TAG} added: ${merge.added.join(",")}; kept: ${merge.existing.join(",") || "(none)"}`)
  if (!options.apply) {
    console.log(`${TAG} DRY RUN — nothing written. Re-run with --apply to write ${location.document}`)
    return 0
  }
  /** The backup taken before the write, so a bad merge is one `cp` away from undone. */
  const backup = `${location.document}.bak-${String(process.hrtime.bigint()).slice(-8)}`
  copyFileSync(location.document, backup)
  /** A sibling temp file the atomic rename replaces the document with. */
  const staged = `${location.document}.tmp-${String(process.pid)}`
  writeFileSync(staged, edited.text)
  renameSync(staged, location.document)
  console.log(`${TAG} WROTE ${location.document} (backup: ${backup})`)
  console.log(`${TAG} restart dsh-tui for the new list to compose`)
  return 0
}

/**
 * Offline self-test: the merge invariants, the entry writer, and the two host-source readings.
 *
 * Arm (d) reads the INSTALLED host: it extracts the sidebar row's own config block from the installed
 * bundle patch, so "the script restates what the host declared" is MEASURED rather than asserted. An
 * absent install makes that arm SKIP with a printed reason — never a vacuous pass.
 * @returns the process exit code.
 */
function selfTest(): number {
  /** Failed arms, in order. */
  const problems: string[] = []
  /** Records one arm's outcome. */
  const check = (label: string, ok: boolean): void => {
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`)
    if (!ok) problems.push(label)
  }
  /** The merge under test. */
  const merged = mergePanelIds("todo,jobs,agents", ["act1:team", "act1:dag", "act1:workmate"])
  check("(a) the merge appends in order without touching the user's tokens", merged.csv === "todo,jobs,agents,act1:team,act1:dag,act1:workmate")
  check("(a) a second pass is a no-op", mergePanelIds(merged.csv, ["act1:team", "act1:dag", "act1:workmate"]).added.length === 0)
  check("(a) the merge never drops an unknown id the user added", mergePanelIds("todo,jobs,agents,someone:else", ["act1:team"]).csv.includes("someone:else"))
  check("(a) duplicates collapse the way the host collapses them", mergePanelIds("todo, jobs ,todo", ["todo"]).csv === "todo,jobs")
  /** A document with the sidebar row already carrying its section. */
  const doc = ["[]", "- id: dsh-tui", "  config:", "    provider: deepseek-official", "    sidePanel:", "      open: true", ""].join("\n")
  /** That document after one edit. */
  const once = writePanelsIntoDocument(doc, "dsh-tui", "todo,jobs,agents,act1:team")
  check("(b) the leaf is inserted under the existing section", once.text.includes("      panels: \"todo,jobs,agents,act1:team\"\n"))
  check("(b) every other line survives", once.text.includes("    provider: deepseek-official") && once.text.includes("      open: true"))
  /** A second identical edit. */
  const twice = writePanelsIntoDocument(once.text, "dsh-tui", "todo,jobs,agents,act1:team")
  check("(c) a repeated edit is idempotent", twice.text === once.text)
  check("(c) the previous CSV is reported", twice.previous === "todo,jobs,agents,act1:team")
  /** A block with no `sidePanel:` at all, as the installed bundle patch has. */
  const bare = ["- id: dsh-tui", "  config:", "    provider: deepseek-official", ""].join("\n")
  check("(b) a missing section is created beside config", writePanelsIntoDocument(bare, "dsh-tui", "todo").text.includes("    sidePanel:\n      panels: \"todo\"\n"))
  check("(negative) an absent row is refused, not invented", writePanelsIntoDocument("[]\n", "dsh-tui", "todo").csv === undefined)
  // ── arm (d): the INSTALLED host's own patch is the source of the restated block ──
  try {
    /** The installed launcher's real path. */
    const launcher = whichReal("dsh-tui")
    /** The installed host package root, or `undefined`. */
    const hostRoot = launcher === undefined ? undefined : dirname(dirname(launcher))
    /** The host's own bundle patch. */
    const patch = hostRoot === undefined ? "" : join(hostRoot, "cordis.patch.yml")
    if (launcher === undefined || !existsSync(patch)) {
      console.log(`  SKIP (d) the installed ${HOST_PACKAGE} was not found: the verbatim-restatement arm cannot run`)
    } else {
      /** The row the host bundle inserts for itself, found by NAME rather than assumed. */
      const declared = [...readFileSync(patch, "utf8").matchAll(/^\s*- id:\s*([^\s]+)\s*$/gmu)].map((match) => match[1] ?? "")
      check("(d) the installed host patch declares rows at all", declared.length > 0)
      /** The sidebar-owning row, named the way this script derives it. */
      const rowId = basename(HOST_PACKAGE)
      /** The block the script would restate. */
      const block = inheritedConfigBlock(readFileSync(patch, "utf8"), rowId)
      check(`(d) the installed host patch declares ${rowId} with a config block`, block !== undefined && block.length > 0)
      check("(d) the restated block carries the host's own keys, not a guess", (block ?? []).some((line) => /^\s{4}provider:/u.test(line)))
    }
  } catch (error) {
    check(`(d) the installed host patch could be read (${String((error as Error)?.message ?? error)})`, false)
  }
  // ── arm (e): the path proof is falsifiable — a wrong profile directory must be refused ──
  try {
    /** The installed `dsh`, needed for the proof arm. */
    const dshRoot = installedDshRoot()
    if (dshRoot === undefined) {
      console.log("  SKIP (e) the installed `dsh` was not found: the path-proof arm cannot run")
    } else {
      /** A scratch profile directory with nothing in it. */
      const scratch = mkdtempSync(join(tmpdir(), "mpd-tui-panels-"))
      /** The proof over the scratch directory. */
      const proved = proveSettingsDocument(dshRoot, scratch)
      check("(e) the proof names the installed sources", "proof" in proved && proved.proof.length === 2)
      check("(e) the proof predicts a file INSIDE the profile directory", "proof" in proved && proved.proof[0]!.includes(scratch))
      /** The proof with a dsh root that has no sources, which must FAIL rather than pass vacuously. */
      const broken = proveSettingsDocument(join(scratch, "absent"), scratch)
      check("(e) NEGATIVE CONTROL: an unreadable source makes the proof fail", "detail" in broken)
      check("(e) NEGATIVE CONTROL: the refusal names the file it could not read", "detail" in broken && broken.detail.includes("dsh-app-boot"))
      check("(e) the predicted document is the file the profile template creates", "proof" in proved && proved.proof[0]!.includes("cordis.patch.yml"))
      // `statSync` is used so a missing file is an exception rather than a silent `undefined`; the
      // scratch directory itself is removed here, never the profile's own files.
      statSync(scratch)
      rmSync(scratch, { recursive: true, force: true })
    }
  } catch (error) {
    check(`(e) the path-proof arm ran (${String((error as Error)?.message ?? error)})`, false)
  }
  /** The arm's overall verdict: green only when every arm that RAN held. */
  const verdict = problems.length === 0
  console.log(`${TAG} SELF-TEST ${verdict ? "PASS" : "FAIL"} (${verdict ? "all arms held" : `${String(problems.length)} arm(s) failed`})`)
  return verdict ? 0 : 1
}

// `--self-test` runs the offline arms; anything else is a remedy pass. The guard keeps an `import`
// of this module (its self-test arms and the QA lane that drives them) from running a remedy pass by
// accident — a helper that writes a user's settings must never fire as a side effect of reading it.
/** True when this file is the process's entry point rather than an imported module. */
const isEntryPoint = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isEntryPoint) process.exit(process.argv.includes("--self-test") ? selfTest() : main(process.argv.slice(2)))
