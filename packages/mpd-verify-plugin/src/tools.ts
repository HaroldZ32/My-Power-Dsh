// THE FIVE TOOLS OF THE LAW. One package, one row, five verbs.
//
//   mpd_verify_open      open a delegation+verification loop (the captain's route when nobody else writes)
//   mpd_verify_escape    take the COUNTED escape, logged as a JSONL row
//   mpd_verify_seat      bind the calling session as a loop's VERIFIER seat
//   mpd_verify_evidence  run a whitelisted gate, or take a content-free artifact probe
//   mpd_verify_record    record the verdict, through the validator that is the actual guarantee
//
// WHY FIVE AND NOT FOURTEEN. Every tool's name, description and parameter schema sits in the model's
// context on every turn — the same reason `mpd-team-core` consolidated its board surface. These five are
// one workflow: only a verification ACT follows the open/seat pair, so they read as one story.
//
// EVERY ACTION RETURNS A REFUSAL OBJECT RATHER THAN THROWING where the refusal is a legitimate outcome
// (a forged evidence id, an unknown gate, a same-agent verifier): the harness surfaces a thrown error as
// a failed call, and a verifier that cannot tell "you may not" from "the plugin is broken" will retry
// the wrong thing. Only a genuinely broken precondition (no team, no task) throws.
import type { DshAdapter, DshToolDef, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import { textBlock } from "../../mpd-dsh-adapter-plugin/src/index"
import { DEFAULT_CONTRACT_PATH, loopContractPath, normalizeContractPath, resolvePositiveInt, sessionKeyOf } from "./law.ts"
import {
  appendEscape, ensureDir, evidenceDir, hashDoc, loopsDir, mintId, readEvidence, readJson, readLoops, readRecords,
  readSeats, recordsDir, seatsPath, sha256File, verifyRoot, writeEvidence, writeJsonAtomic, writeLoop,
  writeRecord, writeRepair, writeSeats,
} from "./ledger.ts"
import type { EvidenceMeta, VerifyLoop, VerifySeat } from "./ledger.ts"
import { GATE_TABLE, gateById, probeArtifacts, runGate } from "./gates.ts"
import type { ArtifactProbe, GateEvidence, HashedDoc, VerificationRecord, VerifyFinding } from "./record.ts"
import { buildRecord, validateVerificationRecord } from "./record.ts"
import type { VerifyRuntime } from "./observe.ts"
import { join } from "node:path"

/** The default loop lifetime: 24 hours, which is one working session and no longer. */
export const DEFAULT_LOOP_TTL_MS = 24 * 60 * 60 * 1000

/** The default gate timeout: 15 minutes, which covers `bun test packages` with room to spare. */
export const DEFAULT_GATE_TIMEOUT_MS = 15 * 60 * 1000

/** The state file that marks the law as INSTALLED in a workspace. */
export const BOOT_MARKER_FILE = "boot.json"

/** Everything the tool surface needs from the row. */
export interface VerifyToolDeps {
  /** The process-local runtime: observations, escape allowances, counted reads. */
  runtime: VerifyRuntime
  /** The raw config reader (`verify.escapeUses`, `verify.loopTtlMs`, `verify.gateTimeoutMs`). */
  configValue: (key: string) => unknown
  /** The adapter slice: the workspace root and the team membership (for the seat's display name). */
  dsh: Pick<DshAdapter, "workspaceRoot" | "teamMembership">
  /** One-line reporter for the row log. */
  log: (line: string) => void
}

/** The call's workspace and the caller's agent key. */
interface CallSite {
  /** The session workspace root. */
  workspace: string
  /** The calling agent's key. */
  sessionId: string
}

/**
 * Resolve one call's workspace and caller.
 *
 * The workspace comes from the adapter PER CALL (AGENTS.md §6: one host serves many sessions), and the
 * session key uses the frozen `??` chain so this module and `mpd-team-core` agree about who is calling.
 *
 * @param deps - the tool dependencies.
 * @param exec - the harness's execution object.
 * @returns the workspace root and the caller's key.
 */
function where(deps: VerifyToolDeps, exec: DshToolExec): CallSite {
  return { workspace: deps.dsh.workspaceRoot(exec), sessionId: sessionKeyOf((exec as { agent?: unknown })?.agent) }
}

/**
 * Read the `installedAt` of a workspace's boot marker.
 *
 * @param workspace - the workspace root.
 * @returns the ISO instant, or `undefined` when the law has never been installed there.
 */
export function readBootMarker(workspace: string): string | undefined {
  /** The marker as stored, read defensively: a malformed marker reads as absent. */
  const marker = readJson<{ installedAt?: unknown }>(join(verifyRoot(workspace), BOOT_MARKER_FILE))
  return typeof marker?.installedAt === "string" && marker.installedAt !== "" ? marker.installedAt : undefined
}

/**
 * Write the boot marker, which is what CLOSES the `pre-plugin` exemption.
 *
 * Called by the row on a successful install, so the exemption is open exactly while the law is not yet
 * live in a workspace and closed from the first boot afterwards. That is why the marker is load-bearing
 * rather than decorative: without it, a `pre-plugin` record written a week after the guard went live
 * would validate.
 *
 * @param workspace - the workspace root.
 * @param installedAt - the ISO instant of this install.
 * @returns true when the marker landed.
 */
export function writeBootMarker(workspace: string, installedAt: string): boolean {
  ensureDir(verifyRoot(workspace))
  return writeJsonAtomic(join(verifyRoot(workspace), BOOT_MARKER_FILE), { version: 1, installedAt })
}

/**
 * Turn one caller-supplied source path into a hashed document.
 *
 * @param workspace - the workspace root.
 * @param path - the path as the caller spelled it (absolute, or relative to the workspace).
 * @returns the hashed document, or `undefined` when the file cannot be read.
 */
function sourceDoc(workspace: string, path: string): HashedDoc | undefined {
  return hashDoc(workspace, path.startsWith("/") ? path : join(workspace, path))
}

/**
 * Register the five law tools through the adapter.
 *
 * @param dsh - the adapter (tool registration only).
 * @param deps - the runtime, the config reader and the adapter slice.
 * @returns one disposer releasing every registration.
 */
export function registerVerifyTools(dsh: Pick<DshAdapter, "registerTools">, deps: VerifyToolDeps): () => void {
  /** The five definitions, registered in one call so a partial install is impossible. */
  const definitions: DshToolDef[] = [
    openTool(deps),
    escapeTool(deps),
    seatTool(deps),
    evidenceTool(deps),
    recordTool(deps),
  ]
  return dsh.registerTools(definitions)
}

/** The `mpd_verify_open` definition. */
function openTool(deps: VerifyToolDeps): DshToolDef {
  return {
    name: "mpd_verify_open",
    description:
      "Open a delegation+verification LOOP. `writer:\"self\"` lets THIS agent write code inside `scope` — it is the counted, visible path and REQUIRES `self_write_reason` plus a `verifier` that is a different agent. `writer:\"delegate\"` records a loop whose writer is a member. `contract` is the document THIS wave's verifier is handed (a workspace-relative path, e.g. `.mpd/plans/<wave>.md`); with none the loop falls back to the declared `" + DEFAULT_CONTRACT_PATH + "`. A loop authorises nothing after `expiresAt`.",
    parameters: {
      type: "object",
      properties: {
        verifier: { type: "string", description: "The agent that will verify (a member name or session id). Required for writer:\"self\", and must not be the caller." },
        self_write_reason: { type: "string", description: "writer:\"self\" only: why this agent writes its own code. Required, echoed in the report." },
        writer: { type: "string", enum: ["self", "delegate"], description: "Who writes. Defaults to `self`." },
        scope: { type: "array", items: { type: "string" }, description: "The paths this loop covers, relative to the workspace. EMPTY means the whole workspace." },
        contract: { type: "string", description: "The wave contract this loop freezes for its verifier: a workspace-relative path (e.g. `.mpd/plans/verify-law-defects.md`). `mpd_verify_seat` hands the seat exactly this document and `mpd_verify_record` hashes it as the record's `basis.frozenContract`. With none, the declared default `" + DEFAULT_CONTRACT_PATH + "` applies — never a previous wave's plan." },
        task_id: { type: "string", description: "The board task this loop verifies, when it verifies one." },
        ttl_ms: { type: "number", description: "Loop lifetime in ms; defaults to 24h (verify.loopTtlMs)." },
      },
      required: [],
      additionalProperties: false,
    },
    output: {
      render: (_args: unknown, value: any) => textBlock(
        value?.refused !== undefined ? "refused: " + value.refused
          : "loop " + value.loopId + " (" + value.writer?.kind + " writer, verifier " + value.verifier?.id + ", scope "
            + ((value.scope?.length ?? 0) === 0 ? "the whole workspace" : value.scope.join(", ")) + ") expires " + value.expiresAt,
      ),
    },
    execute: (args: any, exec: DshToolExec) => {
      /** The call's workspace and caller. */
      const { workspace, sessionId } = where(deps, exec)
      /** The requested writer kind; anything but `delegate` is a self-writer loop. */
      const writerKind = String(args?.writer ?? "self") === "delegate" ? "delegate" : "self"
      /** The reason the caller gave for writing its own code. */
      const reason = String(args?.self_write_reason ?? "")
      /** The verifier the caller named. */
      const verifier = String(args?.verifier ?? "")
      // THE COUNTED PATH IS NEVER SILENT: a self-writer loop without a stated reason is exactly the
      // "main agent quietly writes the code" case this law exists to remove, so it is refused outright.
      if (writerKind === "self" && reason.trim() === "") {
        return { refused: "a writer:\"self\" loop requires `self_write_reason` — the captain writing its own code is the COUNTED path, and an uncounted one is indistinguishable from the defect this law removes. Pass a reason, or delegate the write (writer:\"delegate\") and let a member do it." }
      }
      if (writerKind === "self" && verifier.trim() === "") {
        return { refused: "a writer:\"self\" loop requires `verifier` — an agent that is NOT the caller. The law is that code written by A is verified by a DIFFERENT agent B; a self-writer loop with no verifier would authorise writes nobody checks." }
      }
      /** The loop's lifetime, from the row's config or the default. */
      const ttlMs = resolvePositiveInt(args?.ttl_ms, resolvePositiveInt(deps.configValue("verify.loopTtlMs"), DEFAULT_LOOP_TTL_MS))
      /** The wave contract this loop freezes, when the caller named one; `undefined` means the default. */
      const contract = normalizeContractPath(args?.contract)
      /** The instant the loop is opened. */
      const now = new Date()
      /** The minted loop id. */
      const loopId = mintId("loop")
      /** The loop record. */
      const loop: VerifyLoop = {
        version: 1,
        loopId,
        taskId: args?.task_id === undefined ? null : String(args.task_id),
        ...(contract === undefined ? {} : { contract }),
        workspace,
        sessionId,
        writer: { kind: writerKind, id: writerKind === "self" ? sessionId : "delegate:pending", reason: writerKind === "self" ? reason : undefined },
        verifier: { id: verifier === "" ? "unbound" : verifier },
        scope: Array.isArray(args?.scope) ? args.scope.map(String) : [],
        status: "armed",
        openedVia: "tool",
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      }
      if (!writeLoop(workspace, loop)) return { refused: "the loop could not be written to " + join(loopsDir(workspace), loopId + ".json") }
      deps.log("opened loop " + loopId + " writer=" + loop.writer.kind + " verifier=" + loop.verifier.id + " contract=" + loopContractPath(loop))
      // THE RESULT MUST BE PLAIN, LOSSLESS JSON — measured 2026-10-07, D1: the harness walks every own
      // key of a tool result and refuses the WHOLE value when one of them is `undefined`
      // (`tool "mpd_verify_open" returned invalid output: value is not lossless JSON`), so a
      // `writer.reason` that exists only in the `self` branch used to throw the loop id away. A key whose
      // value is absent is therefore OMITTED, never set to `undefined` — the same discipline the escape,
      // evidence and record tools already follow with their conditional spreads.
      /** The writer seat as the caller may read it: `reason` is present only when the loop carries one. */
      const writerView: { kind: "self" | "delegate"; id: string; reason?: string } = {
        kind: loop.writer.kind,
        id: loop.writer.id,
        ...(typeof loop.writer.reason === "string" ? { reason: loop.writer.reason } : {}),
      }
      return { loopId, writer: writerView, verifier: loop.verifier, scope: loop.scope, contract: loopContractPath(loop), status: loop.status, expiresAt: loop.expiresAt }
    },
  }
}

/** The `mpd_verify_escape` definition. */
function escapeTool(deps: VerifyToolDeps): DshToolDef {
  return {
    name: "mpd_verify_escape",
    description:
      "Take the COUNTED escape: log one row and allow ONE write on a code path for this agent. Use it when delegating and looping are genuinely impossible — every use is a JSONL row, a boot-log line and a number you will be asked about.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why the write could not be delegated or looped. Required: an unexplained escape is indistinguishable from a bug." },
        path: { type: "string", description: "The code path you need to write, when you already know it." },
      },
      required: ["reason"],
      additionalProperties: false,
    },
    output: {
      render: (_args: unknown, value: any) => textBlock(
        value?.refused !== undefined ? "refused: " + value.refused
          : "escape " + value.count + " logged (" + value.uses + " write(s) allowed) — " + value.reason,
      ),
    },
    execute: (args: any, exec: DshToolExec) => {
      /** The call's workspace and caller. */
      const { workspace, sessionId } = where(deps, exec)
      /** The caller's reason, required. */
      const reason = String(args?.reason ?? "")
      if (reason.trim() === "") {
        return { refused: "`reason` is required: an escape that does not say why is a silent bypass. State what made delegating and looping impossible." }
      }
      /** The row appended to the log, or `undefined` when the log could not be written. */
      const row = appendEscape(workspace, sessionId, reason, args?.path === undefined ? undefined : String(args.path))
      // AN UNLOGGED ESCAPE IS NOT AN ESCAPE. If the row cannot be written the allowance is NOT granted,
      // because the only thing that makes this path acceptable is that it is counted.
      if (row === undefined) return { refused: "the escape could not be logged (the workspace's .mpd/verify/escape.jsonl is not writable), so no allowance was granted — an escape that is not recorded is not the counted path." }
      /** How many writes one escape buys. */
      const uses = resolvePositiveInt(deps.configValue("verify.escapeUses"), 1)
      deps.runtime.grantEscape(sessionId, uses)
      deps.log("escape " + row.count + " reason=" + JSON.stringify(reason) + (row.path === undefined ? "" : " path=" + row.path))
      return { count: row.count, at: row.at, reason, uses, sessionId, ...(row.path === undefined ? {} : { path: row.path }) }
    },
  }
}

/** The `mpd_verify_seat` definition. */
function seatTool(deps: VerifyToolDeps): DshToolDef {
  return {
    name: "mpd_verify_seat",
    description:
      "Bind THIS session as a loop's VERIFIER seat. Idempotent and authoritative. From that moment the envelope applies: no shell, no board mutations, no implementation reads until a verdict is recorded, and a FAIL is what unlocks diagnosis.",
    parameters: {
      type: "object",
      properties: {
        loop_id: { type: "string", description: "The loop to verify." },
        role: { type: "string", enum: ["verifier"], description: "Only `verifier` exists; the parameter is a guard against typos." },
      },
      required: ["loop_id"],
      additionalProperties: false,
    },
    output: {
      render: (_args: unknown, value: any) => textBlock(
        value?.refused !== undefined ? "refused: " + value.refused
          : "seat bound: " + value.verifierId + " verifies loop " + value.loopId + " (" + value.docs.length + " frozen doc(s))",
      ),
    },
    execute: (args: any, exec: DshToolExec) => {
      /** The call's workspace and caller. */
      const { workspace, sessionId } = where(deps, exec)
      /** The loop the caller wants to verify. */
      const loop = readLoops(workspace).find((candidate) => candidate.loopId === String(args?.loop_id ?? ""))
      if (loop === undefined) return { refused: "no loop " + JSON.stringify(String(args?.loop_id ?? "")) + " in this workspace — open it with mpd_verify_open first" }
      // INDEPENDENCE, ENFORCED AT THE SEAT. Binding the writer's own session as its verifier is the
      // single change that would make the rest of the law decorative.
      if (String(loop.writer?.id ?? "") === sessionId) {
        return { refused: "this session (" + sessionId + ") is loop " + loop.loopId + "'s WRITER — a writer cannot verify its own work. Ask a different agent to take the seat." }
      }
      /** The seat file as it stands. */
      const seats = readSeats(workspace)
      // THE SEAT'S FROZEN DOCS COME FROM THE LOOP, NOT FROM THIS MODULE (D2, measured 2026-10-07): the
      // pair hardcoded here handed every later wave the PREVIOUS wave's plan. `loopContractPath` resolves
      // this loop's own contract, falling back to the declared default for a loop that named none.
      /** The contract this loop froze for its verifier. */
      const contract = loopContractPath(loop)
      /** The loop's frozen docs: exactly the document THIS loop was opened against. */
      const docPaths = [...new Set([contract])]
      /** The seat to store. */
      const seat: VerifySeat = { loopId: loop.loopId, verifierId: sessionId, unlocked: seats.seats?.[sessionId]?.unlocked === true, docPaths }
      seats.version = 1
      seats.seats = { ...(seats.seats ?? {}), [sessionId]: seat }
      if (!writeSeats(workspace, seats)) return { refused: "the seat could not be written to " + seatsPath(workspace) }
      // The loop's verifier field is only filled when it was UNBOUND, so a loop that already named its
      // verifier keeps that name; binding is additive, never a silent re-pointing.
      if (String(loop.verifier?.id ?? "unbound") === "unbound") {
        writeLoop(workspace, { ...loop, verifier: { id: sessionId, boundAt: new Date().toISOString() } })
      }
      deps.log("seat bound loop=" + loop.loopId + " verifier=" + sessionId)
      /** The caller's display name, when the team plane knows it. */
      const membership = deps.dsh.teamMembership((exec as { agent?: unknown })?.agent)
      return { loopId: loop.loopId, verifierId: sessionId, role: "verifier", blind: !seat.unlocked, docs: docPaths, verifiedWriter: String(loop.writer?.id ?? ""), ...(membership === undefined ? {} : { teamName: membership.name }) }
    },
  }
}

/** The `mpd_verify_evidence` definition. */
function evidenceTool(deps: VerifyToolDeps): DshToolDef {
  return {
    name: "mpd_verify_evidence",
    description:
      "Produce black-box evidence. `kind:\"gate\"` runs ONE id from the fixed table (`gates`, `tests`, `typecheck`, `docs`, `manifest`, `comments`, `rows`, `vendor`, `dist`, `pack`) and writes its log; `kind:\"probe\"` returns what exists, its size, its sha256 and its mtime for each path — never content. No free-form command is accepted.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["gate", "probe"], description: "What to produce." },
        gate: { type: "string", description: "kind:\"gate\": the table id, exactly as listed." },
        paths: { type: "array", items: { type: "string" }, description: "kind:\"probe\": up to 64 paths inside the workspace." },
        loop_id: { type: "string", description: "The loop this evidence belongs to. Defaults to the seat's loop." },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    output: {
      render: (_args: unknown, value: any) => textBlock(
        value?.refused !== undefined ? "refused: " + value.refused
          : value?.probe !== undefined ? value.probe.length + " artifact(s) probed"
            : "gate " + value.gate + " exit " + value.exit + " -> " + value.logPath,
      ),
    },
    execute: (args: any, exec: DshToolExec) => {
      /** The call's workspace and caller. */
      const { workspace, sessionId } = where(deps, exec)
      /** The loop this evidence belongs to: the caller's seat first, then the explicit argument. */
      const seat = readSeats(workspace).seats?.[sessionId]
      /** The loop the evidence is filed under: the seat's, else the argument, else unbound. */
      const loopId = seat?.loopId ?? (args?.loop_id === undefined ? null : String(args.loop_id))
      /** The evidence id, minted before the run so the metadata and the log share it. */
      const evidenceId = mintId("ev")
      if (String(args?.kind ?? "") === "gate") {
        /** The table entry, or `undefined` for an id that is not on the table. */
        const spec = gateById(String(args?.gate ?? ""))
        // NO FREE-FORM COMMAND, EVER: an unknown id is refused with the whole table named, so a caller
        // that guessed gets the vocabulary instead of a silent success.
        if (spec === undefined) return { refused: "unknown-gate: " + JSON.stringify(String(args?.gate ?? "")) + " is not on the fixed table. The ids are: " + GATE_TABLE.map((entry) => entry.id).join(", ") }
        /** The gate's timeout, from the row's config or the default. */
        const timeoutMs = resolvePositiveInt(deps.configValue("verify.gateTimeoutMs"), DEFAULT_GATE_TIMEOUT_MS)
        /** The run's result. */
        const result = runGate(workspace, spec, timeoutMs)
        /** The log written beside the metadata, so nothing is reported that is not on disk. */
        const wrote = writeEvidence(workspace, {
          version: 1, evidenceId, loopId, kind: "gate", cmd: spec.cmd, exit: result.exit,
          at: new Date().toISOString(),
          logPath: ".mpd/verify/evidence/" + evidenceId + ".log",
          logSha256: result.outputSha256,
        }, result.output)
        if (!wrote) return { refused: "the gate ran (exit " + result.exit + ") but its evidence could not be written under " + evidenceDir(workspace) + " — evidence that is not on disk cannot be cited, so it is not reported as produced" }
        deps.log("gate " + spec.id + " exit=" + result.exit + " evidence=" + evidenceId)
        return { evidenceId, gate: spec.id, cmd: spec.cmd, exit: result.exit, logPath: ".mpd/verify/evidence/" + evidenceId + ".log", logSha256: result.outputSha256, tail: result.tail }
      }
      /** The paths to probe, defaulted to nothing rather than to the workspace (a bare probe walks nothing). */
      const paths = Array.isArray(args?.paths) ? args.paths.map(String) : []
      if (paths.length === 0) return { refused: "kind:\"probe\" needs `paths`: a probe reports on the paths it is given, and a bare probe would be a directory walk." }
      /** The readings, content-free by construction. */
      const readings = probeArtifacts(workspace, paths)
      /** The readings shaped for the frozen record's `basis.probe[]`. */
      const probe: ArtifactProbe[] = readings.map((reading) => ({ path: reading.path, bytes: reading.bytes, sha256: reading.sha256, mtime: reading.mtime }))
      /** Whether the probe evidence landed on disk; a probe that is not stored cannot be cited. */
      const wrote = writeEvidence(workspace, { version: 1, evidenceId, loopId, kind: "probe", at: new Date().toISOString(), probe }, undefined)
      if (!wrote) return { refused: "the probe readings could not be written under " + evidenceDir(workspace) }
      deps.log("probe " + readings.length + " path(s) evidence=" + evidenceId)
      return { evidenceId, probe, readings }
    },
  }
}

/** The fixed gate table's ids, exposed so an unknown gate can name the whole vocabulary. */
function gateIds(): string[] {
  return GATE_TABLE.map((entry) => entry.id)
}

/** The `mpd_verify_record` definition. */
function recordTool(deps: VerifyToolDeps): DshToolDef {
  return {
    name: "mpd_verify_record",
    description:
      "Record a VERDICT through the validator. A PASS needs the docs it cites (`sources`), at least one gate (`evidence_ids`) and a provably blind basis; a FAIL needs findings, each with the `doc_source` that proves it, and it opens a repair task and unlocks diagnosis reading. Refusals name the rule: same-agent, no-doc-sources, no-gate-evidence, forged-evidence, bind-unproven, fail-without-findings, finding-without-basis, blind-spent, unknown-loop, pre-plugin-*.",
    parameters: {
      type: "object",
      properties: {
        loop_id: { type: "string", description: "The loop verified. A `pre-plugin` record uses `waveloop-<lane-slug>` instead." },
        verdict: { type: "string", enum: ["PASS", "FAIL"], description: "The verdict. Record it BEFORE reading any implementation." },
        writer: { type: "string", description: "The agent that wrote the code. Defaults to the loop's writer." },
        sources: { type: "array", items: { type: "string" }, description: "The documents the verdict rests on (paths). A PASS with none is refused." },
        evidence_ids: { type: "array", items: { type: "string" }, description: "The `mpd_verify_evidence` gate ids this verdict rests on." },
        findings: { type: "array", items: { type: "object" }, description: "FAIL only: {id, severity, symptom, expected, doc_source}." },
        probe_paths: { type: "array", items: { type: "string" }, description: "Paths to probe (content-free) as the record's basis." },
        notes: { type: "array", items: { type: "string" }, description: "Optional free-form notes, e.g. a declared bound." },
        basis_kind: { type: "string", enum: ["blind", "unproven", "pre-plugin"], description: "Override the derived basis. `pre-plugin` is for records authored before the law was installed." },
        task_id: { type: "string", description: "The board task this verification answers." },
      },
      required: ["loop_id", "verdict"],
      additionalProperties: false,
    },
    output: {
      render: (_args: unknown, value: any) => textBlock(
        value?.refused !== undefined ? "refused [" + value.refused.reason + "]: " + value.refused.detail
          : "record " + value.recordId + " " + value.verdict + (value.repair === undefined ? "" : " -> repair " + value.repair.repairId),
      ),
    },
    execute: (args: any, exec: DshToolExec) => {
      /** The call's workspace and caller. */
      const { workspace, sessionId } = where(deps, exec)
      /** The verdict, read defensively. */
      const verdict = String(args?.verdict ?? "") === "FAIL" ? "FAIL" as const : String(args?.verdict ?? "") === "PASS" ? "PASS" as const : undefined
      if (verdict === undefined) return { refused: { reason: "bad-verdict", detail: "`verdict` must be \"PASS\" or \"FAIL\"." } }
      /** The loop id the caller named. */
      const loopId = String(args?.loop_id ?? "")
      /** The loop, when one exists. */
      const loop = readLoops(workspace).find((candidate) => candidate.loopId === loopId)
      /** The basis kind: the caller's override, else `blind` unless the observation log disagrees. */
      const explicitBasis = typeof args?.basis_kind === "string" ? String(args.basis_kind) : ""
      /** The basis in force, DERIVED from the observation log unless the caller overrode it. */
      const basisKind = explicitBasis === "pre-plugin" ? "pre-plugin" as const
        : explicitBasis === "unproven" ? "unproven" as const
          : explicitBasis === "blind" ? "blind" as const
            : deps.runtime.observedCodeRead(sessionId) ? "unproven" as const : "blind" as const
      // THE CONTRACT IS THE LOOP'S OWN (D2, measured 2026-10-07): this was hardcoded to the de-vendor
      // wave's plan file, so every later wave's record was checked against a contract it never had — and
      // the `pre-plugin` attestation sha, which is compared against THIS path's bytes on disk, was
      // decided by a document the wave had never read. `loopContractPath` is the same resolution the seat
      // used, so the docPaths a seat was handed and the contract its record cites can never disagree.
      const contractPath = loopContractPath(loop)
      /** The contract as it is on disk right now, which is what an attestation is checked against. */
      const contractSha = sha256File(join(workspace, contractPath))
      /** The documents the verdict rests on, hashed. */
      const sources: HashedDoc[] = (Array.isArray(args?.sources) ? args.sources.map(String) : [])
        .map((path: string) => sourceDoc(workspace, path))
        .filter((doc: HashedDoc | undefined): doc is HashedDoc => doc !== undefined)
      /** The gate evidence ids the caller cited, resolved against what was really produced here. */
      const produced = readEvidence(workspace).filter((row) => row.kind === "gate" && row.loopId === loopId)
      /** The evidence ids the caller cited, in the caller's order. */
      const cited = Array.isArray(args?.evidence_ids) ? args.evidence_ids.map(String) : []
      /** The cited evidence resolved against what the runner really produced for this loop. */
      const gateEvidence: GateEvidence[] = cited.map((id: string) => {
        /** The produced row for this id, when the runner really made one. */
        const row = produced.find((candidate) => candidate.evidenceId === id)
        return row === undefined
          ? { evidenceId: id, cmd: "(asserted)", exit: -1, logPath: "", logSha256: "" }
          : { evidenceId: id, cmd: String(row.cmd ?? ""), exit: Number(row.exit ?? -1), logPath: String(row.logPath ?? ""), logSha256: String(row.logSha256 ?? "") }
      })
      /** The findings, only meaningful on a FAIL. */
      const findings: VerifyFinding[] = (Array.isArray(args?.findings) ? args.findings : []).map((raw: any, index: number) => ({
        id: String(raw?.id ?? "F" + (index + 1)),
        severity: raw?.severity === "blocker" || raw?.severity === "major" ? raw.severity : "minor",
        symptom: String(raw?.symptom ?? ""),
        expected: String(raw?.expected ?? ""),
        docSource: String(raw?.doc_source ?? raw?.docSource ?? ""),
      }))
      /** The content-free probe the record's basis carries, taken now. */
      const probe: ArtifactProbe[] = (Array.isArray(args?.probe_paths) ? args.probe_paths.map(String) : [])
        .flatMap((path: string) => probeArtifacts(workspace, [path]))
        .map((reading: { path: string; bytes: number; sha256: string; mtime: string }) => ({
          path: reading.path, bytes: reading.bytes, sha256: reading.sha256, mtime: reading.mtime,
        }))
      /** The seat file, so the ratchet's state is read once. */
      const seats = readSeats(workspace)
      /** This caller's seat, when it has one. */
      const seat = seats.seats?.[sessionId]
      /** The implementation reads a diagnosis window counted for this caller. */
      const drained = deps.runtime.drainReads(sessionId)
      /** The previous record whose FAIL opened the window, when one did. */
      const openedBy = readRecords(workspace).filter((row) => row.verifierId === sessionId && row.verdict === "FAIL").at(-1)?.recordId ?? ""
      /** The record under construction, assembled from the caller's material and the plugin's own facts. */
      const record: VerificationRecord = buildRecord({
        loopId,
        taskId: args?.task_id === undefined ? (loop?.taskId ?? null) : String(args.task_id),
        workspace,
        // THE WRITER IS THE LOOP'S, NEVER THE CALLER'S: a verifier that could name itself the writer
        // would pass the independence rule by simply filling the field in.
        writerId: args?.writer === undefined ? String(loop?.writer?.id ?? "") : String(args.writer),
        verifierId: sessionId,
        basis: {
          kind: basisKind,
          ...(basisKind === "pre-plugin" ? { attestation: "no-guard-in-process" } : {}),
          frozenContract: { path: contractPath, sha256: contractSha },
          docs: [...new Set([contractPath, ...(seat?.docPaths ?? [])])]
            .map((path) => sourceDoc(workspace, path))
            .filter((doc): doc is HashedDoc => doc !== undefined),
          probe,
        },
        sources,
        gateEvidence,
        verdict,
        findings,
        unlockedReads: basisKind === "pre-plugin" ? [] : drained.map((read) => ({ path: read.path, count: read.count, afterRecordId: openedBy })),
      }, { recordId: mintId("rec"), createdAt: new Date().toISOString() })
      if (Array.isArray(args?.notes)) record.notes = args.notes.map(String)
      /** What the validator decided. */
      const outcome = validateVerificationRecord(record, {
        producedEvidenceIds: produced.map((row) => String(row.evidenceId)),
        seatUnlocked: seat?.unlocked === true,
        // THE LOG, NOT THE FLAG (D4, the captain's ruling): the `blind-spent` rule is judged from the
        // plugin's own observation of what this seat read, so one recorded FAIL no longer bars a PASS
        // from a seat whose window was opened and never used.
        loggedImplementationReads: deps.runtime.observedImplementationReads(sessionId),
        loopKnown: loop !== undefined,
        ...(readBootMarker(workspace) === undefined ? {} : { bootInstalledAt: readBootMarker(workspace) }),
        ...(contractSha === "" ? {} : { frozenContractSha: contractSha }),
      })
      // REFUSE = NOTHING WRITTEN, NOTHING MUTATED. A refused record must leave no trace that could be
      // mistaken for a verdict, which is why the write happens strictly after the validation.
      if (!outcome.ok) {
        deps.log("record refused reason=" + outcome.reason)
        return { refused: { reason: outcome.reason, detail: outcome.detail } }
      }
      if (!writeRecord(workspace, record)) return { refused: { reason: "write-failed", detail: "the record could not be written under " + recordsDir(workspace) } }
      /** The repair a FAIL opened, when one did. */
      let repair: { repairId: string; sourceTaskId: string | null; sourceFindingIds: string[]; summary: string } | undefined
      if (verdict === "FAIL") {
        /** The minted repair id. */
        const repairId = mintId("rep")
        /** The summary a writer reads first. */
        const summary = "repair " + loopId + " after " + record.recordId + ": " + (findings[0]?.symptom ?? "a FAIL was recorded")
        repair = { repairId, sourceTaskId: record.taskId, sourceFindingIds: findings.map((finding) => finding.id), summary }
        writeRepair(workspace, {
          version: 1, repairId, sourceRecordId: record.recordId, sourceTaskId: record.taskId,
          sourceFindingIds: findings.map((finding) => finding.id),
          summary, writerId: record.writerId, status: "open", createdAt: new Date().toISOString(),
        })
        // THE RATCHET TURNS HERE AND ONLY HERE: a recorded FAIL unlocks implementation reading for
        // this seat, and the unlock is durable (seats.json) so a restart does not silently re-blind it.
        if (seat !== undefined) {
          seats.seats = { ...(seats.seats ?? {}), [sessionId]: { ...seat, unlocked: true, unlockedAt: new Date().toISOString(), unlockedBy: record.recordId } }
          writeSeats(workspace, seats)
        }
        deps.log("record " + record.recordId + " FAIL -> repair " + repairId)
      } else {
        deps.log("record " + record.recordId + " PASS")
      }
      return {
        recordId: record.recordId,
        verdict,
        basis: basisKind,
        writerId: record.writerId,
        verifierId: record.verifierId,
        sources: record.sources.length,
        gateEvidence: record.gateEvidence.length,
        unlockedReads: record.unlockedReads,
        ...(repair === undefined ? {} : { repair }),
        recordPath: ".mpd/verify/records/" + record.recordId + ".json",
        // THE DECLARED BOUND, carried in the result as well as on the record: a gate's tail may print
        // source frames, so this is controlled black-box evidence and never a proof of reading nothing.
        bound: "gate output (tail) may print source frames; blindness is proven by the observation log, not by the envelope",
      }
    },
  }
}
