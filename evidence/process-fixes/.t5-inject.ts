// t5 verification harness (read-only lane): exercise the extended docs gate on a COPY of the shipped
// tree. The COPY has no .git, so the original working tree is never touched. Nothing here edits a
// shipped file: the copy is disposable scratch rooted under evidence/process-fixes/tmp/.
import { lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const repo = "/root/dshProj/my-power-dsh";
const tmp = "/tmp/t5-copy"; // OUTSIDE the repo: the workspace is read-only except its own root, and a
// copy INSIDE the repo would recurse (node refuses to copy a directory into itself).
const copy = join(tmp, "tree");
const target = "docs/design.md";
const dead = "./t5-injected-dead-link.md";
const dead2 = "./architecture.md";
const line = `\n\n## t5 injection probe\n\n[probe](${dead})\n\n[stale]( ${dead2} )\n`;

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const run = (root) => {
  const r = spawnSync("node", ["scripts/verify-docs-parity.mjs", "--root", root], { cwd: repo, encoding: "utf8" });
  return { exit: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
};

rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
// Hand-rolled copy walk: `cpSync` aborts with ERR_INTERNAL_ASSERTION on the tree's special entries
// (symlink/SKIP_DIR class), and the gate only needs the doc band plus the files its derived checks read.
const SKIP_DIR = new Set([".git", "node_modules", "evidence"]);
let copied = 0;
let skippedSpecial = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const src = join(dir, entry.name);
    const rel = relative(repo, src);
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name)) continue;
      mkdirSync(join(copy, rel), { recursive: true });
      walk(src);
      continue;
    }
    const st = lstatSync(src);
    if (st.isFile()) {
      writeFileSync(join(copy, rel), readFileSync(src));
      copied += 1;
      continue;
    }
    // Preserve symlinks as symlinks so a DANGLING one stays dangling (the gate's intended strictness);
    // anything else special is counted, not silently dropped.
    if (st.isSymbolicLink()) {
      symlinkSync(readlinkSync(src), join(copy, rel));
      continue;
    }
    skippedSpecial += 1;
  }
};
walk(repo);

const targetPath = join(copy, target);
const before = sha(targetPath);
const baseline = run(copy);
const baselineTail = baseline.out.trim().split("\n").at(-1) ?? "";

writeFileSync(targetPath, readFileSync(targetPath, "utf8") + line);
const after = sha(targetPath);
const red = run(copy);

writeFileSync(targetPath, readFileSync(targetPath, "utf8").slice(0, -line.length));
const restored = sha(targetPath);
const green = run(copy);

const violations = red.out
  .split("\n")
  .filter((l) => l.includes("link-missing:") || l.includes("  - ") || l.includes("violation"));
const redTail = red.out.trim().split("\n").filter((l) => l.startsWith("[verify-docs-parity]")).join(" | ");

const result = {
  at: new Date().toISOString(),
  copyRoot: copy,
  nonGitCopy: baseline.out.includes("pairs="),
  copiedFiles: copied,
  skippedSpecial,
  target,
  injection: { line: line.trim(), dead, dead2 },
  hashes: { copyTargetBefore: before, copyTargetAfterInjection: after, copyTargetAfterRestore: restored },
  baseline: { exit: baseline.exit, tail: baselineTail },
  red: { exit: red.exit, gateLines: redTail, violationLines: violations.slice(0, 12) },
  green: { exit: green.exit, tail: green.out.trim().split("\n").at(-1) ?? "" },
  claims: {
    baselineGreen: baseline.exit === 0 && baselineTail.includes("PASS"),
    redFails: red.exit === 1,
    redNamesSourceAndTarget: red.out.includes(`link-missing:${target}:${dead}`) && red.out.includes(`link-missing:${target}:${dead2}`),
    redNamesLines: red.out.includes(`${target}:`) && /:\d+(:| )/.test(red.out.split("link-missing:")[1] ?? ""),
    greenAfterRestore: green.exit === 0 && (green.out.trim().split("\n").at(-1) ?? "").includes("PASS"),
    copyByteIdenticalAfterRestore: before === restored,
  },
};
console.log(JSON.stringify(result, null, 2));
