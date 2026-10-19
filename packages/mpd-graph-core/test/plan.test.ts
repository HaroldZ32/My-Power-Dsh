// THE TASK-PLAN PARSER AGAINST THE SUBSET THE README DOCUMENTS.
//
// A fixture is written the way a person writes a plan, not the way a regex prefers it: lane table,
// numbered TODOs, an `F<n>` wave, edges spelled in the two forms the repository's own plans use, and
// one deliberately half-typed line. If this file accepts MORE than the README promises, the README
// is the defect — the arms below are the promise, case by case.
import { describe, expect, test } from "bun:test"

import { parsePlanMarkdown } from "../src/plan.ts"

/** The canonical fixture plan, spanning both headings, a lane table and both edge forms. */
const FIXTURE = [
  "# A plan",
  "",
  "| Lane | Owner | Scope |",
  "|---|---|---|",
  "| **C. parser** | Senior Engineer | `src/plan.ts` |",
  "| **D. gate** | Junior Engineer (after C) | `scripts/**` |",
  "",
  "## TODOs",
  "",
  "1. C — parse the plan.",
  "2. C — merge the plan (blocked by 1).",
  "3. D — build the gate, blocked_by: 2, F1.",
  "",
  "## Final Verification Wave",
  "",
  "- [ ] F1. verify everything (blocked by 1, 2).",
  "",
].join("\n")

describe("the accepted subset", () => {
  test("both headings produce their id forms, ordered by the id collator", () => {
    /** The parsed document. */
    const plan = parsePlanMarkdown(FIXTURE)
    expect(plan.tasks.map((task) => task.id)).toEqual(["F1", "T1", "T2", "T3"])
    expect(plan.tasks.map((task) => task.section)).toEqual(["final-wave", "todo", "todo", "todo"])
    expect(plan.problems).toEqual([])
  })

  test("the leading lane marker is stripped and its owner comes from the lane table", () => {
    /** The parsed document. */
    const plan = parsePlanMarkdown(FIXTURE)
    /** The TODO tasks by id, for direct field assertions. */
    const byId = new Map(plan.tasks.map((task) => [task.id, task]))
    expect(byId.get("T1")?.title).toBe("parse the plan.")
    expect(byId.get("T1")?.owner).toBe("Senior Engineer")
    expect(byId.get("T3")?.owner).toBe("Junior Engineer")
    expect(byId.get("F1")?.owner).toBeUndefined()
    expect(plan.lanes).toEqual([
      { key: "C", owner: "Senior Engineer" },
      { key: "D", owner: "Junior Engineer" },
    ])
  })

  test("a parenthesised (blocked by …) list resolves ordinals and explicit ids", () => {
    /** The parsed document. */
    const plan = parsePlanMarkdown(FIXTURE)
    /** The TODO tasks by id. */
    const byId = new Map(plan.tasks.map((task) => [task.id, task]))
    expect(byId.get("T2")?.blockedBy).toEqual(["T1"])
    expect(byId.get("F1")?.blockedBy).toEqual(["T1", "T2"])
  })

  test("a colon-labelled blocked_by list resolves ordinals and F-ids", () => {
    /** The parsed document. */
    const plan = parsePlanMarkdown(FIXTURE)
    /** The third TODO. */
    const third = plan.tasks.find((task) => task.id === "T3")
    expect(third?.blockedBy).toEqual(["F1", "T2"])
  })

  test("a line number points at the source line of every task", () => {
    /** The parsed document. */
    const plan = parsePlanMarkdown(FIXTURE)
    /** The first TODO's 1-based line. */
    const first = plan.tasks.find((task) => task.id === "T1")
    expect(first?.line).toBe(10)
  })
})

describe("lane markers strip only declared lanes", () => {
  test("a bold-wrapped Lane marker with an inline owner is stripped when its lane is declared", () => {
    /** A plan whose lane table declares B, so the marker is allowed to strip the title. */
    const text = [
      "| Lane | Owner |",
      "|---|---|",
      "| **B. adopt** | Junior Engineer |",
      "",
      "## TODOs",
      "",
      "- [ ] 1. **Lane B (Senior Engineer) — panel work.** More text.",
      "",
    ].join("\n")
    /** The parsed document. */
    const plan = parsePlanMarkdown(text)
    expect(plan.tasks[0]?.title).toBe("panel work.** More text.")
    expect(plan.tasks[0]?.owner).toBe("Junior Engineer")
    expect(plan.problems).toEqual([])
  })

  test("a marker-shaped prefix whose lane is NOT declared is reported and left verbatim", () => {
    /** A title that begins with `Two.` — marker-shaped, but no lane `TWO` exists. */
    const text = ["## TODOs", "", "1. Two. Things happen.", ""].join("\n")
    /** The parsed document. */
    const plan = parsePlanMarkdown(text)
    expect(plan.tasks[0]?.title).toBe("Two. Things happen.")
    expect(plan.tasks[0]?.owner).toBeUndefined()
    expect(plan.problems.length).toBe(1)
    expect(plan.problems[0]?.reason).toContain("TWO")
    expect(plan.problems[0]?.reason).toContain("names no lane")
    expect(plan.problems[0]?.text).toBe("1. Two. Things happen.")
  })

  test("an undeclared marker never eats a task id that a title starts with", () => {
    /** A title that begins with an explicit id and a parenthesised note. */
    const text = ["## TODOs", "", "1. T14 (blind verify of the guard scope).", ""].join("\n")
    /** The parsed document. */
    const plan = parsePlanMarkdown(text)
    expect(plan.tasks[0]?.title).toBe("T14 (blind verify of the guard scope).")
    expect(plan.problems.length).toBe(1)
    expect(plan.problems[0]?.reason).toContain("T14")
    expect(plan.problems[0]?.text).toBe("1. T14 (blind verify of the guard scope).")
  })
})

describe("tolerance with a report", () => {
  test("a half-typed item, a stray bullet and a duplicate id are collected, not thrown on", () => {
    /** A TODO section with three unreadable lines around one good task. */
    const text = ["## TODOs", "", "1. first.", "- [ ] 2", "- a stray bullet", "1. again.", ""].join("\n")
    /** The parsed document. */
    const plan = parsePlanMarkdown(text)
    expect(plan.tasks.map((task) => task.id)).toEqual(["T1"])
    expect(plan.problems.map((problem) => problem.line)).toEqual([4, 5, 6])
    expect(plan.problems[0]?.reason).toContain("numbered TODO")
    expect(plan.problems[2]?.reason).toContain("duplicate task id T1")
    expect(plan.problems[2]?.text).toBe("1. again.")
  })

  test("prose and blank lines inside a section are not problems", () => {
    /** A section whose only non-task line is explanatory prose. */
    const text = ["## TODOs", "", "This paragraph explains the wave.", "", "1. the work.", ""].join("\n")
    /** The parsed document. */
    const plan = parsePlanMarkdown(text)
    expect(plan.tasks.map((task) => task.id)).toEqual(["T1"])
    expect(plan.problems).toEqual([])
  })

  test("a fenced block that quotes the grammar declares nothing", () => {
    /** A plan with a fenced example between the heading and the real task. */
    const text = ["## TODOs", "", "```", "1. quoted, not a task", "```", "", "1. the real task.", ""].join("\n")
    /** The parsed document. */
    const plan = parsePlanMarkdown(text)
    expect(plan.tasks.map((task) => task.id)).toEqual(["T1"])
    expect(plan.tasks[0]?.title).toBe("the real task.")
    expect(plan.problems).toEqual([])
  })

  test("a lane reference names every task that lane declares, never itself", () => {
    /** A plan with two lane-A tasks and one lane-B task blocked by the lane. */
    const text = [
      "| Lane | Owner | Write scope |",
      "|---|---|---|",
      "| **A. core** | Senior Engineer | `src/**` |",
      "| **B. adopt** | Junior Engineer | `test/**` |",
      "",
      "## TODOs",
      "",
      "1. A — first core task.",
      "2. A — second core task.",
      "3. B — adopt it (blocked by Lane A).",
      "",
    ].join("\n")
    /** The parsed document. */
    const plan = parsePlanMarkdown(text)
    /** The adopting task. */
    const adopt = plan.tasks.find((task) => task.id === "T3")
    expect(adopt?.blockedBy).toEqual(["T1", "T2"])
    expect(plan.problems).toEqual([])
  })

  test("a blocker reference that names nothing is reported with its token", () => {
    /** One task whose declared blocker is not an id and not a declared lane. */
    const text = ["## TODOs", "", "1. do it (blocked by the other lane).", ""].join("\n")
    /** The parsed document. */
    const plan = parsePlanMarkdown(text)
    expect(plan.problems.length).toBe(1)
    expect(plan.problems.every((problem) => problem.reason.includes("names no task id"))).toBe(true)
    expect(plan.problems[0]?.text).toBe("1. do it (blocked by the other lane).")
  })

  test("a lane table row without an owner is a problem, not a silent skip", () => {
    /** A lane table whose second row leaves the owner cell empty. */
    const text = ["| Lane | Owner |", "|---|---|", "| **A. core** |  |", ""].join("\n")
    /** The parsed document. */
    const plan = parsePlanMarkdown(text)
    expect(plan.lanes).toEqual([])
    expect(plan.problems.length).toBe(1)
    expect(plan.problems[0]?.reason).toContain("no owner")
  })
})

describe("determinism", () => {
  test("the same document parses to the same result twice", () => {
    expect(parsePlanMarkdown(FIXTURE)).toEqual(parsePlanMarkdown(FIXTURE))
  })

  test("tasks are ordered by id even when the document is not", () => {
    /** A TODO section written out of order. */
    const text = ["## TODOs", "", "3. third.", "1. first.", "2. second.", ""].join("\n")
    /** The parsed document. */
    const plan = parsePlanMarkdown(text)
    expect(plan.tasks.map((task) => task.id)).toEqual(["T1", "T2", "T3"])
  })
})
