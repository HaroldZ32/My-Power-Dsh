#!/usr/bin/env node
// The declaration-documentation gate (user requirement, standing): every variable, constant,
// function, class, interface, type and member in this repository's TypeScript sources carries a
// precise comment immediately above it, and every NAMED function declares its parameter and return
// types explicitly.
//
// WHY AN AST AND NOT A LINE SCAN: the requirement is about DECLARATIONS, and a regular expression
// cannot tell `const x = 1` from a `const` inside a multi-line `for` header, cannot see a class
// member or an interface signature at all, and cannot tell a comment that documents a declaration
// from one that merely sits above it. `typescript` is a devDependency used by this gate only; the
// project's typecheck stays on `tsgo`.
//
// WHAT IS CHECKED (the "family", stated so a green run is not read as more than it is):
//   · VariableStatement (each declared name), FunctionDeclaration, ClassDeclaration,
//     InterfaceDeclaration, TypeAliasDeclaration, EnumDeclaration, ModuleDeclaration;
//   · class PropertyDeclaration / MethodDeclaration / accessors / ConstructorDeclaration;
//   · interface PropertySignature / MethodSignature / CallSignature / ConstructSignature;
//   · enum members.
// Every one of them must be preceded by a comment that touches it: only whitespace may separate the
// comment's end from the declaration, and the comment must end on the line directly above it.
//
// WHAT IS DELIBERATELY OUT OF FAMILY, so silence is never mistaken for coverage:
//   · an inline callback's parameters and return type (`.map((x) => x + 1)`), which TypeScript
//     infers from the callee's signature — annotating those would fight the type system, not help it;
//   · statements and expressions (a comment on every `if` is not a contract, it is noise);
//   · generated trees (`dist/**`, `_deps/**`, `evidence/**`) and JavaScript sources;
//   · the ADOPTED agent-teams body at `packages/mpd-agent-teams-plugin/lib/**` and the two sha256-
//     PINNED pristine upstream fixtures under its `self-fix-tests/fixtures/upstream/`. Both are
//     upstream bytes this repository renamed rather than authored — the vendored body now carries a
//     first-line `@ts-nocheck` precisely because it is not code we type — so a per-declaration
//     contract comment above them is impossible by construction, not merely unwritten. The exclusion
//     is a whole PATH, never the segment `lib` (which would silently drop `skills/dsh-qa/scripts/lib/**`)
//     and never the package (whose `test/` and `self-fix-tests/` own code stays covered).
//
// Modes:
//   node scripts/verify-comment-coverage.ts                  scan the declared source set
//   node scripts/verify-comment-coverage.ts --list           print the scanned file set and exit
//   node scripts/verify-comment-coverage.ts --self-test      fixture arms, each with a clean control
//   node scripts/verify-comment-coverage.ts --out <dir>      also write <dir>/result.json + output.log
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript5"

/** Repository root, derived from this script's own location (`<root>/scripts/`). */
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

/** Directories whose `*.ts` files are part of the documented source set. */
const SOURCE_ROOTS: readonly string[] = [
  "src",
  "test",
]

/** Path segments that take a tree out of the source set (generated, vendored, or frozen). */
const EXCLUDED_SEGMENTS: readonly string[] = ["node_modules", "dist", "_deps", "evidence", ".qa-tmp", ".toolchain", "out"]

/**
 * Repository-relative path PREFIXES that take a whole tree out of the source set, for the two
 * adopted trees whose bytes are upstream's rather than ours (see the header's out-of-family
 * paragraph). Declared as full paths on purpose: a bare segment would over-exclude.
 */
const EXCLUDED_PATH_PREFIXES: readonly string[] = [
  "packages/mpd-agent-teams-plugin/lib",
  "packages/mpd-agent-teams-plugin/self-fix-tests/fixtures/upstream",
]

/** One declaration that fails the gate. */
interface Violation {
  /** Repository-relative file path. */
  readonly file: string
  /** 1-based line of the declaration. */
  readonly line: number
  /** Whether the failure is a missing comment or a missing type annotation. */
  readonly kind: "comment" | "parameter-type" | "return-type"
  /** The declaration's own name, for a reader to jump to it. */
  readonly name: string
}

/** Outcome counters, printed so a pass reports how much was actually inspected. */
interface Tally {
  /** Files parsed. */
  files: number
  /** Declarations inspected. */
  declarations: number
  /** Declarations skipped as out of family (inline callbacks, overload signatures). */
  skipped: number
}

/** Recursively collect `*.ts` files under one root, honouring {@link EXCLUDED_SEGMENTS}. */
function collectTs(dir: string, out: string[]): void {
/** The directory entries, or an empty list when it cannot be read. */
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (EXCLUDED_SEGMENTS.includes(entry)) continue
/** The entry's absolute path. */
    const full = join(dir, entry)
/** The entry's repository-relative path, matched against the whole-path exclusions. */
    const relativePath = relative(repoRoot, full).split("\\").join("/")
    if (EXCLUDED_PATH_PREFIXES.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`))) continue
/** Whether the entry is a directory to descend into. */
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) collectTs(full, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(full)
  }
}

/** The scan set, sorted, as repository-relative paths. */
function sourceFiles(): string[] {
/** Accumulated file paths, sorted once at the end. */
  const found: string[] = []
  for (const root of SOURCE_ROOTS) collectTs(join(repoRoot, root), found)
  return found.map((file) => relative(repoRoot, file).split("\\").join("/")).sort()
}

/** The comment directly above a declaration, or undefined when there is none. */
function leadingCommentOf(source: ts.SourceFile, node: ts.Node): string | undefined {
/** The file's full text, read once for the parse and for comment lookups. */
  const text = source.getFullText()
/** The comment ranges TypeScript attaches as leading trivia. */
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []
/** The comment closest to the declaration, which is the one that documents it. */
  const last = ranges.at(-1)
  if (last === undefined) return undefined
  /** Whatever sits between the comment's end and the declaration; only whitespace is documentation. */
  const between = text.slice(last.end, node.getStart(source))
  if (between.trim() !== "") return undefined
  /** The line the comment ends on; the declaration must start on the very next one. */
  const commentEndLine = text.slice(0, last.end).split("\n").length
/** The line the comment ends on; the declaration must start on the very next one. */
  const declarationLine = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
  if (declarationLine - commentEndLine > 1) return undefined
  return text.slice(last.pos, last.end)
}

/** Whether a comment's body is substantial enough to state a contract. */
function isPrecise(comment: string): boolean {
  /** The comment with its delimiters and leading asterisks removed, collapsed to one line. */
  const body = comment
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*?\s?/, "").trim())
    .filter((line) => line !== "")
    .join(" ")
  /** Words of the comment body; a one-word body restates the name instead of stating a contract. */
  const words = body.split(/\s+/).filter((word) => word !== "")
  return body.length >= 8 && words.length >= 2
}

/** A declaration's printed name, or `<anonymous>` when it has none. */
function nameOf(node: ts.Node): string {
  if ("name" in node) {
    /** The declared name node, when the declaration carries one. */
    const name = (node as { name?: ts.Node }).name
    if (name !== undefined && "getText" in name && typeof name.getText === "function") return name.getText()
  }
  return "<anonymous>"
}

/** Whether a function-like node is a named declaration whose signature must be fully annotated. */
function needsFullSignature(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  )
}

/** Inspect one file and append its violations to the shared list. */
function inspect(file: string, violations: Violation[], tally: Tally): void {
  /** Absolute path of the inspected file. */
  const absolute = join(repoRoot, file)
  /** The file's text, read once for the parse and for comment lookups. */
  const text = readFileSync(absolute, "utf8")
  /** The parsed source file, with parent pointers so `getStart` can see trivia. */
  const source = ts.createSourceFile(absolute, text, ts.ScriptTarget.ESNext, true)
  tally.files += 1

  /** Record a violation at a node's position. */
  const fail = (node: ts.Node, kind: Violation["kind"], name: string): void => {
    violations.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, kind, name })
  }

  /** Whether a declaration node must carry a precise leading comment. */
  const checkComment = (node: ts.Node, name: string, tallyDeclaration: boolean): void => {
    if (tallyDeclaration) tally.declarations += 1
    /** The comment immediately above the declaration, when there is one. */
    const comment = leadingCommentOf(source, node)
    if (comment === undefined || !isPrecise(comment)) fail(node, "comment", name)
  }

  /** Whether a function-like node's parameters and return type are all declared. */
  const checkSignature = (node: ts.SignatureDeclaration): void => {
    for (const parameter of node.parameters) {
      if (parameter.type === undefined) fail(parameter, "parameter-type", nameOf(node))
    }
    /** Accessors and constructors have no written return type by definition. */
    const returnTypeOptional = ts.isConstructorDeclaration(node) || ts.isSetAccessorDeclaration(node)
    if (!returnTypeOptional && node.type === undefined) fail(node, "return-type", nameOf(node))
  }

  /** Walk the tree, checking each declaration in the family. */
  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        checkComment(node, nameOf(declaration), true)
        /** A named arrow/function expression must carry its own signature, like a function declaration. */
        const initializer = declaration.initializer
        if (initializer !== undefined && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
          checkSignature(initializer)
        }
      }
    } else if (ts.isFunctionDeclaration(node)) {
      if (node.body === undefined) {
        tally.skipped += 1
      } else {
        checkComment(node, nameOf(node), true)
        checkSignature(node)
      }
    } else if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
      checkComment(node, nameOf(node), true)
    } else if (ts.isModuleDeclaration(node)) {
      checkComment(node, nameOf(node), true)
    } else if (ts.isPropertySignature(node) || ts.isMethodSignature(node)) {
      /** A member of a STRUCTURAL type literal is not a declaration a reader documents separately. */
      if (node.parent !== undefined && ts.isInterfaceDeclaration(node.parent)) checkComment(node, nameOf(node), true)
      else tally.skipped += 1
    } else if (ts.isPropertyDeclaration(node)) {
      checkComment(node, nameOf(node), true)
    } else if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node)) {
      checkComment(node, nameOf(node), true)
      checkSignature(node)
    } else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      tally.skipped += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

/** Render the report text. */
function render(files: readonly string[], violations: readonly Violation[], tally: Tally, limit: number): string {
  /** Violations grouped by file, so a reader sees one file's debt at once. */
  const byFile = new Map<string, Violation[]>()
  for (const violation of violations) {
/** The report lines, appended in reading order. */
    const list = byFile.get(violation.file) ?? []
    list.push(violation)
    byFile.set(violation.file, list)
  }
  /** Most-affected files first, which is the order the repair pass wants. */
  const ranked = [...byFile.entries()].sort((left, right) => right[1].length - left[1].length)
/** Violations grouped by file, so a reader sees one file's debt at once. */
  const lines = [
    "# verify-comment-coverage",
    "",
    `scanned ${tally.files} TypeScript file(s) of ${files.length} in the source set; inspected ${tally.declarations} declaration(s); skipped ${tally.skipped} inline callback(s) as out of family`,
    "",
  ]
  if (violations.length === 0) {
    lines.push("VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.")
    return `${lines.join("\n")}\n`
  }
  lines.push(`VERDICT: FAIL — ${violations.length} violation(s) across ${byFile.size} file(s).`, "")
/** The files the report lists, capped by --limit. */
  const shown = ranked.slice(0, limit)
  for (const [file, list] of shown) {
    lines.push(`${file} (${list.length})`)
    for (const violation of list.slice(0, 12)) lines.push(`  ${violation.line}: ${violation.kind} — ${violation.name}`)
    if (list.length > 12) lines.push(`  … ${list.length - 12} more`)
    lines.push("")
  }
  if (ranked.length > limit) lines.push(`… ${ranked.length - limit} further file(s) not listed (raise --limit).`)
  return `${lines.join("\n")}\n`
}

/** Fixture-driven negative controls: each mutant must fail for its own reason. */
function selfTest(): number {
  /** Directory holding the fixture files for this run. */
  const dir = join(repoRoot, ".qa-tmp", "comment-coverage-fixtures")
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  /** One fixture arm: file text, the violation kind expected, and whether it must produce any. */
  const arms: ReadonlyArray<{ name: string; text: string; expect: Violation["kind"] | "none" }> = [
    {
      name: "documented-and-typed",
      text: "/** Adds one to the given value. */\nexport function add(value: number): number {\n  /** The incremented value. */\n  const next: number = value + 1\n  return next\n}\n",
      expect: "none",
    },
    {
      name: "missing-comment",
      text: "export function add(value: number): number {\n  return value + 1\n}\n",
      expect: "comment",
    },
    {
      name: "comment-not-adjacent",
      text: "/** Adds one to the given value. */\n\n\nexport function add(value: number): number {\n  return value + 1\n}\n",
      expect: "comment",
    },
    {
      name: "vague-comment",
      text: "/** value */\nexport function add(value: number): number {\n  return value + 1\n}\n",
      expect: "comment",
    },
    {
      name: "missing-return-type",
      text: "/** Adds one to the given value. */\nexport function add(value: number) {\n  return value + 1\n}\n",
      expect: "return-type",
    },
    {
      name: "undocumented-local",
      text: "/** Adds one to the given value. */\nexport function add(value: number): number {\n  const next = value + 1\n  return next\n}\n",
      expect: "comment",
    },
  ]
/** Number of arms that did not behave as specified. */
  let failures = 0
  for (const arm of arms) {
/** The fixture file this arm writes and inspects. */
    const file = join(dir, `${arm.name}.ts`)
    writeFileSync(file, arm.text)
    /** Violations for this arm's own temporary source file. */
    const violations: Violation[] = []
    inspect(relative(repoRoot, file).split("\\").join("/"), violations, { files: 0, declarations: 0, skipped: 0 })
/** Whether the arm produced exactly the violations it declares. */
    const ok = arm.expect === "none" ? violations.length === 0 : violations.some((violation) => violation.kind === arm.expect)
    if (!ok) failures += 1
    console.log(`${ok ? "ok  " : "FAIL"}  ${arm.name}: expected ${arm.expect}, saw ${violations.map((violation) => violation.kind).join(",") || "none"}`)
  }
  rmSync(dir, { recursive: true, force: true })
  console.log(failures === 0 ? `self-test PASS (${arms.length} arms)` : `self-test FAIL (${failures} arm(s))`)
  return failures === 0 ? 0 : 1
}

/** Parse `--limit <n>` and `--out <dir>` out of the argument list. */
function options(argv: readonly string[]): { limit: number; out?: string; only?: string; file?: string } {
  /** Position of `--out` in the argument list, or -1. */
  const outIndex = argv.indexOf("--out")
  /** Position of `--limit` in the argument list, or -1. */
  const limitIndex = argv.indexOf("--limit")
  /** The number of files the report lists, defaulting to a screenful. */
  const limit = limitIndex === -1 ? 25 : Number.parseInt(argv[limitIndex + 1] ?? "25", 10)
  /** Position of `--only` in the argument list, or -1. */
  const onlyIndex = argv.indexOf("--only")
  /** Position of `--file` in the argument list, or -1 (an explicit single-file inspection). */
  const fileIndex = argv.indexOf("--file")
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : 25,
    out: outIndex === -1 ? undefined : resolve(argv[outIndex + 1] ?? ""),
    only: onlyIndex === -1 ? undefined : argv[onlyIndex + 1],
    file: fileIndex === -1 ? undefined : argv[fileIndex + 1],
  }
}

/** Gate entry point. */
function main(): number {
  /** Command-line arguments after the script path. */
  const argv = process.argv.slice(2)
  if (argv.includes("--self-test")) return selfTest()
  /** The scanned file set. */
  const { limit, out, only, file: single } = options(argv)
/** The scanned file set, narrowed by --only or --file when either was given. */
  const files = single !== undefined
    ? [single.replace(/^\.\//, "")]
    : sourceFiles().filter((file) => only === undefined || file.startsWith(only.replace(/^\.\//, "")))
  if (argv.includes("--list")) {
    process.stdout.write(`${files.join("\n")}\n`)
    return 0
  }
  /** Every violation found across the set. */
  const violations: Violation[] = []
  /** Inspection counters. */
  const tally: Tally = { files: 0, declarations: 0, skipped: 0 }
  for (const file of files) inspect(file, violations, tally)
  /** The report text, printed and optionally stored. */
  const text = render(files, violations, tally, limit)
  process.stdout.write(text)
  if (out !== undefined) {
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, "result.json"), `${JSON.stringify({ tally, violations, verdict: violations.length === 0 ? "pass" : "fail" }, null, 2)}\n`, { flag: "wx" })
    writeFileSync(join(out, "output.log"), text, { flag: "wx" })
  }
  return violations.length === 0 ? 0 : 1
}

process.exitCode = main()
