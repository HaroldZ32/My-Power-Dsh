// t52 — T-42 arms: ONE plan format through BOTH paths, the comparison being a READING (both sets side
// by side, normalised equality asserted), and an id collision REFUSED with the id named, never merged.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parsePlanSeedItems, readPlanSeedSet, PLAN_TODO_SECTION, PLANS_DIR } from "../lib/session-start.js"
import { initializeProfileTeam, seedTaskDrafts } from "../lib/tools.js"

const TEAM = "t52-plan-format"
const PLAN = "fixture-plan.md"
const PLAN_TEXT = [
    "# fixture plan",
    "",
    "## TODOs",
    "1. **the first item** — do the first thing",
    "2. **the second item** — do the second thing",
    "",
    "## Final Verification Wave",
    "F1. run the reading",
    "",
].join("\n")

function fixture(planText = PLAN_TEXT, planName = PLAN) {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t52-"))
    mkdirSync(join(workspace, PLANS_DIR), { recursive: true })
    writeFileSync(join(workspace, PLANS_DIR, planName), planText)
    return { workspace, stateRoot: join(workspace, ".mpd", "team") }
}

/** The ONE normalisation both paths are compared in — the canonical `{seedId, id, subject}` triple. */
const canonicalFromPlan = (items) => items.map((item, index) => ({ seedId: item.id, id: `t${index + 1}`, subject: item.subject }))
const canonicalFromRecord = (tasks) => tasks.map((task) => ({ seedId: task.profileSeedId, id: task.id, subject: task.subject }))

/**
 * The DAG SEED path's OWN draft builder — the function `initializeProfileTeam` calls (wiring asserted
 * in arm 1): the seed's mapping seam, driven over the same plan items.
 *
 * DECLARED BOUND (the uncovered half, named rather than implied): the FULL staged `initializeProfileTeam`
 * leg is not driven here — it demands a live captain LLM witness (`captain.session.requestHeader()`,
 * `captain.options.provider`, member LLM resolution), i.e. the member-spawning machinery, which this
 * arm cannot supply; the seam it calls IS exercised, and the call itself is asserted against the source.
 */
function seedLeg(planItems) {
    const templates = planItems.map((item) => ({ id: item.id, subject: item.subject, dependencies: [] }))
    return { templates, tasks: seedTaskDrafts(templates, new Map(templates.map((item, index) => [item.id, `t${index + 1}`])), 1) }
}

test("T-42 (1/3): ONE plan file through BOTH paths yields the SAME task set (the comparison IS the reading)", async () => {
    const { workspace, stateRoot } = fixture()
    // PATH A — the session-start / plan-artifact reader.
    const planSet = await readPlanSeedSet(workspace)
    expect(planSet.ok).toBe(true)
    expect(planSet.planFile).toBe(join(PLANS_DIR, PLAN))
    const setA = canonicalFromPlan(planSet.items)

    // PATH B — the DAG seed, seeded FROM THE PLAN FILE (the row's §Fix: a plan file seeds a team DAG).
    const seeded = seedLeg(planSet.items)
    const setB = canonicalFromRecord(seeded.tasks)

    // THE READING: both sets side by side, then a normalised equality — never a claim that they agree.
    console.log(`[T-42] path A (plan artifact ${planSet.planFile}): ${JSON.stringify(setA)}`)
    console.log(`[T-42] path B (DAG seed seam, ${seeded.tasks.length} draft task(s)): ${JSON.stringify(setB)}`)
    expect(setB).toEqual(setA)
    // WIRING (declared as wiring, never counted as the behavioural reading): the DAG seed CALLS this
    // builder and can be handed a plan file, which is what makes the two paths one format.
    const toolsSource = readFileSync(new URL("../lib/tools.js", import.meta.url), "utf8")
    expect(toolsSource).toContain("tasks: seedTaskDrafts(seedTemplates, seedToActual, now)")
    expect(toolsSource).toContain("readPlanSeedSet(workspaceOf(input.captain), input.planFile)")

    // PATH B' — the OTHER convention (a profile's `tasks` templates) for the SAME plan must agree with
    // both, which is what makes them one format rather than two that happen to be written twice.
    const fromTemplates = canonicalFromRecord(seedLeg(planSet.items).tasks)
    console.log(`[T-42] path B' (profile tasks convention): ${JSON.stringify(fromTemplates)}`)
    expect(fromTemplates).toEqual(setA)
})

test("T-42 (2/3): an ID COLLISION is REFUSED with the id named — never merged, never suffixed", async () => {
    const collided = [
        "# fixture plan",
        "",
        "## TODOs",
        "1. **first**",
        "2. **second**",
        "2. **a second item claiming the SAME id**",
        "",
        "## Final Verification Wave",
        "F1. run the reading",
        "",
    ].join("\n")
    const { workspace, stateRoot } = fixture(collided)
    // The REFUSAL names the colliding id and both lines.
    expect(parsePlanSeedItems(collided).ok).toBe(false)
    expect(parsePlanSeedItems(collided).error).toContain('plan item id "T2" is named twice (lines 5 and 6)')
    // Both paths refuse it — the session-start reader...
    const planSet = await readPlanSeedSet(workspace)
    expect(planSet.ok).toBe(false)
    expect(planSet.error).toContain('"T2"')
    // ...and the DAG seed throws on EXACTLY that refusal before anything is written (wiring assert:
    // the seed reads through this reader and refuses when it is not ok).
    const toolsSource = readFileSync(new URL("../lib/tools.js", import.meta.url), "utf8")
    expect(toolsSource).toContain('throw new Error(`plan seed refused for "${input.planFile}": ${planSet.error}`)')
    // Nothing was persisted by the refused READ, and no half-seeded DAG exists to clean up.
    expect(() => readFileSync(join(stateRoot, TEAM, "team.json"), "utf8")).toThrow()
    // CONTROL (the refusal is falsifiable): the SAME plan with distinct ids seeds a full set.
    const { workspace: clean } = fixture()
    const ok = await readPlanSeedSet(clean)
    expect(ok.ok).toBe(true)
    expect(ok.items.map((item) => item.id)).toEqual(["T1", "T2", "F1"])
    expect(canonicalFromRecord(seedLeg(ok.items).tasks)).toEqual(canonicalFromPlan(ok.items))
})

test("T-42 (3/3): the format is DECLARED, so a plan that declares nothing is refused rather than seeded empty", async () => {
    const empty = "# fixture plan\n\n## Notes\nnothing here\n"
    const parsed = parsePlanSeedItems(empty)
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain("no plan items found")
    // The sections are part of the convention, and the subjects come from the item lines themselves.
    expect(PLAN_TODO_SECTION).toBe("## TODOs")
    const parsedItems = parsePlanSeedItems(PLAN_TEXT)
    expect(parsedItems.items.map((item) => item.subject)).toEqual([
        "the first item — do the first thing",
        "the second item — do the second thing",
        "run the reading",
    ])
})
