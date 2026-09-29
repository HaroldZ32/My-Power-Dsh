#!/usr/bin/env node
// Pin the integrated revision: commit hash, tree cleanliness, tracked-diff sha256
// and per-file sha256 of the ULW wave's decisive files. Read-only.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = "/root/dshProj/my-power-dsh";
const outPath = process.argv[2];
if (!outPath) {
  console.error("usage: pin-revision.mjs <out.json>");
  process.exit(2);
}

const git = (...args) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

const FILES = [
  "packages/mpd-ulw-plugin/src/index.ts",
  "packages/mpd-ulw-plugin/src/engine.test-fixtures.ts",
  "packages/mpd-ulw-plugin/dist/index.js",
  "packages/mpd-ulw-plugin/test/engine.test.ts",
  "packages/mpd-ulw-plugin/test/commands.test.ts",
  "packages/mpd-dsh-adapter-plugin/src/index.ts",
  "packages/mpd-dsh-adapter-plugin/dist/index.js",
  "packages/mpd-agent-teams-plugin/lib/session-start.js",
  "packages/mpd-agent-teams-plugin/lib/mpd-deltas.js",
  "scripts/patch-agent-teams-fixes.mjs",
  "skills/dsh-qa/scripts/session-start-team.mjs",
  "skills/dsh-qa/scripts/ulw-command.mjs",
  "skills/dsh-qa/scripts/ultrawork-smoke.mjs",
  "presets/mpd/agent.cordis.yml",
  "packages/mpd-bundle/cordis.patch.yml",
  "VENDOR_LOCK.json",
];

const sha256File = (rel) =>
  createHash("sha256").update(readFileSync(resolve(repo, rel))).digest("hex");

const fileHashes = {};
const missing = [];
for (const rel of FILES) {
  try {
    fileHashes[rel] = sha256File(rel);
  } catch {
    missing.push(rel);
  }
}

const trackedDiff = execFileSync("git", ["diff", "HEAD"], {
  cwd: repo,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const status = git("status", "--porcelain");

const record = {
  capturedAtUtc: new Date().toISOString(),
  commit: git("rev-parse", "HEAD"),
  branch: git("rev-parse", "--abbrev-ref", "HEAD"),
  worktreeClean: status === "",
  statusPorcelain: status === "" ? "" : status,
  trackedDiffSha256: createHash("sha256").update(trackedDiff).digest("hex"),
  fileHashes,
  missing,
  fileHashesSha256: createHash("sha256")
    .update(JSON.stringify(fileHashes, Object.keys(fileHashes).sort()))
    .digest("hex"),
};

writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record, null, 2));
