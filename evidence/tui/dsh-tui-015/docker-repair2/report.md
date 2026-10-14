# Docker-lane repair 2 — F1 `ui.replyRendered`, F2 backtick substitution, F3 tarball-range probe

Wave **tui-015-adaptation**. Author: Senior Engineer (delegated seat). Date 2026-10-14.
**Scope: `docker/**` only** — no `packages/**`, no `skills/**`, no `scripts/**` edit was made, and the
offline driver self-test was RUN, not modified. **No git writes were performed** (read-only
`git show` / `git diff` / `git status` only); the captain commits.

**Base revision of this repair**: the working tree exactly as the previous repair worker left it — proven
by the untracked-file hash, since `docker/tui-lane.sh` is UNTOUCHED by this repair and still hashes
`cabadd63efacbc72581d0f3be9948c216221dbfb4a4b9b34108991b9062c4943`, the value that worker's report
records as its final revision. This repair's three hunks were applied on top of `docker/entrypoint.sh`
`fc579e0e…369ee8e` (that same report's recorded revision).

---

## 1. Result

| finding | file | outcome | offline proof |
|---|---|---|---|
| **F2** backticks in a `fact` string are command substitution | `docker/entrypoint.sh` (2 sites) | fixed | `evidence/…/f2-arms.txt` — ALL PASS |
| **F1** `ui.replyRendered` greened without a reply | `docker/lib/reply-verdict.ts` (new), `docker/lib/browser-lane.ts`, `docker/entrypoint.sh` (1 `cp`) | fixed → **declared bound** | `evidence/…/f1-arms.txt`, `f1-reply-verdict-selftest.txt` — ALL PASS |
| **F3** step 01b graded METADATA only | `docker/entrypoint.sh` (probe + fact) | fixed | `evidence/…/f3-arms.txt` — ALL PASS |

Hashes of the files this repair owns, measured at the START of the final verification run
(`2026-10-14T14:26:26Z`) and RE-MEASURED after every check below with identical values:

```
afa53ad0faaccc9fc07094a5ce8932e8a6ef5d7bfe36f843aaf16be8b3e93cd2  docker/entrypoint.sh
3fb2f0ec5f9d54d62a22567fd72b9a955e713dc46890f750c1d82440b067b8bb  docker/lib/browser-lane.ts
d7c20454ef5ae7ff2271fe5f1265f2504c5e88120cba3ea88c20959d5cdb0405  docker/lib/reply-verdict.ts
cabadd63efacbc72581d0f3be9948c216221dbfb4a4b9b34108991b9062c4943  docker/tui-lane.sh   (untouched)
```

---

## 2. What changed, per finding

### F2 — `docker/entrypoint.sh`, the two `fact` strings that were shell command substitutions

| site | symbol | change |
|---|---|---|
| `fact obs.npmrc` (was line 410) | observation `npmrc` | `` `dsh plugin` `` → `` \`dsh plugin\` `` |
| `fact obs.caseEngineTree` (was line 2081) | observation `caseEngineTree` | `` `file:` `` → `` \`file:\` `` |

**The second site is not padding — it is the same defect, measured in the same run.** A quote-aware scan
of every `docker/*.sh` (single quotes, double quotes, escapes, comments and heredocs tracked) finds
exactly two executed backticks in the tree, and the authoritative run's `console.log` carries BOTH
messages:

```
/opt/mpd-e2e/entrypoint.sh: line 410: dsh: command not found
/opt/mpd-e2e/entrypoint.sh: line 1962: file:: command not found      (11-58-50Z/baseline)
/opt/mpd-e2e/entrypoint.sh: line 2081: file:: command not found      (13-51-46Z/run C)
```

The word loss is in both runs' `output.log` (`npmrc = … pnpm — and therefore every  — resolves …`,
`output.log:56`). Nothing else in `docker/**` executes a backtick: the hits the naive scan reports in
`docker/tui-lane.sh` are inside SINGLE-quoted `node -e` arguments and QUOTED heredocs
(`<<'SESSION_PROBE_EOF'`), where a backtick is literal — the arm that proves it plants both shapes.

### F1 — `ui.replyRendered` must not pass without a rendered reply

**New module: `docker/lib/reply-verdict.ts`** (pure, no I/O, `--self-test`), exported symbols:
`judgeReply(input) → ReplyVerdict`, `ReplyInput`, `ReplyVerdict`, `ReplyKind`.

* `replyRegion(before, after, prompt)` — the lines that are NEW since the pre-send capture, are NOT the
  prompt coming back, and are NOT the failure panel. The prompt-echo test has two shapes because the page
  has two: the sent BUBBLE carries the prompt verbatim, and the sidebar's session entry carries a
  TRUNCATED echo (`Call the mpd_config_get tool …`). A real one-word answer (`DONE`) passes neither test
  (too short to be a prompt slice, far too short for the paraphrase test) — which is exactly why the
  prompt's own `DONE` can no longer green the row while a genuine answer still can.
* A reply is then `doneLine(region)` (the answer the prompt asked for as the WHOLE content of a line) or
  `toolLine(region)` (a rendered mention of `mpd_config_get`, which only a turn can paint — the prompt's
  own mention sits in the echo and was already filtered out). **Growth alone is no longer a signal**, and
  the panel is never one: it is inspected only to decide between the OTHER two answers.
* `credentialOf(failure)` — `MISSING_CREDENTIAL` / `no API key for provider route` /
  `<X>_API_KEY … credential` — decides the third answer, `credential-bound`.
* Precedence: a rendered reply WINS over a panel; a credential bound is reported only when nothing
  rendered; every other silent transcript is `no-reply` so the lane reddens on it.

**`docker/lib/browser-lane.ts`**:
`stage()` now takes `() => Promise<StageResult>` where
`type StageResult = string | { bound, raw }` — a string records `ok:true`, a bound object records
`ok:null` with the bound's own reason (the credential-free `live.*` rows' shape). Every other stage is
untouched and still returns a string, so their rows are byte-identical.
Stage 5 (`ui.replyRendered`) was rewritten: it re-judges the LATEST capture each round, breaks on a
rendered reply OR on a failure panel (a panel is the turn's terminal state — waiting out the 240 s budget
cannot produce a reply after it), and records **`null` + `DECLARED BOUND … (MISSING_CREDENTIAL) …`** when
the panel names the missing credential. Anything else without a reply is a FALSE row, quoting the reason.

**`docker/entrypoint.sh`**: one `cp "$LIB_DIR/reply-verdict.ts" "$UI_DIR/reply-verdict.ts"` next to the
existing lane copy — the lane runs from `$UI_DIR` (where `playwright` resolves) and a relative `.ts`
specifier resolves from the IMPORTING file, so without it the lane cannot load at all (arm 3 below is the
control that proves this line is load-bearing).

### F3 — step 01b now exercises a TARBALL range

`docker/entrypoint.sh`, step `01b-npm-registry` (the embedded `node -e` program) plus its fact:

* `NPM_TARBALL_PATH="/@deepseek-ai/dsh/-/dsh-${DSH_VERSION}.tgz"` — npm's canonical tarball layout for the
  SAME artifact the metadata probe already asks about.
* `tarballProbe(base)` — one `fetch` with `Range: bytes=0-1023`, bounded TWICE: by the same 20 s abort
  every probe in this step uses, and by reading ONE stream chunk then cancelling, so a server that ignores
  `Range` cannot make the step download a whole tarball. `206`, or `200` with bytes, passes; **zero bytes
  fails**.
* Decision: metadata answers + tarball answers → route `operator-set-ok` / `official-registry-ok`
  (unchanged spelling) with the tarball reading in the detail. Metadata answers + tarball blackholes →
  route `<label>-tarball-blackholed` / `mirror-tarball-blackholed` **and the step exits 1** — the probe
  FAILS instead of passing. Both registries dead → `both-unreachable`, byte-identical to before.
* **Offline-safe / no knob, no network**: the ranged GET runs only when the operator named a registry
  (`MPD_E2E_NPM_REGISTRY`); with no knob the arm writes
  `skipped reason=no-registry-knob (…)` into the selection file's third line and pays zero requests
  (arm C asserts the request count is 0).
* The selection file is now three lines (registry / route / tarball reading) and the new fact
  `obs.npmTarball` carries it into `result.json`, so a rejected registry is visible without opening the
  step log. The log reader line prints the same `TARBALL=` line.

---

## 3. Commands and observed results (all offline; no Docker was run)

Run from the repo root, `2026-10-14T14:26Z`–`14:35Z`. Full transcripts under
`evidence/tui/dsh-tui-015/docker-repair2/`.

| # | command | observed |
|---|---|---|
| 1 | `bash -n docker/entrypoint.sh`; `bash -n docker/tui-lane.sh` | both `exit 0` (`final-verification.txt`) |
| 2 | `bash evidence/…/f2-arms.sh` | `F2 ARMS: ALL PASS`, exit 0 |
| 3 | `bash evidence/…/f1-arms.sh` | `F1 ARMS: ALL PASS`, exit 0 |
| 4 | `node docker/lib/reply-verdict.ts --self-test` | `ARMS=9 PASSED=9 FAILED=0`, exit 0 |
| 5 | `node evidence/…/f3-registry-arms.mjs` | `FAILED=0`, exit 0, 20.4 s wall clock |
| 6 | `node scripts/docker-e2e.ts --self-test` | exit 0, `191 ok`, **0 FAIL**, `all arms passed (offline: no docker, no network)` |
| 7 | `./node_modules/.bin/tsgo --noEmit` | `TYPECHECK_EXIT=0` (no diagnostics) |
| 8 | `node scripts/verify-comment-coverage.ts` | `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.` (scanned 402 files, 35602 declarations) |
| 9 | `sha256sum …` before and after 1–8 | identical (the sandwich holds) |

### 3.1 F2 arms (detail)

* Quote-aware scan: `TOTAL_SUBSTITUTION_SITES=0` over `docker/*.sh`; the scanner's own control (a planted
  unescaped pair + a single-quoted JS template literal) reports exactly `2` and does NOT report the
  inert one.
* The `obs.npmrc` if-block is EXTRACTED from the shipped file (line pattern, never a copy) and RUN with a
  stub `fact()`: exit 0, **0 bytes on stderr**, and the row prints
  ``(a SANDBOX-home .npmrc; pnpm — and therefore every `dsh plugin` — resolves through the FILE …)``.
* **Negative control**: the same block with the pre-fix bytes and a stub `dsh` on `PATH` prints
  `(… therefore every  — resolves …)` and `stderr: STUB-DSH-INVOKED argv=[plugin]` — the substitution is
  reproduced, so the arm above is falsifiable.
* The same for `obs.caseEngineTree`: ``npm `file:` into its sandbox profile`` survives, stderr empty.

### 3.2 F1 arms (detail)

| arm | observed |
|---|---|
| classifier self-test | 9/9 arms; e.g. `credential-free-transcript-is-a-bound=true kind=credential-bound … done=false tool=false region=8 failure=yes`; `prompt-own-done-is-not-a-reply=true kind=no-reply`; `standalone-done-is-a-reply=true done=true`; `tool-render-is-a-reply=true tool=true`; `other-failure-is-not-a-bound=true kind=no-reply` (a MALFORMED_RESPONSE panel stays RED, it is not downgraded) |
| classifier NEGATIVE CONTROL | `PRE_FIX_GREENS_ON_CREDENTIAL_FREE_FIXTURE=true` and `PRE_FIX_GREENS_ON_PROMPT_ECHO_ONLY=true` — the old `/\bDONE\b/ \|\| grew` predicate still greens on both fixtures this module refuses, so the fixture really reproduces the reported false green |
| lane loads from a COPIED pair (`$LIB_DIR`→`$UI_DIR`, different cwd) | exit 0, 8 rows recorded, `ui.replyRendered=null` |
| that copy WITHOUT `reply-verdict.ts` | `ERR_MODULE_NOT_FOUND`, exit 1 — the new `cp` line is load-bearing |
| the pre-fix predicate is gone from the lane | no `transcript did not change` growth test, no `/\bDONE\b/` row decision, `judgeReply` present |
| **driver consequence, shipped pure functions** | browser lane ON (default): `unmeasuredRequired(result, ["ui."]) = ["ui.replyRendered"]` → `finalExit = 3`; `--no-browser`: `unmeasured = []` → `finalExit = 0` |

### 3.3 F3 arms (detail)

The registry is a DETERMINISTIC FAKE injected as `globalThis.fetch` (`f3-fetch-shim.mjs`), and the program
under test is EXTRACTED from the shipped entrypoint; the pre-fix program comes from
`git show HEAD:docker/entrypoint.sh` (read-only).

| arm | registry behaviour | observed (shipped probe) | pre-fix control |
|---|---|---|---|
| A | metadata 200, tarball 206 + 1024 B | exit 0, `ROUTE=operator-set-ok`, `TARBALL=http=206 bytes=1024`, selection file 3 lines, `Range: bytes=0-1023` sent, exactly 1+1 requests | — |
| A2 | metadata 200, tarball 200 + 65536 B (Range ignored) | exit 0, `http=200 bytes=65536` — one chunk read, the object is not downloaded | — |
| A3 | metadata 200, tarball 200 **0 bytes** | exit 1, `ROUTE=operator-set-tarball-blackholed`, `bytes=0` | — |
| B | metadata 200, tarball HANGS | exit 1, `ROUTE=operator-set-tarball-blackholed`, `TARBALL=… FAILED`, **20 042 ms** (the probe's own abort, not the 900 s step budget) | **exit 0, `ROUTE=operator-set-ok`, 0 tarball requests — the reported false pass, reproduced** |
| C | no registry knob | exit 0, `ROUTE=official-registry-ok`, `skipped reason=no-registry-knob`, **0 tarball requests** | — |
| D | official metadata 500, mirror metadata 200 + tarball error | exit 1, `ROUTE=mirror-tarball-blackholed`, the request went to the MIRROR | — |
| E | both metadata 500 | `ROUTE=both-unreachable`, no tarball request — the pre-existing branch is unchanged | — |

---

## 4. What changes on the next REAL run (the captain's re-run)

1. **`ui.replyRendered` becomes a DECLARED BOUND, not a green.** In a credential-free container the row is
   `ok:null` with a reason that names `MISSING_CREDENTIAL` and quotes the panel; its `raw` carries
   `before=… after=… growth=… done=false tool=false region=N failure=yes`. `ui.loads`,
   `ui.workspaceSelected`, `ui.composerPresent`, `ui.promptSent`, `ui.mpdSettingsSection`, `ui.teamPanel`
   and `ui.noConsoleErrors` are UNCHANGED (the stage union is behaviour-neutral for a string return, and
   those seven stages still return exactly the strings they returned before; only stage 5 was rewritten).
2. **The driver's verdict follows mechanically**: the browser lane is ON by default, so `requiredPrefixes`
   contains `ui.` and `unmeasuredRequired` returns `["ui.replyRendered"]` → `finalExit = 3`
   (`MISSING PREREQUISITE`, the same code `--require-docker` uses for a skipped lane). This is the lane's
   own existing rule for a required-but-unevaluated arm, and it is the honest reading of a
   credential-free run. **Three options, the captain's call** — (a) accept exit 3 as the declared-bound
   verdict; (b) stage a credential so the arm measures a real turn (then it greens on the model's own
   `DONE` or tool render); (c) run with `--no-browser`, which makes all eight `ui.*` nulls and exits 0 but
   throws away the seven arms F1 asks to keep — I do NOT recommend (c). Changing (2) itself would mean
   weakening the driver's required-arm gate in `scripts/docker-e2e.ts`, which is outside this scope.
3. **Step 01b gains one ranged GET** when the operator names a registry: run C's own knob
   (`MPD_E2E_NPM_REGISTRY=https://registry.npmmirror.com`) means the next run fetches ~1 KB of
   `@deepseek-ai/dsh@0.2.0-rc.2`'s tarball. If the mirror serves it, the route stays `operator-set-ok`
   (expected — that mirror answered Playwright artifact RANGES with 206 in run C). If it does not, the
   step exits 1 with `route=<label>-tarball-blackholed` and `obs.npmTarball` names the failure — and the
   install's later stall is then a KNOWN, already-reported state instead of a surprise.
4. **Facts on the next run**: `obs.npmrc` and `obs.caseEngineTree` print their missing words again, and
   the two `command not found` lines disappear from `console.log`. `obs.npmTarball` is a NEW observation
   whose value is either the tarball reading or `skipped reason=no-registry-knob`.
5. No `ui.*` NULL is added to the "33 declared bounds" bookkeeping without a reason: `ui.replyRendered`'s
   null carries its own sentence, exactly as `live.*` does.

---

## 5. Bounds — what this repair does NOT prove

1. **No container was run** (by instruction: the captain schedules the re-run). Everything above is
   offline evidence on the frozen bytes; the F1 row's null-on-next-run is a PREDICTED consequence, backed
   by the shipped pure functions and the real fixtures (the `before=225 after=619 done=true` record and
   the byte-identical `ui-02`/`ui-03` PNGs) — not observed in a container.
2. **The F3 arms inject a fake `fetch`.** This session's sandbox blackholes even LOOPBACK TCP: a stub
   HTTP registry on `127.0.0.1` received ZERO connections while each probe sat until its 20 s abort
   (measured, `arm A meta=0 tarball=0`, 40 s for two probes). So the SHIPPED decision tree — statuses,
   byte counts, the skip branch, the exit codes, the selection file — is exercised, and the TCP/TLS
   TRANSPORT is not. A real run exercises the transport.
3. **The new predicate is deliberately STRICT**: a reply that is neither the requested standalone `DONE`
   nor a rendered `mpd_config_get` is reported as `no-reply` (a FALSE row), not accepted as a generic
   rendered turn. Growth alone cannot be accepted, because the open-session view paints chrome that the
   prompt never produced (`Chat`, `13:54`, `1 turns 1 steps`, `Workspace Write`, …) — accepting "new,
   non-prompt, non-panel text" would green on that chrome, which is the very false pass F1 reports. The
   prompt asks for BOTH shapes explicitly, so a compliant turn always satisfies one of them; a turn that
   answers in some other way is a real finding, and the `live.web.*` rows are where the model's actual
   behaviour is graded.
4. **The fixture transcripts are transcriptions, not byte-exact captures** (each line was read off
   `ui-03-reply.png`), so the arms assert shapes, never character counts.
5. **`docker/lib/reply-verdict.ts`'s `--self-test` is not wired into `scripts/docker-e2e.ts --self-test`**
   (that file is outside the assigned scope). It ships its own `--self-test` and I ran it as arm 4 of
   `f1-arms.sh`; wiring it into the driver's arm list is a candidate follow-up for the captain.
6. **Not investigated / not changed** (reported, not absorbed): `docker/README.md` (+ `README.zh-CN.md`)
   still describes step 01b as a metadata-only probe (line ~220) — a bilingual doc pair to update in the
   SAME commit as this change, and it needs the operator-facing sentence about the tarball arm; the
   `both-unreachable` branch still exits 0 although no registry answered (a sibling of F3's class, left
   alone deliberately); `ui-02-sent.png` and `ui-03-reply.png` stay byte-identical in a credential-free
   run, which is now the EVIDENCE of the declared bound rather than of a pass.

---

## 6. Evidence index (`evidence/tui/dsh-tui-015/docker-repair2/`)

| path | what it holds |
|---|---|
| `report.md` | this report |
| `final-verification.txt` | the hashes before/after, `bash -n`, and the tail of all three arm suites from the final run |
| `f2-arms.sh`, `f2-arms.txt` | F2 arms (quote-aware scanner + extracted-block runs + the stub-`dsh` control) |
| `f2-shell-backtick-scan.mjs` | the scanner (its own control is arm 1b) |
| `f1-arms.sh`, `f1-arms.txt` | F1 arms (lane load from a copied pair, its control, the predicate check, the driver consequence) |
| `f1-reply-verdict-selftest.txt` | the classifier's 9-arm self-test, verbatim |
| `f3-registry-arms.mjs`, `f3-arms.txt` | F3 arms (A/A2/A3/B + pre-fix control/C/D/E) |
| `f3-fetch-shim.mjs` | the deterministic fake registry the F3 arms inject (and why: loopback TCP is blackholed here) |
| `gate-driver-selftest.txt` | `node scripts/docker-e2e.ts --self-test` full log — 191 `ok`, 0 FAIL, "all arms passed" |
| `gate-typecheck.txt` | `tsgo --noEmit` → exit 0 |
| `gate-comments.txt` | `verify-comment-coverage.ts` → PASS |
