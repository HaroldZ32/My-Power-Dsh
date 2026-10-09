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
// Hashline core: the public surface the mpd-hashline row imports.
//
// mpd-owned TypeScript, ported from the DESIGN of `crates/pi-edit` in `can1357/oh-my-pi` (MIT); the
// notice above is carried per file. The FOUR tool names, the `LINE#HASH|content` anchor shape and its
// 16-character alphabet, the stale-anchor report and the BOM/line-ending envelope are the contract
// this tree must keep, whatever changes inside it.
//
// The specifiers below are extensionless on purpose: `bun build` bundles this tree into
// `packages/mpd-hashline-plugin/dist/index.js`.

/** The alphabet, the two anchor patterns and the byte-to-digest lookup. */
export { HASHLINE_DICT, HASHLINE_OUTPUT_PATTERN, HASHLINE_REF_PATTERN, NIBBLE_STR } from "./constants"
/** Anchor parsing, validation and the stale-anchor report. */
export { HashlineMismatchError, normalizeLineRef, parseLineRef, validateLineRef, validateLineRefs } from "./anchors"
/** The per-line digest and one rendered anchor line. */
export { computeLineHash, formatHashLine } from "./hash"
/** The BOM / line-ending envelope pair: capture before an edit, restore on write-back. */
export { canonicalizeFileText, restoreFileText } from "./text"
/** Batch normalization and application. */
export { applyHashlineEditsWithReport, normalizeHashlineEdits } from "./edits"
/** The read-side anchor view and the unified diff an edit reports. */
export { generateUnifiedDiff, toHashlineContent } from "./diff"
/** The edit vocabulary and the report shapes. */
export type { AppendEdit, FileTextEnvelope, HashlineApplyReport, HashlineEdit, HashlineRepairReport, LineRef, PrependEdit, ReplaceEdit } from "./types"
/** One edit exactly as a tool call carried it, before normalization. */
export type { RawHashlineEdit } from "./edits"
