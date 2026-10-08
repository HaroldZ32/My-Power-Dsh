# T4 — INDEPENDENT VERDICT on the Docker TUI lane repair

**VERDICT: FAIL** — one finding, and it is an EVIDENCE gap, not an observed product defect: the four
repaired rows and the new arm are green on my own independent run, but requirement 4's stated
deliverable — the corrected record of a **RED** run — does not exist anywhere in the wave's evidence,
so acceptance condition (iii) is UNVERIFIED. Details in §5.

- **Seat:** Deep Worker, session `5ffe06cc-bb99-41af-9bfc-f71d097dd7ac` (team member M2, "legacy-fix-wave").
- **Loop:** `loop-20261008T115240-db7ee8`, frozen contract `.mpd/plans/repair-r-docker-tui-fixture.md`.
- **Board task:** T4. **Writer (different agent):** Senior Engineer, session `169cdd69-c099-4327-ae3e-e9803dc4e8e1`.
- **Blindness:** `docker/tui-lane.sh` was never read before this verdict (no `read`/`grep`/`glob` on it,
  and not through the shell either). Declared bound, stated rather than implied: the gate's OWN
  reporting library `docker/lib/report.ts` and driver `scripts/docker-e2e.ts` were inspected through the
  shell to interpret the `complete` field (§3) — they are not the artifact under verification.
- **Evidence written before this verdict:** `pre-state.md`, `pre-state-addendum.md` (same tree, sibling
  stamps), this file, and the raw driver output beside it.

## 1. The frozen revision (hash sandwich)

| Moment (UTC) | `docker/tui-lane.sh` sha256 | How measured |
|---|---|---|
| 2026-10-08T11:50:42Z | `57b1fc29…79347fc6` | pre-writer state, before T3's fix |
| 2026-10-08T12:05:19Z | `226cdb1c84b9eff09a3260aa9aec33abe40bacb87358c833dcb5db9557094b00` | my own read, immediately before my run |
| 2026-10-08T12:11:18Z | `226cdb1c…7094b00` | re-read after my run — UNCHANGED |
| 2026-10-08T12:14:03Z | `226cdb1c…7094b00`, 87598 bytes, mtime 11:55:40.295Z | content-free probe `ev-20261008T121403-c03529` |

The frozen value matches the captain's GO value exactly. Nothing wrote the artifact after the freeze.

## 2. My own independent run (the point of this seat)

Command: `node scripts/docker-e2e.ts --mode source --require-docker` (rootless Docker 29.8.2).
Launched as a managed background job (harness job `bash-407`), stdio to a FILE — never a pipe:
`evidence/docker/tui-lane-verify/2026-10-08T12-06Z/lane.log`.

Driver summary, VERBATIM from `driver.json` (`evidence/docker/client-install/2026-10-08T12-05-34Z/`):

```
"verdict": "ok=true complete=false passed=66 failed=0 null=30 NULL=[tui.mergedPanelOpens,tui.mergedPanelOrder,live.credentialStaged,…,boot.llmTurn]",
"containerExit": 0,
"exitCode": 0,
"unmeasured": []
```

```
summary: {"total": 96, "passed": 66, "failed": 0, "null": 30}   failedNames: []
total == passed + failed + null  ->  true
durationSeconds 300 · stamp 2026-10-08T12:05:34Z … 12:10:40Z
```

`hashes` IS present: 28 entries (the container's OWN rebuilt `/opt/mpd` tree and `packages/*/dist`
entries). My list agrees with the writer's run on 27 of 28 entries; the single difference is
`packages/mpd-tui-plugin/dist/index.js` — see the bound in §6.3.

An independent sanity check on that hash list: it does NOT contain the artifact under test, so it
neither corroborates nor replaces the hash sandwich in §1.

## 3. Q1 — what `ok=true complete=false` means (answered from the driver's own code, not inference)

- `docker/lib/report.ts` computes both flags from the assertion list:
  ``lines.push(`ok=${failed.length === 0}`)`` and ``lines.push(`complete=${nulls.length === 0}`)``, and
  the JSON mirrors those (`ok: failed.length === 0`, `complete: nulls.length === 0`).
- `scripts/docker-e2e.ts` declares the field in its own words: *"True when every assertion was
  evaluated"*, and *"Overall verdict; the process exit code is derived from it"* — and `decideExit`
  derives the exit code from `ok` alone.
- Required-arm gaps are a SEPARATE channel: `requiredPrefixes` (`["ui."]` on this run, since
  `liveRequested=false`) feeds `unmeasuredRequired(...)`, and `driver.json` reports `"unmeasured": []`.

**So `complete=false` is EXPECTED and honest here, not a mask:** it states "30 assertions were not
evaluated", and those 30 are exactly the two declared classes (§4). No required arm is missing
(`unmeasured=[]`), no assertion failed, and the same pair was already present on the pre-repair
baseline run (`ok=false complete=false`), so it is not an artifact of this repair.

## 4. Q2 — the 30 nulls decompose exactly as the amendment requires

Measured from MY run's `summary.nullNames` (30 names):

- **credential-gated — 28**: 27 names prefixed `live.` **plus `boot.llmTurn`**. 23 of the 27 name the
  credential/live gate literally (e.g. `live.web.turnStarted`: *"not attempted: a live turn needs
  MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free
  maximum"*); the remaining 4 (`live.credentialRemoved`, `live.teamRecord`, `live.nativeExecutor`,
  `live.headlessPresetRow`) are downstream of that same unrun live turn (*"no live turn ran, so no
  approval could materialise a record"*), and `boot.llmTurn` reads *"a live LLM turn needs provider
  credentials and this container stages none (AGENTS.md §10)"*.
- **host observability — 2**: `tui.mergedPanelOpens`, `tui.mergedPanelOrder`, each citing the 0.13.0
  panel seam (*"not pane-observable on this host … a host-ACCEPTED open() changes zero bytes of a tmux
  capture"*).

No null is counted as a pass, and the two classes are not collapsed. Arithmetic holds
(`66 + 0 + 30 = 96`), and `failedNames` is empty.

## 5. The four acceptance conditions, judged from the contract

| # | Condition | Result |
|---|---|---|
| i | the four previously-failing rows are no longer in `failedNames` | **PASS** (quoted in §5.1) |
| ii | the requirement-3 arm exists by name, asserts BOTH directions | **PASS** (quoted in §5.2) |
| iii | `tui.laneExit` no longer reports a FALSE abort for an ordinary **red** exit | **NOT VERIFIED — the finding (§5.4)** |
| iv | every non-credential-gated assertion is PASS; nulls attributed by class | **PASS** (§4, and `failed=0`) |

### 5.1 The four repaired rows, verbatim from MY run's `result.json`

```
tui.teamSceneOpened      ok=true  raw=chars=11738
tui.teamGraphDrawn       ok=true  raw=corners=╭3 ╮3 ╰3 ╯3 tasksFromRecord=3 ids=T1,T2,T3 pane=pane-team.txt
tui.teamGraphContent     ok=true  raw=ids=T1,T2,T3 fromRecord=3 labelsExpected=3 missing=[none] pane=pane-team.txt
                                      chars=11738 pinnedFocus=T1 detail=[T1 · requirement · freeze the contract] pinnedPane=pane-teamPinned.txt
tui.laneExit             ok=true  raw=records=21   (reason: "the TUI lane ran to completion with every assertion green")
```

Cross-checked black-box against the captured pane itself, not against the row's own claim:
`pane-team.txt` carries the three node labels and the rounded-corner census is 3/3/3/3.

### 5.2 The requirement-3 arm, verbatim from MY run (`tui.teamSceneOtherSessionInvisible = true`)

```
otherSession=session-23d4274d-52f5-4f5e-8592-6ee50f0be3bc liveSession=0991fe94-468f-41de-9723-fab323919d4d
otherKey=session-23d4274d-52f5-4f5e-8592-6ee50f0be3bc index={"session-23d4274d-52f5-4f5e-8592-6ee50f0be3bc":"tui-scene"}
marker=[no team in this session] markerSite=packages/mpd-tui-plugin/src/team-state.ts#NO_SESSION_TEAM_MARKER
assertedAbsent=[T1,T2,T3] foundDrawn=[none] corners=0 pane=pane-teamOtherSession.txt
```

- **PRESENT, as a SUBSTRING** — I verified the pane directly, `pane-teamOtherSession.txt:4`:
  `│ no team in this session — stage one with agent_teams_plan, then approve it │`. The marker is a
  substring of a longer line, so the amendment's warning that equality would redden a correct product
  is confirmed on the artifact.
- **ABSENT** — my own scan of that pane for `T1|T2|T3` as node labels found NOTHING, matching
  `foundDrawn=[none]` and `corners=0`. The pane also carries the product's own honest line
  `this workspace holds 1 team(s), none bound to this session`.
- **NON-VACUOUS (Q3)** — `otherSession=session-23d4274d…` is a REAL sibling, distinct from
  `liveSession=0991fe94…`; the index carried the sibling's binding to the seeded board; and the row
  records the 3 ids it asserted absent. Independently corroborated by the OTHER new row's raw, which
  shows both bindings at once:
  `active={"session-23d4274d…":"tui-scene","0991fe94…":"tui-scene"}` and
  `resolve=store=/root/sandbox-dsh/sessions;before=2;after=3`. So this green is not the empty-instrument
  false pass the clause exists to prevent.

### 5.4 FINDING F1 — requirement 4's red-run deliverable is absent (condition (iii) unverified)

- **id:** F1 · **severity:** medium (blocks acceptance; no product defect observed)
- **symptom:** the wave's ONLY runs at the frozen hash are green. Mine:
  `ok=true complete=false passed=66 failed=0 null=30`. The writer's:
  `evidence/docker/client-install/2026-10-08T11-56-41Z/` — same pair (`failed=0`). In a green run the
  EXIT net's guard never fires at all, so "no abort claim appears" is TRUE of the broken lane too and
  cannot distinguish it from the repaired one. The writer's own report offers exactly that vacuous
  reading for requirement 4 (`grep -c 'abort=exit-' console.log → 0` on a green run, plus prose about
  the mechanism), and the wave's evidence band contains no red run of the repaired lane
  (`evidence/docker/tui-lane-repair/2026-10-08T11-58-00Z/` holds one `result.json`: the green run).
- **expected:** the contract's own deliverable — *"The deliverable is the corrected record for a red
  run, quoted from a real run's `console.log` and `result.json` — never a reading of the lane's
  source."* Concretely: a REAL red run (e.g. the pre-repair defect state, fixture unbound, which made
  the four rows red on the 08:52 baseline) whose `console.log`/`result.json` show the lane's terminal
  record and NO `abort=… net=EXIT-trap` claim — the direct comparison against the baseline, which shows
  both (`abort=exit-1 net=EXIT-trap`).
- **doc_source:** `.mpd/plans/repair-r-docker-tui-fixture-amendment.md` §2 "Replace requirement 4 with",
  final paragraph (the deliverable sentence); with `.mpd/plans/repair-r-docker-tui-fixture.md`
  requirement 4 (unchanged in force) and this card's condition (iii).
- **why this is not a "fix nothing" finding:** the repair is an EVIDENCE task, not a code change — run
  the lane red once and ship its artifacts. Until then, no reader (and no commit body) may claim
  requirement 4 is demonstrated.

## 6. What I could NOT verify (explicit list)

1. **Condition (iii) itself** — no red run exists (§5.4). This is the FAIL.
2. **The 28 credential-gated arms** — no credential is staged (AGENTS.md §10); their null reading is
   the credential-free maximum, not a pass. (Expected, not a defect.)
3. **The genuine-abort branch** (`set -u` / ERR trap) — a green run cannot exercise it; its protection
   is asserted by the writer's prose, which is not evidence I may use.
4. **Tree motion during the run (declared bound).** A CONCURRENT team
   (`team-20261008115931`, T1 "…DAG legend tautology…", completed ~12:03Z) edited
   `packages/mpd-tui-plugin/src/{panel-core,dag-theme}.ts` at 12:03:03Z/12:03:31Z and rebuilt that
   package's `dist` at 12:05:57Z — i.e. BETWEEN the writer's run (11:56:41Z) and mine (12:05:34Z). That
   is exactly why the two runs' `hashes` agree on 27/28 entries and differ on
   `packages/mpd-tui-plugin/dist/index.js`. My verdict is scoped to MY run's stamp on the frozen lane
   hash; `docker/tui-lane.sh` itself never moved (§1).
5. **The loop's frozen contract hashes only the plan** (`.mpd/plans/repair-r-docker-tui-fixture.md`).
   The authoritatively amended text (`.mpd/plans/repair-r-docker-tui-fixture-amendment.md`) and its
   review are therefore cited in `sources[]`, not hashed into `basis.frozenContract` — declared, not
   hidden.

## 7. The shipped gates this wave could redden (run by me, on MY loop)

| gate | command | exit | evidence id |
|---|---|---|---|
| gates | `bun run verify:gates` | 0 (8/8 member gates) | `ev-20261008T121216-8cdfe8` |
| vendor | `node scripts/verify-vendor.ts` | 0 | `ev-20261008T121225-3833e0` |
| manifest | `bun run verify:manifest` | 0 | `ev-20261008T121225-d07079` |
| comments | `bun run verify:comments` | 0 | `ev-20261008T121227-a8cea4` |
| docs | `bun run verify:docs` | 0 | `ev-20261008T121229-1a144f` |
| rows | `bun run verify:rows` | 0 | `ev-20261008T121229-706828` |
| dist | `node scripts/verify-dist-fresh.ts` | 0 — "30/30 targets fresh (each rebuilt twice, byte-identical)", toolchain bun 1.4.0 | `ev-20261008T121231-989784` |
| tests | `bun test packages` | 0 — 1707 pass, 3 skip, 0 fail, 1710 tests / 105 files | `ev-20261008T121234-31e97d` |
| typecheck | `bun run typecheck` (`tsgo --noEmit`) | 0 | `ev-20261008T121255-8e1a6e` |

**The `vendor/mcp-src` question the captain asked:** BEFORE my run `find vendor/mcp-src -type f | wc -l`
= **459**; AFTER my run = **459**. My run created no artifact there (consistent with
`docker/docker-compose.yml`, which binds only `${MPD_DOCKER_OUT}` — no repository bind).

## 8. Bottom line

The lane repair does what requirements 1, 2, 3 and 5 ask, on an independent run at the frozen hash:
the four red rows are green, the new arm is green and non-vacuous, the null classes decompose exactly
as the amendment requires, and every static gate is green. Requirement 4 — the one whose whole subject
is the RED path — is unproven, because its contract deliverable (a red run's record) does not exist.
**FAIL, one finding, repair = one red run's artifacts.**
