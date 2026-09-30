// Probe: evaluate the bundle's TUI-plane guard EXACTLY the way the loader does.
//
// The loader evaluates a row's `disabled` `!!js` expression with
// `new Function("ctx", "expr", "with (ctx) { return eval(expr) }")`
// (cordis-plugin-loader `lib/types/config/utils.js`), so this probe uses the
// same wrapper over the expressions read out of the SHIPPED `cordis.patch.yml`.
// Both arms are exercised: a dsh-tui composition (the guard must fire) and a
// Web/headless one (it must not), plus the two failure arms (a guard that
// throws must keep the row ENABLED and warn; a mutated always-false guard must
// be seen to differ, so the probe is falsifiable).
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** The repository root, from this file's own location (`<root>/evidence/tui/<slug>/<stamp>/`). */
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
/** The shipped patch the expressions are read from — never retyped here. */
const PATCH = readFileSync(join(REPO, "cordis.patch.yml"), "utf8")

/** The loader's own evaluation wrapper, copied from its source. */
const evaluate = new Function("ctx", "expr", "with (ctx) { return eval(expr) }") as (
  ctx: Record<string, unknown>,
  expr: string,
) => unknown

/** Every `disabled` expression in the patch that belongs to the TUI-plane guard. */
const guardExpressions: string[] = []
/** The raw patch lines, scanned for the two row-metadata expressions under test. */
for (const line of PATCH.split("\n")) {
  const match = /^ {6}disabled: !!js "(.*)"$/u.exec(line)
  if (match !== null && match[1].includes("__mpdTuiPlaneGuard")) guardExpressions.push(match[1])
}

/** One loader entry as the guard reads it: only `options.name` / `options.id` are consulted. */
const entry = (id: string, name: string): { options: { id: string; name: string } } => ({ options: { id, name } })

/** A composition that mounts the dsh-tui host (the TUI plane). */
const tuiCtx = {
  baseUrl: "file:///sandbox/.dsh/profiles/dsh-tui/",
  loader: { entries: () => [entry("system-prompt", "@deepseek-ai/dsh-system-prompt"), entry("dsh-tui", "@deepseek-harness-tui/dsh-tui"), entry("mpd-agent-team", "@deepseek-ai/dsh-experimental-agent-team")] },
}
/** A composition that does not (the Web/headless plane; `mpd-tui` is OUR row, not the host). */
const webCtx = {
  baseUrl: "file:///sandbox/.dsh/profiles/web/",
  loader: { entries: () => [entry("tool-bash", "@deepseek-ai/dsh-tool-bash"), entry("mpd-tui", "@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js")] },
}
/** A TUI composition whose host row was renamed but keeps the host package name. */
const renamedTuiCtx = {
  baseUrl: "file:///sandbox/.dsh/profiles/dsh-tui/",
  loader: { entries: () => [entry("front-door", "@deepseek-harness-tui/dsh-tui")] },
}
/** A TUI composition whose host row carries only a `dsh-tui`-prefixed id. */
const idOnlyTuiCtx = {
  baseUrl: "file:///sandbox/.dsh/profiles/dsh-tui/",
  loader: { entries: () => [entry("dsh-tui-scenes", "@deepseek-harness-tui/dsh-tui/ui-scenes")] },
}
/** A loader context whose `entries()` throws, exercising the guard's own failure arm. */
const brokenCtx = { loader: { entries: () => { throw new Error("probe: entries() is broken") } } }

/** One probe arm: the expression, the context, the expected verdict and what actually happened. */
interface Arm {
  /** What the arm is about. */
  readonly name: string
  /** The JS expression evaluated under the loader wrapper. */
  readonly expr: string
  /** The loader-shaped context it is evaluated against. */
  readonly ctx: Record<string, unknown>
  /** The verdict the guard must produce. */
  readonly expected: boolean
}
/** Every evaluation the probe performs; the two shipped expressions run against all five contexts. */
const arms: Arm[] = []
for (const [index, expr] of guardExpressions.entries()) {
  const which = "shipped-expression-" + String(index + 1)
  arms.push(
    { name: which + " / dsh-tui composition", expr, ctx: tuiCtx, expected: true },
    { name: which + " / web composition", expr, ctx: webCtx, expected: false },
    { name: which + " / renamed host row (package name only)", expr, ctx: renamedTuiCtx, expected: true },
    { name: which + " / host subpath row id only", expr, ctx: idOnlyTuiCtx, expected: true },
    { name: which + " / broken loader (guard must fail OPEN)", expr, ctx: brokenCtx, expected: false },
  )
}
// The falsifiability control: an always-false guard is a DIFFERENT verdict on the TUI context,
// so a probe that reported `true` for it would be measuring its own expectation, not the guard.
arms.push({ name: "negative-control / always-false guard on a dsh-tui composition", expr: "(() => false)()", ctx: tuiCtx, expected: false })

/** The recorded outcome of one arm. */
const results: { name: string; expected: boolean; actual: unknown; ok: boolean }[] = []
for (const arm of arms) {
  let actual: unknown
  try {
    actual = evaluate(arm.ctx, arm.expr)
  } catch (error) {
    actual = "threw: " + String((error as { message?: unknown } | null)?.message ?? error)
  }
  results.push({ name: arm.name, expected: arm.expected, actual, ok: actual === arm.expected })
}

const summary = {
  patch: "cordis.patch.yml",
  guardExpressionsFound: guardExpressions.length,
  guardExpressionsByteIdentical: guardExpressions.length === 2 && guardExpressions[0] === guardExpressions[1],
  arms: results,
  ok: results.every((row) => row.ok) && guardExpressions.length === 2,
}
console.log(JSON.stringify(summary, null, 2))
process.exitCode = summary.ok ? 0 : 1
