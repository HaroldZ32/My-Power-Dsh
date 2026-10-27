// The loopback model endpoint, in its OWN process.
//
// The TUI lane drives tmux SYNCHRONOUSLY (sleepMs blocks the event loop), so a stub living in the
// lane's process cannot read the request the app sends while the lane waits — measured: the sockets
// were ESTAB with 127 KB queued in Recv-Q and `requests()` still read 0. This child keeps its own
// event loop free, appends one JSON line per request to the trace file, and prints its port.
//
// Usage: bun stub-server.ts <traceFile> <portFile>
import { writeFileSync } from "node:fs"
import { makeStubModel } from "../skills/dsh-qa/scripts/extension-isolation.ts"

/** Where one JSON line per request is appended. */
const traceFile: string = process.argv[2] ?? ""
/** Where the bound port is written once listening. */
const portFile: string = process.argv[3] ?? ""

/** The script: one REAL cellwork tool call, then the closing text. */
const stub = makeStubModel({
  label: "cellwork-reverify",
  script: [{ tool: "cellwork_status", args: {} }, { text: "QA-STUB-CELLWORK-REVERIFY-PONG" }],
})
const port = await stub.listen()
// Truncate: the trace describes THIS run only, never a previous run's requests.
writeFileSync(traceFile, "")
writeFileSync(portFile, String(port) + "\n")
console.log("stub listening on 127.0.0.1:" + String(port))

/** How many trace entries are already on disk. */
let written = 0
/** Flush new trace entries to the file. */
const flush = (): void => {
  while (written < stub.trace.length) {
    const entry = stub.trace[written]
    writeFileSync(traceFile, JSON.stringify(entry) + "\n", { flag: "a" })
    written += 1
  }
}

// The stub's own handler appends synchronously once `req.on("end")` fires; polling keeps this file
// script-free while the server answers.
setInterval(flush, 250)
// The lane kills this child when the drive is over; a last flush runs on the way out.
process.on("SIGTERM", () => { flush(); process.exit(0) })
process.on("SIGINT", () => { flush(); process.exit(0) })
