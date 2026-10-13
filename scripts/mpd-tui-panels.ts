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
// THE RELEASE THIS BUNDLE NOW TARGETS IS 0.14.0, and the defect is unchanged there: the MEASURED
// 0.14.0 boot appended the same ids (`act1:team,act1:dag,act1:workmate`) and the host's own re-apply
// dropped them again (frozen contract `F5`, `.mpd/plans/tui-014-adaptation.md`), so this remedy is
// still the user path on the installed host. The paragraph above stays the 0.13.0 measurement it was.
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
// THE RECORD'S SHAPE, AND WHY AN UNPROVABLE ONE IS REFUSED. Version 2 of that file added
// `provenance = {hostRoot, hostVersion, readBack, activation}` to `{version, panelIds, slugs, updatedAt}`,
// and version 3 adds `history` — the bounded list of ids THIS bundle registered in EARLIER boots, which
// is the ownership evidence the prune below rests on. The adapter writes a record ONLY when it can prove
// that block (`panelRecordProvenance`). The file was MEASURED polluted once (2026-10-08: a VERSION-1
// record carrying `act0:team,act0:dag,act0:workmate` — ids no real boot can compose, because the host's
// `pluginIdFor` PRE-INCREMENTS its fallback counter so the first bare activation is `act1`), and this
// script's read side would have offered to `--apply` them into the user's settings layer. So a record is
// REFUSED, naming the field that failed, when it carries no `provenance`, a blank/absent
// `provenance.hostVersion`, no `provenance.readBack`, or `provenance.activation === "act0"`. The same
// refusals gate the PAST ids this script prunes by, so a polluted record cannot make the remedy delete a
// live panel. `--ids a,b,c` stays the documented escape when the user knows the ids, and a real TUI boot
// rewrites a provable record.
//
// AN ABSENT `panels` LEAF IS SEEDED FROM THE HOST'S OWN DEFAULT, AND AN EXISTING ONE IS NEVER OVERRULED
// (2026-10-12). `sidePanel.panels` REPLACES the host's default rather than extending it, and the host
// bundle patch declares no `panels` leaf — so a profile whose user layer is unset is running on the
// module's `DEFAULT_SIDE_PANEL_IDS`. A seedless merge therefore replaced all eight builtins with our ids
// and the sidebar came up showing MPD and nothing else. Two rules now hold: the seed for an ABSENT leaf
// is the host's own CURRENT default, read from the installed module (and if it cannot be read the run
// REFUSES rather than guessing "none"); and a leaf that EXISTS is a POSITION returned byte-for-byte —
// INCLUDING one that names none of the builtins, because "every builtin is missing" and "the user removed
// every builtin" are the same bytes and an automatic repair would delete a real choice. Putting the
// builtins back is therefore an EXPLICIT act, `--restore-builtins`, never an inference.
//
// SAFETY: dry-run is the DEFAULT and prints the resolved absolute path and the exact block it would
// write; a write needs `--apply`. The write is atomic, keeps a `.bak-<stamp>` copy beside the document,
// and READS THE DOCUMENT BACK afterwards — a write whose leaf does not come back as intended exits 1 and
// names the backup, rather than announcing a success the file does not carry. Tokens are never reordered
// and never removed except for ONE class: this bundle's OWN panel ids from an EARLIER boot, recognised by
// PROVENANCE (the record's durable history of the ids it registered — never by a matching slug, which
// both deleted a foreign plugin's live `act9:team` and failed to clean our own retired `act7:dag`). A
// token that is not ours — a host builtin, another plugin's panel, even an `act<N>:<their-slug>` id — is
// preserved byte-for-byte; a foreign DEAD id lingering in the list is the accepted bound of this rule,
// because it is not ours to clean. Adding an entry for a row the user layer does not carry yet REPLACES
// that row's whole config, so the script restates the inherited config VERBATIM from the composing bundle
// patch (including any `!!js` tags) rather than inventing a partial one.
//
// Usage:
//   node scripts/mpd-tui-panels.ts [--dsh-home <dir>] [--profile <name>] [--workspace <dir>]
//                                  [--ids a,b,c] [--apply] [--restore-builtins]
//   node scripts/mpd-tui-panels.ts --self-test
//
// Exit: 0 dry run printed / write landed; 1 for an unprovable path, unprovable ids, or a failed
//       self-test arm.

import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
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
  /** The tokens this merge KEEPS, in their original order — {@link csv} minus {@link added}. */
  kept: readonly string[]
  /**
   * The tokens dropped because they name one of OUR panels from an EARLIER boot.
   *
   * The host renumbers the `<pluginId>` half of a row-registered panel on every boot, so the user layer
   * accumulates `act1:team`, `act7:team`, … and the sidebar draws a tab and a dot for each dead one. The
   * remedy script is the surface that cleans them up, so it prunes exactly these and nothing else — and
   * "these" are recognised by PROVENANCE ({@link panelTokenIsStaleMine}), never by a shared slug.
   */
  pruned: readonly string[]
}

/**
 * The id shape the host composes for a loader row's panel: `<pluginId>:<slug>` with its `act<N>` fallback.
 *
 * The same shape the adapter's own rule applies, restated here because this script is a standalone Node
 * entry point and cannot import a bundled package's source.
 */
const PANEL_ACT_ID_SHAPE = /^act\d+:/u

/**
 * Whether one token is a panel of OURS from an EARLIER boot — the only kind of token this script prunes.
 *
 * OWNERSHIP IS PROVENANCE, NEVER A SLUG (repair round R1, CodeRabbit PR #35), and it is the adapter's own
 * rule (`panelTokenIsStaleMine` in `packages/mpd-tui-adapter-plugin/src/index.ts`), restated here for the
 * reason above. The slug rule this replaced was wrong in BOTH directions at once: a foreign plugin's live
 * `act9:team` shares our `team` slug and was pruned out of the user's sidebar, while one of our OWN dead
 * ids whose page was retired or renamed matched no live slug and was never pruned at all. THE TWO
 * CONDITIONS:
 *   * the FULL id is among the record's PAST registrations (`record.past`), i.e. this bundle provably
 *     registered it in an earlier boot — the record's provenance is what makes "provably" true;
 *   * the full id is NOT one of the ids this run enables, i.e. it is not live now.
 * A foreign id fails the first condition and is therefore never pruned — even one that shares our slug,
 * and even one shaped like an `act<N>` id (the counter is the host's, not ours). ACCEPTED BOUND: a
 * foreign DEAD id lingering in the list is not ours to clean, so it stays.
 * @param token - one normalized token from the document's list.
 * @param ids - the ids this run enables, in registration order.
 * @param past - the record's bounded past registrations, oldest first.
 * @returns true when the token is ours, stale, and therefore prunable.
 */
export function panelTokenIsStaleMine(token: string, ids: readonly string[], past: readonly string[]): boolean {
  if (!PANEL_ACT_ID_SHAPE.test(token)) return false
  if (ids.includes(token)) return false
  return past.includes(token)
}

/**
 * Merge the discovered panel ids into an enable CSV, pruning OUR OWN stale ids.
 *
 * THE INVARIANTS: never reorders a token and never removes one it does not own — the user's list,
 * including other plugins' panels and the host's builtins, comes back in its original order — and our
 * ids are APPENDED after it. Tokens are trimmed and lowercased the way the host's own
 * `normalizeSidePanelPanels` does, so the merge cannot fight the host's normalizer into a second,
 * different list. The ONE removal is an id of ours from an earlier boot ({@link panelTokenIsStaleMine}),
 * which no panel can answer any more and which the host's sidebar still draws a tab and a dot for.
 *
 * This is the document-side counterpart of the adapter's `mergePanelEnableIds`
 * (`packages/mpd-tui-adapter-plugin/src/index.ts`), which holds the same invariants at runtime.
 * @param existing - the CSV the document carries, or `undefined` when the key is absent.
 * @param ids - the panel ids to enable, in registration order.
 * @param past - the record's bounded past registrations, oldest first; `[]` when none could be proved.
 * @param defaultWhenAbsent - the list an ABSENT key inherits. The host does NOT treat a missing key as
 *   "no panels": it falls back to its own schema default, so seeding from an empty list silently
 *   REPLACES every builtin. Pass {@link hostDefaultPanelCsv}; omitting it keeps the old (seedless)
 *   behaviour, which the self-test pins as a negative control.
 * @returns the CSV to write plus what was added, what was already there and what was pruned.
 */
export function mergePanelIds(existing: string | undefined, ids: readonly string[], past: readonly string[], defaultWhenAbsent?: string): PanelMerge {
  /**
   * The list this merge starts from.
   *
   * THE ABSENT-KEY SEED (user-visible defect, MEASURED 2026-10-12): with no seed, a `panels` leaf that
   * the user layer does not carry produced a list holding ONLY our ids — so the write REPLACED the
   * host's eight builtins and the sidebar showed the two MPD pages and nothing else. The host's
   * effective list for an absent key is its own default, so that is what an absent key must inherit.
   */
  const seed = existing ?? defaultWhenAbsent ?? ""
  /** The user's tokens, normalized and deduped in first-seen order. */
  const tokens: string[] = []
  for (const token of seed.split(",")) {
    /** One normalized token; the empty string is dropped so a trailing comma adds no slot. */
    const id = token.trim().toLowerCase()
    if (id !== "" && !tokens.includes(id)) tokens.push(id)
  }
  /** The ids this run enables, normalized the same way. */
  const wanted = ids.map((id) => id.trim().toLowerCase()).filter((id) => id !== "")
  /** The recorded past ids, normalized the way the document's tokens are. */
  const owned = past.map((id) => id.trim().toLowerCase()).filter((id) => id !== "")
  /** Our tokens from an earlier boot; see {@link panelTokenIsStaleMine} for why only these may go. */
  const pruned = tokens.filter((token) => panelTokenIsStaleMine(token, wanted, owned))
  /** The user's list with only those tokens removed, in its original order. */
  const kept = tokens.filter((token) => !pruned.includes(token))
  /** The requested ids the kept list does not carry yet, in the order they were discovered. */
  const added = wanted.filter((id) => !kept.includes(id))
  return { csv: [...kept, ...added].join(","), added, present: wanted.filter((id) => kept.includes(id)), existing: tokens, kept, pruned }
}

/**
 * Read the enable CSV one row block of a patch document carries.
 *
 * ONE reader for the merge's input AND for the post-write read-back, so the two can never disagree about
 * which line is the value — AND it reads the SAME path `writePanelsIntoDocument` edits, which is the
 * point rather than a coincidence (R1.6): a `panels:` key in another section of the same block is a
 * different value, and answering with it made the script report "already enabled" while the real sidebar
 * list was missing every current id. The leaf's value is everything after its first colon, unquoted.
 * @param text - the patch document's text.
 * @param rowId - the loader entry id whose block is read.
 * @returns the CSV the block carries, or `undefined` when the block or the leaf is absent.
 */
export function blockPanelCsv(text: string, rowId: string): string | undefined {
  /** The block to read, when the document declares the row. */
  const block = findRowBlock(text, rowId)
  if (block === undefined) return undefined
  /** The block's own lines. */
  const body = text.split("\n").map((line) => line.replace(/\r$/u, "")).slice(block.start, block.end)
  /** Where the sidebar leaf sits in that block, walked at the path the writer edits. */
  const site = panelsLeafSite(body, block.indent)
  if (site.leafAt < 0) return undefined
  return panelCsvValue(body[site.leafAt] ?? "")
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

/** Where the sidebar enable leaf sits inside one row block. */
interface PanelsLeafSite {
  /** The index of the `config:` key inside the block, or -1 when the block carries none. */
  readonly configAt: number
  /** The index of the `sidePanel:` key under that `config:`, or -1 when the block carries none. */
  readonly sectionAt: number
  /** The index of the `panels:` leaf under that `sidePanel:`, or -1 when the leaf is absent. */
  readonly leafAt: number
}

/**
 * Walk one row block to the leaf `writePanelsIntoDocument` edits: `config:` → `sidePanel:` → `panels:`.
 *
 * WHY THE PATH IS WALKED RATHER THAN SEARCHED. A block may carry another section's `panels:` key — the
 * same leaf NAME in a different place — and the first match in the block is not the sidebar list: reading
 * it made this script report "already enabled" while the real list was missing every current id (R1.6).
 * The walk uses the block's OWN indents, so it serves a top-level entry and one nested inside an
 * `insert:` list alike, and it STOPS where `sidePanel:` closes (a key at the section's indent or
 * shallower), so a LATER section's `panels:` cannot be read either. Blank and comment lines are
 * transparent: they close nothing.
 * @param body - the block's lines, with the trailing newline already stripped.
 * @param indent - the `- id:` header's own indentation.
 * @returns the three indexes; `-1` for each level the block does not carry.
 */
function panelsLeafSite(body: readonly string[], indent: string): PanelsLeafSite {
  /** The indent of a key directly under the `- id:` header. */
  const keyIndent = `${indent}  `
  /** The indent of a key under `config:`, which is one level deeper than the key itself. */
  const sectionIndent = `${keyIndent}  `
  /** The indent of a key under `sidePanel:`. */
  const leafIndent = `${sectionIndent}  `
  /** The `config:` key's index, which the two levels below are anchored to. */
  const configAt = body.findIndex((line) => line === `${keyIndent}config:`)
  if (configAt < 0) return { configAt: -1, sectionAt: -1, leafAt: -1 }
  /** The `sidePanel:` key's index, when the block declares one under its own `config:`. */
  const sectionAt = body.findIndex((line, at) => at > configAt && line === `${sectionIndent}${PANELS_SECTION}:`)
  if (sectionAt < 0) return { configAt, sectionAt: -1, leafAt: -1 }
  for (let at = sectionAt + 1; at < body.length; at += 1) {
    /** The line under inspection. */
    const line = body[at] ?? ""
    /** That line's trimmed text, used to let blank and comment lines through. */
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue
    /** That line's own leading whitespace. */
    const lead = /^(\s*)/u.exec(line)?.[1] ?? ""
    // A KEY AT THE SECTION'S OWN INDENT (or shallower) CLOSES `sidePanel:`: past this point a `panels:`
    // line belongs to a different section and is not the sidebar list.
    if (lead.length <= sectionIndent.length) return { configAt, sectionAt, leafAt: -1 }
    if (lead.length === leafIndent.length && line.startsWith(`${leafIndent}${PANELS_KEY}:`)) return { configAt, sectionAt, leafAt: at }
  }
  return { configAt, sectionAt, leafAt: -1 }
}

/**
 * The value of one `panels:` leaf line: everything after its first colon, unquoted.
 * @param line - the leaf's own line.
 * @returns the CSV it carries.
 */
function panelCsvValue(line: string): string {
  return line.split(":").slice(1).join(":").trim().replace(/^["']|["']$/gu, "")
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
  /** The indent of a key under `config:`, which is one level deeper than the key itself. */
  const sectionIndent = `${block.indent}    `
  /** The indent of a key under `sidePanel:`. */
  const leafIndent = `${sectionIndent}  `
  // THE SAME WALK {@link blockPanelCsv} READS WITH, so the leaf this routine writes is provably the leaf
  // the read-back compares against — a decoy `panels:` in another section is not the sidebar list (R1.6).
  /** Where the sidebar leaf sits in this block, walked at the path above. */
  const site = panelsLeafSite(body, block.indent)
  if (site.configAt < 0) {
    return { text, detail: `the ${rowId} block carries no plain "config:" key this script can edit` }
  }
  /** The index (within `body`) of the existing leaf, when there is one. */
  const leafAt = site.leafAt
  /** The CSV the block carried before the edit, `undefined` when the leaf was absent. */
  const previous = leafAt < 0 ? undefined : /^[^:]*:\s*(.*)$/u.exec(body[leafAt] ?? "")?.[1]?.trim().replace(/^["']|["']$/gu, "")
  /** The replacement text of the leaf line. */
  const leaf = `${leafIndent}${PANELS_KEY}: ${JSON.stringify(csv)}`
  if (leafAt >= 0) body[leafAt] = leaf
  else if (site.sectionAt >= 0) body.splice(site.sectionAt + 1, 0, leaf)
  else body.splice(site.configAt + 1, 0, `${sectionIndent}${PANELS_SECTION}:`, leaf)
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
 * The enable list the INSTALLED host uses when NO configuration names one — the list an absent
 * `sidePanel.panels` key therefore inherits.
 *
 * WHY THE SCRIPT MUST KNOW IT (user-visible defect, MEASURED 2026-10-12). `sidePanel.panels` REPLACES
 * the host's default rather than extending it, and the host bundle's own patch declares no `panels`
 * leaf — so a profile whose user layer is unset is running on the module's `DEFAULT_SIDE_PANEL_IDS`.
 * A write that seeded the merge from an empty list therefore replaced all eight builtins with our two
 * ids: the sidebar came up with `MPD` and `workmate` and NOTHING else. The default is read from the
 * SAME installed module the runtime adapter's `probeHostPrefs` reads, so the seed cannot drift from
 * the host the profile actually launches.
 *
 * @param profileDir - the installed profile directory.
 * @returns the host's default CSV, or `undefined` when the installed module or the constant is unreadable.
 */
function hostDefaultPanelCsv(profileDir: string): string | undefined {
  /** The installed host's display-preferences module, whose export holds the default. */
  const file = join(profileDir, "node_modules", ...HOST_PACKAGE.split("/"), "lib", "types", "tuiDisplayPrefs.js")
  try {
    /** The module's source; the default is a plain string literal in it (not a computed value). */
    const text = readFileSync(file, "utf8")
    return /DEFAULT_SIDE_PANEL_IDS\s*=\s*['"]([^'"]+)['"]/u.exec(text)?.[1]
  } catch {
    return undefined
  }
}

/** What one run starts from, and which builtins the seed had to restore. */
export interface PanelSeed {
  /** The CSV the merge must consume: the legacy default, the host's default, or the leaf's own tokens. */
  readonly seed: string
  /** The host-default ids that were MISSING and are therefore being restored. */
  readonly restored: readonly string[]
}

/**
 * Decide the list a run starts from, from the document's leaf and the host's own current default.
 *
 * TWO CASES, and the second one is a hard rule rather than a heuristic:
 *   · the leaf is ABSENT -> the host's effective list IS its default, so that default is the seed (a
 *     seedless merge would DELETE every builtin — the measured defect this seed exists to prevent);
 *   · the leaf EXISTS -> it is a POSITION and is returned BYTE-FOR-BYTE, whatever it names — INCLUDING a
 *     list that names none of the host's builtins. That case is deliberately NOT repaired automatically:
 *     "every builtin is missing" is indistinguishable from "the user removed every builtin on purpose",
 *     and an automatic guess would delete a real choice. The deliberate repair is
 *     {@link restoreMissingBuiltins}, reached only by the explicit `--restore-builtins` flag.
 *
 * @param current - the CSV the document's leaf carries, `undefined` when the leaf is absent.
 * @param hostDefault - the installed host's current default, `undefined` when it could not be read.
 * @returns the seed, or the ONE reason the run must refuse (an absent leaf with nothing to inherit).
 */
export function resolvePanelSeed(current: string | undefined, hostDefault: string | undefined): PanelSeed | { detail: string } {
  if (current !== undefined) return { seed: current, restored: [] }
  if (hostDefault === undefined) return { detail: "no `panels` leaf and no readable host default" }
  return { seed: hostDefault, restored: [] }
}

/**
 * Restore the host builtins a leaf has lost — the EXPLICIT repair, reached only by `--restore-builtins`.
 *
 * WHY THIS IS A FLAG AND NOT A RULE. A leaf that names none of the host's builtins may be a deliberate
 * removal, so nothing automatic may touch it; but a user who ASKS for the builtins back is stating the
 * intent the automatic path cannot read. The restore prepends the host's default (so the canonical
 * builtin order survives the merge's dedupe) and reports exactly which ids it put back.
 *
 * @param current - the CSV the document's leaf carries, `undefined` when the leaf is absent.
 * @param hostDefault - the installed host's current default, `undefined` when it could not be read.
 * @returns the seed to merge with the restored ids, or the ONE reason nothing can be restored.
 */
export function restoreMissingBuiltins(current: string | undefined, hostDefault: string | undefined): PanelSeed | { detail: string } {
  if (hostDefault === undefined) return { detail: "the installed host's default could not be read, so there is no builtin set to restore" }
  /** The host's default ids, in the host's own canonical order. */
  const defaults = hostDefault.split(",").map((id) => id.trim()).filter((id) => id !== "")
  /** The leaf's own tokens, normalized, so a differently-spelled builtin still counts as present. */
  const leafTokens = (current ?? "").split(",").map((token) => token.trim().toLowerCase()).filter((token) => token !== "")
  /** The defaults this leaf does not name: exactly what a restore puts back. */
  const missing = defaults.filter((id) => !leafTokens.includes(id.toLowerCase()))
  if (missing.length === 0) return { seed: current ?? hostDefault, restored: [] }
  // The FULL default goes in front, not just the missing ids: the merge dedupes by first occurrence, so
  // this is what keeps the sidebar in the host's own canonical order while the leaf's extras follow.
  return { seed: current === undefined ? hostDefault : `${hostDefault},${current}`, restored: missing }
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

/** How many directories an upward walk may climb before giving up. */
const WALK_LEVELS = 8

/**
 * Resolve one executable name the way THIS platform spells it, then follow its symlink.
 *
 * WHY IT IS NOT `which` ALONE (win32 defect, MEASURED 2026-10-12). This script refused every run on
 * Windows with `cannot read the profile name from the installed dsh-tui launcher` and `cannot find the
 * installed \`dsh\` package`, because `which` is a POSIX utility that platform does not carry: the
 * launcher AND the `dsh` package were both unresolvable, so the side-panel remedy — the documented
 * user path when the sidebar shows only builtins, or nothing at all — could not run there at all.
 * `where.exe` is the platform's own equivalent, and it answers one line per `PATHEXT` match, so EVERY
 * returned line is tried rather than only the first.
 * @param name - the executable name to resolve (`dsh`, `dsh-tui`).
 * @returns the first candidate that exists on disk with its symlinks resolved, or `undefined`.
 */
function whichReal(name: string): string | undefined {
  /** The lookup command: the platform's own equivalent of `which`. */
  const lookup = process.platform === "win32" ? "where" : "which"
  try {
    /** The lookup's answer; an absent tool exits non-zero and is a miss. */
    const found = spawnSync(lookup, [name], { encoding: "utf8" })
    if (found.error !== undefined || found.status !== 0) return undefined
    /** Every candidate the lookup printed, in its own order. */
    const lines = (found.stdout ?? "").split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== "")
    for (const line of lines) {
      try {
        if (existsSync(line)) return realpathSync(line)
      } catch {
        // An unreadable candidate is a miss; the next line may still be the tool.
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * The installed package root behind one RESOLVED launcher path, validated by its own manifest.
 *
 * TWO SHAPES reach the same package, and the platform decides which one a `which`/`where` answer is:
 *   · POSIX puts a symlink at `<root>/bin/<name>.js`, so the root is two directories up;
 *   · win32 resolves to the npm shim `%APPDATA%\npm\<name>.cmd` / `.ps1`, whose two-up answer is the
 *     global PREFIX (`%APPDATA%`) — never the package, which instead sits under that prefix's
 *     `node_modules` and is found by walking up to it.
 * The POSIX shape is tried first and the walk second, and EVERY candidate must carry a `package.json`:
 * an unvalidated guess is exactly how `dirname(dirname(launcher))` answered `%APPDATA%\Roaming` on
 * win32 and made the sidebar lane unresolvable.
 * @param launcher - a resolved launcher path.
 * @param packageName - the package name, e.g. `@deepseek-harness-tui/dsh-tui`.
 * @returns the package root, or `undefined` when neither shape resolves one.
 */
function packageRootFromLauncher(launcher: string, packageName: string): string | undefined {
  /** The candidate roots, in probe order: the POSIX two-up shape first, then the upward walk. */
  const candidates: string[] = [dirname(dirname(launcher))]
  /** The directory the walk is at, moved one level up per iteration. */
  let dir = dirname(launcher)
  for (let level = 0; level < WALK_LEVELS; level += 1) {
    candidates.push(join(dir, "node_modules", ...packageName.split("/")))
    /** The parent directory; equal to `dir` at the filesystem root, which ends the walk. */
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  for (const candidate of candidates) {
    try {
      if (existsSync(join(candidate, "package.json"))) return candidate
    } catch {
      // An unreadable candidate is a miss; the next one may still be the package.
    }
  }
  return undefined
}

/**
 * The `PROFILE` a launcher-shaped source declares.
 * @param file - the candidate source file.
 * @returns the declared profile name, or `undefined` when the file cannot be read or declares none.
 */
function profileFromFile(file: string): string | undefined {
  try {
    /** The file's source. */
    const text = readFileSync(file, "utf8")
    return /^const PROFILE = ['"]([^'"]+)['"]/mu.exec(text)?.[1]
  } catch {
    return undefined
  }
}

/**
 * Read the profile name out of the installed TUI launcher.
 *
 * The launcher declares it (`const PROFILE = 'dsh-tui'`), so the name is taken from the host rather
 * than assumed — a launcher that renames its profile moves this script with it.
 *
 * TWO SHAPES (win32 defect, measured 2026-10-12): on POSIX the resolved launcher IS that source, while
 * win32 resolves to the npm shim, which carries no declaration at all (reading the shim is why the
 * remedy reported "the installed dsh-tui launcher could not be read" there). The shim is therefore
 * followed to the host package's own `bin/dsh-tui.js`, where the declaration lives on both platforms.
 * @returns the declared profile name, or `undefined` when the launcher cannot be read.
 */
function launcherProfile(): string | undefined {
  /** The installed launcher's real path. */
  const launcher = whichReal("dsh-tui")
  if (launcher === undefined) return undefined
  // The launcher's OWN source first: the POSIX shape, and the cheapest read on either platform.
  const direct = profileFromFile(launcher)
  if (direct !== undefined) return direct
  // The win32 shim: follow it to the host package's own entry script, where the declaration lives.
  const hostRoot = packageRootFromLauncher(launcher, HOST_PACKAGE)
  return hostRoot === undefined ? undefined : profileFromFile(join(hostRoot, "bin", "dsh-tui.js"))
}

/**
 * Read the installed `dsh` package root, which is where the two proving modules live.
 * @returns the `@deepseek-ai/dsh` directory, or `undefined` when `dsh` is not installed.
 */
function installedDshRoot(): string | undefined {
  /** The `dsh` launcher's real path. */
  const dsh = whichReal("dsh")
  if (dsh === undefined) return undefined
  // The POSIX shape (`<...>/lib/node_modules/@deepseek-ai/dsh/bin/dsh.js` -> the package root) is tried
  // first inside the resolver, and the win32 shim shape is the SAME validated walk.
  return packageRootFromLauncher(dsh, "@deepseek-ai/dsh")
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
  /**
   * The ids this bundle provably registered in EARLIER boots — the ownership evidence the prune rests on.
   *
   * Version 3 of the record carries it as `history`; the record's own `panelIds` are offered as past too,
   * because they were a previous boot's live set, and the "not live now" half of the prune rule discards
   * whichever of them this run still enables. Both are filtered to the host's composed id shape and
   * deduped here, so a hand edit cannot widen what this remedy is allowed to delete.
   */
  readonly past: readonly string[]
  /** The record file that produced them. */
  readonly file: string
}

/** The version-2/3 `provenance` block of the adapter's record, as this reader narrows it. */
interface IdRecordProvenance {
  /** The installed dsh-tui package root the ids were read from. */
  readonly hostRoot?: unknown
  /** That package's own version; absent or blank means the ids cannot be traced to a release. */
  readonly hostVersion?: unknown
  /** The host read-back the ids came from, e.g. `tuiPanels.list`. */
  readonly readBack?: unknown
  /** The `<pluginId>` half every id shares, e.g. `act1`. */
  readonly activation?: unknown
}

/**
 * The ONE reason a recorded id set may not be written into a user's settings layer, or `undefined`
 * when the record is provable.
 *
 * WHY THIS EXISTS, MEASURED: on 2026-10-08 this file was `act0:team,act0:dag,act0:workmate` — ids a
 * real boot cannot compose, because the installed host's `pluginIdFor` PRE-INCREMENTS its fallback
 * counter and the first bare activation is therefore `act1`; a unit test that drove the real recorder
 * had produced them, and this script then offered them for `--apply`. These are the same conditions
 * the adapter refuses to WRITE a record under (`panelRecordProvenance`), read back on the consumer
 * side, so a polluted file can no longer reach a user's profile patch — and since repair round R1 the
 * very same check gates the PAST ids the prune rests on, so a record this refuses contributes no
 * ownership evidence at all.
 * @param provenance - the record's `provenance` block, narrowed rather than trusted.
 * @returns the refusal reason, naming the field; `undefined` when the record may be written.
 */
function unprovableProvenance(provenance: unknown): string | undefined {
  if (typeof provenance !== "object" || provenance === null) {
    return "it carries no `provenance` block (a version-1 record, whose ids cannot be traced to a boot)"
  }
  /** The block's fields, narrowed one by one below. */
  const block = provenance as IdRecordProvenance
  if (typeof block.hostRoot !== "string" || block.hostRoot.trim() === "") {
    return "its `provenance.hostRoot` is absent or blank, so the ids cannot be traced to an installed dsh-tui package"
  }
  if (typeof block.hostVersion !== "string" || block.hostVersion.trim() === "") {
    return "its `provenance.hostVersion` is absent or blank, so the ids cannot be traced to an installed dsh-tui release"
  }
  if (typeof block.readBack !== "string" || block.readBack.trim() === "") {
    return "its `provenance.readBack` is absent, so the ids cannot be traced to a host read-back"
  }
  if (block.activation === "act0") {
    return "its `provenance.activation` is `act0`, which no real boot composes (the host's `pluginIdFor` pre-increments, so the first activation is `act1`)"
  }
  return undefined
}

/**
 * Read the adapter's panel-id record for one workspace.
 * @param workspace - the workspace root whose `.mpd/logs` is probed.
 * @returns the record, or the ONE reason it could not be read OR could not be proved.
 */
function readIdRecord(workspace: string): IdRecord | { detail: string } {
  /** The record file. */
  const file = join(workspace, IDS_RECORD)
  try {
    /** The parsed record; the shape is narrowed rather than trusted. */
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { panelIds?: unknown; history?: unknown; provenance?: unknown }
    /** The ids, kept only when they are a non-empty array of non-empty strings. */
    const ids = idStringsOf(parsed.panelIds)
    if (ids.length === 0) return { detail: `${file} carries no panel ids` }
    /** The ONE reason these ids may not be offered for a write, `undefined` when they may. */
    const unprovable = unprovableProvenance(parsed.provenance)
    if (unprovable !== undefined) return { detail: `${file}: ${unprovable}` }
    // THE PAST SET IS BUILT HERE, from the SAME provable record: its `history` (version 3) plus its own
    // current ids, filtered to the shape the host composes for a loader row and deduped. A record that
    // failed the provenance check above never reaches this line, so a polluted file cannot widen the
    // prune — it is refused outright, exactly as it is for the write.
    /** The record's current ids, which were a previous boot's live set. */
    const past: string[] = []
    for (const id of [...idStringsOf(parsed.history), ...ids]) {
      /** The normalized candidate, so the comparison against the document's tokens is like-for-like. */
      const normalized = id.trim().toLowerCase()
      if (PANEL_ACT_ID_SHAPE.test(normalized) && !past.includes(normalized)) past.push(normalized)
    }
    return { ids, past, file }
  } catch {
    return { detail: `${file} is missing or unreadable` }
  }
}

/**
 * The non-empty strings of one unknown JSON field, in order.
 * @param value - the parsed field.
 * @returns its string entries, or the empty list for anything else.
 */
function idStringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : []
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
  /**
   * `--restore-builtins`: ALSO put back the host builtins a leaf has lost.
   *
   * A FLAG rather than a rule, on purpose: a leaf that names none of the builtins may be a deliberate
   * removal, so nothing automatic may repair it — only an explicit request states that intent.
   */
  readonly restoreBuiltins: boolean
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
    restoreBuiltins: argv.includes("--restore-builtins"),
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
  /** The record as read, when it could be read at all: `--ids` overrides its ids but not its past. */
  const fromRecord = readIdRecord(options.workspace)
  /** The discovered ids: the flag wins, the adapter's record is the default. */
  const record = options.ids !== undefined
    ? { ids: options.ids.split(",").map((id) => id.trim()).filter((id) => id !== ""), past: "past" in fromRecord ? fromRecord.past : [], file: "--ids" }
    : fromRecord
  if (!("ids" in record)) {
    console.error(`${TAG} REFUSED: ${record.detail}. Boot the TUI once (the adapter records the ids it registered) or pass --ids <a,b,c>.`)
    return 1
  }
  console.log(`${TAG} panel ids (${record.file}): ${record.ids.join(",")}`)
  // THE OWNERSHIP EVIDENCE, PRINTED RATHER THAN IMPLIED: a run that prunes must be readable off the
  // console, and `--ids` cannot supply it — the past comes from the record or there is none to prune by.
  console.log(`${TAG} recorded past ids: ${record.past.join(",") || (options.ids === undefined ? "(none proved)" : "(none: the record could not be proved, so nothing is pruned)")}`)
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
  /** The CSV the block carries now, `undefined` when the leaf is absent. */
  const current = blockPanelCsv(text, location.rowId)
  // THE SEED, read from the INSTALLED host module and never hard-coded: the host's current default when
  // the leaf is absent (a seedless merge would DELETE every builtin), and that SAME default restored
  // ahead of the leaf's own tokens when the leaf names NONE of them — the seedless-write damage that
  // left the sidebar showing `MPD` and only `MPD`.
  /** The installed host's current default. */
  const hostDefault = hostDefaultPanelCsv(location.profileDir)
  /**
   * The list this run starts from.
   *
   * THE AUTOMATIC PATH ONLY SEEDS AN ABSENT LEAF. An existing leaf — including one that names none of
   * the builtins — is a POSITION and is left byte-for-byte, because "every builtin is missing" cannot be
   * told apart from "the user removed every builtin". `--restore-builtins` is the EXPLICIT act that also
   * puts the missing builtins back, since only the human can state that intent.
   */
  const seed = options.restoreBuiltins ? restoreMissingBuiltins(current, hostDefault) : resolvePanelSeed(current, hostDefault)
  if ("detail" in seed) {
    console.error(`${TAG} REFUSED: ${seed.detail}`)
    console.error(`${TAG}   Seeding an empty list here would REPLACE every builtin panel; check the install of ${HOST_PACKAGE} and re-run.`)
    return 1
  }
  if (current === undefined) console.log(`${TAG} no ${PANELS_KEY} leaf in the user layer: seeding from the installed host's own default (${String(hostDefault)})`)
  if (options.restoreBuiltins) {
    console.log(seed.restored.length === 0
      ? `${TAG} --restore-builtins: every builtin the host ships is already enabled — nothing to restore`
      : `${TAG} --restore-builtins: restoring ${seed.restored.join(",")} ahead of the tokens the leaf already carries`)
  }
  /** The merge this run would write, pruning only ids the record proves are ours. */
  const merge = mergePanelIds(seed.seed, record.ids, record.past, hostDefault)
  // A PRUNE ALONE IS A REASON TO RUN (contract D1): the current ids may already be enabled while an
  // earlier boot's `act<N>:<slug>` tokens still sit in the list — that is precisely the accumulation the
  // remedy exists to clear, and an `added.length === 0` guard would print "already enabled" and stop.
  // A RESTORATION IS ONE TOO: a leaf that names no builtin at all changes the list even when every id of
  // ours is already in it, so the early exit must not swallow it.
  if (merge.added.length === 0 && merge.pruned.length === 0 && seed.restored.length === 0) {
    console.log(`${TAG} already enabled, and no stale id of ours to prune: ${merge.csv}`)
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
  console.log(`${TAG} added: ${merge.added.join(",") || "(none)"}; pruned: ${merge.pruned.join(",") || "(none)"}; kept: ${merge.kept.join(",") || "(none)"}`)
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
  // THE POST-WRITE READ-BACK (contract D1). The file on disk is read AGAIN and the leaf is compared with
  // the CSV this run intended, so a document that did not take the edit — a second `panels:` leaf the
  // editor wrote elsewhere, a rename that landed on a different inode — is reported instead of being
  // announced as a successful write. The backup taken above is named in the refusal, because the file
  // HAS been replaced and the user needs the way back.
  /** What the document on disk carries after the write. */
  const landed = blockPanelCsv(readFileSync(location.document, "utf8"), location.rowId)
  if ((landed ?? "").trim().replace(/^["']|["']$/gu, "") !== merge.csv) {
    console.error(`${TAG} REFUSED: the document read back "${landed ?? "(no panels leaf)"}" instead of the "${merge.csv}" just written. Restore ${backup} over ${location.document} to undo this run.`)
    return 1
  }
  console.log(`${TAG} WROTE ${location.document} (backup: ${backup}); read back: ${landed}`)
  console.log(`${TAG} restart dsh-tui for the new list to compose`)
  return 0
}

/**
 * Offline self-test: the merge invariants, the entry writer, the two host-source readings, and the
 * refusals of a record that cannot be proved.
 *
 * Arm (d) reads the INSTALLED host: it extracts the sidebar row's own config block from the installed
 * bundle patch, so "the script restates what the host declared" is MEASURED rather than asserted. An
 * absent install makes that arm SKIP with a printed reason — never a vacuous pass. Arm (f) drives the
 * real reader over four records that must be refused and one that must be accepted.
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
  const merged = mergePanelIds("todo,jobs,agents", ["act1:team", "act1:dag", "act1:workmate"], [])
  check("(a) the merge appends in order without touching the user's tokens", merged.csv === "todo,jobs,agents,act1:team,act1:dag,act1:workmate")
  check("(a) a second pass is a no-op", mergePanelIds(merged.csv, ["act1:team", "act1:dag", "act1:workmate"], []).added.length === 0)
  check("(a) the merge never drops an unknown id the user added", mergePanelIds("todo,jobs,agents,someone:else", ["act1:team"], []).csv.includes("someone:else"))
  check("(a) duplicates collapse the way the host collapses them", mergePanelIds("todo, jobs ,todo", ["todo"], []).csv === "todo,jobs")
  // (a) D1/D3 — the prune, and the bound it must not cross. The eight host builtins are the host's own
  // declared default CSV (`DEFAULT_SIDE_PANEL_IDS` in the installed `tuiDisplayPrefs`), spelled here so
  // the arm reads as the user clause "the original menus were swallowed".
  /** The host's eight builtin panel ids, in the host's own order. */
  const BUILTINS = "todo,jobs,agents,info,trajectory,workspace,btw,companion"
  /** A list one earlier boot left behind: every builtin, a foreign panel, and our dead ids. */
  const stale = mergePanelIds(`${BUILTINS},someone:else,act7:team,act7:dag`, ["act1:team", "act1:dag"], ["act7:team", "act7:dag"])
  check("(a) D1 our STALE act ids are pruned and the current ones take their place", stale.csv === `${BUILTINS},someone:else,act1:team,act1:dag`)
  check("(a) D1 the prune is REPORTED, not silent", stale.pruned.join(",") === "act7:team,act7:dag")
  check("(a) D3 every one of the eight builtins survives", BUILTINS.split(",").every((id) => stale.csv.split(",").includes(id)))
  check("(a) D3 a FOREIGN id shaped like an act id is never dropped", mergePanelIds("todo,act9:somebodyelse", ["act1:team"], []).csv === "todo,act9:somebodyelse,act1:team")
  check("(a) D1 a prune with nothing to append still changes the list", mergePanelIds("todo,act1:team,act7:team", ["act1:team"], ["act7:team"]).csv === "todo,act1:team")
  // (a) THE ABSENT-KEY SEED — the arm for the user-visible defect MEASURED 2026-10-12 ("the sidebar has
  // MPD and only MPD"). An absent key inherits the host's default, so the merge must KEEP every builtin;
  // the negative control is the same call with NO seed, which is exactly how the write emptied the
  // sidebar. Both halves are pinned so a fix that hard-coded the default would also redden.
  check("(a) an ABSENT leaf is seeded from the host's own default, so every builtin survives",
    mergePanelIds(undefined, ["act1:team", "act1:workmate"], [], BUILTINS).csv === `${BUILTINS},act1:team,act1:workmate`)
  check("(a) NEGATIVE CONTROL: a SEEDLESS absent leaf drops the builtins — the hazard the seed removes",
    mergePanelIds(undefined, ["act1:team"], []).csv === "act1:team")
  // (a) THE AUTOMATIC PATH NEVER OVERRULES A POSITION. A leaf that EXISTS is returned byte-for-byte,
  // INCLUDING one that names none of the host's builtins: "every builtin is missing" and "the user
  // removed every builtin" are the same bytes, so a rule that repaired it would delete a real choice.
  // No residual remains in the automatic path — the repair is the explicit flag asserted just below.
  /** A leaf that names none of the builtins: the old damage, or a deliberate removal. */
  const builtinless = "act1:team,act1:workmate"
  check("(a) a leaf naming NONE of the builtins is left BYTE-FOR-BYTE by the automatic path",
    !("detail" in resolvePanelSeed(builtinless, BUILTINS))
      && (resolvePanelSeed(builtinless, BUILTINS) as PanelSeed).seed === builtinless
      && (resolvePanelSeed(builtinless, BUILTINS) as PanelSeed).restored.length === 0)
  check("(a) so the merge writes nothing at all for it (a deliberate removal is respected)",
    mergePanelIds((resolvePanelSeed(builtinless, BUILTINS) as PanelSeed).seed, ["act1:team", "act1:workmate"], [], BUILTINS).csv === builtinless)
  // (a) THE EXPLICIT REPAIR: `--restore-builtins` is the ONLY path that puts the eight back, and only a
  // human can ask for it. It prepends the host's canonical default (the merge's dedupe keeps that order)
  // and reports exactly which ids it restored, so the act is loud and falsifiable.
  check("(a) --restore-builtins puts the whole default back AHEAD of the leaf's own tokens",
    !("detail" in restoreMissingBuiltins(builtinless, BUILTINS))
      && (restoreMissingBuiltins(builtinless, BUILTINS) as PanelSeed).seed === `${BUILTINS},${builtinless}`
      && (restoreMissingBuiltins(builtinless, BUILTINS) as PanelSeed).restored.length === BUILTINS.split(",").length)
  check("(a) --restore-builtins on a HEALTHY list is a no-op that restores nothing",
    !("detail" in restoreMissingBuiltins(`${BUILTINS},${builtinless}`, BUILTINS))
      && (restoreMissingBuiltins(`${BUILTINS},${builtinless}`, BUILTINS) as PanelSeed).restored.length === 0
      && (restoreMissingBuiltins(`${BUILTINS},${builtinless}`, BUILTINS) as PanelSeed).seed === `${BUILTINS},${builtinless}`)
  check("(a) --restore-builtins completes a PARTIAL selection, in the host's own order",
    !("detail" in restoreMissingBuiltins("todo,act1:team", BUILTINS))
      && mergePanelIds((restoreMissingBuiltins("todo,act1:team", BUILTINS) as PanelSeed).seed, ["act1:team"], [], BUILTINS).csv === `${BUILTINS},act1:team`
      && (restoreMissingBuiltins("todo,act1:team", BUILTINS) as PanelSeed).restored.length === BUILTINS.split(",").length - 1)
  check("(a) --restore-builtins REFUSES when the host default cannot be read",
    "detail" in restoreMissingBuiltins(builtinless, undefined))
  // (a) THE GUARANTEE THE USER ASKS FOR IN ONE SENTENCE: "the native TUI already had 8 panels — do not
  // lose them." The eight survive every path that can reach the merge, and a list that ALREADY holds all
  // eight plus ours is left BYTE-FOR-BYTE, so a re-run cannot rewrite (or reorder) a healthy list.
  check("(a) all EIGHT builtins survive every path (absent leaf, explicit restore, healthy list)",
    [mergePanelIds(undefined, ["act1:team"], [], BUILTINS).csv,
      mergePanelIds((restoreMissingBuiltins(builtinless, BUILTINS) as PanelSeed).seed, ["act1:team"], [], BUILTINS).csv,
      mergePanelIds(`${BUILTINS},act1:team`, ["act1:team"], [], BUILTINS).csv]
      .every((csv) => BUILTINS.split(",").every((id) => csv.split(",").includes(id))))
  check("(a) a FULLY repaired list (all eight + ours) is a NO-OP, not a rewrite",
    mergePanelIds(`${BUILTINS},act1:team,act1:workmate`, ["act1:team", "act1:workmate"], [], BUILTINS).csv === `${BUILTINS},act1:team,act1:workmate`)
  check("(a) and its AUTOMATIC SEED is that same list untouched — nothing is restored",
    !("detail" in resolvePanelSeed(`${BUILTINS},act1:team,act1:workmate`, BUILTINS))
      && (resolvePanelSeed(`${BUILTINS},act1:team,act1:workmate`, BUILTINS) as PanelSeed).seed === `${BUILTINS},act1:team,act1:workmate`
      && (resolvePanelSeed(`${BUILTINS},act1:team,act1:workmate`, BUILTINS) as PanelSeed).restored.length === 0)
  check("(a) CONTROL: a PARTIAL builtin selection is a position and is left byte-for-byte",
    !("detail" in resolvePanelSeed("todo,act1:team", BUILTINS)) && (resolvePanelSeed("todo,act1:team", BUILTINS) as PanelSeed).seed === "todo,act1:team")
  check("(a) CONTROL: with no readable host default an ABSENT leaf REFUSES rather than seeding empty",
    "detail" in resolvePanelSeed(undefined, undefined))
  check("(a) an EXISTING leaf is still usable when the host default cannot be read",
    !("detail" in resolvePanelSeed("act1:team", undefined)) && (resolvePanelSeed("act1:team", undefined) as PanelSeed).seed === "act1:team")
  /** A document whose sidebar row already carries its section, with a stale id in the leaf. */
  const staleDoc = ["[]", "- id: dsh-tui", "  config:", "    sidePanel:", `      panels: "${BUILTINS},act7:team"`, ""].join("\n")
  check("(a) D1 the document reader answers the leaf the merge consumes", blockPanelCsv(staleDoc, "dsh-tui") === `${BUILTINS},act7:team`)
  /** That document after the prune + append. */
  const staleEdited = writePanelsIntoDocument(staleDoc, "dsh-tui", mergePanelIds(blockPanelCsv(staleDoc, "dsh-tui"), ["act1:team"], ["act7:team"]).csv)
  check("(a) D1 the READ-BACK of an edited document equals the CSV that was written", blockPanelCsv(staleEdited.text, "dsh-tui") === `${BUILTINS},act1:team`)
  check("(a) D1 the read-back names its own failure on an unedited document", blockPanelCsv(staleDoc, "dsh-tui") !== `${BUILTINS},act1:team`)
  // ── R1.1/R1.2 (repair round R1): ownership by PROVENANCE, never by a slug ──
  //
  // The record's bounded PAST registrations are the ownership evidence; a token whose slug merely looks
  // like ours is NOT ours, and one of our ids whose slug is no longer registered IS. Both directions are
  // pinned here because the old rule got both wrong.
  /** The record's past registrations, as `readIdRecord` hands them to the merge. */
  const recordedPast = ["act1:team", "act7:dag"]
  check("(R1.1) a LIVE foreign `act9:team` beside our `act7:team` is never pruned", mergePanelIds("todo,act9:team,act7:team", ["act7:team"], recordedPast).csv === "todo,act9:team,act7:team")
  check("(R1.1) a never-ours act-shaped token is never pruned", mergePanelIds("todo,act5:somebodyelse", ["act1:team"], recordedPast).csv === "todo,act5:somebodyelse,act1:team")
  /** The prune R1.2 is about: our dead id and a retired page's id, both in the record's past. */
  const owned = mergePanelIds("todo,act1:team,act7:dag", ["act7:team"], recordedPast)
  check("(R1.2) our DEAD recorded ids are pruned and the live one takes their place", owned.csv === "todo,act7:team")
  check("(R1.2) the prune is REPORTED, not silent", owned.pruned.join(",") === "act1:team,act7:dag")
  // ── R1.6: the reader answers the leaf `writePanelsIntoDocument` EDITS ──
  //
  // The leaf is `config.sidePanel.panels` and NOTHING else: another section's `panels:` key — before or
  // after `sidePanel:`, at the same or a deeper indent — is a different value, and reading it made this
  // script report "already enabled" while the real sidebar list was missing the current ids.
  /** A document whose row carries ANOTHER section's `panels:` key BEFORE `sidePanel:`. */
  const decoyDoc = ["[]", "- id: dsh-tui", "  config:", "    other:", "      panels: \"todo,jobs\"", "    sidePanel:", "      panels: \"todo,act1:team\"", ""].join("\n")
  check("(R1.6) the reader skips another section's earlier `panels:` leaf", blockPanelCsv(decoyDoc, "dsh-tui") === "todo,act1:team")
  check("(R1.6) ... so a missing current id is NOT reported as already enabled", mergePanelIds(blockPanelCsv(decoyDoc, "dsh-tui"), ["todo", "act1:team", "act9:team"], []).added.join(",") === "act9:team")
  /** That decoy document after the merge this run would write. */
  const decoyEdited = writePanelsIntoDocument(decoyDoc, "dsh-tui", "todo,act1:team,act9:team")
  check("(R1.6) the write lands in the real leaf and the READ-BACK agrees", blockPanelCsv(decoyEdited.text, "dsh-tui") === "todo,act1:team,act9:team")
  /** A document whose row carries a LATER section's `panels:` key after the real one. */
  const trailerDoc = ["[]", "- id: dsh-tui", "  config:", "    sidePanel:", "      panels: \"todo,act1:team\"", "    trailer:", "      panels: \"todo,jobs\"", ""].join("\n")
  check("(R1.6) a LATER section's `panels:` leaf is not read either", blockPanelCsv(trailerDoc, "dsh-tui") === "todo,act1:team")
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
    const hostRoot = launcher === undefined ? undefined : packageRootFromLauncher(launcher, HOST_PACKAGE)
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
  // ── arm (f): the reader refuses a record that cannot be PROVED, and accepts a provable one ──
  try {
    /** A scratch workspace whose `.mpd/logs` carries one record at a time. */
    const scratch = mkdtempSync(join(tmpdir(), "mpd-tui-panels-record-"))
    /** Writes one record into that workspace and reports what the real reader made of it. */
    const read = (record: unknown): string => {
      /** The record's own path inside the scratch workspace. */
      const file = join(scratch, IDS_RECORD)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(record, undefined, 2))
      /** What {@link readIdRecord} answered: a refusal, or the ids. */
      const outcome = readIdRecord(scratch)
      return "detail" in outcome ? `REFUSED: ${outcome.detail}` : `ACCEPTED: ${outcome.ids.join(",")}`
    }
    /** Writes one record and reports the PAST set the very same reader hands the merge. */
    const past = (record: unknown): string => {
      /** The record's own path inside the scratch workspace. */
      const file = join(scratch, IDS_RECORD)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(record, undefined, 2))
      /** What {@link readIdRecord} answered. */
      const outcome = readIdRecord(scratch)
      return "detail" in outcome ? "REFUSED" : outcome.past.join(",")
    }
    /** The provenance a REAL boot writes, so each case below differs in exactly ONE field. */
    const proven = { hostRoot: "/opt/dsh-tui", hostVersion: "0.14.0", readBack: "tuiPanels.list", activation: "act1" }
    /** The ids that real boot registered. */
    const ids = ["act1:team", "act1:dag", "act1:workmate"]
    /** The MEASURED pollution itself: a version-1 record with no provenance block at all. */
    const absent = read({ version: 1, panelIds: ["act0:team", "act0:dag", "act0:workmate"], slugs: ["team", "dag", "workmate"], updatedAt: "2026-10-08T02:02:20.819Z" })
    check("(f) the MEASURED version-1 record with NO provenance is refused", absent.startsWith("REFUSED:") && absent.includes("provenance"))
    /** A version-2 record whose host version is whitespace. */
    const blank = read({ version: 2, panelIds: ids, provenance: { ...proven, hostVersion: "  " } })
    check("(f) a blank `provenance.hostVersion` is refused by name", blank.includes("REFUSED:") && blank.includes("provenance.hostVersion"))
    /** A version-2 record with no host root, the one field the writer's own rule also refuses. */
    const noRoot = read({ version: 2, panelIds: ids, provenance: { ...proven, hostRoot: " " } })
    check("(f) a blank `provenance.hostRoot` is refused by name", noRoot.includes("REFUSED:") && noRoot.includes("provenance.hostRoot"))
    /** A version-2 record with no host read-back. */
    const noReadBack = read({ version: 2, panelIds: ids, provenance: { ...proven, readBack: "" } })
    check("(f) an empty `provenance.readBack` is refused by name", noReadBack.includes("REFUSED:") && noReadBack.includes("provenance.readBack"))
    /** A version-2 record carrying the impossible `act0` activation. */
    const polluted = read({ version: 2, panelIds: ["act0:team", "act0:dag"], provenance: { ...proven, activation: "act0" } })
    check("(f) the impossible `act0` activation is refused by name", polluted.includes("REFUSED:") && polluted.includes("act0"))
    /** The one record that must be ACCEPTED, so the refusals cannot be a blanket refusal. */
    const good = read({ version: 2, panelIds: ids, slugs: ["team", "dag", "workmate"], updatedAt: "2026-10-08T03:00:00.000Z", provenance: proven })
    check("(f) a well-formed version-2 record IS accepted", good === `ACCEPTED: ${ids.join(",")}`)
    // ── R1.2: the record's PAST set is the ownership evidence, and it is read through the same refusals ──
    check("(R1.2) a version-3 record hands BOTH its history and its current ids to the prune", past({ version: 3, panelIds: ["act1:team"], provenance: proven, history: ["act7:dag", "someone:else", "act7:team"] }) === "act7:dag,act7:team,act1:team")
    check("(R1.2) a version-2 record (no history) still offers its own ids as past", past({ version: 2, panelIds: ["act1:team"], provenance: proven }) === "act1:team")
    // THE SAME REFUSALS GATE THE PRUNE, so a polluted record cannot make this script delete a live panel.
    check("(R1.2) the MEASURED polluted record contributes NO past at all", past({ version: 1, panelIds: ["act0:team", "act0:dag"] }) === "REFUSED")
    check("(R1.2) a blank `hostVersion` contributes no past either", past({ version: 3, panelIds: ["act1:team"], provenance: { ...proven, hostVersion: "" }, history: ["act7:dag"] }) === "REFUSED")
    rmSync(scratch, { recursive: true, force: true })
  } catch (error) {
    check(`(f) the record-proof arm ran (${String((error as Error)?.message ?? error)})`, false)
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
