import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
const PROFILE = "/root/dshProj/my-power-dsh/.mpd/recon/qa/dshhome/profiles/dsh-tui/package.json"
const SPECIFIER = "@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js"
const require = createRequire(PROFILE)
const resolved = require.resolve(SPECIFIER)
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex")
const result = { specifier: SPECIFIER, resolvedAbsolutePath: resolved, repoDistSha256: sha("packages/mpd-tui-plugin/dist/index.js"), resolvedSha256: sha(resolved) }
result.ok = result.repoDistSha256 === result.resolvedSha256 && resolved.endsWith("my-power-dsh/packages/mpd-tui-plugin/dist/index.js")
process.stdout.write(JSON.stringify(result, null, 2) + "\n")
process.exit(result.ok ? 0 : 1)
