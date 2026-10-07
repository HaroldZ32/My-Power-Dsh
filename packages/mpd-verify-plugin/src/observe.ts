// THE OBSERVATION LOG, the in-memory runtime, and the DELEGATION auto-arm.
//
// WHY AN OBSERVATION LOG AT ALL. The envelope in `law.ts` is defence in depth, not proof: it can only
// judge the calls the harness routes through it, and it says nothing about what happened before the
// plugin was loaded. Blindness is therefore established from the plugin's OWN record of what it saw —
// `guardTool` is consulted before every dispatch, so a verifier whose session never triggered a
// code-path read in that log is demonstrably blind, and one that did is `unproven` rather than `blind`.
//
// THE SECOND JOB: ARMING. In a solo session the captain arms a loop explicitly (`mpd_verify_open`). In
// every delegated mode the captain instead CALLS a delegation tool, and the observer sees that call and
// records a `writer.kind: "delegate"` loop — which, by the guard's own rule, never authorises a captain
// write. That asymmetry is deliberate: delegation is what the law WANTS the captain to do, so it is
// recorded, but recording it must not become a way to write.
//
// STATE LIVES HERE AND NOWHERE ELSE. `bun build` INLINES imported modules, so a module-level singleton
// would exist once per BUNDLE (the verify row's copy and the roles row's copy would be different
// objects). The runtime is therefore published as the `mpdVerify` service and resolved per call.
import { join } from "node:path"
import type { DshAdapter, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import type { ArmedLoopView, VerifierSeatView } from "./law.ts"
import { GATED_WRITE_TOOLS, readTargetPath, classifyWriteTarget, resolvePositiveInt, resolveVerifyMode, sessionKeyOf, verifierEnvelopeDecision } from "./law.ts"
import { loopsDir, mintId, readLoops, readSeats, writeJsonAtomic } from "./ledger.ts"

/**
 * THE DELEGATION TOOLS. A call to one of these from the top-level agent is what arms a delegated loop.
 *
 * `spawn_teammate` and `team_task_*` are the official team verbs; `mpd_role_spawn`, `mpd_workmate_spawn`
 * and `mpd_ultrawork` are ours; `subagent`, `subagent_fork`, `workflow` and `ralph` are the harness's own
 * delegation surfaces. Every one of them hands work to another agent, which is the whole point.
 */
export const DELEGATION_TOOLS: readonly string[] = [
  "spawn_teammate", "team_task_create", "team_task_update",
  "mpd_role_spawn", "mpd_workmate_spawn", "mpd_ultrawork", "mpd_ulw",
  "subagent", "subagent_fork", "workflow", "ralph",
  "agent_teams_plan", "agent_teams_dispatch",
]

/** One observed tool call, as the log keeps it. */
export interface ObservedCall {
  /** The calling agent's session key. */
  sessionId: string
  /** The tool name. */
  toolName: string
  /** The classified target path, when the call named one. */
  path?: string
  /** True when the classified target was CODE. */
  code: boolean
  /** ISO instant the call was observed. */
  at: string
}

/** One implementation read the log observed for a session. */
interface ObservedImplementationRead {
  /** The workspace-relative path the call named. */
  path: string
  /**
   * True when the read was ADMITTED — the verifier's envelope did not deny it, or its caller is not a
   * bound seat at all. ONLY an admitted read spends a seat's blindness.
   */
  admitted: boolean
  /** ISO instant the call was observed. */
  at: string
}

/** One counted implementation read inside a diagnosis window. */
export interface CountedRead {
  /** The path that was read. */
  path: string
  /** How many times the window counted it. */
  count: number
}

/**
 * The law's process-local state, published as the `mpdVerify` service.
 *
 * Every method is TOTAL: it answers, never throws. A guard is on the hot path of every tool call in the
 * process, and a bookkeeping failure there would become an outage rather than a missing record.
 */
export interface VerifyRuntime {
  /** Record one guarded call (the guard calls this before it decides). */
  noteCall(exec: DshToolExec): void
  /** The session key of one agent, in the frozen `??` order. */
  keyOf(agent: unknown): string
  /**
   * True when the observation log shows this session was ADMITTED an implementation read.
   *
   * The boolean half of {@link VerifyRuntime.observedImplementationReads}, and the fact the record's
   * `blind` versus `unproven` basis is decided from — a REFUSED attempt is not a read, for the reason
   * stated there.
   */
  observedCodeRead(sessionId: string): boolean
  /**
   * The implementation paths this session's calls NAMED and the guard ADMITTED, deduped, in order.
   *
   * This is the FACT the record validator's `blind-spent` rule is judged from (captain's ruling,
   * 2026-10-07): a seat whose log lists no admitted implementation read may record a PASS even after a
   * FAIL unlocked its diagnosis window, and one whose log lists a read may not — and the refusal NAMES
   * it, which is why this accessor returns paths and not the boolean above.
   *
   * ONLY AN ADMITTED READ IS A READ, and that is a correctness requirement rather than a refinement:
   * while a seat is BLIND the envelope DENIES it every implementation path, and the acceptance arm for
   * the readable band REQUIRES a seat to demonstrate that refusal. If a refused ATTEMPT counted as a
   * read, then proving the band spends the basis, and no seat could ever be both demonstrably refused
   * the implementation and admitted for a PASS — the law would defeat itself.
   *
   * THE DECLARED BOUND: the log is PROCESS-LOCAL and in memory only (nothing under `.mpd/verify/`
   * persists observations), while `seats.json` does persist `unlocked`. A seat that read an
   * implementation in an EARLIER process therefore starts this one with a clean log and can record a
   * PASS. That bound is ACCEPTED, not hidden: the ruling is "judge from the observation log", and this
   * log is what a process can honestly attest to.
   */
  observedImplementationReads(sessionId: string): readonly string[]
  /** The number of escape uses this session still holds. */
  escapeUses(sessionId: string): number
  /** Grant escape uses (the counted escape's one effect on the guard). */
  grantEscape(sessionId: string, uses: number): void
  /** Consume one escape use, reporting whether one was available. */
  consumeEscape(sessionId: string): boolean
  /** Count one implementation read inside a diagnosis window. */
  countRead(sessionId: string, path: string): void
  /** Drain the counted reads for one session (used when its record is written). */
  drainReads(sessionId: string): CountedRead[]
  /** The armed loops of one workspace, read from disk so the guard sees a concurrent arming. */
  armedLoops(workspace: string): ArmedLoopView[]
  /** The verifier seat bound to one session, or `undefined`. */
  seatFor(workspace: string, sessionId: string): VerifierSeatView | undefined
  /** The delegation calls observed so far, newest last — the report a boot lane reads. */
  observedDelegations(): Array<{ sessionId: string; toolName: string; at: string }>
  /** The number of calls observed, so a mount lane can assert the guard really ran. */
  observedCount(): number
}

/** What {@link createVerifyRuntime} needs. */
export interface RuntimeOptions {
  /** The adapter, used for the workspace root of an observed call. */
  dsh: Pick<DshAdapter, "workspaceRoot">
  /** One-line reporter for an auto-arm that could not be written. */
  warn: (line: string) => void
  /** Raw config reader, used for the escape-uses grant. */
  configValue: (key: string) => unknown
  /** The default escape uses per escape, when no config declares one (`verify.escapeUses`). */
  defaultEscapeUses: number
  /** The loop lifetime in milliseconds (`verify.loopTtlMs`). */
  loopTtlMs: number
}

/**
 * Build the process-local runtime.
 *
 * @param options - the adapter, the reporter, the config reader and the loop defaults.
 * @returns the runtime the row publishes as `mpdVerify`.
 */
export function createVerifyRuntime(options: RuntimeOptions): VerifyRuntime {
  /** Every call the guard has seen, in observation order. */
  const calls: ObservedCall[] = []
  /**
   * The implementation paths each session's calls NAMED, with whether the read was ADMITTED.
   *
   * THIS IS THE BLINDNESS FACT, and it replaced a timestamp map that could only answer "some code path
   * was named at some point" — which is the wrong question twice over: the validator must NAME the read
   * that spent a seat's basis, and a REFUSED ATTEMPT is not a read. While a seat is blind the envelope
   * DENIES it every implementation path, so counting an attempt would make the readable band's own
   * refusal arm spend the basis the PASS needs (see {@link VerifyRuntime.observedImplementationReads}).
   * Only READS are recorded at all — a gated write tool names a code path it wants to CHANGE.
   */
  const codeReads = new Map<string, ObservedImplementationRead[]>()
  /** The escape uses still held, per session key. */
  const escapes = new Map<string, number>()
  /** The counted diagnosis reads, per session key and path. */
  const counted = new Map<string, Map<string, number>>()
  /** The delegation calls observed, for the boot report. */
  const delegations: Array<{ sessionId: string; toolName: string; at: string }> = []

  /** The per-session counted-read map, created on first use. */
  const countedOf = (sessionId: string): Map<string, number> => {
    /** The existing map, or a fresh one registered under this session. */
    const existing = counted.get(sessionId)
    if (existing !== undefined) return existing
    /** The new map for this session. */
    const created = new Map<string, number>()
    counted.set(sessionId, created)
    return created
  }

  /** The verifier seat bound to one session, resolved from disk so the guard and the log agree. */
  const seatOf = (workspace: string, sessionId: string): VerifierSeatView | undefined => {
    try {
      /** The seat bound to this session, or `undefined` for every other caller. */
      const seat = readSeats(workspace).seats?.[sessionId]
      if (seat === undefined) return undefined
      return {
        loopId: String(seat.loopId ?? ""),
        verifierId: String(seat.verifierId ?? sessionId),
        unlocked: seat.unlocked === true,
        docPaths: Array.isArray(seat.docPaths) ? seat.docPaths.map(String) : [],
      }
    } catch { return undefined }
  }

  /**
   * Keep one observed implementation read, deduped by path, upgrading a refused attempt to an admitted
   * read when the same path is later read with the envelope's leave.
   */
  const recordImplementationRead = (sessionId: string, path: string, admitted: boolean, at: string): void => {
    /** This session's observations so far. */
    const entries = codeReads.get(sessionId) ?? []
    /** The entry already recorded for this path, if any. */
    const existing = entries.find((entry) => entry.path === path)
    if (existing !== undefined) {
      if (admitted) existing.admitted = true
      return
    }
    entries.push({ path, admitted, at })
    codeReads.set(sessionId, entries)
  }

  return {
    /** The session key of one agent, in the frozen `??` order. */
    keyOf(agent: unknown): string { return sessionKeyOf(agent) },

    /** Record one guarded call, so blindness is provable from what the plugin itself saw. */
    noteCall(exec: DshToolExec): void {
      try {
        /** The tool name, read defensively. */
        const toolName = String((exec as { name?: unknown })?.name ?? "")
        if (toolName === "") return
        /** The calling agent's session key. */
        const sessionId = sessionKeyOf((exec as { agent?: unknown })?.agent)
        /** The call's argument object. */
        const args = (exec as { arguments?: Record<string, unknown> })?.arguments
        /** The workspace this call happens in, resolved per call as the guard resolves it. */
        const workspace = options.dsh.workspaceRoot(exec)
        /** The target this call named, if any. */
        const raw = readTargetPath(toolName, args)
        /** The classification of that target, used only for its CODE verdict here. */
        const target = raw === undefined ? undefined : classifyWriteTarget(workspace, raw)
        /** Whether the call names a code path. */
        const code = target?.kind === "code"
        calls.push({ sessionId, toolName, ...(target?.rel === undefined ? {} : { path: target.rel }), code, at: new Date().toISOString() })
        if (code && !GATED_WRITE_TOOLS.includes(toolName)) {
          /** The path this call named, or its raw spelling when the classifier kept no relative form. */
          const named = target?.rel ?? String(raw ?? "")
          // WHETHER THIS READ WAS ADMITTED — asked of the SAME pure decision the guard itself is about to
          // make, with the same inputs, so the log and the guard cannot disagree about what was denied.
          // The mode is read per call for the same reason: `advisory` reports a denial and lets the call
          // through, and `off` enforces nothing, so in neither one did the envelope keep the read out.
          /** The mode in force right now (`verify.mode`, defaulting to `hard`). */
          const mode = resolveVerifyMode(options.configValue("verify.mode"))
          /** The seat bound to this caller, if any; a caller with no seat has no envelope to be denied by. */
          const seat = seatOf(workspace, sessionId)
          /** Whether the envelope would have REFUSED this read (so it never happened). */
          const refused = mode === "hard" && seat !== undefined
            && verifierEnvelopeDecision({ toolName, args, workspaceRoot: workspace, seat }).deny !== undefined
          if (named !== "") recordImplementationRead(sessionId, named, !refused, new Date().toISOString())
        }
        // A COUNTED DIAGNOSIS READ: while a seat's window is open, an implementation read is legal and
        // is tallied, so the next record can carry `unlockedReads[]` with real numbers.
        if (code && !GATED_WRITE_TOOLS.includes(toolName) && counted.has(sessionId)) {
          /** The read tool's own name decides nothing here; the call's effect does. */
          const reads = countedOf(sessionId)
          reads.set(target?.rel ?? String(raw ?? ""), (reads.get(target?.rel ?? String(raw ?? "")) ?? 0) + 1)
        }
      } catch { /* bookkeeping never fails a tool call */ }
    },

    /** True when the observation log shows this session was ADMITTED an implementation read. */
    observedCodeRead(sessionId: string): boolean { return (codeReads.get(sessionId) ?? []).some((entry) => entry.admitted) },

    /** The ADMITTED implementation paths of one session, copied so a caller cannot mutate the log. */
    observedImplementationReads(sessionId: string): readonly string[] {
      return (codeReads.get(sessionId) ?? []).filter((entry) => entry.admitted).map((entry) => entry.path)
    },

    /** The escape uses this session still holds. */
    escapeUses(sessionId: string): number { return escapes.get(sessionId) ?? 0 },

    /** Grant escape uses; the counted escape's only effect on the guard. */
    grantEscape(sessionId: string, uses: number): void {
      escapes.set(sessionId, (escapes.get(sessionId) ?? 0) + uses)
    },

    /** Consume one escape use, reporting whether one was available. */
    consumeEscape(sessionId: string): boolean {
      /** What the session holds right now. */
      const held = escapes.get(sessionId) ?? 0
      if (held <= 0) return false
      escapes.set(sessionId, held - 1)
      return true
    },

    /** Count one implementation read inside a diagnosis window. */
    countRead(sessionId: string, path: string): void {
      try {
        /** This session's tallies. */
        const reads = countedOf(sessionId)
        reads.set(path, (reads.get(path) ?? 0) + 1)
      } catch { /* never fatal */ }
    },

    /** Drain the counted reads for one session, which is what the next record reports. */
    drainReads(sessionId: string): CountedRead[] {
      /** The tallies as a list, then cleared, so a second record cannot re-report them. */
      const reads = countedOf(sessionId)
      /** The drained entries. */
      const drained = [...reads.entries()].map(([path, count]) => ({ path, count }))
      reads.clear()
      return drained
    },

    /** The armed loops of one workspace, read from disk so a concurrent arming is seen. */
    armedLoops(workspace: string): ArmedLoopView[] {
      try {
        return readLoops(workspace).map((loop) => ({
          loopId: loop.loopId,
          sessionId: loop.sessionId,
          status: loop.status,
          writerKind: loop.writer?.kind === "delegate" ? "delegate" : "self",
          writerId: String(loop.writer?.id ?? ""),
          verifierId: String(loop.verifier?.id ?? "unbound"),
          scope: Array.isArray(loop.scope) ? loop.scope.map(String) : [],
          expiresAt: String(loop.expiresAt ?? ""),
        }))
      } catch { return [] }
    },

    /** The verifier seat bound to one session, or `undefined` for every other caller. */
    seatFor(workspace: string, sessionId: string): VerifierSeatView | undefined {
      return seatOf(workspace, sessionId)
    },

    /** The delegation calls observed so far, newest last — the report a boot lane reads. */
    observedDelegations(): Array<{ sessionId: string; toolName: string; at: string }> { return [...delegations] },

    /** The number of calls observed, so a mount lane can assert the guard really ran. */
    observedCount(): number { return calls.length },
  }
}

/**
 * Arm a `writer.kind: "delegate"` loop for one observed delegation.
 *
 * Exported (rather than inlined into the observer) so a QA arm can arm from a fixture without a harness.
 * It never overwrites an existing ARMED loop: one delegation pass is one loop, and a second call would
 * otherwise keep pushing the expiry out.
 *
 * @param workspace - the workspace root the loop belongs to.
 * @param sessionId - the delegating (top-level) agent's key.
 * @param toolName - the delegation tool that was observed.
 * @param ttlMs - the loop's lifetime.
 * @returns the loop id when one was written, else `undefined`.
 */
export function armDelegateLoop(workspace: string, sessionId: string, toolName: string, ttlMs: number): string | undefined {
  /** The loops already of record for this session and tool. */
  const existing = readLoops(workspace).find((loop) => loop.sessionId === sessionId && loop.status === "armed" && loop.openedVia === "observer")
  if (existing !== undefined) return existing.loopId
  /** The instant the loop is opened. */
  const now = new Date()
  /** The loop's id. */
  const loopId = mintId("loop")
  /** The loop record: a delegated writer, and a verifier that binds itself later. */
  const loop = {
    version: 1 as const,
    loopId,
    taskId: null,
    workspace,
    sessionId,
    writer: { kind: "delegate" as const, id: "delegate:" + toolName },
    verifier: { id: "unbound" },
    scope: [] as string[],
    status: "armed" as const,
    openedVia: "observer" as const,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  }
  return writeJsonAtomic(join(loopsDir(workspace), loopId + ".json"), loop) ? loopId : undefined
}

/**
 * Install the observe-only delegation observer.
 *
 * The listener returns `undefined` ALWAYS: the adapter guarantees the downstream decision is returned
 * unchanged, so a hook installed here can neither alter nor veto a call. That is what makes it safe to
 * observe on the same waterfall the dispatcher uses.
 *
 * @param dsh - the adapter (its observe-only post-execute seam and the workspace root).
 * @param options - the runtime to feed, the loop lifetime and the reporter.
 * @returns the registry's disposer.
 */
export function installDelegationObserver(
  dsh: Pick<DshAdapter, "onPostToolExecute" | "workspaceRoot">,
  options: { runtime: VerifyRuntime; loopTtlMs: number; warn: (line: string) => void },
): () => void {
  try {
    return dsh.onPostToolExecute((exec) => {
      try {
        /** The tool name, read defensively. */
        const toolName = String((exec as { name?: unknown })?.name ?? "")
        if (!DELEGATION_TOOLS.includes(toolName)) return undefined
        /** The caller's session key. */
        const sessionId = sessionKeyOf((exec as { agent?: unknown })?.agent)
        /** The workspace the delegation happens in. */
        const workspace = dsh.workspaceRoot(exec)
        // THE TOP-LEVEL TEST IS THE GUARD'S, NOT THIS HOOK'S: arming a delegate loop for a CHILD that
        // delegates further is harmless (a delegate loop never authorises a captain write), so the
        // observer records what it sees and leaves the classification to the one place that has it.
        /** The armed loop's id, when one was written. */
        const loopId = armDelegateLoop(workspace, sessionId, toolName, options.loopTtlMs)
        if (loopId === undefined) options.warn("could not record the delegated loop for " + toolName + " — the loop will not appear in the ledger")
      } catch { /* observation never fails a call */ }
      return undefined
    })
  } catch {
    options.warn("the delegation observer could not be installed — delegated loops will not be auto-armed")
    return () => { /* nothing to release */ }
  }
}

/**
 * Read a positive integer knob through the row's raw config reader.
 *
 * @param configValue - the raw reader.
 * @param key - the dotted key.
 * @param fallback - the default when the key is absent or unusable.
 * @returns the knob in force.
 */
export function configInt(configValue: (key: string) => unknown, key: string, fallback: number): number {
  return resolvePositiveInt(configValue(key), fallback)
}
