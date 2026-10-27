// PURE evaluation for the "mapped to the user surface" gate arms (`user-surface-mount.ts`).
//
// WHY THIS FILE EXISTS: the two green lights this wave has to kill were both "the composition is
// right, so the product must be right" (evidence/docker/client-install/2026-10-26T17-19-00Z: 122
// assertions, ZERO mentions of a slash command; and the 0.16.1 release, where `mpd-cellwork` never
// mounted in a real user session). Neither class is reachable from `--dump-config`, so every
// predicate here is written to consume a REAL BOOT's observations — the row's own log sink, the
// live registries a probe read inside the process, or the command palette the user actually sees —
// and to hand back a verdict plus the raw witness it came from.
//
// Everything in this module is PURE (text in, verdicts out) so `--self-test` can drive every arm,
// including the NEGATIVE ones, without docker, without dsh and without network.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/** One row a shipped patch layer declares, as the RELEASE ARTIFACT itself spells it. */
export interface PatchRow {
  /** The row id the patch layer declares; the loader keys its entry by exactly this. */
  readonly id: string
  /** The module the row names (a package specifier or a bundle-relative path); `""` when absent. */
  readonly name: string
  /** True when the row is declared `disabled: true`, i.e. composed and deliberately never applied. */
  readonly disabled: boolean
  /** The patch file (repo- or bundle-relative) the row was read from, for the witness trail. */
  readonly patch: string
  /** 1-based line of the `- id:` declaration inside that file. */
  readonly line: number
}

/** What the release artifact declares about itself: its version, its layers and their rows. */
export interface ArtifactRows {
  /** The installed bundle's own `version`, read from its `package.json`. */
  readonly version: string
  /** Absolute paths of the patch layers, in `dsh.bundle.patch` order. */
  readonly patchFiles: readonly string[]
  /** Every row id declared by those layers, in declaration order (duplicates removed). */
  readonly rows: readonly PatchRow[]
  /** Ids declared more than once ACROSS layers; recorded, never fatal (one id may be re-targeted). */
  readonly duplicates: readonly string[]
  /** Structural problems that make the enumeration untrustworthy (an absent layer, no rows at all). */
  readonly problems: readonly string[]
}

/** The seven slash commands this bundle CONTRIBUTES, as `docs/user-guide.md` §12 publishes them. */
export const CONTRIBUTED_COMMANDS: readonly string[] = [
  "ulw",
  "ultrawork",
  "cellwork",
  "mpd-codegraph",
  "agent-teams",
  "mpd",
  "mpd-model",
]

/** The contributed commands that exist ONLY on the TUI plane (their rows are TUI-adapter rows). */
export const TUI_ONLY_COMMANDS: readonly string[] = ["mpd", "mpd-model"]

/** The commands a HOST row provides; asserted by nobody here, listed so the corpus stays readable. */
export const HOST_PROVIDED_COMMANDS: readonly string[] = ["settings", "goal"]

/**
 * Parse the `- id:` rows out of one patch layer's bytes.
 *
 * A line scanner rather than a YAML parse on purpose: the patch layers carry long comment blocks,
 * `!!js` expressions and nested groups, and the ONE property this gate needs is "which row ids does
 * the artifact declare" — a shape a full parse would tie to a YAML dialect the loader may change.
 *
 * @param text The patch file's contents.
 * @param patch The file's name, stamped onto every row for the witness trail.
 * @returns The declared rows in source order.
 */
export function parsePatchRows(text: string, patch: string): PatchRow[] {
  /** The rows found so far, in source order. */
  const rows: PatchRow[] = []
  /** The row currently being extended: a `name:`/`disabled:` line after its `- id:` belongs to it. */
  let current: { id: string; name: string; disabled: boolean; patch: string; line: number } | undefined
  // One pass over the file: row starts begin a row, and a handful of keys extend the open one.
  const lines = text.split("\n")
  for (let index = 0; index < lines.length; index += 1) {
    /** The raw line, kept as-is so the indent check below sees the source spelling. */
    const raw = lines[index] ?? ""
    /** The line with its indentation stripped, which is what every match below reads. */
    const line = raw.trim()
    // A comment line never carries a declaration; skipping it keeps prose out of the scanner.
    if (line.startsWith("#")) continue
    /** The `- id:` declaration that starts a row (any indentation: groups nest rows). */
    const idMatch = /^-\s+id:\s*(.+?)\s*$/.exec(line)
    if (idMatch !== null) {
      if (current !== undefined) rows.push(current)
      current = { id: stripQuotes(idMatch[1] ?? ""), name: "", disabled: false, patch, line: index + 1 }
      continue
    }
    if (current === undefined) continue
    /** The `name:` key of the open row, which names the module the loader imports. */
    const nameMatch = /^name:\s*(.+?)\s*$/.exec(line)
    if (nameMatch !== null) { current.name = stripQuotes(nameMatch[1] ?? ""); continue }
    /** The `disabled: true` flag of the open row, which makes non-activation CORRECT. */
    const disabledMatch = /^disabled:\s*(true|false)\s*$/.exec(line)
    if (disabledMatch !== null) { current.disabled = disabledMatch[1] === "true"; continue }
    // Any other top-level row key (`config:`, `group:`) belongs to the open row; nothing to record.
  }
  if (current !== undefined) rows.push(current)
  return rows
}

/**
 * Strip one layer of matching quotes from a scalar, so `'@mpd-dsh/mpd/x.js'` reads as the module.
 * @param value The scalar as the patch spelled it.
 * @returns The unquoted scalar.
 */
function stripQuotes(value: string): string {
  if (value.length >= 2 && (value.startsWith("\"") && value.endsWith("\"") || value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1)
  return value
}

/**
 * Enumerate every row the INSTALLED release artifact declares, from the artifact's own layers.
 *
 * The subject is deliberately the installed bundle (`<profile>/node_modules/@mpd-dsh/mpd`), never
 * this checkout: the defect this gate exists for was a release whose PROFILE copy carried a row the
 * boot never mounted, and a checkout-relative enumeration would have reported the checkout's rows.
 * The row set is therefore never hardcoded — adding or deleting a row in either layer changes the
 * assertion set with no edit here.
 *
 * @param bundleDir Absolute path of the installed bundle package directory.
 * @returns The artifact's version, its layers and every declared row.
 */
export function enumerateArtifactRows(bundleDir: string): ArtifactRows {
  /** Structural problems; a non-empty list fails the `rowsEnumerated` arm. */
  const problems: string[] = []
  /** The bundle manifest path, the only file trusted for the layer list (its `dsh.bundle.patch`). */
  const manifestPath = join(bundleDir, "package.json")
  if (!existsSync(manifestPath)) {
    return { version: "", patchFiles: [], rows: [], duplicates: [], problems: ["the installed bundle has no package.json at " + manifestPath] }
  }
  /** The decoded bundle manifest, read as a bag because only two keys are trusted below. */
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown; dsh?: { bundle?: { patch?: unknown } } }
  /** The declared layer list; absent means the artifact cannot be enumerated at all. */
  const declared = manifest.dsh?.bundle?.patch
  /** The layer spellings, normalized to strings (the loader accepts a string or an array). */
  const patchNames: string[] = typeof declared === "string" ? [declared] : Array.isArray(declared) ? declared.map((entry) => String(entry)) : []
  if (patchNames.length === 0) problems.push("the bundle manifest declares no dsh.bundle.patch layers, so there is nothing to enumerate")
  /** The absolute layer paths, in manifest order. */
  const patchFiles = patchNames.map((entry) => join(bundleDir, entry))
  /** Every row across the layers, in layer then source order. */
  const rows: PatchRow[] = []
  for (const file of patchFiles) {
    if (!existsSync(file)) { problems.push("a declared patch layer is absent from the installed bundle: " + file); continue }
    for (const row of parsePatchRows(readFileSync(file, "utf8"), file.slice(bundleDir.length + 1))) rows.push(row)
  }
  if (rows.length === 0) problems.push("the declared patch layers carry no `- id:` rows")
  /** How often each id is declared, to report a cross-layer duplicate instead of hiding it. */
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1)
  return {
    version: String(manifest.version ?? ""),
    patchFiles,
    rows,
    duplicates: [...counts.entries()].filter((entry) => entry[1] > 1).map((entry) => entry[0]),
    problems,
  }
}

/** One row as the LIVE boot's loader held it: the probe's record of `<ws>/.mpd/logs` row state. */
export interface RowObservation {
  /** The loader entry's own id (`row.options.id`), which is the patch row's id. */
  readonly id: string
  /** The cordis fiber state: 0 pending, 1 loading, 2 active, 3 failed, 4 disposed; null when no fiber. */
  readonly state: number | null
  /** True when the applied fiber carries a runtime, i.e. the plugin instance exists. */
  readonly hasRuntime: boolean
  /** True when the loader entry is declared `disabled`, i.e. composed but never applied BY DESIGN. */
  readonly disabled: boolean
}

/** Which proof carried one row's verdict; recorded per row so the evidence says how it was decided. */
export type RowWitness = "sink" | "registration" | "loader-active" | "disabled-by-design" | "declared-bound" | "none"

/** One row's verdict, with the witness class and the raw observation behind it. */
export interface RowVerdict {
  /** The row id this verdict is for. */
  readonly id: string
  /** true effective, false defective, null NOT PROVABLE in this run (a named bound, never a pass). */
  readonly ok: boolean | null
  /** The witness class that decided it. */
  readonly witness: RowWitness
  /** Human sentence naming what was seen; the failure text when `ok` is false. */
  readonly reason: string
  /** The verbatim observation, so a reader can re-derive the verdict without re-running. */
  readonly raw: string
}

/** The cordis fiber state that means "this row's plugin applied and is running". */
export const FIBER_ACTIVE: number = 2

/** The cordis fiber states that mean "this row is dead", quoted beside a failure. */
export const FIBER_DEAD: readonly number[] = [3, 4]

/** What the grading needs to know about the composition this boot ran. */
export interface RowContext {
  /** The preset id the session ran (`agentPreset`), or null when no session existed. */
  readonly agentPreset: string | null
  /** The patch layer whose rows are materialised per session by that preset (`presets/mpd.patch.yml`). */
  readonly presetLayer: string
}

/**
 * Grade every declared row against the real boot's observations.
 *
 * The witness preference is the one the task fixes: (a) the row's OWN log sink
 * (`<ws>/.mpd/logs/<row>.log`) when it writes one; (b) a registration the row's own module names
 * AND the live registry holds (a tool or command name found in the module's bytes and present in
 * the boot); (c) `loader-active` — the loader holds an ACTIVE fiber with a runtime for that id.
 * A row declared `disabled: true` is graded `disabled-by-design` when the loader confirms the flag,
 * because non-activation there is the CORRECT outcome, not a defect.
 *
 * @param rows The rows the artifact declares.
 * @param observations The loader's per-row observations from the boot.
 * @param sinkNames Row ids that wrote a non-empty `<row>.log` in the session workspace.
 * @param registrationHits Row ids whose module-declared tool/command names the live registry holds.
 * @param context What the boot's composition was (the preset it ran, the layer that preset owns).
 * @returns One verdict per declared row, in declaration order.
 */
export function evaluateRows(
  rows: readonly PatchRow[],
  observations: readonly RowObservation[],
  sinkNames: readonly string[],
  registrationHits: ReadonlyMap<string, readonly string[]>,
  context: RowContext,
): RowVerdict[] {
  /** The observations by id, so each row costs one lookup. */
  const byId = new Map(observations.map((row) => [row.id, row]))
  return rows.map((row) => {
    /** The live loader entry for this row, `undefined` when the boot never composed it. */
    const seen = byId.get(row.id)
    if (row.disabled) {
      if (seen === undefined) {
        // PRESET-OWNED disabled rows share the preset's own materialisation: the preset carries them as
        // data (the shipped `standard` preset's `plugin_manager`/`plugin_market` pair is declared
        // disabled exactly this way), so an absent entry is the same named bound as above.
        if (row.patch.endsWith(context.presetLayer)) {
          return { id: row.id, ok: null, witness: "declared-bound", reason: "preset-owned row declared DISABLED: the preset carries it as data and this plane exposes no entry — composed, NOT individually proven", raw: "patch=" + row.patch + ":" + String(row.line) + " declared disabled=true; loader entry absent" }
        }
        return { id: row.id, ok: false, witness: "none", reason: "declared disabled, but the boot's loader holds no entry for it at all (the layer was not composed)", raw: "declared disabled=true; loader entry absent" }
      }
      if (!seen.disabled) return { id: row.id, ok: false, witness: "none", reason: "declared disabled but the live loader entry is enabled", raw: "disabled=true in the patch, disabled=" + String(seen.disabled) + " in the boot" }
      return { id: row.id, ok: true, witness: "disabled-by-design", reason: "declared disabled and the loader agrees: composed, deliberately not applied", raw: "disabled=true in both the patch and the boot (state=" + String(seen.state) + ")" }
    }
    if (seen === undefined) {
      // A preset-owned row is MATERIALISED PER SESSION by `dsh-agent-preset`: its declaration lives as
      // data inside the preset entry, so an id that never appears as its own loader entry on this
      // plane is a NAMED BOUND, not a pass and not a defect. Everything else is the defect class this
      // gate exists for (the 0.16.1 release: `mpd-cellwork` declared, never composed).
      if (row.patch.endsWith(context.presetLayer)) {
        return { id: row.id, ok: null, witness: "declared-bound", reason: "preset-owned row: the artifact declares it inside the `mpd` preset (materialised per session), the root loader holds no entry of its own, and it names no tool/command/sink this plane can read — composed, NOT individually proven", raw: "patch=" + row.patch + ":" + String(row.line) + " agentPreset=" + String(context.agentPreset) + " loaderEntries=" + String(observations.length) }
      }
      return { id: row.id, ok: false, witness: "none", reason: "the row is declared by the release artifact but the real boot's loader holds NO entry for it — the boot did not compose this row", raw: "patch=" + row.patch + ":" + String(row.line) + " name=" + row.name + "; loader entries=" + String(observations.length) }
    }
    if (sinkNames.includes(row.id)) {
      return { id: row.id, ok: true, witness: "sink", reason: "the row's own log sink exists and is non-empty after the boot", raw: "sink=<ws>/.mpd/logs/" + row.id + ".log bytes>0" }
    }
    /** The tool/command names this row's module declares that the live registry answered to. */
    const hits = registrationHits.get(row.id) ?? []
    if (hits.length > 0) {
      return { id: row.id, ok: true, witness: "registration", reason: "a name the row's own module declares is live in the boot's registry", raw: "live=" + hits.join(",") }
    }
    if (seen.state === FIBER_ACTIVE && seen.hasRuntime) {
      return { id: row.id, ok: true, witness: "loader-active", reason: "the loader holds an ACTIVE fiber with a runtime for this row (its apply() ran); the row names no inspectable tool/command and writes no sink", raw: "state=" + String(seen.state) + " runtime=true disabled=false" }
    }
    // THE DECLARED BOUND: a row that is DISABLED in the boot while the artifact declares it ENABLED,
    // and that names no surface this plane can observe. Two mechanisms produce it, both legitimate:
    // the `mpd` preset materialises its own rows per session (the root copies stay disabled), and a
    // row's mount guard disables it when its host seam is absent (the web sidebar row on a TUI-only
    // profile). Neither is a pass: the verdict is NULL, the reason names it, and the aggregate reports
    // the ids so the evidence says exactly what was not proven.
    if (seen.disabled) {
      /** True when the row belongs to the layer the running preset owns. */
      const presetOwned = row.patch.endsWith(context.presetLayer)
      return {
        id: row.id,
        ok: null,
        witness: "declared-bound",
        reason: presetOwned
          ? "preset-scoped row: the artifact declares it inside the `mpd` preset, the boot materialises preset rows per session (the root copy is disabled) and the row names no tool/command/sink this plane can read — composed, NOT individually proven"
          : "the boot holds the row disabled although the artifact declares it enabled, and the row names no tool/command/sink — its mount guard owns it, so this plane cannot prove it",
        raw: "state=" + String(seen.state) + " runtime=" + String(seen.hasRuntime) + " disabled=true presetOwned=" + String(presetOwned) + " agentPreset=" + String(context.agentPreset) + " patch=" + row.patch,
      }
    }
    if (seen.state !== null) {
      return { id: row.id, ok: false, witness: "none", reason: "the row is composed, its fiber exists and never became ACTIVE (" + (FIBER_DEAD.includes(seen.state) ? "FAILED or DISPOSED" : "still pending or loading") + "), and it names no tool/command/sink", raw: "state=" + String(seen.state) + " runtime=" + String(seen.hasRuntime) + " disabled=false" }
    }
    // Composed, no fiber, not disabled, no surface: on THIS plane the loader created the entry but never
    // instantiated it, and the two mechanisms that do that (a mount guard waiting on a foreign seam, and
    // preset materialisation) are indistinguishable from the root ctx alone. Recorded as a BOUND by id.
    return { id: row.id, ok: null, witness: "declared-bound", reason: "composed but never instantiated in this plane (no fiber, not disabled) and the row names no tool/command/sink — NOT individually proven", raw: "state=" + String(seen.state) + " runtime=" + String(seen.hasRuntime) + " disabled=false patch=" + row.patch }
  })
}

/**
 * Count the rows the TUI's command palette drew, read from the palette box's own header.
 * @param pane One captured pane's text.
 * @returns The `共 N 项` count, or null when the capture carries no palette box at all.
 */
export function paletteCount(pane: string): number | null {
  /** The palette header the host prints: `╭─ 命令 · 共 95 项 ──…`. */
  const match = /命令\s*·\s*共\s*(\d+)\s*项/.exec(pane)
  return match === null ? null : Number(match[1])
}

/**
 * The command NAMES the palette box drew, in draw order.
 *
 * A row is `<box border> [❯| ] <name> <description>`; only lines INSIDE the box count, so the
 * composer line the palette mirrors (`❯ /agent-teams`) is never mistaken for a listed command.
 * @param pane One captured pane's text.
 * @returns The listed names, lower-cased as the palette renders them; empty when no box is drawn.
 */
export function paletteCommandRows(pane: string): string[] {
  /** The names found inside the palette box. */
  const names: string[] = []
  /** True while the scanner is between the box's top and bottom borders. */
  let inside = false
  for (const rawLine of pane.split("\n")) {
    if (/╭─\s*命令\s*·/.test(rawLine)) { inside = true; continue }
    if (inside && /╰─+/.test(rawLine)) { inside = false; continue }
    if (!inside) continue
    /** One palette row: the border, the cursor gutter, then the command name. */
    const row = /^[^\w]*│\s*(?:❯)?\s*([A-Za-z][A-Za-z0-9._-]*)/.exec(rawLine.trimEnd())
    if (row !== null) names.push(String(row[1]).toLowerCase())
  }
  return names
}

/** One command's verdict: the registry listing AND the palette must both carry it. */
export interface CommandVerdict {
  /** The command name, without the leading slash. */
  readonly name: string
  /** True when the live registry listed it and the palette drew it. */
  readonly ok: boolean
  /** What was seen; the failure sentence when `ok` is false. */
  readonly reason: string
  /** The verbatim evidence: the registry hit plus the palette's own row text. */
  readonly raw: string
}

/**
 * The corpus guard: the assertion set must be EXACTLY the published corpus, never a subset.
 *
 * This is the arm requirement 2's negative control needs. The rows are dynamic (they follow the
 * patch layers), but the contributed COMMANDS are a published, fixed corpus — so a case that
 * silently dropped one from its expected list would assert six commands and green. Deleting a name
 * from the list handed to this function turns it red, which is what `--self-test` fixes as an arm.
 *
 * @param expected The command names this run is about to assert.
 * @returns One sentence per missing, duplicated or unknown name; empty means the corpus is intact.
 */
export function corpusProblems(expected: readonly string[]): string[] {
  /** Everything wrong with the supplied expectation, in corpus order then extras. */
  const problems: string[] = []
  for (const name of CONTRIBUTED_COMMANDS) if (!expected.includes(name)) problems.push("the expected command set omits the published command `/" + name + "`, so this run would not assert it")
  /** Names supplied twice: a duplicate hides a dropped name behind an inflated count. */
  const duplicated = expected.filter((name, index) => expected.indexOf(name) !== index)
  for (const name of new Set(duplicated)) problems.push("the expected command set lists `" + name + "` more than once")
  for (const name of expected) {
    if (!CONTRIBUTED_COMMANDS.includes(name)) problems.push("the expected command set carries `" + name + "`, which this bundle does not contribute (host commands are " + HOST_PROVIDED_COMMANDS.join(", ") + ")")
  }
  return problems
}

/**
 * Grade one contributed command against the two user-facing surfaces.
 *
 * THE PLANE RULE (docs/user-guide.md §12): five of the seven are contributed on BOTH planes, while
 * `/mpd` and `/mpd-model` are TUI-only — the Web registration is refused by the plugin itself. The
 * verdict therefore REQUIRES the palette for all seven and the harness `commands` registry only for
 * the shared five; a TUI-only command's registry absence is recorded, not failed, because absence
 * there is the documented design rather than a defect.
 * @param name The command name, without the slash.
 * @param registryNames The names the LIVE `commands` service listed for the session's agent.
 * @param pane The palette capture taken after typing the command, or "" when it was not captured.
 * @returns The verdict with both observations quoted.
 */
export function evaluateCommand(name: string, registryNames: readonly string[], pane: string): CommandVerdict {
  /** True when the harness's own command registry held the name for this session's agent. */
  const registered = registryNames.includes(name)
  /** True when the documented plane for this command is the TUI only. */
  const tuiOnly = TUI_ONLY_COMMANDS.includes(name)
  /** The palette rows that carry the name exactly (so /ulw never matches /ultrawork). */
  const listed = paletteCommandRows(pane).filter((row) => row === name)
  /** The palette's own count, quoted so a reader sees whether the box drew anything at all. */
  const count = paletteCount(pane)
  /** The surface this command can exist on, stated in every verdict. */
  const plane = tuiOnly ? "TUI-only plane" : "shared plane"
  /** The raw witness: registry hit, palette count and the palette's row text. */
  const raw = "registry=" + String(registered) + " paletteCount=" + String(count) + " paletteRows=" + (listed.length > 0 ? listed.join(",") : "-") + " plane=" + plane
  /** True when every surface this command is documented to appear on answered. */
  const surfacesOk = listed.length > 0 && (tuiOnly || registered)
  if (surfacesOk) return { name, ok: true, reason: tuiOnly ? "drawn in the command palette on its documented TUI-only plane (a registry listing is not required there)" : "registered in the live command registry AND drawn in the command palette", raw }
  /** The one-sentence failure naming which surface is missing. */
  const missing = [
    listed.length > 0 ? "" : "the command palette drew no row for it",
    tuiOnly || registered ? "" : "the live command registry did not list it for the mpd session's agent",
  ].filter((part) => part !== "").join("; ")
  return { name, ok: false, reason: missing + " (" + plane + ")", raw }
}

/**
 * Grade the negative control: a command this bundle does NOT contribute must be absent everywhere.
 *
 * WHY THE TWO SANITY CAPTURES: measured on a real 0.17.0 TUI, the palette box CLOSES when a filter
 * matches nothing, so "no box" is the SUCCESS shape for a fabricated name — and it is also the shape
 * a dead terminal or a mis-typed drive produces. The control therefore requires a palette box with
 * `count > 0` in the captures immediately BEFORE and AFTER it: with the palette demonstrably alive on
 * both sides, the absent box in between can only mean "nothing matched".
 * @param name The deliberately nonexistent command name, without the slash.
 * @param registryNames The names the live registry listed.
 * @param pane The palette capture taken after typing that name.
 * @param aliveBefore The capture taken just before the control (an empty query must draw a full box).
 * @param aliveAfter The capture taken just after clearing the control's query.
 * @returns The verdict: ok only when both surfaces answer "no such command" and the palette is alive.
 */
export function evaluateNegativeControl(name: string, registryNames: readonly string[], pane: string, aliveBefore: string, aliveAfter: string): CommandVerdict {
  /** True when the fabricated name leaked into the live registry (which would be a real defect). */
  const registered = registryNames.includes(name)
  /** The palette rows carrying the fabricated name. */
  const listed = paletteCommandRows(pane).filter((row) => row === name)
  /** The palette count of the CONTROL's own capture; `null` means the box closed (zero matches). */
  const count = paletteCount(pane)
  /** The count drawn just BEFORE the control's own capture (must be positive). */
  const before = paletteCount(aliveBefore)
  /** The count drawn just AFTER the control's query was cleared (must be positive again). */
  const after = paletteCount(aliveAfter)
  /** The raw witness quoted on both arms. */
  const raw = "registry=" + String(registered) + " controlCount=" + String(count) + " controlRows=" + (listed.length > 0 ? listed.join(",") : "-") + " aliveBefore=" + String(before) + " aliveAfter=" + String(after)
  if (before === null || before === 0 || after === null || after === 0) return { name, ok: false, reason: "the palette was not demonstrably alive around the control, so its absence proves nothing in this run", raw }
  if (!registered && listed.length === 0 && (count === null || count === 0)) return { name, ok: true, reason: "a command no row contributes is absent from both surfaces while the palette stayed alive on both sides", raw }
  return { name, ok: false, reason: "the negative control was FOUND on a surface, which means it is not a control any more", raw }
}

/**
 * The upgrade-path verdict: the PROFILE's row list must be the one the boot composed.
 *
 * This is the direct regression test for the 0.16.1 defect: with an older bundle installed on the
 * loader's install anchor, the composed row list came from THAT copy while the row modules resolved
 * from the profile, so the profile's newer rows (`mpd-cellwork` among them) never mounted. The
 * verdict compares the artifact's rows against the boot's loader entries and names every row the
 * profile declares that the boot does not hold — the exact sentence the defect produced.
 * @param rows The rows the PROFILE's installed artifact declares.
 * @param observations The loader's observations from the boot.
 * @returns The verdict and the ids the boot is missing (empty when the profile's list won).
 */
export function evaluateProfileRowList(rows: readonly PatchRow[], observations: readonly RowObservation[]): { ok: boolean; missing: string[]; raw: string } {
  /** The ids the boot's loader actually holds. */
  const held = new Set(observations.map((row) => row.id))
  /** The profile rows the boot never composed, in declaration order. */
  const missing = rows.map((row) => row.id).filter((id) => !held.has(id))
  return {
    ok: missing.length === 0,
    missing,
    raw: "profileRows=" + String(rows.length) + " bootEntries=" + String(observations.length) + " missing=" + (missing.length === 0 ? "-" : missing.join(",")),
  }
}

/**
 * The commands an upgrade would add, derived from the artifact rather than hardcoded.
 * @returns The contributed commands whose rows live in the artifact this run enumerated.
 */
export function contributedCommands(): readonly string[] {
  return CONTRIBUTED_COMMANDS
}

/** One shipped module's bytes as a name source: the row it belongs to plus the file it was read from. */
export interface ModuleScan {
  /** Absolute path of the module file. */
  readonly file: string
  /** Every string literal shaped like a tool or command name, in file order. */
  readonly names: readonly string[]
}

/**
 * Extract the tool/command-shaped names a shipped module declares.
 *
 * Conservative on purpose: only `name: "…"` and `toolName: "…"` literals are collected, and the
 * caller intersects them with the LIVE registry before claiming anything. A literal that no row ever
 * registers therefore cannot manufacture a witness, while a name that BOTH the module and the boot
 * carry is a registration this row is responsible for.
 * @param text The module's bytes (the artifact's `dist` output, or a `.ts` source).
 * @returns The candidate names, de-duplicated in file order.
 */
export function moduleNameCandidates(text: string): string[] {
  /** The names found, in file order, before de-duplication. */
  const found: string[] = []
  // BOTH QUOTE STYLES: our own dist is built with double quotes, the harness packages ship single ones
  // (measured 2026-10-27: a double-quote-only scan resolved 23 of 69 rows' surfaces and left every
  // `@deepseek-ai/dsh-tool-*` row a declared bound instead of a registration witness).
  /** The declaration shapes worth reading: a tool/command registration or a plugin id. */
  const pattern = /\b(?:name|toolName|commandId)\s*:\s*["']([A-Za-z][A-Za-z0-9._-]{1,63})["']/g
  for (const match of text.matchAll(pattern)) found.push(String(match[1]))
  return [...new Set(found)]
}

/**
 * Read one module candidate list straight off disk, tolerating an unreadable file.
 * @param file Absolute path of the module.
 * @returns Its candidate names; empty when the file is absent or unreadable.
 */
export function scanModule(file: string): readonly string[] {
  if (!existsSync(file)) return []
  try { return moduleNameCandidates(readFileSync(file, "utf8")) } catch { return [] }
}

/**
 * Resolve one row's module path to a file this machine can read.
 *
 * A row names either a bundle-relative path (`@mpd-dsh/mpd/packages/x/dist/index.js`, resolved
 * through the installed bundle) or a plain package specifier. The specifier case must try EVERY
 * `node_modules` parent a profile has: the profile's own (`<profile>/node_modules`) and the
 * profiles-shared fallback (`<DSH_HOME>/profiles/node_modules`), because pnpm hoists differently per
 * install. A row whose module resolves nowhere is reported (`modules scanned=n/rows`) rather than
 * silently counted as registered.
 * @param moduleName The `name:` the patch row declares.
 * @param bundleDir Absolute path of the installed bundle package.
 * @param nodeModulesParents Directories that own a `node_modules` the profile resolves through.
 * @returns The absolute module path, or "" when no spelling resolves to a file.
 */
export function resolveRowModule(moduleName: string, bundleDir: string, nodeModulesParents: readonly string[]): string {
  if (moduleName === "") return ""
  /** The bundle-relative spelling: strip the package name and join the remainder onto the bundle. */
  const bundlePrefix = "@mpd-dsh/mpd/"
  if (moduleName.startsWith(bundlePrefix)) {
    /** The path inside the bundle the row names. */
    const inside = join(bundleDir, moduleName.slice(bundlePrefix.length))
    if (existsSync(inside)) return inside
  }
  for (const parent of nodeModulesParents) {
    /** The specifier resolved against this parent's `node_modules`. */
    const candidate = join(parent, "node_modules", moduleName)
    if (existsSync(candidate)) return candidate
  }
  return ""
}

/**
 * The bundle a real boot actually resolved, replayed with the loader's own precedence.
 *
 * THE BOUND, stated where the code is: this is a REPLAY of `resolveBundleDir` from
 * `@deepseek-ai/dsh-app-boot` (install anchor first, profile second), not the boot itself. It is
 * reported as an observation — the ASSERTIONS read the boot's composed rows, which is behaviour —
 * because a replay can only say which directory the loader WOULD pick, while the rows say which one
 * it DID. The replay is what names the culprit when the rows disagree.
 * @param anchorPackageJson Absolute path of the `package.json` of the dsh installation that booted.
 * @param profileDir Absolute path of the profile directory.
 * @param bundleName The bundle package name (`@mpd-dsh/mpd`).
 * @returns The resolved directory, its version, and which anchor won.
 */
export function replayBundleResolution(anchorPackageJson: string, profileDir: string, bundleName: string): { dir: string; version: string; source: "install-anchor" | "profile" | "unresolved" } {
  /** The two anchors the loader tries, in its own order. */
  const anchors: Array<{ source: "install-anchor" | "profile"; anchor: string }> = [
    { source: "install-anchor", anchor: anchorPackageJson },
    { source: "profile", anchor: join(profileDir, "package.json") },
  ]
  for (const candidate of anchors) {
    if (!existsSync(candidate.anchor)) continue
    /** The `<anchor>/../..` node_modules chain the loader's `createRequire(anchor).resolve.paths` walks. */
    for (const searchPath of requirePaths(candidate.anchor, bundleName)) {
      /** The package directory under this search path. */
      const dir = join(searchPath, bundleName)
      if (!existsSync(join(dir, "package.json"))) continue
      try {
        /** The resolved copy's manifest, read only for its version. */
        const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version?: unknown }
        return { dir, version: String(manifest.version ?? ""), source: candidate.source }
      } catch { return { dir, version: "", source: candidate.source } }
    }
  }
  return { dir: "", version: "", source: "unresolved" }
}

/**
 * The node_modules search paths `createRequire(anchor).resolve.paths(name)` returns.
 *
 * Duplicated here instead of imported, so the replay cannot accidentally share a code path with the
 * loader it is replaying: the algorithm is 6 lines and the whole point is an INDEPENDENT reading.
 * @param anchor Absolute path of a package.json inside the installation.
 * @param name The package name being resolved (only its depth matters to the walk).
 * @returns The candidate `node_modules` directories, nearest first.
 */
function requirePaths(anchor: string, name: string): string[] {
  /** The directories between the anchor and the filesystem root. */
  const parts = anchor.split("/").filter((part) => part !== "")
  /** The search paths, nearest first: every ancestor's `node_modules`. */
  const paths: string[] = []
  for (let index = parts.length - 1; index >= 1; index -= 1) {
    // A `node_modules` segment is never a search path of its own: the loader skips it.
    if (parts[index] === "node_modules") continue
    // `slice(0, index + 1)` INCLUDES the current segment: excluding it produced the PARENT's
    // node_modules and never the one the segment itself owns — measured 2026-10-27 on a global-prefix
    // layout (`<prefix>/lib/node_modules/@deepseek-ai/dsh/package.json`), where the off-by-one made the
    // replay answer "profile" while the loader really resolved the anchor's stale bundle.
    paths.push("/" + parts.slice(0, index + 1).join("/") + "/node_modules")
  }
  // The name's own depth adds nothing while it is unscoped; the walk above is what the loader does.
  void name
  return paths
}

/**
 * Every row id whose own log sink exists and is non-empty inside one workspace.
 * @param logDir The `<workspace>/.mpd/logs` directory a boot wrote.
 * @returns The row ids, sorted, plus the byte sizes for the raw witness.
 */
export function sinkRows(logDir: string): Array<{ id: string; bytes: number }> {
  if (!existsSync(logDir)) return []
  /** The sinks found, as `{id,bytes}` pairs. */
  const found: Array<{ id: string; bytes: number }> = []
  /** The directory's entries, read without options so the reader is platform-neutral. */
  const names = readdirSafe(logDir)
  for (const name of names) {
    if (!name.endsWith(".log")) continue
    /** The sink's absolute path. */
    const file = join(logDir, name)
    try {
      /** The file's size: an EMPTY sink proves nothing, so the byte count is part of the witness. */
      const bytes = statSync(file).size
      if (bytes > 0) found.push({ id: name.slice(0, -4), bytes })
    } catch { /* an unreadable sink is simply not a witness */ }
  }
  return found.sort((left, right) => left.id.localeCompare(right.id))
}

/**
 * List one directory's entry names, answering `[]` when it does not exist.
 * @param dir The directory to list.
 * @returns Its entry names, unsorted.
 */
function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    // An absent or unreadable log directory simply has no sinks; it is never a crash.
    return []
  }
}
