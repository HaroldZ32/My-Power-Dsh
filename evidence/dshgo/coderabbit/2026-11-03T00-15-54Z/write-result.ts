// THE CODERABBIT ROUND-1 RECONCILIATION: one row per finding, the fix, and the gate that observed it.
//
// The PR rule is that EVERY inline finding is reconciled as FIXED / STALE / STILL-VALID with evidence.
// All twenty were still valid against the tree and are FIXED; two of them (the stale docs) were the
// residue of repair T8, which had already removed the controls they still described.
import { writeFileSync } from "node:fs"
import { join } from "node:path"

/** This evidence directory. */
const E = import.meta.dirname

/** One reconciled finding. */
interface Row {
  /** The CodeRabbit comment number in this directory's findings.txt. */
  n: number
  /** The location the comment names. */
  where: string
  /** The verdict. */
  verdict: "FIXED"
  /** What was done. */
  fix: string
}

/** Every finding of round 1. */
const rows: Row[] = [
  { n: 1, where: "dsh-go/views/mpd-team.json:24", verdict: "FIXED", fix: "the Detail subtitle no longer promises settle buttons — it lists owner, dependencies and verdict" },
  { n: 2, where: "packages/mpd-bundle-plugin/README.md:258", verdict: "FIXED", fix: "the dshgo-team-panel.ts entry names `select` / `back` / `refresh` and states why nothing mutates" },
  { n: 3, where: "packages/mpd-bundle-plugin/README.zh-CN.md:95 + 132-133", verdict: "FIXED", fix: "the zh twin changed in the same edit (team-panel description and the file entry)" },
  { n: 4, where: "packages/mpd-bundle-plugin/src/dshgo-panel.ts:823", verdict: "FIXED", fix: "readMemoryStore stats every entry, sorts, slices ten, and only then reads the winners — the unbounded directory is no longer fully read at 0.5 Hz" },
  { n: 5, where: "packages/mpd-bundle-plugin/src/dshgo-panel.ts:1131", verdict: "FIXED", fix: "typed text travels in `custom` with an empty `selected`; `PanelQuestionsFace.answer` widened; a regression arm asserts the exact relay payload" },
  { n: 6, where: "packages/mpd-bundle-plugin/src/dshgo-panel.ts:1221", verdict: "FIXED", fix: "`refreshKeyOf` covers every literal the view writes (question id+labels, ready ids, plan/ready button state, alert, workmate names, memory rows+counters); the tracker is renamed `refreshKeys` / `announceRefreshState`; a regression arm asserts a newly ready task refreshes exactly once" },
  { n: 7, where: "packages/mpd-bundle-plugin/src/dshgo-surfaces.ts:240", verdict: "FIXED", fix: "the duplicated deferral helper is gone: `orDeferred` is exported from dshgo-panel and the surfaces import it, so the timing contract has ONE owner" },
  { n: 8, where: "packages/mpd-bundle-plugin/src/dshgo-team-panel.ts:227", verdict: "FIXED", fix: "the tool result is read as an ENVELOPE (`ok`/`value`), a refusal leaves the fallbacks in place, and a rejected call is swallowed; a regression arm drives a real registration and asserts the predicate/incidents appear only from `value`" },
  { n: 9, where: "packages/mpd-bundle-plugin/src/dshgo-team-panel.ts:357", verdict: "FIXED", fix: "the board signature now carries team id/status/phase, every task `id:status` and every member `name/mode`; a regression arm moves a row pending → in_progress and asserts exactly one refresh" },
  { n: 10, where: "packages/mpd-bundle-plugin/src/dshgo-views.ts:418", verdict: "FIXED", fix: "the members tile renders a LITERAL count like the workmates and memory tiles" },
  { n: 11, where: "packages/mpd-dsh-adapter-plugin/src/index.ts:4322", verdict: "FIXED", fix: "`callableMember` binds the member to its service; a class-based bridge arm proves `dshGoOn`/`dshGoStrip`/`dshGoCaps` keep their receiver (verified by a negative control: without the bind the arm FAILS)" },
  { n: 12, where: "packages/mpd-memory-plugin/src/dshgo-cards.ts:12", verdict: "FIXED", fix: "`.ts` extension added" },
  { n: 13, where: "packages/mpd-memory-plugin/src/index.ts:23", verdict: "FIXED", fix: "`.ts` extension added" },
  { n: 14, where: "packages/mpd-team-core-plugin/src/index.ts:30-31", verdict: "FIXED", fix: "`.ts` extensions added to BOTH imports" },
  { n: 15, where: "packages/mpd-team-core-plugin/src/tool-cards.ts:85", verdict: "FIXED", fix: "a bare string in `added` renders as the blocker id instead of an empty object" },
  { n: 16, where: "packages/mpd-team-watchdog-plugin/src/actions.ts:17", verdict: "FIXED", fix: "`./dshgo-cards.js` → `./dshgo-cards.ts` (the `.js` specifier named a file that does not exist)" },
  { n: 17, where: "packages/mpd-verify-plugin/src/dshgo-cards.ts:13", verdict: "FIXED", fix: "`.ts` extension added" },
  { n: 18, where: "packages/mpd-verify-plugin/src/tools.ts:19", verdict: "FIXED", fix: "`.ts` extension added" },
  { n: 19, where: "packages/mpd-workmate-plugin/src/dshgo-cards.ts:12", verdict: "FIXED", fix: "`.ts` extension added" },
  { n: 20, where: "packages/mpd-workmate-plugin/src/index.ts:20", verdict: "FIXED", fix: "`.ts` extension added" }
]

/** The files this round touched beyond the twenty rows: the same defect CLASS, closed pre-emptively. */
const sameClassAlsoFixed = [
  "packages/mpd-autoproject-plugin/src/boulder/dshgo-cards.ts",
  "packages/mpd-bundle-plugin/src/dshgo-panel.ts",
  "packages/mpd-bundle-plugin/src/dshgo-surfaces.ts",
  "packages/mpd-bundle-plugin/src/dshgo-team-panel.ts",
  "packages/mpd-bundle-plugin/src/dshgo-views.ts",
  "packages/mpd-bundle-plugin/src/dshgo-copy.ts"
]

/** The result this directory certifies. */
const result = {
  lane: "T10 — CodeRabbit round 1: fix 20 findings (9 missing .ts imports, 3 stale docs, 6 correctness, 3 quality)",
  at: new Date().toISOString(),
  source: "PR #90 inline review comments (comments.json + findings.txt in this directory)",
  reconciliation: rows,
  sameClassAlsoFixed,
  regressionTests: [
    "packages/mpd-bundle-plugin/test/dshgo-panel.test.ts — the custom-answer payload (#5) and the ready-set refresh (#6)",
    "packages/mpd-bundle-plugin/test/dshgo-team-panel.test.ts — NEW: registration, the board signature (#9), the watchdog envelope + rejection (#8), and the tap map"
  ],
  distRebuild: "24 stale targets rebuilt with the PINNED toolchain (.toolchain/node_modules/.bin/bun, path-qualified from the repo root); verify-dist-fresh now reports 34/34 fresh",
  gates: [
    { id: "bun test (the eight touched packages)", exit: 0, observed: "1650 pass, 2 skip (svn toolchain absent), 0 fail" },
    { id: "bun run typecheck", exit: 0, observed: "tsgo --noEmit clean" },
    { id: "node scripts/verify-comment-coverage.ts", exit: 0, observed: "VERDICT: PASS (one new test helper needed a named return type — fixed)" },
    { id: "bun run verify:docs", exit: 0, observed: "pairs=54 failed=0 violations=0 dead=0 — PASS" },
    { id: "node scripts/verify-dshgo-views.ts", exit: 0, observed: "PASS" },
    { id: "node scripts/verify-dist-fresh.ts", exit: 0, observed: "34/34 targets fresh" },
    { id: "bun run verify:gates", exit: 0, observed: "9/9 members green" },
    { id: "app checker — dsh-go/views/mpd-team.json", exit: 0, observed: "能显示" }
  ],
  notes: [
    "The `.ts` extension change does NOT move emitted bytes (measured: the memory package's dist sha256 is identical before and after), so the extension fixes alone would not have reddened dist-fresh; the LOGIC fixes did, hence the rebuild.",
    "A negative control proved the #11 arm: reverting `.bind(target)` makes the class-bridge test fail (1 fail), so the test is not vacuous."
  ]
}

writeFileSync(join(E, "result.json"), JSON.stringify(result, null, 2) + "\n")
console.log("result.json written:", rows.length, "findings reconciled")
