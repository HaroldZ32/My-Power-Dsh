// Harness JSON-Schema subset: a local mirror of the validator plus a projector.
//
// WHY this file exists: `ctx.tools.register` runs `assertSupportedJsonSchema` on
// `output.schema` (H/dsh-tools/lib/index.js:2777) and a rejection throws
// JsonSchemaError OUT of the registration call, which can take the whole plugin
// tree down (AGENTS.md §12). An MCP server is a third party: its `inputSchema`
// and `outputSchema` are foreign data and must never be handed to the harness
// unchecked.
//
// Two policies, deliberately different (frozen contract §1.4 mcp, REV4 + release
// findings F1/F2):
//   · `parameters` — PROJECT the foreign schema onto the subset and normalize its
//     ROOT onto an object (a tool call always carries an arguments object, so a
//     scalar/array/oneOf root is not callable as-is). This harness release does not
//     validate `parameters` at all (H/dsh-mcp-client/lib/index.js:203-207 passes
//     `tool.inputSchema` straight through), so the projection is DEFENSE-IN-DEPTH
//     against a future harness, not a fix for a live abort.
//   · `output.schema` — KEEP-OR-DROP THE SCHEMA, NEVER THE TOOL: a schema outside
//     the subset, or one that would have to be rewritten to fit, is dropped so the
//     tool still registers without `structuredContent`. That is exactly the harness's
//     posture (H/dsh-mcp-client/lib/index.js:186-196 `supportedOutputSchema` keeps
//     the tool and drops the schema to `{}`); the REV4 wording ("drop that tool")
//     was strictly blunter than the seam it mirrors. A third party's schema is
//     never rewritten, because a rewritten schema would no longer describe what the
//     server actually returns.
//
// The reported `lossy` flag is what separates the two policies: `lossy === false`
// means the projection is byte-for-byte the input schema (so keep-or-drop may
// keep it), `lossy === true` means something was normalized away.
//
// Dependency-free by construction (zero runtime imports): the same module is
// consumed by the runtime bridge and can be exercised standalone.
//
// Measured subset (H/dsh-tools/lib/index.js:33-54, 151-158, 322-326):
//   constraint keywords  type, oneOf, properties, required, additionalProperties, items, enum, const
//   annotation keywords  description, title, default, examples
//   types                object, array, string, number, integer, boolean, null
//   · `type` is a SINGLE string (type arrays are rejected; `oneOf:[…,{type:"null"}]` is the accepted nullable spelling)
//   · `type` and `oneOf` are mutually exclusive; `oneOf` needs >=2 schemas and forbids sibling constraint keywords
//   · `properties`/`required`/`additionalProperties` only under `object`; every `required` name must exist in `properties`
//   · `additionalProperties` must be a boolean
//   · `items` only under `array`
//   · `enum`/`const` only on scalar types; `const` must be inside `enum` when both are declared
//   · boolean schemas are not schemas; circular graphs are rejected

/** Constraint keywords (the harness's `CONSTRAINT_KEYWORDS`). */
export const SCHEMA_CONSTRAINT_KEYWORDS: readonly string[] = [
  "type",
  "oneOf",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
]

/** Annotation keywords (the harness's `ANNOTATION_KEYWORDS`). */
export const SCHEMA_ANNOTATION_KEYWORDS: readonly string[] = ["description", "title", "default", "examples"]

/** Closed type table (the harness's `SCHEMA_TYPES`). */
export const SCHEMA_TYPES: readonly string[] = ["object", "array", "string", "number", "integer", "boolean", "null"]

/** Scalar types that may carry `enum`/`const`. */
const SCALAR_TYPES: readonly string[] = ["string", "number", "integer", "boolean", "null"]

/** Keywords that are invalid beside `oneOf` (the harness's `ONE_OF_SIBLING_KEYWORDS`). */
const ONE_OF_SIBLING_KEYWORDS: readonly string[] = [
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
]

/**
 * Structural guard for "a JSON object and nothing else": non-null, not an array, and
 * carrying `Object.prototype` (or a null prototype) as its prototype. The validator
 * walks schemas a third-party MCP server supplied, so an array or a class instance
 * must never be mistaken for a schema container.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  // Prototype of the candidate; a null-prototype object counts as plain too.
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Lossless finite JSON number, excluding negative zero — the same rule, and the same
 * wording, the harness's own `isJsonNumber` uses, so mirror and seam agree on which
 * numbers a schema may carry.
 */
function isJsonNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)
}

/** Lossless JSON data (annotations must be lossless JSON; getters cannot throw here). */
function isLosslessJson(value: unknown, seen: Set<object>): boolean {
  if (value === null) return true
  // Primitive tag of the candidate, read once so the narrowing below stays honest.
  const kind = typeof value
  if (kind === "string" || kind === "boolean") return true
  if (kind === "number") return isJsonNumber(value)
  if (kind !== "object") return false
  // Widened to `object` so `seen` (a Set<object>) can hold it; the
  // `typeof value === "object"` test above is what makes the cast sound.
  const record = value as object
  if (seen.has(record)) return false
  seen.add(record)
  // Verdict accumulator, so the `seen` entry can be released before every return.
  let ok = true
  if (Array.isArray(value)) {
    ok = value.every((entry) => isLosslessJson(entry, seen))
  } else if (isPlainRecord(value)) {
    ok = Object.values(value).every((entry) => isLosslessJson(entry, seen))
  } else {
    ok = false
  }
  seen.delete(record)
  return ok
}

/**
 * Membership test of one CLOSED subset type against a foreign JSON value. Two deliberate
 * divergences from the harness's own `scalarMatches`, both on the safe side: an unknown
 * `type` answers false instead of reaching that function's `assertNever` throw, and
 * `integer` accepts `-0` (`Number.isInteger(-0)` is true) where the harness additionally
 * requires `isJsonNumber`.
 */
function scalarMatches(type: string, value: unknown): boolean {
  switch (type) {
    case "string": return typeof value === "string"
    case "number": return isJsonNumber(value)
    case "integer": return typeof value === "number" && Number.isInteger(value)
    case "boolean": return typeof value === "boolean"
    case "null": return value === null
    default: return false
  }
}

/**
 * Collect every violation of the enforced subset, exactly mirroring the
 * harness validator's order-independent walk (`checkSchemaNode`). Returns an
 * empty array for a schema the harness would accept.
 *
 * @param root - The schema to walk; typed `unknown` because the caller holds foreign data
 *   that no check has admitted yet.
 * @param rootPath - Prefix put in front of every message, so a caller that already knows
 *   where the schema came from can name it in the violation.
 */
export function schemaViolations(root: unknown, rootPath: string = "schema"): string[] {
  // One human-readable line per violation, in walk order; empty means "the harness would accept it".
  const violations: string[] = []
  // Nodes on the CURRENT walk path, not every node ever seen: a shared sub-schema is legal, a cycle is not.
  const seen = new Set<object>()

  // The object-only tail: `required` must name declared properties and `additionalProperties` must be boolean.
  const visitObjectTail = (node: Record<string, unknown>, path: string): void => {
    if (Object.hasOwn(node, "required")) {
      // Untrusted `required` value; validated as an array of strings before any name is used.
      const required = node.required
      if (!Array.isArray(required) || required.some((entry) => typeof entry !== "string")) {
        violations.push(`${path}.required must be an array of strings`)
      } else {
        // Properties the node actually declares; with none of them, every `required` name is dangling.
        const declared = isPlainRecord(node.properties) ? node.properties : {}
        for (const key of required as string[]) {
          if (!Object.hasOwn(declared, key)) violations.push(`${path}.required names "${key}" which is not in properties`)
        }
      }
    }
    if (Object.hasOwn(node, "additionalProperties") && typeof node.additionalProperties !== "boolean") {
      violations.push(`${path}.additionalProperties must be a boolean`)
    }
  }

  // Recursive walk of one schema node; `path` is the dotted prefix every message is built from.
  const visit = (node: unknown, path: string): void => {
    if (!isPlainRecord(node)) {
      violations.push(`${path} must be a schema object`)
      return
    }
    if (seen.has(node)) {
      violations.push(`${path} is circular`)
      return
    }
    seen.add(node)
    for (const key of Object.keys(node)) {
      if (SCHEMA_CONSTRAINT_KEYWORDS.includes(key)) continue
      if (SCHEMA_ANNOTATION_KEYWORDS.includes(key)) {
        if (!isLosslessJson(node[key], new Set())) violations.push(`${path}.${key} annotation must be lossless JSON data`)
        continue
      }
      violations.push(
        `${path}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`,
      )
    }
    if (Object.hasOwn(node, "description") && typeof node.description !== "string") {
      violations.push(`${path}.description must be a string`)
    }
    if (Object.hasOwn(node, "title") && typeof node.title !== "string") {
      violations.push(`${path}.title must be a string`)
    }
    // Presence flags, not values: `type: undefined` still counts as declaring `type`.
    const hasType = Object.hasOwn(node, "type")
    // As with `hasType`: `type` and `oneOf` are exclusive by PRESENCE, never by value.
    const hasOneOf = Object.hasOwn(node, "oneOf")
    if (hasType && hasOneOf) {
      violations.push(`${path} cannot declare both type and oneOf`)
      seen.delete(node)
      return
    }
    if (!hasType && !hasOneOf) {
      for (const key of ONE_OF_SIBLING_KEYWORDS) {
        if (Object.hasOwn(node, key)) violations.push(`${path}.${key} requires type or oneOf`)
      }
      seen.delete(node)
      return
    }
    if (hasOneOf) {
      // Untrusted `oneOf` value; each branch is visited under its own indexed path.
      const oneOf = node.oneOf
      if (!Array.isArray(oneOf) || oneOf.length < 2) {
        violations.push(`${path}.oneOf must be an array of at least two schemas`)
      } else {
        oneOf.forEach((branch, index) => visit(branch, `${path}.oneOf[${index}]`))
      }
      for (const key of ONE_OF_SIBLING_KEYWORDS) {
        if (Object.hasOwn(node, key)) violations.push(`${path}.${key} is not supported beside oneOf`)
      }
      seen.delete(node)
      return
    }
    // Declared type, still `unknown` (fresh from foreign data); the closed type table decides below.
    const type = node.type
    if (typeof type !== "string" || !SCHEMA_TYPES.includes(type)) {
      violations.push(
        Array.isArray(type)
          ? `${path}.type must be a single type string (type arrays are not supported)`
          : `${path}.type must be one of ${SCHEMA_TYPES.join("/")}`,
      )
      seen.delete(node)
      return
    }
    // Keyword -> the closed set of types it may appear on (mirrors the harness table).
    const allowedFor: Record<string, readonly string[]> = {
      properties: ["object"],
      required: ["object"],
      additionalProperties: ["object"],
      items: ["array"],
      enum: SCALAR_TYPES,
      const: SCALAR_TYPES,
    }
    for (const [key, types] of Object.entries(allowedFor)) {
      if (Object.hasOwn(node, key) && !types.includes(type)) {
        violations.push(`${path}.${key} is not supported on type "${type}"`)
      }
    }
    if (type === "object") {
      if (Object.hasOwn(node, "properties")) {
        // Untrusted `properties` map; every entry is visited as a full schema of its own.
        const properties = node.properties
        if (!isPlainRecord(properties)) violations.push(`${path}.properties must be an object of schemas`)
        else for (const [key, child] of Object.entries(properties)) visit(child, `${path}.properties.${key}`)
      }
      visitObjectTail(node, path)
    } else if (type === "array") {
      if (Object.hasOwn(node, "items")) visit(node.items, `${path}.items`)
    } else {
      // A PRESENT-but-invalid `enum` is itself a violation, so presence is what selects this branch.
      const hasEnum = Object.hasOwn(node, "enum")
      // The declared `enum` value, or undefined when the keyword is absent.
      const allowed = hasEnum ? node.enum : undefined
      // An `enum` is legal only as a NON-EMPTY array of values of this very scalar type.
      const enumValid = Array.isArray(allowed) && allowed.length > 0 && allowed.every((entry) => scalarMatches(type, entry))
      if (hasEnum && !enumValid) violations.push(`${path}.enum must be a non-empty array of ${type} values`)
      if (Object.hasOwn(node, "const")) {
        if (!scalarMatches(type, node.const)) violations.push(`${path}.const must be a ${type} value`)
        else if (enumValid && !(allowed as unknown[]).includes(node.const)) {
          violations.push(`${path}.const must be one of ${path}.enum when both are declared`)
        }
      }
    }
    seen.delete(node)
  }

  visit(root, rootPath)
  return violations
}

/** Would the harness accept this schema unchanged? */
export function isSupportedSchema(value: unknown): boolean {
  return schemaViolations(value).length === 0
}

/** Outcome of projecting one foreign schema: either a schema the harness accepts, or the reasons none could be built. */
export interface SchemaProjection {
  /** The projected schema, or undefined when the node cannot be projected at all. */
  schema?: Record<string, unknown>
  /** Violations that survived projection (empty when `schema` is defined). */
  violations: string[]
  /** True when the projection differs from the input (something was normalized away). */
  lossy: boolean
  /** Human-readable record of every normalization, one line each. */
  notes: string[]
}

/** Structural, key-order-insensitive equality for two schema values. */
function schemaEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((entry, index) => schemaEqual(entry, right[index]))
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false
  // Key lists enumerated up front so a differing key COUNT short-circuits before the deep walk.
  const leftKeys = Object.keys(left)
  // Key order is deliberately ignored: schemas differing only in key order are equal here.
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => Object.hasOwn(right, key) && schemaEqual(left[key], right[key]))
}

/** A single projected node, or undefined when it cannot be projected. */
type Projected = Record<string, unknown> | undefined

/** Mutable accumulator threaded through ONE projection: what was normalized, and what had to be refused. */
interface Projector {
  /** One line per normalization, prefixed with the path of the node it happened on. */
  notes: string[]
  /** One line per refused node; a non-empty list is why `projectSchema` returns no schema. */
  unprojectable: string[]
  /** Guards against an unbounded rewrite of a circular structure. */
  depth: number
}

/**
 * Hard ceiling on projection nesting depth. It bounds the rewrite of a deeply nested
 * (or adversarial) foreign schema: past it `projectNode` refuses the node instead of
 * walking any further.
 */
const MAX_PROJECTION_DEPTH = 32

/** Record one normalization as a single line, so the caller can report a downgrade instead of hiding it. */
function note(projector: Projector, path: string, message: string): void {
  projector.notes.push(`${path}: ${message}`)
}

/** Record one refusal and answer `undefined` — the projector's "no faithful projection" value. */
function fail(projector: Projector, path: string, message: string): undefined {
  projector.unprojectable.push(`${path}: ${message}`)
  return undefined
}

/**
 * The one projection rule set. Never throws and never mutates its input.
 *
 * A node is projected by (a) keeping every supported keyword, (b) dropping a
 * foreign keyword with a recorded note, (c) normalizing the shapes the harness
 * cannot express into shapes it can (type arrays -> `oneOf`, missing `type`
 * inferred from `properties`/`items`/`enum`), and (d) declaring the node
 * UNPROJECTABLE when no faithful normalization exists.
 */
function projectNode(projector: Projector, node: unknown, path: string): Projected {
  if (projector.depth > MAX_PROJECTION_DEPTH) return fail(projector, path, "nesting is too deep to project")
  if (node === true) {
    note(projector, path, "boolean schema `true` projected to the unconstrained schema `{}`")
    return {}
  }
  if (node === false) return fail(projector, path, "boolean schema `false` has no projection (nothing validates against it)")
  if (!isPlainRecord(node)) return fail(projector, path, "a schema must be an object")

  // Keywords kept for THIS node: annotations are filled in first, constraints after.
  const projected: Record<string, unknown> = {}
  // Single write point for `projected`, so a later stage can tell what an earlier one produced.
  const push = (key: string, value: unknown): void => {
    projected[key] = value
  }

  // Annotations first (they are legal on every node and cheap to check).
  if (Object.hasOwn(node, "description")) {
    if (typeof node.description === "string") push("description", node.description)
    else note(projector, path, "dropped `description`: it is not a string")
  }
  if (Object.hasOwn(node, "title")) {
    if (typeof node.title === "string") push("title", node.title)
    else note(projector, path, "dropped `title`: it is not a string")
  }
  for (const key of ["default", "examples"]) {
    if (!Object.hasOwn(node, key)) continue
    if (isLosslessJson(node[key], new Set())) push(key, node[key])
    else note(projector, path, `dropped \`${key}\`: it is not lossless JSON data`)
  }

  // Foreign keywords are dropped loudly (never silently — the repository has
  // measured schemastery silently keeping a renamed key).
  for (const key of Object.keys(node)) {
    if (SCHEMA_CONSTRAINT_KEYWORDS.includes(key) || SCHEMA_ANNOTATION_KEYWORDS.includes(key)) continue
    note(projector, path, `dropped unsupported keyword \`${key}\``)
  }

  // Presence, not value: `oneOf` blocks the single-type path below even when written as undefined.
  const hasOneOf = Object.hasOwn(node, "oneOf")
  // The type this node ends up declaring — written verbatim, moved off a `oneOf`, or inferred.
  let declaredType: string | undefined
  if (Object.hasOwn(node, "type")) {
    // Untrusted `type` value: a string, a type array, or something outside the subset entirely.
    const type = node.type
    if (Array.isArray(type)) {
      // Subset-legal members of that array; a length mismatch below means one entry is foreign.
      const entries = type.filter((entry): entry is string => typeof entry === "string" && SCHEMA_TYPES.includes(entry))
      if (entries.length !== type.length) return fail(projector, path, "a type array contains an entry outside the subset")
      if (entries.length === 1) {
        declaredType = entries[0]
        note(projector, path, `type array [${entries.join(", ")}] projected to the single type "${declaredType}"`)
      } else if (entries.length === 2 && entries.includes("null")) {
        // The accepted nullable spelling: oneOf:[<rest as the non-null type>, {type:"null"}].
        const [nonNull] = entries.filter((entry) => entry !== "null")
        if (nonNull === undefined) return fail(projector, path, "a type array of only `null` has no projection")
        // Branch payload: the same node with the array type replaced by its one non-null member.
        const rest: Record<string, unknown> = { ...node, type: nonNull }
        delete rest.oneOf
        // Recursive projection of that branch, under a path naming the member it came from.
        const branch = projectNode(projector, rest, `${path}<${nonNull}>`)
        if (branch === undefined) return undefined
        note(projector, path, `type array [${entries.join(", ")}] projected to oneOf with a null branch`)
        return { ...projected, oneOf: [branch, { type: "null" }] }
      } else {
        return fail(projector, path, `type array [${entries.join(", ")}] cannot be projected onto a single type`)
      }
    } else if (typeof type === "string" && SCHEMA_TYPES.includes(type)) {
      declaredType = type
    } else {
      note(projector, path, `dropped \`type\`: ${JSON.stringify(type)} is outside the subset`)
    }
  }

  if (hasOneOf) {
    // Untrusted `oneOf` value; every branch is projected and ANY refusal refuses the whole node.
    const oneOf = node.oneOf
    if (!Array.isArray(oneOf) || oneOf.length === 0) return fail(projector, path, "`oneOf` must be a non-empty array")
    projector.depth += 1
    // One projection per branch, in declared order; an unprojectable branch stays `undefined`.
    const branches = oneOf.map((branch, index) => projectNode(projector, branch, `${path}.oneOf[${index}]`))
    projector.depth -= 1
    if (branches.some((branch) => branch === undefined)) return undefined
    // Constraint keywords declared BESIDE `oneOf`: the harness forbids them there, so they must move inside.
    const siblings: Record<string, unknown> = {}
    for (const key of ONE_OF_SIBLING_KEYWORDS) if (Object.hasOwn(node, key)) siblings[key] = node[key]
    // Branch list after the sibling surgery; the cast is sound because the `undefined` check above returned.
    let finalBranches = branches as Record<string, unknown>[]
    if (Object.keys(siblings).length > 0) {
      // Siblings merged into EVERY branch — the only rewrite that preserves their meaning; each is re-validated.
      const nested = finalBranches.map((branch, index) => {
        if (Object.hasOwn(branch, "oneOf")) {
          fail(projector, path, `oneOf branch ${index} itself declares oneOf and has a sibling constraint to merge`)
          return undefined
        }
        // One branch carrying the siblings; re-validated below because the merge can produce an illegal node.
        const merged: Record<string, unknown> = { ...branch, ...siblings }
        // Re-validation of the merged branch; its first violation is quoted in the refusal note.
        const violations = schemaViolations(merged)
        if (violations.length > 0) {
          fail(projector, path, `oneOf sibling constraints cannot be nested into branch ${index} (${violations[0]})`)
          return undefined
        }
        return merged
      })
      if (nested.some((branch) => branch === undefined)) return undefined
      finalBranches = nested as Record<string, unknown>[]
      note(projector, path, `sibling constraint keyword(s) ${Object.keys(siblings).join("/")} nested into every oneOf branch`)
    }
    if (finalBranches.length === 1) {
      note(projector, path, "single-branch `oneOf` collapsed into that branch")
      return { ...projected, ...finalBranches[0] }
    }
    if (declaredType !== undefined) {
      // type + oneOf is rejected by the harness; the type belongs on every branch.
      finalBranches = finalBranches.map((branch) => (Object.hasOwn(branch, "type") ? branch : { ...branch, type: declaredType }))
      note(projector, path, `type "${declaredType}" moved onto every oneOf branch (type and oneOf cannot be siblings)`)
    }
    return { ...projected, oneOf: finalBranches }
  }

  if (declaredType === undefined) {
    // No type and no oneOf: infer the only shape the declared children describe.
    if (Object.hasOwn(node, "properties") || Object.hasOwn(node, "additionalProperties")) declaredType = "object"
    else if (Object.hasOwn(node, "items")) declaredType = "array"
    else if (Object.hasOwn(node, "enum") && Array.isArray(node.enum) && node.enum.length > 0) {
      // A scalar type EVERY `enum` member matches: the harness needs one type, not a union.
      const candidate = SCALAR_TYPES.find((scalar) => (node.enum as unknown[]).every((entry) => scalarMatches(scalar, entry)))
      if (candidate !== undefined) declaredType = candidate
    } else if (Object.hasOwn(node, "const")) {
      declaredType = SCALAR_TYPES.find((scalar) => scalarMatches(scalar, node.const))
    } else if (Object.hasOwn(node, "required")) {
      // `required` is only meaningful on an object; without `properties` the
      // projection would have to invent entries, so refuse rather than guess.
      return fail(projector, path, "`required` without `properties` cannot be projected")
    }
    if (declaredType !== undefined) note(projector, path, `inferred type "${declaredType}" from the declared children`)
  }

  if (declaredType === undefined) {
    // Annotation-only (or empty) schema: the standard unconstrained-JSON form.
    const foreign = Object.keys(node).filter(
      (key) => !SCHEMA_CONSTRAINT_KEYWORDS.includes(key) && !SCHEMA_ANNOTATION_KEYWORDS.includes(key),
    )
    if (foreign.length > 0 || Object.keys(projected).length === 0) return {}
    return projected
  }

  push("type", declaredType)

  if (declaredType === "object") {
    if (Object.hasOwn(node, "properties")) {
      // Untrusted `properties` map; entries whose own projection is refused are dropped by name.
      const properties = node.properties
      if (!isPlainRecord(properties)) return fail(projector, path, "`properties` must be an object of schemas")
      projector.depth += 1
      // Projected properties in declaration order; an entry is omitted when its own projection failed.
      const kept: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(properties)) {
        // Projection of one property schema; a refusal costs that property, never the whole object.
        const branch = projectNode(projector, child, `${path}.properties.${key}`)
        if (branch === undefined) {
          projector.notes.push(`${path}.properties.${key}: property dropped (no projection)`)
          continue
        }
        kept[key] = branch
      }
      projector.depth -= 1
      push("properties", kept)
    }
    if (Object.hasOwn(node, "required")) {
      // Untrusted `required` value; names whose property was dropped must go, or the schema is invalid.
      const required = node.required
      if (!Array.isArray(required) || required.some((entry) => typeof entry !== "string")) {
        note(projector, path, "dropped `required`: it is not an array of strings")
      } else {
        // Only the properties that SURVIVED projection — the sole names `required` may still list.
        const declared = isPlainRecord(projected.properties) ? (projected.properties as Record<string, unknown>) : {}
        // Required names still backed by a projected property; the rest are dropped with a note.
        const kept = (required as string[]).filter((name) => Object.hasOwn(declared, name))
        if (kept.length !== (required as string[]).length) {
          note(projector, path, `dropped required entr(ies) not present in the projected properties: ${(required as string[])
            .filter((name) => !kept.includes(name)).join(", ")}`)
        }
        if (kept.length > 0) push("required", kept)
      }
    }
    if (Object.hasOwn(node, "additionalProperties")) {
      // Untrusted `additionalProperties` value: the subset takes a boolean and nothing else.
      const value = node.additionalProperties
      if (typeof value === "boolean") push("additionalProperties", value)
      else {
        push("additionalProperties", true)
        note(projector, path, "additionalProperties schema projected to `true` (only a boolean is supported)")
      }
    }
  } else if (declaredType === "array") {
    if (Object.hasOwn(node, "items")) {
      projector.depth += 1
      // Projection of the element schema; an unprojectable `items` refuses the whole array node.
      const items = projectNode(projector, node.items, `${path}.items`)
      projector.depth -= 1
      if (items === undefined) return fail(projector, path, "`items` cannot be projected")
      push("items", items)
    }
  } else {
    if (Object.hasOwn(node, "enum")) {
      // Untrusted `enum` value: it must be non-empty, and every member must match the declared type.
      const allowed = node.enum
      if (Array.isArray(allowed) && allowed.length > 0 && allowed.every((entry) => scalarMatches(declaredType as string, entry))) {
        push("enum", allowed)
      } else {
        note(projector, path, `dropped \`enum\`: it is not a non-empty array of ${declaredType} values`)
      }
    }
    if (Object.hasOwn(node, "const")) {
      if (scalarMatches(declaredType, node.const) && (!Array.isArray(projected.enum) || (projected.enum as unknown[]).includes(node.const))) {
        push("const", node.const)
      } else {
        note(projector, path, `dropped \`const\`: it is not a ${declaredType} value inside \`enum\``)
      }
    }
  }

  for (const key of ["items", "properties", "required", "additionalProperties", "enum", "const"]) {
    if (Object.hasOwn(node, key) && !Object.hasOwn(projected, key) && !projector.notes.some((line) => line.startsWith(`${path}: dropped \`${key}\``))) {
      // A keyword that did not survive is reported, UNLESS it was already dropped by name above.
      const legal =
        (key === "items" && declaredType === "array") ||
        ((key === "properties" || key === "required" || key === "additionalProperties") && declaredType === "object") ||
        ((key === "enum" || key === "const") && SCALAR_TYPES.includes(declaredType))
      if (!legal) note(projector, path, `dropped \`${key}\`: it is not supported on type "${declaredType}"`)
    }
  }

  return projected
}

/**
 * Normalize a projected schema onto an OBJECT root.
 *
 * Every harness tool is called with an ARGUMENTS OBJECT (`execute(args, exec)`,
 * and the adapter's own default is an object-rooted `parameters`), so a foreign
 * `inputSchema` whose root is not `type: "object"` cannot be used verbatim: the
 * caller has no object to put it in.
 *
 * The defect CLASS this repairs is the one a model provider rejects outright on a tool's
 * model-facing `parameters` schema — `Invalid schema for function '<name>': schema must be
 * a JSON Schema of 'type: "object"', got 'type: null'` (measured and guarded in
 * `packages/mpd-qa-roles-probe/src/index.ts`). Local nuance, recorded in this file's own
 * header: THIS harness release forwards a foreign `inputSchema` without validating it, so
 * normalizing the root is defense-in-depth here, not the repair of a live abort.
 * Two sub-cases:
 *   · the root already IS an object schema — returned byte-identical, `wrapped:false`
 *     (this is the only shape a well-formed MCP server advertises: `arguments` is an
 *     object in the wire protocol);
 *   · any other projected root is wrapped in one object carrying the payload under a
 *     single `value` property, so the tool stays callable and its `value` keeps the
 *     server's own type/annotation keywords. `wrapped:true` is returned so the caller
 *     records the downgrade instead of hiding it.
 *
 * A root that cannot be wrapped at all (not an object at all, e.g. a boolean schema)
 * is refused with a reason.
 */
export function objectRootedSchema(value: unknown): { ok: boolean; wrapped: boolean; rootType: string; schema: Record<string, unknown>; reason?: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, wrapped: false, rootType: typeof value, schema: {}, reason: "the schema is not an object" }
  }
  // The cast is sound because the guard above already refused every non-object and every array.
  const schema = value as Record<string, unknown>
  // The root's declared `type`, still foreign data; a non-string is reported as `unspecified`.
  const declared = schema.type
  // Root type handed back to the caller; `unspecified` keeps the note honest for a keyword-less root.
  const rootType = typeof declared === "string" ? declared : "unspecified"
  if (declared === "object" || (declared === undefined && (Object.hasOwn(schema, "properties") || Object.hasOwn(schema, "required") || Object.hasOwn(schema, "additionalProperties") || schema.oneOf === undefined))) {
    // An object root, or a keyword-less root (`{}`), which the harness reads as an
    // unconstrained object — nothing to normalize.
    return { ok: true, wrapped: false, rootType, schema }
  }
  // The author's own annotations stay on the wrapped schema (inside `value`): the
  // wrapper describes the ARGUMENTS OBJECT, which is a different thing from what the
  // server declared, so copying a description onto it would state the wrong subject.
  return {
    ok: true,
    wrapped: true,
    rootType,
    schema: {
      type: "object",
      properties: { value: schema },
      required: ["value"],
      additionalProperties: false,
    },
  }
}

/**
 * Project one foreign schema onto the harness subset.
 *
 * `schema` is returned only when the projection produces a schema the harness
 * validator accepts; `lossy` reports whether anything had to be normalized (the
 * keep-or-drop policy for `output.schema` keys on exactly this flag).
 */
export function projectSchema(value: unknown): SchemaProjection {
  // Fresh accumulator for THIS projection; it is never shared between calls.
  const projector: Projector = { notes: [], unprojectable: [], depth: 0 }
  // The projected root, or `undefined` when the projector refused a node on the way down.
  const schema = projectNode(projector, value, "schema")
  if (schema === undefined) {
    return { violations: projector.unprojectable, lossy: true, notes: projector.notes }
  }
  // Independent re-validation: the projected output must pass the very validator it mirrors.
  const violations = schemaViolations(schema)
  if (violations.length > 0) {
    return { violations, lossy: true, notes: projector.notes }
  }
  return { schema, violations: [], lossy: !schemaEqual(value, schema), notes: projector.notes }
}
