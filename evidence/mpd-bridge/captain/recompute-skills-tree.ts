#!/usr/bin/env node
// Recompute the `skills` asset fingerprint with the SAME algorithm scripts/verify-vendor.mjs uses,
// because the gate prints only the first 12 hex chars of the treeSha and the lock needs all 64.
// The gate remains the oracle: after writing the value into VENDOR_LOCK.json, verify-vendor must
// pass — if this script and the gate disagreed, that run would fail.
//
// Algorithm (transcribed from scripts/verify-vendor.mjs:63-121):
//   - text files (no NUL byte) are hashed as LF-normalised UTF-8, binary files raw;
//   - the walk skips node_modules, __pycache__ and *.pyc/*.pyo;
//   - relpaths relative to the asset dir are sorted, then sha256 over "<relpath>\n<filehash>\n".

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const dir = join(repoRoot, "skills");

function readBytes(p) {
  const buf = readFileSync(p);
  if (!buf.includes(0)) return Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n"));
  return buf;
}

function listFiles(root) {
  if (statSync(root).isFile()) return [root];
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (entry === "node_modules") continue;
      if (entry === "__pycache__" || entry.endsWith(".pyc") || entry.endsWith(".pyo")) continue;
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(root);
  return out;
}

const files = listFiles(dir).map((f) => f.slice(dir.length + 1)).sort();
const h = createHash("sha256");
for (const f of files) {
  const fh = createHash("sha256").update(readBytes(join(dir, f))).digest("hex");
  h.update(f + "\n" + fh + "\n");
}
console.log(JSON.stringify({ that: "skills", fileCount: files.length, treeSha: h.digest("hex") }, null, 2));
