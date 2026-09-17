// t73 REPLAY: re-emit the RECORDED c13 lane log byte-for-byte and exit 1, so the FIXED runner
// classifies the very bytes that produced the old label (`reason=unauthorized`, drawn from a
// webRoute step the evidence marks ok=true) instead of a fresh live run (which is green today).
import { readFileSync } from "node:fs"
process.stdout.write(readFileSync("/root/dshProj/my-power-dsh/evidence/dsh-qa/full-sweep/t26-attempt7/c13-agent-teams-adopt/lanes/agent-teams-adopt.log", "utf8"))
process.exit(1)
