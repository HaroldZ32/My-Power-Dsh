# STEP 2a — `tui-mount` AC-11 preset witness: the blank-session assumption was wrong, so the arm is BOUNDED

Lane: `tui-mount` (`skills/dsh-qa/scripts/tui-mount.ts`, `assertBootFace`).

## Re-derivation (measured on 0.15.0)

The witness is read from `<DSH_HOME>/sessions/<projectKey>/<sessionId>/session.vN.jsonl.zstd` by
`readSessionHeaders` (`lib/tui-lane.ts`). The host's jsonl backend flushes a store only when something
is **APPENDED**, and `tui-mount` deliberately drives **no keystroke, command or turn** ("the lane passes
no steps, so only the boot is captured") — so a fully rendered, chat-ready boot leaves the store EMPTY.

Three independent readings, all on 0.15.0:

| Reading | Result |
|---|---|
| T8 run `tui-mount.evidence/result.json` | `sandboxSessions: 0`, `sessionKeysCreated: []`, `preset.session.json.records: []`, `statusLine/counters/rendered: true` |
| `evidence/tui/dsh-tui-015/q-run/repair/2c-before.log` (a fresh `tui-deps-ctrla` boot at 09:49Z) | no new store directory at all after the run (`find … -printf %TH:%TM` showed nothing newer than 09:21Z) |
| `tui-panels` (which DOES drive four `/mpd …` commands) | created `…/b27acb78-3883-4717-8ad3-09c2aac2ca85/session.v4.jsonl.zstd` at 17:52 local, carrying its `command/run` records |

So the witness cannot be produced without driving a turn/command — which would change this lane from a
boot-face lane into a drive lane (and its isolation/capture contract). Per the task's own rule for this
arm, the witness is therefore **DECLARED**, not faked.

## What changed in `tui-mount.ts`

1. `BootFace.presetWitness: "asserted" | "missing" | "not-materialized"` (new field, documented):
   - `asserted` — a session header THIS boot created ran `mpd`;
   - `missing` — a store for THIS boot EXISTS but none ran `mpd` → the arm is RED (falsifier kept);
   - `not-materialized` — this boot flushed no store at all → the arm is green AND bounded.
   `assertBootFace` now reads `presetWitness !== "missing"` instead of `preset !== undefined`.
2. **Freshness, not just the project key.** Every lane of a wave writes under the SAME sandbox project
   key, so the previous code's "sandbox-keyed" filter still resolved an INHERITED session in a warm root.
   Measured on the first attempt of this fix: `witness=asserted` while the session id was
   `b27acb78…` — `tui-panels`' boot, not this one. The lane now snapshots `sandboxSessionIds(root)`
   BEFORE the boot and filters to sessions this boot created; `face.freshSandboxSessions` records the
   count.
3. The live log prints either the witness or the bound sentence, and the evidence file carries both
   `sandboxSessions` (whole key, warm root included) and `freshSandboxSessions`.
4. Two new `--self-test` arms plus the three new self-test checks: an EMPTY store is
   `not-materialized` and green; an `mpd` header is `asserted`; a NON-EMPTY store with only a `standard`
   header is still RED (`missing`) — the negative control the original arm had.

## Observed

```
$ bun skills/dsh-qa/scripts/tui-mount.ts --self-test
[tui-mount self-test] ok: layering, crash-scan, boot-face and isolation predicates are two-sided
exit=0
```

```
$ bun skills/dsh-qa/scripts/tui-mount.ts --sandbox-root .mpd/recon/qa/tui-lanes/tui-015
[tui-mount] preset=undefined session=undefined witness=not-materialized isolationOffenders=0
[tui-mount] AC-11 DECLARED BOUND: this boot flushed NO session store (`freshSandboxSessions=0`, warm root
carries 5), so the preset witness cannot be produced without driving a turn — the lane keeps its
keystroke-free isolation and closes the arm on the other six assertions
[tui-mount] PASS: third layer mounted, 0 session record(s) decoded, zero apply-crash signatures
exit=0
```
Evidence: `evidence/tui/dsh-tui-015/q-run/step3-final/tui-mount.log` + `step3-final/tui-mount.exit` (=0),
lane evidence dir copied to `step3-final/tui-mount.evidence/`.

## Honest bound (carry into the PR body)

- AC-11's preset witness is NOT witnessed in this environment. The arm is green on the other six
  observations (layering, zero crash signatures, status line, counters, render, composed row) and on the
  isolation delta; the preset claim rests on the fixture (`home/.dsh-tui/agent-preset.json` = `mpd`)
  plus the FALSIFIABLE half (a store that exists with a non-`mpd` preset still fails).
- If a future run DOES materialize a store (e.g. a lane that drives a command), the arm asserts the
  witness for real — the two paths are the same code.
