// Unit arms for the dsh-Go TOOL CARDS the verify row publishes (wave contract §4 D6).
//
// Each arm asserts the SHIPPED wiring, not a copy: the `presentationMeta` const tested here is the very
// object the tool definition carries, and the mount arm below proves the definition really carries it.
// The measured bytes / nodes / depth are printed so the card's budget headroom is evidence on disk
// rather than a claim, and every tree is run through `lintDesign` in the v1 (static-fallback) mode
// because a tool card is drawn by older apps too. The five `mpd_verify_*` tools declare NO output
// schema, so these arms also pin that the cards cope with both their success and refused shapes.
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BUDGETS, lintDesign, measureView, toolCard, VIEW_KEY, type DshGoView } from "../../mpd-dsh-adapter-plugin/src/dshgo-view"
import { apply } from "../src/index.ts"
import { buildVerifyEvidenceCard, buildVerifyRecordCard, VERIFY_EVIDENCE_CARD, VERIFY_RECORD_CARD } from "../src/dshgo-cards.ts"

/** One card's `presentationMeta`, as the tool definition carries it. */
type CardMeta = (args: unknown, value: unknown) => Record<string, unknown>

/** One tool definition as the stub registry keeps it. */
type RegisteredTool = {
  /** The tool name the model calls. */
  name: string
  /** The output contract the row declared, which is where a card lives. */
  output?: { presentationMeta?: unknown }
}

/**
 * Assert one card is a function-produced `dsh-go/view` inside the tool-card budget and lint-clean.
 *
 * @param name - the card's label, for the report and a failure message.
 * @param meta - the `presentationMeta` function under test.
 * @param value - a representative tool value.
 * @returns the built view, so an arm can assert its content too.
 */
function expectCard(name: string, meta: CardMeta, value: unknown): DshGoView {
  expect(typeof meta).toBe("function")
  /** What the app receives for this tool result. */
  const out = meta({}, value)
  expect(out[VIEW_KEY]).toBeDefined()
  /** The view tree the app draws. */
  const view = out[VIEW_KEY] as DshGoView
  /** The app's own three measurements. */
  const measured = measureView(view)
  console.log(name + " bytes=" + measured.bytes + " nodes=" + measured.nodes + " depth=" + measured.depth)
  expect(measured.bytes).toBeLessThanOrEqual(BUDGETS.toolCard.bytes)
  expect(measured.nodes).toBeLessThanOrEqual(BUDGETS.toolCard.nodes)
  expect(measured.depth).toBeLessThanOrEqual(BUDGETS.toolCard.depth)
  expect(lintDesign(view, { version: 1 })).toEqual([])
  return view
}

/**
 * Mount the row against a throwaway workspace and collect the tool definitions it registers.
 *
 * @returns the registered definitions, in registration order.
 */
function mountTools(): RegisteredTool[] {
  /** Every tool the row registered through the adapter. */
  const tools: RegisteredTool[] = []
  /** The throwaway workspace that is both the state root and the probe target. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-verify-cards-"))
  /** The adapter slice the lazy adapter resolves and forwards to. */
  const stub: Record<string, unknown> = {
    capabilities: () => ({ toolsGuard: true, toolsRegister: true }),
    workspaceRoot: () => workspace,
    registerTool: (definition: RegisteredTool) => { tools.push(definition); return () => { /* unregistered */ } },
    registerTools: (definitions: RegisteredTool[]) => { for (const definition of definitions) tools.push(definition); return () => { /* unregistered */ } },
    guardTool: () => () => { /* no guard installed by this row */ },
    onPostToolExecute: () => () => { /* observer released */ },
    teamMembership: () => undefined,
  }
  /** Services the row publishes, so its own lookups resolve. */
  const services = new Map<string, unknown>()
  /** The cordis context the row sees. */
  const ctx = {
    tools: {},
    provide: (id: string, value: unknown) => { services.set(id, value) },
    get: (id: string) => (id === "mpdDsh" ? stub : services.get(id)),
    on: () => () => { /* no event subscriptions asserted here */ },
  }
  apply(ctx as never)
  return tools
}

describe("verify tool cards", () => {
  test("mpd_verify_evidence card covers a gate run inside the tool-card budget", () => {
    /** The card of a successful gate run. */
    const view = expectCard("verify-evidence-gate", VERIFY_EVIDENCE_CARD, {
      evidenceId: "ev-abc123",
      gate: "tests",
      cmd: "bun test",
      exit: 0,
      logPath: ".mpd/verify/evidence/ev-abc123.log",
      logSha256: "0".repeat(64),
      tail: "3 pass",
      gateFreeze: "frozen",
    })
    expect(JSON.stringify(view)).toContain("tests")
  })

  test("a refused gate renders a bad callout instead of a blank card", () => {
    /** The card of a run the gate table refused. */
    const view = expectCard("verify-evidence-refused", VERIFY_EVIDENCE_CARD, { refused: "the project gate file no longer matches the freeze" })
    expect(JSON.stringify(view)).toContain("no longer matches the freeze")
  })

  test("a probe renders one row per artifact", () => {
    /** The card of a content-free probe. */
    const view = expectCard("verify-evidence-probe", VERIFY_EVIDENCE_CARD, {
      evidenceId: "ev-probe1",
      probe: [{ path: "packages/x/src/index.ts", bytes: 1234, sha256: "a".repeat(64), mtime: "2026-11-03T00:00:00.000Z" }],
      readings: [],
    })
    expect(JSON.stringify(view)).toContain("packages/x/src/index.ts")
  })

  test("mpd_verify_record card covers a PASS inside the tool-card budget", () => {
    /** The card of a recorded PASS. */
    const view = expectCard("verify-record-pass", VERIFY_RECORD_CARD, {
      recordId: "rec-1",
      verdict: "PASS",
      basis: "blind",
      sources: 2,
      gateEvidence: 1,
      recordPath: ".mpd/verify/records/rec-1.json",
    })
    expect(JSON.stringify(view)).toContain("PASS")
  })

  test("a FAIL with a repair names the repair it opened", () => {
    /** The card of a recorded FAIL. */
    const view = expectCard("verify-record-fail", VERIFY_RECORD_CARD, {
      recordId: "rec-2",
      verdict: "FAIL",
      basis: "blind",
      sources: 1,
      gateEvidence: 1,
      repair: { repairId: "rep-9" },
      recordPath: ".mpd/verify/records/rec-2.json",
    })
    expect(JSON.stringify(view)).toContain("rep-9")
  })

  test("a validator refusal is reported with the rule it names", () => {
    /** The card of a refused record. */
    const view = expectCard("verify-record-refused", VERIFY_RECORD_CARD, { refused: { reason: "no-gate-evidence", detail: "a PASS must cite a gate" } })
    expect(JSON.stringify(view)).toContain("no-gate-evidence")
  })

  test("a throwing builder degrades to {} so the app falls back to its generic row", () => {
    /** The meta of a builder that cannot complete; `toolCard` must catch, never throw. */
    const failing = toolCard(() => { throw new Error("boom") })
    expect(failing({}, {})).toEqual({})
  })

  test("the registered definitions carry exactly these card functions", () => {
    /** Every definition the row registered in the stub composition. */
    const tools = mountTools()
    expect(tools.find((tool) => tool.name === "mpd_verify_evidence")?.output?.presentationMeta).toBe(VERIFY_EVIDENCE_CARD)
    expect(tools.find((tool) => tool.name === "mpd_verify_record")?.output?.presentationMeta).toBe(VERIFY_RECORD_CARD)
  })

  test("the pure builders stay usable without the toolCard wrapper", () => {
    /** The raw trees, which the budget arms above already linted. */
    expect(buildVerifyEvidenceCard({}, {}).type).toBe("stack")
    expect(buildVerifyRecordCard({}, {}).type).toBe("stack")
  })
})
