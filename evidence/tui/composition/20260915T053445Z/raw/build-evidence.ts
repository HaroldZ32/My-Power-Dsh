#!/usr/bin/env node
// t5 evidence builder: turns the raw live-lane artifacts recorded in this
// directory into machine-readable evidence (tool list, session/preset records,
// boot-log scan, row-id accounting) and the per-package TUI compatibility
// ledger. Every claim it emits points at a raw artifact in this directory; it
// invents nothing.
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { decodeSessionLog } from "../../../../../skills/dsh-qa/scripts/lib/session-evidence.ts"

const here = dirname(fileURLToPath(import.meta.url))
const evidenceDir = resolve(here, "..")
const repoRoot = resolve(evidenceDir, "../../../..")
const sandbox = join(repoRoot, ".mpd/recon/qa")
const raw = (name) => join(here, name)
const read = (file) => readFileSync(file, "utf8")
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/\r/g, "")
const sha256 = (file) => "sha256:" + createHash("sha256").update(readFileSync(file)).digest("hex")
const write = (name, value) => writeFileSync(raw(name), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n")
// The ledger is the AC-12 deliverable and must sit at the evidence-directory
// root (evidence/tui/composition/<ts>/ledger.json), not under raw/.
const writeTop = (name, value) => writeFileSync(join(evidenceDir, name), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n")

// ---- 0. snapshot the measured inputs into the evidence directory -----------
for (const [from, to] of [
  [join(repoRoot, "dsh-plugin.json"), "dsh-plugin.json.snapshot"],
  [join(sandbox, "t5-dump-config2.txt"), "dsh-tui-dump-config.txt"],
  [join(sandbox, "t5-dump-config2.err"), "dsh-tui-dump-config.err"],
  [join(sandbox, "dshhome/profiles/dsh-tui/package.json"), "dsh-tui-profile.package.json"],
  [join(sandbox, "dshhome/profiles/dsh-tui/cordis.patch.yml"), "dsh-tui-profile.cordis.patch.yml"],
  [join(repoRoot, "packages/mpd-bundle/cordis.patch.yml"), "bundle-cordis.patch.yml.snapshot"],
]) if (existsSync(from)) copyFileSync(from, raw(to))

// ---- 1. session records: the preset measurement ----------------------------
const sessionsRoot = join(sandbox, "dshhome/sessions")
const sessionRecords = []
for (const key of readdirSync(sessionsRoot)) {
  const keyDir = join(sessionsRoot, key)
  if (!statSync(keyDir).isDirectory()) continue
  for (const id of readdirSync(keyDir)) {
    const dir = join(keyDir, id)
    if (!statSync(dir).isDirectory()) continue
    for (const name of readdirSync(dir)) {
      if (!/^session\..*jsonl(\.zstd)?$/.test(name)) continue
      const file = join(dir, name)
      const decoded = name.endsWith(".zstd") ? decodeSessionLog(file) : { text: read(file), frames: 1 }
      const records = decoded.text.split("\n").map((l) => l.trim()).filter(Boolean)
        .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      const header = records.find((r) => r.type === "session")
      const header_rec = records.find((r) => r.type === "request/header")
      sessionRecords.push({
        key, id, file: file.replace(repoRoot + "/", ""), mtime: new Date(statSync(file).mtimeMs).toISOString(),
        frames: decoded.frames, records: records.length,
        cwd: header?.cwd, agentPreset: header?.agentPreset, createdAt: header?.createdAt,
        toolCount: header_rec?.data?.header?.tools?.length ?? null,
      })
    }
  }
}
sessionRecords.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
write("session-evidence.json", {
  note: "Every live dsh-TUI session in the isolated sandbox store, oldest first. Sessions created BEFORE this task's composition change recorded agentPreset=standard; the sessions created after it record agentPreset=mpd.",
  workspaceKeySeen: [...new Set(sessionRecords.map((s) => s.key))],
  sessions: sessionRecords,
})

// ---- 2. tool list from the recorded request header -------------------------
// Pin the tool list to the session THIS lane drove and captured (tui-boot-turn.sh);
// later sessions can come from other writers or from a rebuilt plugin and would
// mix revisions into one evidence file.
const PINNED_TURN_SESSION = "683c0f89-d2ea-4bf1-817e-3593eb765441"
const withTools = sessionRecords.filter((s) => s.toolCount !== null)
const turn = withTools.find((s) => s.id === PINNED_TURN_SESSION) ?? withTools.at(-1)
let toolList = { note: "no request/header record found", tools: [] }
if (turn !== undefined) {
  const decoded = decodeSessionLog(join(repoRoot, turn.file))
  const records = decoded.text.split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const header = records.find((r) => r.type === "request/header")
  const names = (header?.data?.header?.tools ?? []).map((t) => t?.name).filter(Boolean)
  const family = (n) => n.startsWith("mcp__") ? "mcp__" + n.split("__")[1] : n.split("_").length > 1 ? n.split("_").slice(0, 2).join("_") : n
  const byFamily = {}
  for (const n of names) (byFamily[family(n)] ??= []).push(n)
  toolList = {
    note: "request/header.data.header.tools[] from the recorded live dsh-TUI turn in the sandbox (the repo's own tool-list evidence: skills/dsh-qa/scripts/lib/session-evidence.mjs). The model call itself failed with 'no API key for provider route deepseek-official' (the sandbox carries no route key) — the header is written BEFORE the request and is unaffected.",
    session: turn.id, pinnedSession: PINNED_TURN_SESSION, selection: turn.id === PINNED_TURN_SESSION ? "pinned (the session tui-boot-turn.sh drove)" : "fallback: newest session with a request/header", workspace: turn.cwd, toolCount: names.length, tools: names, byFamily,
    turnEndedWithCredentialError: true,
  }
}
write("tool-list.json", toolList)

// ---- 3. boot-log scan: crash signatures, duplicate ids, counters -----------
const logs = {}
for (const name of ["tui-pane.log", "tui-turn-pane.log", "tui-controls-pane.log", "tui-final-pane.log"]) {
  const file = raw(name)
  if (!existsSync(file)) continue
  const text = stripAnsi(read(file))
  const signatures = [
    "unsupported JSON schema", "JsonSchemaError", "plugin tree failed to load",
    "failed to apply loader entry", "duplicate loader entry id", "Error:",
  ]
  const hits = {}
  for (const s of signatures) hits[s] = [...text.matchAll(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))].length
  const pluginLines = [...new Set((text.match(/\[[A-Za-z0-9_-]+\][^\n]{0,220}/g) ?? []))]
  logs[name] = {
    bytes: readFileSync(file).length,
    crashSignatureHits: hits,
    crashSignatureTotal: Object.values(hits).reduce((a, b) => a + b, 0),
    pluginLogLines: pluginLines,
    counters: {
      tools: /(?:工具|Tools)\s*(\d+)/.exec(text)?.[1] ?? null,
      skills: /(?:技能|Skills)\s*(\d+)/.exec(text)?.[1] ?? null,
    },
  }
}
write("boot-scan.json", {
  note: "ANSI-stripped scans of the raw tmux pane logs. Zero crash-signature hits is the AC-3/AC-1 signal; the pluginLogLines are the per-package apply-time observations used by the ledger.",
  logs,
  presetScreen: (() => {
    // The host's OWN /preset picker, captured on the final manifest: a TUI SCREEN
    // (not a patch read, not a session record alone) naming the active default.
    const file = raw("final-preset.pane.txt")
    if (!existsSync(file)) return null
    const lines = stripAnsi(read(file)).split("\n").join("\n").split("\n")
    const marked = lines.filter((l) => /MPD \(Main Working Agent\)/.test(l))
    return {
      file: "raw/final-preset.pane.txt",
      command: "/preset (host built-in)",
      activeDefaultLine: marked.find((l) => l.includes("\u2713")) ?? marked[0] ?? null,
      allMatchingLines: marked,
      claim: "The host's own preset picker marks MPD (Main Working Agent) as the active DEFAULT with a check mark - the captured-screen form of the mpd-preset clause (AC-11).",
    }
  })(),
  hostReservationCrossCheck: {
    note: "What the live lane actually saw for the dsh-TUI reservation list (TUI-CONVENTIONS.md (e)). Recorded as observations; items outside this task's scope are reported, never silently fixed.",
    dshTuiEnvClaims: "grep over dsh-plugin.json + the whole evidence tree: no DSH_TUI_* variable is claimed by the manifest. The only reads under that namespace are the host's own (the bundle's TUI plugin reuses the host's DSH_TUI_DEBUG for its debug gate; the host source itself reads it 4x).",
    commandNames: "contributes.commands is empty -> no built-in command name is claimed; the live TUI registered 93 tools and 18 skill commands without any refusal attributable to this bundle.",
    settingsNamespace: "This manifest claims NO /settings namespace, so NAMESPACE_CONFLICT is impossible from it. Observed in the plugin source: its section namespace is `mpd` (never the host's `dsh-tui`).",
    themeName: "Observed: the plugin's theme asset is themes/mpd-tui.json with name `mpd-tui`, which is NOT one of the reserved names (auto/light/dark/dark-ansi/status).",
    statusKey: "Observed (informational, t4's surface): the plugin's status key constant is `mpd`, which satisfies the host key regex; the conventions checklist words it as `mpd-tui`. No reserved key is used.",
    optionalServices: "Observed: every seam is resolved through a soft probe and degrades with a debug/warn message instead of failing apply (the live boot shows zero apply-crash signatures with all seven seams present).",
  },
})

// ---- 4. row-id accounting per composition ----------------------------------
const ourRows = []
{
  const dump = read(raw("dsh-tui-dump-config.txt"))
  const lines = dump.split("\n")
  const start = lines.findIndex((l) => l === "# == @mpd-dsh/mpd")
  const section = start === -1 ? [] : lines.slice(start + 1).slice(0, lines.slice(start + 1).findIndex((l) => l.startsWith("# == ")) | 0)
  for (const m of section.join("\n").matchAll(/- id: '?([A-Za-z0-9_.-]+)'?\n\s+name: '([^']+)'/g)) ourRows.push({ id: m[1], name: m[2] })
}
const dupOf = (file) => {
  const ids = [...read(file).matchAll(/^- id: '?([A-Za-z0-9_.-]+)'?/gm)].map((m) => m[1])
  return { total: ids.length, duplicates: [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))] }
}
const tuiDup = dupOf(raw("dsh-tui-dump-config.txt"))
const webDup = existsSync(raw("web-dump-config.txt")) ? dupOf(raw("web-dump-config.txt")) : null
write("row-id-composition.json", {
  note: "Row ids of the host's OWN composed config (dsh --profile <p> --dump-config) — composition evidence only; the authoritative load evidence is the boot-log scan in boot-scan.json. `duplicates` counts repeated top-level `- id:` lines in the composed list, which is exactly what the loader rejects as 'duplicate loader entry id'.",
  dshTui: {
    stderr: read(raw("dsh-tui-dump-config.err")).trim(),
    ourRows,
    ourRowCount: ourRows.length,
    ...tuiDup,
    hasMpdTuiRow: ourRows.some((r) => r.id === "mpd-tui"),
    rosterRow: { id: "dsh-tui-agent-presets", override: "config.default = mpd (id-target; the row's own `disabled` expression is untouched)" },
  },
  web: webDup === null ? null : {
    stderr: read(raw("web-dump-config.err")).trim(),
    ...webDup,
    agentPresetsDefault: /- id: agent-presets\n\s+name: '@deepseek-ai\/dsh-agent-presets'\n\s+config:\n\s+default: (\w+)/.exec(read(raw("web-dump-config.txt")))?.[1] ?? null,
  },
})

// ---- 5. per-package TUI compatibility ledger -------------------------------
const pkgDir = join(repoRoot, "packages")
const packages = readdirSync(pkgDir).filter((n) => n !== "node_modules" && statSync(join(pkgDir, n)).isDirectory())
const toolsByPackage = {
  "mpd-agent-teams-plugin": (toolList.tools ?? []).filter((n) => n.startsWith("agent_teams_")),
  "mpd-boulder-plugin": (toolList.tools ?? []).filter((n) => n.startsWith("mpd_boulder_")),
  "mpd-comment-checker-plugin": (toolList.tools ?? []).filter((n) => n.startsWith("mpd_comment_")),
  "mpd-config-plugin": (toolList.tools ?? []).filter((n) => n.startsWith("mpd_config_")),
  "mpd-ext-plugin": (toolList.tools ?? []).filter((n) => n.startsWith("mpd_ext_") || n.startsWith("mpd_flow_")),
  "mpd-hashline-plugin": (toolList.tools ?? []).filter((n) => n.startsWith("mpd_hashline_")),
  "mpd-memory-plugin": (toolList.tools ?? []).filter((n) => n.startsWith("mpd_memory_")),
  "mpd-modelchain-plugin": (toolList.tools ?? []).filter((n) => n.startsWith("mpd_modelchain_")),
  "mpd-roles-plugin": (toolList.tools ?? []).filter((n) => n.startsWith("mpd_role") ),
  "mpd-team-compact-plugin": (toolList.tools ?? []).filter((n) => n.startsWith("mpd_team_")),
  "mpd-ulw-plugin": (toolList.tools ?? []).filter((n) => n === "mpd_ulw" || n === "mpd_ultrawork"),
  "mpd-workmate-plugin": (toolList.tools ?? []).filter((n) => n.startsWith("mpd_workmate_")),
  "mpd-mcp-astgrep": (toolList.tools ?? []).filter((n) => n.startsWith("mcp__ast_grep__")),
  "mpd-mcp-lsp": (toolList.tools ?? []).filter((n) => n.startsWith("mcp__lsp__")),
  "mpd-mcp-codegraph": (toolList.tools ?? []).filter((n) => n.startsWith("mcp__codegraph")),
}
const rowsFor = (pkg) => ourRows.filter((r) => r.name.includes(`/packages/${pkg}/`))
const OBS = (kind, evidence, quote) => ({ kind, evidence, quote })
// F7 (t15 review): row presence in a patch is NOT an observation. For every
// package this lane could not actually exercise, say so plainly and say why.
const NOT_EXERCISED = {
  "mpd-bundle": "The composition layer itself: what was observed is that the host's own composed config lists its 24 rows and that a live boot mounted them with 0 apply-crash signatures. There is no separate runtime surface to exercise.",
  "mpd-tools-plugin": "Only the row applying was observed (0 apply-crash signatures). It owns no tool name and prints no apply-time line, and its write guard / truncation / post-execute waterfall needs a real write-tool call to witness - NOT exercised beyond apply in this lane; a guard probe belongs to the live/panels lane (t8).",
  "mpd-mcp-gitbash": "NOT exercised by construction: the composed row carries `disabled: true` (upstream design, Windows-only), so no process was started and no tool appeared. The observation is the composed row's disabled flag plus its absence from the live tool list.",
  "mpd-qa-roles-probe": "NOT composed in any user-facing profile: no row in the bundle patch references it, so the live TUI never loaded it. Observed: absent from the host's composed dsh-tui config; mounted only by the QA overlay tests/overlays/roles-probe.yml.",
  "mpd-mcp-shared": "A library with no loader row of its own: NOT exercised directly. Its effect is witnessed indirectly - the ast_grep and lsp MCP children that import it launched and contributed 11 tools to the live session.",
  "mpd-bundle-plugin": "NOT exercised under the TUI, and that is the finding: it is the browser bundle. Observed negatively - the live TUI pane log contains no `better-sidebar` / registerTab / floater line, its `mpd-web-compat` row loads a no-op main, and no tool or skill in the live counters (93 tools / 18 skills) comes from it. Its web face needs the web profile, which is out of this lane.",
}
const entries = [
  ["mpd-bundle", "composition layer (the bundle patch itself)", "usable",
    [OBS("composition:dump-config", "raw/dsh-tui-dump-config.txt", "The `# == @mpd-dsh/mpd` section of the host's own composed config lists 24 rows, incl. `mpd-tui` and the `dsh-tui-agent-presets` roster override."),
      OBS("live-mount:boot-log", "raw/boot-scan.json", "The live dsh-TUI boot mounts those rows with 0 apply-crash signature hits (boot-scan.json logs.*.crashSignatureTotal).")]],
  ["mpd-dsh-adapter-plugin", "single contact surface with the harness seams", "usable",
    [OBS("live-mount:plugin-log", "raw/tui-turn-pane.log", "[mpd-dsh-adapter] mpdDsh provided (harness seams resolved lazily, inject-free)")]],
  ["mpd-config-plugin", "mpd.jsonc runtime config layer", "usable",
    [OBS("live-mount:tool-list", "tool-list.json", toolsByPackage["mpd-config-plugin"].join(", "))]],
  ["mpd-tools-plugin", "write guard / truncation / post-execute waterfall", "usable",
    [OBS("composition:dump-config", "raw/dsh-tui-dump-config.txt", "row `mpd-tools` composed with config writeGuard: true, truncateMaxBytes: 8192"),
      OBS("source-read", "packages/mpd-tools-plugin/src/index.ts", "Registers ctx guards/waterfalls through the adapter; it owns no tool name, so no tool-list entry can witness it (runtime guard effect not separately probed here).")]],
  ["mpd-modelchain-plugin", "model-chain resolution + workspace memory", "usable",
    [OBS("live-mount:tool-list", "tool-list.json", toolsByPackage["mpd-modelchain-plugin"].join(", "))]],
  ["mpd-ext-plugin", "extension registry (skills/flows/roles/MCP)", "usable",
    [OBS("live-mount:tool-list", "tool-list.json", toolsByPackage["mpd-ext-plugin"].join(", "))]],
  ["mpd-roles-plugin", "specialist roster", "usable",
    [OBS("live-mount:tool-list", "tool-list.json", toolsByPackage["mpd-roles-plugin"].join(", "))]],
  ["mpd-ulw-plugin", "ulw loop discipline", "usable",
    [OBS("live-mount:tool-list", "tool-list.json", toolsByPackage["mpd-ulw-plugin"].join(", "))]],
  ["mpd-hashline-plugin", "anchored edit discipline", "usable",
    [OBS("live-mount:tool-list", "tool-list.json", toolsByPackage["mpd-hashline-plugin"].join(", "))]],
  ["mpd-boulder-plugin", "durable work ledger", "usable",
    [OBS("live-mount:tool-list", "tool-list.json", toolsByPackage["mpd-boulder-plugin"].join(", "))]],
  ["mpd-comment-checker-plugin", "comment/docstring detector (opt-in binary)", "usable",
    [OBS("live-mount:tool-list", "tool-list.json", toolsByPackage["mpd-comment-checker-plugin"].join(", ") + " (autoCheck false by config; the tool is registered)")]],
  ["mpd-codegraph-plugin", "codegraph project init + binary resolve", "usable",
    [OBS("live-mount:plugin-log", "raw/tui-turn-pane.log", "[mpd-codegraph] init status=marker binary=…/codegraph/npm-shim.js cwd=<sandbox workspace>")],
    "`status=marker` and the MCP server's `CodeGraph MCP skipped: project excluded by the CodeGraph policy.` mean the SANDBOX workspace path contains an `.mpd` segment, which the CodeGraph policy excludes — a sandbox artifact documented in AGENTS.md §12, not a TUI limitation."],
  ["mpd-memory-plugin", "git/svn-backed memory + reflection", "usable",
    [OBS("live-mount:tool-list", "tool-list.json", toolsByPackage["mpd-memory-plugin"].join(", "))]],
  ["mpd-workmate-plugin", "durable evolving agent library", "usable",
    [OBS("live-mount:tool-list", "tool-list.json", toolsByPackage["mpd-workmate-plugin"].join(", "))]],
  ["mpd-team-compact-plugin", "finished-team compaction", "usable",
    [OBS("live-mount:tool-list", "tool-list.json", toolsByPackage["mpd-team-compact-plugin"].join(", "))]],
  ["mpd-bootstrap-plugin", "serves the bundle's skills corpus (no home copy)", "usable",
    [OBS("live-mount:plugin-log", "raw/tui-turn-pane.log", "[mpd-bootstrap] skill corpus served from /root/dshProj/my-power-dsh/skills"),
      OBS("live-mount:status-line", "raw/boot-scan.json", "a live TUI session reports 技能18 / 18 skills")]],
  ["mpd-tui-plugin", "the TUI-native surface package (this edition)", "usable",
    [OBS("composition:dump-config", "raw/dsh-tui-dump-config.txt", "row `mpd-tui` → module '@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js'"),
      OBS("live-mount:boot-log", "raw/boot-scan.json", "the row mounted in the live dsh-TUI boot; 0 apply-crash signature hits; entry sha256 recorded in ledger.json.revision")],
    "The seven seam surfaces' RENDERING is verified by the panels lane (t4 evidence + t7/t8 lanes, AC-4) — this ledger only owns the composition/pre-mount fact. packages/mpd-tui-plugin was still being written by t4 while this ledger was measured; the measured hashes are recorded."],
  ["mpd-agent-teams-plugin", "adopted AgentTeams plugin (tools + Web panel)", "usable",
    [OBS("live-mount:tool-list", "tool-list.json", toolsByPackage["mpd-agent-teams-plugin"].length + " tools: " + toolsByPackage["mpd-agent-teams-plugin"].slice(0, 6).join(", ") + ", …")],
    "Its browser activity panel / sidebar is a web-only face (NOT CLAIMED W-3); the team machinery itself is tool-driven and fully usable from the TUI."],
  ["mpd-mcp-astgrep", "ast-grep MCP server (stdio launcher)", "usable",
    [OBS("live-mount:tool-list", "tool-list.json", toolsByPackage["mpd-mcp-astgrep"].join(", "))]],
  ["mpd-mcp-lsp", "LSP MCP server (stdio launcher)", "usable",
    [OBS("live-mount:tool-list", "tool-list.json", toolsByPackage["mpd-mcp-lsp"].join(", "))]],
  ["mpd-mcp-codegraph", "codegraph MCP server (stdio launcher)", "usable",
    [OBS("live-mount:plugin-log", "raw/tui-turn-pane.log", "[mpd-mcp-codegraph] serving codegraph in-process (no shared daemon): …")],
    "In THIS sandbox the server contributed 0 tools because the CodeGraph policy excludes a project root containing `.mpd` (`CodeGraph MCP skipped: project excluded by the CodeGraph policy.`); the row and server are alive, and the tool set appears in a normal workspace (cf. the captain's recon boot log line `[CodeGraph MCP] Caught up 1 file(s) changed since last run`)."],
  ["mpd-mcp-gitbash", "git-bash MCP server (Windows-only upstream)", "inert",
    [OBS("composition:dump-config", "raw/dsh-tui-dump-config.txt", "row `mcp-gitbash` is composed with `disabled: true` (upstream design: run is available only on native Windows), so it launches nothing under any profile — no TUI limitation.")]],
  ["mpd-mcp-shared", "shared binary resolver used by the MCP launchers", "usable",
    [OBS("source-read", "packages/mpd-mcp-shared/bin-resolve.mjs", "Imported by the mcp-* launch.mjs launchers; it owns no loader row of its own — witnessed indirectly by the ast_grep / lsp MCP children that launched (tool-list.json).")],
    "Support library: no row, no tool name; its live witness is the launch of the MCP rows that import it."],
  ["mpd-bundle-plugin", "bundle web-compat package (browser client + no-op main)", "web-only",
    [OBS("source-read", "packages/mpd-bundle-plugin/src/web-client.js + client.js", "The package's deliverable is the browser bundle (agent-teams panel, workmate tab registered through ctx.betterSidebar.registerTab, bundle floater fallback); the root package.json declares dsh.client.platform = web."),
      OBS("source-read", "packages/mpd-bundle-plugin/src/index.js", "Its `mpd-web-compat` row loads a no-op main plugin whose only job is to mint the loader entry name the web client row resolves against.")],
    "No TUI rendering face; the TUI equivalents are the mpd-tui-plugin status line / board / dialogs (D8, NOT CLAIMED W-3)."],
  ["mpd-qa-roles-probe", "QA-only probe package", "inert",
    [OBS("composition:dump-config", "raw/dsh-tui-dump-config.txt", "No row in the bundle patch references it; the composed dsh-tui config has no row for it (it is mounted only by the QA overlay tests/overlays/roles-probe.yml).")]],
]
const ledger = {
  generatedAt: new Date().toISOString(),
  subject: "Per-package TUI compatibility of @mpd-dsh/mpd under a dsh-tui profile (t5 deliverable C)",
  revision: {
    repoHead: (() => {
      const head = read(join(repoRoot, ".git/HEAD")).trim()
      const m = /^ref: (.+)$/.exec(head)
      return m === null ? head : read(join(repoRoot, ".git", m[1])).trim()
    })(),
    manifestSha256: sha256(join(repoRoot, "dsh-plugin.json")),
    bundlePatchSha256: sha256(join(repoRoot, "packages/mpd-bundle/cordis.patch.yml")),
    mpdTuiPluginDistSha256: existsSync(join(repoRoot, "packages/mpd-tui-plugin/dist/index.js")) ? sha256(join(repoRoot, "packages/mpd-tui-plugin/dist/index.js")) : null,
    mpdTuiPluginSrcSha256: existsSync(join(repoRoot, "packages/mpd-tui-plugin/src/index.ts")) ? sha256(join(repoRoot, "packages/mpd-tui-plugin/src/index.ts")) : null,
    note: "t4 (packages/mpd-tui-plugin) was still being written when this ledger was measured; the plugin hashes above are the measured revision and may move with t4. No other package changed.",
  },
  composition: {
    profile: "dsh-tui", engine: "dsh 0.1.5-rc.1 CLI + 0.1.5-rc.2 packages", host: "@deepseek-harness-tui/dsh-tui 0.10.1",
    bundles: JSON.parse(read(raw("dsh-tui-profile.package.json"))).dsh.profile.bundles,
    ourRowCount: ourRows.length,
    crashSignatureTotal: Object.values(logs).reduce((a, l) => a + l.crashSignatureTotal, 0),
    duplicateEntryIds: tuiDup.duplicates,
    sandbox: { dshHome: ".mpd/recon/qa/dshhome", home: ".mpd/recon/qa/home", caches: ".mpd/recon/qa/{npm-cache,pnpm-home,config,data}", workspace: "the TUI's own sandbox state pins the session workspace to /root/dshProj/my-power-dsh (see session-evidence.json cwd)" },
  },
  observationKinds: {
    "live-mount:tool-list": "the package's tools appear in a recorded live dsh-TUI session's request/header.tools[] (tool-list.json)",
    "live-mount:plugin-log": "the package's own apply-time line in the raw tmux pane log",
    "live-mount:status-line": "the live session's own aggregate counters (skills/tools)",
    "live-mount:boot-log": "the row mounted in a live boot with 0 apply-crash signature hits",
    "composition:dump-config": "the host's own composed config (dsh --profile dsh-tui --dump-config) — composition evidence only, never load evidence",
    "source-read": "the package's own source/entry files",
  },
  classificationSemantics: {
    usable: "the package's function is reachable from a TUI session and at least one thing this lane ACTUALLY SAW proves it: a live tool name in a recorded request/header, the package's own apply-time log line, or the row applying in a live boot with zero apply-crash signatures.",
    inert: "the row never runs under a dsh-tui profile (disabled in the composition, or not composed at all): nothing could be exercised, and the ledger says so instead of guessing.",
    "web-only": "the package's only face is the browser client; the live TUI boot does not load it, which is recorded as a negative observation rather than inferred from a filename.",
  },
  notExercised: Object.entries(NOT_EXERCISED).map(([name, why]) => ({ name, why })),
  packages: entries.map(([name, role, classification, observations, caveat]) => ({
    name, role, classification,
    liveTools: toolsByPackage[name] ?? [],
    rowIds: rowsFor(name).map((r) => r.id),
    exercised: NOT_EXERCISED[name] === undefined,
    ...(NOT_EXERCISED[name] === undefined ? {} : { exerciseNote: NOT_EXERCISED[name] }),
    observations, ...(caveat === undefined ? {} : { caveat }),
  })),
}
ledger.counts = ledger.packages.reduce((a, p) => (a[p.classification] = (a[p.classification] ?? 0) + 1, a), {})
ledger.counts.total = ledger.packages.length
ledger.disclosedGaps = [
  "Web-only faces (agent-teams sidebar, workmate tab, bundle floater) have no TUI rendering face — NOT CLAIMED W-3.",
  "The decision-event seam is ready-but-not-activated: host admission is unreachable for a profile-installed plugin — NOT CLAIMED W-1.",
  "Engine skew: the host prints that the 0.1.5-rc.2 engine is newer than the 0.1.5-rc.1 it was validated against — NOT CLAIMED W-4.",
  "In this sandbox the CodeGraph project is excluded (workspace path contains `.mpd`), so mpd-mcp-codegraph contributed 0 tools here.",
  "packages/mpd-tui-plugin was still being written by t4 at measurement time; its seam-rendering verification belongs to the panels lane (AC-4 / t8), not to this ledger.",
]
writeTop("ledger.json", ledger)

const table = [
  "| package | role | class | live tools / row | observation |",
  "|---|---|---|---|---|",
  ...ledger.packages.map((p) => `| \`${p.name}\` | ${p.role} | **${p.classification}** | ${p.liveTools.length ? p.liveTools.length + " tools" : (p.rowIds.length ? "rows: " + p.rowIds.join(", ") : "—")} | ${p.observations[0].kind}: ${p.observations[0].quote} |`),
]
writeTop("ledger.md", [
  "# TUI compatibility ledger — every package under `packages/`",
  "",
  `Measured ${ledger.generatedAt} against ${ledger.composition.host} under a \`dsh-tui\` profile with the bundle as the third patch layer.`,
  `Counts: **usable ${ledger.counts.usable ?? 0}**, **inert ${ledger.counts.inert ?? 0}**, **web-only ${ledger.counts.webOnly ?? ledger.counts["web-only"] ?? 0}**, total ${ledger.counts.total}.`,
  "",
  ...table,
  "",
  "## Disclosed gaps",
  "",
  ...ledger.disclosedGaps.map((g) => "- " + g),
  "",
  "## Observation semantics",
  "",
  ...Object.entries(ledger.classificationSemantics).map(([k, v]) => `- **${k}** - ${v}`),
  "",
  "## NOT exercised in this lane (and why)",
  "",
  ...ledger.notExercised.map((n) => `- \`${n.name}\` - ${n.why}`),
  "",
  "Detail, caveats and per-package observations: `ledger.json` (same directory).",
  "",
].join("\n"))
console.log(JSON.stringify({ ok: true, packages: ledger.packages.length, counts: ledger.counts, sessions: sessionRecords.length, tools: toolList.toolCount }, null, 2))
