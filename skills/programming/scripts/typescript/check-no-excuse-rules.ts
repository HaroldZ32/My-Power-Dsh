#!/usr/bin/env bun
/**
 * Check TypeScript files for no-excuse violations.
 *
 * Rules:
 *   no-any-assertion       - `as any`
 *   no-unknown-assertion    - `as unknown`
 *   no-ts-ignore            - `@ts-ignore` comments
 *   no-ts-expect-error      - `@ts-expect-error` comments
 *   no-enum                 - `enum` declarations
 *   no-non-null-assertion   - `x!` postfix operator
 *   no-throw-literal        - `throw "string"` / `throw 123`
 *   no-mutable-export       - `export let` / `export var`
 *   no-any-annotation       - `: any` in annotations (opt out: `// no-excuse-ok: any`)
 *   no-explicit-any-return  - `(): any` return types (opt out: `// no-excuse-ok: any`)
 *   empty-catch             - `catch { }` or `catch (e) { }` with empty body
 *   catch-without-narrowing - catch block that uses error without instanceof narrowing
 *
 * Usage:
 *   bun run scripts/check-no-excuse-rules.ts <file-or-dir>...
 *
 * The `typescript` package is resolved from the caller project (process.cwd()),
 * not from this script's location, so the script works when executed from an
 * installed skill-cache path (e.g. ~/.codex/...) against a project checkout.
 *
 * Exit codes:
 *   0 - no violations
 *   1 - violations found
 *   2 - input error
 */

import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import process from "node:process"
import type * as tsTypes from "typescript/unstable/ast"

/** The TypeScript 7 async API module (`typescript/unstable/async`) as loaded from the caller. */
type TsApiModule = typeof import("typescript/unstable/async")
/** The TypeScript 7 AST module (`typescript/unstable/ast`). */
type TsAstModule = typeof import("typescript/unstable/ast")
/** The two TypeScript entry points this checker needs. */
type TsModule = {
  readonly api: TsApiModule
  readonly ast: TsAstModule
}

/** Resolve both TypeScript entry points from the caller project (process.cwd()) rather than from this script's own location; exits 2 with a clear message when they cannot be resolved. */
function loadTypescriptFromCaller(): TsModule {
  // A static import resolves from this script's installed skill-cache path
  // instead of the caller project. Resolve each TypeScript 7 API subpath from
  // the caller so the script uses the project it audits.
  const callerRequire = createRequire(path.join(process.cwd(), "no-excuse-anchor.cjs"))
  try {
    /** The caller's async API module, loaded before its shape is checked. */
    const api: Partial<TsApiModule> = callerRequire("typescript/unstable/async")
    /** The caller's AST module, loaded before its shape is checked. */
    const ast: Partial<TsAstModule> = callerRequire("typescript/unstable/ast")
    if (typeof api.API === "function" && typeof ast.isAsExpression === "function") {
      return { api: api as TsApiModule, ast: ast as TsAstModule }
    }
  } catch { // no-excuse-ok: catch
    // fall through to the clear error below
  }
  console.error(
    `error: cannot resolve "typescript" from the caller project (${process.cwd()}). ` +
      "Install it in the project being checked (e.g. `bun add -d typescript`) and re-run.",
  )
  process.exit(2)
}

/** The caller-resolved TypeScript modules, loaded once at module scope. */
const typescript = loadTypescriptFromCaller()
/** Shorthand for the AST module, the only half the rules read. */
const ts = typescript.ast

/** Ids of the twelve rules this checker can report. */
type RuleId =
  | "no-any-assertion"
  | "no-unknown-assertion"
  | "no-ts-ignore"
  | "no-ts-expect-error"
  | "no-enum"
  | "no-non-null-assertion"
  | "no-throw-literal"
  | "no-mutable-export"
  | "no-any-annotation"
  | "no-explicit-any-return"
  | "empty-catch"
  | "catch-without-narrowing"

/** One reported rule violation, positioned inside the checked file. */
type Violation = {
  readonly ruleId: RuleId
  readonly filePath: string
  readonly line: number
  readonly column: number
  readonly message: string
}

/** Extensions the checker parses; anything else is skipped during discovery. */
const INCLUDED_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"])
/** Directory names never descended into during discovery. */
const IGNORED_DIRECTORIES = new Set([
  ".git", ".next", ".nuxt", ".turbo", ".yarn",
  "coverage", "dist", "build", "node_modules",
])

/** Matches `// no-excuse-ok: any` on the offending line, which suppresses the two any-annotation rules. */
const OPT_OUT_RE = /\/\/\s*no-excuse-ok:\s*any/
/** Matches `// no-excuse-ok: catch` on the catch line, which suppresses the two catch rules. */
const CATCH_OK_RE = /\/\/\s*no-excuse-ok:\s*catch/

/** Whether the path carries an extension the checker parses. */
function isIncludedFile(filePath: string): boolean {
  return INCLUDED_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

/** Whether the path is a TypeScript declaration file, which is never checked. */
function isDeclarationFile(filePath: string): boolean {
  return filePath.endsWith(".d.ts") || filePath.endsWith(".d.mts") || filePath.endsWith(".d.cts")
}

/** Expand the CLI inputs into the file list to check: a file is taken as given, a directory is walked, and a missing path exits 2. */
function discoverFiles(inputs: string[]): string[] {
  /** Files collected so far, in discovery order. */
  const files: string[] = []
  for (const input of inputs) {
    /** The input as an absolute path. */
    const resolved = path.resolve(input)
    if (!fs.existsSync(resolved)) {
      console.error(`Path does not exist: ${resolved}`)
      process.exit(2)
    }
    if (fs.statSync(resolved).isFile()) {
      if (isIncludedFile(resolved) && !isDeclarationFile(resolved)) files.push(resolved)
      continue
    }
    /** Append every checkable file under one directory, depth first. */
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) walk(path.join(dir, entry.name))
        } else if (isIncludedFile(entry.name) && !isDeclarationFile(entry.name)) {
          files.push(path.join(dir, entry.name))
        }
      }
    }
    walk(resolved)
  }
  return files
}

/** The source text of one 0-based line, used by the opt-out comment lookups. */
function getLineText(sourceFile: tsTypes.SourceFile, line: number): string {
  /** Offset where each line of the file begins. */
  const lineStarts = sourceFile.getLineStarts()
  /** Offset where the requested line begins. */
  const start = lineStarts[line]
  /** Offset where it ends: the next line's start, or the end of the file. */
  const end = line + 1 < lineStarts.length ? lineStarts[line + 1] : sourceFile.getEnd()
  return sourceFile.text.slice(start, end)
}

/** Parse every file through one TypeScript project snapshot, keyed by the path used to request it. */
async function parseSourceFiles(filePaths: readonly string[]): Promise<ReadonlyMap<string, tsTypes.SourceFile>> {
  /** The caller's TypeScript API instance, rooted at the cwd so project configuration is honoured. */
  const compiler = new typescript.api.API({ cwd: process.cwd() })
  try {
    /** Snapshot of the caller project, held for the whole parse and disposed afterwards. */
    const snapshot = await compiler.updateSnapshot({ openFiles: [...filePaths] })
    try {
      /** One (path, source file) pair per requested file, in request order. */
      const sourceFiles = await Promise.all(filePaths.map(async (filePath) => {
        /** The default project owning this file, absent when none does. */
        const project = await snapshot.getDefaultProjectForFile(filePath)
        /** The parsed source file. */
        const sourceFile = await project?.program.getSourceFile(filePath)
        if (!sourceFile) {
          throw new Error(`TypeScript did not parse ${filePath}`)
        }
        return [filePath, sourceFile] as const
      }))
      return new Map(sourceFiles)
    } finally {
      await snapshot.dispose()
    }
  } finally {
    await compiler.close()
  }
}

/** Apply every rule to one parsed file and collect its violations. */
function analyzeFile(filePath: string, sourceFile: tsTypes.SourceFile): Violation[] {
  /** The file's raw text, read again for the regex-based comment scan at the end. */
  const source = fs.readFileSync(filePath, "utf-8")
  /** Violations found in this file. */
  const violations: Violation[] = []

  /** 1-based line and column of a node's start. */
  function pos(node: tsTypes.Node): { line: number; column: number } {
    /** The node's 0-based position inside the file. */
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    return { line: line + 1, column: character + 1 }
  }

  /** Whether the line a node starts on carries the `no-excuse-ok: any` opt-out. */
  function lineHasOptOut(node: tsTypes.Node): boolean {
    /** The node's 0-based start line. */
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    return OPT_OUT_RE.test(getLineText(sourceFile, line))
  }

  /** Walk the tree, checking every rule at each node. */
  function visit(node: tsTypes.Node): void {
    // ── as any / as unknown ──
    if (ts.isAsExpression(node)) {
      /** The asserted type as written, compared textually against `any` and `unknown`. */
      const typeText = node.type.getText(sourceFile)
      if (typeText === "any") {
        /** Position where the assertion is reported. */
        const p = pos(node)
        violations.push({ ruleId: "no-any-assertion", filePath, ...p, message: "`as any` — narrow with type guards or redesign the types" })
      }
      if (typeText === "unknown") {
        /** Position where the assertion is reported. */
        const p = pos(node)
        violations.push({ ruleId: "no-unknown-assertion", filePath, ...p, message: "`as unknown` — redesign the types" })
      }
    }

    // ── enum ──
    if (ts.isEnumDeclaration(node)) {
      /** Position of the enum declaration. */
      const p = pos(node)
      violations.push({ ruleId: "no-enum", filePath, ...p, message: "`enum` — use `as const` object + literal union type" })
    }

    // ── x! non-null assertion ──
    if (ts.isNonNullExpression(node)) {
      /** Position of the non-null assertion. */
      const p = pos(node)
      violations.push({ ruleId: "no-non-null-assertion", filePath, ...p, message: "`x!` — use narrowing or optional chaining" })
    }

    // ── throw "literal" ──
    if (ts.isThrowStatement(node) && node.expression) {
      /** The thrown expression. */
      const expr = node.expression
      if (ts.isStringLiteral(expr) || ts.isNumericLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
        /** Position of the throw statement. */
        const p = pos(node)
        violations.push({ ruleId: "no-throw-literal", filePath, ...p, message: "`throw literal` — throw an Error subclass" })
      }
      if (ts.isTemplateExpression(expr)) {
        /** Position of the throw statement. */
        const p = pos(node)
        violations.push({ ruleId: "no-throw-literal", filePath, ...p, message: "`throw template` — throw an Error subclass" })
      }
    }

    // ── export let / export var ──
    if (ts.isVariableStatement(node)) {
      /** Whether the declaration list carries the export modifier. */
      const hasExport = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      if (hasExport) {
        /** Declaration-list flags; the const flag separates `export const` from `export let`/`export var`. */
        const flags = node.declarationList.flags
        if (!(flags & ts.NodeFlags.Const)) {
          /** Position of the variable statement. */
          const p = pos(node)
          violations.push({ ruleId: "no-mutable-export", filePath, ...p, message: "`export let/var` — use `export const`" })
        }
      }
    }

    // ── : any in annotations ──
    if (ts.isTypeReferenceNode(node) || node.kind === ts.SyntaxKind.AnyKeyword) {
      if (node.kind === ts.SyntaxKind.AnyKeyword && !lineHasOptOut(node)) {
        /** The node's parent, which classifies this any keyword: assertion, annotation or return type. */
        const parent = node.parent
        // Skip `as any` — already caught by no-any-assertion
        if (parent && ts.isAsExpression(parent)) {
          // already handled
        } else if (parent && (
          parent.kind === ts.SyntaxKind.Parameter ||
          ts.isVariableDeclaration(parent) ||
          ts.isPropertyDeclaration(parent) ||
          parent.kind === ts.SyntaxKind.PropertySignature
        )) {
          /** Position of the any keyword. */
          const p = pos(node)
          violations.push({ ruleId: "no-any-annotation", filePath, ...p, message: "`: any` annotation — use `unknown` and narrow" })
        } else if (parent && (
          ts.isFunctionDeclaration(parent) ||
          ts.isMethodDeclaration(parent) ||
          ts.isArrowFunction(parent) ||
          ts.isFunctionExpression(parent)
        )) {
          /** Position of the any keyword. */
          const p = pos(node)
          violations.push({ ruleId: "no-explicit-any-return", filePath, ...p, message: "`(): any` return — use a specific type" })
        }
      }
    }

    // ── empty catch / catch without narrowing ──
    if (ts.isCatchClause(node)) {
      /** 0-based line the catch clause starts on. */
      const catchLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
      /** That line's text, searched for the catch opt-out. */
      const catchLineText = getLineText(sourceFile, catchLine)
      if (!CATCH_OK_RE.test(catchLineText)) {
        /** The catch block. */
        const body = node.block
        /** Its top-level statements; an empty list means an empty catch. */
        const stmts = body.statements

        if (stmts.length === 0) {
          // Empty catch — swallows everything silently
          const p = pos(node)
          violations.push({ ruleId: "empty-catch", filePath, ...p, message: "empty `catch` block — handle, re-throw, or remove the try/catch" })
        } else if (node.variableDeclaration) {
          // Has a bound variable — check if it's narrowed with instanceof
          const varName = node.variableDeclaration.name.getText(sourceFile)
          /** The block's text, searched for `instanceof` or a re-throw. */
          const blockText = body.getText(sourceFile)
          /** Whether the block narrows the error with `instanceof`. */
          const hasInstanceof = blockText.includes(`instanceof`)
          /** Whether the block re-throws the caught value or a new error. */
          const hasRethrow = blockText.includes(`throw ${varName}`) || blockText.includes(`throw new`)
          if (!hasInstanceof && !hasRethrow) {
            /** Position of the catch clause. */
            const p = pos(node)
            violations.push({ ruleId: "catch-without-narrowing", filePath, ...p, message: "`catch` without `instanceof` narrowing or re-throw — narrow the error type or re-throw" })
          }
        }
      }
    }

    node.forEachChild(visit)
  }

  visit(sourceFile)

  // ── @ts-ignore / @ts-expect-error in comments ──
  const commentRanges = [
    ...(ts.getLeadingCommentRanges(source, 0) ?? []),
  ]
  // Scan all comments via regex for reliability
  const commentRegex = /\/\/\s*@ts-(ignore|expect-error)/g
  /** Current match while scanning the file's comments for suppression directives. */
  let match: RegExpExecArray | null
  while ((match = commentRegex.exec(source)) !== null) {
    /** 0-based position of the matched directive. */
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(match.index)
    /** Which directive matched: `ignore` or `expect-error`. */
    const kind = match[1]
    violations.push({
      ruleId: kind === "ignore" ? "no-ts-ignore" : "no-ts-expect-error",
      filePath,
      line: line + 1,
      column: character + 1,
      message: `\`@ts-${kind}\` — fix the underlying type`,
    })
  }

  return violations
}

/** Render one violation in the compiler-style `path:line:column: [rule] message` form. */
function formatViolation(v: Violation): string {
  return `${v.filePath}:${v.line}:${v.column}: [${v.ruleId}] ${v.message}`
}

/** Entry point: discover and analyse the files, then exit 1 when any violation was reported. */
async function main(): Promise<void> {
  /** Command-line arguments after the script path. */
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error("usage: check-no-excuse-rules.ts <file-or-dir>...")
    process.exit(2)
  }

  /** The files to check. */
  const files = discoverFiles(args)
  if (files.length === 0) {
    console.error("No TypeScript files found.")
    process.exit(2)
  }

  /** Parsed source files, keyed by absolute path. */
  const sourceFiles = await parseSourceFiles(files)
  /** Every violation across every file, in file order. */
  const violations = files.flatMap((filePath) => {
    /** The parsed source file for this path. */
    const sourceFile = sourceFiles.get(filePath)
    if (!sourceFile) {
      throw new Error(`TypeScript did not parse ${filePath}`)
    }
    return analyzeFile(filePath, sourceFile)
  })

  if (violations.length === 0) {
    console.log(`No violations in ${files.length} file(s).`)
    return
  }

  for (const v of violations) {
    console.error(formatViolation(v))
  }
  console.error(`\n${violations.length} violation(s) in ${files.length} file(s).`)
  process.exit(1)
}

await main()
