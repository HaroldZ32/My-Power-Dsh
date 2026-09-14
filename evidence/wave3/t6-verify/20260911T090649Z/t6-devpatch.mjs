#!/usr/bin/env node
// t6 (Reviewer) harness: emit the dev-flavor bundle patch from a QA script
// revision's OWN devPatch() source. Usage:
//   node t6-devpatch.mjs <path-to-preset-register.mjs> > bundle.dev.patch.yml
// The function body is extracted verbatim from the file (fixed worktree copy or
// a `git show HEAD:` copy) and executed with the module environment it expects
// (readFileSync/join/repoRoot/PRESETS_DIR/JSON) — so the verifier boots what the
// script itself would write, not a re-implementation.
import { readFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = "/root/dshProj/my-power-dsh"
const scriptPath = process.argv[2]
if (!scriptPath) { console.error("usage: t6-devpatch.mjs <preset-register.mjs>"); process.exit(2) }
const PRESETS_DIR = join(repoRoot, "presets")
const src = readFileSync(scriptPath, "utf8")
const packedExpr = src.match(/^const PACKED_PRESETS_EXPR = [^\n]*$/m)
const baseUrlExpr = src.match(/^const BASEURL_PREFIX = [^\n]*$/m)
const fnBody = src.match(/^function devPatch\(\) \{[\s\S]*?^\}$/m)
if (!packedExpr || !fnBody) { console.error("[t6-devpatch] devPatch block not found in " + scriptPath); process.exit(2) }
const block = [packedExpr[0], baseUrlExpr ? baseUrlExpr[0] : null, fnBody[0]].filter(Boolean).join("\n")
const factory = new Function("readFileSync", "join", "repoRoot", "PRESETS_DIR", "JSON", block + "\nreturn devPatch()")
const patched = factory(readFileSync, join, repoRoot, PRESETS_DIR, JSON)
process.stderr.write("[t6-devpatch] extracted " + block.split("\n").length + " lines (BASEURL_PREFIX " + (baseUrlExpr ? "present" : "ABSENT") + ") from " + scriptPath + "\n")
process.stdout.write(patched)
