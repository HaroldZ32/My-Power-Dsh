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
// Hashline core: the fixed vocabulary of a `LINE#HASH|content` anchor line.
//
// The alphabet, the two-letter digest width and the two patterns below are the FORMAT CONTRACT the
// four `mpd_hashline_*` tools and their guard all speak; a change here invalidates every anchor a
// caller is holding, so it is not a local edit.

/** The 16-symbol alphabet standing for one hex nibble, indexed by nibble value in `0..15`. */
export const NIBBLE_STR = "ZPMQVRWSNKTXJBYH"

/**
 * Byte -> two-letter anchor lookup, indexed by the `0..255` digest byte, so rendering one anchor line
 * costs a single table read instead of two nibble lookups.
 */
export const HASHLINE_DICT: readonly string[] = Array.from({ length: 256 }, (_, i) => {
  /** High nibble of the byte, selecting the first alphabet character. */
  const high = i >>> 4
  /** Low nibble of the byte, selecting the second alphabet character. */
  const low = i & 0x0f
  return `${NIBBLE_STR[high]}${NIBBLE_STR[low]}`
})

/** A BARE anchor reference: capture 1 is the line number and capture 2 the two-letter digest. */
export const HASHLINE_REF_PATTERN = /^([0-9]+)#([ZPMQVRWSNKTXJBYH]{2})$/

/** One RENDERED view line `LINE#HASH|content`: capture 3 is the content after the `|`, which may be empty. */
export const HASHLINE_OUTPUT_PATTERN = /^([0-9]+)#([ZPMQVRWSNKTXJBYH]{2})\|(.*)$/
