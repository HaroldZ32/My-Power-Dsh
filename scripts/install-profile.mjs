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

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

function parseArgs(argv) {
  const o = { profile: "mpd", yes: false, dshHome: null, selfTest: false, skipToolchain: false, commentChecker: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
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
function extractRowBlock(patchText, rowId) {
  const lines = patchText.split("\n")
  const pattern = new RegExp("^(\\s*)- id: " + rowId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$")
  const start = lines.findIndex((l) => pattern.test(l))
  if (start < 0) throw new Error("bundle patch has no row `" + rowId + "`")
  const base = lines[start].match(/^ */)[0].length
  const out = []
  for (let i = start; i < lines.length; i++) {
    const l = lines[i]
    if (l.trim() === "") { out.push(""); continue }
    if (i > start && l.match(/^ */)[0].length <= base) break
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
function sidebarGuardFromPatch() {
  const text = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  const block = extractRowBlock(text, "mpd-better-sidebar")
  const line = block.lines.find((l) => /^\s*disabled:\s*!!js\s/.test(l))
  if (line === undefined) throw new Error("the bundle patch's mpd-better-sidebar row has no `disabled: !!js` guard")
  const match = /^\s*disabled:\s*(!!js\s.*)$/.exec(line)
  if (match === null) throw new Error("the bundle patch's mpd-better-sidebar guard is not a single `!!js` scalar")
  const guard = match[1].trim()
  if (!guard.includes("dsh-better-sidebar") || !guard.includes("baseUrl")) throw new Error("the extracted sidebar guard is not the mount guard this file pins: " + guard.slice(0, 80))
  return guard
}
const SIDEBAR_GUARD = sidebarGuardFromPatch()

function buildPlan(o) {
  const dshHome = o.dshHome ?? process.env.DSH_HOME ?? join(homedir(), ".dsh")
  const isHeadless = o.profile === "mpd-headless"
  const bundle0 = "@deepseek-ai/dsh-base"
  const bundle1 = isHeadless ? "@deepseek-ai/dsh-headless" : "@deepseek-ai/dsh-web-app"
  const p = (r) => join(repoRoot, r)
  const presetsDir = p("presets")
  const presetPatchPath = join(presetsDir, "mpd.patch.yml")
  const astCli = p(".toolchain/node_modules/.bin/sg")
  const cgCli = p(".toolchain/node_modules/.bin/codegraph")
  // The mpd composition, extracted VERBATIM from the bundle's own preset patch:
  // the manifest's `dsh.bundle.patch` array names that file as the second patch
  // layer, so it is the single source of truth for the preset row.
  const presetRowBlock = (() => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
    const declared = manifest?.dsh?.bundle?.patch
    const list = Array.isArray(declared) ? declared : typeof declared === "string" ? [declared] : []
    for (const entry of list) {
      const file = join(repoRoot, entry)
      if (!existsSync(file)) continue
      const text = readFileSync(file, "utf8")
      let block = null
      try { block = extractRowBlock(text, "preset-mpd") } catch { block = null }
      if (block !== null) return block
    }
    throw new Error("no declared bundle patch declares a `preset-mpd` row (package.json dsh.bundle.patch)")
  })()
  const rows = [
    // ── agent preset plane (0.1.7-rc.2 row model) ───────────────────────────
    // The registry row is declared by the WEB-APP layer (`@deepseek-ai/dsh-web-app`
    // inserts `agent-preset-registry` with `default: standard`), so this row is an
    // ID-TARGET at column 0 — emitting it as an insert would collide on the loader
    // entry id. It mirrors the bundle patch's own column-0 id-target verbatim.
    {
      id: "agent-preset-registry", name: "@deepseek-ai/dsh-agent-preset-registry",
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
    // patch's insert set is enforced by scripts/verify-rows-parity.mjs.
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
    // packages/mpd-bundle/cordis.patch.yml, order included.
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
    // config) and in the same order (packages/mpd-bundle/cordis.patch.yml plus the
    // preset patch presets/mpd.patch.yml). Row-id parity with the patch layer is
    // enforced by scripts/verify-rows-parity.mjs.
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
function readExistingIds(homePatch) {
  if (!existsSync(homePatch)) return new Set()
  const t = readFileSync(homePatch, "utf8")
  const ids = new Set()
  // top-level rows appear at column 0 ("- id: X"); insert rows at column 4
  // ("    - id: X"); nested config ids are deeper and are not row ids.
  for (const m of t.matchAll(/^(?: {0,4})- id: ["']?([A-Za-z0-9_.-]+)["']?\s*$/gm)) ids.add(m[1])
  return ids
}

function renderRow(r, indent) {
  // A VERBATIM row block (the `preset-mpd` preset declaration): the whole row —
  // id, name, config, inline group rows and block scalars — comes from the bundle
  // patch and is only re-indented here. Re-rendering it from a parsed object would
  // destroy the nested `cordis:group` rows and the persona block scalar, and
  // hand-transcribing it would drift on the next preset edit.
  if (r.rawRow) {
    const shift = r.rawRow.base - indent.length
    const lines = r.rawRow.lines.map((raw) => {
      if (raw.trim() === "") return ""
      if (shift <= 0) return " ".repeat(-shift) + raw
      return raw.startsWith(" ".repeat(shift)) ? raw.slice(shift) : raw.replace(/^ +/, "")
    })
    if (r.rawRow.lines.length === 0) throw new Error("row `" + r.id + "` has an empty raw block")
    return lines.join("\n")
  }
  const body = []
  body.push(indent + "- id: " + r.id)
  body.push(indent + "  name: " + JSON.stringify(r.name))
  // `disabledYaml` carries a raw YAML form (`!!js "..."`); `disabled` a literal.
  if (r.disabledYaml !== undefined) body.push(indent + "  disabled: " + r.disabledYaml)
  else if (r.disabled !== undefined) body.push(indent + "  disabled: " + JSON.stringify(r.disabled))
  const hasConfig = r.config && Object.keys(r.config).length > 0
  if (hasConfig) body.push(indent + "  config:")
  if (hasConfig) {
    for (const [k, v] of Object.entries(r.config)) {
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

function renderPatch(rows, existingIds) {
  // `alwaysIdTarget` rows are emitted as column-0 id-targets unconditionally: their
  // subject is declared by a LAYER (the web-app bundle), not by the target home
  // patch, so an insert would collide on the loader entry id on a fresh install.
  const existing = rows.filter((r) => r.alwaysIdTarget === true || existingIds.has(r.id))
  const inserts = rows.filter((r) => r.alwaysIdTarget !== true && !existingIds.has(r.id))
  const parts = []
  if (existing.length) parts.push(existing.map((r) => renderRow(r, "")).join("\n"))
  if (inserts.length) parts.push("- insert:\n" + inserts.map((r) => renderRow(r, "  ")).join("\n"))
  return parts.join("\n\n")
}

function selfTest() {
  const plan = buildPlan({ profile: "mpd", yes: false, dshHome: join(homedir(), ".mpd-not-real") })
  if (plan.homePatch !== join(plan.dshHome, "cordis.patch.yml")) { console.error("[install-profile self-test] FAIL: path model"); process.exit(1) }
  const rows = plan.rows.map((r) => r.id)
  if (!rows.includes("mcp-astgrep") || !rows.includes("mpd-codegraph") || !rows.includes("mpd-agent-team") || !rows.includes("preset-mpd")) { console.error("[install-profile self-test] FAIL: row set"); process.exit(1) }
  // The sidebar row + its guard: the guard is EXTRACTED from the bundle patch, so
  // the assertion is that the extraction really carries the patch's own
  // `disabled:` scalar (a stale duplicate used to redden here — that is the drift
  // class this shape closes).
  const sidebarRow = plan.rows.find((r) => r.id === "mpd-better-sidebar")
  const bundlePatchText = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  if (!sidebarRow || sidebarRow.name !== "dsh-better-sidebar" || sidebarRow.disabledYaml !== SIDEBAR_GUARD) { console.error("[install-profile self-test] FAIL: sidebar row + guard"); process.exit(1) }
  if (!/^!!js\s/.test(SIDEBAR_GUARD) || !SIDEBAR_GUARD.includes("dsh-better-sidebar")) { console.error("[install-profile self-test] FAIL: the extracted sidebar guard is not the patch's `!!js` mount guard"); process.exit(1) }
  if (!bundlePatchText.includes("disabled: " + SIDEBAR_GUARD)) { console.error("[install-profile self-test] FAIL: the extracted sidebar guard is not byte-identical to the bundle patch's own `disabled:` scalar"); process.exit(1) }
  if (!rows.includes("mcp-context7") || !rows.includes("mcp-grepapp")) { console.error("[install-profile self-test] FAIL: mcp-context7/mcp-grepapp rows"); process.exit(1) }
  for (const mcp of ["mcp-astgrep", "mcp-gitbash", "mcp-lsp", "mcp-codegraph"]) {
    const r = plan.rows.find((x) => x.id === mcp)
    if (!r || r.config.toolCallTimeoutMs !== 60000) { console.error("[install-profile self-test] FAIL: " + mcp + " toolCallTimeoutMs"); process.exit(1) }
  }
  // ── Agent Teams: the official plugin set (0.1.7-rc.2) ─────────────────────
  // The vendored `agent-teams` row is retired with this wave; the three official
  // rows replace it and their entry NAMES are the official package names, so the
  // config plane pinned here is the plugins' own.
  for (const [id, name] of [["mpd-agent-team", "@deepseek-ai/dsh-experimental-agent-team"], ["mpd-tool-agent-team", "@deepseek-ai/dsh-experimental-tool-agent-team"], ["mpd-ui-agent-team", "@deepseek-ai/dsh-experimental-client-ui-agent-team"]]) {
    const row = plan.rows.find((r) => r.id === id)
    if (!row || row.name !== name) { console.error("[install-profile self-test] FAIL: official agent-team row " + id + " (want " + name + ")"); process.exit(1) }
  }
  if (rows.includes("agent-teams")) { console.error("[install-profile self-test] FAIL: the retired vendored agent-teams row is still declared"); process.exit(1) }
  const teamPlane = plan.rows.find((r) => r.id === "mpd-agent-team").config
  for (const [key, want] of Object.entries({ maxMembers: 16, maxTasks: 256, maxPendingMessagesPerMember: 64, maxMessageBytes: 32768, disposalTimeoutMs: 5000 })) {
    if (teamPlane[key] !== want) { console.error("[install-profile self-test] FAIL: mpd-agent-team config." + key + " (want " + JSON.stringify(want) + ", got " + JSON.stringify(teamPlane[key]) + ")"); process.exit(1) }
  }
  const toolTeamPlane = plan.rows.find((r) => r.id === "mpd-tool-agent-team").config
  if (toolTeamPlane.freshProvider !== "spawn" || toolTeamPlane.forkProvider !== "fork") { console.error("[install-profile self-test] FAIL: mpd-tool-agent-team providers"); process.exit(1) }
  // ── the agent preset plane (0.1.7-rc.2 row model) ─────────────────────────
  // The registry row must be an UNCONDITIONAL column-0 id-target (its subject is
  // declared by the web-app layer) and the preset row must carry the composition
  // extracted VERBATIM from the bundle's own preset patch.
  const registry = plan.rows.find((r) => r.id === "agent-preset-registry")
  if (!registry || registry.alwaysIdTarget !== true || registry.config?.default !== "mpd") { console.error("[install-profile self-test] FAIL: agent-preset-registry row (want an always-id-target with default: mpd)"); process.exit(1) }
  const presetRow = plan.rows.find((r) => r.id === "preset-mpd")
  if (!presetRow || !presetRow.rawRow) { console.error("[install-profile self-test] FAIL: preset-mpd row must carry the verbatim block from the bundle patch"); process.exit(1) }
  const presetText = presetRow.rawRow.lines.join("\n")
  if (!/name: '@deepseek-ai\/dsh-agent-preset'$/m.test(presetText) || !/^\s+id: mpd$/m.test(presetText) || !/^\s+plugins:$/m.test(presetText)) {
    console.error("[install-profile self-test] FAIL: the extracted preset-mpd block is not a '@deepseek-ai/dsh-agent-preset' row with config.id: mpd + plugins"); process.exit(1)
  }
  if (!/prefix: >-/.test(presetText)) { console.error("[install-profile self-test] FAIL: the extracted preset-mpd block lost the persona block scalar"); process.exit(1) }
  if (!rows.includes("mpd-hashline")) { console.error("[install-profile self-test] FAIL: mpd-hashline row"); process.exit(1) }
  if (!rows.includes("mpd-roles") || !rows.includes("mpd-workmate") || !rows.includes("mpd-bootstrap")) { console.error("[install-profile self-test] FAIL: mpd-roles/workmate/bootstrap rows"); process.exit(1) }
  // The two rows the parity gate proved were missing: the extension registry (new with
  // the extension interface) and the team-compact row (absent since it landed in the
  // patch). Both are pinned here so a future removal fails the self-test too.
  if (!rows.includes("mpd-ext") || !rows.includes("mpd-team-compact")) { console.error("[install-profile self-test] FAIL: mpd-ext/team-compact rows"); process.exit(1) }
  // web-compat entry name must be exactly the bare bundle specifier (client-modules
  // contract) — never an absolute path
  const webCompat = plan.rows.find((r) => r.id === "mpd-web-compat")
  if (!webCompat || webCompat.name !== "@mpd-dsh/mpd") { console.error("[install-profile self-test] FAIL: web-compat entry name (want '@mpd-dsh/mpd', got " + (webCompat && webCompat.name) + ")"); process.exit(1) }
  // id-target contract: rows already present in the target home patch render as
  // id-target overrides (not inserts); fresh rows render under `- insert:`
  // (under .qa-reloc/ — a gitignored scratch root, so failure residue never commits)
  const tmp = join(repoRoot, ".qa-reloc", "installer-selftest")
  mkdirSync(tmp, { recursive: true })
  writeFileSync(join(tmp, "cordis.patch.yml"), "- id: mcp-astgrep\n  name: old\n- id: mpd-tools\n  name: old\n")
  try {
    const p2 = buildPlan({ profile: "mpd", yes: false, dshHome: tmp })
    const existing = readExistingIds(p2.homePatch)
    if (!existing.has("mcp-astgrep") || !existing.has("mpd-tools") || existing.has("mpd-ulw")) { console.error("[install-profile self-test] FAIL: existing-id scan"); process.exit(1) }
    const patch = renderPatch(p2.rows, existing)
    if (!/^- id: mcp-astgrep\b/m.test(patch) || !/^- insert:[\s\S]*^ {2}- id: mpd-ulw\b/m.test(patch)) { console.error("[install-profile self-test] FAIL: id-target render (existing rows must not be inserts)"); process.exit(1) }
    if (/- insert:[\s\S]*^ {0,2}- id: mcp-astgrep\b/m.test(patch)) { console.error("[install-profile self-test] FAIL: existing row rendered as insert"); process.exit(1) }
    // The registry row is an id-target EVEN on a fresh home patch (no existing ids):
    // its subject lives in the web-app layer, not in the target patch.
    const fresh = renderPatch(p2.rows, new Set())
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

function main() {
  // ONE npm install for ALL toolchain packages: separate --no-save installs prune
  const o = parseArgs(process.argv.slice(2))
  if (o.selfTest) { selfTest(); return }
  const plan = buildPlan(o)
  const existingIds = readExistingIds(plan.homePatch)
  const patchText = renderPatch(plan.rows, existingIds)
  console.log("[install-profile] dshHome=" + plan.dshHome + " profile=" + o.profile + " write=" + o.yes)
  console.log("[install-profile] profileDir=" + plan.profileDir)
  console.log("[install-profile] homePatch=" + plan.homePatch)
  console.log("[install-profile] preset row <- " + plan.presetPatchPath + " (verbatim preset-mpd block; NO $DSH_HOME/.agent-presets copy — the row model has no preset root)")
  console.log("[install-profile] toolchain missing=" + plan.needsToolchain + " (use --skip-toolchain to skip)")
  const idTargeted = plan.rows.filter((r) => r.alwaysIdTarget === true || existingIds.has(r.id)).length
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
  const shimDir = join(plan.profileDir, "node_modules", "@mpd-dsh", "mpd")
  mkdirSync(shimDir, { recursive: true })
  const rootPkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
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
  const toolchainPkgs = ["@ast-grep/cli", "@colbymchenry/codegraph@1.5.0"]
  if (o.commentChecker) toolchainPkgs.push("@code-yeongyu/comment-checker@0.8.0")
  if ((plan.needsToolchain || o.commentChecker) && !o.skipToolchain) {
    console.log("[install-profile] installing toolchain (" + toolchainPkgs.join(" + ") + ")...")
    const r = spawnSync("npm", ["install", "--prefix", join(repoRoot, ".toolchain"), "--no-save", "--no-audit", "--no-fund", "--cache", join(repoRoot, ".toolchain/.npm-cache"), ...toolchainPkgs], { stdio: "inherit" })
    if (r.status !== 0) { console.error("[install-profile] toolchain install failed; try --skip-toolchain and install manually"); process.exitCode = 1; return }
  }
  console.log("[install-profile] done. Start with: dsh --profile " + o.profile + "   (the web preset selector will show the mpd preset)")
}

main()
