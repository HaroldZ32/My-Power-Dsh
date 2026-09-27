// Scratch-tree staging for the self-fix tests that EXECUTE one of the repository's scripts.
//
// A scratch tree that copies `scripts/<name>.mjs` and runs it must copy the scripts' shared
// primitives too (`scripts/lib/repo.mjs`): the copy alone dies with
// `ERR_MODULE_NOT_FOUND … scripts/lib/repo.mjs`, which reads as a failure of whatever the arm
// under test is about. One helper so a new scratch tree cannot reintroduce that.
import { cpSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts")

/** Copy `scripts/<name>` and `scripts/lib/` into `<root>/scripts/`, ready to be executed. */
export function stageScript(root, name) {
  mkdirSync(join(root, "scripts", "lib"), { recursive: true })
  cpSync(join(SCRIPTS_DIR, name), join(root, "scripts", name))
  cpSync(join(SCRIPTS_DIR, "lib", "repo.mjs"), join(root, "scripts", "lib", "repo.mjs"))
}
