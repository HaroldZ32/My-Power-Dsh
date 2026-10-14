# Docker source-lane repair — the TUI 8-arm cluster and the browser prerequisite

Wave **tui-015-adaptation**. Author: Senior Engineer (delegated seat). Date 2026-10-14.
Base revision `6692b9e3` (`git rev-parse --short HEAD`), working tree clean apart from this repair's two
files. **Scope: `docker/**` only.** No `packages/**` and no `skills/**` edit was made; the one
product-side-adjacent behaviour found is written up as a FINDING below instead of being fixed.
**No git writes were performed** — the captain commits.

## 0. Result

| run | evidence dir | assertions (pass/fail/null) | exit |
|---|---|---|---|
| baseline (the wave's own run) | `evidence/docker/client-install/2026-10-14T11-58-50Z/` | 69 / **8** / 41 | 3 |
| A — drive fix, incomplete | `evidence/docker/client-install/2026-10-14T12-37-34Z/` | 69 / 7 / 42 | 3 |
| B — browser probe v1 | `evidence/docker/client-install/2026-10-14T13-05-11Z/` | 77 / **0** / 41 | 3 |
| **C — FINAL** | **`evidence/docker/client-install/2026-10-14T13-51-46Z/`** | **85 / 0 / 33** | **0** |

Run C: `driver.json` → `{"exitCode":0,"requiredPrefixes":["ui."],"unmeasured":[],"containerExit":0}`.
All eight originally-failing arms are `true`, and **every one of the 22 `tui.*` records is `true`**
(`tui.laneExit=true records=21`). The 33 remaining NULLs are exactly the declared bounds:
27 `live.*` + `boot.llmTurn` (no credential staged — `DEEPSEEK_API_KEY` is unset in this environment),
5 `oneclick.*`/`qa.mcpCall` (`--mode source` does not run them), and **no `ui.*` NULL remains**.

### Flags used for run C, and why

```
MPD_E2E_NPM_REGISTRY=https://registry.npmmirror.com \
  node scripts/docker-e2e.ts --mode source --require-docker
```

* `--mode source` is the lane under repair; `--require-docker` is the release spelling and this daemon is
  **rootless** (`docker info -f '{{.SecurityOptions}}'` → `name=rootless`), so the lane runs rather than skips.
* **No `--no-browser`**: the browser lane was MADE measurable, so its `ui.` required set is honest and
  `unmeasured` is empty. This is the whole point of section 2.
* **`MPD_E2E_NPM_REGISTRY` is an operator knob the lane already declares** (`NPM_REGISTRY_LABEL=operator-set`,
  recorded honestly as `npmRegistry = https://registry.npmmirror.com (route=operator-set-ok)`). It was
  needed because `registry.npmjs.org` is **intermittently blackholed from this container**: step 01b's
  METADATA probe greened at 1776 ms and `npm i -g pnpm@11.23.0` then sat at 0.2 % CPU with ~0 B/s for
  3.5 minutes (`rerun-aborted-registry-blackhole.log`). The prior run reached the mirror anyway; this
  only removes the coin flip.

---

## 1. The TUI cluster — diagnosis and repair

### 1.1 What the panes actually said

`tui-panes/pane-merged.txt` of the baseline run carries MPD's team section **drawn**, with the product's
own explanation:

```
─MPD team DAG──────────────────────────────────────────────────────────
no team in this session — `agent_teams_plan` binds one here
this workspace holds 1 team(s), none bound to this session
```

So the panel OPENED; it painted the empty state because **the fixture was bound to no session this TUI
owns**. The product was right. This is class (a) — a lane-drive defect wearing a product defect's clothes —
not class (b). No `packages/**` change was made or needed.

### 1.2 The two lane defects

**(a) A missing session materializer.** The harness writes `<DSH_HOME>/sessions/<projectKey>/<sessionId>`
only once the session APPENDS an event, and this lane's boot is COMMAND-ONLY. Provenance:

* baseline `output.log:3441` → `session=none source=--work-ws-- projectKey=session-eef73acb-…` and
  `resolve=none`, i.e. the probe answered `before=1;after=1;created=`.
* The same drive was already solved on the SANDBOX lane for this exact host generation —
  `skills/dsh-qa/scripts/tui-team-surface.ts`, step `session-materialized` (`/mpd board` + Enter).
* Controlled experiment **inside the failing container** (console transcript kept below): boot `dsh-tui`,
  wait 60 s → store unchanged (1 session); then type `/mpd board` + Enter → a second session directory
  appears within 30 s. So the command is right and only the moment was wrong.

**(b) A TSV field shift that silently corrupted the binding.** The lane reads the probe's answer with
`IFS=$'\t' read -r`, and bash STRIPS a leading run of IFS whitespace — so an EMPTY first field (the
undiscovered session id) shifted every later field one slot left. Baseline evidence:
`active={"store=/root/sandbox-dsh/sessions;before=1;after=1;created=":"tui-scene","none":"tui-scene"}` —
a team bound to two keys no session has — and `tui.teamFixtureBound` recorded **true** on that garbage.
That is a FALSE PASS in a gate row, and it also drove `tui.teamSceneOtherSessionInvisible` to a FALSE
about a state the lane had never built.

### 1.3 Per-arm disposition (baseline → final)

| arm | baseline | cause | final |
|---|---|---|---|
| `tui.teamFixtureBound` | **true on a bogus key** (false pass) | (a)+(b) | `true`, `materialized=true attempts=2 source=created-during-this-boot-under-this-project-key` |
| `tui.teamSceneOpened` | false | (a) unbound fixture + capture taken on the host's startup frame | `true` |
| `tui.teamGraphDrawn` | false (`╭1 ╮1 ╰1 ╯1`) | (a) | `true` (`╭3 ╮3 ╰3 ╯3`, record has 3 tasks) |
| `tui.teamGraphEdges` | false (`junctions=0`) | (a) | `true` (`junctions=46`) |
| `tui.teamGraphContent` | false (`missing=[T1,T2,T3]`) | (a) | `true` (`pinnedFocus=T1 detail=[T1 · requirement · freeze the contract]`) |
| `tui.mergedPanelOpens` | false (`teamHits=0`) | (a) | `true` (`teamHits=2 teamMarker=line 11`) |
| `tui.mergedPanelOrder` | false | (a) | `true` |
| `tui.teamSceneOtherSessionInvisible` | **false** (arm drove a state that was never built) | (b) | `true` |
| `tui.laneExit` | false (rollup) | the seven above | `true` |

Class (c), a stale expectation, does **not** apply to any arm: the assertions were right, the drive was not.

### 1.4 What changed in `docker/tui-lane.sh`

1. **A session materializer with the STORE as its witness** (§4.0, new). `/mpd board` + Enter is re-sent
   until `<DSH_HOME>/sessions` really changes — up to 4 attempts × (12 × 3 s poll + Esc + 2 s). It needs no
   knowledge of the host's startup string and cannot silently pass: a TUI that never materializes ends with
   `materialized=false` and the fixture stays honestly unbound. **`attempts=2` in run C proves the retry is
   load-bearing, not decoration** — the first command landed before the session was attached.
2. **An ABSENT sentinel (`-`) in the probe protocol** (`resolve` / `bind` / `index` / the marker probe) so
   an empty field can no longer shift the rest, plus the same refusal of the sentinel as an id in `bind`
   and `index`. The lane normalises `-` back to the empty string in one place.
3. **The scene capture waits for the scene, not for a clock**: the `/mpd team` capture breaks on the graph
   header or on the product's own empty-state marker instead of `sleep 6` (the baseline pane was still on
   `正在启动 DSH…`).
4. **Honest attribution**: one `SCENE_UNBOUND_NOTE` is appended to every scene arm's FALSE reason when the
   binding did not take, so such a red reads as "unmeasured fixture" and not as "the renderer dropped the
   boxes". It is empty on a green run.
5. **`tui.sessionPreset` is scoped to THIS boot's session.** It used to read the NEWEST record in the store,
   which on the baseline run was the WEB lane's session — whose record also says `agentPreset=mpd`, so the
   arm passed while measuring somebody else's session. Run C: `{"found":true,"sessionId":"3d003f24-…",
   "agentPreset":"mpd","scope":"this-boot-session"}`.

The record count did not change (21 + `tui.laneExit`), so the lane's own floor of 21 still holds.

---

## 2. The browser prerequisite — diagnosis and repair

### 2.1 The npm registry was never the problem

The baseline reason said `the browser toolchain did not install (npm/npx exit 1)`. The step log says
otherwise (`output.log:3163-3203`): `npm i playwright@1.49.1` **succeeded**, and the failure is
Playwright's own CDN:

```
Downloading Chromium 131.0.6778.33 (playwright build v1148) from https://playwright.azureedge.net/...
Error: Request to ... timed out after 30000ms     (then -akamai. and -verizon. azureedge, same 30000ms)
Failed to install browsers / Download failure, code=1
```

Measured from inside the container, `node -e fetch(...)`:

| host | result |
|---|---|
| `https://playwright.azureedge.net/` | `fetch failed` after 12603 ms |
| `https://playwright.download.prss.microsoft.com/` | `fetch failed` after 10370 ms |
| `https://cdn.npmmirror.com/binaries/playwright/` | `http=404` in 124 ms (an answer IS reachability) |
| `…/builds/chromium/1148/chromium-linux.zip` | `http=206` in 251 ms |

A SECOND measured trap, and the reason probe v1 was wrong: **a CDN ROOT can answer while the artifact path
blackholes.** Probe v1 graded the root, chose the official host on `http=400`, and the download then timed
out exactly as before:

```
PLAYWRIGHT_HOST=https://playwright.azureedge.net ROUTE=official-host-ok probeMs=3677 http=400
Error: Request to https://playwright.azureedge.net/builds/chromium/1148/chromium-linux.zip timed out after 30000ms
```

A THIRD measured trap: **the reachable mirror is incomplete for the pinned Playwright.** The mirror serves
`chromium-linux.zip` for every revision probed (1148, 1140, 1134, 1129, 1124, 1117 → all `206`) and
`chromium-headless-shell-linux.zip` for **none** of them (`404 / NoSuchKey`, and the alternate path
`builds/chromium-headless-shell/1148/…` also 404). Playwright 1.49 split `install chromium` into two
required downloads, so run B downloaded 164 MB of Chromium and then died on the headless shell.

### 2.2 What changed in `docker/entrypoint.sh`

1. **The browser transport is probed on the ARTIFACT, not the host.** After the PACKAGE install (which
   travels on the npm transport step 01b already selected), the step asks Playwright itself —
   `npx playwright install --dry-run chromium` — for every `Download url:` it will fetch, and requires the
   candidate transport to answer a byte RANGE of **every** one of them. Prefer the official host, fall back
   to the mirror, and record which served the browser.
2. **`PLAYWRIGHT_DOWNLOAD_HOST` is exported** to the chosen transport (`playwright-core`'s documented knob;
   it substitutes the CDN prefix and keeps Playwright's own `/builds/…` path, which is why the value is the
   mirror's `binaries/playwright` prefix).
3. **One cross-transport retry** when the install fails on a non-mirror transport, recorded as
   `route=mirror-retry-after-failure`, because both CDNs measured here are intermittent and the browser is
   a ~130 MB artifact fetched from ONE host.
4. **`MPD_E2E_PLAYWRIGHT_HOST`** lets a caller who knows which transport holds pin it (`route=operator-set`).
5. **The Playwright pin moved 1.49.1 → 1.48.2**, with the measurement behind it in the code: 1.48.2's
   `--dry-run` lists exactly one artifact (`builds/chromium/1140/chromium-linux.zip`, no headless shell),
   and the mirror serves it. Validated end to end in the image before the run:
   `NPM_EXIT=0`, `PW_INSTALL_EXIT=0`, `chromium-1140` + `ffmpeg-1010` on disk, and `LAUNCH_OK  ok` from a
   real `chromium.launch()`. The pin is a property of the DOWNLOAD, not of the lane's subject: on a machine
   whose official CDN answers, the probe still picks the official host.
6. **The failure reason names the transport that failed** and quotes the install log's first error line,
   instead of the misleading "npm/npx exit 1" that sent a reader looking for a registry fault for a day.

Run C's own selection line:

```
PLAYWRIGHT_HOST=https://cdn.npmmirror.com/binaries/playwright ROUTE=mirror-artifact-ok artifacts=1
  https://playwright.azureedge.net[/builds/chromium/1140/chromium-linux.zip=TypeError: fetch failed(10531ms)]
  https://cdn.npmmirror.com/binaries/playwright[/builds/chromium/1140/chromium-linux.zip=http=206(437ms)]
```

### 2.3 The `ui.*` arms are measurable now — and what they do NOT prove

All eight are `true` in run C, and seven carry a real GUI measurement (screenshots in
`evidence/docker/client-install/2026-10-14T13-51-46Z/ui-shots/`).

**`ui.replyRendered` does NOT prove a model turn ran, and this report does not claim it.** The container
stages no credential, and the screenshot shows the turn failing:

```
This turn failed   llm-deepseek: no API key for provider route "deepseek-official"; store
DEEPSEEK_API_KEY through the MISSING_CREDENTIAL credentials service …
```

`ui-02-sent.png` and `ui-03-reply.png` are **byte-identical** (`sha256 7264554d…bd017`). The arm passed on
the transcript GROWTH caused by that failure panel, plus a `/\bDONE\b/` match that the user's own prompt
supplies (`PROMPT = "Call the mpd_config_get tool once …, then reply with exactly: DONE"`). See FINDING 2.

---

## 3. What was verified, and what was not

**Verified (observed, quoted above):**

* `node scripts/docker-e2e.ts --self-test` → **exit 0**, 191 `ok` arms, "all arms passed (offline: no
  docker, no network)" — re-run after the final edit. This is the offline falsifier for the shared panel
  classifier (`docker/lib/tui-panel-body.ts`) and for the driver's required-arm contract.
* `bash -n docker/entrypoint.sh` and `bash -n docker/tui-lane.sh` → both clean.
* The two `node -e` probe programs embedded in shell single-quoted arguments were extracted and checked to
  contain **zero** single quotes (one such quote was found and removed during development — it would have
  terminated the argument early).
* The probe protocol was exercised offline in all five modes: the sentinel is emitted for an absent
  session id, the fields stay in their slots, a sibling id survives in its own field, and both `bind` and
  `index` REFUSE the sentinel as an id.
* The image was rebuilt and confirmed to carry the edited drivers byte-identically (`sha256` of
  `/opt/mpd-e2e/entrypoint.sh` and `/opt/mpd-e2e/tui-lane.sh` equal to the tree's).
* `bun run verify:comments` → PASS (unaffected: it scans TypeScript, and the TS here lives in `.sh`
  heredocs; run anyway). No `packages/**`, `skills/**` or doc file was touched, so the dist/vendor/docs/
  manifest gates are not affected by this change set.

**Not verified / bounds:**

* **One run of each revision is the whole sample.** Runs A/B/C each ran once; the TUI cluster is green in C
  only, and while the mechanism is explained and instrumented (`materialized`, `attempts`, the store delta,
  the bound key), a second green run was not paid for.
* **The browser download rate is not controlled.** Measured from this container: ~5.2 MB/s on a fresh 5 MB
  ranged fetch, ~127–150 KB/s on Playwright's long-lived connection (run B took ~26 min for 164 MB; run C
  completed in ~95 s). The driver now picks a transport that ANSWERS; how fast it serves is the network's.
  A future run on a bad edge is slow, not wrong.
* **`qa.mcpCallEngine` is a flake, not a regression.** It passed in the baseline and in run C and failed in
  run B with "the ast-grep engine is NOT staged where the mcp-call launcher resolves it". Nothing in this
  change set touches that path (the step is `09d-astgrep-engine`, which took 105 s in B).
* **The two `node -e` probes are only exercised by a real run** (run C), not by `--self-test`, which does
  not start Docker.

## 4. Findings (reported, NOT fixed — outside this scope)

1. **`docker/lib/browser-lane.ts` — `ui.replyRendered` is satisfiable without a reply.** Its predicate is
   `/\bDONE\b/.test(seen) || transcriptGrew`, and `DONE` is in the prompt the lane itself types, so the
   echoed user message satisfies it; the `transcriptGrew` clause is satisfied by the ERROR panel a failed
   turn renders. In a credential-free environment the arm therefore reports a GUI turn that never rendered.
   It should not be reachable by the echoed prompt, and a `MISSING_CREDENTIAL` transcript should be a
   declared bound rather than a pass. *(Product-side code is untouched by this repair.)*
2. **`docker/entrypoint.sh` — a message string executes `dsh plugin`.** Line ~410:
   `fact obs.npmrc "$(head -n 1 "$HOME/.npmrc") (… every \`dsh plugin\` …)"` — the backticks are COMMAND
   SUBSTITUTION, not quoting, so every run prints `/opt/mpd-e2e/entrypoint.sh: line 410: dsh: command not
   found` and the observation text loses the words. It is visible in the baseline run's own output
   (`npmrc = … and therefore every  — resolves …`, `output.log:56`) and in every run since. Harmless to the
   exit code; misleading in a log. Not fixed here to keep this diff on its assigned subject.
3. **`docker/entrypoint.sh` step 01b grades METADATA only.** Its whole reason for existing is "npm hangs
   silently on an unreachable endpoint", yet a registry whose metadata answers and whose TARBALLS blackhole
   passes the probe and then stalls the install (measured: `rerun-aborted-registry-blackhole.log`). A
   tarball-range probe would close that hole.

## 5. Evidence index

| path | what it holds |
|---|---|
| `docker/tui-lane.sh`, `docker/entrypoint.sh` | the change (`sha256` below) |
| `rerun-aborted-registry-blackhole.log` | the run killed on the npm registry stall |
| `rerun-A-drive-fix.log` | run A, the materializer's first (single-shot) version |
| `rerun-B-browser-probe-v1.log` | run B, root-probed transport + the headless-shell 404 |
| `rerun-C-final.log` | run C, the final lane (exit 0) |
| `evidence/docker/client-install/2026-10-14T13-51-46Z/` | run C: `result.json`, `driver.json`, `output.log`, `tui-panes/`, `ui-shots/` |
| `evidence/docker/client-install/2026-10-14T11-58-50Z/` | the baseline the repair is measured against |

Final revisions of the two edited files:

```
fc579e0e21e2e1972eb7081a011a4da05c2df206875cd9169598ff9b3669ee8e  docker/entrypoint.sh
cabadd63efacbc72581d0f3be9948c216221dbfb4a4b9b34108991b9062c4943  docker/tui-lane.sh
```

Run A used `sha256 entrypoint 9309853f…e184b / tui-lane 5173575c…0bb338` (the single-shot materializer and
the root-graded transport probe). Run B used `entrypoint d746bde3…e4f00a / tui-lane cabadd63e…2c4943` (the
artifact probe and the retrying materializer). Run C used the final hashes above; only `entrypoint.sh`
changed between B and C (the Playwright pin and the all-artifacts probe).
