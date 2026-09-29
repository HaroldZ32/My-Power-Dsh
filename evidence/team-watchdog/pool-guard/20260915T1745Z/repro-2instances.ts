// t58 addendum — BOTH recorded instances (t55→Researcher, t57→Architect), plus the control
// that a WRITE-capable member still receives the task (so the miss is not "no one can run it").
import { nextCapableTask } from "/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib/scheduler.js"
import { readFileSync } from "node:fs"

const team = JSON.parse(readFileSync("/root/dshProj/my-power-dsh/.mpd/team/mpd-default/team.json", "utf8"))
const rec = (n) => (team.members ?? []).find((m) => m.name === n)
const READONLY_DENY = ["write", "edit", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename"]
const pooled = (id) => ({ id, kind: "implementation", status: "pending", subject: "unassigned pooled implementation", dependencies: [] })

const run = (member, tasks) => {
  const withheld = []
  const picked = nextCapableTask(tasks, member, (blocked, gap, explicit) => withheld.push({ id: blocked.id, gap, explicit }))
  return { member: member.name, memberKeys: Object.keys(member).join(","), toolDeny: member.toolDeny ?? null, picked: picked?.id ?? null, withheld }
}

const out = {
  recordedInstances: [
    { id: "t55", observed: "pool → Researcher (read-only), attempt 1; revoked to Deep Worker", measured: run(rec("Researcher"), [pooled("t55")]) },
    { id: "t57", observed: "pool → Architect (read-only), attempt 1; revoked to Junior Engineer", measured: run(rec("Architect"), [pooled("t57")]) },
  ],
  controls: {
    profileShapedReadOnly_withheld: run({ name: "Researcher", toolDeny: READONLY_DENY }, [pooled("t55")]),
    writeCapableMember_receives: run({ name: "Deep Worker", toolDeny: [] }, [pooled("t55")]),
  },
}
out.verdict = out.recordedInstances.every((e) => e.measured.picked !== null)
  ? "BOTH RECORDED INSTANCES REPRODUCE: each live team record yields the pooled implementation task to the read-only member (toolDeny absent → empty deny set), while the profile-shaped read-only shape is withheld and a write-capable member receives it — so the task was never short of a capable recipient."
  : "not reproduced for every instance — inspect above"
console.log(JSON.stringify(out, null, 1))
