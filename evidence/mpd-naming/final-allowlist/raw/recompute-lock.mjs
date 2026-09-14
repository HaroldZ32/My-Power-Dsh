#!/usr/bin/env node
// THE LOCK RULE (recompute at the settled revision; never cite a remembered string).
// Reimplements scripts/verify-vendor.mjs's algorithm verbatim:
//   listFiles(dir) -> node:fs walk, node_modules skipped, single-file assets allowed
//   readBytes(p)   -> bytes, LF-normalized when the file has no NUL
//   treeSha        -> sha256 over "relpath\n<sha256(readBytes)>\n" in sorted-relpath order
//   sha256         -> sha256 of the raw bytes for single-file assets
// Then compare every VENDOR_LOCK.json asset against the recomputation and exit non-zero on drift.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// raw/ -> final-allowlist/ -> mpd-naming/ -> evidence/ -> <repo>
const repoRoot = join(here, "..", "..", "..", "..");

function readBytes(p) {
  const buf = readFileSync(p);
  if (!buf.includes(0)) return Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n"));
  return buf;
}

function listFiles(dir) {
  if (statSync(dir).isFile()) return [dir];
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (entry === "node_modules") continue;
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

const lock = JSON.parse(readFileSync(join(repoRoot, "VENDOR_LOCK.json"), "utf8"));
let failed = false;
const report = [];
for (const [rel, meta] of Object.entries(lock.assets || {})) {
  if (rel.startsWith("_")) continue;
  const dir = join(repoRoot, rel);
  if (!existsSync(dir)) { report.push(`MISSING ${rel}`); failed = true; continue; }
  const files = listFiles(dir);
  const row = { asset: rel, declaredFileCount: meta.fileCount, actualFileCount: files.length };
  if (typeof meta.sha256 === "string") {
    row.actualSha256 = createHash("sha256").update(readFileSync(dir)).digest("hex");
    row.declaredSha256 = meta.sha256;
    if (row.actualSha256 !== meta.sha256) failed = true;
  }
  if (typeof meta.treeSha === "string") {
    const rels = files.map((f) => f.slice(dir.length + 1)).sort();
    const h = createHash("sha256");
    for (const f of rels) h.update(f + "\n" + createHash("sha256").update(readBytes(join(dir, f))).digest("hex") + "\n");
    row.actualTreeSha = h.digest("hex");
    row.declaredTreeSha = meta.treeSha;
    if (row.actualTreeSha !== meta.treeSha) failed = true;
  }
  if (meta.fileCount !== files.length) failed = true;
  report.push(JSON.stringify(row));
}
console.log(`repoRoot=${repoRoot}`);
console.log(`HEAD-from-VENDOR_LOCK.lockedAt=${lock.lockedAt}`);
for (const line of report) console.log(line);
console.log(failed ? "LOCK-RECOMPUTE=DRIFT" : "LOCK-RECOMPUTE=MATCH");
process.exit(failed ? 1 : 0);
