import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { watchGraph } from "../../../../packages/mpd-graph-core/src/index.ts"
const HERE = import.meta.dirname
const ws = mkdtempSync(join(HERE, "dbg-"))
const boardDir = join(ws, "boards")
mkdirSync(boardDir, { recursive: true })
writeFileSync(join(boardDir, "a.json"), "{}")
const events: unknown[] = []
const errors: unknown[] = []
const w = watchGraph({ boardDir }, { debounceMs: 150, onChange: (e) => { events.push({ ...e, at: Date.now() }); console.log("BATCH", JSON.stringify(e), "watching=", w.watching) }, onError: (e) => { errors.push(String(e)); console.log("ERROR", String(e)) } })
await new Promise((r) => setTimeout(r, 50))
console.log("initial watching", w.watching)
rmSync(boardDir, { recursive: true, force: true })
mkdirSync(boardDir, { recursive: true })
writeFileSync(join(boardDir, "a.json"), "{\"x\":1}")
writeFileSync(join(boardDir, "b.json"), "{}")
await new Promise((r) => setTimeout(r, 600))
console.log("after replace: events", events.length, "watching", w.watching, "errors", errors)
writeFileSync(join(boardDir, "c.json"), "{}")
await new Promise((r) => setTimeout(r, 800))
console.log("after c write: events", events.length, "watching", w.watching, "errors", errors)
writeFileSync(join(boardDir, "d.json"), "{}")
await new Promise((r) => setTimeout(r, 600))
console.log("after d write: events", events.length)
w.close()
