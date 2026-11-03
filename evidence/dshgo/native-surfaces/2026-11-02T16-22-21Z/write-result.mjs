// WRITE THE LANE'S result.json FROM THE MEASUREMENTS THIS DIRECTORY ALREADY HOLDS.
//
// The numbers come from `measure.json` (produced by `build-trees.ts`); the gate rows record what was
// OBSERVED, not what was hoped for. Anything red stays red in this file.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** This evidence directory. */
const E = import.meta.dirname

/** The per-tree measurements `build-trees.ts` wrote. */
const measured = JSON.parse(readFileSync(join(E, "measure.json"), "utf8"))

/** The lane result this directory certifies. */
const result = {
  lane: "T2 — D2–D5: two live native panels, strip, capsules, menu, manifest and static views",
  contract: ".mpd/plans/dshgo-native-parity.md §4 D2/D3/D4/D5 and §7; visual spec .mpd/plans/dshgo-visual-spec.md",
  at: new Date().toISOString(),
  changed: [
    "package.json — dshGo: 2 panels (mpd, mpd-team), composer.strip mpd-status, composer.actions mpd-dispatch/mpd-board, message.actions mpd-save-memory/mpd-copy-reply, wants:[message]; the dshGo block is 928 B (limit 16384)",
    "dsh-go/views/mpd.json — declared static v1 fallback, four-tab list, 790 B",
    "dsh-go/views/mpd-team.json — NEW declared static v1 fallback, 781 B",
    "packages/mpd-bundle-plugin/src/dshgo-views.ts — NEW pure v2 view builders for both panels plus the adaptView fallback",
    "packages/mpd-bundle-plugin/src/dshgo-copy.ts — NEW bilingual panel copy selected from caps.locale",
    "packages/mpd-bundle-plugin/src/dshgo-panel.ts — v2 view delegation, snapshot extended (counts/alert/workmates/memory), memory-store reader, deferred 3 s shape replacing the 4 s timeout, refresh + answer-custom handlers, structural refresh signature",
    "packages/mpd-bundle-plugin/src/dshgo-team-panel.ts — NEW mpd-team live half: board/members/detail/watchdog, per-scope selection, complete/fail/hold/resume through the tool runtime",
    "packages/mpd-bundle-plugin/src/dshgo-surfaces.ts — NEW composer strip plus the three menu handlers",
    "packages/mpd-bundle-plugin/src/index.ts — registers the team panel and the surfaces, and releases all three",
    "packages/mpd-bundle-plugin/README.md + README.zh-CN.md — bilingual section rewrite (same heading tree)",
    "packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts — T1 kit AMENDMENT (additive only): DshGoListItem.action?: DshGoActionRef and progress(value: number | DshGoBinding, ...)",
    "packages/mpd-bundle-plugin/test/dshgo-panels-v2.test.ts — NEW (18 arms: both-version lintDesign, budget, hero count per tab, metric-inside-grid, one-primary, metric label+value survival, strip, menu handlers)",
    "packages/mpd-bundle-plugin/test/dshgo-panel.test.ts — updated for the v2 view, the extended snapshot, both panels and the question-identity refresh rule"
  ],
  measured,
  checker: {
    declaredStaticViews: "node check.mjs dsh-go/views/mpd.json and mpd-team.json --budget panel — exit 0 each (能显示)",
    liveTreesPiped: "check.mjs - --budget panel for mpd-v2 / mpd-v1-fallback / mpd-team-v2 / mpd-team-v1-fallback — exit 0 each; full log in checker.log",
    manifestFixture: "fixture shell (real dshGo block + copies of the real views, dsh.bundle.patch as a STRING, engines.dsh, a minimal cordis.patch.yml) — exit 0, manifest.state=ok, issues=[]",
    acceptedDiagnostics: [
      'view.accent dark contrast corrections (#4B67B4 -> #7B8FC8/#899BCE/#889BCD) — expected for accent:"app", never silenced with a hex',
      "tone-derived style.color corrections in light and dark — the App's own contrast guarantee doing its job",
      "ONE actions.items[0].style note per panel — the single primary button downgrade (§7.2 rule 8)",
      "the /engines/dsh hint is NOT added in this wave (accepted, out of scope)"
    ],
    designChangesDrivenByTheChecker: [
      'textField bind "customAnswer" -> "data.customAnswer": the checker ERRORED with 输入绑定必须是 data 下的字段路径 (mpd-v2 exited 1 before the fix)',
      'message.actions[0].label en "Save to memory" (14 chars) -> "Save memory" (11): the checker warned too-long (>12) and would truncate. DEVIATION from D2\'s literal text, reported to the captain.'
    ]
  },
  gates: [
    { id: "bun test packages/mpd-dsh-adapter-plugin packages/mpd-bundle-plugin", exit: 0, observed: "662 pass, 0 fail (37 files)" },
    { id: "bun run typecheck", exit: 0, observed: "tsgo --noEmit, no diagnostics in the touched graph" },
    { id: "bun run verify:comments", exit: 0, observed: "VERDICT: PASS — every declaration carries a precise comment and a full signature" },
    { id: "bun run verify:docs", exit: 0, observed: "pairs=54 failed=0 violations=0 dead=0 — PASS" },
    { id: "bun run verify:rows", exit: 0, observed: "36 row ids match the 2-file bundle patch layer" },
    { id: "bun run verify:manifest", exit: 0, observed: "VERDICT: PASS — the install-time rules and the packaging contract hold" },
    { id: "node scripts/verify-dshgo-views.ts", exit: 0, observed: "PASS — manifest + static views are legal" },
    { id: "bun run verify:gates", exit: 1, observed: "8/9 members PASS; ONLY dist-fresh failed (24 of 34 targets stale, repo-wide and including other lanes' packages) — D7/T5 owns the rebuild" }
  ],
  bounds: [
    "The RENDERED look is UNPROVEN: no Flutter app in this workspace and preview.mjs needs Flutter, so no PNG preview exists.",
    "verify-dshgo-views.ts lints the DECLARED static views only; the v2 LIVE trees are covered by this lane's unit tests (dshgo-panels-v2.test.ts), never by the repo gate.",
    "dist/ was NOT rebuilt (D7 owns it), so verify:dist-fresh is red for 24 targets.",
    "The memory tab reads the store's documented on-disk layout because the memory row publishes tools, not a service; editing that package belongs to D6.",
    "complete/fail and the watchdog hold/resume drive the SAME tools a person calls, so an owner-only refusal reaches the toast verbatim; that they SUCCEED from an agentless panel tap is unproven here.",
    "Team-panel selection uses the protocol's args-carrying row action ({id:select, args:{task}}) rather than the contract's select:<id> spelling: a fixed handler table cannot route a dynamic id (docs/plugins/actions.md). Same for complete/fail/back."
  ]
}

writeFileSync(join(E, "result.json"), JSON.stringify(result, null, 2) + "\n")
console.log("result.json written:", JSON.stringify(result).length, "bytes")
