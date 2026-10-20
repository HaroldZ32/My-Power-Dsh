import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { watch } from "node:fs"
const HERE = import.meta.dirname
const ws = mkdtempSync(join(HERE, "dbg3-"))
const dir = join(ws, "d")
mkdirSync(dir)
const w = watch(dir, { persistent: false }, (ev, name) => console.log("EVENT", ev, name))
w.on("close", () => console.log("CLOSE event"))
w.on("error", (e) => console.log("ERROR", String(e)))
console.log("ino", statSync(dir).ino)
await new Promise((r) => setTimeout(r, 50))
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir)
console.log("ino after", statSync(dir).ino)
await new Promise((r) => setTimeout(r, 300))
writeFileSync(join(dir, "x.json"), "{}")
await new Promise((r) => setTimeout(r, 300))
w.close()
