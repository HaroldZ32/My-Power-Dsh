// Minimal shape of Bun's native hash namespace as probed at runtime; only `xxHash32` is used here.
type BunHashRuntime = { hash: { xxHash32(data: string | Uint8Array, seed: number): number } }

// `globalThis` widened with the optional Bun namespace, which is the whole runtime probe for the native fast path.
const runtime = globalThis as typeof globalThis & { Bun?: BunHashRuntime }
// One shared encoder for the JS fallback: the hash runs once per line, so allocating per call would be pure overhead.
const encoder = new TextEncoder()

// xxHash32 prime 1 (2^32 / golden ratio); mixed into the lane-1 and lane-4 seeds, every accumulator step and the 1-byte tail.
const PRIME32_1 = 0x9e3779b1
// xxHash32 prime 2; mixed into every accumulator step and into the final avalanche.
const PRIME32_2 = 0x85ebca77
// xxHash32 prime 3; mixed into the 4-byte tail loop and into the final avalanche.
const PRIME32_3 = 0xc2b2ae3d
// xxHash32 prime 4; applied as the rotation multiplier of the 4-byte tail loop.
const PRIME32_4 = 0x27d4eb2f
// xxHash32 prime 5; seeds inputs shorter than 16 bytes and mixes the remaining 1-byte tail.
const PRIME32_5 = 0x165667b1

// Rotates a 32-bit word left by `bits` (callers pass 1..31) and returns it unsigned.
function rotateLeft32(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

// Reads 4 bytes little-endian from `offset`; bytes past the end read as 0, so a short tail cannot throw.
function readUint32LittleEndian(input: Uint8Array, offset: number): number {
  return (
    ((input[offset] ?? 0) |
      ((input[offset + 1] ?? 0) << 8) |
      ((input[offset + 2] ?? 0) << 16) |
      ((input[offset + 3] ?? 0) << 24)) >>>
    0
  )
}

// One accumulator step of xxHash32: mix `value` with prime 2, rotate 13, then multiply by prime 1.
function round32(accumulator: number, value: number): number {
  // Sum after the prime-2 mix, kept unsigned so the multiply below receives a 32-bit operand.
  const added = (accumulator + Math.imul(value, PRIME32_2)) >>> 0
  return Math.imul(rotateLeft32(added, 13), PRIME32_1) >>> 0
}

// Pure-JS xxHash32 used when the runtime is not Bun; must stay bit-identical to the native implementation.
function xxHash32Js(input: Uint8Array, seed: number): number {
  // Cursor over `input`; advances in 16-, 4- and 1-byte steps as each stage consumes the bytes.
  let offset = 0
  // Total byte length, fed into the hash once and used as the bound of both tail loops.
  const length = input.length
  // Running state; both arms below assign it before any mix, so it is never read uninitialized.
  let hash: number

  if (length >= 16) {
    // Last offset at which a full 16-byte stripe still fits, so the lane loop runs while `offset <= limit`.
    const limit = length - 16
    // Lane 1 seed: the seed plus both of the first two primes.
    let value1 = (seed + PRIME32_1 + PRIME32_2) >>> 0
    // Lane 2 seed: the seed plus prime 2.
    let value2 = (seed + PRIME32_2) >>> 0
    // Lane 3 seed: the seed alone.
    let value3 = seed >>> 0
    // Lane 4 seed: the seed minus prime 1, wrapping into uint32.
    let value4 = (seed - PRIME32_1) >>> 0

    while (offset <= limit) {
      value1 = round32(value1, readUint32LittleEndian(input, offset))
      offset += 4
      value2 = round32(value2, readUint32LittleEndian(input, offset))
      offset += 4
      value3 = round32(value3, readUint32LittleEndian(input, offset))
      offset += 4
      value4 = round32(value4, readUint32LittleEndian(input, offset))
      offset += 4
    }

    hash = (rotateLeft32(value1, 1) + rotateLeft32(value2, 7)) >>> 0
    hash = (hash + rotateLeft32(value3, 12)) >>> 0
    hash = (hash + rotateLeft32(value4, 18)) >>> 0
  } else {
    hash = (seed + PRIME32_5) >>> 0
  }

  hash = (hash + length) >>> 0

  // Tail stage 1: whole 4-byte words left over, each mixed with prime 3 and rotated 17 with prime 4.
  while (offset + 4 <= length) {
    hash = (hash + Math.imul(readUint32LittleEndian(input, offset), PRIME32_3)) >>> 0
    hash = Math.imul(rotateLeft32(hash, 17), PRIME32_4) >>> 0
    offset += 4
  }

  // Tail stage 2: the final 1..3 bytes, mixed one at a time with prime 5 and rotated 11 with prime 1.
  while (offset < length) {
    hash = (hash + Math.imul(input[offset] ?? 0, PRIME32_5)) >>> 0
    hash = Math.imul(rotateLeft32(hash, 11), PRIME32_1) >>> 0
    offset += 1
  }

  // Final avalanche: three xor-shift and multiply rounds fold the whole state into the returned 32 bits.
  hash = (hash ^ (hash >>> 15)) >>> 0
  hash = Math.imul(hash, PRIME32_2) >>> 0
  hash = (hash ^ (hash >>> 13)) >>> 0
  hash = Math.imul(hash, PRIME32_3) >>> 0

  return (hash ^ (hash >>> 16)) >>> 0
}

// Unsigned 32-bit xxHash32 of `input`; uses Bun's native hash when present and the JS port otherwise.
// The native path receives `seed` as given, while the JS fallback coerces it with `>>> 0`, so an out-of-range seed hashes differently per runtime.
export function hashXxh32(input: string, seed: number): number {
  // Absent on Node and on any non-Bun runtime, which is what selects the fallback below.
  const bun = runtime.Bun
  if (bun !== undefined) {
    return bun.hash.xxHash32(input, seed)
  }

  return xxHash32Js(encoder.encode(input), seed >>> 0)
}
