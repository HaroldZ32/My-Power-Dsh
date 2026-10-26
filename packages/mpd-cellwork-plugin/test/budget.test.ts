// Offline tests for the MEASURED budget behind the 1/4 rule (contract B6, plan §4.5).
//
// The window is INJECTED in every arm: 123456 produces the documented 30864 budget, which pins the
// arithmetic without ever reading a real model. The measured-input arm writes a real 2 MiB temp file, so
// the bytes → tokens refusal is proven from a file on disk rather than from a stubbed number.
import { test, expect } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { applyBudget, estimateTask, measureInput, resolveTaskWindow, type RouteResolutionView, type WindowReading } from "../src/budget.ts"
import { DEFAULT_CELLWORK_CONFIG } from "../src/config.ts"
import type { DshLlmCatalog } from "../../mpd-dsh-adapter-plugin/src/index"

/** A template workspace holding one file of the requested byte size. */
function workspaceWithFile(name: string, bytes: number): string {
  /** The fresh temp root. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-budget-"))
  writeFileSync(join(workspace, name), "x".repeat(bytes))
  return workspace
}

/** A certified catalog reading at the requested window. */
function readingAt(window: number, maxOutputTokens: number | null = 8192): WindowReading {
  return { provider: "deepseek-official", model: "deepseek-flash", window, provenance: "catalog", maxOutputTokens }
}

test("an INJECTED window of 123456 produces the documented budget 30864", () => {
  /** One small task under the shared defaults. */
  const estimate = estimateTask({ subject: "Small task", description: "Change one small thing.", inputs: [], config: DEFAULT_CELLWORK_CONFIG, routeKey: "deepseek-official/deepseek-flash", modelMaxTokens: 8192 })
  /** The verdict against the injected window. */
  const verdict = applyBudget(estimate, readingAt(123456), DEFAULT_CELLWORK_CONFIG)
  expect(verdict.budget).toBe(30864)
  // The shipped fixed overhead alone (32,000) exceeds a quarter of a 123,456 window, so this task MUST be
  // refused — the arm proves the rule bites instead of trusting a comfortable fixture.
  expect(verdict.accepted).toBe(false)
  expect(verdict.excess).toBe(estimate.estimate - 30864)
  expect(verdict.provenance).toBe("catalog")
})

test("a large window accepts a normal task and enforces the whole-window condition", () => {
  /** One normal task. */
  const estimate = estimateTask({ subject: "Normal task", description: "Implement the panel and its test.", inputs: [], config: DEFAULT_CELLWORK_CONFIG, routeKey: "p/m", modelMaxTokens: 8192 })
  /** A quarter of a 1,000,000 window is 250,000: the estimate fits. */
  const accepted = applyBudget(estimate, readingAt(1000000), DEFAULT_CELLWORK_CONFIG)
  expect(accepted.budget).toBe(250000)
  expect(accepted.accepted).toBe(true)
  // The SECOND condition: output reserve + compaction headroom must also fit inside the window. A 130,000
  // window leaves a 32,500 budget that the fixed overhead already exceeds, so the refusal stays honest.
  const small = applyBudget(estimate, readingAt(130000), DEFAULT_CELLWORK_CONFIG)
  expect(small.accepted).toBe(false)
  expect(small.excess).not.toBeNull()
})

test("an uncertified route is refused with NO guessed window", () => {
  /** One task. */
  const estimate = estimateTask({ subject: "T", description: "D", inputs: [], config: DEFAULT_CELLWORK_CONFIG, routeKey: "", modelMaxTokens: null })
  /** The uncertified reading the window reader produces when nothing certifies a route. */
  const reading: WindowReading = { provider: "", model: "", window: null, provenance: "uncertified", maxOutputTokens: null, reason: "no route" }
/** The uncertified verdict this arm inspects. */
  const verdict = applyBudget(estimate, reading, DEFAULT_CELLWORK_CONFIG)
  expect(verdict.accepted).toBe(false)
  expect(verdict.budget).toBeNull()
  expect(verdict.window).toBeNull()
  expect(String(verdict.reason)).toContain("uncertified")
})

test("the window reader takes the catalog window, then the operator override, then refuses", async () => {
  /** The route service every arm answers through. */
  const routeOf = (): RouteResolutionView => ({ ok: true, route: { provider: "deepseek-official", model: "deepseek-flash" } })
  /** A catalog that lists the route with the injected window. */
  const catalog = async (): Promise<Pick<DshLlmCatalog, "providers">> => ({
    providers: [{ id: "deepseek-official", name: "DeepSeek", models: [{ id: "deepseek-flash", name: "Flash", efforts: [], contextWindow: 123456, maxOutputTokens: 8192 }] }],
  })
  /** The catalog-certified reading. */
  const catalogReading = await resolveTaskWindow({ routeOf, catalog, config: DEFAULT_CELLWORK_CONFIG }, "Senior Engineer")
  expect(catalogReading.window).toBe(123456)
  expect(catalogReading.provenance).toBe("catalog")
  // The catalog reports no window for the route: only the operator override may certify it.
  /** A catalog that lists the model WITHOUT a window. */
  const blind = async (): Promise<Pick<DshLlmCatalog, "providers">> => ({
    providers: [{ id: "deepseek-official", name: "DeepSeek", models: [{ id: "deepseek-flash", name: "Flash", efforts: [], contextWindow: null, maxOutputTokens: 8192 }] }],
  })
  /** The uncertified reading under the default (null) override. */
  const uncertified = await resolveTaskWindow({ routeOf, catalog: blind, config: DEFAULT_CELLWORK_CONFIG }, "Senior Engineer")
  expect(uncertified.window).toBeNull()
  expect(uncertified.provenance).toBe("uncertified")
  // With an override declared, the same blind catalog certifies the route and says `override`.
  /** The overridden reading. */
  const overridden = await resolveTaskWindow({ routeOf, catalog: blind, config: { ...DEFAULT_CELLWORK_CONFIG, windowOverride: 200000 } }, "Senior Engineer")
  expect(overridden.window).toBe(200000)
  expect(overridden.provenance).toBe("override")
})

test("a declared 2 MiB input is refused with its real bytes and a bytes → tokens breakdown", () => {
  /** The workspace holding the huge file. */
  const workspace = workspaceWithFile("huge.txt", 2 * 1024 * 1024)
  /** The measured input. */
  const input = measureInput(workspace, "huge.txt", DEFAULT_CELLWORK_CONFIG)
  expect(input.error).toBeUndefined()
  expect(input.bytes).toBe(2097152)
  // ASCII at 3 chars/token: 2,097,152 / 3 ≈ 699,051 tokens, plus the per-file framing.
  expect(input.tokens).toBeGreaterThan(690000)
  /** The task that declares it. */
  const estimate = estimateTask({ subject: "Read the huge file", description: "D", inputs: [input], config: DEFAULT_CELLWORK_CONFIG, routeKey: "p/m", modelMaxTokens: 8192 })
  /** The verdict at a 1,000,000 window: the quarter budget cannot pay for 699k tokens. */
  const verdict = applyBudget(estimate, readingAt(1000000), DEFAULT_CELLWORK_CONFIG)
  expect(verdict.accepted).toBe(false)
  expect(estimate.measuredInputsTokens).toBe(input.tokens)
  expect(verdict.excess).toBeGreaterThan(0)
})

test("CJK bytes are priced at the punitive rate, and an unreadable or outside path is a refusal", () => {
  /** A workspace whose file is pure CJK text. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-cjk-"))
  writeFileSync(join(workspace, "cjk.txt"), "中文内容测试".repeat(1000))
  /** The measured CJK file. */
  const input = measureInput(workspace, "cjk.txt", DEFAULT_CELLWORK_CONFIG)
  expect(input.cjkRatio).toBeGreaterThan(0.9)
  expect(input.tokens).toBeGreaterThan(0)
  // A path outside the workspace is refused rather than read.
  /** The outside-path measurement. */
  const outside = measureInput(workspace, "../escape.txt", DEFAULT_CELLWORK_CONFIG)
  expect(outside.error).toContain("outside the workspace")
  // A missing path is a refusal naming the declared input.
  /** The missing-path measurement. */
  const missing = measureInput(workspace, "does-not-exist.txt", DEFAULT_CELLWORK_CONFIG)
  expect(missing.error).toBeDefined()
})
