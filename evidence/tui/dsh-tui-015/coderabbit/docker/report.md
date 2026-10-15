# CodeRabbit PR #42 — the three `docker/**` findings, repaired with their controls

Wave **fix/coderabbit-pr42** (follow-up to PR #42 / v0.13.0). Author: Senior Engineer (delegated seat).
Date 2026-10-15. **Scope: `docker/**` + `evidence/tui/dsh-tui-015/coderabbit/**` ONLY** — no
`packages/**` and no `skills/**` byte was written by this seat (the `packages/mpd-team-core-plugin/**`
modifications visible in `git status` belong to a SIBLING lane of the same wave, not to this work), and
**no git write** was performed (read-only `git status` / `git show` / `git rev-parse` only; the captain
commits).

**Base revision of this repair**: `HEAD = 006dff6e97d2912e4cd6b8b49b9497ef0ab3335e`, with the docker
tree clean at the start (`git status --short docker/` printed nothing), so `git show
HEAD:docker/entrypoint.sh` IS the authentic pre-fix program used as the negative controls below.

Hashes of the files this repair owns, read at `2026-10-15T03:12:52Z` and re-read after every check at
`2026-10-15T03:13:16Z` — identical both times:

```
fc594126555442241dfd344f4385493cf7fba62da8b4591fd989515fceb80717  docker/entrypoint.sh        (findings 1 + 3)
4472e213aedb90649582bb59f1b885714d8886afeb6f322543074b2fa5c5510e  docker/lib/reply-verdict.ts (finding 2)
3fb2f0ec5f9d54d62a22567fd72b9a955e713dc46890f750c1d82440b067b8bb  docker/lib/browser-lane.ts  (UNCHANGED — the pre-fix hash)
cabadd63efacbc72581d0f3be9948c216221dbfb4a4b9b34108991b9062c4943  docker/tui-lane.sh          (UNCHANGED)
451d4ae5801b675717ce12b0cab5244c42ce82a90c6391b0d8a9962e31d376ff  docker/README.md            (finding 3 doc clause)
404e7326d9628f77ba0f5322082e5a46d846f6b65fa4dcd9ad06ef4cb7577c8d  docker/README.zh-CN.md      (finding 3 doc clause)
```

---

## 1. Result

| finding | review anchor | fix (path + symbol) | control | observed |
|---|---|---|---|---|
| **(1)** `BROWSER_INSTALL` never reset before the mirror retry | `docker/entrypoint.sh:1809` [Major] | `docker/entrypoint.sh` → the **13-browser retry gate** (shell, no symbol; the `BROWSER_INSTALL=0` reset before the second `npx playwright install`) | `f1-browser-retry-arms.sh` (22 checks) | **ALL GREEN**; the local revert and the authentic `HEAD` bytes both go **RED** (`install=7`) |
| **(2)** stale failure panel binds | `docker/lib/browser-lane.ts:441` [Minor] | `docker/lib/reply-verdict.ts` → **`failureText(before, after)`** (+ `judgeReply`'s `stale` field) | `f2-reply-verdict-arms.mjs` (11 checks) + the module's own `--self-test` (11 arms) | **ALL GREEN**; the locally reverted comparison reddens `stale-failure-line-alone-does-not-bind` **and nothing else** |
| **(3)** blackholed tarball settles on the blackholed registry | `docker/entrypoint.sh:422` [Minor] | `docker/entrypoint.sh` → the **01b registry probe program**, branch `if (!arm.ok)` after the first metadata probe | `f3-registry-arms.mjs` (47 checks) | **ALL GREEN**; the authentic pre-fix program on the same fixture **FAILS** (`route=operator-set-tarball-blackholed`) and never asks the mirror |

**80 checks across the three suites, 0 FAILED**; the red outcomes are asserted as checks of their own
(`C-*`, `C2-*`, `NEW1-control-*`, `*control-*`), so a control that stopped reproducing the defect would
redden the suite rather than pass silently.

---

## 2. Per finding

### (1) `docker/entrypoint.sh` — reset `BROWSER_INSTALL` before the mirror retry

**What changed.** Inside the retry gate (`if [ "$BROWSER_INSTALL" != "0" ] && [ "$PLAYWRIGHT_HOST" !=
"$PLAYWRIGHT_MIRROR" ]`), immediately before the retry’s `npx playwright install …`:

```bash
        BROWSER_INSTALL=0
        ( cd "$UI_DIR" && npx playwright install --with-deps chromium >>"$BROWSER_LOG" 2>&1 ) || BROWSER_INSTALL=$?
```

`|| BROWSER_INSTALL=$?` only ever ASSIGNS on failure, so without the reset a retry that succeeded left the
FIRST attempt’s code in place; the `if [ "$BROWSER_INSTALL" != "0" ]` branch below then reported every
`ui.*` arm unavailable with `route=mirror-retry-after-failure`. The reset makes a successful retry clear
the failure and a failed retry record ITS OWN code; the first failure is still quoted in the install log
by the pre-existing `echo` (which runs before the reset). Comment at the site records the finding.

**Controls** — `f1-browser-retry-arms.sh` extracts the shipped retry block **from `docker/entrypoint.sh`
at run time** (awk, start marker `export PLAYWRIGHT_DOWNLOAD_HOST="$PLAYWRIGHT_HOST"` → the closing `fi`)
and runs those bytes under `bash` with a stub `npx` on PATH whose exit code per attempt is the arm’s
input (`f1-arms.txt`):

| arm | input | observed | verdict |
|---|---|---|---|
| A shipped | first attempt 7, retry 0 | `install=0 host=…/mirror route=mirror-retry-after-failure calls=2` and the shipped downstream predicate takes `DOWNSTREAM=lane-driven` | GREEN (the fix) |
| B shipped | first 7, retry 9 | `install=9`, log line `the install failed on https://official.invalid (exit 7); retrying on …/mirror.invalid`, `DOWNSTREAM=unavailable-branch` | GREEN (reporting kept) |
| **C control** | block with the reset line **removed locally** (diff = exactly 1 line), first 7, retry 0 | `install=7`, `DOWNSTREAM=unavailable-branch` | **RED reproduced** |
| **C2 control** | the **authentic pre-fix block from `git show HEAD:docker/entrypoint.sh`**, first 7, retry 0 | `install=7` | **RED reproduced on real pre-fix bytes** |
| D shipped | already on the mirror, first 7 | `install=7 calls=1 route` untouched | GREEN (gate intact) |

`bash -n docker/entrypoint.sh` → exit 0 (also `docker/tui-lane.sh`, `docker/ui/entrypoint.sh` → exit 0;
neither is edited by this repair — see §3 bound b).

### (2) `docker/lib/reply-verdict.ts` — the panel must be NEW since the pre-send capture

**What changed.** `failureText(after)` → **`failureText(before, after)`**: the post-send lines are
filtered against the normalized pre-send lines (`alreadySeen`, the SAME subtraction `replyRegion`
already did), and only the remainder can be the current turn’s panel. `judgeReply` computes the NEW
panel for the verdict and the PRE-SEND panel as a separate `stale` reading; the row’s `raw` now carries
`staleFailure=none|yes` and the no-reply reason says "without a NEW failure panel (… stale …)" when one
was already on screen. Precedence is untouched: a rendered reply still wins, and a NEW panel naming the
credential still yields `credential-bound` (the declared bound). `docker/lib/browser-lane.ts` is
**unchanged** — its wait-break consumes `verdict.failure`, which is now the NEW panel only, and the
`credential-bound` branch below it is unchanged.

**Self-test arms added** (the module’s own `--self-test`, now **ARMS=11 PASSED=11 FAILED=0**):

* `stale-failure-line-alone-does-not-bind` — the panel is in `before` AND in `after`, nothing else new →
  `kind=no-reply`, `failure=none staleFailure=yes` (previously `credential-bound`).
* `new-failure-line-does-bind` — the panel appears only in `after` → `kind=credential-bound`.

**Negative control** — `f2-reply-verdict-arms.mjs` copies the SHIPPED module to a scratch dir and
reverts the comparison LOCALLY (`failureText(input.before, input.after)` → `failureText("", input.after)`,
`diff` = exactly that one line), then runs the same `--self-test`:

```
control-exit-1=true            exit=1 ARMS=11 PASSED=10 FAILED=1
control-stale-arm-RED=true     stale-failure-line-alone-does-not-bind=false (the stale panel binds again)
control-new-arm-still-GREEN=true new-failure-line-does-bind=true (the revert reddens the stale arm ONLY)
```

### (3) `docker/entrypoint.sh` — probe the mirror before settling on a blackholed tarball

**What changed.** In the 01b probe program, the branch where the FIRST metadata probe answered and its
ranged GET did not (`if (!arm.ok)`): the MIRROR’s metadata is probed, and only when it answers is the
mirror’s tarball ranged-GET’d. Both answering → `settle(mirror, "mirror-fallback-after-tarball-blackhole",
…)` + `process.exit(0)`, so the later installs travel on the mirror. Anything less (mirror metadata dead,
or mirror tarball blackholed) falls through to the UNCHANGED `settle(registry, label +
"-tarball-blackholed", …)` + `process.exit(1)`. The `no-registry-knob` skip is untouched, so the new
branch is reachable only when the operator named a registry (the review says exactly that).

**Controls** — `f3-registry-arms.mjs` extracts the shipped `node -e` program from `docker/entrypoint.sh`
and drives it against the deterministic fake registry `f3-fetch-shim.mjs` (byte-identical to the previous
wave’s shim, `sha256 2e93054a…e852`), which is injected as `globalThis.fetch` — this sandbox blackholes
even loopback TCP. The PRE-FIX program is the authentic `git show HEAD:docker/entrypoint.sh`
(`pre-fix-program-is-the-metadata-plus-tarball-probe=true`, `pre-fix-program-extracted=true`).

| arm | fixture (official / mirror) | observed | verdict |
|---|---|---|---|
| **NEW1 mirror-tarball-ok** | meta ok + tarball hang / meta ok + tarball 206 | `exit=0`, `selected=…/mirror`, `route=mirror-fallback-after-tarball-blackhole`, mirror tarball `http=206 bytes=1024`, meta 1+1, tarball 1+1 | GREEN (the fix) |
| **NEW1 control** (pre-fix) | same | `exit=1 selected=…/official route=operator-set-tarball-blackholed`, mirror tarball requests **0** | **RED** — proves the fallback is load-bearing |
| **NEW2 both-tarball-blackholed** | meta ok + hang / meta ok + hang | `exit=1`, `selected=…/official`, `route=operator-set-tarball-blackholed`, reading `FAILED`, both tarballs probed | GREEN (behaviour kept) |
| **NEW2 control** (pre-fix) | same | identical `exit/selected/route` | GREEN — the settled outcome is unchanged |
| **NEW3 mirror-metadata-dead** | meta ok + 0 bytes / meta 500 + 206 | `exit=1`, old route, mirror META probed, mirror TARBALL **not** probed | GREEN (metadata AND tarball, never either alone) |
| A / A2 / A3 / D / D2 / E / C (regressions) | 206 · 200-with-bytes · 0 bytes · mirror-tarball-error · mirror-fallback · both-unreachable · no knob | all as before, incl. `D2-route-mirror-fallback` and `C-tarball-skipped-with-reason` | GREEN |

### Documentation

`docker/README.md` and `docker/README.zh-CN.md` both carried the sentence that a blackholed tarball
"now FAILS the probe"; one clause was added to EACH (the pair moves together): the mirror is probed for
its metadata AND tarball first, the install travels on it when both answer
(`mirror-fallback-after-tarball-blackhole`), and a mirror that fails too keeps the
`<label>-tarball-blackholed` failure. `docker/README*.md` are outside `verify:docs`'s discovery band
(§4/T-28), so no doc gate covers them; the pair was kept manually.

---

## 3. Gates run, with their observed results

| command | observed |
|---|---|
| `bash -n docker/entrypoint.sh` | exit 0 |
| `bash -n docker/tui-lane.sh` / `docker/ui/entrypoint.sh` | exit 0 each (not edited — included so "both shell scripts of the lane pair" are covered) |
| `node docker/lib/reply-verdict.ts --self-test` | `ARMS=11 PASSED=11 FAILED=0`, exit 0 |
| `bash evidence/…/f1-browser-retry-arms.sh` | `FAILED=0`, exit 0 (22 checks) |
| `node evidence/…/f2-reply-verdict-arms.mjs` | `FAILED=0`, exit 0 (11 checks) |
| `node evidence/…/f3-registry-arms.mjs` | `FAILED=0`, exit 0 (47 checks) |
| `node scripts/docker-e2e.ts --self-test` | exit 0, **191** `[self-test] ok`, "all arms passed (offline: no docker, no network)" |
| `node scripts/verify-comment-coverage.ts` | exit 0, `VERDICT: PASS` (404 files, 35778 declarations) |
| `bun run typecheck` (`tsgo --noEmit`) | exit 0 |

All of the above were re-run AFTER the last write of this repair; the frozen log is
`final-verification.txt`. The Docker lane itself was **NOT** run — the captain schedules it.

## 4. Honest bounds (what these controls do NOT prove)

1. **No Docker, no network, no browser.** The TCP/TLS transport, the real `npx playwright install`
   download, Chromium's own behaviour and the real GUI wait loop are exercised ONLY by a real
   `verify:docker` run. The f3 arms drive the shipped DECISION TREE against a fake `fetch`; the f1 arms
   drive the shipped ROUTE/STATUS logic against a stub `npx`.
2. **`docker/ui/entrypoint.sh` and `docker/tui-lane.sh` are untouched** (a `bash -n` on them is a
   courtesy, not evidence about this repair).
3. **Finding (2)'s subtraction is line-identity based, by construction.** A failure line the current turn
   paints with text BYTE-IDENTICAL to one already on screen before the send counts as stale and binds
   nothing — that is the semantics the finding asks for ("ignore normalized lines already present before
   the send"), not an oversight; the row's `raw` reports it as `staleFailure=yes`.
4. **`docker/lib/browser-lane.ts` was NOT modified.** The review anchors finding (2) at its line 441, but
   the symbol it names (`failureText`) lives in `docker/lib/reply-verdict.ts`, which the lane imports; the
   lane's wait-break reads `verdict.failure`, so the classifier change is what changes the wait. Its bytes
   are the pre-fix hash `3fb2f0ec…b8bb`. If the verifier expects an edit in the lane file itself, that is
   a divergence of reading, not a missing fix — the arm `shipped-stale-arm-green` plus the control cover
   the behaviour either way.
5. **Out-of-scope, reported not absorbed:** `scripts/docker-e2e.ts --self-test` still does not invoke
   `docker/lib/reply-verdict.ts --self-test` (it is `scripts/**`, outside this seat's scope) — its 191
   arms are source-text assertions and did NOT grow. The sibling `both-unreachable` branch (no registry
   answered METADATA) still exits 0; the previous wave reported it and this repair leaves it alone.
6. **The `packages/mpd-team-core-plugin/**` working-tree modifications are NOT this seat's work** — a
   sibling lane of the same wave owns them; nothing here reads or writes them.

## 5. Evidence index (`evidence/tui/dsh-tui-015/coderabbit/docker/`)

| path | what it holds |
|---|---|
| `report.md` | this report |
| `final-verification.txt` | hashes before/after (identical), `bash -n`, all three arm suites, the gates |
| `f1-browser-retry-arms.sh`, `f1-arms.txt` | finding (1): the extracted-block harness, its 22 checks, the local-revert and `HEAD`-bytes controls |
| `f2-reply-verdict-arms.mjs`, `f2-arms.txt`, `f2-reply-verdict-selftest.txt` | finding (2): the revert control and the module's 11-arm self-test verbatim |
| `f3-registry-arms.mjs`, `f3-arms.txt`, `f3-fetch-shim.mjs` | finding (3): the offline registry fixture (`mirror-tarball-ok`, `both-tarball-blackholed`, `mirror-metadata-dead`) and the pre-fix control |
| `hash-before.txt`, `gate-bash-n.txt`, `gate-comments.txt`, `gate-driver-selftest.txt`, `gate-typecheck.txt` | the raw gate logs |
