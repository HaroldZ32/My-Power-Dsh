// The text of the product's `NO_SESSION_TEAM_MARKER`, read from the product's OWN source declaration so
// this lane cannot drift from the constant the product's `test/session-scope.test.ts` asserts on.
// PROTOCOL: ONE tab-separated line on stdout — the marker text, then the site it was read from. An
// empty first field means the declaration was not found and the lane must record an unmade
// measurement rather than fall back to a retyped string.
import { readFileSync } from "node:fs"
import { join } from "node:path"
const [appDir] = process.argv.slice(2)
const file = join(appDir, "packages", "mpd-tui-plugin", "src", "team-state.ts")
const site = "packages/mpd-tui-plugin/src/team-state.ts#NO_SESSION_TEAM_MARKER"
const text = readFileSync(file, "utf8")
const match = /^export const NO_SESSION_TEAM_MARKER = "([^"]*)"$/m.exec(text)
process.stdout.write([match === null ? "" : match[1], site].join("\t") + "\n")
