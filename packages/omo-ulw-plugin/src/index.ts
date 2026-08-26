// B3 omo-ulw-plugin: ulw-loop discipline on the DSH subagent seam.
// Each round spawns a FRESH child (provider "spawn") with a bounded handoff:
// plan -> execute -> verify -> structured report {status: continue|complete|blocked, ...}.
// State persisted to .omo-dsh/ulw/<id>.json; provider/model resolved via omo-modelchain (or defaults).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

export const name = "omo-ulw"
export const inject = ["tools", "subagents"]

type Ctx = { tools: any; subagents: any; get?: (k: string) => any; [k: string]: any }
type Config = { maxRounds?: number; provider?: string; model?: string; stateDir?: string }

const REPORT_SCHEMA = {
  type: "object",
  properties: { status: { type: "string", enum: ["continue", "complete", "blocked"] }, summary: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, nextSteps: { type: "array", items: { type: "string" } }, blocker: { type: "string" } },
  required: ["status", "summary", "evidence", "nextSteps", "blocker"],
  additionalProperties: false
}

function textBlock(text: string): any { return [{ type: "text", text }] }

export function apply(ctx: Ctx, config: Config = {}): void {
  const maxRounds = config.maxRounds ?? 3
  const provider = config.provider ?? "deepseek-official"
  const model = config.model ?? "deepseek-v4-flash"
  const cwd = process.env.DSH_WORKSPACE_ROOT ?? process.cwd()

  ctx.tools.register({
    name: "omo_ulw",
    description: "Run the ulw-loop discipline toward one objective: fresh child per round, plan->execute->verify inside each round, bounded structured handoff until complete/blocked/maxRounds.",
    parameters: { type: "object", properties: { objective: { type: "string" }, maxRounds: { type: "integer", description: "1..5, default 3" } }, required: ["objective"] },
    output: { schema: { type: "object", properties: { status: { type: "string" }, rounds: { type: "integer" }, finalReport: { type: "string" }, stateFile: { type: "string" } }, required: ["status", "rounds", "finalReport"] },
      render: (_a: unknown, v: any) => textBlock("omo_ulw status=" + v.status + " rounds=" + v.rounds + "\n" + v.finalReport + "\nstate: " + v.stateFile) },
    execute: async (args: any, exec: any) => {
      const id = "ulw-" + randomUUID().slice(0, 8)
      const rounds = Math.min(Math.max(Number(args?.maxRounds ?? maxRounds) || 1, 1), 5)
      const stateDir = join(cwd, ".omo-dsh", "ulw")
      mkdirSync(stateDir, { recursive: true })
      const stateFile = join(stateDir, id + ".json")
      const objective = String(args.objective)
      let previous: any = undefined
      let finalReport = ""
      let status = "continue"
      let used = 0

      for (let round = 1; round <= rounds; round++) {
        const prior = previous === undefined ? "(none — first round)" : JSON.stringify(previous)
        const prompt = "ULW round " + round + "/" + rounds + "\nObjective: " + objective + "\nPrevious handoff: " + prior + "\nDiscipline: 1) PLAN: explore with read-only tools, write the concrete plan; 2) EXECUTE: implement with tools, keep changes minimal; 3) VERIFY: re-run the checks and list evidence. End with ONLY the structured report (status=continue|complete|blocked). continue requires nextSteps; complete requires evidence and empty nextSteps; blocked requires a concrete blocker."
        const run = await ctx.subagents.start("spawn", {
          label: id + "-r" + round,
          prompt: textBlock(prompt),
          parent: exec.agent,
          signal: exec.signal,
          agentOptions: { provider, model },
          outputSchema: REPORT_SCHEMA
        })
        const res = await run.result
        const report = (res.structured ?? {}) as any
        used = round
        writeFileSync(stateFile, JSON.stringify({ id, objective, rounds, currentRound: round, report, updatedAt: new Date().toISOString() }, null, 2))
        previous = report
        finalReport = "round " + round + ": " + String(report?.summary ?? "no summary")
        if (report?.status === "complete") { status = "complete"; break }
        if (report?.status === "blocked") { status = "blocked"; finalReport += "\nblocked: " + String(report?.blocker ?? ""); break }
      }
      if (status === "continue") status = "max-rounds"
      return { status, rounds: used, finalReport, stateFile }
    }
  })
}
