// The dsh-Go TOOL CARDS of the verify row (wave contract D6).
//
// WHY A SEPARATE MODULE: a card builder must be PURE — no ctx, no I/O, no clock — so a unit test can
// lint and measure it (contract §4 D6: "a failed build returns {}"). The exported `presentationMeta`
// consts below are the very objects the tool definitions carry, so the test asserts the shipped
// wiring instead of a copy. The five `mpd_verify_*` tools deliberately declare NO output schema; this
// module therefore never assumes one and reads every field defensively.
//
// THE THREE RULES OF A TOOL CARD: v1 components only (an old app draws a grey placeholder for anything
// newer), no `$` data bindings (a card has no data model) and no `actions` (a card cannot call back).
// `toolCard()` enforces those plus the 8 KiB / 40 nodes / depth 6 budget, degrading to `{}` on any
// failure so the app falls back to its generic tool row.
import { callout, keyValue, metric, row, stack, table, toolCard, type DshGoView } from "../../mpd-dsh-adapter-plugin/src/dshgo-view.ts"

/** Whether a value is a plain JSON object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A JSON object from a tool value, or an empty record when the value is anything else. */
function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

/** The object members of the array at `key`, or no rows when the field is absent or not an array. */
function recordsAt(source: Record<string, unknown>, key: string): Record<string, unknown>[] {
  /** The field's value, of unknown shape because it came out of a tool result. */
  const raw = source[key]
  return Array.isArray(raw) ? raw.filter(isRecord) : []
}

/** A non-empty string field, or `fallback` when the field is absent or blank. */
function stringOf(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback
}

/** A finite number field, or 0 so a missing count still prints a number. */
function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/** Clip text to `max` characters, marking the cut so a truncation is visible rather than implied. */
function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1) + "…"
}

/** The tail of a long path, which names a file better than its root does inside a narrow card. */
function tail(value: string, max: number): string {
  return value.length <= max ? value : "…" + value.slice(value.length - (max - 1))
}

/**
 * Build the `mpd_verify_evidence` card: a refusal, a probe table, or the gate run's exit and log.
 *
 * @param _args - the call's arguments; unused, the value names what was produced.
 * @param value - the tool value of a gate run, a probe, or `{ refused }` when the run was not allowed.
 * @returns a v1 stack titled "Verify evidence", at most 20 probe rows.
 */
export function buildVerifyEvidenceCard(_args: unknown, value: unknown): DshGoView {
  /** The tool value as a record; a malformed value yields an empty card rather than a throw. */
  const v = recordOf(value)
  /** The refusal sentence, when the runner declined to produce anything. */
  const refused = typeof v.refused === "string" ? v.refused : ""
  if (refused !== "") {
    return stack([callout(clip(refused, 600), { tone: "bad" })], { title: "Verify evidence" })
  }
  /** The probed artifact readings; present only on a `kind:"probe"` call. */
  const probes = recordsAt(v, "probe")
  /** The evidence id both shapes carry. */
  const evidenceId = stringOf(v.evidenceId, "(unknown)")
  if (probes.length > 0) {
    return stack([
      row([
        metric({ label: "Probed", value: probes.length }),
        metric({ label: "Evidence", value: clip(evidenceId, 24) }),
      ]),
      table({
        columns: ["Path", "Bytes", "SHA-256"],
        rows: probes.slice(0, 20).map((probe) => [clip(stringOf(probe.path, "?"), 48), numberOf(probe.bytes), clip(stringOf(probe.sha256, "—"), 12)]),
      }),
    ], { title: "Verify evidence" })
  }
  /** The gate's process exit code, which is what a PASS or FAIL of the gate itself is read from. */
  const exit = numberOf(v.exit)
  return stack([
    row([
      metric({ label: "Exit", value: exit, tone: exit === 0 ? "good" : "bad" }),
      metric({ label: "Freeze", value: stringOf(v.gateFreeze, "unfrozen") }),
    ]),
    keyValue([
      ["Gate", stringOf(v.gate, "(unknown)")],
      ["Evidence", clip(evidenceId, 24)],
      ["Log", tail(stringOf(v.logPath, "(none)"), 72)],
    ]),
  ], { title: "Verify evidence" })
}

/**
 * Build the `mpd_verify_record` card: the verdict, what it rests on, and the repair it opened.
 *
 * @param _args - the call's arguments; unused, the value names the record that was written.
 * @param value - the tool value `{ recordId, verdict, … }` or `{ refused: { reason, detail } }`.
 * @returns a v1 stack titled "Verify record".
 */
export function buildVerifyRecordCard(_args: unknown, value: unknown): DshGoView {
  /** The tool value as a record; a malformed value yields an empty card rather than a throw. */
  const v = recordOf(value)
  /** The validator's refusal, when it rejected the verdict; the shape is `{ reason, detail }`. */
  const refused = recordOf(v.refused)
  if (Object.keys(refused).length > 0) {
    /** The rule the refusal names. */
    const reason = stringOf(refused.reason, "refused")
    /** The sentence explaining the refusal. */
    const detail = stringOf(refused.detail, "")
    return stack([callout(clip("refused [" + reason + "]: " + detail, 600), { tone: "bad" })], { title: "Verify record" })
  }
  /** The recorded verdict; anything but PASS prints as the value's own text so drift is visible. */
  const verdict = stringOf(v.verdict, "(unknown)")
  /** The documents the verdict cited. */
  const sources = numberOf(v.sources)
  /** The gate evidence rows the verdict cited. */
  const gateEvidenceCount = numberOf(v.gateEvidence)
  /** The card's children, assembled below. */
  const children: DshGoView[] = [
    row([
      metric({ label: "Verdict", value: verdict, tone: verdict === "PASS" ? "good" : verdict === "FAIL" ? "bad" : "muted" }),
      metric({ label: "Gate evidence", value: gateEvidenceCount }),
      metric({ label: "Sources", value: sources }),
    ]),
    keyValue([
      ["Record", stringOf(v.recordId, "(unknown)")],
      ["Basis", stringOf(v.basis, "(unproven)")],
      ["Record path", tail(stringOf(v.recordPath, "(none)"), 72)],
    ]),
  ]
  /** The repair task a FAIL opens; absent on a PASS. */
  const repair = recordOf(v.repair)
  if (Object.keys(repair).length > 0) {
    children.push(callout("repair opened: " + clip(stringOf(repair.repairId, "(unknown)"), 60), { tone: "warn" }))
  }
  return stack(children, { title: "Verify record" })
}

/** The `presentationMeta` of `mpd_verify_evidence`: the card above, budget-checked and never throwing. */
export const VERIFY_EVIDENCE_CARD = toolCard(buildVerifyEvidenceCard)

/** The `presentationMeta` of `mpd_verify_record`: the card above, budget-checked and never throwing. */
export const VERIFY_RECORD_CARD = toolCard(buildVerifyRecordCard)
