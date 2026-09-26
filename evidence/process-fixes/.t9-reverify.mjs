// t9 harness (read-only lane): re-verify the docs gate on the POST-repair revision. Everything here
// mutates a disposable COPY under /tmp — the shipped script and docs are never written.
import { readFileSync, readdirSync, lstatSync, mkdirSync, rmSync, symlinkSync, readlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd();
const tmp = "/tmp/t9-copy";
const copy = join(tmp, "tree");
const SKIP = new Set([".git", "node_modules", "evidence"]);
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
let copied = 0;
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const s = join(dir, e.name);
    const rel = relative(repo, s);
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      mkdirSync(join(copy, rel), { recursive: true });
      walk(s);
      continue;
    }
    const st = lstatSync(s);
    if (st.isFile()) {
      writeFileSync(join(copy, rel), readFileSync(s));
      copied += 1;
    } else if (st.isSymbolicLink()) symlinkSync(readlinkSync(s), join(copy, rel));
  }
};
walk(repo);

const target = join(copy, "docs/design.md");
const original = readFileSync(target, "utf8");
const run = () => {
  const r = spawnSync("node", ["scripts/verify-docs-parity.mjs", "--root", copy], { cwd: repo, encoding: "utf8" });
  return {
    exit: r.status,
    summary: r.stdout.split("\n").filter((l) => l.startsWith("[verify-docs-parity]")).join(" | "),
    viol: r.stdout.split("\n").filter((l) => l.includes("link-missing:")).slice(0, 2),
  };
};
const probe = (label, md) => {
  writeFileSync(target, original + md);
  const r = run();
  writeFileSync(target, original);
  return { label, injected: md.trim(), ...r };
};

const results = [
  probe("P0 baseline copy (no injection)", "\n"),
  probe("P1a root-relative target that EXISTS (file)", "\nt9-probe: [x](/docs/index.md)\n"),
  probe("P1b root-relative target that EXISTS (directory)", "\nt9-probe: [x](/docs)\n"),
  probe("P1c root-relative target that DOES NOT exist", "\nt9-probe: [x](/nowhere/absent.md)\n"),
  probe("P2 dead RELATIVE link (regression control from t5)", "\nt9-probe: [x](./t9-injected-dead-link.md)\n"),
  probe("P3 fragment stripped / never validated (t5-F2 bound)", "\nt9-probe: [x](./index.md#no-such-anchor)\n"),
  probe("P4 fragment on a MISSING file still reddens", "\nt9-probe: [x](./no-such-file.md#x)\n"),
  probe("P5 double-slash root-relative edge case", "\nt9-probe: [x](//docs/index.md)\n"),
  { label: "P6 restore control", injected: "(none)", ...run() },
];

rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify({ at: new Date().toISOString(), copyRoot: copy, copiedFiles: copied, results }, null, 2));
