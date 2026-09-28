// The ONE implementation of the skill-frontmatter YAML subset.
//
// WHY THIS FILE EXISTS: the corpus frontmatter parser was copy-pasted between this
// package (`./skills.ts`, the extension skill plane) and `packages/mpd-bootstrap-plugin`
// (the bundle's own corpus provider) — two ~140-line copies of the same subset parser,
// the same `stringField`/`frontmatterBoolean` readers and the same `parseInvocation`
// legacy-key refusal. Two copies of a PARSER is how the two planes start accepting
// different documentation: a fix or a stricter rule landed in one and not the other.
// Both now consume this module, so a frontmatter rule has exactly one home.
//
// The subset is deliberately small and dependency-free (no YAML library): top-level
// scalars, one nested mapping, optional block scalars — the shape the shipped corpus
// uses, pinned by packages/mpd-bootstrap-plugin/test/bootstrap.test.ts against every
// real SKILL.md file.
//
// ── THE SHARED CONTRACT, stated for a caller in EITHER plane ────────────────────────
//
// ACCEPTED GRAMMAR. A block is read only between a FIRST line that is exactly `---` and a
// later line that is exactly `---`; between them one physical line is parsed at a time.
//   · `key: value` — the key matches `[A-Za-z0-9_][A-Za-z0-9_.-]*`, the colon is mandatory,
//     and at least one space or TAB must follow it, so `key:value` is NOT a scalar but an
//     unsupported line and throws. Nothing else marks structure: indentation alone does.
//   · scalars: double-quoted (JSON.parse, degrading to the raw inner text when that JSON is
//     malformed), single-quoted (`''` collapses to one `'`), `true|yes|on` / `false|no|off`
//     case-insensitively, `null` or `~`, an integer or `d.d` decimal, else the TRIMMED
//     literal text.
//   · block scalars `|` (literal) and `>` (folded), with an optional `+`/`-` chomping
//     indicator and an optional indent digit. Both indicators are parsed and then
//     effectively IGNORED: trailing blank lines are dropped before the join, so `|`, `|-`
//     and `|+` (and the same three with `>`) return the same text. Enough for the corpus,
//     not a YAML chomping implementation.
//   · nesting is indent-driven and has NO depth limit (an explicit stack), even though the
//     corpus only ever uses one level: a bare `key:` whose next significant line is deeper
//     and `key:`-shaped opens a child map, and a bare `key:` with no such child stores
//     `null`.
//   · blank lines and whole-line `#` comments are skipped at any indent; an INLINE `#` is
//     NOT a comment (`k: v # x` is the string `v # x`); a duplicate key keeps the LAST
//     value; and unknown keys are KEPT, never refused — unlike the descriptor/manifest
//     validator, which rejects an unknown key per item. Each plane reads only the keys it
//     needs.
//
// TOLERATED. No frontmatter block at all, an EMPTY block (`---` immediately followed by
// `---`), a closing fence that is the last line without a trailing newline, extra keys, a
// nested `metadata:` map, blank/comment-only block lines, and CRLF on the two FENCE lines
// (a single trailing `\r` is stripped for the fence test only).
//
// NOT TOLERATED. A UTF-8 BOM, a blank or indented first line, whitespace after a fence, or an
// unterminated block — each returns `undefined`, i.e. "no block" (so an unterminated block is
// reported as MISSING, not as malformed; that conflation is the code's, stated here rather
// than smoothed over). Any `key: value` line ending in `\r` is unsupported: the fence test is
// `\r`-aware, but `parseYamlBlock` splits on `\n` and `.` does not match `\r`, so a CRLF
// document carrying frontmatter keys throws `unsupported frontmatter line: <key>`, while a
// CRLF block with no keys still parses. A list entry (`- item`), a plain multi-line
// continuation and a bare flow `{...}`/`[...]` line are outside the subset and throw; a flow
// `[a, b]` AFTER a key is not a list at all — it is kept as the literal string `[a, b]`.
//
// MALFORMED vs ABSENT: the caller CAN tell them apart, and both consumers do. A block that
// exists but carries an unsupported line THROWS `Error("unsupported frontmatter line: <line>")`,
// while `undefined` means NO COMPLETE BLOCK (no opening fence, no closing fence, or a one-line
// file). The extension plane reports those as `invalid frontmatter in <path>: <message>` and
// `missing YAML frontmatter in <path>` respectively (`./skills.ts`, `readSkillDocument`); the
// bundle corpus provider warns `invalid frontmatter` vs `missing YAML frontmatter`
// (`packages/mpd-bootstrap-plugin/src/index.ts`, `readSkillFile`).
//
// WHAT A PLANE ADDS ON TOP (this module enforces none of it): a non-empty `name` and
// `description` read through `stringField`, a `name` satisfying `^[a-z0-9]+(?:-[a-z0-9]+)*$`,
// and the invocation booleans from `parseInvocation`. The frontmatter `name` IS the skill's
// identity — the containing directory is only a locator.
//
// Proven against the shipped corpus, read-only: all 18 `skills/**/SKILL.md` files parse, carry
// a non-empty `name` + `description` and satisfy the name grammar, and they use only
// `name`/`description`/`metadata` (three carry the one-level nested map). Quoting and block
// scalars, plus the name-grammar, missing-name/description and legacy-key refusals, are asserted
// by `packages/mpd-bootstrap-plugin/test/bootstrap.test.ts`; the two `parseFrontmatter` outcomes
// themselves (`invalid` vs `missing` frontmatter) are NOT covered by that suite or by any
// `packages/mpd-ext-plugin/test/` file — the code below is their only specification.
/**
 * The two invocation booleans, declared STRUCTURALLY here so this module never imports
 * back from `./skills` (which imports this one). `SkillInvocation` in `./skills` is the
 * same shape, so the two assign freely.
 */
export interface InvocationBooleans {
  /** Whether the model may see and invoke this skill; false only for `disable-model-invocation: true`. */
  modelInvocable: boolean
  /** Whether the user may invoke this skill directly; false only for `user-invocable: false`. */
  userInvocable: boolean
}

/**
 * The frontmatter contract: parsed `data` plus the body that follows the closing fence.
 * `data` is the flat-ish map `parseYamlBlock` builds (a nested `metadata:` map becomes a
 * child object) and `body` is the text after the closing fence VERBATIM — untrimmed, so
 * each caller decides whether to trim (both currently do).
 */
export type Frontmatter = { data: Record<string, unknown>; body: string }
/**
 * A missing file/directory is signalled by code, never by a message.
 * @param error Whatever a filesystem call threw.
 * @returns True for `ENOENT`/`ENOTDIR`; any other failure is a real I/O error and stays
 *   distinguishable, which is why the callers re-report it with its message instead of
 *   treating it as "no such skill".
 */
export function isAbsent(error: unknown): boolean {
  // The errno-style code the fs layer attached; absent or different means a real I/O failure.
  const code = (error as { code?: string } | undefined)?.code
  return code === "ENOENT" || code === "ENOTDIR"
}

/**
 * Coerce one `key: value` scalar into the value the subset promises. Never throws: a
 * malformed double-quoted value degrades to its inner text.
 * @param value The text after the colon, quotes included, as the line regex captured it.
 * @returns `""` for an empty body, the JSON-decoded value for a double-quoted scalar (or
 *   its de-quoted inner text when `JSON.parse` fails), the de-quoted text with `''` folded
 *   to `'` for a single-quoted scalar, a boolean for true/yes/on and false/no/off
 *   case-insensitively, `null` for `null` or `~`, a Number for an integer or `d.d` decimal
 *   literal, and otherwise the trimmed literal text.
 */
function parseScalar(value: string): unknown {
  // Trimmed once so every test below reads the same text.
  const text = value.trim()
  if (text === "") return ""
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try { return JSON.parse(text) as unknown } catch { return text.slice(1, -1) }
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1).replace(/''/g, "'")
  // Case-insensitive spelling, read only by the true/false/null tests below.
  const lower = text.toLowerCase()
  if (lower === "true" || lower === "yes" || lower === "on") return true
  if (lower === "false" || lower === "no" || lower === "off") return false
  if (lower === "null" || text === "~") return null
  if (/^-?\d+$/.test(text)) return Number(text)
  if (/^-?\d*\.\d+$/.test(text)) return Number(text)
  return text
}

/**
 * Fold the lines of a `>` block scalar the way YAML folds: one space between two
 * consecutive content lines and one literal newline per blank line.
 * @param lines Block lines already de-indented, with trailing blank lines removed by the
 *   caller.
 * @returns The folded text; the caller's chomping branch may still strip trailing newlines.
 */
function foldLines(lines: string[]): string {
  // Accumulator; a blank source line leaves the newline that starts the next line afresh.
  let out = ""
  for (const line of lines) {
    if (line === "") out += "\n"
    else out += (out === "" || out.endsWith("\n") ? "" : " ") + line
  }
  return out
}

/**
 * Parse the small YAML subset the skill corpus uses (scalars, one nested map, block scalars).
 *
 * The full accepted grammar, what is tolerated, what is rejected and the exact failure
 * value are stated once in this module's header comment; this function is the piece that
 * throws, so the contract in one line: every line must be `key: value`, a bare `key:`
 * (which either opens an indented child map or stores `null`), a blank line or a whole-line
 * `#` comment. Anything else is outside the subset.
 * @param text The block BETWEEN the two `---` fences, newlines included, exactly as
 *   `parseFrontmatter` sliced it (a trailing `\r` on a key line is therefore fatal).
 * @returns A plain object of the parsed keys; nesting follows indentation with no depth
 *   limit, an unknown key is kept, and a duplicate key keeps the last value.
 * @throws Error `unsupported frontmatter line: <line>` for the first line that is not in
 *   the subset — a list entry, a continuation line, a bare flow mapping, or `key:value`
 *   with no space after the colon.
 */
export function parseYamlBlock(text: string): Record<string, unknown> {
  // One entry per physical source line; a block scalar consumes ahead of the cursor below.
  const lines = text.split("\n")
  // The map returned for this block; a top-level key lands here unless a deeper map owns it.
  const root: Record<string, unknown> = {}
  // Open maps by indentation, innermost LAST; the sentinel -1 makes every real line a
  // child of the root, and a line at or above an open level closes that level.
  const stack: Array<{ indent: number; map: Record<string, unknown> }> = [{ indent: -1, map: root }]
  // Cursor over `lines`; advanced once per line, and once per consumed block-scalar line.
  let index = 0
  while (index < lines.length) {
    // The current physical line, `\r` included: only blanks and whole-line comments skip.
    const raw = lines[index]
    index += 1
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue
    // Leading-whitespace width in CHARACTERS (a tab counts as one), the sole nesting signal.
    const indent = raw.length - raw.trimStart().length
    // The line without its indentation, which is what the key regex sees.
    const line = raw.slice(indent)
    // `key:` plus an optional space/tab-delimited scalar; null means the line is unsupported.
    const match = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?:[ \t]+(.*))?$/.exec(line)
    if (match === null) throw new Error("unsupported frontmatter line: " + line)
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
    // The innermost map still open at this indent — where this key is stored.
    const parent = stack[stack.length - 1].map
    // The declared key, verbatim (dots, dashes and underscores allowed after the first char).
    const key = match[1]
    // The raw text after the colon, or "" for a bare `key:`; never re-trimmed here.
    const rest = match[2] ?? ""
    if (rest.trim() === "") {
      // The next significant line, used ONLY to decide whether a bare `key:` opens a child map.
      let next: { indent: number; text: string } | undefined
      for (let probe = index; probe < lines.length; probe += 1) {
        // A physical line while looking ahead; blanks and comment lines are not significant.
        const candidate = lines[probe]
        if (candidate.trim() === "" || candidate.trimStart().startsWith("#")) continue
        next = { indent: candidate.length - candidate.trimStart().length, text: candidate.trimStart() }
        break
      }
      if (next !== undefined && next.indent > indent && /^[A-Za-z0-9_][A-Za-z0-9_.-]*\s*:/.test(next.text)) {
        // The map a bare `key:` opens; pushing it makes the deeper lines that follow its entries.
        const child: Record<string, unknown> = {}
        parent[key] = child
        stack.push({ indent, map: child })
      } else parent[key] = null
      continue
    }
    // A `|`/`>` block header plus optional chomping and indent digits, e.g. `|-`, `>2`.
    const block = /^([|>])([+-]?)(\d*)$/.exec(rest.trim())
    if (block !== null) {
      // Raw block lines with the common indentation removed; trailing blanks are dropped.
      const collected: string[] = []
      // Indentation of the first block line, the strip width for later ones; -1 until seen.
      let blockIndent = -1
      while (index < lines.length) {
        // A physical line inside the block; a blank one is content, not a terminator.
        const candidate = lines[index]
        if (candidate.trim() === "") { collected.push(""); index += 1; continue }
        // Indentation width deciding whether the block continues (deeper) or ends (at/above).
        const candidateIndent = candidate.length - candidate.trimStart().length
        if (candidateIndent <= indent) break
        if (blockIndent < 0) blockIndent = candidateIndent
        collected.push(candidate.slice(Math.min(blockIndent, candidateIndent)))
        index += 1
      }
      while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop()
      // The block text: literal lines for `|`, folded to one space per break for `>`.
      const joined = block[1] === "|" ? collected.join("\n") : foldLines(collected)
      parent[key] = block[2] === "-" ? joined.replace(/\n+$/, "") : joined
      continue
    }
    parent[key] = parseScalar(rest)
  }
  return root
}

/**
 * Split a SKILL.md-style document into its frontmatter map and the body that follows it.
 * @param raw The whole file text, exactly as read (CRLF is NOT normalized).
 * @returns `{ data, body }` when a complete block exists — `body` verbatim after the closing
 *   fence, untrimmed — or `undefined` when there is NO COMPLETE BLOCK: no opening fence (also
 *   the case for a BOM, a leading blank line, or whitespace after the fence), no closing
 *   fence, or a file with no newline at all.
 * @throws Error `unsupported frontmatter line: <line>` when the block exists but a line in it
 *   is outside the subset (propagated from `parseYamlBlock`), so the two failure modes stay
 *   distinguishable: `undefined` = absent, a throw = malformed.
 */
export function parseFrontmatter(raw: string): Frontmatter | undefined {
  // Index of the first `\n`; a file with no newline cannot carry a block at all.
  const firstLineEnd = raw.indexOf("\n")
  if (firstLineEnd < 0) return undefined
  if (raw.slice(0, firstLineEnd).replace(/\r$/, "") !== "---") return undefined
  // Start offset of the candidate closing-fence line; the scan only goes forward from the block.
  let lineStart = firstLineEnd + 1
  // Offset of the closing fence, or -1 while no line has matched.
  let closingStart = -1
  // Offset just past the closing fence's newline; the returned body begins here.
  let bodyStart = -1
  while (lineStart <= raw.length) {
    // End of the current line, or -1 when this is the file's last line with no newline.
    const nextNewline = raw.indexOf("\n", lineStart)
    // Exclusive end of the current line's text, the newline excluded.
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") {
      closingStart = lineStart
      bodyStart = nextNewline < 0 ? raw.length : nextNewline + 1
      break
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  if (closingStart < 0) return undefined
  return { data: parseYamlBlock(raw.slice(firstLineEnd + 1, closingStart)), body: raw.slice(bodyStart) }
}

/**
 * A non-empty string field, or undefined (empty strings are treated as absent).
 * @param data The parsed frontmatter map.
 * @param key The key to read, e.g. `name` or `description`.
 * @returns The string only when the value IS a string of length > 0; a bare `key:` (stored as
 *   `null`, or as a child map when it opened one), a number, a boolean or an empty string all
 *   read as absent, which is exactly what the planes' non-empty-name/description rules want.
 */
export function stringField(data: Record<string, unknown>, key: string): string | undefined {
  // The raw entry; only a non-empty string survives, everything else counts as absent.
  const value = data[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/**
 * Read a boolean frontmatter key, accepting every spelling the subset can produce.
 * @param data The parsed frontmatter map.
 * @param key The key to read, e.g. `user-invocable`.
 * @returns `undefined` when the key is absent (an own-property test, so a key that is present
 *   with `null` does NOT read as absent), else the boolean it carries: a real boolean,
 *   `1`/`0` as number or string, or the true/yes/on and false/no/off spellings.
 * @throws TypeError `frontmatter field "<key>" must be a boolean` for any other present value;
 *   the callers catch it per item, so a malformed flag skips one skill instead of crashing.
 */
export function frontmatterBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  // The present value; presence is decided by the key, not by the value.
  const value = data[key]
  if (typeof value === "boolean") return value
  if (value === 1 || value === "1") return true
  if (value === 0 || value === "0") return false
  if (typeof value === "string") {
    // Case-insensitive spelling, so TRUE/Yes/OFF read like their lower-case forms.
    const lower = value.toLowerCase()
    if (lower === "true" || lower === "yes" || lower === "on") return true
    if (lower === "false" || lower === "no" || lower === "off") return false
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

/**
 * The invocation contract, refusing the pre-rename spellings LOUDLY instead of guessing.
 * A skill that still carries `userInvocable` must be told which key replaced it.
 *
 * Both booleans default to true, so an invocation key is never required for a skill to be
 * invocable in both directions.
 * @param data The parsed frontmatter map.
 * @returns `{ modelInvocable, userInvocable }`: `modelInvocable` is false only for
 *   `disable-model-invocation: true`, `userInvocable` is false only for
 *   `user-invocable: false`.
 * @throws Error `frontmatter field "<legacy>" is unsupported; use "<replacement>"` when the map
 *   carries `disableModelInvocation`, `modelInvocable` or `userInvocable` — the rename is
 *   two-way, so a stale copy is refused rather than half-read. Also throws the
 *   `frontmatterBoolean` TypeError when a supported key holds a non-boolean value.
 */
export function parseInvocation(data: Record<string, unknown>): InvocationBooleans {
  for (const legacy of ["disableModelInvocation", "modelInvocable", "userInvocable"]) {
    if (Object.hasOwn(data, legacy)) {
      // The key that replaced this legacy spelling; the error names BOTH, so the fix is mechanical.
      const replacement = legacy === "userInvocable" ? "user-invocable" : "disable-model-invocation"
      throw new Error(`frontmatter field "${legacy}" is unsupported; use "${replacement}"`)
    }
  }
  return {
    modelInvocable: frontmatterBoolean(data, "disable-model-invocation") !== true,
    userInvocable: frontmatterBoolean(data, "user-invocable") !== false,
  }
}
