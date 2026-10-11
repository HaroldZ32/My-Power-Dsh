# D3 — `ask_user_question` occurrence diagnostics (evidence)

Contract: `.mpd/plans/ask-user-question-guard.md` (frozen 2026-10-11), deliverable **D3**.
Branch: `feature/ask-user-question-guard`. Captured: 2026-10-11T09:20Z (UTC), every gate window is
AFTER the last write to its subject (latest subject mtime 09:19:46Z).

## What D3 landed

| Path | What changed |
|---|---|
| `skills/dsh-qa/scripts/ask-user-question-audit.ts` | **new** — the reporting tool (see the file header for the record shapes it reads) |
| `skills/dsh-qa/SKILL.md` | case row added to the case table |
| `skills/dsh-qa/cases.json` | lane-registry entry (`suites: []`, `outsideSuites` reason) — without it the `qa-lane-drift` gate counts the new script as drift |
| `docs/development.md` / `docs/development.zh-CN.md` | lane-table row added to BOTH twins, same anchor (immediately after `tui-settings-bridge`) |

`cases.json` is NOT named in the task text but IS required by the repository's own registry contract
(`skills/dsh-qa/cases.json` → `driftRule`: every `.ts` under `skills/dsh-qa/scripts/` is either a suite
member or carries an `outsideSuites` reason). It was added within the lane's write scope.

## Gates (this directory, one `result.json` + `output.log` per gate; `result.json` indexes them)

| Gate | Command | Exit |
|---|---|---|
| `audit-selftest` | `node skills/dsh-qa/scripts/ask-user-question-audit.ts --self-test` | 0 |
| `audit-real-log` | `node …ask-user-question-audit.ts <real 2026-10-11 session store>` | 0 |
| `audit-selftest-mutant` | a MUTATED copy of the script must FAIL (negative control for gate 1) | 0 (mutant exited 1, as required) |
| `typecheck` | `.toolchain/node_modules/.bin/bun run typecheck` | 0 |
| `test-qa` | `.toolchain/node_modules/.bin/bun run test:qa` | 0 |
| `verify-docs` | `.toolchain/node_modules/.bin/bun run verify:docs` | 0 |
| `verify-comments` | `.toolchain/node_modules/.bin/bun run verify:comments` | 0 |
| `qa-lane-drift` | `node scripts/run-qa-lanes.ts --check-drift` | **1 — PRE-EXISTING, not this change** |

`PATH` is prefixed with `.toolchain/node_modules/.bin` inside `capture.sh` so every nested `bun`
invocation is the PINNED 1.4.0 (`buildToolchain`), not the PATH 1.4.2.

### The one RED gate, recorded as-is

`qa-lane-drift` reports exactly one unlisted script: `skills/dsh-qa/scripts/delegation-gate.ts`. The new
D3 script is NOT it — the gate's own discovery line in `output.log` names `delegation-gate.ts` as the
only unlisted entry, so the D3 entry in `cases.json` is registered correctly. That red is PRE-EXISTING:
`preexisting-drift.txt` holds the read-only git proof that the file is in `HEAD` and that `HEAD`'s
`cases.json` never mentions it. Fixing it is another writer's call — inventing an `outsideSuites` reason
for a lane this wave did not author is not a mechanical edit.

## Real-run arm (not a fixture)

`audit-real-log` ran over a store the harness really wrote (2026-10-11, 159 frames, 302 records). It
found 3 occurrences, one of them `structurally-broken`: a 5-question batch whose LAST item carries an
empty `id` AND an empty `question` — the exact class of shape that renders as a card with no text.
**Bound:** that path lives under the operator's `$HOME/.dsh`; the row is not reproducible elsewhere and
the store may be GC'd.

## Honest bounds of the classifier

- The rules are a LOCAL restatement of D1's deny list. A mis-keyed `options` FIELD (e.g. `Options`) is
  NOT denied by D1 and is NOT flagged here: `options` reads as absent, which stays legal (a free-text
  question). The audit reports what the D1 rule set denies — no more.
- A `tool/result` whose call id cannot be read pairs with nothing; those records are counted and
  printed (`idlessResults`) so "unpaired" is never silently read as "never answered".
- `0 occurrences` is a real answer, not an error: a log that merely OFFERS the tool in its request
  header (no `tool/call`) reports zero — verified on four such stores while building this.
