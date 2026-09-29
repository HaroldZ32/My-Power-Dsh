// t58 standalone reproduction (Reviewer) — drives the REAL exported scheduler function,
// no tree edits. Two member shapes, same pooled implementation task.
import { nextCapableTask } from "/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib/scheduler.js"
import { readFileSync } from "node:fs"

const READONLY_DENY = ["write", "edit", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename"]

// the pooled task as observed: kind=implementation, NO assignee, kind present
const pooledImplementation = { id: "t55", kind: "implementation", status: "pending", subject: "pooled implementation task", dependencies: [] }

// shape A — the shape the REGRESSION TEST uses (profile-shaped member, toolDeny present)
const profileShaped = { name: "Researcher", toolDeny: READONLY_DENY }

// shape B — the shape PRODUCTION passes: the TEAM record member, read verbatim from the
// live team.json so this is the real field set, not a guess.
const team = JSON.parse(readFileSync("/root/dshProj/my-power-dsh/.mpd/team/mpd-default/team.json", "utf8"))
const teamRecord = (team.members ?? []).find((m) => /researcher/i.test(m.name ?? ""))

const run = (member) => {
  const withheld = []
  const picked = nextCapableTask([pooledImplementation], member, (blocked, gap, explicit) => withheld.push({ id: blocked.id, gap, explicit }))
  return { memberKeys: Object.keys(member).join(","), toolDeny: member.toolDeny ?? null, picked: picked?.id ?? null, withheld }
}

const out = {
  task: pooledImplementation,
  shapeA_profileShapedMember: run(profileShaped),
  shapeB_liveTeamRecordMember: run(teamRecord),
  verdict: null,
}
out.verdict =
  out.shapeA_profileShapedMember.picked === null && out.shapeB_liveTeamRecordMember.picked === "t55"
    ? "MISS REPRODUCED: the guard withholds the pooled implementation task ONLY when the member carries toolDeny; the live team record does not carry it, so the task is delivered to the read-only member."
    : "not reproduced — inspect the shapes above"
console.log(JSON.stringify(out, null, 1))
