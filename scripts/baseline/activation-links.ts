import { key } from "./input.ts"
import type { Row } from "./input.ts"

/** Legacy planning and minted identities remain separate from the execution pointer. */
const fields = ["planningTeamId", "mintedTeamId", "resolvedTeamId", "teamId", "recordedTeamId"] as const

/** One team identity written by an activation producer and the status of its attribution. */
type ActivationLink = {
  readonly teamId: string
  readonly field: (typeof fields)[number]
  readonly confirmed: boolean
}

/** Inspect an activate receipt without promoting its input pointer or unverified fallback. */
export function activationLinks(row: Row): readonly ActivationLink[] {
  /** The resolved team supersedes the input pointer when they differ. */
  const resolvedTeamId = key(row.resolvedTeamId)
  /** An older receipt may only name its execution team with `teamId`. */
  const executionTeamId = resolvedTeamId ?? key(row.teamId)
  return fields.flatMap((field) => {
    /** An empty recorded slot carries no board identity. */
    const teamId = key(row[field])
    if (teamId === undefined) return []
    /** Planning and minting are independent observations even when execution resolution was unverified. */
    const confirmed = field === "planningTeamId" || field === "mintedTeamId"
      || (row.boardResolution !== "unverified" && teamId === executionTeamId)
    return [{ field, teamId, confirmed }]
  })
}
