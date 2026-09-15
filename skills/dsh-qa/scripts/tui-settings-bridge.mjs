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
// `web-settings-bridge.mjs`, which uses the host's own authenticated API.
//
// PREREQ: absent-bundle-dist packages/mpd-tui-plugin/dist/index.js "bun build packages/mpd-tui-plugin/src/index.ts --target node --format esm --outfile packages/mpd-tui-plugin/dist/index.js"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-settings-bridge.mjs --self-test
//   bun skills/dsh-qa/scripts/tui-settings-bridge.mjs [--out <dir>]
// Evidence -> evidence/mpd-bridge/tui-settings-bridge/<timestamp>/{result.json,output.log}
import { runTuiArm, selfTest } from "./lib/settings-bridge-lane.mjs"

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest("tui")
else {
  try {
    process.exit(await runTuiArm(argv))
  } catch (error) {
    console.error("[tui-settings-bridge] CRASH: " + String(error?.stack ?? error))
    process.exit(1)
  }
}
