// THE PACKAGE'S PUBLIC SURFACE (frozen contract `.mpd/plans/mail-unify.md`, §4).
//
// Export the vocabulary, the pure validators, the tolerant fold and the two planning helpers from ONE
// barrel, so the team mailbox and the cellwork view import the same rules with no second copy. The
// package is library-only: no cordis row, no patch entry, no runtime dependency.

export { INDEX_FIELD_NAMES, MAIL_KINDS, MAIL_PAYLOADS_CARRY_NO_INDEX, isMailKind } from "./types.ts"
export type {
  HasNoIndexField,
  IndexFieldName,
  MailAddress,
  MailAnswer,
  MailCheck,
  MailEnvelope,
  MailKind,
  MailMessage,
  MailOption,
  MailProblem,
  MailProblemCode,
  MailQuestion,
  MailSendRecord,
  MailboxFold,
} from "./types.ts"
export {
  fanOutTargets,
  findIndexFields,
  inheritedThreadId,
  labelsOf,
  ordinalPrefix,
  validateAnswer,
  validateEnvelope,
  validateQuestion,
  validateReferences,
  withOrdinal,
} from "./validate.ts"
export { foldMail } from "./fold.ts"
