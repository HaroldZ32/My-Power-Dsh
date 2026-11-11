// Read-only measurement: the skills treeSha the lock MUST carry once the new QA script is staged.
// It mirrors scripts/verify-vendor.ts's fold exactly (sorted POSIX relpath + LF-normalized per-file
// sha256) and imports the SAME byte helper, so the value can be compared against the next re-pin.
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { readAssetBytes } from "../../../../../scripts/lib/asset-files.ts"

const root: string = process.cwd()
const skills: string = join(root, "skills")
const tracked: string[] = execFileSync("git", ["-C", skills, "ls-files", "-z", "--", "."], { encoding: "utf8" })
  .split("\0")
  .filter((p: string): boolean => p.length > 0)
const rels: string[] = tracked.slice()
rels.push("dsh-qa/scripts/cellwork-activate-mint.ts")
rels.sort()
const h = createHash("sha256")
for (const rel of rels) {
  const fh: string = createHash("sha256").update(readAssetBytes(join(skills, rel))).digest("hex")
  h.update(rel + "\n" + fh + "\n")
}
console.log(JSON.stringify({ fileCount: rels.length, treeSha: h.digest("hex") }))
