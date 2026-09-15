// Prove the bundle patch row's module specifier resolves to the built artifact.
// The profile in the warm sandbox links @mpd-dsh/mpd -> this checkout, so
// createRequire(<profile>/package.json).resolve() exercises the SAME exports map
// the loader uses ("./packages/*": "./packages/*").
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"

const PROFILE = "/root/dshProj/my-power-dsh/.mpd/recon/qa/dshhome/profiles/dsh-tui/package.json"
const SPECIFIER = "@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js"
const expected = "packages/mpd-tui-plugin/dist/index.js"

const require = createRequire(PROFILE)
const resolved = require.resolve(SPECIFIER)
const bytes = readFileSync(resolved)
const expectedBytes = readFileSync(expected)
const sha = createHash("sha256").update(bytes).digest("hex")
const result = {
  profile: PROFILE,
  specifier: SPECIFIER,
  resolvedAbsolutePath: resolved,
  resolvesToRepoPath: resolved.endsWith("/my-power-dsh/" + expected),
  resolvedSha256: sha,
  repoDistSha256: createHash("sha256").update(expectedBytes).digest("hex"),
  identical: sha === createHash("sha256").update(expectedBytes).digest("hex"),
}
result.ok = result.resolvesToRepoPath && result.identical
process.stdout.write(JSON.stringify(result, null, 2) + "\n")
process.exit(result.ok ? 0 : 1)
