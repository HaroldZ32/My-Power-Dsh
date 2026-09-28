// Scratch-tree staging for the self-fix tests that EXECUTE one of the repository's scripts.
//
// A scratch tree that copies `scripts/<name>.ts` and runs it must copy the scripts' shared
// primitives too (`scripts/lib/repo.ts`): the copy alone dies with
// `ERR_MODULE_NOT_FOUND … scripts/lib/repo.mjs`, which reads as a failure of whatever the arm
// under test is about. One helper so a new scratch tree cannot reintroduce that.
import { cpSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** The repository's `scripts/` directory, derived from this helper's own URL (it lives two levels down). */
const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts")

/**
 * Copy `scripts/<name>` and the shared `scripts/lib/` primitives into `<root>/scripts/`, ready to be
 * executed by `node` from the scratch root.
 *
 * @param root - the scratch root the copy lands in; created as needed.
 * @param name - the script's file name, extension included (`patch-agent-teams-fixes.ts`).
 */
export function stageScript(root: string, name: string): void {
  mkdirSync(join(root, "scripts", "lib"), { recursive: true })
  cpSync(join(SCRIPTS_DIR, name), join(root, "scripts", name))
  cpSync(join(SCRIPTS_DIR, "lib", "repo.ts"), join(root, "scripts", "lib", "repo.ts"))
}
