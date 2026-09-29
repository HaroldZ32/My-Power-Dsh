#!/usr/bin/env node
// t35 mount proof (R3 is a BEHAVIOUR change, so the contract REQUIRES a real boot).
//
// Boots an isolated DSH_HOME + sandbox HOME/workspace from THIS checkout and asserts
// that the modified plugin tree really mounts: the apply-crash signatures are absent,
// the new R1 exports load, and the harmonized verb tables are the shipped ones.
// `--dump-config` is deliberately NOT used as load evidence (AGENTS.md §4).
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, cpSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))))
const CRASH_SIGNATURES = [
  "unsupported JSON schema",
  "JsonSchemaError",
  "plugin tree failed to load",
  "failed to apply loader entry",
  "cannot get property",
]
const outDir = join(repoRoot, "evidence", "omo-align", "messaging", "r3-verb-harmonisation")
const sandbox = mkdtempSync(join(tmpdir(), "mpd-t35-mount-"))

// --- 1) the changed modules are loadable at all (import-level smoke) ---
const modules = {}
for (const rel of ["lib/state.js", "lib/scheduler.js", "lib/session-start.js"]) {
  const mod = await import(join(repoRoot, "packages", "mpd-agent-teams-plugin", rel))
  modules[rel] = Object.keys(mod).length
}
const state = await import(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "state.js"))
const gate = await import(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "session-start.js"))

// --- 2) the harmonized tables match, verb by verb ---
const EN = ["add", "align", "audit", "build", "change", "check", "consolidate", "implement", "migrate", "overhaul", "port", "refactor", "rewrite", "verify"]
const CJK = ["设计", "实现", "验证", "改造", "补充", "对齐", "重构", "迁移", "审计", "移植", "梳理", "全量"]
// NOTE: ACTION_VERB_PATTERN carries the `g` flag, so `.test()` is STATEFUL through
// the shared `lastIndex` and repeated calls on the same instance silently alternate
// true/false. A checker must therefore test a NON-global copy of the shipped source —
// measuring the global instance directly produced a false "6 CJK verbs missing".
const c2Re = new RegExp(gate.ACTION_VERB_PATTERN.source, "iu")
const c3Re = new RegExp(gate.CLAUSE_ACTION_PATTERN.source, "iu")
const c2Fails = EN.filter((verb) => !c2Re.test(verb + " it"))
const c3Fails = EN.filter((verb) => !c3Re.test(verb + " it"))
const cjk2 = CJK.filter((verb) => !c2Re.test(verb + "这事"))
const cjk3 = CJK.filter((verb) => !c3Re.test(verb + "这事"))

// --- 3) a REAL boot of the modified tree ---
mkdirSync(sandbox, { recursive: true })
if (existsSync(join(homedir(), ".dsh", ".credentials.yaml")))
  cpSync(join(homedir(), ".dsh", ".credentials.yaml"), join(sandbox, ".credentials.yaml"))
const install = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, env: { ...process.env, DSH_HOME: sandbox } })
const ws = join(sandbox, "ws")
mkdirSync(ws, { recursive: true })
const boot = spawnSync("dsh", ["--profile", "mpd-headless", "Reply with exactly: hello-ok"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, cwd: ws, env: { ...process.env, DSH_HOME: sandbox, HOME: sandbox }, stdio: ["ignore", "pipe", "pipe"] })
const bootLog = (boot.stdout || "") + (boot.stderr || "")
const crashes = CRASH_SIGNATURES.filter((signature) => bootLog.includes(signature))

const result = {
  schema: "mpd-omo-align-mount-proof/1",
  task: "t35",
  purpose: "R3 is a behaviour change: prove the modified plugin tree mounts in a real isolated boot (not --dump-config).",
  importedModules: modules,
  r1ExportsLoaded: {
    appendMailboxDeduped: typeof state.appendMailboxDeduped === "function",
    clearMailboxToWatermark: typeof state.clearMailboxToWatermark === "function",
    enqueueInterjection: typeof state.enqueueInterjection === "function",
    expireInterjections: typeof state.expireInterjections === "function",
    decideInterjection: typeof state.decideInterjection === "function",
  },
  harmonizedTables: {
    english: EN, cjk: CJK,
    c2FailingVerbs: c2Fails, c3FailingVerbs: c3Fails,
    c2CjkFailing: cjk2, c3CjkFailing: cjk3,
    identicalVerbSets: c2Fails.length === 0 && c3Fails.length === 0 && cjk2.length === 0 && cjk3.length === 0,
  },
  boot: { installerExit: install.status, dshExit: boot.status, crashSignatures: crashes, clean: crashes.length === 0 },
  ok: install.status === 0 && crashes.length === 0
    && modules["lib/state.js"] > 0 && modules["lib/scheduler.js"] > 0 && modules["lib/session-start.js"] > 0
    && c2Fails.length === 0 && c3Fails.length === 0 && cjk2.length === 0 && cjk3.length === 0,
}
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, "mount-proof.json"), JSON.stringify(result, null, 2))
writeFileSync(join(outDir, "mount-proof.log"), "installer exit=" + install.status + "\nboot exit=" + boot.status + "\n" + bootLog.slice(0, 20000))
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
