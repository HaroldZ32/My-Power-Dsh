# docker2 — the 16c-owed-cases step budget made honest for the non-linked closure install

Wave `fix/coderabbit-pr42`, docker lane, items (1)–(4). Let me (Senior Engineer) own the edit, the check
and the evidence for **`docker/entrypoint.sh` only**.

- Measured at **2026-10-15T05:13:25Z**; HEAD `006dff6e97d2912e4cd6b8b49b9497ef0ab3335e`, branch `fix/coderabbit-pr42`.
- `docker/entrypoint.sh` sha256 **`8457a5f985b9b722d4fc59916e62dfb0fee17d766550198b1beb2f00cec090b0`** (read again
  after the control ran: identical, so the control read the bytes that are on disk now).
- Pre-edit sha256 of the same file: `fc594126555442241dfd344f4385493cf7fba62da8b4591fd989515fceb80717`.
- No git writes. No `packages/**` or `skills/**` bytes (skills are read only, as a cited source).

---

## 1. The two values, and the ordering rule

| | value | where it comes from |
|---|---|---|
| the step's budget BEFORE | **900 s** | `docker/entrypoint.sh`: `STEP_TIMEOUT="${MPD_E2E_STEP_TIMEOUT:-900}"`, i.e. 16c carried **no explicit budget** and inherited the global default. Its own log line said `(timeout 900s)` |
| the case's own npm budget | **1800 s** | `skills/dsh-qa/scripts/mcp-call.ts`, `const INSTALL_TIMEOUT_MS = 1800000` (sha256 `b242f6645062ee926c602fddb32116537eef999a3971e90f19ccda04e55676d3`), the `timeout:` of the staged `npm install --prefix <profile> --install-links --no-audit --no-fund` |
| the step's budget AFTER | **3600 s** | `OWED_CASES_TIMEOUT=3600` in the 16c block, applied as a FLOOR (`if [ "$STEP_TIMEOUT" -lt … ]`) |

**Why that ordering is the right one:** the step and the case are two nested budgets, and the OUTER one
must not be the smaller. At 900 s the step's SIGTERM (recorded as exit 124) decided the verdict at half of
the case's own ceiling, so the case's measured-justified 1800 s budget could never be reached and the
inner knob was decoration. The fix is therefore not "a bigger number" but the ordering: step budget >
case budget, with room for the case's non-install work. 3600 s = 2x the case's install budget and ~1.36x
the case's own measured wall clock on this box (see §3), so neither its budget nor its measured
throughput is cut short. In-container this is normally far faster (the lane probes the registry and
travels on the mirror when it answers, route `mirror-fallback-after-tarball-blackhole`), so 3600 s is a
CEILING for the slow-link case, never the expected cost, and a genuinely stalled case still dies at
3600 s with exit 124 recorded like any other failure.

## 2. The comment text as shipped (verbatim, `docker/entrypoint.sh` lines 2203–2231)

```bash
# THE STEP'S BUDGET MUST EXCEED THE BUDGET OF THE CASE IT ENCLOSES, and this step carried the 900 s
# default while its own case carried 1800 s (measured 2026-10-15). The case is
# `skills/dsh-qa/scripts/mcp-call.ts`, whose staged pack install is deliberately NON-LINKED
# (`npm install --install-links`): a linked `file:` pack never materializes its OWN dependencies, so
# `@ast-grep/cli` — declared by the PACK's manifest, not the root's — stayed unresolved and the call
# arm's launcher answered BINARY_NOT_FOUND. That closure install MEASURED 1037 s on this box's slow
# registry link (evidence/tui/dsh-tui-015/coderabbit/skills/install-links-duration.log), which is why
# the case's own budget for it is `INSTALL_TIMEOUT_MS` = 1800000 ms (1800 s) in that file — TWICE this
# step's budget. The ORDERING, not the number, is the point: an OUTER budget smaller than the INNER
# budget it encloses turns the inner one into decoration, because this step's SIGTERM (exit 124) would
# decide the verdict before the case's own ceiling could ever be reached. 3600 s = 2x the case's own
# install budget AND ~1.36x the case's MEASURED wall clock here (44:07 = 2647 s for its two arms, each
# a cold non-linked install plus a boot: evidence/tui/dsh-tui-015/coderabbit/skills2/mcp-call-real.log),
# so neither the case's budget nor its measured throughput is cut short. IN-CONTAINER this is normally
# far faster — the lane probes the registry first and travels on the MIRROR when it answers
# (`mirror-fallback-after-tarball-blackhole`) — so 3600 s is a CEILING for the slow-link case, never
# the expected duration, and a genuinely stalled case still dies at 3600 s with exit 124 recorded like
# any other failure. `MPD_E2E_STEP_TIMEOUT` still wins when an operator sets it LARGER: this is a
# FLOOR, and the raise is logged with the value it replaced. BOUND: the STEP only — the runner's own
# per-case ceiling (`LIVE_CASE_TIMEOUT_MS` = 1800 s in `docker/lib/owed-cases.ts`) is unchanged, so two
# arms each approaching their own ceilings can still be cut by THAT budget. 16c is the last `run_step`
# in this file, so the floor is not restored: a step added later could only inherit a LARGER budget.
OWED_CASES_TIMEOUT=3600
if [ "$STEP_TIMEOUT" -lt "$OWED_CASES_TIMEOUT" ]; then
  log "[step 16c-owed-cases] budget raised from ${STEP_TIMEOUT}s to ${OWED_CASES_TIMEOUT}s (the case's own install budget is 1800 s; see the comment above)"
  STEP_TIMEOUT="$OWED_CASES_TIMEOUT"
fi
run_step 16c-owed-cases node "$LIB_DIR/owed-cases.ts" \
  --kind cases --repo "$APP_DIR" --work "$OUT_DIR/owed" --qa-home "$QA_HOME" --state "$STATE_FILE"
```

`run_step` itself is NOT edited, and that is a constraint rather than a preference:
`scripts/docker-e2e.ts --self-test` pins two literals inside it (`timeout --kill-after=15 "$STEP_TIMEOUT"`
and `KILLED BY THE ${STEP_TIMEOUT}s STEP TIMEOUT`, checks 8c.5), and `scripts/**` is outside this task's
scope. Raising the value through `STEP_TIMEOUT` keeps those literals — and their pinned meaning, "the
budget the step really got" — intact, and makes `run_step`'s own `(timeout ${STEP_TIMEOUT}s)` line the
run-log witness of the raise.

**The "+2 lines, floor instead of a new knob" choice:** no new env knob was added, so
`docker/docker-compose.yml` (which already interpolates `MPD_E2E_STEP_TIMEOUT` for both services) and
both READMEs needed no change. An operator who needs longer still raises the knob that is already
documented and wired, and the floor does not cap it (control arm G5).

## 3. The measurement chain (all cited sources are pre-existing artifacts of sibling lanes)

| figure | file | consumed as |
|---|---|---|
| the non-linked closure install took **1037 s** (`install-links duration_seconds=1037 exit=0`) | `evidence/tui/dsh-tui-015/coderabbit/skills/install-links-duration.log` | the number the case's own budget grew from |
| the linked install is not merely a symlink — `@ast-grep/cli` and `cclsp` stay `UNRESOLVED(MODULE_NOT_FOUND)` | `evidence/tui/dsh-tui-015/coderabbit/skills/install-links-measure.log` | why the install must be non-linked at all |
| the live case measured **44:07 wall (2647 s)** for its two arms, both non-linked installs completed | `evidence/tui/dsh-tui-015/coderabbit/skills2/mcp-call-real.log`, `…/skills2/REPORT.md` | the case's real throughput, which 3600 s also exceeds |

I did not re-run a 1037 s install (that measurement is cited, not reproduced); the two figures above were
read from the sibling lanes' artifacts, which is what the comment says.

## 4. Control — red/green (item 3)

`16c-step-timeout-control.sh` (sha256 `643b0f2a8c4446e8dfe63263b2f66c83b5048f89f79148391fab570a9ca3727e`),
run output `control-green.txt` (sha256 `20dafbe982336405abcdb1638d0ff9d7606b8f1f8a8fb5beb461b43d3717d709`),
exit **0**, `FAILED=0`.

**It is a SHELL-TEXT + BEHAVIOURAL control, NOT a Docker run** (this box's lane did not build an image or
boot a container; the task allows exactly this and it is stated here rather than implied). It extracts the
SHIPPED bytes — the `run_step` function, the `STEP_TIMEOUT` default line, the 16c prelude and call site —
assembles them into a throwaway harness, and puts a **recording `timeout` shim** first on PATH. The shim
writes the argv it is handed and exits 0 **without executing the child**, so no case runs, nothing is
installed, and the assertion is on the real argv rather than on a grep.

```
[16c-budget] G1-shipped-carries-the-raised-budget=true — verbatim: OWED_CASES_TIMEOUT=3600 (entrypoint lines 2225..2229)
[16c-budget] G2-shipped-hands-3600-to-timeout=true — recorded timeout argv index 1 = 3600
[16c-budget]   G2-timeout-argv=0 --kill-after=15|1 3600|2 node|3 /opt/mpd-e2e/lib/owed-cases.ts|4 --kind|5 cases|…
[16c-budget]   G2-harness-log=[step 16c-owed-cases] budget raised from 900s to 3600s (the case's own install budget is 1800 s; see the comment above)
[16c-budget] G3-step-exceeds-the-cases-own-budget=true — step=3600s vs case=1800s (INSTALL_TIMEOUT_MS=1800000 ms read from mcp-call.ts)
[16c-budget] G4-raise-is-logged-with-the-old-value=true — observed: [step 16c-owed-cases] budget raised from 900s to 3600s …
[16c-budget] G5-operators-larger-budget-still-wins=true — MPD_E2E_STEP_TIMEOUT=5000 -> recorded timeout budget=5000s
[16c-budget] G6-driver-pinned-literals-survive=true — run_step still carries the two literals scripts/docker-e2e.ts --self-test pins
[16c-budget] R1-red-numeric-effective-budget-is-the-old-value=true — 3600->900 in the prelude -> recorded timeout budget=900s
[16c-budget] R1-red-numeric-fails-the-ordering-arm=true — with 900s the G3 ordering arm reads false against the case's 1800s budget
[16c-budget] R2-red-prefix-effective-budget-is-the-old-value=true — git show HEAD:docker/entrypoint.sh (no prelude) -> the default applies -> 900s
[16c-budget] R2-red-prefix-logs-no-raise=true — the pre-fix bytes log no raise (there is nothing to raise)
[16c-budget] R3-red-touches-nothing-but-the-number=true — numeric-red == shipped with the single 3600->900 substitution (diff lines=0)
[16c-budget] FAILED=0
```

The RED arms are the point: **R1** re-runs the same shipped block with the raised constant reverted to the
old `900` and **R2** re-runs the AUTHENTIC pre-fix bytes (`git show HEAD:docker/entrypoint.sh`, sha256
`afa53ad0faaccc9fc07094a5ce8932e8a6ef5d7bfe36f843aaf16be8b3e93cd2`) — both record a budget of **900 s**,
which fails the ordering arm against the case's 1800 s. An assertion that reads 3600 s on the new bytes
and 900 s on the old ones is falsifiable, and **R3** proves the red arm differs from the shipped arm by
exactly the numeric substitution and nothing else.

**What the control does NOT prove:** that GNU `timeout` itself enforces 3600 s (the shim stands in for it;
the enforcement is the documented behaviour of the same `timeout --kill-after=15 <seconds>` pattern the
TUI step and every other `run_step` already rely on), and nothing about the container's real wall clock —
no Docker run happened here.

## 5. `bash -n` (item 4)

```
$ bash -n docker/entrypoint.sh
BASH_N_EXIT=0
```

No output, exit 0 — before the control, and again on the same bytes the control read
(`8457a5f9…`, §1).

## 6. The affected gate, re-run (no gate or test was edited)

`node scripts/docker-e2e.ts --self-test` — the driver whose checks read the entrypoint's text — exited
**0**: `191` × `[self-test] ok`, `0` × `[self-test] FAIL`,
`[self-test] all arms passed (offline: no docker, no network)`. The two arms that pin `run_step` are green
by name:

```
[135] [self-test] ok   run_step bounds every step in time
[136] [self-test] ok   a timeout kill is recorded as such, never as a verdict
```

Log: `docker-e2e-selftest.txt` (sha256 `48eed688b532db736680e2ab7df6ef69717c26c20a1192277774f48403873898`).
No TypeScript changed, so `typecheck` / `verify:comments` were unaffected and were not re-run.

## 7. Honest bounds and findings (reported, not absorbed)

1. **No Docker run.** The step's budget was proven at the argv level by extraction + a recording shim, not
   by watching a container live past 1800 s. The end-to-end claim ("the next Docker run no longer kills
   the case inside its own budget") is therefore an inference from the measured argv, not an observation.
2. **The runner's own per-case ceiling is the next constraint, and it was NOT changed.**
   `docker/lib/owed-cases.ts` runs `qa.mcpCall` under `LIVE_CASE_TIMEOUT_MS = 1800000` (1800 s), i.e. the
   SAME number as the case's per-install budget — while the case performs **two** arms, each with its own
   `INSTALL_TIMEOUT_MS` + `spawnSync` timeout (two installs at 1800 s max + two boots at 600 s max) and
   measured 2647 s in total. So after this fix the step can no longer kill the case early, but the runner
   still can. That is the same ordering defect one layer down, in a file this task did not open; raising
   it is a separate decision (and would need `CASE_TIMEOUT_MS`/`LIVE_CASE_TIMEOUT_MS` arithmetic the
   report writer did not second-guess).
3. **Dashboard/documentation precision:** `docker/README.md` line 220 and `docker/README.zh-CN.md` line
   181 state that "every `run_step` is bounded by `MPD_E2E_STEP_TIMEOUT` (default 900 s)". Still true of
   the default and of every other step, but no longer the whole story for 16c (bounded by
   `max(knob, 3600)`). Both files are human-facing and a bilingual pair, and both currently carry a
   sibling lane's uncommitted edits — updating them is left to the captain rather than folded in here.
4. **Shared file.** `docker/entrypoint.sh` is edited by sibling lanes in this wave (`git status` also
   shows `docker/README*.md` and `docker/lib/reply-verdict.ts` modified by others). This change is
   additive (comment + 5 lines + the untouched call site); the sha256 in §1 pins exactly the bytes this
   report verified.
5. Nothing under `skills/**` or `packages/**` was written; `skills/dsh-qa/scripts/mcp-call.ts` is cited by
   hash for its constant and was not modified. `VENDOR_LOCK.json` is untouched (no skills bytes moved).

## 8. Evidence index

| Path | What |
|---|---|
| `docker2/16c-step-timeout-control.sh` | the control (extraction + recording-timeout shim + red arms) |
| `docker2/control-green.txt` | its full output, `FAILED=0`, exit 0 |
| `docker2/control-green-rerun.txt` | the identical re-run on the final bytes (`FAILED=0`, exit 0) — the green arms are stable, not a one-off |
| `docker2/docker-e2e-selftest.txt` | `node scripts/docker-e2e.ts --self-test`, exit 0, 191 ok / 0 FAIL |
| `docker2/REPORT.md` | this report |
