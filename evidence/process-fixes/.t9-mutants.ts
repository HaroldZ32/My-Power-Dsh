// t9 falsifiability harness: mutants on COPIES of the post-repair gate script, to show the NEW
// ROOT-RELATIVE arm is falsifiable and that the classes t5 proved did not silently lose their guards.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd();
const dir = "/tmp/t9-mutants";
const pristine = readFileSync(join(repo, "scripts/verify-docs-parity.mjs"), "utf8");

const MUTANTS = [
  {
    name: "root-relative-normalization-off",
    note: "base ternary disabled — a `/`-prefixed target is resolved from the linking file's dir again (the t5-F1 defect)",
    from: "      const base = rootRelative ? root : dirname(rel);",
    to: "      const base = false ? root : dirname(rel);",
    expectRed: "links ROOT-RELATIVE:",
  },
  {
    name: "root-relative-slash-not-stripped",
    note: "leading slash kept, so the normalized target still escapes the repo root",
    from: "      const cleaned = rootRelative ? filePart.replace(/^\\/+/, \"\") : filePart;",
    to: "      const cleaned = filePart;",
    expectRed: "links ROOT-RELATIVE:",
  },
  {
    name: "violation-not-emitted",
    note: "class-level regression control: the FAIL finding is never pushed (silent-pass shape)",
    from: "      violations.push({\n        id: `link-missing:${rel}:${target}`,",
    to: "      const __sink = ({\n        id: `link-missing:${rel}:${target}`,",
    alsoFix: "        detail: `${rel}:${line} links \"${target}\" but neither a file nor a directory exists at ${abs} — this gate resolves relative link TARGETS (two rounds of dead links to the retired docs/architecture.md passed it green BEFORE this row); fix the link or retire the target in the same change`,\n      });",
    alsoFixTo: "        detail: `${rel}:${line} links \"${target}\" but neither a file nor a directory exists at ${abs} — this gate resolves relative link TARGETS (two rounds of dead links to the retired docs/architecture.md passed it green BEFORE this row); fix the link or retire the target in the same change`,\n      }); void __sink;",
    expectRed: "links NEGATIVE:",
  },
  {
    name: "packed-note-suppressed",
    note: "class-level regression control: packed mode fails instead of noting (T-75 bound)",
    from: "      if (packedCopy) {\n        counters.absentSite += 1;",
    to: "      if (false) {\n        counters.absentSite += 1;",
    expectRed: "links PACKED:",
  },
  {
    name: "provenance-skip-dropped",
    note: "class-level regression control: the EXEMPT_PROVENANCE skip removed",
    from: "      if (EXEMPT_PROVENANCE.has(rel)) {",
    to: "      if (false) {",
    expectRed: "links PROVENANCE:",
  },
  {
    name: "dead-counter-lies",
    note: "class-level regression control: the dead counter stops incrementing",
    from: "      counters.dead += 1;",
    to: "      counters.dead += 0;",
    expectRed: "links NEGATIVE:",
  },
];

const runSelfTest = (file) => {
  const r = spawnSync("node", [file, "--self-test"], { encoding: "utf8", cwd: repo });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const arms = [...out.matchAll(/^(ok|FAIL)\s+([^—]+)—/gm)].map((m) => ({ status: m[1], name: m[2].trim() }));
  return {
    exit: r.status,
    summary: (out.split("\n").find((l) => l.includes("self-test]")) ?? "(no summary)").trim(),
    totalArms: arms.length,
    redArms: arms.filter((a) => a.status === "FAIL").map((a) => a.name),
  };
};

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const controlFile = join(dir, "control.mjs");
writeFileSync(controlFile, pristine);
const control = runSelfTest(controlFile);

const results = [];
for (const m of MUTANTS) {
  if (!pristine.includes(m.from)) {
    results.push({ name: m.name, applied: false, reason: "primary anchor not found" });
    continue;
  }
  let text = pristine.replace(m.from, m.to);
  if (m.alsoFix) {
    if (!text.includes(m.alsoFix)) {
      results.push({ name: m.name, applied: false, reason: "secondary anchor not found" });
      continue;
    }
    text = text.replace(m.alsoFix, m.alsoFixTo);
  }
  const file = join(dir, `${m.name}.mjs`);
  writeFileSync(file, text);
  const run = runSelfTest(file);
  results.push({
    name: m.name,
    note: m.note,
    applied: true,
    mutantExit: run.exit,
    summary: run.summary,
    totalArmsReported: run.totalArms,
    expectedArmRed: m.expectRed,
    expectedArmIsRed: run.redArms.some((a) => a.startsWith(m.expectRed)),
    allRedArms: run.redArms,
  });
}

console.log(JSON.stringify({ at: new Date().toISOString(), control, results }, null, 2));
