import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/** Run the actual launcher and use the adopted server's config lookup as a cwd oracle. */
test("the adopted CodeGraph server uses the project alias, with the canonical override winning", async () => {
  /** All generated artifacts and workspaces belong to this test. */
  const root = mkdtempSync(join(tmpdir(), "mpd-cg-launch-"))
  try {
    /** The MCP process starts here, with no project-local CodeGraph config. */
    const session = join(root, "session")
    /** The documented alias points to a workspace that disables CodeGraph through its own config. */
    const alias = join(root, "alias")
    mkdirSync(session)
    mkdirSync(join(alias, ".mpd"), { recursive: true })
    writeFileSync(join(alias, ".mpd", "config.jsonc"), '{"codegraph":{"enabled":false}}\n')
    /** Compile the launcher beside an unchanged copy of the prebuilt server. */
    const build = await Bun.build({
      entrypoints: [fileURLToPath(new URL("../src/launch.ts", import.meta.url))],
      outdir: root, target: "node", format: "esm", naming: "launch.mjs",
    })
    expect(build.success).toBe(true)
    copyFileSync(fileURLToPath(new URL("../dist/serve.js", import.meta.url)), join(root, "serve.js"))
    /** Compare the actual server's skip reasons. The sentinel prevents fixture network provisioning. */
    const run = (canonical: string): string => {
      /** One black-box MCP initialization reply from the adopted server even when unavailable. */
      const result = spawnSync("node", [join(root, "launch.mjs")], {
        cwd: session, encoding: "utf8", timeout: 5_000,
        input: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}\n',
        env: {
          ...process.env, HOME: root, USERPROFILE: root, DSH_HOME: join(root, "dsh"),
          DSH_WORKSPACE_ROOT: session, MPD_MCP_LOG_DIR: session, PWD: session,
          MPD_CODEGRAPH_SESSION_START_CWD: session, MPD_CODEGRAPH_PROJECT_CWD: canonical,
          MPD_DSH_CODEGRAPH_PROJECT_CWD: alias, MPD_CODEGRAPH_BIN: join(root, "unavailable"),
        },
      })
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26" } })
      return readFileSync(join(session, ".mpd", "logs", "mpd-mcp-codegraph.log"), "utf8").trim().split("\n").at(-1) ?? ""
    }
    expect(run(" ")).toContain("disabled by .mpd config")
    expect(run(session)).toContain("project excluded by the CodeGraph policy")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 15_000)
