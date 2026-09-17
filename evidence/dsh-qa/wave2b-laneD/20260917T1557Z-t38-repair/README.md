# t38 — LANE D REPAIR, ROUND 2 (R-D-F1..R-D-F4 closed; R-D-F5 found and fixed by the same measurement)

Author: qa-lane-engineer (lane D, the wave's single `skills/**` writer) · attempt `6fa5e099-5b2b-4a52-a22c-10b55593489e` · written 2026-09-17T15:57Z.
Source of the findings: `t24` (review of `t18`), full record `evidence/review/wave2b-laneD/20260917T144844Z-revD/` — that directory is the BEFORE-STATE and is not edited here. The sealed `t18` stamp `evidence/dsh-qa/wave2b-laneD/20260917T143544Z/` is likewise untouched.

## 1 · R-D-F1 (blocker) — the T-69 rewrite named an identifier no file bound

**Defect.** My wave-2b migration of the eleven `dsh --dump-config` call sites wrote `join(REPO, "scripts", "dump-config.mjs")` into five lanes that bind `repoRoot` and never bind `REPO`. The expression is evaluated when the argv array is built, so the lane dies in `main()` with `ReferenceError: REPO is not defined` and the scanners stay green.

**Before-state (t24's own reproduction, not a re-statement):** `evidence/review/wave2b-laneD/20260917T144844Z-revD/REPRODUCTION.md` lists the five lanes, each log under `…/lanes-only/lanes/*.log` carrying the error; t24's ten-lane log reads `FAIL case=mount-assert reason=exit-1` (48 ms) … `FAIL case=bundle-lifecycle reason=exit-1` … `FAIL case=agent-teams-adopt reason=exit-1` … `FAIL case=workmate-library reason=exit-1`.

**Fix.** 7 sites, each switched to the file's OWN root binding (same value: `dirname×4(fileURLToPath(import.meta.url))`):

| file | sites | after |
|---|---|---|
| `skills/dsh-qa/scripts/mount-assert.mjs` | 1 | `join(repoRoot, "scripts", "dump-config.mjs")` |
| `skills/dsh-qa/scripts/agent-teams-adopt.mjs` | 1 | ditto |
| `skills/dsh-qa/scripts/workmate-library.mjs` | 1 | ditto |
| `skills/dsh-qa/scripts/bundle-lifecycle.mjs` | 3 | ditto |
| `skills/dsh-qa/scripts/team-route-rewire.mjs` | 1 | ditto |

Post-fix static reading (arm `T-69.call-site-binding`, live): **288 `join(REPO|repoRoot, …)` call sites in 42 of 54 scanned files, `UNBOUND: none`**. All five files pass `node --check` and their `--self-test` exits 0.

**Calibration note (why the arm's predicate is `join(IDENT, …)` and not "any bare `REPO` token").** A full-identifier scan found SIX apparent offenders; one was a false positive — `agent-teams-sidebar.mjs:633` `repoRoot: ROOT` is an object KEY, not an identifier use. The arm therefore keys on the finding's own predicate (`join(REPO|repoRoot, …)`) plus a per-FILE binding test (declaration / named import clause / function parameter), and its fixture set proves it flags the unbound case while sparing the declared, imported, parameter and prose controls.

## 2 · R-D-F2 (high) — the declared ten-lane selection, run in FULL, with every red classified

Two readings are kept, because the first was taken on a tree that the F5 repair then changed:

| lane | run A `…/20260917T1522Z-t38-lanes10/` (15:06:21Z→15:24:56Z) | run B `…/20260917T1529Z-t38-lanes10b/` (15:29:09Z→15:53:06Z) | classification |
|---|---|---|---|
| wave2b-lane-d | PASS 1.5 s | PASS 1.7 s | green |
| workmate-team-member | PASS 86.7 s | PASS 181.2 s | green |
| session-start-team | UNAVAILABLE `absent-credentials` 858.6 s | FAIL `exit-1` 1010.5 s | see (3) |
| relocate-smoke | PASS 18.0 s | PASS 15.4 s | green |
| bundle-lifecycle | **FAIL `exit-1` 20.5 s** | **PASS 20.9 s** | DEFECT, fixed by F5 — see §5 |
| team-route-rewire | PASS 32.1 s | PASS 36.5 s | green |
| mount-assert | PASS 0.19 s | PASS 0.24 s | green |
| agent-teams-adopt | **FAIL `step:teamState` 26.6 s** | **PASS 93.9 s** | FLAKY class, not this lane's edit — see (2) |
| workmate-library | PASS 31.1 s | PASS 36.3 s | green |
| tui-team-surface | PASS 40.0 s | PASS 40.0 s | green |

Both logs are kept with their case count visible — run B: `grep -cE '^\[mpd-qa:\(only\)\] (PASS|FAIL|UNAVAILABLE)' lanes-only.log` = **10**, and `lanes/result.json` reports `complete:true, lanes:10, exitCode:1`. Each remaining non-green, in its own words:

**(1) `session-start-team` — DEFECT? No: one arm is a STOCHASTIC live-LLM routing assertion; the other reading is a PARTIAL classification (credentials absent).**
· Run B evidence `evidence/dsh-qa/session-start-team/2026-09-17T15-32-12.457Z/result.json`: `twoSided {ok:false, simpleTeams [0,0,0], simpleNotices [false,false,false], complexTeams [0,1,0], complexNotices [true,true,true]}` — and every deterministic step in the SAME run is green: `settled {ok:true, rev ca780331abdaecdef2e35ad7cad643bb69d86d90, gateHash b8a483c176fcbe30…}`, `installer {ok:true,exit:0}`, `patchRow {ok:true}`, **`compose {ok:true,exit:0}`** (the step my migration touches), `negativeControl {ok:true, disarmed:true}`.
· Run A classified it `UNAVAILABLE reason=absent-credentials prereq="provider credential (DEEPSEEK_API_KEY / deepseek-official route)" signature=evidence/dsh-qa/session-start-team/2026-09-17T15-07-49.439Z/output.log:598` — the runner's own prerequisite class, not a defect.
· Census across runs (complex-side team vector): `2026-09-17T01-39-23.411Z [1,1,1]` GREEN · `04-38-14.171Z [1,0,0]` red · `04-56-06.842Z [0,0,1]` red · `14-43-43.007Z [1,0,1]` red · `14-47-32.307Z [0,0,1]` red · `15-32-12.457Z [0,1,0]` red. Three reds PREDATE this lane's diff; the failing CELL moves every run; the notice always fires. I did NOT loosen the assertion (that would be a semantics change) and I did not re-attempt it here.

**(2) `agent-teams-adopt` run A `step:teamState` — DEFECT? No: flaky class, and the lane's own history shows it.**
Run A's failing steps (`teamState`, `archive`, `taskTerminal`) are NOT the step my edit touches (`compose {ok:true}` in that same run). Run B passes the same lane with no change to those steps. Stamp history of `evidence/plan-c/c1-team/`: `2026-09-17T02-14-56.955Z ok=false (teamState, archive)` · `04-49-06.038Z ok=false (archive)` · `05-30-02.318Z ok=true` · `15-23-18.736Z ok=false (teamState, archive, taskTerminal)` · `15-50-16.072Z ok=true`. Green and red alternate with the same code, including a green in wave 2a.

**(3) The five lanes that used to CRASH now RUN.** `mount-assert`, `agent-teams-adopt`, `workmate-library`, `bundle-lifecycle`, `team-route-rewire` all report a verdict instead of `ReferenceError` — this is the executed leg of F3 (their rewritten call sites are reached in `main()`), and `bundle-lifecycle`'s two dump-consuming steps flip `false→true` in §5.

## 3 · R-D-F3 (medium) — the rewrite is now falsifiable, on the fixture AND on the real corpus

Two new arms in `skills/dsh-qa/scripts/wave2b-lane-d.mjs` (its live run: `evidence/dsh-qa/wave2b-laneD/20260917T1535Z-t38-final/result.json`, **PASS 8 arms / 0 failed**):

· **`T-69.call-site-binding`** — the static check the finding asks for: 288 call sites in 42/54 files, each required to resolve to a binding in its own file; `UNBOUND: none`. Falsifiable by construction, and PROVEN on the real corpus: I re-introduced `join(REPO, …)` into `mount-assert.mjs`, the arm went RED naming `skills/dsh-qa/scripts/mount-assert.mjs:49 \`REPO\`` (`evidence/dsh-qa/wave2b-laneD/20260917T1520Z-t38-falsifier/result.json`, copied here as `falsifier-mutated-corpus.json`), and the file was restored BYTE-IDENTICALLY (sha256 `f29a6f4179f24d2fc0cc0b70125a8d6ddb4ee13403c843ee78a4c01530c5a577` before and after).
· **`T-69.json-stream`** — pins the wrapper's stream contract that §5's defect violated: stdout alone is the JSON envelope, the banner rides on stderr, the child's tree is reachable ONLY through the envelope's `stdout` field, and a MERGED capture does NOT parse. Live leg + a `--bin` fixture child leg (offline-deterministic): `stdout is the JSON envelope=true, banner on stderr=true, banner on stdout=false, MERGED capture parses=false`.
· `--self-test` fixtures for both arms; the banner total is now DERIVED from the checks that ran (`8/8 arms`) instead of the stale hardcoded `7` — see §6.

## 4 · R-D-F4 (low) — the excluded lock lane is NAMED here

**The lane kept OUT of every `--only` selection is `agent-teams-messaging`** (`skills/dsh-qa/scripts/agent-teams-messaging.mjs`). Reason, one line: **its arm (c) recomputes `VENDOR_LOCK.json`'s `skills` treeSha from the working tree, so it cannot be green until the captain's single re-pin lands in the same commit as this corpus change** — asserted at `skills/dsh-qa/scripts/agent-teams-messaging.mjs:329-335` (`// (c) VENDOR_LOCK's \`skills\` asset must recompute from the working tree` → `fail("VENDOR_LOCK skills asset is stale: …")`). For the same reason `bun run test:qa` is not in this task's verify.

## 5 · R-D-F5 (my own finding from the F2 measurement) — the wrapper's stream contract, violated in six files

**Defect.** The wrapper prints the JSON envelope on STDOUT and its banner on STDERR (by design, so `--json` stays parseable). Six of the lanes I migrated captured the child through a helper that returns `stdout + stderr` MERGED, and then either parsed that merged buffer or asserted against it. `JSON.parse(merged)` fails on the banner, the parse falls back to the ESCAPED envelope text, and a predicate containing a `"`-quoted fragment silently goes FALSE — no error, no marker. This is what made `bundle-lifecycle`'s `composed` and `layerDurability` red (`'"/node_modules/@mpd-dsh/mpd/presets"'` can never appear unescaped inside a JSON string), and it made `mount-assert` write the envelope where the composed dump belongs.

**Not the wrapper's fault, measured:** in a sandbox with an installed profile, `node scripts/dump-config.mjs --profile w --json` → `JSON.parse(stdout).stdout` is **byte-identical** to the raw `dsh --profile w --dump-config` output (29,379 bytes, `identical: True`), and that text carries `id: agent-presets`, `default: mpd` and the quoted presets root. Probe kept: `evidence/dsh-qa/wave2b-laneD/20260917T1522Z-t38-lanes10/t69probe/`.

**Fix (6 files, every dump-config consumer now reads the child text out of the STDOUT field):** `mount-assert.mjs` (assertion + `dump.txt` now carry the composed text), `bundle-lifecycle.mjs` (helper returns `stdout`; `composed`, `layerDurability`, `uninstall` all read the parsed text), `workmate-library.mjs` (all three predicates read `dumpText`; the evidence log now records the asserted text beside the raw capture), `agent-teams-adopt.mjs`, `team-route-rewire.mjs`, `session-start-team.mjs`. `relocate-smoke.mjs` and `lib/tui-lane.mjs` already captured stdout separately and needed no change.

**Proof of the fix (same two steps, same lane, only the tree changed):** `composed {ok:false}` + `layerDurability {ok:false}` in run A → `composed {ok:true}` + `layerDurability {ok:true}` in run B (`evidence/dsh-qa/bundle-lifecycle/2026-09-17T15-49-18.388Z/result.json`, overall `ok:true`), with `install`, `boot`, `noHomeCopy` and `uninstall` green in both.

**Doctrine recorded where a lane author reads it:** `skills/dsh-qa/SKILL.md` rule 7 gained both follow-on rules (the binding rule and the stream rule) with the measured instances named.

## 6 · DISCLOSURES (recorded, not smoothed)

1. **The self-test banner was lying.** It printed `(7 - failures.length)/7 arms` while SIX checks ran. It now DERIVES the total from the checks that executed → `8/8 arms` with the new arm. A reader who had trusted `7/7` was reading one check more than existed.
2. **Two F2 runs, and the first is not the reading.** Run A was taken before the F5 repair; the final reading is run B (both are kept, and both are named above with their stamps).
3. **Directory labels ≠ run start.** `20260917T1522Z-t38-lanes10` started at `15:06:21Z` (the label was written before the run); `20260917T1529Z-t38-lanes10b` started `15:29:09Z` (label matches to the minute).
4. **The binding arm's own file contributes in-string fixture sites** (`fixture-unbound.mjs` etc. are string literals inside `wave2b-lane-d.mjs`, which itself binds `REPO`). They are counted as bound sites in the scan. That cannot mask an offender: the binding test is per FILE, so any file lacking the binding is flagged whether the hit is code or string.
5. **`t18`'s ordering slip stands** (the `--only` set was declared after the first edit, not before) — disclosed there and unchanged here.
6. **Residual uncertainty.** `session-start-team`'s stochastic arm is CLASSIFIED, not fixed; the mechanism behind its live-LLM routing variance is not established, and no N-of-M bound was written into the lane (that would be a semantics change for the captain to route). `agent-teams-adopt`'s flake class is likewise classified by stamp history, not root-caused.

## 7 · VERIFY AND THE RE-PIN REQUEST

· `node scripts/run-qa-lanes.mjs --check-drift` → **exit 0** (`46 lane script(s) discovered, 46 listed, 0 unlisted, 19 outside every suite`; immutability `required=10 … exempt=36`) — full output in `check-drift.log`.
· Driver self-test → **exit 0**, `8/8 arms` (`selftest.log`). The six touched lanes' own `--self-test` → exit 0 each. Driver lane → **PASS 8 arms** (`evidence/dsh-qa/wave2b-laneD/20260917T1535Z-t38-final/result.json`).
· **RE-PIN (the captain's single write, same commit) — RE-DERIVED AFTER all of the above, 2026-09-17T15:54:07Z (`repin-preview.log` in this directory):**

```
locked     :  b9097d115ae0742828744d9a305c145fe2efeaef11d6a4e641bf666687102620 / 323
computed   :  5fbe9dbcd5c52c50a0148f9b2c14b07e6210f4b710e4d7060aeee94a8887b71a / 324   (1 file LF-normalized)
raw-bytes  :  26ec1af28bb29eee4b1b5b4b6282d0baf4f24c4776bc4a0c2f4b1a7db9dd41cc   <- NEVER write this one
```

`node scripts/repin-vendor.mjs --check` → **exit 1** (pre-write, lock byte-unchanged). **SUPERSEDED VALUES, named as superseded:** `234010aeb8e359a0f61b701b616d091edc7ea54acd999413716cefc001fd8c70`/324 (t18's request, valid until this repair's first edit) → this one. `2c748d482fd8bb9d…`/`fb0d4ce35f75c18b…` and `7aef5fd2b8c5…`/`8ea212eb…` are earlier supersessions. The other treeSha asset (`packages/mpd-agent-teams-plugin/_deps`, `d1d10603…`/635) is in sync → exactly ONE asset moves. Cause predicate: files under `skills/**` changed BY THIS TASK = 8 (the five F1 lanes + `session-start-team.mjs` + `wave2b-lane-d.mjs` + `SKILL.md`); all 8 were already inside t18's 14-file set, so the WAVE union stays **14 distinct = 13 modified + 1 untracked, all corpus, 0 non-corpus**.

## 8 · NOT DONE (deliberately)

No git command beyond read-only `status`/`diff`; no `VENDOR_LOCK.json` write (the captain's hand); no weakening or deletion of any assertion; no `bun run test:qa` (the lock lane); no fix of `session-start-team`'s stochastic arm or of `agent-teams-adopt`'s flake class.
