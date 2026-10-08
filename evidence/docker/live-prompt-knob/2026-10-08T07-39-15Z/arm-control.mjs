// arm-control.mjs — the NEGATIVE CONTROL for the self-test arm this wave added.
//
// The arm "both services interpolate the optional live prompt knob" is only worth its green if it can
// go red. This control runs the SAME two regexes (copied verbatim from scripts/docker-e2e.ts) against
// three inputs: the SHIPPED compose file, the same file with the `:-` interpolation removed, and the
// same file with the knob named on ONE service only. The shipped file must pass, both mutations must
// fail — otherwise the arm is decorative.
import { readFileSync } from "node:fs"

/** The compose file the shipping arm reads. */
const compose = readFileSync("docker/docker-compose.yml", "utf8")
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .map((line) => line.replace(/\s+#.*$/, ""))
  .join("\n")

/** The shipped arm's predicate, on a stripped-comment body. */
const passes = (body) =>
  (body.match(/\$\{MPD_E2E_LIVE_PROMPT:-\}/g) ?? []).length === 2 &&
  (body.match(/^\s*MPD_E2E_LIVE_PROMPT:.*$/gm) ?? []).length === 2

/** The control inputs: shipped, `${…:-}` removed, and the oneclick service's line dropped. */
const cases = [
  ["shipped compose (compose/docker-compose.yml)", compose, true],
  ["interpolation form removed (${MPD_E2E_LIVE_PROMPT})", compose.replaceAll("${MPD_E2E_LIVE_PROMPT:-}", "${MPD_E2E_LIVE_PROMPT}"), false],
  ["named on ONE service only", compose.replace(/^\s*MPD_E2E_LIVE_PROMPT: \$\{MPD_E2E_LIVE_PROMPT:-\}$\n/gm, (m, off) => (off > compose.indexOf("mpd-oneclick") ? "" : m)), false],
]

/** Non-zero when the control itself disagrees with the expectation. */
let bad = 0
for (const [name, body, expected] of cases) {
  const got = passes(body)
  const verdict = got === expected ? "ok  " : "BAD "
  if (got !== expected) bad += 1
  console.log(`[arm-control] ${verdict} ${name} -> passes=${got} expected=${expected}`)
}
console.log(bad === 0 ? "[arm-control] the arm is falsifiable: both mutations turn it red" : `[arm-control] ${bad} control(s) disagreed`)
process.exit(bad === 0 ? 0 : 1)
