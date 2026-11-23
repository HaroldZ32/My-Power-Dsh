import { randomUUID } from "node:crypto"
import { readArchivedPlan, type StagedMember } from "./plan-store"
import { locateProject, ProjectAdmissionError, type ProjectLocation, type ProjectMember, type ProjectRecord } from "./project-store"
import { listTeams } from "./team-store"

/**
 * Normalize a candidate workmate name to the library's key spelling.
 * @param raw - the name as a caller spelled it.
 * @returns the lowercase `[a-z0-9_-]` key, or `""` when nothing usable remains.
 */
export function workmateKeyOf(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "")
}

/**
 * The EXPLICIT workmate a staged member names, if any.
 *
 * The spelling is ONE line — `workmate: <name>` or `[workmate: <name>]` — in the member's prompt first,
 * then its description. A line form is used rather than a new staged-field because the staged plan's
 * member shape is the public schema of `agent_teams_plan`; a marker line is visible to the captain in
 * the plan text and needs no schema change.
 * @param member - the staged member to read.
 * @returns the key it names, or undefined when it names none.
 */
export function explicitWorkmateOf(member: StagedMember): string | undefined {
  /** The marker, anchored to a whole line so prose that merely mentions "workmate:" cannot match. */
  const marker = /^[ \t]*\[?workmate[ \t]*:[ \t]*([A-Za-z0-9_-]+)\]?[ \t]*$/m
  for (const text of [member.prompt, member.description]) {
    /** The marker's capture on this text, when it carries one. */
    const hit = marker.exec(String(text ?? ""))
    if (hit !== null) {
      /** The normalized key the marker names. */
      const key = workmateKeyOf(hit[1])
      if (key !== "") return key
    }
  }
  return undefined
}

/** An authenticated project's durable seats reached before automatic Workmate selection. */
export interface ProjectRosterBindings {
  /** Direct logical hits and unambiguous legacy reconstructions for this plan. */
  readonly byLogicalName: ReadonlyMap<string, ProjectMember>
  /** An existing canonical roster identity is independently checked under admission. */
  readonly projectId?: string
  /** Every prior display alias is reserved to its own identity, including omitted seats. */
  readonly members: readonly ProjectMember[]
}

/** A legacy approved plan can reveal a logical-to-display binding without depending on array order. */
interface LegacyEvidence {
  /** Logical names from participating approved plans that demonstrably declared this seat. */
  readonly hits: Map<string, Map<string, ProjectMember>>
  /** Logical names seen in a prior approval without a complete binding witness. */
  readonly uncertain: Set<string>
}

/** Gather only corroborated claims from an approved plan and its matching board roster. */
function legacyEvidence(root: string, members: readonly ProjectMember[], names: ReadonlySet<string>, archiveRoots: readonly string[]): LegacyEvidence {
  /** Unordered candidates are grouped by stable id, so duplicates never pick a different account. */
  const hits = new Map<string, Map<string, ProjectMember>>()
  /** An unresolved historic approval keeps the matching legacy declaration uncertain. */
  const uncertain = new Set<string>()
  for (const board of listTeams(root)) {
    if (board.approvedAt === undefined || board.planId === undefined || !board.members.some((member) => member.projectScope !== "run")) continue
    /** A legacy plan can have been archived in an authorized sibling checkout. */
    const archives = archiveRoots.map((checkout) => readArchivedPlan(checkout, board.planId ?? ""))
      .filter((candidate) => candidate?.sessionId === board.leadSessionId && candidate?.approvedAt !== undefined && candidate?.created !== undefined)
    /** Canonical and old stage locations may carry equal copies, but conflicting copies prove nothing. */
    const plan = archives[0]
    if (plan?.created === undefined) continue
    if (archives.some((candidate) => JSON.stringify(candidate) !== JSON.stringify(plan))) {
      for (const candidate of archives) {
        for (const staged of candidate?.members ?? []) if (names.has(staged.name)) uncertain.add(staged.name)
      }
      continue
    }
    for (const staged of plan.members) {
      if (!names.has(staged.name) || staged.scope === "run" || board.members.some((member) => member.name === staged.name && member.projectScope === "run")) continue
      /** A historical declaration must prove at least one binding on its own board. */
      let witnessed = false
      /** Binding carries the original declaration's exact description through to the old board. */
      const sameDeclaration = plan.members.filter((entry) => entry.description === staged.description && entry.role === staged.role)
      /** A historical explicit pin is an exact witness when the approved board corroborates it. */
      const pin = explicitWorkmateOf(staged)
      for (const row of board.members) {
        if (row.projectMemberId === undefined || row.status === "failed" || !plan.created.members.some((entry) => entry.name === row.name)) continue
        /** Exact declared name wins in plain boards; a renamed row requires a unique copied declaration. */
        const exact = row.name === staged.name
        /** A prior Workmate rename must still copy an otherwise unique declaration visibly. */
        const copied = pin === undefined && sameDeclaration.length === 1 && row.workmate === row.name && row.description === staged.description && row.role === staged.role
        if (!exact && !copied && (pin === undefined || row.workmate !== pin)) continue
        /** The current project record must corroborate the old board's own durable identity. */
        const seat = members.find((member) => member.memberId === row.projectMemberId && member.name === row.name)
        if (seat === undefined || (seat.logicalName !== undefined && seat.logicalName !== staged.name)) continue
        witnessed = true
        /** Conflicting historic boards are accumulated and declined, never resolved by recency or order. */
        const choices = hits.get(staged.name) ?? new Map<string, ProjectMember>()
        choices.set(seat.memberId, { ...seat, ...(row.workmate === undefined ? {} : { workmate: row.workmate }) })
        hits.set(staged.name, choices)
      }
      if (!witnessed) uncertain.add(staged.name)
    }
  }
  return { hits, uncertain }
}

/** Resolve old entries only when the current canonical project and historical proof agree. */
export function readProjectRosterBindings(workspace: string, planMembers: readonly StagedMember[], boardAliases: boolean = false): ProjectRosterBindings {
  return projectRosterBindingsAt(locateProject(workspace), planMembers, boardAliases)
}

/** Resolve bindings against an identified project, including admission's current locked snapshot. */
export function projectRosterBindingsAt(location: ProjectLocation, planMembers: readonly StagedMember[], boardAliases: boolean = false): ProjectRosterBindings {
  /** Project roster, absent before the first admitted team. */
  const record = location.record
  /** Local one-to-one binding projection that can be validated again under the admission lock. */
  const byLogicalName = new Map<string, ProjectMember>()
  if (record === undefined) return { byLogicalName, members: [] }
  /** Only unrecorded logical declarations need a legacy archive read. */
  const unknown = new Set(planMembers.filter((staged) => !record.members.some((member) => member.logicalName === staged.name)).map((staged) => staged.name))
  /** Existing logical declarations are authoritative and do not rescan archived plans. */
  const history = unknown.size > 0 && record.members.some((member) => member.logicalName === undefined)
    ? legacyEvidence(record.projectRoot, record.members, unknown, [...new Set([record.projectRoot, ...location.roots])])
    : undefined
  for (const staged of planMembers) {
    /** Stable name is independent of whatever display key a future matcher recommends. */
    const own = record.members.filter((member) => member.logicalName === staged.name)
    /** The old exact display shorthand is eligible only when it did not name a newer logical seat. */
    const legacy = record.members.filter((member) => (boardAliases || member.logicalName === undefined) && member.name === staged.name)
    /** Archived evidence carries the historical Workmate binding when one was present. */
    const mapped = history?.hits.get(staged.name)
    /** A current durable logical declaration supersedes old alias reconstruction. */
    const hits = new Map(own.length > 0 ? own.map((seat) => [seat.memberId, seat] as const) : [
      ...legacy.map((seat) => [seat.memberId, seat] as const), ...(mapped ?? []),
    ])
    if (hits.size > 1 || (own.length === 0 && history?.uncertain.has(staged.name))) {
      throw new ProjectAdmissionError(`legacy roster binding for ${JSON.stringify(staged.name)} is ambiguous in project ${record.projectId}; no member was assigned`)
    }
    /** A unique witness may be reused; absence is a genuinely new declaration. */
    const hit = hits.values().next().value
    if (hit !== undefined) {
      if ([...byLogicalName.values()].some((seat) => seat.memberId === hit.memberId)) {
        throw new ProjectAdmissionError(`roster binding for ${JSON.stringify(staged.name)} names a member already declared on this plan`)
      }
      byLogicalName.set(staged.name, hit)
    }
  }
  return { byLogicalName, members: record.members, projectId: record.projectId }
}

/** Exact route and role declarations passed by plan approval and live roster changes. */
export type MemberDeclaration = Omit<ProjectMember, "memberId"> & {
  /** The durably observed predecessor, verified again under the admission lock. */
  readonly previous?: Pick<ProjectMember, "memberId" | "name" | "logicalName">
}

/** Apply logical declarations against the same roster under the project admission lock. */
export function declareMembers(record: ProjectRecord, declarations: readonly MemberDeclaration[]): ProjectRecord {
  /** Copy only on a real addition, unambiguous migration or explicit change of binding. */
  let roster = record.members
  for (const declaration of declarations) {
    /** Undecorated declarations keep the already supported direct member-add spelling. */
    const logicalName = declaration.logicalName ?? declaration.name
    /** A known logical owner takes precedence over any old display alias. */
    const matching = roster.filter((member) => (member.logicalName ?? member.name) === logicalName)
    if (matching.length > 1) throw new ProjectAdmissionError(`roster binding for ${JSON.stringify(logicalName)} is ambiguous in project ${record.projectId}`)
    /** Only a unique current logical declaration can be reused. */
    const direct = matching[0]
    /** Legacy adoption and changed Workmate pins retain the preflight's exact member id. */
    const previous = declaration.previous
    /** This row is the only permissible destination of the current declaration. */
    const owner = previous === undefined ? direct : roster.find((member) => member.memberId === previous.memberId)
    if (previous !== undefined && (owner === undefined || owner.name !== previous.name || owner.logicalName !== previous.logicalName || (owner.logicalName !== undefined && owner.logicalName !== logicalName) || (direct !== undefined && direct.memberId !== owner.memberId))) {
      throw new ProjectAdmissionError(`roster binding for ${JSON.stringify(logicalName)} changed during approval; retry with the current roster`)
    }
    /** Logical and display names share the board's address space, so neither may reserve another seat's alias. */
    const collision = roster.find((member) => member.memberId !== owner?.memberId &&
      [member.name, member.logicalName, member.workmate].some((alias) => alias === declaration.name || alias === logicalName))
    if (collision !== undefined) throw new ProjectAdmissionError(`roster address ${JSON.stringify(logicalName)} / ${JSON.stringify(declaration.name)} is reserved for ${JSON.stringify(collision.logicalName ?? collision.name)}`)
    if (owner === undefined) {
      roster = [...roster, { memberId: randomUUID(), name: declaration.name, logicalName, ...(declaration.workmate === undefined ? {} : { workmate: declaration.workmate }), ...(declaration.role === undefined ? {} : { role: declaration.role }), route: declaration.route }]
      continue
    }
    if (previous === undefined && declaration.logicalName !== undefined && (owner.name !== declaration.name || owner.workmate !== declaration.workmate)) {
      throw new ProjectAdmissionError(`roster binding for ${JSON.stringify(logicalName)} changed during approval; retry with the current roster`)
    }
    /** Existing role and route remain pinned when an explicit Workmate changes only its binding. */
    const name = previous === undefined ? owner.name : declaration.name
    /** A composition may skip Workmate injection without forgetting the admitted library binding. */
    const workmate = declaration.workmate ?? owner.workmate
    if (owner.name !== name || owner.logicalName === undefined || owner.workmate !== workmate) {
      roster = roster.map((member) => member.memberId === owner.memberId ? { ...owner, name, logicalName, ...(workmate === undefined ? {} : { workmate }) } : member)
    }
  }
  return roster === record.members ? record : { ...record, members: roster }
}
