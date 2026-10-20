// What does the runtime report when a WATCHED directory is removed or renamed?
// The F4 fix has two triggers depending on this: a self-event (Bun, per the writer) and close/error
// (Node, per my previous observation). This probe prints the raw signals per runtime.
import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync, watch } from "node:fs"
import { join } from "node:path"
import { basename } from "node:path"
const HERE = import.meta.dirname
/** Run one mutation and record every signal for 400 ms. */
async function probe(label: string, mutate: (dir: string) => void): Promise<void> {
  const ws = mkdtempSync(join(HERE, "rt-"))
  const dir = join(ws, "watched")
  mkdirSync(dir)
  const inoBefore = statSync(dir).ino
  const signals: string[] = []
  const w = watch(dir, { persistent: false }, (event, name) => signals.push(`event=${event} name=${String(name)}`))
  w.on("close", () => signals.push("close"))
  w.on("error", (error) => signals.push(`error=${String(error)}`))
  await new Promise((r) => setTimeout(r, 60))
  mutate(dir)
  await new Promise((r) => setTimeout(r, 400))
  const inoAfter = (() => { try { return statSync(dir).ino } catch { return -1 } })()
  w.close()
  console.log(JSON.stringify({ label, runtime: process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`, basename: basename(dir), inoBefore, inoAfter, sameIno: inoBefore === inoAfter, signals }))
  rmSync(ws, { recursive: true, force: true })
}
await probe("rm-and-recreate", (dir) => { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir) })
await probe("rename-away", (dir) => { renameSync(dir, dir + "-old"); mkdirSync(dir) })
