#!/usr/bin/env bun
// Lane S, S-e witness #2 — the `/plugins/mpd-team/state` payload BEFORE and AFTER the change.
//
// WHY THIS EXISTS BESIDE THE BOOT. The boot phase compares the payload from the dist git has committed
// against the payload from the rebuilt dist, which is the strongest form — but it costs two installs and
// two boots. THIS witness is the same comparison at the module boundary and takes a second: the ENTIRE
// `src/` tree as `git show HEAD` has it is copied into the sandbox, so the OLD `registerTeamRoutes` is
// the committed code rather than a re-rendering of it, and both implementations answer the SAME fixture
// workspace through the SAME route double. A payload that differs by one byte fails here.
//
// RUN THIS WITH `bun`, and with `bun` only — MEASURED 2026-10-08: the HEAD copy is the committed code
// byte for byte, so its internal specifiers are the extensionless ones the source tree uses
// (`./team-store`), and node's ESM resolver refuses them (`ERR_MODULE_NOT_FOUND … /src-at-head/team-store`).
// Rewriting those specifiers on unpack would mean testing code that is not the committed code.
//
// REPRODUCIBILITY (repaired after the blind verifier FAILED the lane on a non-reproducing hash): the
// answer ECHOES the workspace it was asked about, and this witness makes that workspace with `mkdtemp`,
// so the RAW bytes carry a fresh `/tmp/mpd-lane-s-parity-XXXXXX` on every run and can never be hashed
// reproducibly. The fix is two things at once: the run's own path is NORMALIZED to the literal
// `<workspace>` before the two bodies are written, and the hashes are EMITTED HERE by this run into
// `state-parity.json` instead of being quoted from an earlier one. Every other byte — the whole team
// projection — is untouched, and the RAW hashes are recorded beside the normalized ones.
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** This driver's evidence directory. */
const OUT = dirname(fileURLToPath(import.meta.url))
/** The repository root, four levels up. */
const REPO = join(OUT, "..", "..", "..", "..")
/** Where the HEAD copies of `src/**` are unpacked; inside the driver's own sandbox. */
const OLD = join(REPO, ".qa-change-feed", OUT.slice(OUT.lastIndexOf("/") + 1), "src-at-head")
/** The one route this witness compares, and the session the fixture is bound to. */
const SESSION = "sess-lane-s"
/** The literal this run's own temp workspace path is replaced with before the bodies are written. */
const WORKSPACE_PLACEHOLDER = "<workspace>"

/** The sha256 of one string, lowercase hex — the hash `sha256sum` prints for the same bytes. */
function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/**
 * Replace every occurrence of this run's temp workspace path with {@link WORKSPACE_PLACEHOLDER}.
 *
 * The `/state` payload names the workspace it answered for, and that name is the ONLY run-varying
 * value in it, so removing it is what makes the body — and therefore its hash — the same on the next
 * run. Nothing else is touched: the replacement is a literal string swap, not a re-serialization.
 * @param body - the exact bytes the route answered.
 * @param workspace - this run's temp workspace path.
 * @returns the normalized body, and how many occurrences were replaced.
 */
function normalize(body: string, workspace: string): { text: string; replacements: number } {
  /** The body split on the run-varying path: the number of parts minus one is the replacement count. */
  const parts = body.split(workspace)
  return { text: parts.join(WORKSPACE_PLACEHOLDER), replacements: parts.length - 1 }
}

/** One mounted route, and the response double that captured its answer. */
interface Mount {
  /** Every route path the implementation registered, in registration order. */
  paths: string[]
  /** The handler of `/plugins/mpd-team/state`. */
  state: (req: unknown, res: unknown) => unknown
  /** The body the state route answered with, filled in by {@link drive}. */
  body?: string
}

/**
 * Mount one `registerTeamRoutes` implementation on a route double.
 * @param register - the implementation under test.
 * @param workspace - the workspace every read is attributed to.
 * @returns the captured paths and the state handler.
 */
function mount(register: (server: unknown, deps: unknown) => boolean, workspace: string): Mount {
  /** The capture this call fills in. */
  const capture: Mount = { paths: [], state: () => undefined }
  register({
    register: (route: { path: string; handler: (req: unknown, res: unknown) => unknown }): (() => void) => {
      capture.paths.push(route.path)
      if (route.path.endsWith("/state")) capture.state = route.handler
      return (): void => {}
    },
  }, {
    recordFor: () => undefined,
    workspace: () => workspace,
    executor: () => ({ kind: "native", reason: "native: the default backend" }),
    effect: (fn: () => unknown) => fn(),
    warn: (): void => {},
  })
  return capture
}

/**
 * Ask one mounted implementation for `/state` and keep the raw bytes it answered.
 * @param target - the mounted implementation.
 */
function drive(target: Mount): void {
  /** The exact bytes the handler wrote, captured before any parse. */
  const chunks: string[] = []
  target.state({ url: "/plugins/mpd-team/state?sessionId=" + SESSION }, {
    writeHead: (): void => {},
    end: (text: string): void => { chunks.push(text) },
  })
  target.body = chunks.join("")
}

/** Unpack `src/**` as HEAD has it, so the "before" arm runs the committed code. */
function unpackHead(): void {
  rmSync(OLD, { recursive: true, force: true })
  mkdirSync(OLD, { recursive: true })
  /** The committed file list, read from git (read-only). */
  const listed = spawnSync("git", ["ls-tree", "--name-only", "HEAD", "packages/mpd-team-core-plugin/src/"], { cwd: REPO, encoding: "utf8" })
  /** The paths git reports; nothing is compared when the tree has none. */
  const files = String(listed.stdout ?? "").split("\n").filter((line) => line.endsWith(".ts"))
  if (files.length === 0) throw new Error("git reported no src files at HEAD:\n" + String(listed.stderr ?? ""))
  for (const file of files) {
    /** The file's committed bytes, straight out of the object store. */
    const shown = spawnSync("git", ["show", "HEAD:" + file], { cwd: REPO, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    if (shown.status !== 0) throw new Error("git show failed for " + file + ": " + String(shown.stderr ?? ""))
    writeFileSync(join(OLD, file.slice(file.lastIndexOf("/") + 1)), String(shown.stdout ?? ""))
  }
}

/** Build the frozen fixture the two implementations both read, through the CURRENT store. */
async function fixture(): Promise<string> {
  /** A fresh temp workspace, so the witness disturbs nothing else. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-lane-s-parity-"))
  /** The current store, used only to WRITE the fixture the two readers share. */
  const store = await import(join(REPO, "packages", "mpd-team-core-plugin", "src", "team-store.ts"))
  /** The frozen instant, so the record's own stamps are identical run to run. */
  const NOW = new Date("2026-10-08T07:00:00.000Z")
  /** A team with one member and one completed task, approved so the phase is the live one. */
  let team = store.createTeam(workspace, { name: "lane-s", description: "publish changes", leadSessionId: SESSION }, NOW)
  team = store.addTeamMember(team, { name: "Senior Engineer", description: "implements", role: "Senior Engineer" }, NOW)
  team = store.addTeamTask(team, { subject: "ship the feed", description: "publish", kind: "requirement", owner: "Senior Engineer" }, NOW)
  team = store.updateTeamTask(team, "T1", { status: "completed", attempt: 1 }, NOW)
  team = { ...team, approvedAt: NOW.toISOString() }
  store.writeTeam(workspace, team)
  store.bindActiveTeam(workspace, SESSION, team.teamId)
  return workspace
}

/** Run the comparison and write the two bodies plus the verdict into the evidence directory. */
async function main(): Promise<void> {
  unpackHead()
  /** The shared fixture workspace. */
  const workspace = await fixture()
  /** The committed implementation's mount. */
  const before = mount((await import(join(OLD, "team-web.ts"))).registerTeamRoutes, workspace)
  /** The working tree's mount. */
  const after = mount((await import(join(REPO, "packages", "mpd-team-core-plugin", "src", "team-web.ts"))).registerTeamRoutes, workspace)
  drive(before)
  drive(after)
  /** The bytes the two implementations really answered, workspace path and all. */
  const rawBefore = String(before.body ?? "")
  const rawAfter = String(after.body ?? "")
  /** The same bytes with this run's temp workspace path normalized away — the reproducible pair. */
  const normalizedBefore = normalize(rawBefore, workspace)
  const normalizedAfter = normalize(rawAfter, workspace)
  writeFileSync(join(OUT, "parity-before-state.json"), normalizedBefore.text)
  writeFileSync(join(OUT, "parity-after-state.json"), normalizedAfter.text)
  /** Whether the two answers are the same bytes — compared RAW, which is the strongest form. */
  const identical = rawBefore === rawAfter && rawBefore.length > 0
  /** Whether they are still the same bytes once the run-varying path is out of both. */
  const identicalNormalized = normalizedBefore.text === normalizedAfter.text && normalizedBefore.text.length > 0
  writeFileSync(join(OUT, "state-parity.json"), JSON.stringify({
    identical,
    identicalNormalized,
    sha256Of: "the body as written to parity-before-state.json / parity-after-state.json: this run's mkdtemp workspace path replaced by the literal " + WORKSPACE_PLACEHOLDER + ", every other byte untouched",
    sha256Before: sha256(normalizedBefore.text),
    sha256After: sha256(normalizedAfter.text),
    rawSha256Of: "the exact bytes the route answered, workspace path included — equal to each other in THIS run and different in the next one",
    rawSha256Before: sha256(rawBefore),
    rawSha256After: sha256(rawAfter),
    rawBytes: rawBefore.length,
    normalizedBytes: normalizedBefore.text.length,
    beforeBytes: rawBefore.length,
    afterBytes: rawAfter.length,
    workspacePathThisRun: workspace,
    workspaceReplacements: { before: normalizedBefore.replacements, after: normalizedAfter.replacements },
    normalizationApplied: normalizedBefore.replacements > 0 && normalizedAfter.replacements > 0,
    beforeRoutes: before.paths,
    afterRoutes: after.paths,
    beforeRouteCount: before.paths.length,
    afterRouteCount: after.paths.length,
    addedRoutes: after.paths.filter((path) => !before.paths.includes(path)),
    ranAt: new Date().toISOString(),
  }, null, 2) + "\n")
  process.stdout.write("state parity: identical=" + String(identical) + " identicalNormalized=" + String(identicalNormalized) + " routes " + String(before.paths.length) + " → " + String(after.paths.length) + "\n")
  // THE HASHES ARE PRINTED BY THE RUN, so the report's values are copied from an artifact this run
  // produced rather than remembered from an earlier one — the defect this file was repaired for.
  process.stdout.write("state parity: sha256 before=" + sha256(normalizedBefore.text) + " after=" + sha256(normalizedAfter.text) + "\n")
  process.stdout.write("state parity: raw sha256 before=" + sha256(rawBefore) + " after=" + sha256(rawAfter) + " (" + String(rawBefore.length) + " B, workspace=" + workspace + ")\n")
  if (normalizedBefore.replacements === 0 || normalizedAfter.replacements === 0) {
    process.stdout.write("state parity: WARNING — the workspace path did not appear in a body, so the recorded sha256 is the raw one\n")
  }
  rmSync(workspace, { recursive: true, force: true })
  if (!identical || !identicalNormalized) process.exit(1)
}

await main()
