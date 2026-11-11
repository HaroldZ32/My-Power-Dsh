// CELLWORK HANDOFF — the document a checkpointed member must write before its context is compressed
// (contract B8, plan §4.6 step 3), and the cellwork half of the ONE seven-section contract.
//
// WHY A DOCUMENT AND NOT A SUMMARY. The agent is about to be compacted or reseeded: whatever it does not
// write down is lost, and the NEXT agent (the promoted subcaptain, or a fresh child) continues from this
// file alone. The seven sections are therefore the minimum needed to continue honestly — the task, the
// state, the decisions (with why), the artifacts, what was VERIFIED, what is still open, and the single
// next step. `cellwork_handoff` REFUSES a document missing any of them and names what is missing.
//
// ONE CONTRACT, ONE HOME (§7.2). This module used to carry a PRIVATE copy of the section list and its
// parser/validator beside `packages/mpd-team-core-plugin/src/team-handoff.ts`, which carries the same
// rule for the team plane — two copies that could drift apart. The validator now lives ONLY on the team
// plane and is re-exported here, so every cellwork call site keeps its import and a validation error
// still names the same missing section. What stays CELLWORK's is the DESTINATION and the write below:
// a cell's handoff lands under `.mpd/cellwork/<cell>/handoff/`, not the team plane's tree, so this
// module is pure apart from that one file write.
import { atomicWriteText, handoffPath } from "./state"

// THE ONE VALIDATOR, RE-EXPORTED: the seven-section rule is the team plane's, never a second copy here.
export { validateHandoffText, type HandoffValidation } from "../../mpd-team-core-plugin/src/team-handoff"

/**
 * Write one member's handoff document and answer its absolute path.
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell the handoff belongs to.
 * @param member - the member's board name.
 * @param ordinal - the handoff ordinal (`handoffs + 1`).
 * @param text - the validated document body.
 * @returns the absolute path written.
 */
export function writeHandoff(workspace: string, cellId: string, member: string, ordinal: number, text: string): string {
  /** The absolute document path. */
  const path = handoffPath(workspace, cellId, member, ordinal)
  atomicWriteText(path, text.endsWith("\n") ? text : text + "\n")
  return path
}
