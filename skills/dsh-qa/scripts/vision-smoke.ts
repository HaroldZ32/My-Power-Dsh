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
import { credentialDescriptor, refuseWithoutCredential, resolveProviderCredential } from "./lib/credentials.ts"
import type { CredentialResolution } from "./lib/credentials.ts"

/** The repository root, derived from this script's own URL (`<root>/skills/dsh-qa/scripts/`). */
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The official multimodal model id the live arm must call and the declared route must name. */
const MODEL = "deepseek-v4-flash-vision-exp"

/**
 * The CRC-32 hasher plus the memoised lookup table it keeps on its own function object.
 * The property cannot be declared on a plain `function` declaration (only a namespace merge
 * could add it, and namespaces are not erasable syntax), so the hasher is a named arrow.
 */
interface Crc32Hasher {
  /**
   * Computes the CRC-32 checksum PNG requires for a chunk trailer.
   * @param buf The bytes to checksum.
   * @returns The unsigned 32-bit CRC of `buf`.
   */
  (buf: Buffer): number
  /** The 256-entry polynomial table, absent until the first call builds it. */
  table?: Int32Array
}

// ---- minimal deterministic PNG (32x32 RGBA) ----
const crc32: Crc32Hasher = (buf: Buffer): number => {
  /** The memoised polynomial table, or `undefined` on the first call. */
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      /** The CRC accumulator for this table slot. */
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  /** The running CRC accumulator, seeded with all bits set as the algorithm requires. */
  let c = -1
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/**
 * One PNG chunk: 4 length bytes, the ASCII type, the payload and the CRC over type + payload.
 * @param type The four-character chunk type (`IHDR`, `IDAT`, `IEND`).
 * @param data The chunk's payload bytes.
 * @returns The complete chunk, trailer included.
 */
function chunk(type: string, data: Buffer): Buffer {
  /** The chunk's output buffer, sized for the 12 bytes of framing plus the payload. */
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, "ascii")
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/**
 * The deterministic 32x32 RGBA fixture: blue background, red square, green circle.
 * @returns The PNG bytes of the fixture, byte-identical on every run.
 */
function generateFixture(): Buffer {
  /** Fixture width and height in pixels. */
  const W = 32, H = 32
  /** The raw scanline buffer: one filter byte per row, then RGBA pixels. */
  const raw = Buffer.alloc((W * 4 + 1) * H)
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0
    for (let x = 0; x < W; x++) {
      /** Byte offset of this pixel's red channel inside `raw`. */
      const o = y * (W * 4 + 1) + 1 + x * 4
      /** Whether the pixel falls inside the red square's bounds. */
      const inSquare = x >= 8 && x < 14 && y >= 6 && y < 12
      /** Horizontal and vertical distance from the green circle's centre. */
      const dx = x - 24, dy = y - 24
      /** Whether the pixel falls inside the green circle's radius (6 px). */
      const inCircle = dx * dx + dy * dy <= 36
      /** The pixel's red/green/blue channels, starting from the blue background. */
      let r = 30, g = 60, b = 180 // blue background
      if (inSquare) { r = 230; g = 30; b = 30 } // red square
      if (inCircle) { r = 40; g = 200; b = 60 } // green circle
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255
    }
  }
  /** The IHDR payload: width, height, bit depth 8, colour type 6 (RGBA), no interlace. */
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  /** The assembled PNG: signature, IHDR, deflated IDAT and an empty IEND. */
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
  return png
}

/**
 * The DeepSeek API key for the live arm, taken from the ONE shared resolver.
 * @returns The credential resolution: a hit carries the secret, a miss carries every tier tried.
 */
function readApiKey(): CredentialResolution {
  // The ONE resolver (T-58): environment, then the declared credentials document (refs / flat /
  // records), then the shell profile's exported keys. The old flat-file regex only accepted a
  // shape this host's store does not have, so the lane reported a FALSE RED here.
  return resolveProviderCredential({ provider: "deepseek" })
}

/** One completion choice of the chat-completions response, as far as this case reads it. */
type ChatChoice = {
  /** The assistant message of this choice. */
  readonly message?: { readonly content?: string } | null
}

/** The chat-completions response, as far as this case reads it. */
type ChatCompletionResponse = {
  /** The choices the provider returned. */
  readonly choices?: readonly ChatChoice[] | null
}

/** The offline arm: prove the deterministic fixture generator emits a well-formed PNG. */
function selfTest(): void {
  /** The generated fixture's bytes. */
  const png = generateFixture()
  if (png.length < 100 || png.readUInt32BE(0) !== 0x89504e47) { console.error("[vision-e2e self-test] FAIL: fixture"); process.exit(1) }
  /** The first chunk's type, which must be `IHDR` for a valid PNG. */
  const back = png.subarray(12, 16).toString("ascii")
  if (back !== "IHDR") { console.error("[vision-e2e self-test] FAIL: png shape"); process.exit(1) }
  console.log("[vision-e2e self-test] ok: fixture generator verified (" + png.length + " bytes)")
}

/** The live arm: one real vision API call plus the declared-route assertion. */
async function runReal(): Promise<void> {
  /** The DeepSeek credential resolution for this run. */
  const resolution = readApiKey()
  if (!resolution.present) {
    // Refuse loudly with the canonical marker (SKIP, or FAIL under --no-skip/--require-pack) and
    // the exact missing prerequisite — never a bare error line that reads as an assertion failure.
    /** The exit code the canonical refusal marker dictates for this lane. */
    const exitCode = refuseWithoutCredential({ caseSlug: "vision-smoke", resolution })
    console.log("[vision-e2e] credential resolution: " + JSON.stringify(credentialDescriptor(resolution)))
    process.exit(exitCode)
  }
  /** The resolved secret; it is used only in the Authorization header and never printed. */
  const key = resolution.value
  /** The evidence directory timestamp, with `:` replaced so the name is portable. */
  const ts = new Date().toISOString().replaceAll(":", "-")
  /** The evidence directory this run writes its result, fixture and answer into. */
  const outDir = join(repoRoot, "evidence", "plan-c", "c8-vision", ts)
  mkdirSync(outDir, { recursive: true })
  /** The PNG fixture sent to the model. */
  const png = generateFixture()
  /** The path the fixture is persisted to, so the call is auditable. */
  const fixture = join(outDir, "fixture.png")
  writeFileSync(fixture, png)
  /** The fixture's base64 form, embedded as a data URL. */
  const b64 = png.toString("base64")
  /** The OpenAI-shaped chat-completions request body. */
  const body = {
    model: MODEL,
    messages: [{ role: "user", content: [
      { type: "text", text: "Describe precisely what shapes and colors you see in this image. One sentence." },
      { type: "image_url", image_url: { url: "data:image/png;base64," + b64 } }
    ] }],
    max_tokens: 200
  }
  /** The response's HTTP status, or `null` when the request never completed. */
  let status: number | null = null, out: string | null = null, err: string | null = null
  try {
    /** The API response, awaited before its status and body are read. */
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000)
    })
    status = res.status
    /** The response body as text, kept raw for the evidence record. */
    const text = await res.text()
    out = text
  } catch (e) { err = String(e) }
  /** The model's answer text, empty when the call did not settle. */
  let answer = ""
  /** Whether the answer is grounded in the fixture's shapes and colours. */
  let ok = false
  if (status === 200 && out) {
    try {
      /** The parsed chat-completions response, viewed as the path this case reads. */
      const j: ChatCompletionResponse = JSON.parse(out)
      answer = j.choices?.[0]?.message?.content ?? ""
      /** The answer lowercased, so the shape words match case-insensitively. */
      const t = answer.toLowerCase()
      ok = (t.includes("red") || t.includes("square")) && (t.includes("green") || t.includes("circle"))
    } catch { /* leave ok=false */ }
  }
  /** The built modelchain plugin, read only to assert the declared multimodal route. */
  const modelchain = readFileSync(join(repoRoot, "packages", "mpd-modelchain-plugin", "dist", "index.js"), "utf8")
  /** Whether the shipped modelchain declares the multimodal route and the vision model. */
  const routeDeclared = modelchain.includes("multimodalLooker") && modelchain.includes("vision-exp")
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, status, routeDeclared, answer, apiError: err, rawBytes: out ? out.length : 0 }, null, 2))
  writeFileSync(join(outDir, "answer.txt"), answer + "\n")
  if (out) writeFileSync(join(outDir, "raw.json"), out)
  console.log("[vision-e2e] ok=" + ok + " status=" + status + " routeDeclared=" + routeDeclared + " -> " + outDir)
  console.log("[vision-e2e] answer: " + answer)
  if (!ok || !routeDeclared) process.exit(1)
  console.log("[vision-e2e] PASS")
}

/** The CLI arguments after the script path: `--self-test` selects the offline arm. */
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
