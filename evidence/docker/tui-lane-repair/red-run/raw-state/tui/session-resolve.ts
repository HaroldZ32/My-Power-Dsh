// Which session does THIS TUI run as, and bind the lane's team fixture to it.
//
// WHY THIS EXISTS: the product draws the CALLING session's team, and a fixture is not something a
// session approved — so an unbound board is CORRECTLY invisible and the lane must bind it to the id
// the TUI runs as. The key rule is the PRODUCT'S OWN: `sessionKey` is imported from
// `packages/mpd-team-core-plugin/src/team-store.ts` (the module `createTeam` binds through), so no key
// format is invented here.
//
// PROTOCOL: exactly ONE TAB-separated line on stdout per mode — the whole contract with the lane.
//   resolve <appDir> <dshHome> <workspace> <snapshotFile>
//     -> <sessionId> <source> <projectKey> <others> <detail>
//   bind <appDir> <workspace> <sessionId> <teamId> <recordFile>
//     -> <bound> <sessionKey> <detail>
//   index <appDir> <workspace> <sessionId> <teamId>
//     -> <written> <sessionKey> <activeJson>
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

/**
 * Print the ONE protocol line and exit.
 * @param line The tab-separated fields this mode answers with.
 * @returns Never: the process exits here.
 */
function answer(line: string): never {
  process.stdout.write(line + "\n")
  process.exit(0)
}

/**
 * Every `<projectKey>/<sessionId>` pair the store holds right now, sorted.
 * @param dshHome The harness home whose `sessions` store is listed.
 * @returns The pairs; empty when the store does not exist and for every unreadable entry.
 */
function sessionDirs(dshHome: string): string[] {
  /** The `<dshHome>/sessions` root; absent until a boot writes its first store. */
  const root = join(dshHome, "sessions")
  /** The pairs found so far. */
  const found: string[] = []
  if (!existsSync(root)) return found
  for (const key of readdirSync(root)) {
    /** One project key's directory. */
    const keyDir = join(root, key)
    try { if (!statSync(keyDir).isDirectory()) continue } catch { continue }
    for (const id of readdirSync(keyDir)) {
      try { if (statSync(join(keyDir, id)).isDirectory()) found.push(key + "/" + id) } catch { /* raced */ }
    }
  }
  return found.sort()
}

/**
 * The non-empty lines of the lane's pre-boot snapshot.
 * @param file The snapshot file the lane wrote before the boot.
 * @returns The trimmed lines; empty when the file is unreadable.
 */
function snapshotLines(file: string): string[] {
  try {
    return readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter((line) => line !== "")
  } catch { return [] }
}

/**
 * The product's own `sessionKey`, imported from the checkout this container installed.
 * @param appDir The checkout root (`$APP_DIR`, which carries `packages/`).
 * @returns The key function plus the witness naming where that rule came from.
 */
async function productSessionKey(appDir: string): Promise<{ key: (sessionId: string | undefined) => string; source: string }> {
  /** The store module `createTeam` binds through, run from SOURCE (node strips the types). */
  const modulePath: string = join(appDir, "packages", "mpd-team-core-plugin", "src", "team-store.ts")
  try {
    /** The imported namespace, read field by field so a shape change cannot pass as the rule. */
    const mod: Record<string, unknown> = await import(pathToFileURL(modulePath).href) as Record<string, unknown>
    if (typeof mod.sessionKey === "function") {
      /** The product's own function, called through a cast because the import is untyped here. */
      const sessionKey = mod.sessionKey as (sessionId: string | undefined) => unknown
      return { key: (sessionId) => String(sessionKey(sessionId)), source: "import:packages/mpd-team-core-plugin/src/team-store.ts#sessionKey" }
    }
  } catch { /* the literal below is the same rule for every input that can occur here */ }
  // A FALLBACK THAT INVENTS NO RULE: `sessionKey` answers the id ITSELF for every non-empty string and
  // `"workspace"` only for an empty one, and a store directory name is never empty — so the two agree
  // on every input this probe can produce, and the witness says which of them ran.
  return { key: (sessionId) => (typeof sessionId === "string" && sessionId !== "" ? sessionId : "workspace"), source: "literal:non-empty-id-else-workspace (the import was unreachable)" }
}

/**
 * Read one JSON object.
 * @param path The file to read.
 * @returns The parsed object, or `undefined` when the file is absent or is not a plain object.
 */
function readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    /** The parsed value, usable only when it is a plain object. */
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch { return undefined }
}

/**
 * The index file of a workspace, at the path the product's own `teamsIndexPath` names.
 * @param workspace The workspace whose `.mpd/team` tree is written.
 * @returns The absolute path of `teams.json`.
 */
function indexPathOf(workspace: string): string {
  return join(workspace, ".mpd", "team", "teams.json")
}

/**
 * Set one session's binding in the index, preserving every other entry.
 * @param workspace The workspace whose index is edited.
 * @param key The session key (the product's own rule produced it).
 * @param teamId The team id to bind.
 * @returns The `active` map read back from disk after the write.
 */
function writeIndexEntry(workspace: string, key: string, teamId: string): Record<string, string> {
  /** The file this call edits. */
  const indexPath: string = indexPathOf(workspace)
  /** The index as it is, or an empty one when it is absent or its shape is unusable. */
  const index: Record<string, unknown> = readJsonObject(indexPath) ?? { version: 1, active: {} }
  /** The `active` map, replaced when the file's own is unusable. */
  const active: Record<string, string> = (index.active !== null && typeof index.active === "object" && !Array.isArray(index.active))
    ? index.active as Record<string, string> : {}
  active[key] = teamId
  // The product's own writer shape (`writeJson`): two-space JSON with a trailing newline.
  writeFileSync(indexPath, JSON.stringify({ version: 1, active }, null, 2) + "\n")
  /** The map READ BACK from disk, so the answer is a fact rather than this write's intention. */
  const readBack: Record<string, unknown> | undefined = readJsonObject(indexPath)
  return (readBack?.active ?? {}) as Record<string, string>
}

/** The mode the lane asked for, and its arguments. */
const [mode, ...args]: string[] = process.argv.slice(2)

if (mode === "resolve") {
  /** `resolve <appDir> <dshHome> <workspace> <snapshotFile>`. */
  const [appDir, dshHome, workspace, snapshotFile] = args
  /** The pairs present at the pre-boot snapshot: every one of them is SOMEBODY ELSE's session. */
  const before: string[] = snapshotLines(snapshotFile)
  /** The pairs present now. */
  const after: string[] = sessionDirs(dshHome)
  /** The pairs this boot added. */
  const created: string[] = after.filter((pair) => !before.includes(pair))
  /** This workspace's project key, imported so the PATH shape is the harness's own. */
  let projectKey = ""
  try {
    /** The isolation helper that owns the directory-key rule. */
    const iso: Record<string, unknown> = await import(pathToFileURL(join(appDir, "skills", "dsh-qa", "scripts", "lib", "workspace-isolation.ts")).href) as Record<string, unknown>
    if (typeof iso.projectKey === "function") projectKey = String((iso.projectKey as (cwd: string) => unknown)(workspace))
  } catch { /* an empty key only narrows the fallbacks, it never widens the answer */ }
  /** The session ids already present under THIS key, i.e. genuine sibling sessions of this workspace. */
  const others: string[] = projectKey === "" ? [] : before.filter((pair) => pair.startsWith(projectKey + "/")).map((pair) => pair.slice(pair.indexOf("/") + 1))
  /** The created pair under this key, then any created pair: order is the preference. */
  const pick: string | undefined = (projectKey === "" ? undefined : created.filter((pair) => pair.startsWith(projectKey + "/"))[0]) ?? created[0]
  /** The id of the picked pair, or an empty string when this boot created none yet. */
  const sessionId: string = pick === undefined ? "" : pick.slice(pick.indexOf("/") + 1)
  /** How the id was obtained: stated, never assumed. */
  const source: string = pick === undefined ? "none"
    : (projectKey !== "" && pick.startsWith(projectKey + "/") ? "created-during-this-boot-under-this-project-key" : "created-during-this-boot-other-project-key")
  answer([
    sessionId, source, projectKey, others.join(","),
    "store=" + join(dshHome, "sessions") + ";before=" + String(before.length) + ";after=" + String(after.length) + ";created=" + created.join(","),
  ].join("\t"))
}

if (mode === "bind") {
  /** `bind <appDir> <workspace> <sessionId> <teamId> <recordFile>`. */
  const [appDir, workspace, sessionId, teamId, recordFile] = args
  if (sessionId === "" || sessionId === undefined) answer(["false", "", "no-session-id-discovered"].join("\t"))
  /** The product's own key rule. */
  const rule = await productSessionKey(appDir)
  /** The key the product's own rule produces for this session. */
  const key: string = rule.key(sessionId)
  /** The `active` map as it stands on disk after the index write. */
  const active: Record<string, string> = writeIndexEntry(workspace, key, teamId)
  /** The fixture record, rewritten so its OWN `leadSessionId` names this session too. */
  const record: Record<string, unknown> | undefined = readJsonObject(recordFile)
  if (record !== undefined) {
    record.leadSessionId = key
    writeFileSync(recordFile, JSON.stringify(record, null, 2) + "\n")
  }
  /** The record READ BACK, so the answer covers the bytes on disk. */
  const readBack: Record<string, unknown> | undefined = readJsonObject(recordFile)
  /** Both spellings the product's own `createTeam` writes must hold, or the binding is not a binding. */
  const bound: boolean = active[key] === teamId && readBack?.leadSessionId === key
  answer([
    String(bound), key,
    "index=" + indexPathOf(workspace) + ";active=" + JSON.stringify(active) + ";recordLeadSessionId=" + String(readBack?.leadSessionId ?? "(absent)") + ";keySource=" + rule.source,
  ].join("\t"))
}

if (mode === "index") {
  /** `index <appDir> <workspace> <sessionId> <teamId>`: bind a DIFFERENT session's board. */
  const [appDir, workspace, sessionId, teamId] = args
  /** The product's own key rule. */
  const rule = await productSessionKey(appDir)
  /** The key the product's own rule produces for that session. */
  const key: string = rule.key(sessionId)
  /** The `active` map read back from disk. */
  const active: Record<string, string> = writeIndexEntry(workspace, key, teamId)
  answer([String(active[key] === teamId), key, JSON.stringify(active)].join("\t"))
}

answer(["", "unknown-mode", "usage: resolve|bind|index"].join("\t"))
