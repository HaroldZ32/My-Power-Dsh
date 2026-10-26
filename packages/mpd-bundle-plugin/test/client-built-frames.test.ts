// THE BUILT ARTIFACT CARRIES THE FRAME CHANNEL AND THE RECURSION (cellwork wave 4, contract D4).
//
// WHY THIS ARM EXISTS AND WHY IT READS THE ARTIFACT. `packages/mpd-bundle-plugin/client.js` is the file
// the browser actually loads, and it is NOT covered by `verify-dist-fresh`: the factory sources are
// spliced into it as TEXT by `node scripts/build-mpd-client.ts`, so a source change that was never
// re-spliced would ship a picture without frames while every source test stayed green. This arm reads
// the COMMITTED artifact, parses it through the bundle's own loader stub, and asserts the frame
// vocabulary is present — the mechanical proof that the rebuild happened.
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { loadBundleClient } from "./client-harness"

/** The repository root the artifact lives under, resolved from this file's own directory. */
const ROOT = join(import.meta.dir, "..", "..", "..")

test("the BUILT client parses, registers its factories, and ships the frame layer", () => {
  /** The artifact loaded through the bundle's own loader stub — it throws on a syntax error. */
  const loaded = loadBundleClient()
  expect(loaded.factories.size).toBeGreaterThan(0)
  /** The committed artifact's bytes. */
  const source = readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "client.js"), "utf8")
  // THE FRAME VOCABULARY, in the three spellings the stylesheet, the DOM layer and the witness use: a
  // build that dropped any one of them would paint a picture without boxes or without a verifiable rect.
  expect(source).toContain(".mpd-dag-group")
  expect(source).toContain("data-mpd-group")
  expect(source).toContain("data-mpd-frames")
  // THE RECURSIVE HALF (T23): the geometry that lays a box's interior out inside it, the memo that keeps
  // that recursion linear, the absolute card layer the nested branch renders, and the field that reports
  // an unrouted interior edge. A build that spliced the narrow seam only would still paint the frames
  // layer — and every one of these four would be missing, so the artifact would draw decoration instead
  // of a subcell's own DAG.
  expect(source).toContain("layoutNested")
  expect(source).toContain("sizePlanOf")
  expect(source).toContain("data-mpd-cards")
  expect(source).toContain("nestedBackEdges")
})
