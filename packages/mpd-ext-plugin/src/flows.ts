// mpd-ext-plugin flows plane.
//
// The harness has no flow seam (its only orchestration service is
// `workflowEngine`), so a flow adds NO new seam: the renderer turns a
// declarative JSON flow into an in-memory SKILL.md-shaped document and serves
// it through the SAME skills provider. A flow therefore IS a skill candidate,
// and its id must satisfy the skill-name grammar — the descriptor id grammar is
// looser (`a-` or `a--b` are legal extension ids and illegal skill names), so a
// violating flow is rejected loudly per file instead of being emitted.
//
// v1 is JSON-only (zero-dependency rule; YAML is a documented follow-up) and
// declarative: nothing here executes a step, spawns anything or keeps state.
import { readFileSync, readdirSync } from "node:fs"
import { basename, join } from "node:path"
import { MPD_EXT_SKILL_NAME_PATTERN, type MpdExtLoadError } from "./sdk"
import { candidateViolation, definitionViolation, type SkillDocumentEntry } from "./skills"
import { errorMessage as message, isRecord } from "../../mpd-dsh-adapter-plugin/src/index"

const FLOW_KEYS = ["id", "title", "description", "whenToUse", "steps"]
const FLOW_STEP_KEYS = ["title", "detail", "tool", "output"]

export interface MpdFlowStep {
  title: string
  detail?: string
  tool?: string
  output?: string
}

export interface MpdFlow {
  id: string
  title: string
  description: string
  whenToUse?: string
  steps: MpdFlowStep[]
}

export interface FlowLoadResult {
  flows: MpdFlow[]
  entries: SkillDocumentEntry[]
  errors: MpdExtLoadError[]
}



function unknownKeys(value: Record<string, unknown>, allowed: string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key))
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

/** Parse and validate one flow document; returns errors instead of throwing. */
export function parseFlowDocument(raw: unknown, label: string): { flow?: MpdFlow; errors: MpdExtLoadError[] } {
  const errors: MpdExtLoadError[] = []
  if (!isRecord(raw)) return { errors: [{ item: label, reason: "flow document must be a JSON object" }] }
  for (const key of unknownKeys(raw, FLOW_KEYS)) {
    errors.push({ item: label, reason: `unknown flow key "${key}"` })
  }
  const id = nonEmptyString(raw.id)
  if (id === undefined) errors.push({ item: label, reason: "flow id is required and must be a non-empty string" })
  else if (!new RegExp(MPD_EXT_SKILL_NAME_PATTERN).test(id)) {
    errors.push({ item: label, reason: `flow id "${id}" must satisfy the skill-name grammar ${MPD_EXT_SKILL_NAME_PATTERN}` })
  }
  const title = nonEmptyString(raw.title)
  if (title === undefined) errors.push({ item: label, reason: "flow title is required and must be a non-empty string" })
  const description = nonEmptyString(raw.description)
  if (description === undefined) errors.push({ item: label, reason: "flow description is required and must be a non-empty string" })
  if (raw.whenToUse !== undefined && typeof raw.whenToUse !== "string") {
    errors.push({ item: label, reason: "flow whenToUse must be a string when present" })
  }
  const steps: MpdFlowStep[] = []
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    errors.push({ item: label, reason: "flow steps is required and must be a non-empty array" })
  } else {
    raw.steps.forEach((step, index) => {
      const at = `${label}.steps[${index}]`
      if (!isRecord(step)) {
        errors.push({ item: at, reason: "step must be a JSON object" })
        return
      }
      for (const key of unknownKeys(step, FLOW_STEP_KEYS)) errors.push({ item: at, reason: `unknown step key "${key}"` })
      const stepTitle = nonEmptyString(step.title)
      if (stepTitle === undefined) errors.push({ item: at, reason: "step title is required and must be a non-empty string" })
      for (const key of ["detail", "tool", "output"] as const) {
        if (step[key] !== undefined && typeof step[key] !== "string") errors.push({ item: `${at}.${key}`, reason: `step ${key} must be a string when present` })
      }
      if (stepTitle !== undefined) {
        steps.push({
          title: stepTitle,
          ...(nonEmptyString(step.detail) === undefined ? {} : { detail: step.detail as string }),
          ...(nonEmptyString(step.tool) === undefined ? {} : { tool: step.tool as string }),
          ...(nonEmptyString(step.output) === undefined ? {} : { output: step.output as string }),
        })
      }
    })
  }
  if (errors.length > 0) return { errors }
  return {
    flow: {
      id: id as string,
      title: title as string,
      description: description as string,
      ...(typeof raw.whenToUse === "string" && raw.whenToUse.length > 0 ? { whenToUse: raw.whenToUse } : {}),
      steps,
    },
    errors: [],
  }
}

/** Render one flow into the in-memory SKILL.md-shaped document the model reads. */
export function renderFlowSkill(flow: MpdFlow): string {
  const lines: string[] = [`# ${flow.title}`, "", flow.description, "", "## When to use", ""]
  lines.push(
    flow.whenToUse === undefined || flow.whenToUse.length === 0
      ? "Use when the task matches the procedure below."
      : flow.whenToUse,
  )
  lines.push("", "## Steps", "")
  flow.steps.forEach((step, index) => {
    lines.push(`${index + 1}. **${step.title}**`)
    if (step.detail !== undefined) lines.push(`   ${step.detail}`)
    if (step.tool !== undefined) lines.push(`   - tool: \`${step.tool}\``)
    if (step.output !== undefined) lines.push(`   - expected output: ${step.output}`)
    lines.push("")
  })
  lines.push(
    "This flow is declarative: it describes the procedure, it does not execute it.",
    "Follow the steps with your own tools and report what each step produced.",
    "",
  )
  return lines.join("\n")
}

/** Turn one validated flow into a skill document entry (candidate + loader). */
export function flowEntry(
  flow: MpdFlow,
  options: { path: string; directory: string; source: string; rank: number },
): SkillDocumentEntry {
  return {
    document: {
      name: flow.id,
      description: flow.description,
      ...(flow.whenToUse === undefined ? {} : { whenToUse: flow.whenToUse }),
      invocation: { modelInvocable: true, userInvocable: true },
      content: renderFlowSkill(flow),
      resourceBase: { kind: "directory", path: options.directory },
      path: options.path,
    },
    locator: { kind: "flow", extId: options.source, flowId: flow.id, path: options.path },
    source: options.source,
    rank: options.rank,
  }
}

/**
 * Read every `*.json` flow in one directory. A bad file is skipped and recorded
 * (never emitted), and the renderer re-validates its own output before serving:
 * a rendered candidate that fails the skills rules is recorded too.
 */
export function loadFlows(
  directory: string,
  options: { rank: number; source: string; providerName: string; itemLabel: string },
): FlowLoadResult {
  const errors: MpdExtLoadError[] = []
  const flows: MpdFlow[] = []
  const entries: SkillDocumentEntry[] = []
  let files: string[]
  try {
    files = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    errors.push({ item: options.itemLabel, reason: `cannot read flows directory ${directory}: ${message(error)}` })
    return { flows, entries, errors }
  }
  for (const file of files) {
    const path = join(directory, file)
    const label = `${options.itemLabel} (${basename(file)})`
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(path, "utf8"))
    } catch (error) {
      errors.push({ item: label, reason: `invalid JSON: ${message(error)}` })
      continue
    }
    const parsed = parseFlowDocument(raw, label)
    if (parsed.flow === undefined) {
      errors.push(...parsed.errors)
      continue
    }
    const entry = flowEntry(parsed.flow, { path, directory, source: options.source, rank: options.rank })
    const candidateViolationReason = candidateViolation(
      {
        name: entry.document.name,
        description: entry.document.description,
        ...(entry.document.whenToUse === undefined ? {} : { whenToUse: entry.document.whenToUse }),
        invocation: entry.document.invocation,
        source: entry.source,
        provider: options.providerName,
        rank: entry.rank,
        locator: entry.locator,
      },
      options.providerName,
    )
    if (candidateViolationReason !== undefined) {
      errors.push({ item: label, reason: `rendered flow skill is not servable: ${candidateViolationReason}` })
      continue
    }
    const definitionViolationReason = definitionViolation(
      {
        name: entry.document.name,
        description: entry.document.description,
        invocation: entry.document.invocation,
        content: entry.document.content,
        provider: options.providerName,
      },
      options.providerName,
      entry.document.name,
    )
    if (definitionViolationReason !== undefined) {
      errors.push({ item: label, reason: `rendered flow document is not servable: ${definitionViolationReason}` })
      continue
    }
    flows.push(parsed.flow)
    entries.push(entry)
  }
  return { flows, entries, errors }
}
