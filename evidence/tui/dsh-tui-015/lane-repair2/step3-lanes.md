# STEP 3 (repair2) — the full 8-lane re-run after the skills-writer edits E1a/E1b/E2/E3

Wave `tui-015-adaptation`, single `skills/**` writer. This report supersedes
`q-run/repair/step3-lanes.md` for lane status; that file and the T8 baseline are left byte-intact.

## 1. Edits applied (all in `skills/dsh-qa/**` + `evidence/**`; no `packages/**` byte)

| Edit | File | Symbol / site | sha256 (16) | What changed |
|---|---|---|---|---|
| E1a | `skills/dsh-qa/scripts/tui-team-surface.ts` | `armHost()` → the `steps: TuiStep[]` array | `397953fa52b2815c` | two steps inserted BEFORE `plan-open`: `session-materialized` (`/mpd board`, Enter, 9 s) + `session-materialized-close` (Escape, 3 s) |
| E1b | same file | `armHost()` → `baselineSessions` + the `plan-open` `before` hook | same sha | pre-boot `sandboxSessionIds(root)` snapshot; the reader prefers a session id created since that snapshot (`own ?? liveSessionId(...)`) |
| E1 (import) | same file | `import { … } from "./lib/tui-lane.ts"` | same sha | `sandboxSessionIds` added to the import list |
| E2 | `skills/dsh-qa/scripts/tui-deps-ctrla.ts` | `driveSteps()` → `panelCommand` | `efb20367ac485160` | board-first materializer appended ahead of the `/mpd panel` pair (`board-materialize` + `board-materialize-close`); the stale "DRIVE STAYS AS IT WAS / REVERTED" comment block was replaced, because it became false |
| E3 (lane wording) | `skills/dsh-qa/scripts/tui-admission.ts` | `real()`, beside the `arm3 attribution:` `say(…)` | `601791172273eada` | the corrected CAUSE + the identity differential (`admission loader admitted/refused` counts over both boots' redirected stderr). `arm3 = attributed.length > 0 && handlerBinds.length > 0` is byte-identical — the arm STAYS RED |
| E3 (evidence) | `evidence/tui/dsh-tui-015/q-run/repair/2d-boot-wall.md` | §"The ONE remaining red: arm 3" | `e94593b1ce6681a7` | the false sentence "there is **no `decision-handler` resource kind at all** on 0.15.0" is retracted and replaced by the measured truth (the host DOES wire that shape; the red is OUR registration/attribution gap). Nothing else in the 2d document was touched |

No `VENDOR_LOCK.json` write was made and no git write was made (the wave's single re-pin is the captain's
integration step, per the task).

## 2. Driver and exact commands

Driver: `evidence/tui/dsh-tui-015/lane-repair2/run-lanes-repair2.sh` — `q-run/run-lanes-step3-final.sh`
with the SAME env, SAME lane order, SAME sandbox root (`.mpd/recon/qa/tui-lanes/tui-015`) and the SAME
per-lane command; only `OUT` moved to `lane-repair2/step3/` so the step3-final window stays byte-intact.
Lane commands (verbatim, `step3/commands.txt`):

```
bun skills/dsh-qa/scripts/tui-mount.ts          --sandbox-root .mpd/recon/qa/tui-lanes/tui-015
bun skills/dsh-qa/scripts/tui-deps-ctrla.ts     --sandbox-root .mpd/recon/qa/tui-lanes/tui-015
bun skills/dsh-qa/scripts/tui-panels.ts         --sandbox-root .mpd/recon/qa/tui-lanes/tui-015
bun skills/dsh-qa/scripts/tui-team-surface.ts   --sandbox-root .mpd/recon/qa/tui-lanes/tui-015
bun skills/dsh-qa/scripts/tui-settings-bridge.ts --out evidence/tui/dsh-tui-015/lane-repair2/step3/settings-bridge.evidence.20261014T110507Z
bun skills/dsh-qa/scripts/tui-admission.ts      --sandbox-root .mpd/recon/qa/tui-lanes/tui-015
bun skills/dsh-qa/scripts/tui-distribution.ts   --sandbox-root .mpd/recon/qa/tui-lanes/tui-015
bun skills/dsh-qa/scripts/tui-spec-conformance.ts --sandbox-root .mpd/recon/qa/tui-lanes/tui-015
```

Driver log (`repair2-driver.log`, one line per lane, UTC start + exit + evidence dir):

```
2026-10-14T11:01:23Z exit=0 lane=tui-mount            evidence=…/evidence/tui/lanes/2026-10-14T11-01-23.930Z/
2026-10-14T11:01:41Z exit=0 lane=tui-deps-ctrla       evidence=…/evidence/tui/lanes/2026-10-14T11-01-41.143Z/
2026-10-14T11:02:49Z exit=1 lane=tui-panels           evidence=…/evidence/tui/lanes/2026-10-14T11-02-49.362Z/
2026-10-14T11:04:07Z exit=1 lane=tui-team-surface     evidence=…/evidence/tui/team-surface-verify/2026-10-14T11-04-07.657Z/
2026-10-14T11:05:07Z exit=0 lane=tui-settings-bridge  evidence=…/evidence/mpd-bridge/tui-settings-bridge/20261014T091837Z/  (the lane's real `--out` dir is under lane-repair2/step3/)
2026-10-14T11:05:07Z exit=1 lane=tui-admission        evidence=…/evidence/tui/lanes/2026-10-14T11-05-07.673Z/
2026-10-14T11:07:08Z exit=0 lane=tui-distribution     evidence=<same as admission: the SKIP writes no dir>
2026-10-14T11:07:08Z exit=0 lane=tui-spec-conformance evidence=<same as admission: the SKIP writes no dir>
```

Every lane's host revision settled: `packages/mpd-tui-plugin/dist/index.js`
`sha256 8639a39b2c7c9ace6d4c509825f25c053d4e72b358b02994d1e7c229c6a240b1`, `revisionDelta.changed=false`
on all three lanes that assert it.

## 3. The table against the frozen expectations

| Lane | Frozen expectation after the edits | Observed on this run | exit | Verdict |
|---|---|---|---|---|
| `tui-mount` | PASS | PASS — `ok=true`, `witness=not-materialized`, `isolationOffenders=0`, statusLine/counters/rowComposed true | 0 | **MATCHES** (AC-11 bound declared: `freshSandboxSessions=0`, warm root carries 17) |
| `tui-deps-ctrla` | PASS | **PASS** — `store arm: ok=true id=act1:team`; 3 pane arms `true`; host contact bound to the launched profile copy; negative control red as required (`observed=false`); `revisionDelta=false` | 0 | **MATCHES** (was RED at step3-final — E2 fixed it) |
| `tui-panels` | red with `tuiRenderers` ONLY | FAIL — `tuiStatus/tuiCommandTrees/commands/tuiPanels/tuiScenes/tuiSettingsSections/tuiDialogs` rendered, `tuiRenderers=MISSING`; negative control `ok=false` | 1 | **MATCHES** |
| `tui-team-surface` | red with `H4` ONLY | FAIL — arm2 `H1=true H2=true H3=true H4=false H4b=true H5=true H6=true` → **H4 ONLY** | 1 | **MATCHES** (was H1+H3+H4 at step3-final — E1a/E1b fixed H1/H3) |
| `tui-settings-bridge` | PASS | PASS — `T1..T8` all `ok` | 0 | **MATCHES** |
| `tui-admission` | red on `arm3` ONLY (declared packages gap, keep it red and named) | FAIL — `static=true staticGrants=true arm1=true arm2=true arm3=false arm4=true arm5=true`; arm6 observed `state=compatible flipped=false` | 1 | **MATCHES** (arm3 only, named) |
| `tui-distribution` | declared/expected status | `[mpd-qa] SKIP case=tui-distribution lane=real reason=absent-fixture prereq=vendor/meta-protocols/dsh-distribution …` | 0 | **MATCHES** |
| `tui-spec-conformance` | declared/expected status | `[mpd-qa] SKIP case=tui-spec-conformance lane=real reason=absent-fixture prereq=dsh-ecosystem-spec with conformance/requirements-v0.15.json …` | 0 | **MATCHES** |

**8 of 8 lanes match the frozen expectation table** (step3-final was 5 of 8). No lane deviates.

### The two materializer reds, flipped by measurement

`tui-deps-ctrla` (E2) — the store arm now reads a store THIS boot created, exactly as the triage
handoff predicted from probe arm E:

```
[tui-deps-ctrla] store arm: ok=true id=act1:team
[tui-deps-ctrla] PASS: the host's Ctrl+A stayed INERT (its own dashboard opened) and /mpd panel proved the sidebar registration + accepted open
```
(`result.json.storeArms[0].ok=true`, `id="act1:team"`, missing/forbidden `[]`.)

`tui-team-surface` (E1a/E1b) — the fixture is now keyed to a session THIS run created, H1/H3 flipped
green and only the declared packages-side H4 remains:

```
[tui-team-surface] host: fixture captainSessionId := "ad1979c5-5254-4c2e-9e37-9172a237bc76" (record be98206e6352)
[tui-team-surface] host: staged plan plan-20261014T110307Z for session ad1979c5-5254-4c2e-9e37-9172a237bc76
[tui-team-surface] arm2 H1-host-renders-surface ok — the real host rendered the plan surface for the sandbox record
[tui-team-surface] arm2 H3-host-confirm-step ok — the host rendered the confirmation step and echoed the typed phrase
[tui-team-surface] arm2 H4-real-mutation-via-the-adopted-runtime FAIL — no approval committed: phase="staged" approvedAt=undefined
```

### `tui-admission` — arm3 stays RED, cause now named correctly

```
[tui-admission] arm3 attribution: attributed=0 decisionHandlerBinds(applied)=0 (ledger delta=20)
[tui-admission] arm3 host wiring: `decision-handler` binds are wired by plugin-host.js#subscribeDecision but none fired
[tui-admission] arm3 identity differential: admission loader admitted=61 refused=0 (this boot) vs admitted=0 refused=61 (negctl)
[tui-admission] FAIL: {"static":true,"staticGrants":true,"arm1":true,"arm2":true,"arm3":false,"arm4":true,"arm5":true,"revokedState":"compatible"}
```

The differential is measured, not asserted: the granted boot's redirected stderr carries
`admitted=61 refused=0` and the negctl boot's `admitted=0 refused=61`, so the grant DID bind a Component
identity and the red is OUR registration/attribution gap (candidates (c1)–(c3) in
`triage-reds/REPORT.md` §3), never a missing host shape. The assertion
(`attributed.length > 0 && handlerBinds.length > 0`) is unchanged.

## 4. The guard case — registration on disk + the landed run record (F8)

`node -e` inspection of the working tree (evidence: `guard/self-test-landed.result.json`):

| Fact | Observed |
|---|---|
| `skills/dsh-qa/cases.json` carries the row | **YES** (present at write time; nothing needed to be added) — `{"case":"team-dispatch-guard","script":"skills/dsh-qa/scripts/team-dispatch-guard.ts","suites":["all"],"immutabilityGuard":"required"}`, `lanes.length=46`; sha256 `93eaf2ae…`, mtime `2026-10-14T08:42:06Z` |
| `skills/dsh-qa/SKILL.md` carries its row | **YES** — line 131 of the `\| slug \| domain \| assertion \| phase \|` table; sha256 `bdac438b…` |
| Landed script | `skills/dsh-qa/scripts/team-dispatch-guard.ts`, sha256 `b1ecb33b5bc7b65f2ff83708db89f291a295e9cf2bba987a99f1715e201d1dcf`, mtime `2026-10-14T09:44:51Z` |
| Landed `--self-test` | **PASS, exit 0** — `bun skills/dsh-qa/scripts/team-dispatch-guard.ts --self-test` → `SELF-TEST: PASS (17 arms: 4 C7-1..C7-3 seam assertions + 13 C7-4 arms incl. their negative controls)`; log `guard/self-test-landed.log` (3037 B, sha256 `7cfde843…`) |

The T14 concern (a `cases.json` that PREDATES the landed script) is resolved by DIRECT INSPECTION rather
than by the timestamp proxy: the row is on disk, is inside the `lanes` array, and the registered script
path resolves. The F8 gate's requirement — a run record for the LANDED bytes inside `test:qa` — is met:
`bun run test:qa` executed `team-dispatch-guard.ts` at log line 84 of `test-qa.log`.

## 5. Gates run (command → observed result)

| Command | Observed |
|---|---|
| `bun run test:qa` | `[test:qa] all self-tests passed`, `EXIT=0`; 2 honest SKIPs (`tui-distribution`, `tui-spec-conformance`, both `absent-fixture`); guard case included at line 84 → `lane-repair2/test-qa.log` |
| `bun run typecheck` | `$ tsgo --noEmit`, `EXIT=0` → `lane-repair2/typecheck.log` |
| `bun run verify:comments` | `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.` (401 files, 35506 declarations) → `lane-repair2/comments.log` |
| `bun skills/dsh-qa/scripts/tui-team-surface.ts --self-test` | `ok: fixture, parser, assertion falsifiability and the dist invariants all hold`, exit 0 |
| `bun skills/dsh-qa/scripts/tui-deps-ctrla.ts --self-test` | `ok: 4 legacy + 3 seam-present arms asserted; the arrow, the takeover, the flip, the store pair and the contact controls all fail as required`, exit 0 |
| `bun skills/dsh-qa/scripts/tui-admission.ts --self-test` | `ok: structural rules, pane classification and spec-root resolution are two-sided`, exit 0 |
| `bun skills/dsh-qa/scripts/team-dispatch-guard.ts --self-test` | `SELF-TEST: PASS (17 arms …)`, exit 0 |
| `node scripts/run-qa-lanes.ts --check-drift` | exit 1 — the SAME two PRE-EXISTING unlisted scripts as at step3-final (`delegation-gate.ts`, `model-config-live-refresh.ts`); 48 discovered / 46 listed / 19 outside every suite; `cases.json` `lanes.length=46` → `lane-repair2/check-drift.log` |

All three touched scripts' `--self-test` logs are quoted in `lane-repair2/self-tests.log`.

## 6. Bounds and what remains uncertain

- **`VENDOR_LOCK.json` is NOT re-pinned here.** Every `skills/**` byte above invalidates the corpus
  `treeSha`; the wave's single re-pin is the captain's integration step and was deliberately not run.
- **`tui-admission` arm6 drift (observed, never gated).** This run read the post-revocation re-check as
  `state=compatible flipped=false`; step3-final read `waiting_authorization`. arm6 is declared OPTIONAL
  and the verdict gate is only `state !== undefined`, so the lane verdict is unchanged (arm3 only). It is
  reported because it moved.
- **`tui-admission` arm4 remains a weak witness.** `arm4 = submitPane.includes(DECISION_SUBMIT_TEXT)` is
  satisfied by the lane's own keystrokes and cannot discriminate a live handler from an absent one (the
  triage worker's finding, carried verbatim). It is NOT used to weaken arm3.
- **`tui-team-surface` H4 is a packages-side red, not a lane red.** H1/H3 now pass; H4
  (`the adopted runtime committed the approval`) still fails with `phase="staged"`. That is the remaining
  packages/host question and is outside this task's write scope.
- **`tui-panels` `tuiRenderers` is a packages-side projection gap** (the plugin appends its log-only
  event, proven in the session store, but the host projects no row). Unchanged, named, not silenced.
- **2d evidence scope.** Only the false arm3 CAUSE sentence was corrected, per the task
  ("fix the false CAUSE sentence in the 2d evidence only"). The later §"tui-team-surface … H1/H3 stay red"
  section of that same historical document is now SUPERSEDED by §3 of this report (H1/H3 flipped green);
  it was left untouched on purpose so the historical record keeps its own measurement moment.
