/** The ESC control character, built from its code point so no raw control byte lives in this source. */
const ESC = String.fromCharCode(0x1b)
/** The single-byte CSI introducer (0x9b), the 8-bit spelling of the two-byte `ESC [`. */
const CSI = String.fromCharCode(0x9b)

// Matches CSI/escape sequences (colors, cursor moves) without embedding raw
// control characters in the regex source.
const ANSI_PATTERN = new RegExp(
	`[${ESC}${CSI}][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]`,
	"g",
)

/** Drop every CSI/SGR escape sequence, leaving the printable text a terminal would actually draw. */
export function stripAnsi(input: string): string {
	return input.replace(ANSI_PATTERN, "")
}

/** Whether the input carries at least one escape sequence, detected as a strip that changed the string. */
export function hasAnsi(input: string): boolean {
	return stripAnsi(input) !== input
}
