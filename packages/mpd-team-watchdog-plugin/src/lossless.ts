// The lossless-JSON projection for a TOOL result value.
//
// WHY IT EXISTS (measured 2026-10-02, defect 2). The harness snapshots every tool body's value with
// its lossless-JSON rule BEFORE it validates the declared output schema
// (`snapshotToolValue` in `@deepseek-ai/dsh-tools`), and the rule is stricter than "JSON.stringify
// does not throw": it refuses `undefined`, functions, symbols, bigints, `Map`, `Set`, class
// instances and other foreign prototypes, `NaN`/`Infinity`, negative zero, NON-ENUMERABLE or SYMBOL
// own keys, and an object graph with a cycle. When a value fails that snapshot the harness throws
// `tool "…" returned invalid output: value is not lossless JSON` — the tool call produces NOTHING,
// not a degraded answer.
//
// The watchdog's `session-watchdog-status` view is assembled from the whole store: the durable holds,
// the heartbeat stamp tails, the incident log, the per-reader watermarks, the predicate's per-session
// state map and the per-knob readings. Any ONE of those readers answering with a Map, an `undefined`
// or an exotic object takes the entire diagnostics surface down, and the reader that did it is not
// named anywhere in the failure. So the view is PROJECTED at the tool boundary: one function that
// cannot be forgotten by a future reader, and that keeps every human-readable field.

/** A value JSON can carry without loss: the projection's own output type. */
export type LosslessJson = null | boolean | number | string | LosslessJson[] | { [key: string]: LosslessJson }

/**
 * Project one value onto lossless JSON.
 *
 * The rules mirror `JSON.stringify`'s own output, with the two container kinds JSON has no syntax
 * for made explicit, and the values JSON cannot represent mapped to the closest honest shape:
 * `undefined`/functions/symbols become `null` (a dropped property keeps them out entirely),
 * non-finite numbers and negative zero become `null`/`0` exactly as `JSON.stringify` writes them,
 * a bigint becomes its decimal string (JSON would throw), a `Map` becomes a plain record keyed by
 * `String(key)`, a `Set` becomes an array, a `Date` becomes its ISO string, and any other object is
 * rebuilt as a plain record from its OWN ENUMERABLE STRING keys, so a foreign prototype, a symbol
 * key or a getter cannot travel into the result. A cycle projects to `null` at the repeated node
 * instead of throwing, because a diagnostics call must answer.
 *
 * @param value - any value a reader handed the status view.
 * @param seen - the ancestor set of the current path, used only to break cycles.
 * @returns the same data as lossless JSON.
 */
export function losslessJson(value: unknown, seen: ReadonlySet<object> = new Set<object>()): LosslessJson {
  if (value === null) return null
  switch (typeof value) {
    case "boolean":
    case "string":
      return value
    case "number":
      // `JSON.stringify` writes NaN and ±Infinity as null, and -0 as 0; both are the lossless form.
      if (!Number.isFinite(value)) return null
      return Object.is(value, -0) ? 0 : value
    case "bigint":
      // JSON has no bigint literal and `JSON.stringify` THROWS on one; the decimal string keeps it visible.
      return value.toString()
    case "undefined":
    case "function":
    case "symbol":
      // No JSON spelling; a property carrying one is dropped by its container, a root becomes null.
      return null
    default:
      break
  }
  // From here `value` is a non-null object: an array, a Map, a Set, a Date or a record.
  const node = value as object
  if (seen.has(node)) return null
  if (node instanceof Map) {
    // A Map's only JSON spelling is `{}`; a plain record keeps every entry readable.
    /** The ancestor set for this node's entries, so a Map that contains itself terminates. */
    const next = new Set(seen)
    next.add(node)
    /** The rebuilt record, one property per entry. */
    const out: Record<string, LosslessJson> = {}
    for (const [key, entry] of node.entries()) out[String(key)] = losslessJson(entry, next)
    return out
  }
  if (node instanceof Set) {
    // A Set projects onto an array, in insertion order.
    /** The ancestor set for this node's values, so a Set that contains itself terminates. */
    const next = new Set(seen)
    next.add(node)
    return [...node.values()].map((entry) => losslessJson(entry, next))
  }
  if (node instanceof Date) {
    // `JSON.stringify` writes a Date through `toJSON`, i.e. as its ISO string; an invalid Date throws there.
    return Number.isNaN(node.getTime()) ? null : node.toISOString()
  }
  /** The ancestor set for this node's children, so a cycle projects to null instead of recursing. */
  const next = new Set(seen)
  next.add(node)
  if (Array.isArray(node)) {
    // One entry per index (holes become null, as `JSON.stringify` writes them); extra own keys are dropped.
    const out: LosslessJson[] = []
    for (let index = 0; index < node.length; index += 1) out.push(losslessJson((node as unknown[])[index], next))
    return out
  }
  /** The rebuilt record: a plain prototype, string keys, projected values. */
  const out: Record<string, LosslessJson> = {}
  for (const key of Object.keys(node)) {
    // A getter that throws must not take the whole diagnostics call down with it.
    let raw: unknown
    try {
      raw = (node as Record<string, unknown>)[key]
    } catch {
      raw = null
    }
    // A property whose value has no JSON spelling is DROPPED, exactly as `JSON.stringify` drops it.
    if (raw === undefined || typeof raw === "function" || typeof raw === "symbol") continue
    out[key] = losslessJson(raw, next)
  }
  return out
}
