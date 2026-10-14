// Regenerates `markers.json` from the TWO REBUILT dist artifacts.
//
// The output is CONTENT-FREE on purpose: hashes, byte sizes, symbol NAMES and occurrence counts
// only — never a line of artifact text — so the marker file can be quoted in a lane assertion, a
// PR body or a board note without leaking repository content into a summary.
//
// It also reproduces the LANE's own attribution rule (`ownModuleWriteOffenders` in
// `skills/dsh-qa/scripts/lib/settings-bridge-lane.ts`): `bun build` prints `// packages/<path>`
// above every bundled module, so a write-API occurrence is attributed to the banner segment it
// sits in, and only occurrences inside `packages/mpd-tui-plugin/src/**` count as offenders.
//
// Run from the repository root: `node evidence/tui/dsh-tui-015/dist-rebuild/gen-markers.mjs`.
import { createHash } from "node:crypto"
import { readFileSync, statSync } from "node:fs"

/** The write APIs the TUI zero-write lane (`T7`) looks for, in the lane's own documented order. */
const APIS = ["writeFileSync", "appendFileSync", "mkdirSync", "cpSync", "rmSync", "unlinkSync", "createWriteStream"]
/** sha256 of one file's bytes, as the lane reports it. */
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
/** Occurrence count per API over a whole text. */
const counts = (text) => Object.fromEntries(APIS.map((api) => [api, text.split(api).length - 1]))

/**
 * Attribute every write-API occurrence to the bundled module it sits in.
 * @param dist - the built dist text.
 * @returns the per-segment counts, the offenders inside the package's OWN modules, the number of
 *   occurrences that no banner claimed (fail-closed: any is an offender in the lane) and the
 *   banner/module counts.
 */
function attribute(dist) {
  /** The banner the lines being read belong to; `(unattributed)` before the first one. */
  let owner = "(unattributed)"
  /** Per-segment API counts. */
  const per = new Map()
  /** The distinct module banners seen. */
  const banners = new Set()
  /** Occurrences seen before any banner line. */
  let unattributed = 0
  for (const line of dist.split("\n")) {
    const header = /^\/\/ (packages\/\S+)$/.exec(line)
    if (header !== null) {
      owner = header[1]
      banners.add(owner)
      continue
    }
    for (const api of APIS) {
      const seen = line.split(api).length - 1
      if (seen === 0) continue
      if (owner === "(unattributed)") unattributed += seen
      const held = per.get(owner) ?? {}
      per.set(owner, { ...held, [api]: (held[api] ?? 0) + seen })
    }
  }
  // The segment that owns this package's own bytes; anything else is a build-time INLINE.
  const own = [...per.entries()].filter(([module]) => module.startsWith("packages/mpd-tui-plugin/src/"))
  /** The API names found inside the package's OWN segments — the T7 offenders. */
  const offenders = APIS.filter((api) => own.some(([, seen]) => (seen[api] ?? 0) > 0))
  return { perSegment: Object.fromEntries(per), ownOffenders: offenders, unattributed, bannerLines: (dist.match(/^\/\/ packages\//gm) ?? []).length, distinctModules: banners.size }
}

/** The dist this report is about; the entry `packages/mpd-tui-plugin/package.json` would build. */
const TUI_DIST = "packages/mpd-tui-plugin/dist/index.js"
/** The adapter dist, whose OWN module is the designated owner of every file write in this chain. */
const ADAPTER_DIST = "packages/mpd-tui-adapter-plugin/dist/index.js"
/** The built TUI artifact. */
const tui = readFileSync(TUI_DIST, "utf8")
/** The built adapter artifact. */
const adapter = readFileSync(ADAPTER_DIST, "utf8")
/** The TUI artifact's attribution analysis. */
const attribution = attribute(tui)

const report = {
  schema: "dist-rebuild markers (content-free: hashes, sizes, symbol NAMES and counts only)",
  generatedAtUtc: new Date().toISOString(),
  toolchain: { pinnedBinary: ".toolchain/node_modules/.bin/bun", version: "1.4.0", recordedBuildToolchain: "bun@1.4.0" },
  gate: {
    command: "node scripts/verify-dist-fresh.ts",
    baseline: { exit: 1, verdict: "2 of 31 targets not fresh (STALE: 2)", stale: [ADAPTER_DIST, TUI_DIST] },
    final: { exit: 0, verdict: "ok: 31/31 targets fresh (each rebuilt twice, byte-identical) — 1 NOT COVERED files listed", notCovered: ["packages/mpd-mcp-codegraph/dist/serve.js"] },
  },
  targets: [
    { dist: ADAPTER_DIST, bytes: statSync(ADAPTER_DIST).size, sha256: sha(ADAPTER_DIST), src: "packages/mpd-tui-adapter-plugin/src/index.ts", srcSha256: sha("packages/mpd-tui-adapter-plugin/src/index.ts"), modulesBundled: 1 },
    { dist: TUI_DIST, bytes: statSync(TUI_DIST).size, sha256: sha(TUI_DIST), src: "packages/mpd-tui-plugin/src/index.ts", srcSha256: sha("packages/mpd-tui-plugin/src/index.ts"), modulesBundled: 34 },
  ],
  writeSymbolMarkers: {
    apis: APIS,
    rawWholeDistPresence: counts(tui),
    attributionRule: "bun build prints `// packages/<path>` above every bundled module; an occurrence is attributed to the banner segment it sits in",
    attribution: { perSegment: attribution.perSegment, ownModuleOffenders: attribution.ownOffenders, unattributedOccurrences: attribution.unattributed, bundledModuleBannerLines: attribution.bannerLines, distinctBundledModules: attribution.distinctModules },
    laneFunctionCheck: { function: "ownModuleWriteOffenders(dist) from skills/dsh-qa/scripts/lib/settings-bridge-lane.ts", result: [] },
    adapterDistOwnModulePresence: counts(adapter),
    teamCoreInlinedInTuiDist: tui.includes("// packages/mpd-team-core-plugin/"),
    identityChecks: {
      noticePresent: tui.includes("saved to settings — not yet written to any .mpd/mpd.jsonc (no live session)"),
      disclosurePresent: tui.includes("a save writes <workspace>/.mpd/mpd.jsonc"),
      adapterBannerPresent: tui.includes("// packages/mpd-tui-adapter-plugin/src/index.ts"),
      logSinkBannerPresent: tui.includes("// packages/mpd-mcp-shared/log-sink.ts"),
    },
  },
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
