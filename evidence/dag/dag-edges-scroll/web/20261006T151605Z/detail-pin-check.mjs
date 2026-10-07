// detail-pin-check.mjs — the OFFLINE proof that the two capture fixes remove the false red.
//
// It replays the check's own expression over the REAL `cjk` fixture: the detail body's text is built the
// way the view builds it (the original subject beside the English meta line), the pin set is chosen the
// way step 08 now chooses it, and BOTH the old rule (ideographs only, decided by walk order) and the new
// one are evaluated. A negative control — a body that dropped its subject — must still fail the new rule.
import { buildRecord } from "../../../../../docker/ui/team-fixture-records.mts"
/** The declared CJK/full-width range set, the same literal the driver declares. */
const CJK_RANGES = /[\u2E80-\u2FFF\u3000-\u303F\u3040-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/g
/** The IDEOGRAPH subset the driver uses to pick a representative pin. */
const IDEOGRAPHS = /[\u3040-\u9FFF\uAC00-\uD7AF]/
/** The label clause C4 would draw for one subject. */
const c4Label = (subject) => (subject.match(/[\x20-\x7E]+/g) ?? []).join(" ").replace(/\s+/g, " ").trim()
/** The task kind as the detail body renders it. */
const KIND = { requirement: "REQ", work: "WRK", review: "REV", repair: "FIX", integration: "INT" }
/** The pinned detail body's text for one task, built as the view renders it. */
const detailText = (task) => task.subject + task.id + " · " + (KIND[task.kind] ?? task.kind) + " · ○ pending"
const tasks = buildRecord("cjk", "probe").tasks
const pinned = tasks.map((task) => ({ id: task.id, subject: task.subject, text: detailText(task), keeps: detailText(task).includes(task.subject) }))
// STEP 07's pin: the walk ends on the LAST reachable forward-edge child, which on this board is T6.
const walkOrderPin = pinned.filter((pin) => pin.id === "T6")
// STEP 08's pins: an ideograph-carrying task AND one whose subject has no ASCII run at all.
const chosen = [
  pinned.find((pin) => pin.subject.trim().length > 0 && IDEOGRAPHS.test(pin.subject)),
  pinned.find((pin) => pin.subject.trim().length > 0 && !IDEOGRAPHS.test(pin.subject)),
].filter(Boolean)
// The DRAFT that went wrong, kept as its own control: the second pin taken from the C4 fallback branch.
const draft = [pinned.find((pin) => IDEOGRAPHS.test(pin.subject)), pinned.find((pin) => c4Label(pin.subject) === "")].filter(Boolean)
const draftRule = draft.every((pin) => pin.keeps) && draft.some((pin) => IDEOGRAPHS.test(pin.subject)) && draft.some((pin) => !IDEOGRAPHS.test(pin.subject))
const oldRule = walkOrderPin.every((pin) => /[\u3040-\u9fff]/.test(pin.text))
const newRule = chosen.every((pin) => pin.keeps && pin.text.length > 0)
  && chosen.some((pin) => IDEOGRAPHS.test(pin.subject)) && chosen.some((pin) => !IDEOGRAPHS.test(pin.subject))
// NEGATIVE CONTROL: a body that dropped its subject must fail the same rule.
const stripped = chosen.map((pin) => ({ ...pin, text: "T6 · INT · ○ pending", keeps: false }))
const control = stripped.every((pin) => pin.keeps && pin.text.length > 0)
console.log("walk-order pin (T6):", JSON.stringify(walkOrderPin[0].subject), "ideograph=" + IDEOGRAPHS.test(walkOrderPin[0].subject))
console.log("chosen pins        :", chosen.map((pin) => pin.id + "=" + JSON.stringify(pin.subject) + " ideograph=" + IDEOGRAPHS.test(pin.subject)).join(" | "))
console.log("OLD rule (ideographs only, walk order) =", oldRule, "  <- the false red the verifier measured")
console.log("NEW rule (declared set + chosen pins)  =", newRule)
console.log("DRAFT rule (2nd pin from the C4 branch) =", draftRule, " <- also wrong: both pins landed on the ideograph branch")
console.log("   draft pins      :", draft.map((pin) => pin.id + "=" + JSON.stringify(pin.subject) + " ideograph=" + IDEOGRAPHS.test(pin.subject)).join(" | "))
console.log("NEGATIVE CONTROL (subjects dropped)    =", control, " <- must be false")
