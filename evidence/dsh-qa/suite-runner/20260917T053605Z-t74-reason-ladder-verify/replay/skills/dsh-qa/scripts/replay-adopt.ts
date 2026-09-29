// t74 INDEPENDENT replay (docs-gate-engineer): re-emit the RECORDED c13 failure log byte-for-byte and exit 1,
// so the runner must classify THE RECORDED BYTES — not a fresh live run (agent-teams-adopt is green today).
import { readFileSync } from "node:fs"
process.stdout.write(readFileSync("/root/dshProj/my-power-dsh/evidence/dsh-qa/full-sweep/t26-attempt7/c13-agent-teams-adopt/lanes/agent-teams-adopt.log", "utf8"))
process.exit(1)
