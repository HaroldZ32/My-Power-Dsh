// T-92 (wave 2b, t43): the absence-pin view of a module's source.
//
// THE DEFECT THIS CLOSES: an absence assertion evaluated against a file's TEXT makes the pinned
// identifier unusable in PROSE — a comment naming it reddens the pin even though the CODE does not
// contain it. (MEASURED while writing this file: the audit's raw occurrence counter counts a mention in
// a COMMENT, so the first wording of this very header moved the corpus reading 42 -> 43; the wording was
// reworked so the row's unit keeps its clean value, and the instance is recorded in the evidence.)
// Measured before this fix: seeding a COMMENT into
// `lib/tools.js` turned `tool-boundary-hold-and-contract-seat.test.mjs` RED (the seeded run is kept in
// `evidence/agent-teams/wave2b-laneA/20260917T151306Z/red-seed-comment-before.out.txt`).
//
// THE RULE, in CODE (the row's first shape): the absence is asserted against the subject's
// COMMENT-STRIPPED text. String literals are KEPT — a literal IS code for this purpose — and the
// comment stripper is deliberately small and local (no dependency): `//` to end of line, `/* … */`,
// with quoted strings skipped so a `//` inside a literal is not mistaken for a comment.
//
// The presence pins keep using the RAW text; only ABSENCE is a statement about code.

/**
 * The subject's text with comments removed; everything else (including string literals) preserved.
 *
 * @param text - the subject file's raw bytes.
 * @returns the same bytes minus its line and block comments, with quoted strings copied verbatim.
 */
export function stripComments(text: string): string {
    /** The stripped text built so far, in source order. */
    let out = ""
    /** Cursor into `text`: the next byte that has not been classified yet. */
    let index = 0
    while (index < text.length) {
        /** The two bytes starting at the cursor, which is all a comment opener needs. */
        const two = text.slice(index, index + 2)
        if (two === "//") {
            /** Offset of the newline that ends the line comment, or -1 at end of file. */
            const end = text.indexOf("\n", index)
            index = end === -1 ? text.length : end
            continue
        }
        if (two === "/*") {
            /** Offset just past the block comment's closing delimiter, or end of file when unterminated. */
            const end = text.indexOf("*/", index + 2)
            index = end === -1 ? text.length : end + 2
            continue
        }
        /** The byte at the cursor; a quote opens a literal that must be copied verbatim. */
        const char = text[index]
        if (char === '"' || char === "'" || char === "`") {
            /** Cursor that walks the literal to its closing quote, honouring backslash escapes. */
            let cursor = index + 1
            while (cursor < text.length) {
                if (text[cursor] === "\\") {
                    cursor += 2
                    continue
                }
                if (text[cursor] === char) {
                    cursor += 1
                    break
                }
                cursor += 1
            }
            out += text.slice(index, cursor)
            index = cursor
            continue
        }
        out += char
        index += 1
    }
    return out
}

/**
 * The absence-pin view of a subject file's text: comments stripped, literals kept.
 *
 * @param text - the subject file's raw bytes.
 * @returns the view an ABSENCE assertion is evaluated against.
 */
export function codeOf(text: string): string {
    return stripComments(text)
}
