// T22 — DROP THE `language` CHIP from the dependency codeBlock.
//
// The app ALWAYS draws the codeBlock's header strip; the language string sits at the strip's content
// edge and the Copy control at the far edge (lib/ui/chat/dsh_ui/dsh_ui_plugin_controls.dart,
// `_PluginCodeBlock`). `language: "text"` therefore printed a pointless "text" label beside Copy.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** This evidence directory. */
const E = import.meta.dirname

/** The per-tree measurements `build-trees.ts` wrote. */
const measured = JSON.parse(readFileSync(join(E, "measure.json"), "utf8"))

/** The result this directory certifies. */
const result = {
  lane: "T22 — Polish: drop the `text` language chip from the dependency codeBlock",
  at: new Date().toISOString(),
  observed: "the rendered block's header strip showed the word `text` beside the Copy control.",
  cause: "`_PluginCodeBlock` draws its header unconditionally and renders `widget.language ?? ''` at the content edge; the view passed `language: 'text'`.",
  fix: "the `codeBlock()` helper emits `{ type: 'codeBlock', code }` — no language at all. The field is optional, so nothing else changes; the header strip keeps only the copy affordance.",
  where: "packages/mpd-bundle-plugin/src/dshgo-views.ts codeBlock",
  tests: ["the graph's codeBlock carries NO `language` property (asserted on the built tree, alongside the existing content assertions)"],
  measured,
  delta: "mpd-team-v2 4091 B -> 4073 B (-18 bytes, the `,\"language\":\"text\"` field); node count unchanged (47); lint findings 0; the built tree contains no \"language\" key at all",
  gates: [
    { id: "bun test packages/mpd-bundle-plugin packages/mpd-dsh-adapter-plugin", exit: 0, observed: "681 pass, 0 fail" },
    { id: "bun run typecheck", exit: 0, observed: "0 errors" },
    { id: "node scripts/verify-comment-coverage.ts", exit: 0, observed: "PASS" },
    { id: "bun run verify:docs", exit: 0, observed: "pairs=55 failed=0 violations=0 dead=0 — PASS" },
    { id: "node scripts/verify-dshgo-views.ts", exit: 0, observed: "PASS" },
    { id: "node scripts/verify-dist-fresh.ts", exit: 0, observed: "34/34 fresh (the bundle target rebuilt)" },
    { id: "bun run verify:gates", exit: 0, observed: "9/9 members green" },
    { id: "app checker", exit: 0, observed: "both static views + all four live trees exit 0" }
  ],
  bounds: [
    "NO RENDER: the chip's disappearance is proven by the built tree (no `language` key) and by the app's renderer reading `language ?? ''`, not by a PNG — this session has no Flutter SDK.",
    "The block's header strip REMAINS: it is where the Copy control lives, and the app draws it whatever the view says. Only the label text is gone, which is what the polish asked for."
  ]
}

writeFileSync(join(E, "result.json"), JSON.stringify(result, null, 2) + "\n")
console.log("result.json written")
