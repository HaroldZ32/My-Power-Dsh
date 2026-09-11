# t5 — independent verification: registry redesign, marker fix, update_task diagnostics, F3

Status: **PASS** (7/7 acceptance criteria). Evidence produced by this run only; the implementers'
summaries were not used as evidence.

Measured revision (working tree, uncommitted wave-3 state):
`HEAD 98680b1fb2bbf5c10c28cfbe44419e91595e1cb7`

| Artifact | sha256 |
|---|---|
| `packages/mpd-agent-teams-plugin/lib/tools.js` | `7cb899a72b06a023c25bb25681f3dd75d59c1e911573bf82a5a8da809a3f5c07` |
| `packages/mpd-agent-teams-plugin/lib/quality-gates.js` | `4e94f7f6f60a8f49433a4cfb49833deab94ed24644949c464d4c1eb41abe0bd5` |
| `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js` (12 regions) | `d3a1d4adce41992b9eb7faf37dd145dbaf4df0352a1b29c8b39038e1a7285ffb` |
| `scripts/patch-agent-teams-fixes.mjs` | `6f56e6814f5e03d044fa647f345405fbbc4d1abf51d34544af1660d570619a38` |
| `self-fix-tests/registry-context-heal.test.mjs` | `2c272bc374113bc8a4c468853b259b28efeb68cf7199534fd0efad1ef5f97d78` |
| `test/update-task-diagnostics.test.mjs` | `41fd9fbdd005af0f32f399463bcd579a8c65365ac9795ae45c0560dce105db93` |

## The decisive result

Strip **BOTH** adopted files from the same state → one heal → byte compare each against canonical
(3 rounds, plus a CLI leg and a partial-history leg):

* `tools.js`: **0 diff lines** (wave 2 measured 60, with `task-contract` re-inserted at 1970 vs
  canonical 1733); 5 regions / 136 removed lines restored; healed sha equals canonical.
* `quality-gates.js`: **0 diff lines** — it did not trade one file for the other; 7 regions /
  249 removed lines restored; healed sha equals canonical.
* CLI leg (`node scripts/patch-agent-teams-fixes.mjs --write` in a throw-away repo layout):
  exit 0, `inserted: <all 12 ids>`, both files byte-identical; `--check` then reports
  `already applied: 12 mpd delta region(s) across 2 adopted file(s)`.
* Partial-history leg (every other region stripped in both files): 7 inserted, both byte-identical.
* Negative control: perturbing one registered `afterContext` line makes the guard **refuse**
  (`occurs 0 time(s) OUTSIDE every region`) and leaves the victim file unchanged — the green legs
  are not vacuous.

Full plain-text output: `result.json` (per-criterion) and `output.log`; raw per-driver results in `drivers/`.

## Marker prefix ambiguity

All three colliding pairs (`scope-overlap ⊂ -normalize`, `repair-scope ⊂ -fields`,
`task-contract ⊂ -render`), both dangling shapes, 12/12 checks: a partially stripped region is
reported as a healable orphan (`begin`/`end`) — never `half-open` — and heals byte-identically.
The fixtures also record *why* the old rule misfired: on the end-dropped file a substring search
resolves the outer id's end marker to the **inner** id's end line, and on the begin-dropped file it
leaves the begin unresolved. A genuinely inverted pair still raises the half-open refusal.

## Diagnostics and the oversized-payload boundary

* omitted `attempt_id` → `attempt_id is required for task t2: call agent_teams_claim_task …`, record
  untouched; a present-but-wrong id keeps the stale wording; omitted `status` →
  `invalid arguments: missing required property "status"`; happy path persists.
* The boundary claim is confirmed by running the **installed** harness: a 16,241-byte arguments
  payload streamed in 74 deltas assembles byte-identically (`BlockAssembler`), all six keys
  including the trailing `status` survive, the parse rule is a plain `JSON.parse` with no size cap,
  and a `max-tokens` finish **drops the tool call entirely** — a truncated emission cannot be
  dispatched with a partial payload. So the drop was model-side, and the plugin-side
  REQUIRED-parameter contract is the only honest guard.

**Live-call observation (not waved through):** calling `agent_teams_update_task` without
`attempt_id` through *this* member session returned the pre-fix stale message. Cause: the session's
plugin tree was loaded at 07:35:05Z, 48 minutes before `lib/tools.js` was written (08:23:52Z), and
adopted main code is loaded once per process. Fresh loads are correct — see
`drivers/update-task-diagnostics.result.json` (new process) and the mount probe (new boot).
Operational note for t8: sessions started before the write need a restart to see the new wording.

## Permanent tests, not one-off runs

`bun test packages/mpd-agent-teams-plugin` → **106 pass / 0 fail**, 13 files, and it *discovers and
runs* the decisive both-files byte-fidelity test, both per-file byte-fidelity tests, the
colliding-pair/partial-strip fixtures and the DEFECT 5/6 diagnostics tests (see
`bun-test-plugin.log`). `self-fix-tests` alone: 43 pass / 0 fail. The registry is regenerable
byte-for-byte: `--write-registry` twice in a scratch repo produced the committed registry's exact
sha (`registry-determinism.result.json`).

## F3 and the vendor path

* Heal refuses a re-materialized OLD body: exit 1, `refusing to heal delta "mpd-delta scope-glob" …
  declares "pathMatchesScope" … at line 102`, input byte-identical.
* Post-heal validation refuses a duplicate declaration while the region is intact, naming the
  symbol and the outside line(s).
* Control: a plain stripped fixture heals byte-identically, so the refusals are not "always red".
* `scripts/vendor-agent-teams.mjs` in a throw-away repo copy: **exit 1** with
  `[vendor-agent-teams] FAIL: mpd delta guard refused the healed tree …`; the green control run
  exits 0. The real repo was untouched (shas/mtimes unchanged; the log's `<repo>` is the script's
  own placeholder for the sandbox root).

## Mounted boot (no `--dump-config` as load evidence)

Isolated `DSH_HOME` + `HOME` + workspace, `dsh plugin --profile mpd add <repo>` (exit 0) then a
boot with a registration-instrumentation probe row: **14/14** agent-teams tools registered — the
expected list comes from this run's own scan of `lib/tools.js`, not a copied list — 0 apply-crash
signatures, probe reached DONE, the freshly loaded `agent_teams_update_task` marks `status`
required with the REQUIRED wording, `agent_teams_task_contract` REGISTERED, and both isolation
leak counters 0.

## Addendum — the precise DEFECT-6 boundary, re-derived from the persisted streams

Requested after the verdict; the canon (`evidence/wave3/t1-requirements/20260911T081617Z/t1-decision-record.md`)
was checked first: its source output hashes to `5e01b74e…` / 11965 bytes exactly as recorded
(`.mpd/team/mpd-wave-3/team.json#tasks[id=t1].output`) and the canon embeds it verbatim (the file's
own sha is `aa8653d7…` because of its added header). `drivers/raw-fragment-stream-boundary.mjs`
(2/2 PASS) then re-derives the boundary from the raw session logs, not from the record:

| case | record | fragments | chars | sha256[:12] | JSON | top-level keys | missing | byte-identical assembled copies |
|---|---|---|---|---|---|---|---|---|
| t6/Senior Engineer | `assistant/message` seq 1186 | 3866 | 14080 | `c86ea2adeab4` | complete, valid | acceptanceResults, changedPaths, commandsRun, output, task_id, attempt_id | **status** | 3 (`content[2].arguments`, `stream[8].chunk.block.arguments`, `tool/call.arguments`) |
| t10/Reviewer | `assistant/message` seq 1031 | 4153 | 14866 | `9f47aa0efd7c` | complete, valid | acceptanceResults, commandsRun, findings, output, status, task_id, verdict | **attempt_id** | 3 (same three paths) |

So the raw provider fragment stream is byte-identical (exact string equality) to the arguments the
harness dispatched, and the payload is complete-but-shorter — the key was never emitted.
`parseArguments` does not exist anywhere under `packages/mpd-agent-teams-plugin/lib`, `lib/tools.js`
contains 0 `JSON.parse` and no size handling on arguments, and the installed harness parser is a
plain key-lossless `JSON.parse` that drops a max-tokens-truncated call whole. **Boundary: MODEL-SIDE.**

Residual, stated not fixed: a model-side omission of `output`/`changedPaths` is undetectable by the
plugin; the tool description carries the canon's mitigations (REQUIRED `status`, split a large payload
into small calls and end with `{task_id, status, attempt_id[, verdict]}`). The canon's remaining half —
recording that shape in `AGENTS.md` — is still absent (`grep` finds neither the shape nor the
diagnostics there) and belongs to Group F / t8.

## Re-run

```
node evidence/wave3/t5-verify/20260911T083206Z/drivers/strip-heal-both.mjs
node evidence/wave3/t5-verify/20260911T083206Z/drivers/marker-fixtures.mjs
node evidence/wave3/t5-verify/20260911T083206Z/drivers/update-task-diagnostics.mjs
node evidence/wave3/t5-verify/20260911T083206Z/drivers/harness-arg-boundary.mjs
node evidence/wave3/t5-verify/20260911T083206Z/drivers/f3-refusal.mjs
node evidence/wave3/t5-verify/20260911T083206Z/drivers/registry-determinism.mjs
bash evidence/wave3/t5-verify/20260911T083206Z/drivers/vendor-refusal-check.sh
bash evidence/wave3/t5-verify/20260911T083206Z/drivers/check5-mount.sh
node evidence/wave3/t5-verify/20260911T083206Z/drivers/raw-fragment-stream-boundary.mjs   # DEFECT-6 boundary from the persisted streams
node evidence/wave3/t5-verify/20260911T083206Z/drivers/finalize-evidence.mjs   # recompose result.json
```

Note for integration (t8): `lib/mpd-deltas.js`, `scripts/patch-agent-teams-fixes.mjs`,
`self-fix-tests/registry-context-heal.test.mjs`, `self-fix-tests/scope-glob-and-contract.test.mjs`,
`test/task-contract-tool.test.mjs` and `test/update-task-diagnostics.test.mjs` are still
**untracked**; the byte-fidelity guarantee is only permanent once the commit plan stages them.
