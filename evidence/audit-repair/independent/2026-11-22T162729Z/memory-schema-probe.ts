import { strict as assert } from "node:assert"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { closeSync, existsSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

/** Existing fixture modules, loaded from the exact candidate checkout. */
const candidate = resolve(process.argv[2] ?? process.cwd())
const scripts = join(candidate, "skills", "dsh-qa", "scripts")
const qa = await import(pathToFileURL(join(scripts, "extension-isolation.ts")).href)
const events = await import(pathToFileURL(join(scripts, "lib", "session-evidence.ts")).href)
const launcher = await import(pathToFileURL(join(scripts, "lib", "dsh-launcher.ts")).href)
const fixture = qa.createSandbox("independent-memory-schema")
const sandboxTarget = realpathSync(fixture.sandbox)
assert.equal(dirname(sandboxTarget), realpathSync(tmpdir()))
assert.match(basename(sandboxTarget), /^mpd-independent-memory-schema-/)
const sandbox = {
  ...fixture,
  env: {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    HOME: fixture.runHome,
    DSH_HOME: fixture.dshHome,
    GIT_CONFIG_NOSYSTEM: "1",
    DEEPSEEK_API_KEY: fixture.env.DEEPSEEK_API_KEY,
  },
}
const reflection = { title: "qa reflection", content: "isolated reflection contents" }
const overlay = join(sandbox.sandbox, "memory-config.yml")
const store = join(sandbox.ws, ".mpd", "memory", "agents", "independent-qa")
const gitRepo = join(store, "repo")
const dist = join(candidate, "packages", "mpd-memory-plugin", "dist", "index.js")
const distSha = createHash("sha256").update(readFileSync(dist)).digest("hex")

/** A public tool invocation scripted through the loopback model endpoint. */
interface Step {
  readonly tool: string
  readonly args: Readonly<Record<string, unknown>>
}

/** Spawn one real headless process with file-backed stdout and decode its recorded tool outcomes. */
async function drive(label: string, steps: readonly Step[]): Promise<Readonly<Record<string, string>>> {
  const stub = qa.makeStubModel({ label, script: [...steps, { text: "QA done" }] })
  const logs = join(sandbox.sandbox, `dsh-${label}.log`)
  writeFileSync(join(sandbox.dshHome, "cordis.patch.yml"), profilePatch)
  await stub.listen().then((port: number) => qa.useStubRoute(sandbox.dshHome, port))
  try {
    const spec = launcher.dshAppSpec(["--profile", "mpd-headless", "--patch", overlay, `Run isolated memory QA ${label}`], sandbox.env)
    assert.ok(spec, "pinned DSH launcher is required")
    const output = openSync(logs, "w", 0o600)
    let status: number | null
    try {
      status = await new Promise<number | null>((accept, reject) => {
        const child = spawn(spec.command, spec.args, {
          cwd: sandbox.ws, env: sandbox.env, stdio: ["ignore", output, output], timeout: 12_000,
        })
        child.once("error", reject)
        child.once("close", accept)
      })
    } finally {
      closeSync(output)
    }
    assert.equal(status, 0, `DSH ${label} exit failed; see disposable ${logs}`)
    const result = qa.isolationStep(sandbox.dshHome, sandbox.sandbox, label)
    assert.equal(result.ok, true, `${label}: session workspace isolation failed`)
    const recorded = events.readSessionEvents(sandbox.dshHome, { workspace: sandbox.ws })
    const presentations: Record<string, string> = {}
    for (const step of steps) {
      const call = events.findToolCall(recorded.records, step.tool)
      assert.ok(call.called && call.succeeded, `${label}: ${step.tool}: ${call.reason}`)
      presentations[step.tool] = call.resultText
    }
    console.log(`${label}: dsh exit=0, sessions isolated, ${steps.length} tool calls paired with accepted results`)
    return presentations
  } finally {
    await stub.close()
  }
}

/** Read the real Git history without falling back to the producer's return value. */
function gitOutput(args: string[]): string {
  const result = spawnSync("git", args, { cwd: gitRepo, env: sandbox.env, encoding: "utf8", timeout: 5_000 })
  assert.equal(result.status, 0)
  return result.stdout.trim()
}

let passed = false
let profilePatch = ""
try {
  const install = await qa.installProfile({ ...sandbox, timeoutMs: 15_000 })
  assert.equal(install.status, 0, "isolated install-profile failed: " + install.out.slice(-900))
  profilePatch = readFileSync(join(sandbox.dshHome, "cordis.patch.yml"), "utf8")
  writeFileSync(overlay, "- id: mpd-memory\n  config:\n    agentSlug: independent-qa\n    reflectionEvery: 1\n    vcs: git\n")
  console.log(`mpd-memory dist sha256=${distSha}`)
  const seed = await drive("seed", [
    { tool: "mpd_memory_write", args: { title: "seed", content: "isolated seed contents" } },
    { tool: "mpd_memory_reflect", args: {} },
  ])
  assert.match(seed.mpd_memory_write, /committed=git/)
  assert.match(seed.mpd_memory_reflect, /REFLECTION DUE/)
  assert.equal(gitOutput(["rev-list", "--count", "HEAD"]), "1")

  const lock = join(gitRepo, ".git", "index.lock")
  writeFileSync(lock, "isolated QA lock", { flag: "wx" })
  const failure = await drive("backend-failure", [
    { tool: "mpd_memory_write", args: { title: "held", content: "preserved during failure" } },
    { tool: "mpd_memory_reflect_complete", args: reflection },
    { tool: "mpd_memory_reflect", args: {} },
  ])
  assert.match(failure.mpd_memory_write, /committed=none[\s\S]*git add failed/)
  assert.match(failure.mpd_memory_reflect_complete, /reflection completed: no[\s\S]*committed=none[\s\S]*git add failed/)
  assert.match(failure.mpd_memory_reflect, /REFLECTION DUE/)
  assert.equal(gitOutput(["rev-list", "--count", "HEAD"]), "1")
  const memory = join(gitRepo, "memory")
  const entries = readdirSync(memory)
  const held = entries.find((name) => name.startsWith("held-"))
  const entry = entries.find((name) => name.startsWith("reflection-"))
  assert.ok(held && readFileSync(join(memory, held), "utf8").includes("preserved during failure"))
  assert.ok(entry && readFileSync(join(memory, entry), "utf8").includes(reflection.content))

  renameSync(lock, join(sandbox.sandbox, "released-index.lock"))
  const success = await drive("backend-retry", [
    { tool: "mpd_memory_reflect_complete", args: reflection },
    { tool: "mpd_memory_reflect", args: {} },
    { tool: "mpd_memory_read", args: { query: "isolated reflection contents" } },
  ])
  assert.match(success.mpd_memory_reflect_complete, /reflection completed: yes[\s\S]*committed=git/)
  assert.doesNotMatch(success.mpd_memory_reflect, /REFLECTION DUE/)
  assert.match(success.mpd_memory_read, /isolated reflection contents/)
  assert.deepEqual(readdirSync(memory).filter((name) => name.startsWith("reflection-")), [entry])
  assert.equal(gitOutput(["rev-list", "--count", "HEAD", "--", `memory/${entry}`]), "1")
  assert.match(gitOutput(["show", `HEAD:memory/${entry}`]), /isolated reflection contents/)
  const journal = readFileSync(join(store, "runtime", "journal.jsonl"), "utf8")
  assert.equal(journal.split("\n").filter((line) => line.includes('"kind":"reflection"') && line.includes(basename(entry))).length, 1)
  console.log("PASS: backend refusal retained both plaintext entries; retry produced one original reflection, one Git commit and one journal record")
  assert.equal(createHash("sha256").update(readFileSync(dist)).digest("hex"), distSha)
  passed = true
} finally {
  if (passed && existsSync(sandbox.sandbox)) qa.cleanup(sandbox.sandbox)
  else console.error(`Disposable failed probe artifacts: ${sandbox.sandbox}`)
}
