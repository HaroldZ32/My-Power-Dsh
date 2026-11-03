// R-W4A4 reviewer probe — truth table, totality, trigger equivalence and the rung's bypass surface.
// READ-ONLY: imports the two modules and calls pure functions.
import { admissionOf } from "../../../packages/mpd-roles-plugin/src/admission.ts"
import { advisoryNoticeText, evaluateComplexityGate } from "../../../packages/mpd-roles-plugin/src/complexity-gate.ts"

/** The five-signal producer brief the lane's own test uses. */
const FIVE = "1. 迁移 auth 模块的 token store 并重构它的单元测试与文档\n2. 审计 tests 目录并修复这三个 flaky 用例，补齐缺失的断言和说明"

/** Reduce one call to a printable outcome; a throw is itself the observation. */
function attempt(fn: () => unknown): string {
  try { return JSON.stringify(fn()) } catch (e: any) { return "THREW:" + String(e?.name) + ":" + String(e?.message).slice(0, 60) }
}

console.log("== truth table ==")
console.log("model+5signals        :", attempt(() => evaluateComplexityGate(FIVE, { source: "model", activeBoulder: true, workspaceScale: true })))
console.log("human+1signal         :", attempt(() => evaluateComplexityGate("small task", { source: "human", activeBoulder: true })))
console.log("human+0               :", attempt(() => evaluateComplexityGate("hello there")))
console.log("flag                  :", attempt(() => evaluateComplexityGate("tiny task", { explicitFlag: true })))
console.log("model+flag            :", attempt(() => evaluateComplexityGate("tiny task", { explicitFlag: true, source: "model" })))
console.log("model+5signals+GESTURE:", attempt(() => evaluateComplexityGate(FIVE + " orchestrate it", { source: "model", activeBoulder: true, workspaceScale: true })))
console.log("model+GESTURE only    :", attempt(() => admissionOf("model", "please orchestrate the build")))
console.log("unknown+flag          :", attempt(() => admissionOf("unknown", "team: go")))
console.log("unknown+0             :", attempt(() => admissionOf("unknown", "")))

console.log("\n== totality ==")
console.log("non-string number     :", attempt(() => admissionOf("human", 123 as unknown as string)))
console.log("non-string null       :", attempt(() => admissionOf("human", null as unknown as string)))
console.log("non-string object     :", attempt(() => admissionOf("human", {} as unknown as string)))
console.log("null-proto object     :", attempt(() => admissionOf("human", Object.create(null) as unknown as string)))
console.log("hostile toString      :", attempt(() => admissionOf("human", { toString() { throw new Error("boom") } } as unknown as string)))
console.log("bad source at runtime :", attempt(() => admissionOf("robot" as any, "hello")))
console.log("undefined source rung :", attempt(() => admissionOf(undefined as any, "small task")))

console.log("\n== trigger equivalence: absent source vs the ORIGINAL predicate ==")
/** Texts and inputs to sweep: the two halves of the old predicate, across sensitivities. */
const texts = [FIVE, "small task", "tiny task", "", "hello there", "fix the typo in the readme", "修复并验证", "1. a\n2. b"]
const inputs = [{}, { explicitFlag: true }, { explicitFlag: false }, { activeBoulder: true }, { workspaceScale: true }, { sensitivity: "normal" as const }, { sensitivity: "strict" as const }, { explicitFlag: true, activeBoulder: true }]
let drift = 0
for (const t of texts) for (const i of inputs) {
  const v = evaluateComplexityGate(t, i)
  const oldPredicate = (i as any).explicitFlag === true || v.signals.length >= 1
  if (v.trigger !== oldPredicate) { drift++; console.log("DRIFT", JSON.stringify(t), JSON.stringify(i), v) }
  const vh = evaluateComplexityGate(t, { ...i, source: "human" })
  if (JSON.stringify(v) !== JSON.stringify(vh)) { drift++; console.log("ABSENT!=HUMAN", JSON.stringify(t), JSON.stringify(i), v, vh) }
}
console.log("combinations:", texts.length * inputs.length, "| drift:", drift)

console.log("\n== notice delta ==")
const a0 = advisoryNoticeText(["B"], false)
const a1 = advisoryNoticeText(["B"], false, "inferred")
console.log("advisory lengths:", a0.length, a1.length, "delta", a1.length - a0.length, "| lines", a0.split("\n").length, a1.split("\n").length)
console.log("advisory with rung :", a1)
