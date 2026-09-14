#!/usr/bin/env bun
// t17 INDEPENDENT verification of OPT-1 (failed dependency must not pin its
// dependent forever). Written by Lead (verifier), NOT by the implementer.
//
// It exercises the REAL plugin modules the claim path and the scheduler call:
//   - lib/state.js  -> unsatisfiedDependencies / dependencyStates / taskVisualState
//   - lib/tools.js  -> agent_teams_claim_task readiness call site (read, not stubbed)
//   - lib/scheduler.js -> nextReadyTask readiness call site (read, not stubbed)
//
// Falsifiable three-state model:
//   A completed  => B ready          (positive control)
//   A pending    => B blocked         (negative control: the predicate CAN block)
//   A failed     => B claimable       (OPT-1)
//   A cancelled  => B claimable       (pre-existing deadlock rule, must not regress)
//   A failed -> retried -> completed  => B still ready, dependency now satisfied
// and the VIEW surfaces: agent_teams_task_contract carries `failed_dependencies`;
// the snapshot/status view (`taskVisualState`) is asserted separately and its
// result recorded verbatim (it is NOT force-passed).
import { unsatisfiedDependencies, dependencyStates, taskVisualState } from "/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib/state.js";

const results = [];
function check(id, ok, detail) {
  results.push({ id, ok: !!ok, detail });
  console.log((ok ? "PASS " : "FAIL ") + id + " :: " + detail);
}

const mk = (id, status, dependencies = []) => ({ id, status, dependencies, subject: id });

// 1. A failed => B claimable (OPT-1 core).
{
  const tasks = [mk("A", "failed"), mk("B", "pending", ["A"])];
  const blocking = unsatisfiedDependencies(tasks, ["A"]);
  const failed = dependencyStates(tasks, ["A"]).failed;
  check("opt1-failed-dep-not-blocking", blocking.length === 0, `blocking=${JSON.stringify(blocking)}`);
  check("opt1-failed-dep-surfaced", failed.length === 1 && failed[0] === "A", `failed=${JSON.stringify(failed)}`);
}
// 2. Positive control: A completed => B ready.
{
  const tasks = [mk("A", "completed"), mk("B", "pending", ["A"])];
  const blocking = unsatisfiedDependencies(tasks, ["A"]);
  check("control-completed-dep-ready", blocking.length === 0, `blocking=${JSON.stringify(blocking)}`);
}
// 3. Negative control: A still pending => B MUST stay blocked (predicate can fail).
{
  const tasks = [mk("A", "pending"), mk("B", "pending", ["A"])];
  const blocking = unsatisfiedDependencies(tasks, ["A"]);
  check("control-pending-dep-blocks", blocking.length === 1 && blocking[0] === "A", `blocking=${JSON.stringify(blocking)}`);
}
// 4. A claimed/in_progress still blocks (only terminal failure releases).
for (const st of ["claimed", "in_progress"]) {
  const tasks = [mk("A", st), mk("B", "pending", ["A"])];
  const blocking = unsatisfiedDependencies(tasks, ["A"]);
  check("control-" + st + "-dep-blocks", blocking.length === 1, `blocking=${JSON.stringify(blocking)}`);
}
// 5. Cancelled dependency non-blocking rule preserved.
{
  const tasks = [mk("A", "cancelled"), mk("B", "pending", ["A"])];
  const blocking = unsatisfiedDependencies(tasks, ["A"]);
  check("cancelled-dep-not-blocking", blocking.length === 0, `blocking=${JSON.stringify(blocking)}`);
}
// 6. Mixed: failed + pending dependency => only the pending one blocks.
{
  const tasks = [mk("A", "failed"), mk("C", "pending"), mk("B", "pending", ["A", "C"])];
  const blocking = unsatisfiedDependencies(tasks, ["A", "C"]);
  check("mixed-dep-blocks-only-pending", blocking.length === 1 && blocking[0] === "C", `blocking=${JSON.stringify(blocking)}`);
}
// 7. Retry path: A failed => B claimable; while A is retried (claimed/in_progress)
//    B must block again (its input is being recomputed); A completed => B ready.
{
  const seen = [];
  const expect = { failed: "[]", claimed: '["A"]', in_progress: '["A"]', completed: "[]" };
  let ok = true;
  for (const st of ["failed", "claimed", "in_progress", "completed"]) {
    const tasks = [mk("A", st), mk("B", "pending", ["A"])];
    const got = JSON.stringify(unsatisfiedDependencies(tasks, ["A"]));
    seen.push(st + ":" + got);
    if (got !== expect[st]) ok = false;
  }
  check("retry-lifecycle-semantics", ok, seen.join(" "));
}
// 8. Unknown dependency id still blocks (never silently releases).
{
  const tasks = [mk("B", "pending", ["A"])];
  const blocking = unsatisfiedDependencies(tasks, ["A"]);
  check("unknown-dep-blocks", blocking.length === 1, `blocking=${JSON.stringify(blocking)}`);
}
// 9. VIEW: snapshot/status view (taskVisualState) verbatim — recorded, not forced.
{
  const tasks = [mk("A", "failed"), mk("B", "pending", ["A"])];
  const visual = taskVisualState("pending", ["A"], tasks);
  const contractViewSource = await Bun.file("/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib/tools.js").text();
  const contractCarriesFailed = /failed_dependencies: dependencyStates\(/.test(contractViewSource);
  check("view-contract-carries-failed-dependencies", contractCarriesFailed, "agent_teams_task_contract -> failed_dependencies present");
  results.push({
    id: "view-snapshot-visual-state",
    ok: visual === "blocked" ? false : true,
    detail: `taskVisualState(pending,["A"],A=failed) = "${visual}" (snapshot/status + web panel surface); claimability says READY, this view says "${visual}"`,
  });
  console.log("INFO view-snapshot-visual-state :: " + JSON.stringify({ visual }));
}
// 10. Read the REAL call sites so the predicate assertions above are not academic.
{
  const tools = await Bun.file("/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib/tools.js").text();
  const sched = await Bun.file("/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib/scheduler.js").text();
  const claimUses = /const pending = unsatisfiedDependencies\(fresh\.tasks, task\.dependencies\)/.test(tools);
  const schedUses = /unsatisfiedDependencies\(\[\.\.\.tasks\], task\.dependencies\)\.length === 0/.test(sched);
  check("claim-path-uses-predicate", claimUses, "agent_teams_claim_task readiness uses unsatisfiedDependencies");
  check("scheduler-uses-predicate", schedUses, "scheduler.nextReadyTask uses unsatisfiedDependencies");
}

const failedIds = results.filter((r) => !r.ok).map((r) => r.id);
const core = results.filter((r) => !r.id.startsWith("view-snapshot"));
console.log(JSON.stringify({ coreAllOk: core.every((r) => r.ok), failedIds, results }, null, 2));
process.exit(0);
