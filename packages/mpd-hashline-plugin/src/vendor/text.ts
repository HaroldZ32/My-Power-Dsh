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
// Hashline core: the BOM and line-ending envelope.
//
// Design ported from `crates/pi-edit/src/text.rs` (`detect_line_ending`, `normalize_to_lf`,
// `restore_line_endings`, `strip_bom`): the file's OWN shape is captured once, everything in between
// works on LF-only text, and the shape is reapplied on write-back. Modelling it as a value the caller
// carries — rather than a global — is what lets one process edit several files with different shapes.

import type { FileTextEnvelope } from "./types"

/** Line ending of the file's FIRST break; LF when the text carries no break or its first break is a lone LF. */
function detectLineEnding(content: string): "\n" | "\r\n" {
  /** Offset of the first LF, i.e. the position the CRLF test below compares against. */
  const lfIndex = content.indexOf("\n")
  if (lfIndex === -1) return "\n"
  /** Offset of the first CRLF pair, or -1 when the text carries none. */
  const crlfIndex = content.indexOf("\r\n")
  if (crlfIndex === -1) return "\n"
  return crlfIndex < lfIndex ? "\r\n" : "\n"
}

/** Split one leading `U+FEFF` off `content` and report whether it was there; the text is unchanged otherwise. */
function stripBom(content: string): { content: string; hadBom: boolean } {
  if (!content.startsWith("\uFEFF")) {
    return { content, hadBom: false }
  }
  return { content: content.slice(1), hadBom: true }
}

/** Fold every CRLF and every lone CR to `\n`; a CRLF is consumed as ONE break, never as two line feeds. */
function normalizeToLf(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

/** Re-encode LF text with the envelope's line ending; a no-op for an LF file. */
function restoreLineEndings(content: string, lineEnding: "\n" | "\r\n"): string {
  if (lineEnding === "\n") return content
  return content.replace(/\n/g, "\r\n")
}

/**
 * Capture the envelope of `content`: the BOM-stripped, LF-only canonical text plus the two facts that
 * write it back in the file's own shape.
 *
 * @param content - the file's bytes decoded as UTF-8, exactly as read.
 * @returns the canonical text with its `hadBom` flag and its dominant line ending.
 */
export function canonicalizeFileText(content: string): FileTextEnvelope {
  /** BOM-stripped text plus the flag recording that a BOM was removed. */
  const stripped = stripBom(content)
  return {
    content: normalizeToLf(stripped.content),
    hadBom: stripped.hadBom,
    lineEnding: detectLineEnding(stripped.content),
  }
}

/**
 * Write canonical `content` back in the envelope's shape: its line ending first, then its BOM.
 *
 * @param content - LF-only text produced by an edit.
 * @param envelope - the shape captured from the file before the edit.
 * @returns the text as it must be written to disk.
 */
export function restoreFileText(content: string, envelope: FileTextEnvelope): string {
  /** Normalized content carrying the envelope's line ending but not yet its BOM. */
  const withLineEnding = restoreLineEndings(content, envelope.lineEnding)
  if (!envelope.hadBom) return withLineEnding
  return `\uFEFF${withLineEnding}`
}
