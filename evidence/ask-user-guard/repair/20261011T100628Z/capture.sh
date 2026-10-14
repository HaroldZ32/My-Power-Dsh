#!/usr/bin/env bash
# Evidence capture for the repair wave of contract `.mpd/plans/ask-user-guard-repair.md` — the
# CodeRabbit findings R1–R4 on `presets/mpd.patch.yml` and
# `skills/dsh-qa/scripts/ask-user-question-audit.ts` (R5 is a NOTES.md decision, not a gate).
# Every gate runs from the REPO ROOT with the PINNED toolchain first on PATH
# (`.toolchain/node_modules/.bin`, recorded `buildToolchain` bun@1.4.0 — a PATH `bun` here is 1.4.2 and
# T16 measured that the difference rewrites built bytes), and writes its own `output.log` +
# `result.json` under this directory; the top-level `result.json` indexes them. Run it as
# `bash capture.sh` from anywhere: paths resolve from this script's own directory.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$ROOT/../../../.." && pwd)"
export PATH="$REPO/.toolchain/node_modules/.bin:$PATH"
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
  printf '%-30s exit=%s  %s\n' "$slug" "$code" "$(tail -1 "$dir/output.log")"
  return "$code"
}

# run_mutant <slug> <sed-expr>: the NEGATIVE CONTROL for the self-test arms. A MUTATED copy of the
# script (with a `lib/` sibling so its relative import resolves) must exit 1, or the green self-test
# proves nothing about the behaviour the mutation removed. The gate itself exits 0 only when the
# mutated copy really reddened.
run_mutant() {
  slug="$1"; shift
  expr="$1"; shift
  run_gate "$slug" bash -c '
    set -u
    REPO="$1"; EXPR="$2"
    tmp="$(mktemp -d)"
    trap "rm -rf \"$tmp\"" EXIT
    cp "$REPO/skills/dsh-qa/scripts/ask-user-question-audit.ts" "$tmp/"
    cp -r "$REPO/skills/dsh-qa/scripts/lib" "$tmp/lib"
    sed -i "$EXPR" "$tmp/ask-user-question-audit.ts"
    echo "[mutant] mutation applied: $EXPR"
    node "$tmp/ask-user-question-audit.ts" --self-test
    code=$?
    echo "[mutant] the mutated copy exited $code (1 = the new assertion really fired, as intended)"
    if [ "$code" -eq 1 ]; then exit 0; fi
    echo "[mutant] FAIL: the mutation did NOT redden the self-test"
    exit 1
  ' bash "$REPO" "$expr"
}

# GATE 1 — R2/R3/R4's own offline self-test: the existing arms plus the repair arms (a wrong-type
# required-field detail, a JSON-array line counted as undecodable, and `--self-test` mixed with an
# argument), all through the real decoder and the real CLI.
run_gate audit-selftest node skills/dsh-qa/scripts/ask-user-question-audit.ts --self-test
# GATE 1a/1b/1c — the mutant negative controls, one per new behaviour. Each reverts the repair (R2:
# a wrong-type field reads `absent` again; R3: an array line is a record again) or flips its
# expectation (R4: the mixed invocation is expected to succeed), and the self-test MUST fail.
run_mutant audit-selftest-mutant-r2 's|if (raw === undefined) return "absent"|if (typeof raw !== "string") return "absent"|'
run_mutant audit-selftest-mutant-r3 's|!Array.isArray(parsed)|true|'
run_mutant audit-selftest-mutant-r4 's|mixedArgs.status === 2|mixedArgs.status === 0|'
# GATE 2 — the cross-case self-test sweep (`test:qa`): every `skills/dsh-qa/scripts/*.ts` runs its own
# `--self-test`, so the repaired script is exercised inside the suite it belongs to.
run_gate test-qa "$BUN" run test:qa
# GATE 3 — the repository type program over every source file, the repaired script included.
run_gate typecheck "$BUN" run typecheck
# GATE 4 — the declaration-comment / named-function-signature gate over the repaired script (the new
# `textFieldDetail` and every repaired declaration keep their contract comment and full signature).
run_gate verify-comments "$BUN" run verify:comments
# GATE 5 — the row/parity gate over the R1 reworded preset paragraph.
run_gate verify-rows "$BUN" run verify:rows
# GATE 6 — the preset-conformance self-test (the `mpd` preset's row set and row configs).
run_gate preset-conformance-selftest node skills/dsh-qa/scripts/preset-conformance.ts --self-test

# The index: every gate row, so a reader sees all outcomes in ONE file.
GATE_ROOT="$ROOT" node -e '
  const fs = require("node:fs")
  const path = require("node:path")
  const root = process.env.GATE_ROOT
  const gates = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, "result.json")))
    .map((e) => JSON.parse(fs.readFileSync(path.join(root, e.name, "result.json"), "utf8")))
  const failed = gates.filter((g) => g.exitCode !== 0)
  fs.writeFileSync(path.join(root, "result.json"), JSON.stringify({
    wave: "ask-user-guard",
    phase: "repair (CodeRabbit R1-R5 on PR #34)",
    contract: ".mpd/plans/ask-user-guard-repair.md",
    branch: "feature/ask-user-question-guard",
    head: "f684ec10",
    toolchain: ".toolchain/node_modules/.bin/bun first on PATH (buildToolchain bun@1.4.0)",
    notes: "NOTES.md carries the R5 decision (SkillSpector PE3 anchors SKILL.md:86/:125, out of scope, justified) and the DECLINED pairAnswer refactor.",
    gates,
    summary: { total: gates.length, passed: gates.length - failed.length, failed: failed.map((g) => g.gate) },
  }, null, 2) + "\n")
  console.log("INDEX: " + gates.length + " gates, " + failed.length + " failed")
'
