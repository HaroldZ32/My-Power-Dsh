import { createRequire } from "node:module"
import { existsSync, realpathSync } from "node:fs"
const shim = process.argv[2]
console.log("exists:", existsSync(shim))
console.log("realpath:", realpathSync(shim))
const req = createRequire(shim)
try { console.log("resolve-ok:", req.resolve("@colbymchenry/codegraph-linux-x64/bin/codegraph")) }
catch (e) { console.log("resolve-fail:", e.code) }
const reqReal = createRequire(realpathSync(shim))
try { console.log("resolve-realpath-ok:", reqReal.resolve("@colbymchenry/codegraph-linux-x64/bin/codegraph")) }
catch (e) { console.log("resolve-realpath-fail:", e.code) }
