#!/usr/bin/env node
// t56 verbatim check: the persisted bodies must equal the source tasks' completion outputs byte for byte.
// Read-only with respect to the deliverables: it reads .mpd/team state and the two written files and
// compares the text AFTER each provenance header. Exits 1 on any mismatch.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const TEAM = ".mpd/team/mpd-default/team.json";
const PAIRS = [
  { src: "t52", path: "evidence/team-watchdog/design/DESIGN.md" },
  { src: "t53", path: "evidence/team-watchdog/seam-audit/20260915T154132Z/REPORT.md" },
];

const state = JSON.parse(readFileSync(TEAM, "utf8"));
const tasks = state.tasks ?? state.state?.tasks ?? [];
const list = Array.isArray(tasks) ? tasks : Object.values(tasks);
const out = new Map(list.filter((t) => t && typeof t === "object").map((t) => [t.id, t.output ?? ""]));

let bad = 0;
for (const { src, path } of PAIRS) {
  const source = out.get(src);
  if (typeof source !== "string" || source.length === 0) {
    console.log(`[verbatim] ${src} -> ${path}: NO SOURCE PAYLOAD`);
    bad++;
    continue;
  }
  const written = readFileSync(path, "utf8");
  const MARK = "-->\n";
  const cut = written.indexOf(MARK);
  if (cut < 0) {
    console.log(`[verbatim] ${src} -> ${path}: NO PROVENANCE HEADER`);
    bad++;
    continue;
  }
  const body = written.slice(cut + MARK.length);
  const want = source;  // exact: no byte added, none removed
  const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
  const same = body === want;
  if (!same) bad++;
  console.log(
    `[verbatim] ${src} -> ${path}: ${same ? "IDENTICAL" : "MISMATCH"} ` +
      `body=${Buffer.byteLength(body)} bytes sha256=${sha(body)} ` +
      `source=${Buffer.byteLength(want)} bytes sha256=${sha(want)} ` +
      `file=${Buffer.byteLength(written)} bytes sha256=${sha(written)}`,
  );
}
console.log(bad === 0 ? "[verbatim] PASS (both bodies byte-identical to their source payloads)" : `[verbatim] FAIL (${bad})`);
process.exit(bad === 0 ? 0 : 1);
