#!/usr/bin/env bun
// Case tui-settings-bridge — the TUI arm of the settings-bridge proof.
//
// It asserts the TUI SURFACE against the built bytes, which is what this environment can
// witness without a TTY:
//   • every `/settings` hint carries the true post-bridge disclosure (a save writes
//     `<workspace>/.mpd/mpd.jsonc` for the live session workspace(s) and takes effect for the
//     mpd plugins after a restart) and the pre-t35 "not bridged" sentence is DELETED;
//   • the §D.2 `no-live-session` RUNTIME NOTICE is present in the built bytes AND wired into
//     the status-line composition (a notice merely defined would be invisible on screen);
//   • the TUI package still performs ZERO filesystem writes.
//
// NOT driven here, and recorded as such in the result: TUI KEYSTROKES (a real TTY drive is
// `tui-panels`' job) and any rendered card (the user cut the card; no browser exists here).
// The write path itself — namespace → file → resolved value — is the sibling lane
// `web-settings-bridge.ts`, which uses the host's own authenticated API.
//
// PREREQ: absent-bundle-dist packages/mpd-tui-plugin/dist/index.js "bun build packages/mpd-tui-plugin/src/index.ts --target node --format esm --outfile packages/mpd-tui-plugin/dist/index.js"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-settings-bridge.ts --self-test
//   bun skills/dsh-qa/scripts/tui-settings-bridge.ts [--out <dir>]
// Evidence -> evidence/mpd-bridge/tui-settings-bridge/<timestamp>/{result.json,output.log}
import { resolve } from "node:path"
import { exitOnRefusal, refuseOverwrite } from "./lib/immutable-output.ts"
import { runTuiArm, selfTest } from "./lib/settings-bridge-lane.ts"

/**
 * T-83 clause 1: `runTuiArm` takes a CALLER-SUPPLIED output target
 * (`lib/settings-bridge-lane.ts:421-422` — `argv[outIndex + 1]` is used VERBATIM), so a re-run can be
 * pointed at an existing directory. Refuse that here, exactly as the other required drivers do.
 *
 * @param argv The lane's own command line, `process.argv.slice(2)`; only `--out` is inspected.
 * @param slug The case slug the refusal prefix reports, e.g. `tui-settings-bridge`.
 * @returns Nothing on an absent or blank `--out`; never returns when the target already exists.
 */
function guardCallerSuppliedTarget(argv: readonly string[], slug: string): void {
  // Position of the `--out` flag; a negative index means the caller named no explicit target.
  const at = argv.indexOf("--out")
  if (at < 0 || typeof argv[at + 1] !== "string" || argv[at + 1] === "") return
  try {
    refuseOverwrite(resolve(argv[at + 1]), { label: "evidence directory", remedy: "pass a new --out <dir>, or omit --out for a fresh timestamped directory (T-53)" })
  } catch (error) {
    exitOnRefusal(error, "[" + slug + "]")
  }
}

// The lane's own command line; every mode decision below is read from this slice.
const argv: string[] = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest("tui")
else {
  guardCallerSuppliedTarget(argv, "tui-settings-bridge")
  try {
    process.exit(await runTuiArm(argv))
  } catch (error) {
    // The thrown value is `unknown` under strict mode; it is viewed as a stack-bearing record so a
    // plain-object crash still reports its own `.stack`, exactly as that expression did before.
    console.error("[tui-settings-bridge] CRASH: " + String((error as { stack?: unknown } | null)?.stack ?? error))
    process.exit(1)
  }
}
