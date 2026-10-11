#!/usr/bin/env bash
# Evidence capture for the D1/D2 wave (contract `.mpd/plans/ask-user-question-guard.md` — the
# ask_user_question boundary guard + the preset construction rule). Every gate runs from the REPO ROOT
# with the PINNED toolchain (`.toolchain/node_modules/.bin/bun`, recorded buildToolchain bun@1.4.0) and
# writes its own `output.log` + `result.json` under this directory; the top-level `result.json` indexes
# them. Run it as `bash capture.sh` from anywhere: paths resolve from this script's own directory, and
# the exit status is the LAST gate's, so every row is re-derivable from one command.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$ROOT/../../../.." && pwd)"
BUN="$REPO/.toolchain/node_modules/.bin/bun"

# run_gate <slug> <command...>: run one gate in $REPO, capture the log and derive its result.json.
run_gate() {
  slug="$1"; shift
  dir="$ROOT/$slug"
  mkdir -p "$dir"
  start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ( cd "$REPO" && "$@" ) > "$dir/output.log" 2>&1
  code=$?
  end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  GATE_SLUG="$slug" GATE_CODE="$code" GATE_START="$start" GATE_END="$end" GATE_DIR="$dir" \
    GATE_CMD="$*" REPO="$REPO" node -e '
      const fs = require("node:fs")
      const crypto = require("node:crypto")
      const logPath = process.env.GATE_DIR + "/output.log"
      const bytes = fs.readFileSync(logPath)
      const lines = bytes.toString("utf8").split("\n").filter((l) => l.trim() !== "")
      fs.writeFileSync(process.env.GATE_DIR + "/result.json", JSON.stringify({
        gate: process.env.GATE_SLUG,
        command: process.env.GATE_CMD,
        cwd: process.env.REPO,
        exitCode: Number(process.env.GATE_CODE),
        startedAtUtc: process.env.GATE_START,
        endedAtUtc: process.env.GATE_END,
        logPath: "output.log",
        logBytes: bytes.length,
        logSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        headline: lines.length > 0 ? lines[lines.length - 1] : "",
      }, null, 2) + "\n")
    '
  printf '%-22s exit=%s  %s\n' "$slug" "$code" "$(tail -1 "$dir/output.log")"
  return "$code"
}

# GATE 1 — the touched package's unit suite (all 8 files, the new ask-user-guard arms included).
run_gate bun-test "$BUN" test packages/mpd-roles-plugin
# GATE 2 — the repository type program over every source file.
run_gate typecheck "$BUN" run typecheck
# GATE 3 — the declaration-comment / named-function-signature gate.
run_gate verify-comments "$BUN" run verify:comments
# GATE 4 — the bundle-patch row parity gate (the preset edit touches a patch file).
run_gate verify-rows "$BUN" run verify:rows
# GATE 5 — preset conformance against the INSTALLED harness (validates the persona prefix through the
# real schemastery `Config`), self-test arm with its negative controls.
run_gate preset-conformance node skills/dsh-qa/scripts/preset-conformance.ts --self-test
# GATE 6 — deterministic rebuild-and-diff of every `packages/*/src` entry against its committed `dist/`.
run_gate verify-dist-fresh node scripts/verify-dist-fresh.ts

# The index: every gate row, so a reader sees all six outcomes in ONE file.
GATE_ROOT="$ROOT" node -e '
  const fs = require("node:fs")
  const path = require("node:path")
  const root = process.env.GATE_ROOT
  const gates = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, "result.json")))
    .map((e) => JSON.parse(fs.readFileSync(path.join(root, e.name, "result.json"), "utf8")))
  const failed = gates.filter((g) => g.exitCode !== 0)
  fs.writeFileSync(path.join(root, "result.json"), JSON.stringify({
    wave: "ask-user-question-guard",
    deliverables: ["D1 — boundary guard (packages/mpd-roles-plugin)", "D2 — prompt hardening (presets/mpd.patch.yml)"],
    branch: "feature/ask-user-question-guard",
    toolchain: ".toolchain/node_modules/.bin/bun (buildToolchain bun@1.4.0)",
    gates,
    summary: { total: gates.length, passed: gates.length - failed.length, failed: failed.map((g) => g.gate) },
  }, null, 2) + "\n")
  console.log("INDEX: " + gates.length + " gates, " + failed.length + " failed")
'
