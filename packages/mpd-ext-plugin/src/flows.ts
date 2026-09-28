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

/**
 * Flow-document keys the contract reads (EXTENSIONS-FOR-AGENTS.md section 2, `flows` row).
 * Every OTHER key is refused per file as `unknown flow key "<k>"`, never ignored.
 */
const FLOW_KEYS = ["id", "title", "description", "whenToUse", "steps"]
/**
 * Step keys the contract reads; an extra one is refused per file as `unknown step key "<k>"`.
 * `detail` / `tool` / `output` are hints only — nothing in this module acts on them.
 */
const FLOW_STEP_KEYS = ["title", "detail", "tool", "output"]

/** One step of a flow document: a required title plus an optional action, tool hint and expected output. */
export interface MpdFlowStep {
  /** Required, non-empty; rendered as the step's numbered bold label. */
  title: string
  /** The action to take; rendered verbatim under the step title. */
  detail?: string
  /** Tool hint only (`read`, `bash`, `mcp__server__tool`, …); no step is ever executed here. */
  tool?: string
  /** What the step is expected to produce; rendered as the step's expected-output line. */
  output?: string
}

/** One validated flow document: exactly the keys the `flows` kind documents, nothing more. */
export interface MpdFlow {
  /** Flow id, which is ALSO the skill name it is served under, so the skill-name grammar applies to it. */
  id: string
  /** Non-empty display title; becomes the rendered document's `#` heading. */
  title: string
  /** Non-empty skill description: the text the model reads before deciding to load the flow. */
  description: string
  /** Optional selection hint; the renderer substitutes a generic sentence when it is absent. */
  whenToUse?: string
  /** At least one step: an empty array is refused with `flow steps is required and must be a non-empty array`. */
  steps: MpdFlowStep[]
}

/** Outcome of reading one flows directory: the documents that validated, their skill entries, and the per-file problems. */
export interface FlowLoadResult {
  /** Documents that parsed AND whose rendered skill passed both pre-publication checks. */
  flows: MpdFlow[]
  /** Ready-to-serve skill entries, positionally parallel to `flows`. */
  entries: SkillDocumentEntry[]
  /** One line per skipped file or step problem; never fatal, because the rest of the directory still loads. */
  errors: MpdExtLoadError[]
}



/**
 * Keys of the foreign JSON object that the contract does not read. They are REFUSED here
 * rather than ignored, because this repository has measured the opposite failure mode: a
 * validator that silently keeps a renamed key, so the key is accepted and then does nothing.
 */
function unknownKeys(value: Record<string, unknown>, allowed: string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key))
}

/** A non-blank string, or undefined; a whitespace-only value counts as ABSENT, not as present-and-empty. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

/**
 * Parse and validate one flow document; returns errors instead of throwing.
 *
 * The refusals are the DOCUMENTED ones (EXTENSIONS-FOR-AGENTS.md section 5): a missing or
 * blank `id`/`title`/`description`, an `id` outside the skill-name grammar, `steps` that is
 * not a non-empty array, a step with no title, and an unknown key at either level. The result
 * is all-or-nothing: any error means NO `flow` is returned, so a caller can never serve a
 * document that was only partially accepted.
 */
export function parseFlowDocument(raw: unknown, label: string): { flow?: MpdFlow; errors: MpdExtLoadError[] } {
  // Everything wrong with this document, accumulated so `validate` can print one line per problem.
  const errors: MpdExtLoadError[] = []
  if (!isRecord(raw)) return { errors: [{ item: label, reason: "flow document must be a JSON object" }] }
  for (const key of unknownKeys(raw, FLOW_KEYS)) {
    errors.push({ item: label, reason: `unknown flow key "${key}"` })
  }
  // Flow id; it doubles as the served skill name, so the stricter skill-name grammar is the one that applies.
  const id = nonEmptyString(raw.id)
  if (id === undefined) errors.push({ item: label, reason: "flow id is required and must be a non-empty string" })
  else if (!new RegExp(MPD_EXT_SKILL_NAME_PATTERN).test(id)) {
    errors.push({ item: label, reason: `flow id "${id}" must satisfy the skill-name grammar ${MPD_EXT_SKILL_NAME_PATTERN}` })
  }
  // Display title; a blank one is reported, and the whole document is refused along with it.
  const title = nonEmptyString(raw.title)
  if (title === undefined) errors.push({ item: label, reason: "flow title is required and must be a non-empty string" })
  // Skill description the model reads; required and non-blank, like every other skill description.
  const description = nonEmptyString(raw.description)
  if (description === undefined) errors.push({ item: label, reason: "flow description is required and must be a non-empty string" })
  if (raw.whenToUse !== undefined && typeof raw.whenToUse !== "string") {
    errors.push({ item: label, reason: "flow whenToUse must be a string when present" })
  }
  // Steps that survived validation: a step whose title is missing is reported, never collected.
  const steps: MpdFlowStep[] = []
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    errors.push({ item: label, reason: "flow steps is required and must be a non-empty array" })
  } else {
    raw.steps.forEach((step, index) => {
      // Item path for every error about this step, so one message points at exactly one step.
      const at = `${label}.steps[${index}]`
      if (!isRecord(step)) {
        errors.push({ item: at, reason: "step must be a JSON object" })
        return
      }
      for (const key of unknownKeys(step, FLOW_STEP_KEYS)) errors.push({ item: at, reason: `unknown step key "${key}"` })
      // Required step title; without it the step cannot be rendered at all.
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
  // The SKILL.md-shaped document, assembled line by line so an unset optional field is simply absent.
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
 * Read every top-level `*.json` flow in one directory — regular files only, not a
 * subdirectory and not a symlink. A bad file is skipped and recorded (never emitted), and
 * the renderer re-validates its own output before serving: a rendered candidate that fails
 * the skills rules is recorded too.
 *
 * Failures stay per file on purpose: one unreadable or malformed flow must not cost the
 * extension its other flows, so `errors` is returned alongside whatever did load.
 */
export function loadFlows(
  directory: string,
  options: { rank: number; source: string; providerName: string; itemLabel: string },
): FlowLoadResult {
  // Per-file problems; a bad file is recorded here and skipped, never thrown out of the loader.
  const errors: MpdExtLoadError[] = []
  // Validated documents, in sorted file order, so the flow tools answer deterministically.
  const flows: MpdFlow[] = []
  // Skill entries parallel to `flows`; each one already passed the two checks below.
  const entries: SkillDocumentEntry[] = []
  // `*.json` file names in this directory, sorted; assigned inside the try so a read failure is reported, not thrown.
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
    // Absolute path of the file being read; a flow is re-read on every call because no state is cached.
    const path = join(directory, file)
    // Per-file item label: the manifest item plus the file name, so two files never share an error path.
    const label = `${options.itemLabel} (${basename(file)})`
    // Parsed JSON, typed `unknown` on purpose: a flow document is foreign data until `parseFlowDocument` admits it.
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(path, "utf8"))
    } catch (error) {
      errors.push({ item: label, reason: `invalid JSON: ${message(error)}` })
      continue
    }
    // Validation result; `flow` is absent exactly when at least one error was recorded.
    const parsed = parseFlowDocument(raw, label)
    if (parsed.flow === undefined) {
      errors.push(...parsed.errors)
      continue
    }
    // The skill entry this flow WOULD be served as; it is still subject to the two checks below.
    const entry = flowEntry(parsed.flow, { path, directory, source: options.source, rank: options.rank })
    // CANDIDATE check: the harness catalog dereferences `invocation` unguarded in every session's pre-step.
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
    // Second gate, on the DEFINITION the provider would later return for this name.
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
