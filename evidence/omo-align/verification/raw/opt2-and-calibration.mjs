#!/usr/bin/env bun
// t17 INDEPENDENT OPT-2 (residue reclamation + ordering) and gate-calibration probe.
// OPT-2: own sandbox workspace fixtures; the reclaimer is driven as a SUBPROCESS with
// --workspace, so the real repo state is never in scope. Ordering is proven by the
// two-sided boot case (a SIMPLE session yields zero teams even though the preset
// carries the sizing doctrine); here we only re-assert the pre-step call site.
// Calibration: quantifies the widened signal-C surface with adversarial SIMPLE prompts.
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateComplexityGate, consumeExplicitFlag } from "/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib/session-start.js";

const REPO = "/root/dshProj/my-power-dsh";
const out = { steps: {}, gateCalibration: [] };

// ---------- OPT-2 ----------
{
  const root = mkdtempSync(join(tmpdir(), "mpd-t17-opt2-"));
  const ws = join(root, "ws");
  const stateRoot = join(ws, ".mpd", "team");
  const base = (id, extra) => ({ id, name: "MPD Default", description: "", phase: "staged", tasks: [], members: [], profile: { name: "mpd" }, ...extra });
  const write = (id, extra) => {
    mkdirSync(join(stateRoot, id), { recursive: true });
    writeFileSync(join(stateRoot, id, "team.json"), JSON.stringify(base(id, extra), null, 2));
  };
  write("residue-a", {});
  write("residue-b", {});
  write("running", { phase: "running", approvedAt: Date.now(), tasks: [{ id: "t1", status: "pending", dependencies: [] }] });
  write("approved-staged", { approvedAt: Date.now() });
  write("staged-with-tasks", { tasks: [{ id: "t1", status: "pending", dependencies: [] }] });

  const runningBefore = readFileSync(join(stateRoot, "running", "team.json"), "utf8");
  const stagedTasksBefore = readFileSync(join(stateRoot, "staged-with-tasks", "team.json"), "utf8");
  const approvedBefore = readFileSync(join(stateRoot, "approved-staged", "team.json"), "utf8");

  // dry run first: nothing may change
  const dry = execFileSync(process.execPath, [join(REPO, "scripts", "reclaim-staged-teams.mjs"), "--workspace", ws], { encoding: "utf8" });
  const dryOk = existsSync(join(stateRoot, "residue-a", "team.json")) && existsSync(join(stateRoot, "residue-b", "team.json"));
  out.steps.dryRunChangesNothing = { ok: dryOk, summary: dry.trim().split("\n").pop() };

  const applied = execFileSync(process.execPath, [join(REPO, "scripts", "reclaim-staged-teams.mjs"), "--apply", "--workspace", ws], { encoding: "utf8" });
  const live = existsSync(stateRoot) ? readdirSync(stateRoot).sort() : [];
  out.steps.apply = {
    summary: applied.trim().split("\n").pop(),
    residueArchivedNotDeleted:
      !existsSync(join(stateRoot, "residue-a")) && !existsSync(join(stateRoot, "residue-b")) &&
      existsSync(join(stateRoot, "archive", "residue-a", "team.json")) && existsSync(join(stateRoot, "archive", "residue-b", "team.json")),
    runningProtectedByteIdentical: existsSync(join(stateRoot, "running", "team.json")) && readFileSync(join(stateRoot, "running", "team.json"), "utf8") === runningBefore,
    approvedStagedProtected: existsSync(join(stateRoot, "approved-staged", "team.json")) && readFileSync(join(stateRoot, "approved-staged", "team.json"), "utf8") === approvedBefore,
    stagedWithTasksProtected: existsSync(join(stateRoot, "staged-with-tasks", "team.json")) && readFileSync(join(stateRoot, "staged-with-tasks", "team.json"), "utf8") === stagedTasksBefore,
    liveDirAfter: live,
  };
}

// ---------- ordering (call site, symbol-addressed) ----------
{
  const src = readFileSync(join(REPO, "packages/mpd-agent-teams-plugin/lib/session-start.js"), "utf8");
  const preStep = src.includes("ctx.on('agent/pre-step'");
  const prependGlobal = /},\s*\{\s*global:\s*true,\s*prepend:\s*true\s*\}\)/.test(src);
  const routeCallInsideListener = src.indexOf("routeDecision(policy, user?.text, workspace)") > src.indexOf("ctx.on('agent/pre-step'");
  out.steps.ordering = {
    ok: preStep && prependGlobal && routeCallInsideListener,
    preStepListener: preStep,
    globalPrepend: prependGlobal,
    gateEvaluatedInListener: routeCallInsideListener,
  };
}

// ---------- gate calibration (adversarial SIMPLE prompts) ----------
{
  const prompts = [
    { label: "frozen-simple-1", prompt: "Reply with exactly: hello-ok" },
    { label: "frozen-simple-2", prompt: "What does the git-master skill do? Answer in one sentence." },
    { label: "frozen-simple-3", prompt: "Rename the variable `foo` to `bar` in src/util.ts and run its test." },
    { label: "adversarial-simple-list", prompt: "Check the test, build the package, verify the output." },
    { label: "adversarial-simple-cjk", prompt: "帮我检查代码，实现修复，验证结果。" },
    { label: "adversarial-simple-two", prompt: "Build the project and verify the artifact." },
    { label: "frozen-complex-1", prompt: "Align the bundle with upstream: audit the orchestration surface, then implement the routing change." },
    { label: "frozen-complex-2", prompt: "team: fix the flaky test" },
    { label: "frozen-complex-3", prompt: "1. Read the patch file\n2. Audit the gates\n3. Implement the change\n4. Verify the boot" },
  ];
  for (const p of prompts) {
    const consumed = consumeExplicitFlag(p.prompt);
    const v = evaluateComplexityGate(consumed.text, { explicitFlag: consumed.flagged, planArtifact: false });
    out.gateCalibration.push({ label: p.label, trigger: v.trigger, signals: v.signals, flagConsumed: consumed.flagged });
  }
  out.steps.calibration = {
    frozenSimpleAllQuiet: out.gateCalibration.filter((r) => r.label.startsWith("frozen-simple")).every((r) => !r.trigger),
    frozenComplexAllTrigger: out.gateCalibration.filter((r) => r.label.startsWith("frozen-complex")).every((r) => r.trigger),
    adversarialSimpleTriggers: out.gateCalibration.filter((r) => r.label.startsWith("adversarial")).filter((r) => r.trigger).map((r) => r.label),
  };
}

writeFileSync("/root/dshProj/my-power-dsh/evidence/omo-align/verification/raw/opt2-and-calibration.result.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ steps: out.steps, gateCalibration: out.gateCalibration }, null, 1));
