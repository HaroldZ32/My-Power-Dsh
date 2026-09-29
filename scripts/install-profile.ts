#!/usr/bin/env node
// One-shot installer: install the my-power-dsh capabilities into the local DeepSeek Harness.
// By default --dry-run only prints the plan; --yes writes to disk; --dsh-home overrides the target (for isolated QA); --self-test runs the offline self-test.
// Target artifacts:
//   1) $DSH_HOME/profiles/mpd/{package.json,dsh.profile,cordis.patch.yml} (separate profiles for base + web-app)
//   2) $DSH_HOME/cordis.patch.yml (plugin rows with local absolute paths: llm dual track / skills / MCP / mpd-codegraph)
//   3) $DSH_HOME/.agent-presets/mpd-* (presets -> auto-scanned from the user root)
//   4) .toolchain (network install of ast-grep + codegraph when missing)
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { readJson, repoRootFrom } from "./lib/repo.ts"

/** The repository root, derived from this script's own URL (`<root>/scripts/<this file>`). */
const repoRoot: string = repoRootFrom(import.meta.url)

/** The parsed command line: one resolved value per flag this installer accepts. */
interface Options {
  /** Profile name whose directory under the target DSH home receives the install. */
  profile: string
  /** True when the plan is written; a dry run leaves it false and only prints. */
  yes: boolean
  /** Target DSH home from `--dsh-home`; null means "resolve from `$DSH_HOME`, then `~/.dsh`". */
  dshHome: string | null
  /** True for `--self-test`: only the offline self-check runs. */
  selfTest: boolean
  /** True for `--skip-toolchain`: a missing `.toolchain` is reported, never installed. */
  skipToolchain: boolean
  /** True for `--with-comment-checker`: the optional comment-checker joins the toolchain install. */
  commentChecker: boolean
}

/** Parse the installer's flags; an unrecognized argument is ignored, exactly as before. */
function parseArgs(argv: readonly string[]): Options {
  /** The working result: the defaults, then each recognized flag overwrites its own field. */
  const o: Options = { profile: "mpd", yes: false, dshHome: null, selfTest: false, skipToolchain: false, commentChecker: false }
  for (let i = 0; i < argv.length; i++) {
    /** The argument under inspection; `--dsh-home`/`--profile` consume the NEXT one. */
    const a: string = argv[i]
    if (a === "--yes") o.yes = true
    else if (a === "--dry-run") o.yes = false
    else if (a === "--self-test") o.selfTest = true
    else if (a === "--skip-toolchain") o.skipToolchain = true
    else if (a === "--with-comment-checker") o.commentChecker = true
    else if (a === "--dsh-home") o.dshHome = argv[++i]
    else if (a === "--profile") o.profile = argv[++i]
  }
  return o
}

/** A verbatim row block lifted out of a bundle patch, with the indentation it was written at. */
interface RawRow {
  /** Space count of the block's own `- id:` line; renderRow re-indents the block relative to it. */
  readonly base: number
  /** The block's source lines, from its `- id:` line to the last line before the next sibling. */
  readonly lines: readonly string[]
}

// Extract ONE row's YAML block VERBATIM from a bundle patch (from its `- id:` line
// to the next sibling), with the indentation it was written at. The block is later
// re-indented to the row's target level by renderRow, so the legacy installer and
// the bundle patch ship byte-identical row config from ONE source of truth.
//
// 0.1.7-rc.2: the `mpd` preset is a ROW now (`preset-mpd` on
// `@deepseek-ai/dsh-agent-preset`) whose whole composition lives INLINE under
// `config.plugins` in `presets/mpd.patch.yml`. Transcribing it by hand would drift
// on every preset edit, and a JSON re-render would destroy the nested group rows
// and the persona block scalar, so the block is copied — exactly the idiom this
// file already used for the adopted agent-teams `profiles:` roster.
/** The row's own `- id:` line plus every more-indented line that follows it. */
function extractRowBlock(patchText: string, rowId: string): RawRow {
  /** The patch split into lines, so the row's extent can be measured by indentation. */
  const lines: string[] = patchText.split("\n")
  /** Matches exactly the row's `- id:` line at whatever indentation the patch gave it. */
  const pattern: RegExp = new RegExp("^(\\s*)- id: " + rowId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$")
  /** Index of that line, or -1 when the patch declares no such row. */
  const start: number = lines.findIndex((l: string): boolean => pattern.test(l))
  if (start < 0) throw new Error("bundle patch has no row `" + rowId + "`")
  /** The row's own indentation; a later line at or below it is the next sibling, not ours. */
  const base: number = lines[start].match(/^ */)![0].length
  /** The collected block lines, in file order. */
  const out: string[] = []
  for (let i = start; i < lines.length; i++) {
    /** The line under inspection. */
    const l: string = lines[i]
    if (l.trim() === "") { out.push(""); continue }
    if (i > start && l.match(/^ */)![0].length <= base) break
    out.push(l)
  }
  if (out.length === 0) throw new Error("extracted row block for `" + rowId + "` is empty")
  return { base, lines: out }
}

// The sidebar mount guard, byte-identical to the `disabled: !!js` scalar of the
// bundle patch's `mpd-better-sidebar` row (asserted by selfTest below). It is
// duplicated here because the legacy installer renders its OWN patch instead of
// reading the bundle's, and the two writers must not drift: a drifted guard
// double-mounts (or disables the only mount) on a legacy install.
// The sidebar mount guard is EXTRACTED VERBATIM from the bundle patch's
// `mpd-better-sidebar` row instead of being duplicated here. The duplication WAS
// the drift: the two writers must ship byte-identical guards, and a hand-copied
// expression fell behind the patch (measured 2026-09-27: the patch moved to a
// `fileURLToPath(baseUrl)` form while this file still carried `new URL(. , baseUrl)`,
// so the self-test reddened on a guard the bundle had already fixed). One source of
// truth: whatever the patch says is what a legacy install writes.
/** The bundle patch's own `!!js` mount guard for the sidebar row. */
function sidebarGuardFromPatch(): string {
  /** The bundle patch: the single source of truth for the sidebar mount guard. */
  const text: string = readFileSync(join(repoRoot, "cordis.patch.yml"), "utf8")
  /** The patch's `mpd-better-sidebar` row, extracted verbatim. */
  const block: RawRow = extractRowBlock(text, "mpd-better-sidebar")
  /** The row's `disabled: !!js …` line, or undefined when the row carries no such guard. */
  const line: string | undefined = block.lines.find((l: string): boolean => /^\s*disabled:\s*!!js\s/.test(l))
  if (line === undefined) throw new Error("the bundle patch's mpd-better-sidebar row has no `disabled: !!js` guard")
  /** The guard expression alone, with the `disabled:` key and its indentation stripped. */
  const match: RegExpExecArray | null = /^\s*disabled:\s*(!!js\s.*)$/.exec(line)
  if (match === null) throw new Error("the bundle patch's mpd-better-sidebar guard is not a single `!!js` scalar")
  /** The guard as it will be re-emitted; trimmed because `.` does not absorb trailing spaces. */
  const guard: string = match[1].trim()
  if (!guard.includes("dsh-better-sidebar") || !guard.includes("baseUrl")) throw new Error("the extracted sidebar guard is not the mount guard this file pins: " + guard.slice(0, 80))
  return guard
}
/** The extracted guard, resolved ONCE at load time and reused by the plan and the self-test. */
const SIDEBAR_GUARD: string = sidebarGuardFromPatch()

/**
 * A row config value as this installer renders it: a JSON scalar, a list of scalars (one YAML
 * sequence entry each), or a nested map of scalars (rendered one level deeper).
 */
type ConfigValue = string | number | boolean | undefined | (string | number | boolean)[] | Readonly<Record<string, string | number | boolean>>

/** One home-patch row, in either the rendered form or the verbatim-block form. */
interface Row {
  /** Loader entry id: what the id-target / insert decision keys on. */
  readonly id: string
  /** Entry name written into `name:`: a package specifier or an absolute module path. */
  readonly name?: string
  /** Row config rendered under `config:`; absent when the row declares no config block. */
  readonly config?: Readonly<Record<string, ConfigValue>>
  /** True when the row is ALWAYS a column-0 id-target, whatever the target patch declares. */
  readonly alwaysIdTarget?: boolean
  /** Literal `disabled:` value, JSON-encoded on output. */
  readonly disabled?: boolean
  /** Raw YAML form of `disabled:` (the `!!js` sidebar guard), emitted verbatim. */
  readonly disabledYaml?: string
  /** The verbatim block to emit instead of rendering (the extracted `preset-mpd` row). */
  readonly rawRow?: RawRow
}

/** The root manifest's `dsh.bundle` block, as far as this installer reads it. */
interface BundleDeclaration {
  /** The patch-layer declaration: ONE path, an ARRAY of paths, or any foreign value. */
  readonly patch?: unknown
}

/** The manifest's `dsh` block; only the bundle patch declaration is of interest here. */
interface DshDeclaration {
  /** The bundle section holding the patch-layer declaration. */
  readonly bundle?: BundleDeclaration
}

/** The root `package.json`, as far as this installer reads it. */
interface Manifest {
  /** Package version, copied into the web-compat shim's own manifest. */
  readonly version?: string
  /** The bundle declaration block; absent in a non-bundle package. */
  readonly dsh?: DshDeclaration
}

/** The install plan: every path and row later steps read, derived once from the command line. */
interface Plan {
  /** The DSH home the install targets. */
  readonly dshHome: string
  /** True when the headless profile was selected, which swaps the surface bundle. */
  readonly isHeadless: boolean
  /** The base bundle every profile declares. */
  readonly bundle0: string
  /** The surface bundle: the web app, or the headless surface for `mpd-headless`. */
  readonly bundle1: string
  /** Every home-patch row, in the order the patch must render them. */
  readonly rows: readonly Row[]
  /** `<repo>/presets`, the directory holding the bundle's preset patch. */
  readonly presetsDir: string
  /** The patch file the `preset-mpd` block is extracted from. */
  readonly presetPatchPath: string
  /** `<dshHome>/profiles/<profile>`, the profile directory the install writes. */
  readonly profileDir: string
  /** `<dshHome>/cordis.patch.yml`, the home patch the install writes. */
  readonly homePatch: string
  /** True when the ast-grep or codegraph CLI is absent from `.toolchain`. */
  readonly needsToolchain: boolean
}

/**
 * The plan inputs: the parsed command line's leading fields, so both the parsed options and the
 * self-test's own literal reach `buildPlan`. The plan only renders, so `yes` is declared for shape
 * compatibility and never read.
 */
interface PlanInputs {
  /** Profile name selecting `<dshHome>/profiles/<profile>`. */
  readonly profile: string
  /** Write flag of the parsed command line; carried through, never consulted here. */
  readonly yes: boolean
  /** Target DSH home from `--dsh-home`, or null to resolve it from `$DSH_HOME`/the home dir. */
  readonly dshHome: string | null
}

/** Build the complete install plan for one command line: reads the bundle's files, writes nothing. */
function buildPlan(o: PlanInputs): Plan {
  /** Target DSH home: `--dsh-home` wins, then `$DSH_HOME`, then the real `~/.dsh`. */
  const dshHome: string = o.dshHome ?? process.env.DSH_HOME ?? join(homedir(), ".dsh")
  /** True when the headless profile was selected, which swaps the surface bundle. */
  const isHeadless: boolean = o.profile === "mpd-headless"
  /** The base bundle every profile declares, independent of the surface. */
  const bundle0: string = "@deepseek-ai/dsh-base"
  /** The surface bundle mounted on top of the base one. */
  const bundle1: string = isHeadless ? "@deepseek-ai/dsh-headless" : "@deepseek-ai/dsh-web-app"
  /** Repo-relative path resolver, so every row path below reads as one call. */
  const p = (r: string): string => join(repoRoot, r)
  /** `<repo>/presets`, the directory the bundle's preset patch lives in. */
  const presetsDir: string = p("presets")
  /** The bundle's second patch layer, which declares the `preset-mpd` row. */
  const presetPatchPath: string = join(presetsDir, "mpd.patch.yml")
  /** ast-grep CLI shipped by `.toolchain`; its absence triggers a toolchain install. */
  const astCli: string = p(".toolchain/node_modules/.bin/sg")
  /** codegraph CLI shipped by `.toolchain`; its absence triggers a toolchain install. */
  const cgCli: string = p(".toolchain/node_modules/.bin/codegraph")
  // The mpd composition, extracted VERBATIM from the bundle's own preset patch:
  // the manifest's `dsh.bundle.patch` array names that file as the second patch
  // layer, so it is the single source of truth for the preset row.
  /** The verbatim `preset-mpd` block, from the first declared patch that carries one. */
  const presetRowBlock: RawRow = ((): RawRow => {
    /** The root manifest carrying the `dsh.bundle.patch` declaration the loader reads. */
    const manifest: Manifest = readJson<Manifest>(join(repoRoot, "package.json"))
    /** The raw declaration: unknown because it comes off disk and may be either shape. */
    const declared: unknown = manifest?.dsh?.bundle?.patch
    /** The declaration as a list — an array stays, a single string is wrapped, anything else is empty. */
    const list: readonly unknown[] = Array.isArray(declared) ? declared : typeof declared === "string" ? [declared] : []
    for (const entry of list) {
      // The loader itself resolves this entry, so the manifest's contract makes it a path string;
      // a non-string still reaches `join`, which rejects it at runtime exactly as it did before.
      const file: string = join(repoRoot, entry as string)
      if (!existsSync(file)) continue
      /** The declared patch's text, scanned for the `preset-mpd` row. */
      const text: string = readFileSync(file, "utf8")
      /** The extracted block, or null when this patch declares no `preset-mpd` row. */
      let block: RawRow | null = null
      try { block = extractRowBlock(text, "preset-mpd") } catch { block = null }
      if (block !== null) return block
    }
    throw new Error("no declared bundle patch declares a `preset-mpd` row (package.json dsh.bundle.patch)")
  })()
  /** Every home-patch row this installer writes, in the order the patch must carry them. */
  const rows: Row[] = [
    // ── agent preset plane (0.1.7-rc.2 row model) ───────────────────────────
    // The registry row is declared by the WEB-APP layer (`@deepseek-ai/dsh-web-app`
    // inserts `agent-preset-registry` with `default: standard`), so this row is an
    // ID-TARGET at column 0 — emitting it as an insert would collide on the loader
    // entry id. It mirrors the bundle patch's own column-0 id-target verbatim.
    {
      id: "agent-preset-registry", name: "@deepseek-ai/dsh-agent-preset-registry",
      config: { default: "mpd" }, alwaysIdTarget: true
    },
    // dsh-tui plane: the TUI mints its OWN registry row under the SCOPED id
    // `dsh-tui-agent-preset-registry` (name `@deepseek-ai/dsh-agent-preset-registry`,
    // stock config `{ default: 'standard' }`), and a `dsh-tui` profile composes no
    // dsh-web-app layer — so the row above is skipped there and the TUI's own default
    // would win. NOTHING in that composition declares a `standard` preset
    // (`@deepseek-harness-tui/dsh-tui@0.11.1` ships no preset rows), so without this
    // target every new TUI session asks for a preset that does not exist. Column-0
    // id-target for the same reason as the row above: the subject is minted by
    // dsh-tui's own patch, and emitting it as an insert would collide on the entry id.
    {
      id: "dsh-tui-agent-preset-registry", name: "@deepseek-ai/dsh-agent-preset-registry",
      config: { default: "mpd" }, alwaysIdTarget: true
    },
    // The `mpd` preset itself: a `@deepseek-ai/dsh-agent-preset` ROW whose whole
    // composition is inline under `config.plugins`. Extracted VERBATIM from
    // `presets/mpd.patch.yml` (the bundle's single declaration of the mpd
    // composition) — see extractRowBlock.
    { id: "preset-mpd", rawRow: presetRowBlock },
    // Web-compat self-row (mirrors the bundle patch's mpd-web-compat): makes an
    // entry named EXACTLY '@mpd-dsh/mpd' (the loader entry name client-modules
    // scans) resolve to the bundle plugin's own no-op main. The name must be the
    // bare package specifier — client-modules resolves `<name>/package.json` off
    // the profile baseUrl and requires the package to declare `dsh.client` +
    // `exports["./client"]`; install writes a resolvable @mpd-dsh/mpd shim into
    // the profile's node_modules (see main()), so the web client mounts in
    // legacy installs exactly as it does in the packed bundle flow.
    {
      id: "mpd-web-compat", name: "@mpd-dsh/mpd",
      config: {}
    },
    // The sidebar HOST the bundle's shipped GUI registers into (the runtime
    // dependency declared in the manifest's `dependencies`). Guarded exactly like
    // the bundle patch row: disabled when another layer already mounts the package,
    // when no web plane is present, or when the package is not resolvable — never a
    // second mount, never a pending entry, never a dead boot. Id parity with the
    // patch's insert set is enforced by scripts/verify-rows-parity.ts.
    {
      id: "mpd-better-sidebar", name: "dsh-better-sidebar",
      disabledYaml: SIDEBAR_GUARD
    },
    // NOTE: no root skill-filesystem row — the mpd-* presets already declare it
    // (agent-plane, tool rows are preset-plane responsibility since 49b1288), and
    // adding it here duplicates the loader entry id and fails every real boot.
    {
      id: "mcp-astgrep", name: "@deepseek-ai/dsh-mcp-client",
      config: { serverName: "ast_grep", transport: "stdio", command: "node", args: [p("packages/mpd-mcp-astgrep/dist/cli.js")],
        env: existsSync(astCli) ? { MPD_AST_GREP_SG_PATH: astCli } : undefined, toolCallTimeoutMs: 60000 }
    },
    {
      id: "mcp-gitbash", name: "@deepseek-ai/dsh-mcp-client", disabled: true,
      config: { serverName: "git_bash", transport: "stdio", command: "node", args: [p("packages/mpd-mcp-gitbash/dist/cli.js")], toolCallTimeoutMs: 60000 }
    },
    {
      id: "mcp-lsp", name: "@deepseek-ai/dsh-mcp-client",
      config: { serverName: "lsp", transport: "stdio", command: "node", args: [p("packages/mpd-mcp-lsp/dist/cli.js"), "mcp"], toolCallTimeoutMs: 60000 }
    },
    {
      id: "mcp-codegraph", name: "@deepseek-ai/dsh-mcp-client",
      config: { serverName: "codegraph", transport: "stdio", command: "node", args: [p("packages/mpd-mcp-codegraph/dist/serve.js")],
        env: existsSync(cgCli) ? { MPD_CODEGRAPH_BIN: cgCli } : undefined, toolCallTimeoutMs: 60000 }
    },
    {
      id: "mcp-context7", name: "@deepseek-ai/dsh-mcp-client",
      config: { serverName: "context7", transport: "streamable-http", url: "https://mcp.context7.com/mcp", toolCallTimeoutMs: 60000 }
    },
    {
      id: "mcp-grepapp", name: "@deepseek-ai/dsh-mcp-client",
      config: { serverName: "grep_app", transport: "streamable-http", url: "https://mcp.grep.app", toolCallTimeoutMs: 60000 }
    },
    {
      id: "mpd-codegraph", name: p("packages/mpd-codegraph-plugin/dist/index.js"),
      config: { autoInit: true, initTimeoutMs: 60000, binary: cgCli }
    },
    {
      id: "mpd-tools", name: p("packages/mpd-tools-plugin/dist/index.js"),
      config: { writeGuard: true, truncateMaxBytes: 8192 }
    },
    {
      id: "mpd-modelchain", name: p("packages/mpd-modelchain-plugin/dist/index.js"),
      config: {}
    },
    {
      id: "mpd-ulw", name: p("packages/mpd-ulw-plugin/dist/index.js"),
      config: { maxRounds: 3 }
    },
    {
      id: "mpd-hashline", name: p("packages/mpd-hashline-plugin/dist/index.js"),
      config: { guardEditTools: true }
    },
    {
      id: "mpd-boulder", name: p("packages/mpd-boulder-plugin/dist/index.js"),
      config: {}
    },
    {
      // The bundle's single contact surface with the harness seams: every row
      // below calls through it (see packages/mpd-dsh-adapter-plugin/README.md).
      id: "mpd-dsh-adapter", name: p("packages/mpd-dsh-adapter-plugin/dist/index.js"),
      config: {}
    },
    {
      id: "mpd-config", name: p("packages/mpd-config-plugin/dist/index.js"),
      config: {}
    },
    {
      id: "mpd-comment-checker", name: p("packages/mpd-comment-checker-plugin/dist/index.js"),
      config: { autoCheck: false }
    },
    {
      id: "mpd-memory", name: p("packages/mpd-memory-plugin/dist/index.js"),
      config: { vcs: "git" }
    },
    {
      // The extension registry row: it must sit with the same neighbours as in the
      // bundle patch (after mpd-dsh-adapter + mpd-config, directly above mpd-roles,
      // its first consumer) and carry the plugin's only config key.
      id: "mpd-ext", name: p("packages/mpd-ext-plugin/dist/index.js"),
      config: { quiet: false }
    },
    {
      id: "mpd-roles", name: p("packages/mpd-roles-plugin/dist/index.js"),
      config: {}
    },
    {
      id: "mpd-workmate", name: p("packages/mpd-workmate-plugin/dist/index.js"),
      config: {}
    },
    {
      id: "mpd-roster-provider", name: p("packages/mpd-roster-provider-plugin/dist/index.js"),
      config: { baseProvider: "spawn" }
    },
    {
      id: "mpd-team-tools", name: p("packages/mpd-team-tools-plugin/dist/index.js"),
      config: {}
    },
    {
      id: "mpd-team-compact", name: p("packages/mpd-team-compact-plugin/dist/index.js"),
      config: {}
    },
    {
      // The watchdog core (w3): mirrors the bundle patch row, DEFAULTS INCLUDED —
      // these four are the frozen values until a settings edit lands, and the tick
      // re-reads them on settings/document-updated (the `mpd` namespace is
      // applies:"restart", so apply-time caching would defeat live tuning).
      id: "mpd-team-watchdog", name: p("packages/mpd-team-watchdog-plugin/dist/index.js"),
      config: { stateDir: ".mpd/team", warnSilenceMs: 90000, tickIntervalMs: 15000, warnStreakToEscalate: 3, actionOnEscalate: "pause" }
    },
    {
      id: "mpd-bootstrap", name: p("packages/mpd-bootstrap-plugin/dist/index.js"),
      config: {}
    },
    {
      // DSH-TUI edition (t5): the TUI-native surface row. Mirrors the bundle
      // patch verbatim; it is NOT disabled here — under a web/headless profile
      // the plugin probes every tui* seam with ctx.get(id, false) and degrades
      // with a warning instead of failing the row.
      id: "mpd-tui", name: p("packages/mpd-tui-plugin/dist/index.js"),
      config: {}
    },
    // ── Agent Teams: the OFFICIAL plugin set (0.1.7-rc.2) ───────────────────
    // The adopted vendored plugin (row `agent-teams`,
    // packages/mpd-agent-teams-plugin) is RETIRED with this wave: the harness now
    // ships the TeamService + its model-facing tools + its Web UI as first-class
    // packages, and the bundle mounts them under mpd-owned entry ids with entry
    // NAMES equal to the official package names. Mirrored verbatim from
    // cordis.patch.yml, order included.
    {
      id: "mpd-agent-team", name: "@deepseek-ai/dsh-experimental-agent-team",
      config: { maxMembers: 16, maxTasks: 256, maxPendingMessagesPerMember: 64, maxMessageBytes: 32768, disposalTimeoutMs: 5000 }
    },
    {
      id: "mpd-tool-agent-team", name: "@deepseek-ai/dsh-experimental-tool-agent-team",
      config: { freshProvider: "spawn", forkProvider: "fork" }
    },
    {
      id: "mpd-ui-agent-team", name: "@deepseek-ai/dsh-experimental-client-ui-agent-team",
      config: {}
    },
    // B9: every row mirrors the bundle patch verbatim (same id, entry and empty
    // config) and in the same order (cordis.patch.yml plus the
    // preset patch presets/mpd.patch.yml). Row-id parity with the patch layer is
    // enforced by scripts/verify-rows-parity.ts.
  ]
  return {
    dshHome, isHeadless, bundle0, bundle1, rows, presetsDir, presetPatchPath,
    profileDir: join(dshHome, "profiles", o.profile),
    homePatch: join(dshHome, "cordis.patch.yml"),
    needsToolchain: !existsSync(astCli) || !existsSync(cgCli),
  }
}

// Id-target contract (AGENTS.md §8): rows whose id ALREADY EXISTS in the target
// home patch are emitted as id-target overrides (replacing the whole stock row),
// new rows are emitted under `- insert:`. The target home patch is read at
// install time so re-running the installer never duplicates loader entry ids.
/** The row ids the target home patch already declares (empty when it does not exist). */
function readExistingIds(homePatch: string): Set<string> {
  if (!existsSync(homePatch)) return new Set()
  /** The target home patch's text; only its row-id lines are of interest. */
  const t: string = readFileSync(homePatch, "utf8")
  /** The ids already declared there, so a re-run never duplicates a loader entry id. */
  const ids: Set<string> = new Set()
  // top-level rows appear at column 0 ("- id: X"); insert rows at column 4
  // ("    - id: X"); nested config ids are deeper and are not row ids.
  for (const m of t.matchAll(/^(?: {0,4})- id: ["']?([A-Za-z0-9_.-]+)["']?\s*$/gm)) ids.add(m[1])
  return ids
}

/** Render ONE row as YAML at the given indentation; a verbatim block is re-indented, not re-parsed. */
function renderRow(r: Row, indent: string): string {
  // A VERBATIM row block (the `preset-mpd` preset declaration): the whole row —
  // id, name, config, inline group rows and block scalars — comes from the bundle
  // patch and is only re-indented here. Re-rendering it from a parsed object would
  // destroy the nested `cordis:group` rows and the persona block scalar, and
  // hand-transcribing it would drift on the next preset edit.
  if (r.rawRow) {
    /** How far the block must move: positive shifts left, zero or negative pads right. */
    const shift: number = r.rawRow.base - indent.length
    /** The block's lines, each re-indented to the row's target level. */
    const lines: string[] = r.rawRow.lines.map((raw: string): string => {
      if (raw.trim() === "") return ""
      if (shift <= 0) return " ".repeat(-shift) + raw
      return raw.startsWith(" ".repeat(shift)) ? raw.slice(shift) : raw.replace(/^ +/, "")
    })
    if (r.rawRow.lines.length === 0) throw new Error("row `" + r.id + "` has an empty raw block")
    return lines.join("\n")
  }
  /** The rendered row body, one YAML line at a time. */
  const body: string[] = []
  body.push(indent + "- id: " + r.id)
  body.push(indent + "  name: " + JSON.stringify(r.name))
  // `disabledYaml` carries a raw YAML form (`!!js "..."`); `disabled` a literal.
  if (r.disabledYaml !== undefined) body.push(indent + "  disabled: " + r.disabledYaml)
  else if (r.disabled !== undefined) body.push(indent + "  disabled: " + JSON.stringify(r.disabled))
  /** Whether the row declares a config block with at least one key. */
  const hasConfig: boolean = r.config !== undefined && Object.keys(r.config).length > 0
  if (hasConfig) body.push(indent + "  config:")
  if (hasConfig) {
    // The check above established that this row carries a non-empty config object.
    for (const [k, v] of Object.entries(r.config!)) {
      if (v === undefined) continue
      if (Array.isArray(v)) {
        body.push(indent + "    " + k + ":")
        for (const item of v) body.push(indent + "      - " + JSON.stringify(item))
      } else if (typeof v === "object") {
        body.push(indent + "    " + k + ":")
        for (const [k2, v2] of Object.entries(v)) body.push(indent + "      " + k2 + ": " + JSON.stringify(v2))
      } else {
        body.push(indent + "    " + k + ": " + JSON.stringify(v))
      }
    }
  }
  return body.join("\n")
}

/** Render the home patch: the id-target rows first, then one `- insert:` list. */
function renderPatch(rows: readonly Row[], existingIds: ReadonlySet<string>): string {
  // `alwaysIdTarget` rows are emitted as column-0 id-targets unconditionally: their
  // subject is declared by a LAYER (the web-app bundle), not by the target home
  // patch, so an insert would collide on the loader entry id on a fresh install.
  /** Rows emitted as column-0 id-target overrides. */
  const existing: readonly Row[] = rows.filter((r: Row): boolean => r.alwaysIdTarget === true || existingIds.has(r.id))
  /** Rows emitted under the single `- insert:` list. */
  const inserts: readonly Row[] = rows.filter((r: Row): boolean => r.alwaysIdTarget !== true && !existingIds.has(r.id))
  /** The patch sections, joined by a blank line. */
  const parts: string[] = []
  if (existing.length) parts.push(existing.map((r: Row): string => renderRow(r, "")).join("\n"))
  if (inserts.length) parts.push("- insert:\n" + inserts.map((r: Row): string => renderRow(r, "  ")).join("\n"))
  return parts.join("\n\n")
}

/** The offline self-test: pins the plan's path model, row set and render rules; writes only under `.qa-reloc/`. */
function selfTest(): void {
  /** The plan for the mpd profile against a home that never exists on disk. */
  const plan: Plan = buildPlan({ profile: "mpd", yes: false, dshHome: join(homedir(), ".mpd-not-real") })
  if (plan.homePatch !== join(plan.dshHome, "cordis.patch.yml")) { console.error("[install-profile self-test] FAIL: path model"); process.exit(1) }
  /** The ids the plan declares, which every row-set assertion below reads. */
  const rows: string[] = plan.rows.map((r: Row): string => r.id)
  if (!rows.includes("mcp-astgrep") || !rows.includes("mpd-codegraph") || !rows.includes("mpd-agent-team") || !rows.includes("preset-mpd")) { console.error("[install-profile self-test] FAIL: row set"); process.exit(1) }
  // The sidebar row + its guard: the guard is EXTRACTED from the bundle patch, so
  // the assertion is that the extraction really carries the patch's own
  // `disabled:` scalar (a stale duplicate used to redden here — that is the drift
  // class this shape closes).
  /** The sidebar row under test; its guard must be the extracted one. */
  const sidebarRow: Row | undefined = plan.rows.find((r: Row): boolean => r.id === "mpd-better-sidebar")
  /** The bundle patch's bytes, so the assertion compares against the patch itself. */
  const bundlePatchText: string = readFileSync(join(repoRoot, "cordis.patch.yml"), "utf8")
  if (!sidebarRow || sidebarRow.name !== "dsh-better-sidebar" || sidebarRow.disabledYaml !== SIDEBAR_GUARD) { console.error("[install-profile self-test] FAIL: sidebar row + guard"); process.exit(1) }
  if (!/^!!js\s/.test(SIDEBAR_GUARD) || !SIDEBAR_GUARD.includes("dsh-better-sidebar")) { console.error("[install-profile self-test] FAIL: the extracted sidebar guard is not the patch's `!!js` mount guard"); process.exit(1) }
  if (!bundlePatchText.includes("disabled: " + SIDEBAR_GUARD)) { console.error("[install-profile self-test] FAIL: the extracted sidebar guard is not byte-identical to the bundle patch's own `disabled:` scalar"); process.exit(1) }
  if (!rows.includes("mcp-context7") || !rows.includes("mcp-grepapp")) { console.error("[install-profile self-test] FAIL: mcp-context7/mcp-grepapp rows"); process.exit(1) }
  for (const mcp of ["mcp-astgrep", "mcp-gitbash", "mcp-lsp", "mcp-codegraph"]) {
    /** The MCP row under test; every one of them must carry the same call timeout. */
    const r: Row | undefined = plan.rows.find((x: Row): boolean => x.id === mcp)
    // Every MCP row is built with a config object above, so the optional field is present here.
    if (!r || r.config!.toolCallTimeoutMs !== 60000) { console.error("[install-profile self-test] FAIL: " + mcp + " toolCallTimeoutMs"); process.exit(1) }
  }
  // ── Agent Teams: the official plugin set (0.1.7-rc.2) ─────────────────────
  // The vendored `agent-teams` row is retired with this wave; the three official
  // rows replace it and their entry NAMES are the official package names, so the
  // config plane pinned here is the plugins' own.
  for (const [id, name] of [["mpd-agent-team", "@deepseek-ai/dsh-experimental-agent-team"], ["mpd-tool-agent-team", "@deepseek-ai/dsh-experimental-tool-agent-team"], ["mpd-ui-agent-team", "@deepseek-ai/dsh-experimental-client-ui-agent-team"]]) {
    /** The official row whose entry name must be the official package name. */
    const row: Row | undefined = plan.rows.find((r: Row): boolean => r.id === id)
    if (!row || row.name !== name) { console.error("[install-profile self-test] FAIL: official agent-team row " + id + " (want " + name + ")"); process.exit(1) }
  }
  if (rows.includes("agent-teams")) { console.error("[install-profile self-test] FAIL: the retired vendored agent-teams row is still declared"); process.exit(1) }
  // The three official rows were just asserted to exist, and this one is built with a config.
  /** The `mpd-agent-team` row's config, whose five limits are pinned next. */
  const teamPlane = plan.rows.find((r: Row): boolean => r.id === "mpd-agent-team")!.config!
  for (const [key, want] of Object.entries({ maxMembers: 16, maxTasks: 256, maxPendingMessagesPerMember: 64, maxMessageBytes: 32768, disposalTimeoutMs: 5000 })) {
    if (teamPlane[key] !== want) { console.error("[install-profile self-test] FAIL: mpd-agent-team config." + key + " (want " + JSON.stringify(want) + ", got " + JSON.stringify(teamPlane[key]) + ")"); process.exit(1) }
  }
  // The official-row assertion above covers this row too, and it is built with a config.
  /** The `mpd-tool-agent-team` row's config, whose two providers are pinned next. */
  const toolTeamPlane = plan.rows.find((r: Row): boolean => r.id === "mpd-tool-agent-team")!.config!
  if (toolTeamPlane.freshProvider !== "spawn" || toolTeamPlane.forkProvider !== "fork") { console.error("[install-profile self-test] FAIL: mpd-tool-agent-team providers"); process.exit(1) }
  // ── the agent preset plane (0.1.7-rc.2 row model) ─────────────────────────
  // The registry row must be an UNCONDITIONAL column-0 id-target (its subject is
  // declared by the web-app layer) and the preset row must carry the composition
  // extracted VERBATIM from the bundle's own preset patch.
  /** The web-plane registry row: an unconditional id-target defaulting to the mpd preset. */
  const registry: Row | undefined = plan.rows.find((r: Row): boolean => r.id === "agent-preset-registry")
  if (!registry || registry.alwaysIdTarget !== true || registry.config?.default !== "mpd") { console.error("[install-profile self-test] FAIL: agent-preset-registry row (want an always-id-target with default: mpd)"); process.exit(1) }
  /** The TUI-plane registry row, which a dsh-tui profile needs for the same reason. */
  const tuiRegistry: Row | undefined = plan.rows.find((r: Row): boolean => r.id === "dsh-tui-agent-preset-registry")
  if (!tuiRegistry || tuiRegistry.alwaysIdTarget !== true || tuiRegistry.config?.default !== "mpd") { console.error("[install-profile self-test] FAIL: dsh-tui-agent-preset-registry row (want an always-id-target with default: mpd — a dsh-tui profile composes no dsh-web-app layer, so the web-plane target is skipped there and that composition declares no `standard` preset)"); process.exit(1) }
  if (tuiRegistry.name !== registry.name) { console.error("[install-profile self-test] FAIL: both registry targets must name the SAME package"); process.exit(1) }
  /** The preset row, which must carry the verbatim bundle block. */
  const presetRow: Row | undefined = plan.rows.find((r: Row): boolean => r.id === "preset-mpd")
  if (!presetRow || !presetRow.rawRow) { console.error("[install-profile self-test] FAIL: preset-mpd row must carry the verbatim block from the bundle patch"); process.exit(1) }
  /** The verbatim preset block's lines, so the shape assertions read as text. */
  const presetText: string = presetRow.rawRow.lines.join("\n")
  if (!/name: '@deepseek-ai\/dsh-agent-preset'$/m.test(presetText) || !/^\s+id: mpd$/m.test(presetText) || !/^\s+plugins:$/m.test(presetText)) {
    console.error("[install-profile self-test] FAIL: the extracted preset-mpd block is not a '@deepseek-ai/dsh-agent-preset' row with config.id: mpd + plugins"); process.exit(1)
  }
  if (!/prefix: >-/.test(presetText)) { console.error("[install-profile self-test] FAIL: the extracted preset-mpd block lost the persona block scalar"); process.exit(1) }
  if (!rows.includes("mpd-hashline")) { console.error("[install-profile self-test] FAIL: mpd-hashline row"); process.exit(1) }
  if (!rows.includes("mpd-roles") || !rows.includes("mpd-workmate") || !rows.includes("mpd-bootstrap")) { console.error("[install-profile self-test] FAIL: mpd-roles/workmate/bootstrap rows"); process.exit(1) }
  // The two rows the parity gate proved were missing: the extension registry (new with
  // the extension interface) and the team-compact row (absent since it landed in the
  // patch). Both are pinned here so a future removal fails the self-test too.
  if (!rows.includes("mpd-ext") || !rows.includes("mpd-team-compact") || !rows.includes("mpd-team-tools") || !rows.includes("mpd-roster-provider")) { console.error("[install-profile self-test] FAIL: mpd-ext/team-compact/team-tools/roster-provider rows"); process.exit(1) }
  // web-compat entry name must be exactly the bare bundle specifier (client-modules
  // contract) — never an absolute path
  /** The web-compat row, whose entry name is a resolution contract, not a path. */
  const webCompat: Row | undefined = plan.rows.find((r: Row): boolean => r.id === "mpd-web-compat")
  if (!webCompat || webCompat.name !== "@mpd-dsh/mpd") { console.error("[install-profile self-test] FAIL: web-compat entry name (want '@mpd-dsh/mpd', got " + (webCompat && webCompat.name) + ")"); process.exit(1) }
  // id-target contract: rows already present in the target home patch render as
  // id-target overrides (not inserts); fresh rows render under `- insert:`
  // (under .qa-reloc/ — a gitignored scratch root, so failure residue never commits)
  /** The scratch home the render assertions write and remove again. */
  const tmp: string = join(repoRoot, ".qa-reloc", "installer-selftest")
  mkdirSync(tmp, { recursive: true })
  writeFileSync(join(tmp, "cordis.patch.yml"), "- id: mcp-astgrep\n  name: old\n- id: mpd-tools\n  name: old\n")
  try {
    /** The plan re-read against the scratch home above. */
    const p2: Plan = buildPlan({ profile: "mpd", yes: false, dshHome: tmp })
    /** The ids the scratch home patch declares, which must drive the id-target render. */
    const existing: Set<string> = readExistingIds(p2.homePatch)
    if (!existing.has("mcp-astgrep") || !existing.has("mpd-tools") || existing.has("mpd-ulw")) { console.error("[install-profile self-test] FAIL: existing-id scan"); process.exit(1) }
    /** The patch rendered against a home that already declares two of the rows. */
    const patch: string = renderPatch(p2.rows, existing)
    if (!/^- id: mcp-astgrep\b/m.test(patch) || !/^- insert:[\s\S]*^ {2}- id: mpd-ulw\b/m.test(patch)) { console.error("[install-profile self-test] FAIL: id-target render (existing rows must not be inserts)"); process.exit(1) }
    if (/- insert:[\s\S]*^ {0,2}- id: mcp-astgrep\b/m.test(patch)) { console.error("[install-profile self-test] FAIL: existing row rendered as insert"); process.exit(1) }
    // The registry row is an id-target EVEN on a fresh home patch (no existing ids):
    // its subject lives in the web-app layer, not in the target patch.
    /** The patch rendered against a home that declares no row at all. */
    const fresh: string = renderPatch(p2.rows, new Set())
    if (!/^- id: agent-preset-registry\b/m.test(fresh)) { console.error("[install-profile self-test] FAIL: agent-preset-registry must render as a column-0 id-target on a fresh install"); process.exit(1) }
    if (/- insert:[\s\S]*^ {0,2}- id: agent-preset-registry\b/m.test(fresh)) { console.error("[install-profile self-test] FAIL: agent-preset-registry rendered as an insert (duplicate loader entry id)"); process.exit(1) }
    // The preset row renders inside the insert list with its nested children intact.
    if (!/^ {2}- id: preset-mpd\b/m.test(fresh)) { console.error("[install-profile self-test] FAIL: preset-mpd must render as an insert row at indent 2"); process.exit(1) }
    if (!/^ {8}- id: persona\b/m.test(fresh)) { console.error("[install-profile self-test] FAIL: the preset row's inline child rows must keep their nesting (persona not found at indent 8)"); process.exit(1) }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }) } catch { /* best-effort cleanup */ }
  }
  console.log("[install-profile self-test] ok: path model + row set + official agent-team rows + preset row (verbatim) + registry id-target + web-compat entry + id-target render verified")
}

/** The entry point: parse the flags, print the plan, and write it only under `--yes`. */
function main(): void {
  // ONE npm install for ALL toolchain packages: separate --no-save installs prune
  /** The parsed command line; `--self-test` short-circuits everything below. */
  const o: Options = parseArgs(process.argv.slice(2))
  if (o.selfTest) { selfTest(); return }
  /** The install plan, shared by the dry run and the write path. */
  const plan: Plan = buildPlan(o)
  /** The ids the target home patch already declares, read once. */
  const existingIds: Set<string> = readExistingIds(plan.homePatch)
  /** The home patch text this run prints and, under `--yes`, writes. */
  const patchText: string = renderPatch(plan.rows, existingIds)
  console.log("[install-profile] dshHome=" + plan.dshHome + " profile=" + o.profile + " write=" + o.yes)
  console.log("[install-profile] profileDir=" + plan.profileDir)
  console.log("[install-profile] homePatch=" + plan.homePatch)
  console.log("[install-profile] preset row <- " + plan.presetPatchPath + " (verbatim preset-mpd block; NO $DSH_HOME/.agent-presets copy — the row model has no preset root)")
  console.log("[install-profile] toolchain missing=" + plan.needsToolchain + " (use --skip-toolchain to skip)")
  /** How many rows render as id-target overrides (forced, or already present). */
  const idTargeted: number = plan.rows.filter((r: Row): boolean => r.alwaysIdTarget === true || existingIds.has(r.id)).length
  console.log("[install-profile] rows about to be written to home patch: " + plan.rows.length + " (id-target=" + idTargeted + ", insert=" + (plan.rows.length - idTargeted) + ")")
  console.log(patchText)
  if (!o.yes) { console.log("[install-profile] DRY-RUN done (nothing written); add --yes to actually install, and --dsh-home to override the target"); return }

  mkdirSync(plan.profileDir, { recursive: true })
  // profile manifest (bundles use only what ships with DSH; all capabilities go through the home patch)
  writeFileSync(join(plan.profileDir, "package.json"), JSON.stringify({
    name: "dsh-profile-" + o.profile, private: true,
    dependencies: {},
    dsh: { profile: { bundles: [plan.bundle0, plan.bundle1] } }
  }, null, 2) + "\n")
  writeFileSync(join(plan.profileDir, "cordis.patch.yml"), "[]\n")
  // Single-pass home patch: the agent-teams row is a plain path row now (the adopted
  // plugin is first-class main code with its own _deps closure), so the old npm-install
  // + two-pass override dance is obsolete. Rows whose id already exists in the target
  // patch are written as id-target overrides (AGENTS.md §8 contract).
  writeFileSync(plan.homePatch, patchText + "\n")
  // Web-compat shim: make '@mpd-dsh/mpd' resolvable off the profile baseUrl. The
  // loader entry name and client-modules' `<name>/package.json` lookup both anchor
  // at the profile dir, so the shim must live in the profile's node_modules; it
  // mirrors the packed bundle's own package.json (dsh.client web + exports["./client"]).
  /** The profile-local shim directory that makes `@mpd-dsh/mpd` resolvable. */
  const shimDir: string = join(plan.profileDir, "node_modules", "@mpd-dsh", "mpd")
  mkdirSync(shimDir, { recursive: true })
  /** The root manifest, read for the version the shim's own manifest mirrors. */
  const rootPkg: Manifest = readJson<Manifest>(join(repoRoot, "package.json"))
  cpSync(join(repoRoot, "packages", "mpd-bundle-plugin", "dist", "index.js"), join(shimDir, "index.js"))
  cpSync(join(repoRoot, "packages", "mpd-bundle-plugin", "client.js"), join(shimDir, "client.js"))
  writeFileSync(join(shimDir, "package.json"), JSON.stringify({
    name: "@mpd-dsh/mpd", version: rootPkg.version, private: true, type: "module",
    main: "./index.js",
    exports: { ".": "./index.js", "./client": "./client.js", "./package.json": "./package.json" },
    dsh: { client: { inject: [], platform: "web" } }
  }, null, 2) + "\n")
  // NO preset copy: the 0.1.7-rc.2 preset model has no preset ROOT to scan. The
  // mpd composition ships as the `preset-mpd` ROW inside the home patch written
  // above (extracted verbatim from the bundle's own preset patch), and
  // `agent-preset-registry` is id-targeted to `default: mpd` there. A legacy
  // `.agent-presets` copy would be dead bytes the harness never reads.
  console.log("[install-profile] wrote profile/ + home patch (" + plan.rows.length + " rows incl. preset-mpd) + web-compat shim @mpd-dsh/mpd")
  // ONE npm install for ALL toolchain packages: separate --no-save installs prune
  // each other (npm deletes packages absent from the single command).
  /** The toolchain packages the single npm install must cover. */
  const toolchainPkgs: string[] = ["@ast-grep/cli", "@colbymchenry/codegraph@1.5.0"]
  if (o.commentChecker) toolchainPkgs.push("@code-yeongyu/comment-checker@0.8.0")
  if ((plan.needsToolchain || o.commentChecker) && !o.skipToolchain) {
    console.log("[install-profile] installing toolchain (" + toolchainPkgs.join(" + ") + ")...")
    /** The completed npm install; a non-zero status is reported, never retried. */
    const r = spawnSync("npm", ["install", "--prefix", join(repoRoot, ".toolchain"), "--no-save", "--no-audit", "--no-fund", "--cache", join(repoRoot, ".toolchain/.npm-cache"), ...toolchainPkgs], { stdio: "inherit" })
    if (r.status !== 0) { console.error("[install-profile] toolchain install failed; try --skip-toolchain and install manually"); process.exitCode = 1; return }
  }
  console.log("[install-profile] done. Start with: dsh --profile " + o.profile + "   (the web preset selector will show the mpd preset)")
}

main()
