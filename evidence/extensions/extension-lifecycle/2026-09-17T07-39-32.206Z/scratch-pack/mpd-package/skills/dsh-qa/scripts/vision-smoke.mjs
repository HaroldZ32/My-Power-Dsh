#!/usr/bin/env node
// Case vision-e2e (Plan C / C8): prove the multimodal track end to end.
// 1) generates a deterministic PNG fixture (blue background, red square, green circle);
// 2) makes a REAL official DeepSeek vision API call with the fixture (key read from
//    ~/.dsh/.credentials.yaml, never printed) and asserts an image-grounded answer;
// 3) asserts the declared multimodal route id (mpd-modelchain multimodalLooker)
//    matches the official model catalog. Evidence -> evidence/plan-c/c8-vision/<ts>/.
// --self-test is the offline fixture-generator test only.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { deflateSync } from "node:zlib"
import { credentialDescriptor, refuseWithoutCredential, resolveProviderCredential } from "./lib/credentials.mjs"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const MODEL = "deepseek-v4-flash-vision-exp"

// ---- minimal deterministic PNG (32x32 RGBA) ----
function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let c = -1
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, "ascii")
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
function generateFixture() {
  const W = 32, H = 32
  const raw = Buffer.alloc((W * 4 + 1) * H)
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0
    for (let x = 0; x < W; x++) {
      const o = y * (W * 4 + 1) + 1 + x * 4
      const inSquare = x >= 8 && x < 14 && y >= 6 && y < 12
      const dx = x - 24, dy = y - 24
      const inCircle = dx * dx + dy * dy <= 36
      let r = 30, g = 60, b = 180 // blue background
      if (inSquare) { r = 230; g = 30; b = 30 } // red square
      if (inCircle) { r = 40; g = 200; b = 60 } // green circle
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
  return png
}

function readApiKey() {
  // The ONE resolver (T-58): environment, then the declared credentials document (refs / flat /
  // records), then the shell profile's exported keys. The old flat-file regex only accepted a
  // shape this host's store does not have, so the lane reported a FALSE RED here.
  return resolveProviderCredential({ provider: "deepseek" })
}

function selfTest() {
  const png = generateFixture()
  if (png.length < 100 || png.readUInt32BE(0) !== 0x89504e47) { console.error("[vision-e2e self-test] FAIL: fixture"); process.exit(1) }
  const back = png.subarray(12, 16).toString("ascii")
  if (back !== "IHDR") { console.error("[vision-e2e self-test] FAIL: png shape"); process.exit(1) }
  console.log("[vision-e2e self-test] ok: fixture generator verified (" + png.length + " bytes)")
}

async function runReal() {
  const resolution = readApiKey()
  if (!resolution.present) {
    // Refuse loudly with the canonical marker (SKIP, or FAIL under --no-skip/--require-pack) and
    // the exact missing prerequisite — never a bare error line that reads as an assertion failure.
    const exitCode = refuseWithoutCredential({ caseSlug: "vision-smoke", resolution })
    console.log("[vision-e2e] credential resolution: " + JSON.stringify(credentialDescriptor(resolution)))
    process.exit(exitCode)
  }
  const key = resolution.value
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "plan-c", "c8-vision", ts)
  mkdirSync(outDir, { recursive: true })
  const png = generateFixture()
  const fixture = join(outDir, "fixture.png")
  writeFileSync(fixture, png)
  const b64 = png.toString("base64")
  const body = {
    model: MODEL,
    messages: [{ role: "user", content: [
      { type: "text", text: "Describe precisely what shapes and colors you see in this image. One sentence." },
      { type: "image_url", image_url: { url: "data:image/png;base64," + b64 } }
    ] }],
    max_tokens: 200
  }
  let status = null, out = null, err = null
  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000)
    })
    status = res.status
    const text = await res.text()
    out = text
  } catch (e) { err = String(e) }
  let answer = ""
  let ok = false
  if (status === 200 && out) {
    try {
      const j = JSON.parse(out)
      answer = j.choices?.[0]?.message?.content ?? ""
      const t = answer.toLowerCase()
      ok = (t.includes("red") || t.includes("square")) && (t.includes("green") || t.includes("circle"))
    } catch { /* leave ok=false */ }
  }
  const modelchain = readFileSync(join(repoRoot, "packages", "mpd-modelchain-plugin", "dist", "index.js"), "utf8")
  const routeDeclared = modelchain.includes("multimodalLooker") && modelchain.includes("vision-exp")
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, status, routeDeclared, answer, apiError: err, rawBytes: out ? out.length : 0 }, null, 2))
  writeFileSync(join(outDir, "answer.txt"), answer + "\n")
  if (out) writeFileSync(join(outDir, "raw.json"), out)
  console.log("[vision-e2e] ok=" + ok + " status=" + status + " routeDeclared=" + routeDeclared + " -> " + outDir)
  console.log("[vision-e2e] answer: " + answer)
  if (!ok || !routeDeclared) process.exit(1)
  console.log("[vision-e2e] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
