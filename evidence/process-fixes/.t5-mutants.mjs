// t5 falsifiability harness: mutate COPIES of scripts/verify-docs-parity.mjs in /tmp/t5-mutants and show
// that the mandatory NEGATIVE arm (and its siblings) FAIL when the specific property each one claims to
// guard is broken. A control that cannot go red is not a control. No shipped file is written.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repo = "/root/dshProj/my-power-dsh";
const dir = "/tmp/t5-mutants";
const src = join(repo, "scripts/verify-docs-parity.mjs");
const pristine = readFileSync(src, "utf8");

const MUTANTS = [
  {
    name: "whole-checker-dormant",
    note: "the link check never runs (the shape of a scanner that was never wired in)",
    from: "  const links = checkLinkTargets(root, linkBand(root, pairs, exemptNotes));",
    to: "  const links = { violations: [], notes: [], counters: { files: 0, links: 0, checked: 0, resolved: 0, dead: 0, skippedProvenance: 0, absentSite: 0, external: 0, anchorOnly: 0 } };",
    expectFail: "links NEGATIVE:",
  },
  {
    name: "violation-not-emitted",
    note: "resolution and counters intact, but the FAIL finding is never pushed (silent pass)",
    from: "      violations.push({\n        id: `link-missing:${rel}:${target}`,",
    to: "      const __sink = ({\n        id: `link-missing:${rel}:${target}`,",
    expectFail: "links NEGATIVE:",
    alsoFix: "        detail: `${rel}:${line} links \"${target}\" but neither a file nor a directory exists at ${abs} — this gate resolves relative link TARGETS (two rounds of dead links to the retired docs/architecture.md passed it green BEFORE this row); fix the link or retire the target in the same change`,\n      });",
    alsoFixTo: "        detail: `${rel}:${line} links \"${target}\" but neither a file nor a directory exists at ${abs} — this gate resolves relative link TARGETS (two rounds of dead links to the retired docs/architecture.md passed it green BEFORE this row); fix the link or retire the target in the same change`,\n      }); void __sink;",
  },
  {
    name: "dead-counter-lies",
    note: "the failure IS emitted but the `dead` counter stays 0 (the counter clause of the arm)",
    from: "      counters.dead += 1;",
    to: "      counters.dead += 0;",
    expectFail: "links NEGATIVE:",
  },
  {
    name: "packed-note-suppressed",
    note: "packed mode fails instead of noting (the T-75 bound)",
    from: "      if (packedCopy) {\n        counters.absentSite += 1;",
    to: "      if (false) {\n        counters.absentSite += 1;",
    expectFail: "links PACKED:",
  },
  {
    name: "provenance-skip-dropped",
    note: "the EXEMPT_PROVENANCE skip is removed (the verbatim README would then redden)",
    from: "      if (EXEMPT_PROVENANCE.has(rel)) {",
    to: "      if (false) {",
    expectFail: "links PROVENANCE:",
  },
];

const runSelfTest = (file) => {
  const r = spawnSync("node", [file, "--self-test"], { encoding: "utf8", cwd: repo });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const summary = out.split("\n").find((l) => l.includes("self-test]")) ?? "(no summary line)";
  const failed = [...out.matchAll(/^FAIL (.*)$/gm)].map((m) => m[1]);
  const failedCases = [...out.matchAll(/^(?:FAIL|not ok|✗)\s*(.*)$/gm)].map((m) => m[1]);
  const arms = [...out.matchAll(/^(ok|FAIL)\s+([^—]+)—/gm)].map((m) => ({ status: m[1], name: m[2].trim() }));
  return { exit: r.status, summary: summary.trim(), failedLines: failed.slice(0, 8), failedCases: failedCases.slice(0, 8), arms };
};

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const control = join(dir, "control.mjs");
writeFileSync(control, pristine);
const controlRun = runSelfTest(control);

const results = [];
for (const m of MUTANTS) {
  if (!pristine.includes(m.from)) {
    results.push({ name: m.name, applied: false, reason: `anchor not found: ${m.from.slice(0, 60)}…` });
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
  const arm = run.arms.find((a) => a.name.startsWith(m.expectFail));
  results.push({
    name: m.name,
    note: m.note,
    applied: true,
    mutantExit: run.exit,
    summary: run.summary,
    expectedArm: m.expectFail,
    expectedArmStatus: arm?.status ?? "ARM-NOT-FOUND",
    redArms: run.arms.filter((a) => a.status === "FAIL").map((a) => a.name),
    control: m.name === MUTANTS[0].name ? undefined : undefined,
  });
}

console.log(JSON.stringify({ at: new Date().toISOString(), controlExit: controlRun.exit, controlSummary: controlRun.summary, controlGreenArms: controlRun.arms.filter((a) => a.status === "ok").length, results }, null, 2));
