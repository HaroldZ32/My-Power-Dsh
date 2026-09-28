/** One `replace` edit: replace the anchor line, or the inclusive `pos`..`end` range, with `lines`. */
export interface ReplaceEdit {
  /** Operation discriminator; the applier switches on this literal. */
  op: "replace"
  /** Primary anchor in the `LINE#HASH` form; when `pos` is absent the caller's `end` anchor is used. */
  pos: string
  /** Inclusive range end anchor; omitted for a single-line replace, which touches `pos` only. */
  end?: string
  /** Replacement text, either one line or the full ordered replacement block. */
  lines: string | string[]
}

/** One `append` edit: insert `lines` after `pos`, or at end-of-file when `pos` is absent. */
export interface AppendEdit {
  /** Operation discriminator; the applier switches on this literal. */
  op: "append"
  /** Anchor to insert after; absent means the lines are appended past the file's last line. */
  pos?: string
  /** Text to insert, either one line or the full ordered block. */
  lines: string | string[]
}

/** One `prepend` edit: insert `lines` before `pos`, or at start-of-file when `pos` is absent. */
export interface PrependEdit {
  /** Operation discriminator; the applier switches on this literal. */
  op: "prepend"
  /** Anchor to insert before; absent means the lines are prepended above the file's first line. */
  pos?: string
  /** Text to insert, either one line or the full ordered block. */
  lines: string | string[]
}

/** Any single edit of a batch; the `op` discriminator selects which anchor fields are meaningful. */
export type HashlineEdit = ReplaceEdit | AppendEdit | PrependEdit
