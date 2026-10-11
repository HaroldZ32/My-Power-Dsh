// R1.6 evidence probe — the leaf walk against a REAL host-written profile patch, in memory only.
//
// WHY THIS PROBE EXISTS. The self-test arms prove the writer/reader agreement on SYNTHETIC documents.
// This probe runs the SAME exported functions over the profile patch the host's own `ConfigEditor`
// actually writes (`~/.dsh/profiles/dsh-tui/cordis.patch.yml`), which is the file `--apply` edits, and
// then over a copy of that text carrying a DECOY `panels:` key in another section — the exact shape
// CodeRabbit PR #35's R1.6 finding describes. Nothing here writes to that file: every mutation is a
// string operation on the text read into memory.
//
// Usage: node evidence/tui/sidebar-defects-r1/<stamp>/r16-real-document-probe.ts [<patch path>]
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { blockPanelCsv, mergePanelIds, writePanelsIntoDocument } from "../../../../scripts/mpd-tui-panels.ts"

/** The profile patch the host writes for the TUI profile this machine actually runs. */
const patchPath = process.argv[2] ?? join(homedir(), ".dsh", "profiles", "dsh-tui", "cordis.patch.yml")
/** The row id the sidebar CSV lives under. */
const ROW = "dsh-tui"

if (!existsSync(patchPath)) {
  console.log(`SKIP: ${patchPath} does not exist on this machine`)
  process.exit(0)
}
/** The real document, read but never written. */
const real = readFileSync(patchPath, "utf8")
/** What the walk answers for the real document (undefined when it carries no leaf yet). */
const realLeaf = blockPanelCsv(real, ROW)
console.log(`real document: ${patchPath}`)
console.log(`real leaf: ${realLeaf === undefined ? "(no panels leaf)" : realLeaf}`)

// A DECOY in another section, inserted BEFORE `sidePanel:` at the leaf indent — the shape that made the
// old "first panels: line in the block" reader answer the wrong value.
/** The real text with one decoy section inserted ahead of `sidePanel:`. */
const decoy = real.replace(/\n(\s*)sidePanel:/u, "\n$1dashboard:\n$1  panels: \"todo,jobs\"\n$1sidePanel:")
const decoyLeaf = blockPanelCsv(decoy, ROW)
console.log(`decoy leaf (must equal the real leaf): ${decoyLeaf === undefined ? "(no panels leaf)" : decoyLeaf}`)
console.log(`decoy probe: ${decoyLeaf === realLeaf ? "PASS — the decoy was skipped" : "FAIL — the decoy was read"}`)

// THE WRITE/READ-BACK PAIR over the same real text: the merge of one current id, written by the writer
// the read-back reads with, must come back exactly.
/** The past ids the record would prove for this probe. */
const past = ["act1:team", "act7:dag"]
/** The merge this probe would write into the decoy document. */
const merge = mergePanelIds(decoyLeaf, ["act7:team", "act7:dag"], past)
console.log(`merge: csv=${merge.csv} pruned=${merge.pruned.join(",") || "(none)"} added=${merge.added.join(",")}`)
/** The decoy document after that merge. */
const edited = writePanelsIntoDocument(decoy, ROW, merge.csv)
/** What the document reads back after the edit. */
const landed = blockPanelCsv(edited.text, ROW)
console.log(`read-back: ${landed === merge.csv ? "PASS — the write landed in the leaf that was read" : `FAIL — read back ${String(landed)}`}`)
// The decoy's OWN value must have survived untouched: the walk reads one path and edits the same one.
console.log(`decoy section untouched: ${edited.text.includes('panels: "todo,jobs"') ? "PASS" : "FAIL"}`)
