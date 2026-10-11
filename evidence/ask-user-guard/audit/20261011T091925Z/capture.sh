#!/usr/bin/env bash
# Evidence capture for D3 of the wave contract `.mpd/plans/ask-user-question-guard.md` — the
# `ask_user_question` occurrence diagnostics (`skills/dsh-qa/scripts/ask-user-question-audit.ts`).
# Every gate runs from the REPO ROOT with the PINNED toolchain on PATH (`.toolchain/node_modules/.bin`
# first, recorded `buildToolchain` bun@1.4.0 — a PATH `bun` here is 1.4.2, and T16 measured that the
# difference rewrites built bytes), and writes its own `output.log` + `result.json` under this
# directory; the top-level `result.json` indexes them. Run it as `bash capture.sh` from anywhere:
# paths resolve from this script's own directory.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$ROOT/../../../.." && pwd)"
export PATH="$REPO/.toolchain/node_modules/.bin:$PATH"
BUN="$REPO/.toolchain/node_modules/.bin/bun"
# The REAL historical session log this lane was built for: a live store under the operator's DSH_HOME
# on 2026-10-11 holding 3 `ask_user_question` calls, one of them structurally broken (a 5-question
# batch whose LAST item carried an empty `id` AND an empty `question` — the shape that renders as a
# card with no text). Read-only: the audit never writes to a store.
REAL_LOG="${HOME}/.dsh/sessions/--home-haroldzhao-MyProj-DshProj-My-Power-Dsh--/7072e2c7-1257-4420-a933-6e414b20eab2/session.v4.jsonl.zstd"

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
  printf '%-24s exit=%s  %s\n' "$slug" "$code" "$(tail -1 "$dir/output.log")"
  return "$code"
}

# GATE 1 — the tool's own offline self-test: synthetic CONCATENATED-zstd frames through the real
# decoder, one assertion per rule of the local restatement, both result shapes, both answer pairings
# and both CLI exit codes.
run_gate audit-selftest node skills/dsh-qa/scripts/ask-user-question-audit.ts --self-test
# GATE 2 — the same tool over a REAL session log: proves the frame-by-frame decode and the
# classification against a store the harness really wrote, not against a fixture.
run_gate audit-real-log node skills/dsh-qa/scripts/ask-user-question-audit.ts "$REAL_LOG"
# GATE 3 — the NEGATIVE CONTROL for gate 1: a MUTATED copy of the script must FAIL (exit 1), or the
# green self-test proves nothing. The copy keeps a `lib/` sibling so its relative import resolves.
run_gate audit-selftest-mutant bash -c '
  set -u
  REPO="$1"
  tmp="$(mktemp -d)"
  trap "rm -rf \"$tmp\"" EXIT
  cp "$REPO/skills/dsh-qa/scripts/ask-user-question-audit.ts" "$tmp/"
  cp -r "$REPO/skills/dsh-qa/scripts/lib" "$tmp/lib"
  sed -i "s|report.occurrences.length === 11|report.occurrences.length === 12|" "$tmp/ask-user-question-audit.ts"
  node "$tmp/ask-user-question-audit.ts" --self-test
  code=$?
  echo "[mutant] the mutated copy exited $code (1 = the assertion really fired, as intended)"
  if [ "$code" -eq 1 ]; then exit 0; fi
  echo "[mutant] FAIL: a mutated assertion did NOT redden the self-test"
  exit 1
' bash "$REPO"
# GATE 4 — the repository type program over every source file, the new script included.
run_gate typecheck "$BUN" run typecheck
# GATE 5 — the cross-case self-test sweep (`test:qa`): every `skills/dsh-qa/scripts/*.ts` runs its own
# `--self-test`, so the new case is discovered without a manifest entry.
run_gate test-qa "$BUN" run test:qa
# GATE 6 — the bilingual doc pair (the `development.md` / `development.zh-CN.md` row added with the case).
run_gate verify-docs "$BUN" run verify:docs
# GATE 7 — the declaration-comment / named-function-signature gate over the new script.
run_gate verify-comments "$BUN" run verify:comments
# GATE 8 — the lane-drift ledger: every `.ts` under `skills/dsh-qa/scripts/` must be a suite member or
# carry an `outsideSuites` reason, which is what the new script's `cases.json` entry satisfies. This
# gate is RED for a PRE-EXISTING reason unrelated to D3: `delegation-gate.ts` (committed, present in
# HEAD) has no `cases.json` entry at all — `preexisting-drift.txt` in this directory records the
# read-only git proof that the drift is in HEAD without this wave's change. Recorded as-is.
run_gate qa-lane-drift node scripts/run-qa-lanes.ts --check-drift

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
    wave: "ask-user-question-guard",
    deliverables: ["D3 — occurrence diagnostics (skills/dsh-qa/scripts/ask-user-question-audit.ts)"],
    branch: "feature/ask-user-question-guard",
    toolchain: ".toolchain/node_modules/.bin/bun first on PATH (buildToolchain bun@1.4.0)",
    gates,
    summary: { total: gates.length, passed: gates.length - failed.length, failed: failed.map((g) => g.gate) },
  }, null, 2) + "\n")
  console.log("INDEX: " + gates.length + " gates, " + failed.length + " failed")
'
