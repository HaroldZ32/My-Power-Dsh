import { hasAnsi, stripAnsi } from "./ansi.ts"
import { charWidth, stringWidth } from "./east-asian-width.ts"
import type { OverflowLine, TuiCheckResult } from "./types.ts"

/** First code point of the Unicode box-drawing block (U+2500). */
const BOX_DRAWING_START = 0x2500
/** Last code point of the Unicode box-drawing block (U+257F). */
const BOX_DRAWING_END = 0x257f
/** Upper bound on the reported wide-character columns, so a pathological capture cannot grow the verdict without limit. */
const MAX_WIDE_COLUMNS = 64

/** Split a capture into lines and drop the single trailing empty element that a final newline produces. */
function splitLines(text: string): string[] {
	/** The split lines, before the trailing-newline adjustment. */
	const lines = text.split(/\r?\n/)
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop()
	return lines
}

/** Whether the line contains any box-drawing character, i.e. belongs to a frame rather than to content. */
function isFrameLine(plain: string): boolean {
	for (const char of plain) {
		/** The character's code point, undefined only for an unpaired surrogate. */
		const codePoint = char.codePointAt(0)
		if (codePoint !== undefined && codePoint >= BOX_DRAWING_START && codePoint <= BOX_DRAWING_END) {
			return true
		}
	}
	return false
}

/** Starting column of every double-width character on the line, measured in terminal columns rather than code-point indices. */
function wideStartColumns(plain: string): number[] {
	/** Starting columns collected so far, in reading order. */
	const columns: number[] = []
	/** Column the next character starts at. */
	let column = 0
	for (const char of plain) {
		/** The character's code point, undefined only for an unpaired surrogate. */
		const codePoint = char.codePointAt(0)
		if (codePoint === undefined) continue
		/** Columns this character occupies. */
		const width = charWidth(codePoint)
		if (width === 2) columns.push(column)
		column += width
	}
	return columns
}

/** Compose the one-line human summary from the verdict counters, in a fixed clause order. */
function summarize(
	lineCount: number,
	maxWidth: number,
	expectedColumns: number,
	overflowCount: number,
	borderMisaligned: boolean,
	containsAnsi: boolean,
): string {
	/** Summary clauses, joined with semicolons. */
	const parts = [`${lineCount} line(s)`, `max width ${maxWidth}/${expectedColumns}`]
	if (overflowCount > 0) parts.push(`${overflowCount} overflow line(s)`)
	if (borderMisaligned) parts.push("borders misaligned")
	if (containsAnsi) parts.push("contains ANSI")
	return `${parts.join("; ")}.`
}

/** Measure a terminal capture: per-line widths, overflow lines, wide-character columns and whether the box frames agree on width. */
export function checkTui(text: string, expectedColumns: number): TuiCheckResult {
	/** The capture's lines, with the trailing newline already dropped. */
	const lines = splitLines(text)
	/** Measured width of every line, in capture order. */
	const lineWidths: number[] = []
	/** Lines wider than the expected column count. */
	const overflowLines: OverflowLine[] = []
	/** Distinct columns where a double-width character starts. */
	const wideColumns = new Set<number>()
	/** Distinct widths of the lines that carry box-drawing characters; more than one means a broken frame. */
	const frameWidths = new Set<number>()

	for (let index = 0; index < lines.length; index++) {
		/** The line with its escape sequences removed, which is what the width math sees. */
		const plain = stripAnsi(lines[index] ?? "")
		/** Measured column width of that line. */
		const width = stringWidth(plain)
		lineWidths.push(width)
		if (expectedColumns > 0 && width > expectedColumns) {
			overflowLines.push({ line: index + 1, width })
		}
		if (isFrameLine(plain)) frameWidths.add(width)
		for (const column of wideStartColumns(plain)) {
			if (wideColumns.size < MAX_WIDE_COLUMNS) wideColumns.add(column)
		}
	}

	/** Widest measured line. */
	const maxWidth = lineWidths.reduce((max, width) => (width > max ? width : max), 0)
	/** Frame verdict: two box lines of different widths cannot belong to one rectangle. */
	const borderMisaligned = frameWidths.size > 1
	/** Whether the raw capture text (not the stripped lines) contains escapes. */
	const containsAnsi = hasAnsi(text)
	return {
		command: "tui-check",
		expectedColumns,
		lineCount: lines.length,
		lineWidths,
		maxWidth,
		overflowLines,
		borderMisaligned,
		wideCharColumns: [...wideColumns].sort((a, b) => a - b),
		hasAnsi: containsAnsi,
		summary: summarize(lines.length, maxWidth, expectedColumns, overflowLines.length, borderMisaligned, containsAnsi),
	}
}
