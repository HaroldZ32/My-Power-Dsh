import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { watchGraph } from "../../../../packages/mpd-graph-core/src/index.ts"
const HERE = import.meta.dirname
/** One replacement trial, returning the facts this finding turns on. */
async function trial(kind: "rm-recreate" | "rename-away"): Promise<{ sameIno: boolean; deliveredAfterReplace: number; deliveredAfterLateWrite: number }> {
  const ws = mkdtempSync(join(HERE, "dbg4-"))
  const dir = join(ws, "boards")
  mkdirSync(dir)
  writeFileSync(join(dir, "a.json"), "{}")
  const inoBefore = statSync(dir).ino
  const events: number[] = []
  const w = watchGraph({ boardDir: dir }, { debounceMs: 120, onChange: () => { events.push(Date.now()) }, onError: () => {} })
  await new Promise((r) => setTimeout(r, 60))
  if (kind === "rm-recreate") {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir)
  } else {
    renameSync(dir, dir + "-old")
    mkdirSync(dir)
  }
  writeFileSync(join(dir, "b.json"), "{}")
  const sameIno = statSync(dir).ino === inoBefore
  await new Promise((r) => setTimeout(r, 500))
  const afterReplace = events.length
  writeFileSync(join(dir, "late.json"), "{}")
  await new Promise((r) => setTimeout(r, 700))
  w.close()
  return { sameIno, deliveredAfterReplace: afterReplace, deliveredAfterLateWrite: events.length }
}
for (const kind of ["rm-recreate", "rm-recreate", "rm-recreate", "rename-away", "rename-away"] as const) {
  console.log(kind, JSON.stringify(await trial(kind)))
}
