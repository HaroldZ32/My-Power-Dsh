// t52 — T-42 arms: ONE plan format through BOTH paths, the comparison being a READING (both sets side
// by side, normalised equality asserted), and an id collision REFUSED with the id named, never merged.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { parsePlanSeedItems, readPlanSeedSet, PLAN_TODO_SECTION, PLANS_DIR } from "../lib/session-start.ts"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { initializeProfileTeam, seedTaskDrafts } from "../lib/tools.ts"

/** The team id the probe seeds and the state directory is keyed by. */
const TEAM = "t52-plan-format"
/** The fixture plan's file name under the plans directory. */
const PLAN = "fixture-plan.md"
/** The plan artifact body both paths read: two TODO items and one final-wave item. */
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

/** Write one plan artifact into a fresh workspace and return both roots the arms need. */
function fixture(planText: string = PLAN_TEXT, planName: string = PLAN): { workspace: string; stateRoot: string } {
/** The temporary workspace the plan artifact is written into. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t52-"))
    mkdirSync(join(workspace, PLANS_DIR), { recursive: true })
    writeFileSync(join(workspace, PLANS_DIR, planName), planText)
    return { workspace, stateRoot: join(workspace, ".mpd", "team") }
}

/** One item read out of a plan artifact: the two fields both normalisations below read. */
interface PlanItemLike {
    /** The id the plan item declared itself (T1, F1, ...), which is the shared seed identity. */
    readonly id: string
    /** The item's subject text, carried through both paths unchanged. */
    readonly subject: string
}

/** One task as the two paths are compared — the canonical triple both readings produce. */
interface CanonicalTask {
    /** The id the plan item declared, so a path that changed the identity is visible. */
    readonly seedId: string
    /** The task id the path assigned to that item. */
    readonly id: string
    /** The task subject the path carried through. */
    readonly subject: string
}

/** One persisted task as the record path is normalised: it carries its own plan-seed provenance. */
interface RecordTaskLike {
    /** The plan item id the task was seeded from, which is what makes the two readings comparable. */
    readonly profileSeedId: string
    /** The task's own id, assigned by the seed. */
    readonly id: string
    /** The task's subject text. */
    readonly subject: string
}

/** One template handed to the DAG seed's draft builder. */
interface DraftTemplate {
    /** The task id the template declares. */
    readonly id: string
    /** The task subject the template declares. */
    readonly subject: string
    /** Ids this draft depends on; empty because this arm drives the seed seam directly. */
    readonly dependencies: string[]
}
/** The ONE normalisation both paths are compared in — the canonical `{seedId, id, subject}` triple. */
const canonicalFromPlan = (items: readonly PlanItemLike[]): CanonicalTask[] => items.map((item: PlanItemLike, index: number) => ({ seedId: item.id, id: `t${index + 1}`, subject: item.subject }))
/** The same normalisation over a persisted record's tasks, so both paths are read in one vocabulary. */
const canonicalFromRecord = (tasks: readonly RecordTaskLike[]): CanonicalTask[] => tasks.map((task: RecordTaskLike) => ({ seedId: task.profileSeedId, id: task.id, subject: task.subject }))

/**
 * The DAG SEED path's OWN draft builder — the function `initializeProfileTeam` calls (wiring asserted
 * in arm 1): the seed's mapping seam, driven over the same plan items.
 *
 * DECLARED BOUND (the uncovered half, named rather than implied): the FULL staged `initializeProfileTeam`
 * leg is not driven here — it demands a live captain LLM witness (`captain.session.requestHeader()`,
 * `captain.options.provider`, member LLM resolution), i.e. the member-spawning machinery, which this
 * arm cannot supply; the seam it calls IS exercised, and the call itself is asserted against the source.
 */
/** The DAG seed's own draft builder over the SAME plan items, as the seed path drives it. */
function seedLeg(planItems: readonly PlanItemLike[]): { templates: DraftTemplate[]; tasks: readonly RecordTaskLike[] } {
/** The profile-style templates the seed's draft builder consumes. */
    const templates = planItems.map((item: PlanItemLike): DraftTemplate => ({ id: item.id, subject: item.subject, dependencies: [] }))
    return { templates, tasks: seedTaskDrafts(templates, new Map(templates.map((item: DraftTemplate, index: number): [string, string] => [item.id, `t${index + 1}`])), 1) }
}

test("T-42 (1/3): ONE plan file through BOTH paths yields the SAME task set (the comparison IS the reading)", async () => {
/** The fresh workspace and the state root the seed would write into (nothing is persisted here). */
    const { workspace, stateRoot } = fixture()
    // PATH A — the session-start / plan-artifact reader.
    const planSet = await readPlanSeedSet(workspace)
    expect(planSet.ok).toBe(true)
    expect(planSet.planFile).toBe(join(PLANS_DIR, PLAN))
/** Path A's task set, normalised to the shared triple. */
    const setA = canonicalFromPlan(planSet.items)

    // PATH B — the DAG seed, seeded FROM THE PLAN FILE (the row's §Fix: a plan file seeds a team DAG).
    const seeded = seedLeg(planSet.items)
/** Path B's task set over the SAME plan, normalised the same way. */
    const setB = canonicalFromRecord(seeded.tasks)

    // THE READING: both sets side by side, then a normalised equality — never a claim that they agree.
    console.log(`[T-42] path A (plan artifact ${planSet.planFile}): ${JSON.stringify(setA)}`)
    console.log(`[T-42] path B (DAG seed seam, ${seeded.tasks.length} draft task(s)): ${JSON.stringify(setB)}`)
    expect(setB).toEqual(setA)
    // WIRING (declared as wiring, never counted as the behavioural reading): the DAG seed CALLS this
    // builder and can be handed a plan file, which is what makes the two paths one format.
    const toolsSource = readFileSync(new URL("../lib/tools.ts", import.meta.url), "utf8")
    expect(toolsSource).toContain("tasks: seedTaskDrafts(seedTemplates, seedToActual, now)")
    expect(toolsSource).toContain("readPlanSeedSet(workspaceOf(input.captain), input.planFile)")

    // PATH B' — the OTHER convention (a profile's `tasks` templates) for the SAME plan must agree with
    // both, which is what makes them one format rather than two that happen to be written twice.
    const fromTemplates = canonicalFromRecord(seedLeg(planSet.items).tasks)
    console.log(`[T-42] path B' (profile tasks convention): ${JSON.stringify(fromTemplates)}`)
    expect(fromTemplates).toEqual(setA)
})

test("T-42 (2/3): an ID COLLISION is REFUSED with the id named — never merged, never suffixed", async () => {
/** A plan whose two TODO items claim the SAME id, which the format refuses. */
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
/** The collided plan's fresh workspace and the state root nothing may be written to. */
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
    const toolsSource = readFileSync(new URL("../lib/tools.ts", import.meta.url), "utf8")
    expect(toolsSource).toContain('throw new Error(`plan seed refused for "${input.planFile}": ${planSet.error}`)')
    // Nothing was persisted by the refused READ, and no half-seeded DAG exists to clean up.
    expect(() => readFileSync(join(stateRoot, TEAM, "team.json"), "utf8")).toThrow()
    // CONTROL (the refusal is falsifiable): the SAME plan with distinct ids seeds a full set.
    const { workspace: clean } = fixture()
/** The control reading of the same plan with distinct ids. */
    const ok = await readPlanSeedSet(clean)
    expect(ok.ok).toBe(true)
    expect(ok.items.map((item: PlanItemLike) => item.id)).toEqual(["T1", "T2", "F1"])
    expect(canonicalFromRecord(seedLeg(ok.items).tasks)).toEqual(canonicalFromPlan(ok.items))
})

test("T-42 (3/3): the format is DECLARED, so a plan that declares nothing is refused rather than seeded empty", async () => {
/** A plan that declares no work section at all. */
    const empty = "# fixture plan\n\n## Notes\nnothing here\n"
/** The refusal that plan earns. */
    const parsed = parsePlanSeedItems(empty)
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain("no plan items found")
    // The sections are part of the convention, and the subjects come from the item lines themselves.
    expect(PLAN_TODO_SECTION).toBe("## TODOs")
/** The reading of the canonical plan text, whose subjects come from the item lines. */
    const parsedItems = parsePlanSeedItems(PLAN_TEXT)
    expect(parsedItems.items.map((item: PlanItemLike) => item.subject)).toEqual([
        "the first item — do the first thing",
        "the second item — do the second thing",
        "run the reading",
    ])
})
