import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { watchGraph } from "../../../../packages/mpd-graph-core/src/index.ts"
const HERE = import.meta.dirname
/** One scenario: replace the dir, then write again. */
async function scenario(label: string, replace: (dir: string) => void): Promise<void> {
  const ws = mkdtempSync(join(HERE, "dbg2-"))
  const dir = join(ws, "boards")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "a.json"), "{}")
  const inoBefore = statSync(dir).ino
  const events: number[] = []
  const w = watchGraph({ boardDir: dir }, { debounceMs: 120, onChange: () => { events.push(Date.now()) }, onError: () => {} })
  await new Promise((r) => setTimeout(r, 50))
  replace(dir)
  const inoAfter = statSync(dir).ino
  await new Promise((r) => setTimeout(r, 500))
  const afterReplace = events.length
  writeFileSync(join(dir, "late.json"), "{}")
  await new Promise((r) => setTimeout(r, 700))
  console.log(label, "ino", inoBefore, "->", inoAfter, "sameIno", inoBefore === inoAfter, "batchesAfterReplace", afterReplace, "batchesAfterLateWrite", events.length)
  w.close()
}
await scenario("rm+mkdir immediate", (dir) => { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "b.json"), "{}") })
await scenario("rm+sleep+mkdir", (dir) => { rmSync(dir, { recursive: true, force: true }); const end = Date.now() + 30; while (Date.now() < end) {} mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "b.json"), "{}") })
await scenario("rename-in-place", (dir) => { const tmp = dir + "-new"; mkdirSync(tmp); writeFileSync(join(tmp, "b.json"), "{}"); rmSync(dir, { recursive: true, force: true }); renameSync(tmp, dir) })
