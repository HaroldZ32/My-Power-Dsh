# t17 repair report — the gate case now attributes team records (plugin vs model)

- Task: `t17` repair (owner `qa-engineer`), attempt `1`, attempt_id
  `3c316942-5ff7-4bb2-a63b-a582ded9bc96`
- Trigger: t2 verification finding F1 (high, case design): the soft-complex arm asserted
  `stagedTotal === 0`, which cannot distinguish PLUGIN provisioning from MODEL staging. In the
  verifier's run the plugin behaved exactly per clause 4 while the live model followed the advisory
  notice and staged a team itself → a FALSE FAILURE (staging after the notice is the designed
  behaviour the notice invites).
- Revision of the measured runs: `5aa222a144e4238b67453731c5decd806db6db94`, `session-start.js`
  sha256 `4888f69fad5c746432e4f57f0bb62b65da53f4d6dca082f256678ccb9fdbafc8` unchanged across the
  50 s settle window in both runs.

## 1. What changed

`skills/dsh-qa/scripts/session-start-team.mjs` (the wave's only `skills/**` writer, unchanged rule):

- **`attributeOrigin({record, createCall, sessionIdMatch})`** — new, pure. `plugin` when the record
  carries the plugin's own auto-route description (`Auto-routed by the complexity gate…`, the
  `provisionSessionTeam` default) AND belongs to the session whose log was read; `model` when that
  session's own log records an `agent_teams_create` tool call; `unknown` otherwise. The record's own
  description outranks a stray call, so a plugin record is never mis-attributed.
- **`captainSessionEvidence(dshHome, ws, sessionId)`** — new. Resolves the CAPTAIN session's own log
  under `sessions/<projectKey(ws)>/<sessionId>/`, falls back to the newest log, and records which one
  it used (`session-id` / `newest` / `none`).
- **`evaluateSide({expect, entries, notice, attributions})`** — new, pure; the three arms:
  - `advise` (the clause-4 property, PLUGIN-side): `provisioned === 0`, `advisory === 1`, the fired
    signals named, and every record's origin MUST be `model` — a `plugin` or `unknown` record fails.
  - `none`: no record (active or archived) and no notice.
  - `provision`: exactly one record (active + archived), provisioning notice present, advisory absent,
    `phase === "staged"`, profile `mpd`, and its origin MUST be `plugin` (the explicit request must be
    honored by the plugin, not by the model).
- Each side's row now carries `attributions[]` (slot, id, phase, description, captainSessionId, log
  resolution, create/archive call ids, origin, reasons) plus `modelStaged` / `pluginStaged` /
  `unattributed`; `steps.threeWay` surfaces the counts.
- The module is now guarded on being the ENTRY module, so an evidence replay can import the helpers
  without firing a case run.
- `--self-test` keeps the same prompt arrays + `none/advise/provision` mapping + policy-disabled
  control and ADDS fixture controls for the new predicates, both ways: plugin-description+match ⇒
  `plugin`; create-call ⇒ `model`; no signal ⇒ `unknown`; plugin-description from another session ⇒
  `unknown`; and `evaluateSide` accepts a model-staged advisory side while failing a plugin-staged one,
  an unattributable one, a provisioning notice on the advisory path, two advisory notices, a missing
  signal list, any record on the simple side, a model-staged explicit side, and two explicit records.

## 2. Live proof that the false failure is gone

Two full live runs on the same revision, evidence-redirected into this task's scope:

| run | soft-complex #1 | origin | explicit | origin |
|---|---|---|---|---|
| `…/session-start-team-2026-09-18T01-53-05.513Z` | 0 records, `advisory=1`, `provisioned=0`, signals `["C"]` | — | 1 record, **archived by the model** (`agent_teams_delete`) | `plugin` (0 create calls) |
| `…/session-start-team-2026-09-18T01-59-43.697Z` | **1 record `upstream-routing-align` (8 members), model-staged**, `advisory=1`, `provisioned=0`, signals `["C"]` | `model` (1 `agent_teams_create` call in that session's own log) | 1 record (active) | `plugin` |

Both runs: `ok=true` (`threeWay.ok=true`, `negativeControl.ok=true`, all isolation steps green). Run B
is the previously-failing situation reproduced live — under the old assertion it was a false red; the
repaired arm passes it while run A (no record) also passes, so the verdict is invariant under the
model's behaviour. `softPluginStaged = 0` in both runs, and the explicit arm reports
`pluginStaged = 1` in both (the plugin really provisioned).

## 3. Independent replay against the VERIFIER's own artifact (real ground truth)

`replay/soft-origin-replay.mjs` (+ `replay/replay.result.json`) drives the repaired predicates against
the verifier run's real state — no synthetic fixture:

- source: `evidence/ulw/l6-verification/20260918T012345Z/session-start-team-2026-09-18T01-29-15.614Z/sides/soft-complex/0/`
- its store key equals `projectKey("/tmp/mpd-sst-6rkYoY/side/soft-complex/0/ws")` (asserted), the log
  resolves by `session-id` (268 records / 149 frames), and the record
  `upstream-routing-align` (model-written description, `captainSessionId` matching) attributes to
  **`model`** with 1 recorded `agent_teams_create` call;
- `evaluateSide({expect:"advise", …})` → **ok:true** on that state (the false failure is gone);
- counterfactuals still RED: the same record with the plugin's description and no create call ⇒
  `plugin` ⇒ fails; the same record with a foreign `captainSessionId` and no call ⇒ `unknown` ⇒ fails.

Replay result: `ok=true, origin=model, createCalls=1, repaired-verdict.ok=true`.

## 4. Commands run

| Command | Result |
|---|---|
| `node skills/dsh-qa/scripts/session-start-team.mjs --self-test` | exit 0 — gate + notices + patch + installer + persona + three-way prompt directions + always-advise control + the new attribution/evaluator fixtures |
| `node skills/dsh-qa/scripts/session-start-team.mjs` (live, run A) | exit 0 — PASS (`…/session-start-team-2026-09-18T01-53-05.513Z`) |
| `node skills/dsh-qa/scripts/session-start-team.mjs` (live, run B — the model staged on the soft side) | exit 0 — PASS (`…/session-start-team-2026-09-18T01-59-43.697Z`) |
| `node evidence/ulw/l5b-case-origin/replay/soft-origin-replay.mjs` | exit 0 — origin=model, repaired verdict ok, counterfactuals red |
| `node skills/dsh-qa/scripts/lib/gate-probe.mjs` / `lib/ulw-command-probe.mjs --self-test` / `ulw-command.mjs --self-test` | exit 0 each (regression guards for the sibling lane) |
| per-script `bun run test:qa` sweep (`test-qa.per-script.log`) | **48/49 exit 0**; the only red is the known `agent-teams-messaging.mjs` VENDOR_LOCK pairing case (`lock=324/2c039e4c49b9`, the wave's single re-pin is the captain's step) — **no NEW red**. The official `bun run test:qa` stops at that same case: `TESTQA_EXIT=1`. |

## 5. Evidence map (this task's scope)

    evidence/ulw/l5b-case-origin/
    ├── REPORT.md                                   (this file)
    ├── replay/soft-origin-replay.mjs               (verifier-artifact replay)
    ├── replay/replay.result.json
    ├── session-start-team-2026-09-18T01-53-05.513Z/ (live run A: result.json, output.log, sides/**)
    ├── session-start-team-2026-09-18T01-59-43.697Z/ (live run B: the model staged → still PASS)
    └── test-qa.per-script.log                      (official aggregate + per-script sweep)

## 6. Settled hashes (measured after the last edit)

    c6dc9cb495ab4b8857a1b39f774c3de89d9d8e65d24394efa7937ddf9e824a79  skills/dsh-qa/scripts/session-start-team.mjs
    cbcada9194c62df32828a5647ceb31a81fc2f24eee5fc42a7fa22fbc90693ea1  skills/dsh-qa/SKILL.md

`session-start-team.mjs` was byte-identical for both live runs (its hash did not move between them);
the only edits after them were documentation lines in `skills/dsh-qa/SKILL.md`, which the case does not
read. No `git` write, no `VENDOR_LOCK.json`, no `docs/**`, no `AGENTS.md`, no `packages/**`, no `dist/**`.
