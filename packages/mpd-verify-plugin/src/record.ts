// THE VERIFICATION RECORD and its validator — the ACTUAL guarantee of the A-writes/B-verifies law.
//
// The guard is defence in depth: it can be degraded by a composition without the `tools.guard` seam, and
// it can only see the calls the harness routes through it. The RECORD is what cannot be degraded,
// because a PASS that cannot be justified is refused at the moment it is written — the verdict is a
// validated artefact rather than a claim. Every refusal reason below is a distinct string, so a QA arm
// can assert WHICH rule fired instead of "it failed".
//
// The record shape is FROZEN by the wave contract (`.mpd/plans/verify-law-spec.md` (b)); Lane E writes
// its per-lane records by hand in exactly this shape, so this validator is also the schema those records
// are checked against.

/** The verdict a verifier records. */
export type VerifyVerdict = "PASS" | "FAIL"

/** The severity of one finding. */
export type FindingSeverity = "blocker" | "major" | "minor"

/**
 * How the verifier's blindness was established.
 *
 * THREE values, never two. `blind` is a claim the observing plugin can back with its own log;
 * `pre-plugin` is a record written while NO observing plugin existed in the process at all — the wave
 * authored such records by hand before the row shipped, and calling those `blind` would claim an
 * observation that could not have happened. `unproven` is the honest answer when a plugin DID observe
 * an implementation read before the verdict.
 */
export type BasisKind = "blind" | "unproven" | "pre-plugin"

/** One hashed document. */
export interface HashedDoc {
  /** The document's path, workspace-relative where it is inside the workspace. */
  path: string
  /** The sha256 of its bytes at the moment it was read. */
  sha256: string
}

/** One content-free artifact reading: what exists, how big, and its hash — NEVER its content. */
export interface ArtifactProbe {
  /** The probed path. */
  path: string
  /** The file's size in bytes (0 for a directory). */
  bytes: number
  /** The sha256 of the file's bytes; the empty string for a directory. */
  sha256: string
  /** The file's modification time, ISO. */
  mtime: string
}

/** One piece of gate evidence produced through `mpd_verify_evidence` for this loop. */
export interface GateEvidence {
  /**
   * The evidence id the tool minted when it ran the gate.
   *
   * ABSENT is legal on a `pre-plugin` basis ONLY (captain's second amendment set): a record authored
   * before the law was live had no runner to mint an id, and its provenance is the on-disk
   * `{cmd, exit, logPath, logSha256}` quadruple instead. An id that IS present must be runner-produced
   * for the record's loop — an asserted one is `forged-evidence`, exactly as frozen.
   */
  evidenceId?: string
  /** The exact argv's command line, as the fixed table declares it. */
  cmd: string
  /** The gate's exit code. */
  exit: number
  /** The log's path. */
  logPath: string
  /** The sha256 of the log's bytes. */
  logSha256: string
}

/** One finding a FAIL recorded. */
export interface VerifyFinding {
  /** The finding's id, stable within the record. */
  id: string
  /** How badly it hurts. */
  severity: FindingSeverity
  /** What was observed. */
  symptom: string
  /** What the contract required instead. */
  expected: string
  /** The DOCUMENT that proves the requirement — the whole point of a docs-only verifier. */
  docSource: string
}

/** How the verifier established its basis. */
export interface VerifyBasis {
  /** `blind` when the plugin's own observation log shows no implementation read; else `unproven`. */
  kind: BasisKind
  /**
   * The attestation a `pre-plugin` basis must carry, verbatim: `"no-guard-in-process"`.
   *
   * It is the record's own statement that no observing plugin existed, and it is admissible only while
   * the exemption is open — a record written AFTER the law's first boot marker is `post-install-claim`.
   */
  attestation?: string
  /** The frozen contract the verification was checked against. */
  frozenContract: HashedDoc
  /** The documents that formed the basis. */
  docs: HashedDoc[]
  /** The content-free artifact readings taken before the verdict. */
  probe: ArtifactProbe[]
}

/** One implementation path a FAIL unlocked for diagnosis, with how many times it was read. */
export interface UnlockedRead {
  /** The path that was read after the FAIL. */
  path: string
  /** How many times it was read in the window. */
  count: number
  /** The record whose FAIL opened the window. */
  afterRecordId: string
}

/** A complete verification record, as stored. */
export interface VerificationRecord {
  /** Format version; a reader refuses a version it does not know. */
  version: 1
  /** mpd-minted record id. */
  recordId: string
  /** The loop this verification belongs to. */
  loopId: string
  /** The board task verified, when the loop names one. */
  taskId: string | null
  /** The workspace the record belongs to. */
  workspace: string
  /** The agent key that WROTE the code — never the verifier's. */
  writerId: string
  /** The agent key that verified it; must differ from {@link VerificationRecord.writerId}. */
  verifierId: string
  /** How blindness was established, plus the frozen basis. */
  basis: VerifyBasis
  /** The documents the verdict rests on. */
  sources: HashedDoc[]
  /** The gates that were run, as evidence ids. */
  gateEvidence: GateEvidence[]
  /** The verdict. */
  verdict: VerifyVerdict
  /** The findings; a FAIL carries at least one, each with its `docSource`. */
  findings: VerifyFinding[]
  /** The implementation reads a FAIL unlocked; empty on a first, blind record. */
  unlockedReads: UnlockedRead[]
  /**
   * Free-form notes: the declared bounds a record wants on the file (e.g. the gate runner's `tail`
   * residual). OPTIONAL, and never a substitute for a field the validator reads.
   */
  notes?: string[]
  /** ISO instant the record was written. */
  createdAt: string
}

/**
 * Every refusal this validator can reach, as its own stable reason string.
 *
 * A caller asserts the REASON, never merely "it was refused": "the record was rejected" is exactly the
 * kind of unfalsifiable claim the law exists to replace.
 */
export const REFUSAL = {
  /** The verifier and the writer are the same agent. */
  sameAgent: "same-agent",
  /** A PASS with no cited documents. */
  noDocSources: "no-doc-sources",
  /** A PASS with no gate evidence. */
  noGateEvidence: "no-gate-evidence",
  /** A PASS citing an evidence id this loop never produced. */
  forgedEvidence: "forged-evidence",
  /** A PASS whose basis the observation log cannot prove blind. */
  bindUnproven: "bind-unproven",
  /** A FAIL with no findings. */
  failWithoutFindings: "fail-without-findings",
  /** A finding with no document behind it. */
  findingWithoutBasis: "finding-without-basis",
  /** A record from a seat that already spent its blindness on a diagnosis window. */
  blindSpent: "blind-spent",
  /** A record naming a loop this workspace does not know. */
  unknownLoop: "unknown-loop",
  /** A record whose writer and verifier fields are empty. */
  missingSeats: "missing-seats",
  /** A `pre-plugin` record that also carries unlocked implementation reads. */
  prePluginUnlocked: "pre-plugin-unlocked",
  /** A `pre-plugin` record without its attestation, or whose frozen contract does not match disk. */
  prePluginUnattested: "pre-plugin-unattested",
  /** A `pre-plugin` record written AFTER the law's first boot marker — the exemption has closed. */
  postInstallClaim: "post-install-claim",
} as const

/** What the validator decided. */
export type ValidationOutcome =
  | { /** The record may be stored. */ ok: true }
  | { /** Nothing may be stored. */ ok: false; /** The stable refusal reason. */ reason: string; /** One sentence a caller can show. */ detail: string }

/** Everything {@link validateVerificationRecord} needs beyond the record itself. */
export interface ValidationContext {
  /** The evidence ids `mpd_verify_evidence` really produced for this loop. */
  producedEvidenceIds: readonly string[]
  /** True when this seat had already unlocked an implementation-reading window. */
  seatUnlocked: boolean
  /** True when the loop named by the record exists in this workspace. */
  loopKnown: boolean
  /**
   * The `installedAt` the law's boot marker carries (`.mpd/verify/boot.json`), when the marker exists.
   *
   * ABSENT means the law has never been installed in this workspace, which is exactly the window a
   * `pre-plugin` record is admissible in. Once the marker exists, `createdAt` must PRECEDE it — the
   * exemption closes itself the moment the guard is live, so it can never be claimed afterwards.
   */
  bootInstalledAt?: string
  /**
   * The sha256 of `basis.frozenContract.path` as it is ON DISK right now.
   *
   * ABSENT means the path could not be read, which fails the `pre-plugin` attestation rather than
   * passing it: an unattestable contract is not an attested one.
   */
  frozenContractSha?: string
}

/**
 * Validate one verification record against the law's eight refusal rules.
 *
 * PURE by construction: the caller supplies the three facts the validator cannot derive (which evidence
 * ids were really produced, whether the seat is already spent, whether the loop exists), so the whole
 * rule set is drivable offline and the same function is what the tool calls.
 *
 * @param record - the record as it is about to be stored.
 * @param context - the produced evidence, the seat's ratchet state and the loop's existence.
 * @returns `{ok:true}` when it may be stored, else the stable reason and a sentence.
 */
export function validateVerificationRecord(record: VerificationRecord, context: ValidationContext): ValidationOutcome {
  /** The refusal helper every clause returns through, so the shape stays one place. */
  const refuse = (reason: string, detail: string): ValidationOutcome => ({ ok: false, reason, detail })

  if (record.basis.kind !== "pre-plugin" && !context.loopKnown) {
    return refuse(REFUSAL.unknownLoop, "loop " + JSON.stringify(record.loopId) + " is not in this workspace's ledger — open it with mpd_verify_open first")
  }
  if (record.writerId === "" || record.verifierId === "") {
    return refuse(REFUSAL.missingSeats, "the record must name both seats: a writer (the agent that wrote the code) and a verifier (the agent that checked it)")
  }
  // RULE 1 — INDEPENDENCE. A and B are different agents. This is the clause the user's own instruction
  // names first ("两agent必须独立"), and it is the one a single-agent session would most like to skip.
  if (record.verifierId === record.writerId) {
    return refuse(REFUSAL.sameAgent, "the verifier and the writer are the same agent (" + JSON.stringify(record.writerId)
      + "): the law requires code written by A to be verified by a DIFFERENT agent B")
  }
  // RULE 6 — THE `pre-plugin` EXEMPTION, which CLOSES ITSELF. A record written before the law was
  // installed in this workspace may not claim OBSERVED blindness (no observer existed), so it takes the
  // declared `pre-plugin` basis instead — and it must prove all three of: no unlocked reads, the exact
  // attestation with a frozen contract that still matches disk, and a `createdAt` preceding the boot
  // marker. Once the marker exists, every later record is judged by the ordinary rules.
  if (record.basis.kind === "pre-plugin") {
    if (record.unlockedReads.length > 0) {
      return refuse(REFUSAL.prePluginUnlocked, "a pre-plugin record may not carry unlockedReads: the exemption exists for records authored"
        + " before the observing plugin was live, and a diagnosis window is something the live law opens")
    }
    if (String(record.basis.attestation ?? "") !== "no-guard-in-process" || record.basis.frozenContract.sha256 !== context.frozenContractSha) {
      return refuse(REFUSAL.prePluginUnattested, "a pre-plugin record must carry basis.attestation \"no-guard-in-process\" and a"
        + " basis.frozenContract.sha256 that still matches the file on disk (expected "
        + JSON.stringify(String(context.frozenContractSha ?? "")) + ", got " + JSON.stringify(String(record.basis.frozenContract.sha256 ?? ""))
        + ") — an unattestable contract is not an attested one")
    }
    if (context.bootInstalledAt !== undefined && Date.parse(record.createdAt) >= Date.parse(context.bootInstalledAt)) {
      return refuse(REFUSAL.postInstallClaim, "this record claims the pre-plugin basis but was created at " + JSON.stringify(record.createdAt)
        + ", which does not precede the law's first boot marker (" + JSON.stringify(context.bootInstalledAt)
        + "): the exemption closes the moment the guard is live")
    }
  }
  // RULE 5 — THE RATCHET. A seat that has already spent its blindness on a diagnosis window may only
  // FAIL; a PASS must come from a FRESH verifier, because that seat has read the implementation and its
  // verdict can no longer be a black-box one.
  if (context.seatUnlocked) {
    return refuse(REFUSAL.blindSpent, "this verifier seat has already unlocked an implementation-reading window (a previous FAIL),"
      + " so it can only record further FAILs; a PASS must come from a fresh verifier that has not read the implementation")
  }
  if (record.verdict === "FAIL") {
    // RULE 4 — A FAIL MUST BE ACTIONABLE. A bounce to a writer needs findings a writer can act on, and
    // each finding needs the DOCUMENT that proves the requirement: that is what makes the bounce
    // reviewable instead of an opinion.
    if (record.findings.length === 0) {
      return refuse(REFUSAL.failWithoutFindings, "a FAIL must carry at least one finding (with severity, symptom, expected behaviour and the docSource that proves it)")
    }
    /** The first finding that cites no document. */
    const unsupported = record.findings.find((finding) => String(finding.docSource ?? "") === "")
    if (unsupported !== undefined) {
      return refuse(REFUSAL.findingWithoutBasis, "finding " + JSON.stringify(String(unsupported.id ?? ""))
        + " cites no docSource: every finding must rest on a document, because the verifier works from the docs and never from the implementation")
    }
    return { ok: true }
  }
  // RULE 3 — BLINDNESS MUST BE PROVABLE. A PASS from a seat the observation log cannot show to have been
  // blind is not evidence; it is a claim. The FAIL path above is deliberately exempt, because a FAIL
  // needs no blindness to be believed.
  if (record.basis.kind === "unproven") {
    return refuse(REFUSAL.bindUnproven, "the basis is \"unproven\": the plugin's own observation log shows this verifier read"
      + " implementation paths before recording a verdict, so a PASS cannot be justified. Record a FAIL, or re-verify from a fresh agent")
  }
  // RULE 2 — A PASS MUST BE EVIDENCED, three times over: documents it rested on, gates it ran, and only
  // evidence THIS loop produced. An empty PASS is the failure mode the whole law exists to prevent.
  if (record.sources.length === 0) {
    return refuse(REFUSAL.noDocSources, "a PASS must cite at least one document it worked from (sources[] is empty); the verifier's basis is the frozen contract and the docs")
  }
  if (record.gateEvidence.length === 0) {
    return refuse(REFUSAL.noGateEvidence, "a PASS must carry at least one piece of gate evidence (run it with mpd_verify_evidence {kind:\"gate\"}); gateEvidence[] is empty")
  }
  /** The first cited evidence id this loop never produced, or the first id-less entry outside `pre-plugin`. */
  const forged = record.gateEvidence.find((evidence) => {
    /** This entry's id; absent is legal only on a pre-plugin basis (on-disk provenance instead). */
    const id = String(evidence.evidenceId ?? "")
    if (id === "") return record.basis.kind !== "pre-plugin"
    return !context.producedEvidenceIds.includes(id)
  })
  if (forged !== undefined) {
    return refuse(REFUSAL.forgedEvidence, "gateEvidence cites " + JSON.stringify(String(forged.evidenceId ?? "(no evidenceId)"))
      + ", which mpd_verify_evidence did not produce for loop " + JSON.stringify(record.loopId) + " — evidence cannot be asserted, only run"
      + (forged.evidenceId === undefined ? " (an id-less entry is admissible only on a pre-plugin basis)" : ""))
  }
  return { ok: true }
}

/** The shape a caller passes to build a record; the timestamps and ids are minted by the caller. */
export interface NewRecordInput {
  /** The loop being verified. */
  loopId: string
  /** The board task, when the loop names one. */
  taskId?: string | null
  /** The workspace root. */
  workspace: string
  /** The agent that wrote the code. */
  writerId: string
  /** The agent that verified it. */
  verifierId: string
  /** How blindness was established, with the frozen basis. */
  basis: VerifyBasis
  /** The documents the verdict rests on. */
  sources: HashedDoc[]
  /** The gate evidence the verdict rests on. */
  gateEvidence: GateEvidence[]
  /** The verdict. */
  verdict: VerifyVerdict
  /** The findings a FAIL recorded. */
  findings: VerifyFinding[]
  /** The implementation reads a diagnosis window accumulated. */
  unlockedReads: UnlockedRead[]
}

/**
 * Build a frozen-shape record from a validated input.
 *
 * @param input - the caller's material, already validated.
 * @param identity - the minted record id and the instant to stamp.
 * @returns the record to store.
 */
export function buildRecord(input: NewRecordInput, identity: { recordId: string; createdAt: string }): VerificationRecord {
  return {
    version: 1,
    recordId: identity.recordId,
    loopId: input.loopId,
    taskId: input.taskId ?? null,
    workspace: input.workspace,
    writerId: input.writerId,
    verifierId: input.verifierId,
    basis: input.basis,
    sources: input.sources,
    gateEvidence: input.gateEvidence,
    verdict: input.verdict,
    findings: input.findings,
    unlockedReads: input.unlockedReads,
    createdAt: identity.createdAt,
  }
}
