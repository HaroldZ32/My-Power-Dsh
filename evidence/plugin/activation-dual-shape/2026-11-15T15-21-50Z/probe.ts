// LOCAL PROBE (no Docker): does OUR adapter's activation spec resolve inside the REAL installed
// `SubagentRuntime.startActivation` on BOTH harness generations?
//
// METHOD. `createDshAdapter` is the REAL adapter source (not a copy of its logic). The `subagents`
// service is a double whose ONLY stubbed halves are the fields the runtime reads before dispatch
// (`config`, `ctx.get("agents")`, `expectProvider`, `requireManager`, `assertCapabilities`,
// `assertProviderCurrent`); its `startActivation` is the INSTALLED implementation, invoked with the
// double as `this`. So the shape read that broke rc.2/rc.3 (`spec.parent.id`) and its rc.1
// counterpart (`spec.request.maxDepth`) execute for real — only provider dispatch is stubbed, at
// the boundary immediately AFTER that read.
//
// The probe also drives the two one-generation spellings straight into the same installed runtime
// as NEGATIVE CONTROLS, so a runtime that stopped discriminating could not make the arms vacuous.
// Exit 0 = every expectation below held:
//   * both generations: the three adapter raise paths RESOLVE and reach the manager exactly once;
//   * rc.1 resolves the nested-only control and REFUSES the flat-only one (`reading 'maxDepth'`);
//   * rc.3 resolves the flat-only control and REFUSES the nested-only one (`reading 'id'`).
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { createDshAdapter } from "../../../../packages/mpd-dsh-adapter-plugin/src/index.ts"

/** One installed harness tree the probe drives. */
interface HarnessTarget {
  /** The harness version label this tree carries. */
  readonly label: string
  /** The installed `@deepseek-ai/dsh` package root (its `package.json` names the version). */
  readonly dshRoot: string
}

/** The installed trees: rc.1 is the ambient global install, rc.3 the release anchor. */
const TARGETS: readonly HarnessTarget[] = [
  { label: "0.2.2-rc.1", dshRoot: "/home/haroldzhao/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh" },
  { label: "0.2.2-rc.3", dshRoot: "/home/haroldzhao/qa-anchors/rc3-t3-20261115T124238Z/host-rc3/lib/node_modules/@deepseek-ai/dsh" },
]

/** Lowercase hex SHA-256 of one installed module's bytes, so the run is pinned to exact code. */
function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

/** The `@deepseek-ai/dsh` version a tree declares, read from its own manifest. */
function versionOf(dshRoot: string): string {
  return JSON.parse(readFileSync(dshRoot + "/package.json", "utf8")).version as string
}

/** Run every arm against ONE installed harness and return its records. */
async function probeHarness(target: HarnessTarget): Promise<Record<string, unknown>> {
  /** The installed subagent runtime module. */
  const modulePath = target.dshRoot + "/node_modules/@deepseek-ai/dsh-subagent/lib/index.js"
  /** Its exports; `SubagentRuntime` is the class under test. */
  const module = await import(modulePath)
  /** The installed runtime class. */
  const Runtime = module.SubagentRuntime ?? module.default
  /** The exact live parent the host's own precondition reads (`agents.get(parent.id) === parent`). */
  const liveParent = { id: "live-parent", session: { id: "live-parent" } }
  /** The manager calls of the CURRENT arm, cleared per arm. */
  const managerCalls: unknown[][] = []
  /** The spec the ADAPTER built for the current arm, captured by the wrapper. */
  let builtSpec: Record<string, unknown> | null = null
  /** The arm name the wrapper stamps onto the captured spec. */
  let arm = "unset"
  /** The service double: real `startActivation`, stubbed everything the runtime reads. */
  const subagents: Record<string, unknown> = {
    config: { maxDepth: { get: () => 1 }, maxActiveSubagents: { get: () => 8 } },
    ctx: { get: (name: string) => (name === "agents" ? { get: (id: string) => (id === liveParent.id ? liveParent : undefined) } : undefined) },
    expectProvider: () => ({ name: "spawn", capabilities: { agentOptions: true, depthLimit: true }, prepareContinuable: () => {} }),
    assertCapabilities: () => {},
    requireManager: () => ({
      startLocal: (spec: Record<string, unknown>) => { managerCalls.push(["startLocal", Object.keys(spec)]); return { childId: "stub-child" } },
      startExternal: (spec: Record<string, unknown>) => { managerCalls.push(["startExternal", Object.keys(spec)]); return { childId: "stub-child" } },
    }),
    assertProviderCurrent: () => {},
    list: () => ["spawn"],
  }
  subagents.startActivation = function (this: unknown, spec: Record<string, unknown>): Promise<unknown> {
    builtSpec = {
      arm,
      keys: Object.keys(spec),
      flatParent: (spec.parent as { id?: string } | undefined)?.id ?? null,
      mirrorParent: ((spec.request as { parent?: { id?: string } } | undefined)?.parent)?.id ?? null,
      delivery: spec.delivery ?? null,
    }
    return Runtime.prototype.startActivation.call(this, spec)
  }
  /** OUR adapter over that double — the real construction path, not a hand-built spec. */
  const dsh = createDshAdapter({ get: (name: string) => (name === "subagents" ? subagents : undefined) } as never)
  /** One record per arm. */
  const records: Array<Record<string, unknown>> = []
  /** Drive one adapter arm, recording its outcome and the spec the adapter built. */
  const runArm = async (name: string, drive: () => Promise<unknown>): Promise<void> => {
    arm = name
    managerCalls.length = 0
    builtSpec = null
    try {
      await drive()
      records.push({ arm: name, outcome: "RESOLVED", managerCalls: [...managerCalls], spec: builtSpec })
    } catch (error) {
      records.push({ arm: name, outcome: "THREW", errorName: (error as Error)?.name, message: (error as Error)?.message, managerCalls: [...managerCalls], spec: builtSpec })
    }
  }
  // 1. THE TEAM RAISE: `agent_teams_plan approve` / `add_member` → nativeTeamExecutor.spawn.
  await runArm("adapter.teamExecutor.spawn", () => dsh.teamExecutor().spawn(liveParent, {
    teamId: "team-probe", memberId: "M1", name: "reviewer-1", description: "the reviewer",
    prompt: "check the mount", agentOptions: { model: "deepseek-chat" },
  }))
  // 2. THE ONE-SHOT CONSULT: mpd_role_spawn / mpd_workmate_spawn → spawnAgentAsync → spawnAgent.
  await runArm("adapter.spawnAgent", () => dsh.spawnAgent({ label: "probe-consult", prompt: "report", parent: liveParent }))
  // 3. THE CELLWORK RESEED: startContinuableAgent, handed the DUAL spec protocol-core now builds.
  await runArm("adapter.startContinuableAgent(cellwork reseed shape)", () => dsh.startContinuableAgent({
    provider: "spawn",
    label: "worker · team-probe",
    prompt: [{ type: "text", text: "resume B" }],
    parent: liveParent,
    maxDepth: 1,
    request: { prompt: [{ type: "text", text: "resume B" }], parent: liveParent, maxDepth: 1 },
    signal: new AbortController().signal,
  }))
  // 4. NEGATIVE CONTROLS: each one-generation spelling, straight into the installed runtime.
  /** The prompt blocks every control uses. */
  const prompt = [{ type: "text", text: "x" }]
  /** The two one-generation specs the old adapter shapes produced. */
  const controls: ReadonlyArray<{ name: string; spec: Record<string, unknown> }> = [
    { name: "control.nested-only(rc.1 shape)", spec: { provider: "spawn", label: "nested-only", request: { prompt, parent: liveParent, agentOptions: { model: "deepseek-chat" }, maxDepth: 1 }, signal: new AbortController().signal, delivery: "parent" } },
    { name: "control.flat-only(rc.2+ shape)", spec: { provider: "spawn", label: "flat-only", prompt, parent: liveParent, agentOptions: { model: "deepseek-chat" }, maxDepth: 1, signal: new AbortController().signal, delivery: "parent" } },
  ]
  for (const control of controls) {
    managerCalls.length = 0
    try {
      await Runtime.prototype.startActivation.call(subagents, control.spec)
      records.push({ arm: control.name, outcome: "RESOLVED", managerCalls: [...managerCalls] })
    } catch (error) {
      records.push({ arm: control.name, outcome: "THREW", errorName: (error as Error)?.name, message: (error as Error)?.message, managerCalls: [...managerCalls] })
    }
  }
  return { label: target.label, version: versionOf(target.dshRoot), modulePath, moduleSha256: sha256(modulePath), records }
}

/** Read one arm's record, so the expectations below are total rather than index arithmetic. */
function armOf(result: Record<string, unknown>, name: string): Record<string, unknown> {
  /** The records array every result carries. */
  const records = result.records as Array<Record<string, unknown>>
  /** The matching record, or a loud failure instead of an undefined read. */
  const found = records.find((record) => record.arm === name)
  if (found === undefined) throw new Error(`probe arm missing: ${String(result.label)} ${name}`)
  return found
}

/** Every expectation the probe asserts; a violation exits 1. */
const failures: string[] = []
/** One result per installed harness. */
const results: Array<Record<string, unknown>> = []
for (const target of TARGETS) results.push(await probeHarness(target))

for (const result of results) {
  /** The version label this tree claims, which selects the negative-control expectation. */
  const version = result.version as string
  console.log(`[harness ${version}] ${String(result.moduleSha256).slice(0, 16)}… ${String(result.modulePath)}`)
  for (const record of result.records as Array<Record<string, unknown>>) {
    console.log(`  ${record.outcome === "RESOLVED" ? "RESOLVED" : "THREW   "} ${String(record.arm)}${record.outcome === "THREW" ? " — " + String(record.message) : ""}`)
    const spec = record.spec as Record<string, unknown> | undefined
    if (spec !== undefined) console.log(`           spec keys: ${(spec.keys as string[]).join(",")} · flatParent=${String(spec.flatParent)} · mirrorParent=${String(spec.mirrorParent)} · delivery=${String(spec.delivery)}`)
  }
  // EVERY adapter path must resolve on BOTH generations; the manager must be reached exactly once.
  for (const name of ["adapter.teamExecutor.spawn", "adapter.spawnAgent", "adapter.startContinuableAgent(cellwork reseed shape)"]) {
    const record = armOf(result, name)
    if (record.outcome !== "RESOLVED") failures.push(`${version} ${name}: ${String(record.message)}`)
    else if ((record.managerCalls as unknown[]).length !== 1) failures.push(`${version} ${name}: manager reached ${String((record.managerCalls as unknown[]).length)} times, want 1`)
    const spec = record.spec as Record<string, unknown>
    if (spec.flatParent !== "live-parent" || spec.mirrorParent !== "live-parent") failures.push(`${version} ${name}: parent not readable BOTH ways (flat=${String(spec.flatParent)}, mirror=${String(spec.mirrorParent)})`)
  }
  // The negative controls must keep discriminating on THIS generation.
  const nested = armOf(result, "control.nested-only(rc.1 shape)")
  const flat = armOf(result, "control.flat-only(rc.2+ shape)")
  if (version === "0.2.2-rc.1") {
    if (nested.outcome !== "RESOLVED") failures.push(`${version} nested control did not resolve: ${String(nested.message)}`)
    // The message is ENGINE-specific (V8: "Cannot read properties of undefined (reading
    // 'maxDepth')"; Bun's JSC: "undefined is not an object (evaluating 'spec.request.maxDepth')"),
    // so the assertion is on WHERE it dies — the rc.1 `spec.request.maxDepth` read — not on prose.
    if (flat.outcome !== "THREW" || !/maxDepth/.test(String(flat.message))) failures.push(`${version} flat control should throw at the request.maxDepth read, got ${String(flat.outcome)} ${String(flat.message)}`)
  } else {
    if (flat.outcome !== "RESOLVED") failures.push(`${version} flat control did not resolve: ${String(flat.message)}`)
    // Same engine caveat: the discriminator is the `spec.parent.id` read itself.
    if (nested.outcome !== "THREW" || !/(parent\.id|reading 'id')/.test(String(nested.message))) failures.push(`${version} nested control should throw at the spec.parent.id read, got ${String(nested.outcome)} ${String(nested.message)}`)
    if ((nested.managerCalls as unknown[]).length !== 0) failures.push(`${version} nested control reached the manager before failing`)
  }
}

/** The evidence record: every arm's observed outcome plus the verdict. */
const evidence = { probe: "adapter-dual-activation-spec", generatedAt: new Date().toISOString(), ok: failures.length === 0, failures, results }
writeFileSync(new URL("./result.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n")
console.log(failures.length === 0 ? "PROBE PASS — the dual-shape spec resolves on BOTH installed generations, and each one-generation control still fails on the other." : `PROBE FAIL — ${failures.join(" | ")}`)
process.exitCode = failures.length === 0 ? 0 : 1
