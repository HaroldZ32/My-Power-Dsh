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
/**
 * The two invocation booleans, declared STRUCTURALLY here so this module never imports
 * back from `./skills` (which imports this one). `SkillInvocation` in `./skills` is the
 * same shape, so the two assign freely.
 */
export interface InvocationBooleans {
  modelInvocable: boolean
  userInvocable: boolean
}

/** The frontmatter contract: parsed `data` plus the body that follows the closing fence. */
export type Frontmatter = { data: Record<string, unknown>; body: string }
/** A missing file/directory is signalled by code, never by a message. */
export function isAbsent(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code
  return code === "ENOENT" || code === "ENOTDIR"
}

function parseScalar(value: string): unknown {
  const text = value.trim()
  if (text === "") return ""
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try { return JSON.parse(text) as unknown } catch { return text.slice(1, -1) }
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1).replace(/''/g, "'")
  const lower = text.toLowerCase()
  if (lower === "true" || lower === "yes" || lower === "on") return true
  if (lower === "false" || lower === "no" || lower === "off") return false
  if (lower === "null" || text === "~") return null
  if (/^-?\d+$/.test(text)) return Number(text)
  if (/^-?\d*\.\d+$/.test(text)) return Number(text)
  return text
}

function foldLines(lines: string[]): string {
  let out = ""
  for (const line of lines) {
    if (line === "") out += "\n"
    else out += (out === "" || out.endsWith("\n") ? "" : " ") + line
  }
  return out
}

/** Parse the small YAML subset the skill corpus uses (scalars, one nested map, block scalars). */
export function parseYamlBlock(text: string): Record<string, unknown> {
  const lines = text.split("\n")
  const root: Record<string, unknown> = {}
  const stack: Array<{ indent: number; map: Record<string, unknown> }> = [{ indent: -1, map: root }]
  let index = 0
  while (index < lines.length) {
    const raw = lines[index]
    index += 1
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue
    const indent = raw.length - raw.trimStart().length
    const line = raw.slice(indent)
    const match = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?:[ \t]+(.*))?$/.exec(line)
    if (match === null) throw new Error("unsupported frontmatter line: " + line)
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
    const parent = stack[stack.length - 1].map
    const key = match[1]
    const rest = match[2] ?? ""
    if (rest.trim() === "") {
      let next: { indent: number; text: string } | undefined
      for (let probe = index; probe < lines.length; probe += 1) {
        const candidate = lines[probe]
        if (candidate.trim() === "" || candidate.trimStart().startsWith("#")) continue
        next = { indent: candidate.length - candidate.trimStart().length, text: candidate.trimStart() }
        break
      }
      if (next !== undefined && next.indent > indent && /^[A-Za-z0-9_][A-Za-z0-9_.-]*\s*:/.test(next.text)) {
        const child: Record<string, unknown> = {}
        parent[key] = child
        stack.push({ indent, map: child })
      } else parent[key] = null
      continue
    }
    const block = /^([|>])([+-]?)(\d*)$/.exec(rest.trim())
    if (block !== null) {
      const collected: string[] = []
      let blockIndent = -1
      while (index < lines.length) {
        const candidate = lines[index]
        if (candidate.trim() === "") { collected.push(""); index += 1; continue }
        const candidateIndent = candidate.length - candidate.trimStart().length
        if (candidateIndent <= indent) break
        if (blockIndent < 0) blockIndent = candidateIndent
        collected.push(candidate.slice(Math.min(blockIndent, candidateIndent)))
        index += 1
      }
      while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop()
      const joined = block[1] === "|" ? collected.join("\n") : foldLines(collected)
      parent[key] = block[2] === "-" ? joined.replace(/\n+$/, "") : joined
      continue
    }
    parent[key] = parseScalar(rest)
  }
  return root
}

export function parseFrontmatter(raw: string): Frontmatter | undefined {
  const firstLineEnd = raw.indexOf("\n")
  if (firstLineEnd < 0) return undefined
  if (raw.slice(0, firstLineEnd).replace(/\r$/, "") !== "---") return undefined
  let lineStart = firstLineEnd + 1
  let closingStart = -1
  let bodyStart = -1
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf("\n", lineStart)
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

/** A non-empty string field, or undefined (empty strings are treated as absent). */
export function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function frontmatterBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === "boolean") return value
  if (value === 1 || value === "1") return true
  if (value === 0 || value === "0") return false
  if (typeof value === "string") {
    const lower = value.toLowerCase()
    if (lower === "true" || lower === "yes" || lower === "on") return true
    if (lower === "false" || lower === "no" || lower === "off") return false
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

/**
 * The invocation contract, refusing the pre-rename spellings LOUDLY instead of guessing.
 * A skill that still carries `userInvocable` must be told which key replaced it.
 */
export function parseInvocation(data: Record<string, unknown>): InvocationBooleans {
  for (const legacy of ["disableModelInvocation", "modelInvocable", "userInvocable"]) {
    if (Object.hasOwn(data, legacy)) {
      const replacement = legacy === "userInvocable" ? "user-invocable" : "disable-model-invocation"
      throw new Error(`frontmatter field "${legacy}" is unsupported; use "${replacement}"`)
    }
  }
  return {
    modelInvocable: frontmatterBoolean(data, "disable-model-invocation") !== true,
    userInvocable: frontmatterBoolean(data, "user-invocable") !== false,
  }
}
