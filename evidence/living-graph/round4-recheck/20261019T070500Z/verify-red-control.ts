// LANE E's RED CONTROL: the same dead-window scenario against a COPY of watch.ts with the
// `if (timer === undefined) deliver(false)` line removed. If my green probe has discriminating power,
// this copy must lose the write (no batch within the timeout).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import type { FSWatcher } from "node:fs"
import { join } from "node:path"
import { watchGraph } from "./watch-red.ts"
import type { GraphWatchFactory } from "./watch-red.ts"
const HERE = import.meta.dirname
const root = mkdtempSync(join(HERE, "red-"))
const dir = join(root, "boards")
mkdirSync(dir)
writeFileSync(join(dir, "a.json"), "{}")
/** Fake handles; the probe kills the first one. */
const handles: Array<{ on(e: string, l: (...a: unknown[]) => void): unknown; close(): void; emit(e: string, ...a: unknown[]): void }> = []
const factory: GraphWatchFactory = (_path: string, _listener) => {
  const handlers = new Map<string, Array<(...a: unknown[]) => void>>()
  const fake = {
    on(e: string, l: (...a: unknown[]) => void): unknown { const list = handlers.get(e) ?? []; list.push(l); handlers.set(e, list); return fake },
    close(): void {},
    emit(e: string, ...a: unknown[]): void { for (const l of handlers.get(e) ?? []) l(...a) },
  }
  handles.push(fake)
  return fake as unknown as FSWatcher
}
const events: unknown[] = []
const watcher = watchGraph({ boardDir: dir }, { debounceMs: 150, createWatch: factory, onChange: (event) => { events.push(event) } })
await new Promise((r) => setTimeout(r, 60))
const killedAt = Date.now()
handles[0].emit("close")
writeFileSync(join(dir, "b.json"), "{}")
while (Date.now() - killedAt < 1500 && events.length === 0) await new Promise((r) => setTimeout(r, 5))
const result = { probe: "red-control", runtime: process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`, delivered: events.length > 0, latencyMs: events.length > 0 ? Date.now() - killedAt : -1, expected: "NOT delivered (the fix line is absent)" }
watcher.close()
rmSync(root, { recursive: true, force: true })
console.log(JSON.stringify(result, null, 1))
