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
// Hashline core: the per-line digest.
//
// Design ported from the hashline mode of `crates/pi-edit`: one line hash per source line, folded into
// a short, alphabet-encoded digest that a caller quotes back as `LINE#HASH`. Only the LOW BYTE of the
// 32-bit hash reaches the anchor, because the anchor must stay two characters wide.
//
// The 32-bit mix is xxHash32 (Yann Collet, public domain); this is an implementation of that
// published algorithm over UTF-8 bytes, so the value does not depend on any host hash binding.

import { HASHLINE_DICT } from "./constants"

/** xxHash32 prime 1: 2^32 / the golden ratio. */
const PRIME32_1 = 0x9e3779b1
/** xxHash32 prime 2, mixed into every accumulator step and into the first avalanche stage. */
const PRIME32_2 = 0x85ebca77
/** xxHash32 prime 3, mixed into the 4-byte tail loop and into the second avalanche stage. */
const PRIME32_3 = 0xc2b2ae3d
/** xxHash32 prime 4, the rotation multiplier of the 4-byte tail loop. */
const PRIME32_4 = 0x27d4eb2f
/** xxHash32 prime 5, seeding inputs shorter than 16 bytes and mixing the 1-byte tail. */
const PRIME32_5 = 0x165667b1

/** One shared encoder: the digest runs once per line, so allocating per call would be pure overhead. */
const encoder = new TextEncoder()

/** A line counts as content-bearing when it holds a letter or a digit in any script. */
const RE_SIGNIFICANT = /[\p{L}\p{N}]/u

/**
 * Rotate a 32-bit word left.
 *
 * @param value - the word, read as unsigned by the caller.
 * @param bits - rotation amount in `1..31`.
 * @returns the rotated word as an unsigned 32-bit number.
 */
function rotateLeft32(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

/**
 * Read 4 bytes little-endian.
 *
 * @param input - the byte buffer.
 * @param offset - first byte of the word.
 * @returns the word as an unsigned 32-bit number.
 */
function readUint32LittleEndian(input: Uint8Array, offset: number): number {
  return (
    ((input[offset] ?? 0) |
      ((input[offset + 1] ?? 0) << 8) |
      ((input[offset + 2] ?? 0) << 16) |
      ((input[offset + 3] ?? 0) << 24)) >>>
    0
  )
}

/**
 * One xxHash32 accumulator step: mix `value` with prime 2, rotate 13, multiply by prime 1.
 *
 * @param accumulator - the running lane value.
 * @param value - the 4-byte word read from the input.
 * @returns the mixed lane value as an unsigned 32-bit number.
 */
function round32(accumulator: number, value: number): number {
  /** Sum after the prime-2 mix, kept unsigned so the multiply receives a 32-bit operand. */
  const added = (accumulator + Math.imul(value, PRIME32_2)) >>> 0
  return Math.imul(rotateLeft32(added, 13), PRIME32_1) >>> 0
}

/**
 * xxHash32 of a string's UTF-8 bytes.
 *
 * @param text - the text to hash.
 * @param seed - the 32-bit seed; a caller passes 0 for content-bearing lines and the line number otherwise.
 * @returns the 32-bit digest as an unsigned number.
 */
function xxh32(text: string, seed: number): number {
  /** UTF-8 encoding of `text`, the byte sequence the algorithm consumes. */
  const input = encoder.encode(text)
  /** Length in bytes, folded into the hash and used for every loop bound. */
  const length = input.length
  /** Read cursor; advances by 16 in the stripe loop and by 4 or 1 in the tails. */
  let offset = 0
  /** Running hash value. */
  let hash: number

  if (length >= 16) {
    /** Lane 1 accumulator, seeded with both primes. */
    let lane1 = (seed + PRIME32_1 + PRIME32_2) >>> 0
    /** Lane 2 accumulator, seeded with prime 2. */
    let lane2 = (seed + PRIME32_2) >>> 0
    /** Lane 3 accumulator, seeded with the seed alone. */
    let lane3 = seed >>> 0
    /** Lane 4 accumulator, seeded with prime 1 subtracted. */
    let lane4 = (seed - PRIME32_1) >>> 0
    /** Offset past which a whole 16-byte stripe no longer fits. */
    const stripeLimit = length - 16
    while (offset <= stripeLimit) {
      lane1 = round32(lane1, readUint32LittleEndian(input, offset)); offset += 4
      lane2 = round32(lane2, readUint32LittleEndian(input, offset)); offset += 4
      lane3 = round32(lane3, readUint32LittleEndian(input, offset)); offset += 4
      lane4 = round32(lane4, readUint32LittleEndian(input, offset)); offset += 4
    }
    hash = (rotateLeft32(lane1, 1) + rotateLeft32(lane2, 7) + rotateLeft32(lane3, 12) + rotateLeft32(lane4, 18)) >>> 0
  } else {
    hash = (seed + PRIME32_5) >>> 0
  }

  hash = (hash + length) >>> 0

  while (offset + 4 <= length) {
    hash = Math.imul(rotateLeft32((hash + Math.imul(readUint32LittleEndian(input, offset), PRIME32_3)) >>> 0, 17), PRIME32_4) >>> 0
    offset += 4
  }
  while (offset < length) {
    hash = Math.imul(rotateLeft32((hash + Math.imul(input[offset] ?? 0, PRIME32_5)) >>> 0, 11), PRIME32_1) >>> 0
    offset += 1
  }

  hash ^= hash >>> 15
  hash = Math.imul(hash, PRIME32_2) >>> 0
  hash ^= hash >>> 13
  hash = Math.imul(hash, PRIME32_3) >>> 0
  hash ^= hash >>> 16
  return hash >>> 0
}

/**
 * Digest of one text, under an explicit seed.
 *
 * @param lineNumber - 1-based line number of the text; it is the seed for a line holding no letter or digit.
 * @param normalizedContent - text already stripped of everything this digest ignores.
 * @returns the two-character anchor digest.
 */
function digestLine(lineNumber: number, normalizedContent: string): string {
  // Blank and punctuation-only lines would otherwise all hash alike — and several of them commonly
  // sit one above the other — so such a line is distinguished by its POSITION instead of its content.
  /** Seed: 0 for a content-bearing line, so equal text hashes equal anywhere in the file. */
  const seed = RE_SIGNIFICANT.test(normalizedContent) ? 0 : lineNumber
  /** Low byte of the 32-bit digest, which is all a two-character anchor can carry. */
  const index = xxh32(normalizedContent, seed) % 256
  return HASHLINE_DICT[index] ?? ""
}

/**
 * Anchor digest for one source line exactly as it sits on disk.
 *
 * A trailing CR and trailing whitespace are ignored, so re-saving a file with a different line ending
 * — or an editor trimming the end of a line — does not invalidate every anchor the caller holds.
 *
 * @param lineNumber - 1-based line number, used only for lines with no letter or digit.
 * @param content - the line's text, without its terminator.
 * @returns the two-character digest.
 */
export function computeLineHash(lineNumber: number, content: string): string {
  return digestLine(lineNumber, content.replace(/\r/g, "").trimEnd())
}

/**
 * Render one anchor line in the `LINE#HASH|content` shape the read tool publishes.
 *
 * @param lineNumber - 1-based line number.
 * @param content - the line's text, without its terminator.
 * @returns the rendered anchor line.
 */
export function formatHashLine(lineNumber: number, content: string): string {
  /** Digest this line carries, i.e. the value an edit must quote back. */
  const hash = computeLineHash(lineNumber, content)
  return `${lineNumber}#${hash}|${content}`
}
