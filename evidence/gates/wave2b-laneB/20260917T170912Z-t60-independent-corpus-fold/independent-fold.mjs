#!/usr/bin/env node
// t60 — INDEPENDENT recomputation of the `skills` corpus treeSha.
//
// RULE SOURCE, read (never called, never imported): `scripts/verify-vendor.mjs`
//   · enumeration (`listFiles`): recursive from the asset dir; skip an entry named `node_modules`;
//     skip `__pycache__` directories and `*.pyc`/`*.pyo` files; everything else is corpus content.
//   · path list: `files.map(f => f.slice(dir.length + 1)).sort()` — asset-relative, default JS sort.
//   · per-file bytes (`readBytes`): if the buffer contains NO NUL byte it is TEXT and is LF-normalized
//     (`String.replace(/\r\n?/g, "\n")` after a utf8 decode); otherwise it is BINARY and hashed RAW.
//   · fold: sha256 over, for each sorted relative path, `relpath + "\n" + perFileSha256Hex + "\n"`.
// This file re-implements that rule from the description above in its own code. It does NOT import
// `verify-vendor.mjs`, does NOT spawn it, and does NOT run `scripts/repin-vendor.mjs` (which would be
// the helper that WROTE the value — a value agreeing with itself across one code path is not evidence).
//
// usage: node ./independent-fold.mjs [--dir <corpus dir>] [--lock <lock path>] [--out <json path>]
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name)
  return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt
}
const REPO = process.cwd()
const DIR = argOf("--dir", join(REPO, "skills"))
const LOCK = argOf("--lock", join(REPO, "VENDOR_LOCK.json"))
const OUT = argOf("--out", null)
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex")

// —— my own enumeration, mirroring the rule (no shared code with the gate) ——
function enumerate(dir) {
  const out = []
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === "node_modules") continue
      const p = join(d, name)
      const st = statSync(p)
      if (st.isDirectory()) {
        if (name === "__pycache__") continue
        walk(p)
      } else {
        if (name.endsWith(".pyc") || name.endsWith(".pyo")) continue
        out.push(p)
      }
    }
  }
  walk(dir)
  return out
}

// —— my own byte rule: NUL ⇒ binary ⇒ raw; else text ⇒ LF-normalized ——
function bytesFor(file, mode) {
  const buf = readFileSync(file)
  const isBinary = buf.includes(0)
  if (mode === "raw" || isBinary) return { buf, kind: isBinary ? "binary" : "text-hashed-raw" }
  return { buf: Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n")), kind: "text-lf" }
}

const fold = (files, dir, mode) => {
  const rels = files.map((f) => f.slice(dir.length + 1)).sort()
  const h = createHash("sha256")
  const perFile = []
  for (const rel of rels) {
    const { buf, kind } = bytesFor(join(dir, rel), mode)
    const fh = sha256(buf)
    h.update(rel + "\n" + fh + "\n")
    perFile.push({ rel, sha256: fh, kind, bytes: buf.length })
  }
  return { treeSha: h.digest("hex"), rels, perFile }
}

const files = enumerate(DIR)
const lf = fold(files, DIR, "lf")
const raw = fold(files, DIR, "raw")
const lockText = readFileSync(LOCK, "utf8")
const lock = JSON.parse(lockText)
const entry = (lock.assets ?? {}).skills ?? {}
const normalized = raw.perFile.filter((r, i) => r.sha256 !== lf.perFile[i].sha256).map((r) => r.rel)
const lockSha = sha256(Buffer.from(lockText))

const report = {
  schema: "laneB/t60-independent-fold/1",
  moment_utc: new Date().toISOString(),
  command: "node ./independent-fold.mjs",
  inputs: { dir: DIR, lock: LOCK, lock_sha256: lockSha, lock_sha256_16: lockSha.slice(0, 16), files_discovered: files.length },
  rule_source: "scripts/verify-vendor.mjs readBytes()/listFiles()/treeSha fold, re-implemented here; the gate was neither called nor imported and repin-vendor.mjs was not run",
  lf_treeSha: lf.treeSha,
  raw_treeSha: raw.treeSha,
  lock: { skills_treeSha: entry.treeSha ?? null, skills_fileCount: entry.fileCount ?? null },
  comparison: {
    lf_equals_lock: lf.treeSha === entry.treeSha,
    filecount_equals_lock: files.length === entry.fileCount,
    words: null,
    first_byte_difference_if_any: null,
  },
  lf_normalized_files: normalized,
  lf_normalized_explanation: "a file is LF-normalized when its bytes contain NO NUL (text) AND a CR/CRLF sequence was present; the digest then differs from the raw-bytes digest of the same file",
  raw_is_not_the_lock_value: "the RAW-BYTES fold is printed only to show the wave's LF-vs-raw trap: the lock holds the LF value, and a raw reading silently fails `node ./scripts/verify-vendor.mjs` on any corpus containing CRLF/CR bytes",
  per_file_kinds: {
    text_lf_normalized: lf.perFile.filter((r) => r.kind === "text-lf").length,
    binary: lf.perFile.filter((r) => r.kind === "binary").length,
  },
}
if (report.comparison.lf_equals_lock && report.comparison.filecount_equals_lock) {
  report.comparison.words = "MY LF-normalized fold equals the lock's written value over the same file count: the landed re-pin reading is CONFIRMED by an independent implementation."
} else if (report.comparison.filecount_equals_lock === false) {
  report.comparison.words = "FILE-COUNT DIFFERENCE: my enumeration found " + files.length + " files where the lock declares " + entry.fileCount + "."
} else {
  const firstRel = lf.perFile.length > 0 ? lf.perFile[0].rel : null
  report.comparison.words = "BYTE DIFFERENCE: the folds differ over the same file count; first relative path in sort order is " + firstRel + " (per-file digests cannot name the differing file against a lock that stores only the fold, so the LF-vs-raw pair above is the discriminator)."
  report.comparison.first_byte_difference_if_any = firstRel
}
if (OUT !== null) writeFileSync(OUT, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
