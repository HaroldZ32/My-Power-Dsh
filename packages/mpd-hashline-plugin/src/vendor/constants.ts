// The 16-symbol alphabet for one hex digit, position = nibble value; every anchor hash character comes from this set.
export const NIBBLE_STR = "ZPMQVRWSNKTXJBYH"

// Byte → two-letter anchor lookup, indexed by the 0..255 hash byte so a line hash costs one table read.
export const HASHLINE_DICT = Array.from({ length: 256 }, (_, i) => {
  // High nibble of the byte: index into NIBBLE_STR for the first character.
  const high = i >>> 4
  // Low nibble of the byte: index into NIBBLE_STR for the second character.
  const low = i & 0x0f
  return `${NIBBLE_STR[high]}${NIBBLE_STR[low]}`
})

// A bare anchor reference: capture 1 is the line number, capture 2 the two-letter hash; anchored, so trailing text is not a match.
export const HASHLINE_REF_PATTERN = /^([0-9]+)#([ZPMQVRWSNKTXJBYH]{2})$/
// One rendered view line `LINE#HASH|content`: capture 3 is everything after the `|`, which may be empty.
export const HASHLINE_OUTPUT_PATTERN = /^([0-9]+)#([ZPMQVRWSNKTXJBYH]{2})\|(.*)$/
