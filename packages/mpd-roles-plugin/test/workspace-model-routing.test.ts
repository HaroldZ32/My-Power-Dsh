import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply as applyConfig } from "../../mpd-config-plugin/src/index.ts"
import type { DshToolDef, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index.ts"
import { apply as applyModelchain } from "../../mpd-modelchain-plugin/src/index.ts"
import { apply as applyWorkmate } from "../../mpd-workmate-plugin/src/index.ts"
import { apply as applyRoles } from "../src/index.ts"

test("roster, consult and workmate tools use the calling workspace after another session reloads", async () => {
  /** A disposable home and two workspaces share one mounted config service. */
  const box = mkdtempSync(join(tmpdir(), "mpd-workspace-models-"))
  /** Home is restored after the workmate library test. */
  const previousHome = process.env.HOME
  process.env.HOME = box
  /** Every row's registrations are released before removing the fixtures. */
  const dispose: (() => void)[] = []
  /** Distinct configurations for the same roster agent. */
  const roots = [join(box, "a"), join(box, "b")]
  /** Tool calls carry the real adapter's agent/session/header path. */
  const exec = roots.map((cwd, index) => ({ agent: { session: { id: `session-${index}`, header: { cwd } } }, signal: new AbortController().signal }))
  /** The host registry stores the actual plugin services. */
  const services = new Map<string, unknown>([["agents", { list: () => exec.map((call) => call.agent) }]])
  /** The adapter forwards the child's actual selected model here. */
  const spawned: Array<{ agentOptions?: { provider?: string; model?: string } }> = []
  /** Tool registrations from the real plugin entry points. */
  const tools = new Map<string, DshToolDef>()
  /** Host double keeps only the concrete seams the rows require. */
  const ctx = {
    tools: { register: (tool: DshToolDef) => { tools.set(tool.name, tool) } },
    subagents: {
      start: async (_kind: string, args: (typeof spawned)[number]) => {
        spawned.push(args)
        return { id: `child-${spawned.length}`, result: { structured: { summary: "done" }, stopReason: "complete" } }
      },
    },
    get: (name: string) => services.get(name),
    provide: (name: string, service: unknown) => { services.set(name, service) },
    effect: (register: () => unknown) => {
      /** Each registered watcher is scoped to this fixture. */
      const cleanup = register()
      if (typeof cleanup === "function") dispose.push(() => cleanup())
    },
  }
  /** Invoke a normal registered tool with an explicit calling agent. */
  const call = async (name: string, args: Record<string, unknown>, sender: DshToolExec): Promise<unknown> => {
    /** A missing registration is a fixture failure. */
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`Missing tool ${name}`)
    return tool.execute(args, sender)
  }
  try {
    for (const [index, root] of roots.entries()) {
      mkdirSync(join(root, ".mpd"), { recursive: true })
      writeFileSync(join(root, ".mpd", "mpd.jsonc"), JSON.stringify({ agentRoutes: {
        "Deep Worker": { provider: "test-gateway", model: `model-${index}` },
        ...(index === 0 ? { Researcher: { provider: "test-gateway", model: "research-a" } } : {}),
      } }))
    }
    applyConfig(ctx, { userFile: join(box, "absent-user.jsonc") })
    applyRoles(ctx)
    applyWorkmate(ctx)
    applyModelchain(ctx)
    await call("mpd_config_reload", {}, exec[1])
    expect(await call("mpd_modelchain_resolve", { role: "Deep Worker" }, exec[0])).toMatchObject({ model: "model-0" })
    expect(await call("mpd_modelchain_resolve", { role: "Deep Worker" }, exec[1])).toMatchObject({ model: "model-1" })
    await call("mpd_role_spawn", { role: "Deep Worker", task: "run A" }, exec[0])
    /** The async registration also bases its child on the initiating session. */
    const consult = await call("mpd_role_spawn_async", { role: "Deep Worker", task: "run B" }, exec[1])
    if (consult === null || typeof consult !== "object" || !("consultId" in consult)) throw new Error("Missing consult id")
    await call("mpd_role_consult", { action: "wait", consultId: consult.consultId, timeoutMs: 1000 }, exec[1])
    await call("mpd_role_consult", { action: "collect", consultId: consult.consultId }, exec[1])
    expect(await call("mpd_workmate_init", { base: "Deep Worker", name: "worker" }, exec[0])).toMatchObject({ model: "model-0" })
    await call("mpd_config_reload", {}, exec[1])
    await call("mpd_workmate_spawn", { name: "worker", task: "run A" }, exec[0])
    await call("mpd_workmate_spawn", { name: "worker", task: "run B" }, exec[1])
    await expect(call("mpd_role_spawn", { role: "Researcher", task: "cannot borrow A's route" }, exec[1])).rejects.toThrow(/AGENT_UNCONFIGURED/)
    expect(spawned.map((child) => child.agentOptions?.model)).toEqual(["model-0", "model-1", "model-0", "model-1"])
  } finally {
    for (const cleanup of dispose) cleanup()
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    rmSync(box, { recursive: true, force: true })
  }
})
