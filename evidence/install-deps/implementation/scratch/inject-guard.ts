// One-shot injector: writes the canonical SIDEBAR_GUARD text into the two
// declaration surfaces so they cannot drift. Every anchor must occur EXACTLY
// once, and the run prints what it changed; `git diff` is the review surface.
import { readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { SIDEBAR_GUARD } from "./sidebar-guard.ts"

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, "..", "..", "..", "..")
const PATCH = join(repo, "packages", "mpd-bundle", "cordis.patch.yml")
const INSTALLER = join(repo, "scripts", "install-profile.mjs")
const QUOTED = JSON.stringify(SIDEBAR_GUARD)

function replaceOnce(text, anchor, replacement, label) {
  const first = text.indexOf(anchor)
  if (first < 0) throw new Error("anchor not found: " + label)
  if (text.indexOf(anchor, first + 1) >= 0) throw new Error("anchor not unique: " + label)
  return text.slice(0, first) + replacement + text.slice(first + anchor.length)
}

const patchBlock = [
  "# ── runtime plugin dependency: the sidebar HOST the bundle's GUI needs ──────",
  "# MEASURED DEFECT (evidence/install-deps/red-baseline/20260920T030832Z/result.json):",
  "# a clean install of this bundle alone composed ZERO `dsh-better-sidebar` rows, so",
  "# the `betterSidebar` service never existed and the bundle's two sidebar pages",
  "# (mpd-agent-teams, mpd-workmate) registered nothing — the reported \"the sidebar",
  "# cannot display\". The package is declared in the bundle manifest's `dependencies`",
  "# (dsh-better-sidebar 0.19.0-alpha.1) and MOUNTED here.",
  "#",
  "# BOTH halves are required. The declaration alone never mounts anything: `dsh plugin",
  "# add` reconciles only PROFILE-level dependencies into `dsh.profile.bundles`, so a",
  "# bundle's dependency never becomes a layer and the package's own guarded patch never",
  "# applies. The row alone would be boot-fatal when the module is unresolvable",
  "# (`assertEntriesLoaded`). What makes the row resolvable is",
  "# `@deepseek-ai/dsh-app-boot#healProfileModuleFallback`, which materializes the",
  "# dependency closure of every non-installation bundle layer into",
  "# `<profile>/node_modules` before the loader runs (measured; see the ledger under",
  "# evidence/install-deps/implementation/**).",
  "#",
  "# THE ENTRY ID IS DELIBERATELY `mpd-better-sidebar`, byte-different from the",
  "# package's own patch id (`better-sidebar`) and from the aggregate's id",
  "# (`web-ui-better-sidebar`, @linxin666/dsh-web-all): a duplicate loader ENTRY ID is",
  "# fatal even when the guard would have disabled one of the two, so we never reuse an",
  "# id another layer may mint.",
  "#",
  "# THE GUARD IS ORDER-INDEPENDENT — the property that makes BOTH install orders safe.",
  "# `[...ctx.loader.entries()]` is FORWARD-BLIND at first evaluation (measured: the",
  "# same expression re-evaluates later with every entry visible, but `Entry.refresh()`",
  "# returns early once `this.fiber` exists, so the FIRST evaluation decides), and",
  "# @linxin666/dsh-web-all mounts the sidebar with an UNGUARDED row. A guard that read",
  "# only the entry list would kill a boot that works today whenever the aggregate is",
  "# installed AFTER this bundle. So the guard reads DECLARATIONS instead:",
  "#   1. no `dsh-better-sidebar` resolvable from `<profile>/node_modules` -> disable",
  "#      (degrade to \"no sidebar\" with one warning, never fail the boot);",
  "#   2. `dsh-better-sidebar` is itself a declared `dsh.profile.bundles` layer -> its",
  "#      own patch mounts it -> disable;",
  "#   3. any OTHER layer's `dsh.bundle.patch` text names the package -> that layer",
  "#      mounts it (this is exactly the information the loader will act on, and it does",
  "#      not depend on layer order) -> disable; this bundle excludes itself by its own",
  "#      row id, never by a hard-coded package name;",
  "#   4. no web plane — no enabled `@deepseek-ai/dsh-host-webserver` entry AND no",
  "#      `@deepseek-ai/dsh-web-app` bundle layer -> the sidebar's declared inject",
  "#      (`webServer`, `sessions`, `webRuntime`, `tools`) cannot be satisfied and a",
  "#      pending entry is fatal (`assertEntriesActivated`) -> disable (this is the",
  "#      dsh-tui / headless plane).",
  "# The whole guard is one try/catch that returns TRUE (disabled) on ANY throw, so the",
  "# worst case is a missing sidebar, never a dead boot. It logs ONE line per distinct",
  "# decision with the stable prefix `[mpd-better-sidebar] mount guard: ` — that line is",
  "# how a verifier sees the decision in the boot log. Raw `e.options.disabled` is read",
  "# on purpose: reading another entry's EVALUATED `disabled` getter re-enters its own",
  "# `!!js` expression (measured: mutual recursion, stack overflow).",
  "- insert:",
  "    - id: mpd-better-sidebar",
  "      name: dsh-better-sidebar",
  "      disabled: !!js " + QUOTED,
  "",
  "",
].join("\n")

let patchText = readFileSync(PATCH, "utf8")
const PATCH_ANCHOR = "- insert:\n    # B8 (wave 2): this row names NO binary path any more."
patchText = replaceOnce(patchText, PATCH_ANCHOR, patchBlock + PATCH_ANCHOR, "patch mcp insert start")
writeFileSync(PATCH, patchText)

let installer = readFileSync(INSTALLER, "utf8")

installer = replaceOnce(
  installer,
  "function buildPlan(o) {",
  "// The sidebar mount guard, byte-identical to the `disabled: !!js` scalar of the\n"
  + "// bundle patch's `mpd-better-sidebar` row (asserted by selfTest below). It is\n"
  + "// duplicated here because the legacy installer renders its OWN patch instead of\n"
  + "// reading the bundle's, and the two writers must not drift: a drifted guard\n"
  + "// double-mounts (or disables the only mount) on a legacy install.\n"
  + "const SIDEBAR_GUARD = " + QUOTED + "\n\n"
  + "function buildPlan(o) {",
  "installer buildPlan anchor",
)

installer = replaceOnce(
  installer,
  "    // NOTE: no root skill-filesystem row",
  "    // The sidebar HOST the bundle's shipped GUI registers into (the runtime\n"
  + "    // dependency declared in the manifest's `dependencies`). Guarded exactly like\n"
  + "    // the bundle patch row: disabled when another layer already mounts the package,\n"
  + "    // when no web plane is present, or when the package is not resolvable — never a\n"
  + "    // second mount, never a pending entry, never a dead boot. Id parity with the\n"
  + "    // patch's insert set is enforced by scripts/verify-rows-parity.mjs.\n"
  + "    {\n"
  + "      id: \"mpd-better-sidebar\", name: \"dsh-better-sidebar\",\n"
  + "      disabledYaml: \"!!js \" + JSON.stringify(SIDEBAR_GUARD)\n"
  + "    },\n"
  + "    // NOTE: no root skill-filesystem row",
  "installer rows anchor",
)

installer = replaceOnce(
  installer,
  '  if (r.disabled !== undefined) body.push(indent + "  disabled: " + JSON.stringify(r.disabled))',
  '  // `disabledYaml` carries a raw YAML form (`!!js "..."`); `disabled` a literal.\n'
  + '  if (r.disabledYaml !== undefined) body.push(indent + "  disabled: " + r.disabledYaml)\n'
  + '  else if (r.disabled !== undefined) body.push(indent + "  disabled: " + JSON.stringify(r.disabled))',
  "installer renderRow anchor",
)

installer = replaceOnce(
  installer,
  '  if (!rows.includes("mcp-context7") || !rows.includes("mcp-grepapp"))',
  "  // The sidebar row + its guard: the same row the bundle patch inserts, with the\n"
  + "  // SAME expression (a drifted guard is the duplicate-mount / missing-sidebar class\n"
  + "  // this wave exists to close).\n"
  + "  const sidebarRow = plan.rows.find((r) => r.id === \"mpd-better-sidebar\")\n"
  + "  const bundlePatchText = readFileSync(join(repoRoot, \"packages\", \"mpd-bundle\", \"cordis.patch.yml\"), \"utf8\")\n"
  + "  if (!sidebarRow || sidebarRow.name !== \"dsh-better-sidebar\" || sidebarRow.disabledYaml !== \"!!js \" + JSON.stringify(SIDEBAR_GUARD)) { console.error(\"[install-profile self-test] FAIL: sidebar row + guard\"); process.exit(1) }\n"
  + "  if (!bundlePatchText.includes(\"disabled: !!js \" + JSON.stringify(SIDEBAR_GUARD))) { console.error(\"[install-profile self-test] FAIL: sidebar guard drifted from the bundle patch\"); process.exit(1) }\n"
  + '  if (!rows.includes("mcp-context7") || !rows.includes("mcp-grepapp"))',
  "installer self-test anchor",
)

writeFileSync(INSTALLER, installer)
console.log("injected: patch + installer (guard bytes " + Buffer.byteLength(SIDEBAR_GUARD, "utf8") + ")")
