// hints.ts — the pre-flight pattern linter this server runs BEFORE it spawns `sg`.
//
// ast-grep patterns are code, not regex, and the two most common caller mistakes (regex habits such
// as `\w`, `.*` or `[a-z]`, and a lowercase metavariable such as `$name`) produce either a confusing
// ast-grep diagnostic or a silent empty result. The linter turns each of those into a named,
// actionable rejection. Two severities exist: `always-reject` (no caller flag can bypass it, because
// the request can never be honoured) and `reject` (bypassed by `force: true`, for a caller who knows
// the pattern is deliberate). `warn` never blocks.
//
// The diagnostics are kept byte-identical to this server's previous implementation on purpose: an
// agent reads them, and a QA case asserts them, so a reworded message is a behaviour change.

/** How strictly one finding is enforced. */
export type HintSeverity = "warn" | "reject" | "always-reject"

/** One finding of the pattern linter. */
export interface Hint {
  /** Stable machine-readable code of this finding (e.g. `REGEX_DOT_STAR`). */
  code: string
  /** Whether the finding blocks the call, blocks it unless forced, or only warns. */
  severity: HintSeverity
  /** The caller-facing sentence for this finding. */
  message: string
}

/** Inputs of the linter beyond the pattern itself, mirroring the tool arguments. */
export interface ValidationOpts {
  /** Bypasses `reject` findings (never `always-reject` ones). */
  force?: boolean
  /** The call's `paths`, re-checked here so an empty list is rejected before any spawn. */
  paths?: unknown
  /** The call's match limit, re-checked here so a non-positive integer is rejected. */
  limit?: unknown
}

/** The linter's verdict: whether the call may proceed, and every finding behind that decision. */
export interface ValidationResult {
  /** True when the call may proceed (warnings included). */
  ok: boolean
  /** True when the call must not proceed. */
  rejected: boolean
  /** The code that decided a rejection, or null when nothing was rejected. */
  code: string | null
  /** Every finding, in the order the checks produced them. */
  hints: Hint[]
}

/** The metavariables a code snippet names, split by cardinality. */
export interface MetavarSet {
  /** Names captured by `$NAME` (one node each). */
  single: Set<string>
  /** Names captured by `$$$NAME` (zero or more nodes). */
  multi: Set<string>
}

/** The 25 languages ast-grep can parse, as the tool schemas publish them. */
const LANGUAGES = new Set([
  "bash", "c", "cpp", "csharp", "css", "elixir", "go", "haskell", "html",
  "java", "javascript", "json", "kotlin", "lua", "nix", "php", "python",
  "ruby", "rust", "scala", "solidity", "swift", "typescript", "tsx", "yaml",
])

/** Short spellings a caller may use for a canonical language name. */
const LANG_ALIASES: Record<string, string> = {
  js: "javascript", jsx: "javascript", ts: "typescript", py: "python",
  py3: "python", rb: "ruby", rs: "rust", kt: "kotlin", ex: "elixir",
  hs: "haskell", sh: "bash", zsh: "bash", cc: "cpp", "c++": "cpp",
  cxx: "cpp", cs: "csharp", yml: "yaml", sol: "solidity", golang: "go",
}

/** Regex escapes that do not exist in an ast-grep pattern. */
const RE_BACKSLASH = /\\w|\\d|\\s|\\b/
/** A regex wildcard, but only when it is not the tail of a `$$$` metavariable. */
const RE_DOT_STAR = /(?<!\$)\.\*|(?<!\$)\.\+/
/** A double-dollar metavariable with a single-letter name, which ast-grep does not define. */
const RE_DOUBLE_DOLLAR = /(?<!\$)\$\$(?!\$)[A-Za-z_]/
/** Every metavariable-shaped token, so each one's NAME can be checked for case. */
const RE_ANY_METAVAR = /(?<!\$)\$(?!\$)([A-Za-z_][A-Za-z0-9_]*)/g
/** A Python `def`/`class` header that still carries its trailing colon. */
const RE_PY_TRAILING_COLON = /^\s*(?:def|class)\s+\$?\w+[^:]*:\s*$/m
/** A JS/TS `function` header with no body block. */
const RE_JS_INCOMPLETE = /^\s*(?:async\s+)?function\s+\$?\w+(?:\([^)]*\))?\s*$/m
/** A Go `func` header with no body block. */
const RE_GO_INCOMPLETE = /^\s*func\s+\$?\w+(?:\([^)]*\))?\s*$/m
/** A Rust `fn` header with no body block. */
const RE_RUST_INCOMPLETE = /^\s*fn\s+\$?\w+(?:\([^)]*\))?\s*$/m

/**
 * Decide whether a whole pattern is nothing but a regex character class.
 *
 * The decision table is deliberately narrow — a bracket expression is only called a regex class when
 * it contains an alphanumeric range, a leading caret, or one of `_`, `.` or a space — because the
 * common valid shapes (`[a, b]`, `obj[foo_bar]`, `type T = [A, B]`, `arr[0]`) must NOT be rejected.
 * @param pattern - the caller's pattern
 * @returns true when the pattern is a bare regex character class
 */
function isRegexCharClass(pattern: string): boolean {
  /** The pattern without surrounding whitespace. */
  const trimmed = pattern.trim()
  if (!/^\[\^?[^\]]+\]$/.test(trimmed)) return false
  /** The bracket expression's contents, with an optional leading caret dropped. */
  const inner = trimmed.replace(/^\[\^?/, "").replace(/\]$/, "")
  if (inner.includes(",")) return false
  if (/[a-zA-Z0-9]-[a-zA-Z0-9]/.test(inner)) return true
  if (/^\[\^/.test(trimmed)) return true
  if (/[_. ]/.test(inner)) return true
  return false
}

/**
 * Resolve a caller's language spelling to one of the 25 canonical names.
 * @param lang - the caller's spelling
 * @returns the canonical name, or null when the language is not supported
 */
function normalizeLanguage(lang: string): string | null {
  /** The spelling lower-cased, which is how aliases are keyed. */
  const lower = lang.toLowerCase()
  /** The canonical name the spelling maps to, or the spelling itself. */
  const canonical = LANG_ALIASES[lower] ?? lower
  return LANGUAGES.has(canonical) ? canonical : null
}

/**
 * Whether a pattern contains a literal `|` that may have been meant as regex alternation.
 * @param pattern - the caller's pattern
 * @returns true when a likely alternation is present
 */
function findAlternation(pattern: string): boolean {
  /** The pattern with string literals removed, so a `|` inside a string is not counted. */
  const stripped = pattern.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "")
  if (stripped.includes("||")) return false
  return /(?:\w|\$\w+|\w+\(\))\s*\|\s*(?:\w|\$\w+|\w+\(\))/.test(stripped)
}

/**
 * Whether a `paths` argument is a non-empty array of non-empty strings.
 * @param paths - the raw argument
 * @returns true when the argument is usable
 */
function isValidPaths(paths: unknown): boolean {
  if (!Array.isArray(paths)) return false
  if (paths.length === 0) return false
  return paths.every((path) => typeof path === "string" && path.length > 0)
}

/**
 * Whether a `limit` argument is a positive finite integer.
 * @param limit - the raw argument
 * @returns true when the argument is usable
 */
function isValidLimit(limit: unknown): boolean {
  return typeof limit === "number" && Number.isFinite(limit) && Number.isInteger(limit) && limit > 0
}

/**
 * Extract every metavariable a snippet names, split by cardinality.
 * @param text - a pattern or a rewrite template
 * @returns the single-node and multi-node names it references
 */
export function extractMetavars(text: string): MetavarSet {
  /** Names captured by `$$$NAME`. */
  const single = new Set<string>()
  /** Names captured by `$$$NAME`. */
  const multi = new Set<string>()
  /** Match state of the multi-node metavariable scan. */
  let m: RegExpExecArray | null

  /** Scanner over `$$$NAME` tokens. */
  const reMulti = /\$\$\$([A-Z][A-Z0-9_]*)/g
  while ((m = reMulti.exec(text)) !== null) {
    multi.add(m[1])
  }

  /** Scanner over `$NAME` tokens that are not part of a `$$$NAME`. */
  const reSingle = /(?<!\$)\$(?!\$)([A-Z][A-Z0-9_]*)/g
  while ((m = reSingle.exec(text)) !== null) {
    single.add(m[1])
  }

  return { single, multi }
}

/**
 * Lint a search pattern before it reaches `sg`.
 * @param pattern - the caller's pattern
 * @param language - the caller's language spelling
 * @param opts - `force`, `paths` and `limit` as the caller supplied them
 * @returns the verdict, naming the deciding code when it rejects
 */
export function validatePatternHints(
  pattern: string,
  language: string,
  opts: ValidationOpts = {},
): ValidationResult {
  /** Whether the caller asked to bypass non-fatal rejections. */
  const force = opts.force ?? false
  /** Findings accumulated so far, in check order. */
  const hints: Hint[] = []

  if (pattern.trim().length === 0) {
    hints.push({ code: "PATTERN_EMPTY", severity: "always-reject", message: "Pattern is empty." })
  }

  /** The canonical language, or null when the caller named an unsupported one. */
  const canonical = normalizeLanguage(language)
  if (canonical === null) {
    hints.push({
      code: "LANGUAGE_UNSUPPORTED",
      severity: "always-reject",
      message: `Language '${language}' is not supported. Use one of the 25 ast-grep languages.`,
    })
  }

  if (opts.paths !== undefined && !isValidPaths(opts.paths)) {
    hints.push({ code: "INVALID_PATH", severity: "always-reject", message: "Paths must be a non-empty array of non-empty strings." })
  }

  if (opts.limit !== undefined && !isValidLimit(opts.limit)) {
    hints.push({ code: "INVALID_LIMIT", severity: "always-reject", message: "Limit must be a positive finite integer." })
  }

  /** The first unconditional rejection, which decides the verdict on its own. */
  const alwaysReject = hints.find((hint) => hint.severity === "always-reject")
  if (alwaysReject) {
    return { ok: false, rejected: true, code: alwaysReject.code, hints }
  }

  if (RE_BACKSLASH.test(pattern)) {
    hints.push({
      code: "REGEX_BACKSLASH_ESCAPE",
      severity: "reject",
      message: "Backslash escapes (\\w, \\d, \\s, \\b) are regex, not ast-grep. Use $VAR for identifiers.",
    })
  }

  if (RE_DOT_STAR.test(pattern)) {
    hints.push({
      code: "REGEX_DOT_STAR",
      severity: "reject",
      message: "'.*' and '.+' are regex wildcards. Use $$$ for multiple nodes or $VAR for one.",
    })
  }

  if (isRegexCharClass(pattern)) {
    hints.push({
      code: "REGEX_CHAR_CLASS",
      severity: "reject",
      message: "Character classes like [a-z] are regex syntax. ast-grep has no AST equivalent.",
    })
  }

  if (canonical === "python" && RE_PY_TRAILING_COLON.test(pattern)) {
    hints.push({
      code: "PATTERN_INCOMPLETE_FORM",
      severity: "reject",
      message: "Python pattern has trailing ':'. Drop the colon: 'def $FUNC($$$)' or 'class $C($$$)'.",
    })
  }
  if ((canonical === "javascript" || canonical === "typescript" || canonical === "tsx") && RE_JS_INCOMPLETE.test(pattern)) {
    hints.push({
      code: "PATTERN_INCOMPLETE_FORM",
      severity: "reject",
      message: "JS/TS function pattern is incomplete. Add params and body: 'function $NAME($$$) { $$$ }'.",
    })
  }
  if (canonical === "go" && RE_GO_INCOMPLETE.test(pattern)) {
    hints.push({
      code: "PATTERN_INCOMPLETE_FORM",
      severity: "reject",
      message: "Go function pattern is incomplete. Add params and body: 'func $NAME($$$) { $$$ }'.",
    })
  }
  if (canonical === "rust" && RE_RUST_INCOMPLETE.test(pattern)) {
    hints.push({
      code: "PATTERN_INCOMPLETE_FORM",
      severity: "reject",
      message: "Rust fn pattern is incomplete. Add params and body: 'fn $NAME($$$) -> $RET { $$$ }'.",
    })
  }

  if (RE_DOUBLE_DOLLAR.test(pattern)) {
    hints.push({
      code: "METAVAR_DOUBLE_DOLLAR",
      severity: "reject",
      message: "$$NAME is invalid. Use $$$NAME for multi-node capture or $NAME for single.",
    })
  }

  /** Match state of the metavariable-name scan. */
  let m: RegExpExecArray | null
  RE_ANY_METAVAR.lastIndex = 0
  while ((m = RE_ANY_METAVAR.exec(pattern)) !== null) {
    /** The token's name, without its `$`. */
    const name = m[1]
    if (name === "_") continue
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      hints.push({
        code: "INVALID_METAVAR_NAME",
        severity: "reject",
        message: `Metavariable name $${name} must be UPPERCASE (e.g. $${name.toUpperCase()}) or use $_ for wildcard.`,
      })
      break
    }
  }

  if (findAlternation(pattern)) {
    hints.push({
      code: "BARE_ALTERNATION",
      severity: "warn",
      message: "Literal '|' may be a TS union or bitwise-or. If regex alternation, use separate calls.",
    })
  }

  /** The first finding that blocks the call unless the caller forces it. */
  const hardReject = hints.find((hint) => hint.severity === "reject")
  if (hardReject && !force) {
    return { ok: false, rejected: true, code: "PATTERN_HINT_REJECTED", hints }
  }

  return { ok: true, rejected: false, code: null, hints }
}

/**
 * Lint a pattern AND its rewrite template before the preview pass.
 *
 * Beyond the pattern checks this enforces the two rewrite-only invariants: a replacement may only
 * reference metavariables the pattern actually captures, and a name must keep its cardinality between
 * the two (a single-node capture cannot become a `$$$NAME` in the replacement). Both are
 * `always-reject`: a replacement naming an uncaptured metavariable can never be honoured.
 * @param pattern - the caller's pattern
 * @param rewrite - the caller's replacement template
 * @param language - the caller's language spelling
 * @param opts - `force`, `paths` and `limit` as the caller supplied them
 * @returns the verdict, naming the deciding code when it rejects
 */
export function validateRewriteHints(
  pattern: string,
  rewrite: string,
  language: string,
  opts: ValidationOpts = {},
): ValidationResult {
  /** Whether the caller asked to bypass non-fatal rejections. */
  const force = opts.force ?? false

  /** The pattern's own verdict, which the rewrite checks extend. */
  const patternResult = validatePatternHints(pattern, language, opts)
  /** Every finding, starting with the pattern's. */
  const hints = [...patternResult.hints]

  if (patternResult.rejected && patternResult.code !== "PATTERN_HINT_REJECTED") {
    return patternResult
  }

  /** Metavariables the pattern captures. */
  const pm = extractMetavars(pattern)
  /** Metavariables the replacement names. */
  const rm = extractMetavars(rewrite)
  /** Every name the pattern binds, of either cardinality. */
  const patternNames = new Set([...pm.single, ...pm.multi])
  /** Every name the replacement references, of either cardinality. */
  const rewriteNames = new Set([...rm.single, ...rm.multi])

  for (const name of rewriteNames) {
    if (!patternNames.has(name)) {
      hints.push({
        code: "REWRITE_UNBOUND_METAVARIABLE",
        severity: "always-reject",
        message: `Rewrite uses metavariable $${name} not captured by pattern.`,
      })
      break
    }
  }

  for (const name of rewriteNames) {
    if (!patternNames.has(name)) continue
    /** Whether the pattern binds this name as a single node. */
    const pSingle = pm.single.has(name)
    /** Whether the pattern binds this name as a multi-node capture. */
    const pMulti = pm.multi.has(name)
    /** Whether the replacement uses this name as a single node. */
    const rSingle = rm.single.has(name)
    /** Whether the replacement uses this name as a multi-node capture. */
    const rMulti = rm.multi.has(name)
    if ((pSingle && !pMulti && rMulti && !rSingle) || (pMulti && !pSingle && rSingle && !rMulti)) {
      hints.push({
        code: "REWRITE_CARDINALITY_MISMATCH",
        severity: "always-reject",
        message: `Metavariable ${name} cardinality mismatch between pattern and rewrite.`,
      })
      break
    }
  }

  /** The first unconditional rejection among all findings. */
  const alwaysReject = hints.find((hint) => hint.severity === "always-reject")
  if (alwaysReject) {
    return { ok: false, rejected: true, code: alwaysReject.code, hints }
  }

  if (patternResult.rejected && !force) {
    return { ok: false, rejected: true, code: "PATTERN_HINT_REJECTED", hints }
  }

  return { ok: true, rejected: false, code: null, hints }
}
