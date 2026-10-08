# Lane E2 evidence index — the snake acceptance run and its independent driver

UTC stamp: `20261008T074338Z`. Contract: `.mpd/plans/lane-e2-snake-verification.md`.
Read `result.json` first; it is the machine-readable verdict. This file is the map.

## The short version

A real model turn ran inside a bare `ubuntu:24.04` container, asked (verbatim, through the E1 knob
`MPD_E2E_LIVE_PROMPT`) for a one-file playable Snake. It wrote `snake/index.html` (11,241 B, sha256
`578a7993…b1a61a5d`), and this lane then drove that file **black-box** in a real Chromium with the
network switched off: **all 8 assertion rows pass**. The same driver revision is **RED** on a
deliberately inert page and **GREEN** on two known-good snakes it had never seen, so the green verdict
is falsifiable in both directions.

## Files

| File | What it holds |
|---|---|
| `result.json` | the machine-readable verdict: invocation, artifact, assertions, controls, container verdict, scan |
| `live-prompt-invocation.txt` | the exact command, with the credential replaced by `<staged>`, and why it travels by NAME |
| `e1-d-live-prompt-observation.md` | the container's `[live-prompt]` line, snapshotted with its source hash — this CLOSES lane E1's `E1-d` by observation |
| `artifact/snake/index.html` | **the deliverable**, rescued out of the container before `--rm` deleted it |
| `artifact/ws-listing.txt` | the container-side listing of `/work/ws` at the moment of the copy |
| `live-turn-transcript.log` | the step-15 turn's own transcript (51,283 B), extracted from the lane's echoed log |
| `live-headless-rows.txt` | every `live.headless.*` verdict row the container recorded |
| `lane-verdict-summary.md` | the container's own verdict: exit code, FAILED and NULL rows, quoted |
| `lane/lane-result.json`, `lane/lane-driver.json` | copies of the lane's own reporting files (E2-f) |
| `snake-live.log` / `snake-live.ndjson` | the driver's transcript and its NDJSON assertion ledger on the artifact |
| `snake-live-01-start.png` | screenshot 1 — the page at rest |
| `snake-live-03-after-eating.png` | screenshot 2 — score 10, snake grown, food on the board |
| `snake-live-05-game-over.png` | screenshot 3 — the game-over state after steering into the wall |
| `negative-control/` + `negative-control.ndjson` + `negative-control-*.png` | the mandated control whose job is to REDDEN |
| `positive-control-canvas/`, `positive-control-dom/` (+ their logs and shots) | the known-good pages that must PASS, one per rendering style |
| `artifact-canvas-probe.log` | the diagnostic that found why the first sensor read offered the snake's own body as food |
| `secret-scan.log` | E2-e: the credential scan of this whole directory |
| `isolation-probe-before.txt` | the operator's real home, read only, recorded before the run |
| `driver/` | the driver, its runner, two probes and the artifact watcher |

## Why the driver lives here and not under `docker/`

Contract §6 allows a driver under `docker/` only when it is **genuinely reusable and gated**. This one
is neither: its assertions are snake semantics (`score increased`, `game over after a wall`), it has no
gate to attach to, and `docker/` was being edited by another lane during this run. It is lane evidence,
so it stays in the lane's evidence directory, with its revision hash recorded in `result.json`.

## Reproducing

```bash
cd evidence/docker/snake/20261008T074338Z
./driver/run-driver.sh "$PWD" artifact/snake/index.html snake-live 60000 "note"
./driver/run-driver.sh "$PWD" negative-control/index.html negative-control 25000 "must redden"
node driver/secret-scan.mts "$PWD"
```

`run-driver.sh` needs `mpd-snake-driver:local`, which is `mpd-docker-e2e:local` plus the shared
libraries Chromium links against; it mounts the project's own `ui_ui-data` browser volume READ-ONLY and
runs with `--network none`. Nothing is installed into the operator's home.
