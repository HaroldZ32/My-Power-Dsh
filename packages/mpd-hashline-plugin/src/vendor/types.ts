// ---------------------------------------------------------------------------------------------
// MIT NOTICE — this file is a TypeScript port of the DESIGN of `crates/pi-edit` from the project
// `can1357/oh-my-pi` (https://github.com/can1357/oh-my-pi), reached at commit
// 602b6c812fa9ef774f359f1e399a09d30ee2eaca. That crate is licensed MIT at the workspace manifest's
// `[workspace.package] license = "MIT"`; the upstream `LICENSE` carries the text reproduced below.
//
// MIT License
//
// Copyright (c) 2025 Mario Zechner
// Copyright (c) 2025-2026 Can Bölük
// Copyright (c) 2026 Stencil Labs, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
// ---------------------------------------------------------------------------------------------
// Hashline core: the edit vocabulary the tool surface accepts.

/** One `replace` edit: rewrite the anchor line, or the inclusive `pos`..`end` range, with `lines`. */
export interface ReplaceEdit {
  /** Operation discriminator; the applier switches on this literal. */
  op: "replace"
  /** Primary anchor in `LINE#HASH` form; when `end` is absent this is the single line replaced. */
  pos: string
  /** Inclusive range end anchor; omitted for a single-line replace. */
  end?: string
  /** Replacement text: one line, or the full ordered replacement block. */
  lines: string | string[]
}

/** One `append` edit: insert `lines` after `pos`, or past the last line when `pos` is absent. */
export interface AppendEdit {
  /** Operation discriminator; the applier switches on this literal. */
  op: "append"
  /** Anchor to insert after; absent means end of file. */
  pos?: string
  /** Text to insert: one line, or the full ordered block. */
  lines: string | string[]
}

/** One `prepend` edit: insert `lines` before `pos`, or above the first line when `pos` is absent. */
export interface PrependEdit {
  /** Operation discriminator; the applier switches on this literal. */
  op: "prepend"
  /** Anchor to insert before; absent means start of file. */
  pos?: string
  /** Text to insert: one line, or the full ordered block. */
  lines: string | string[]
}

/** Any single edit of a batch; the `op` discriminator selects which anchor fields are meaningful. */
export type HashlineEdit = ReplaceEdit | AppendEdit | PrependEdit

/** The canonical text of one file plus the two facts that write it back in the file's own shape. */
export interface FileTextEnvelope {
  /** File text with any leading BOM removed and every line ending folded to `\n`. */
  content: string
  /** Whether a leading `U+FEFF` was stripped, so the write-back can put it back. */
  hadBom: boolean
  /** Line ending of the file's FIRST break, reapplied to every line; a mixed-ending file comes back uniform. */
  lineEnding: "\n" | "\r\n"
}

/** What one applied batch reports back: the new content plus the two counters the tool prints. */
export interface HashlineApplyReport {
  /** File content after every edit of the batch has been applied. */
  content: string
  /** Edits that changed nothing because the replacement equalled the lines already there. */
  noopEdits: number
  /** Duplicate edits dropped before any edit ran. */
  deduplicatedEdits: number
}

/** A parsed anchor: the 1-based line it points at plus the digest the caller quoted for that line. */
export interface LineRef {
  /** 1-based line number as written by the caller. */
  line: number
  /** Two-letter digest the caller quoted for that line. */
  hash: string
}
