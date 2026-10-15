#!/usr/bin/env node
// f3-fetch-shim.mjs — a DETERMINISTIC fake npm registry, injected as `globalThis.fetch`.
//
// WHY A FAKE AND NOT A LOCAL SERVER: this session's sandbox blackholes even LOOPBACK TCP — a stub HTTP
// server on 127.0.0.1 received ZERO connections while the probe's own `fetch` sat until its 20 s abort
// (measured: `arm A meta=0 tarball=0`, `both-unreachable`, 40 s for two probes). The fake therefore
// implements exactly the surfaces the shipped probe program uses: `signal` (honoured — an abort
// REJECTS), `options.headers.Range` (recorded, and answered with 206), and the `Response` shape the
// program reads (`status` and `body.getReader()`). It is configured per base URL by `F3_FAKE_SPEC` and
// writes its request counters to `F3_FAKE_STATE` on exit, so an arm can assert what was really asked.
//
// NOT PROVEN BY THIS SHIM, and the report says so: the TCP/TLS transport itself. What it drives is the
// SHIPPED decision tree — the 206/200/zero-byte rule, the skip-with-reason branch, the exit codes and
// the selection file.
import { writeFileSync } from "node:fs"

/** Per-base-URL behaviour: `{ "<base>": { meta: "ok"|"500", tarball: "range"|"whole"|"empty"|"hang"|"error" } }`. */
const spec = JSON.parse(process.env.F3_FAKE_SPEC ?? "{}")
/** Where the counters are written, so the parent can read what the probe really requested. */
const statePath = process.env.F3_FAKE_STATE ?? ""

/** What the fake has been asked for, per base URL. */
const state = { meta: {}, tarball: {}, ranges: [] }

/** Register one request against a base URL and a kind, and answer the count. */
function count(kind, base) {
  state[kind][base] = (state[kind][base] ?? 0) + 1
  return state[kind][base]
}

/** The fake registry call. */
globalThis.fetch = async function fakeFetch(target, options = {}) {
  /** The requested URL, as the probe builds it. */
  const url = String(target)
  /** The spec entry whose base URL prefixes this request, if any. */
  const base = Object.keys(spec).find((key) => url.startsWith(key))
  /** That entry, or an empty one for an unconfigured base (which answers 500, never a silent pass). */
  const entry = base === undefined ? {} : spec[base]
  /** Whether the request is for a tarball rather than for metadata. */
  const tarball = url.includes("/-/")
  if (tarball) {
    count("tarball", base ?? "<unknown>")
    if (options.headers !== undefined && options.headers.Range !== undefined) state.ranges.push(options.headers.Range)
    const mode = entry.tarball ?? "error"
    if (mode === "range") return new Response(new Uint8Array(1024), { status: 206 })
    if (mode === "whole") return new Response(new Uint8Array(65536), { status: 200 })
    if (mode === "empty") return new Response(new Uint8Array(0), { status: 200 })
    if (mode === "hang") {
      // THE MEASURED BLACKHOLE: the connection is accepted and no byte ever arrives. The probe must be
      // bounded by its OWN abort, so this rejects only when `signal` fires.
      return await new Promise((_resolve, reject) => {
        if (options.signal === undefined) return
        if (options.signal.aborted) return reject(new Error("This operation was aborted"))
        options.signal.addEventListener("abort", () => reject(new Error("This operation was aborted")))
      })
    }
    throw new TypeError("fetch failed")
  }
  count("meta", base ?? "<unknown>")
  if ((entry.meta ?? "500") === "ok") return new Response('{"name":"@deepseek-ai/dsh"}', { status: 200 })
  return new Response("no", { status: 500 })
}

process.on("exit", () => {
  if (statePath !== "") writeFileSync(statePath, JSON.stringify(state) + "\n")
})
