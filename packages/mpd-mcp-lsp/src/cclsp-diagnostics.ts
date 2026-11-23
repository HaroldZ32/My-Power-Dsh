import { readFileSync } from "node:fs"
import * as module from "node:module"
import type { LoadFnOutput, LoadHookContext, LoadHookSync } from "node:module"

/** Exact cclsp release whose private client layout this adaptation understands. */
const CCLSP_VERSION = "0.7.0"

/** All anchors must match exactly once before any upstream source is changed. */
const diagnosticsEdits = [
  ["          definition: { linkSupport: false },", `          publishDiagnostics: { versionSupport: true },
          definition: { linkSupport: false },`],
  ["      openFiles: new Set,", "      openFiles: new Set,\n      openFileContents: new Map,"],
  ["      serverState.fileVersions.set(filePath, 1);", `      serverState.fileVersions.set(filePath, 1);
      serverState.openFileContents.set(filePath, fileContent);`],
  ["  async syncFileContent(filePath) {\n    try {\n      const serverState = await this.getServer(filePath);", `  async syncFileContent(filePath, current) {
    try {
      const serverState = current?.serverState ?? await this.getServer(filePath);`],
  [`      const fileContent = readFileSync2(filePath, "utf-8");
      const uri = pathToUri(filePath);
      const version = (serverState.fileVersions.get(filePath) || 1) + 1;
      serverState.fileVersions.set(filePath, version);`, `      const fileContent = current?.text ?? readFileSync2(filePath, "utf-8");
      const uri = pathToUri(filePath);
      const version = (serverState.fileVersions.get(filePath) || 1) + 1;
      serverState.fileVersions.set(filePath, version);
      serverState.openFileContents.set(filePath, fileContent);
      serverState.diagnostics.delete(uri);
      serverState.lastDiagnosticUpdate.delete(uri);
      serverState.diagnosticVersions.delete(uri);`],
  ["        if (params?.uri) {", `        if (params?.uri) {
          if (typeof params.version === "number" && typeof params.uri === "string" && params.uri.startsWith("file:") &&
              params.version < (serverState.fileVersions.get(uriToPath(params.uri)) ?? 0)) return;`],
  [`    const fileUri = pathToUri(filePath);
    const cachedDiagnostics = serverState.diagnostics.get(fileUri);`, `    const fileUri = pathToUri(filePath);
    const currentText = readFileSync2(filePath, "utf-8");
    const edited = currentText !== serverState.openFileContents.get(filePath);
    if (edited) await this.syncFileContent(filePath, { serverState, text: currentText });
    const cachedDiagnostics = serverState.diagnostics.get(fileUri);`],
  ["      if (timeSinceLastUpdate >= idleTime) {", "      if ((!options.requireResult || serverState.diagnostics.has(fileUri)) && timeSinceLastUpdate >= idleTime) {"],
  [`        maxWaitTime: 5000,
        idleTime: 300`, `        maxWaitTime: 5000,
        idleTime: 300,
        requireResult: edited`],
] as const

/** Import cclsp with the scoped disk-sync adaptation when its pinned layout matches. */
export async function startCclsp(entry: URL, version: string, log: (line: string) => void): Promise<void> {
  if (version !== CCLSP_VERSION || typeof module.registerHooks !== "function") {
    log(`[mpd-mcp-lsp] diagnostics refresh adaptation unavailable for cclsp@${version}`)
    await import(entry.href)
    return
  }
  /** The hook touches only the resolved cclsp entry in this standalone MCP process. */
  const hook = module.registerHooks({
    /** Preserve Node's ESM resolution and adjust the one known entry before evaluation. */
    load(url: string, context: LoadHookContext, nextLoad: Parameters<LoadHookSync>[2]): LoadFnOutput {
      /** Let Node choose the format and preserve its normal loader behavior for every other module. */
      const loaded = nextLoad(url, context)
      if (url !== entry.href || loaded.format !== "module") return loaded
      /** Read the original source once and fail open if a distributor changed the pinned layout. */
      const source = readFileSync(entry, "utf8")
      for (const [before] of diagnosticsEdits) {
        /** A missing or ambiguous anchor must leave the dependency entirely unchanged. */
        const at = source.indexOf(before)
        if (at < 0 || source.indexOf(before, at + before.length) >= 0) {
          log(`[mpd-mcp-lsp] diagnostics refresh adaptation skipped: unexpected cclsp@${version} layout`)
          return loaded
        }
      }
      return { ...loaded, source: diagnosticsEdits.reduce<string>((text, [before, after]) => text.replace(before, after), source) }
    },
  })
  try {
    await import(entry.href)
  } finally {
    hook.deregister()
  }
}
