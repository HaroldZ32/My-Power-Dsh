#!/usr/bin/env bun
// Case web-settings-bridge — the WEB arm of the settings-bridge proof.
//
// The user cut the web CARD, so this lane proves the half that matters and is still
// witnessable here: the write path through the HOST's own authenticated API. It boots the
// real bundle in an isolated `DSH_HOME` + sandbox `HOME` + sandbox WORKSPACE on a loopback
// port, exchanges the launch token for the authority-bound cookie (303 + `GET /?token=…`),
// and then issues the SAME `settings/mutate(ns, ops, revision)` call any web surface emits.
//
// Three observations per run (the acceptance the captain fixed):
//   (1) the front door accepted the write;
//   (2) `<workspace>/.mpd/mpd.jsonc` changed with its comments, key order and trailing
//       commas intact;
//   (3) the plugin's RESOLVED value changed — the namespace descriptor's resolved value and
//       its user section (the L3 layer `mpd-config` merges, i.e. what every mpd plugin reads).
// Plus two negative controls: two live roots must REFUSE `ambiguous-multi-root` writing
// nothing, and a composition with `settingsBridge.writeBack:false` must leave the file
// byte-identical while the value still lands. The engine re-runs itself on the same artifacts
// with an injected fan-out fault and must go red.
//
// The TUI SURFACE (hint wording, the §D.2 runtime notice, the zero-write invariant) is the
// sibling lane `tui-settings-bridge.mjs`; TUI KEYSTROKES belong to `tui-panels`.
//
// PREREQ: absent-dsh-binary dsh "install dsh (`npm i -g @deepseek-ai/dsh`) or run inside a checkout install"
// PREREQ: absent-bundle-dist packages/mpd-config-plugin/dist/index.js "bun build packages/mpd-config-plugin/src/index.ts --target node --format esm --outfile packages/mpd-config-plugin/dist/index.js"
//
// Usage:
//   bun skills/dsh-qa/scripts/web-settings-bridge.mjs --self-test
//   bun skills/dsh-qa/scripts/web-settings-bridge.mjs [--out <dir>] [--keep]
// Evidence -> evidence/mpd-bridge/web-settings-bridge/<timestamp>/{result.json,output.log,raw/}
import { runWebArm, selfTest } from "./lib/settings-bridge-lane.mjs"

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest("web")
else {
  try {
    process.exit(await runWebArm(argv))
  } catch (error) {
    console.error("[web-settings-bridge] CRASH: " + String(error?.stack ?? error))
    process.exit(1)
  }
}
