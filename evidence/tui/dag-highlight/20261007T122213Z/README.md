# `tui-dag-highlight` — the wave's acceptance evidence (frozen revision)

**Aggregate hash of the FINAL frozen revision** (`sha256` over `packages/mpd-tui-plugin/src/*.ts` +
`dist/index.js`, in filename order): `14a28d8b2312b0c3c37e1e71130b4d20cc00d9957eddf243ebbaf0a12e2af7aa`
— read at **2026-10-07T12:29:33Z** and again at **2026-10-07T12:32:23Z**, IDENTICAL (see
`hashes.txt`). An EARLIER frozen revision (`97952cde…`, 12:22:07Z → 12:23:28Z) is what the `pty/`
capture and `pty-defect/` describe; that revision carried a real layout defect found by the PTY (below),
which is why the directory holds both a before and an after capture. Every lane is inactive.

| Artifact | What it is | What it PROVES | What it does NOT prove |
|---|---|---|---|
| `acceptance.log` | The captain's acceptance instrument (`acceptance.ts`) run against the frozen revision, 80×40, on the `team-dag-verify` fixture | AC1–AC8, one arm each. `8/8 criteria PASS` | Nothing about pointer DELIVERY (see the bound below) |
| `acceptance.ts` | That instrument: it mounts the REAL page components against a React double, renders, drives handlers, and reads the resulting colour/bold/dim props and drawn text | It is FALSIFIABLE: the same instrument read **0/5** on the pre-fix tree (AC4's line read `pinned T3=false, pinned the leftmost T2=true`) and reads 8/8 here | It drives handlers DIRECTLY; it never asks a terminal to deliver an event |
| `gates.log` | `bun test packages/mpd-tui-plugin`, `bun run typecheck`, `bun run verify:comments`, `bun run verify:docs`, `node scripts/verify-dist-fresh.ts`, on the frozen revision | 413 pass / 0 fail · typecheck exit 0 · comments PASS · docs PASS (47 pairs) · dist 30/30 fresh | — |
| `pty-final/w220/` | A REAL terminal capture of the **final** revision, same harness | The `⤢` control now occupies a cell at the RIGHT EDGE of the DAG page's title row — byte-exact line 5: `││MPD DAG <spaces> ⤢│` (U+2922). This is the AFTER half of the layout defect below | — |
| `pty/w100/` and `pty/w220/` | A REAL terminal capture of the EARLIER revision (private tmux socket, sandbox `DSH_HOME`, sandbox `HOME`, sandboxed workspace cwd) of the DAG page | The HOST painted it: the compact rounded three-row boxes, the `✓ T1` / `○ T2` / `○ T3` labels, two boxes sharing one rank, the arrows, and the panel bar reading `≡ ▸ ◆ ❖ ‹ MPD DAG › ⬢` — i.e. the merged page wearing `❖` instead of the letter `M`, and the workmate page wearing `⬢` instead of `◆` (which was byte-identical to the host's own `agents` tab) | It does not drive a mouse; the capture is of the RENDER |
| `probe-click.log` + `probe-click.ts` | The ORIGINAL pre-fix instrument, run unchanged on the frozen revision | It is kept as the BEFORE control — its own log names the row that draws `T3` and the `▶` that lands on `T2` | **It is NOT discriminating, and it says so itself.** It sends `{localCol: 0}`, and column 0 lies INSIDE the left box (T2 cols 0–9, T3 cols 13–22 on the same rows), so it pins T2 before AND after the fix. Measured by the Interaction lane, not by the captain. The discriminating coordinates live in `discriminate-click.log` and in `acceptance.log`'s AC4 arm |
| `discriminate-click.log` + `.ts` | The Interaction lane's discriminating instrument: same row, same handler, the box's OWN column | `hitTest(row 6, col 0) -> T2`, `hitTest(row 6, col 14) -> T3`, and after a click at `localCol 14`: the pin marker is on T3 and NOT on T2 | — |

## The honest bound, stated rather than implied

**Pointer-coordinate DELIVERY is declared, not proven.** Whether a terminal and this host actually hand
`onClick` / `onDragStart` usable `localRow` / `localCol` to a row `Box` inside a plugin sidebar panel is
not provable by any unit arm in this repository: every headless arm drives the handler directly, and the
PTY lane proves the RENDER. The host-side contract was READ and quoted (the narrowed plugin kit keeps
drag; `ink/components/Box.js` forwards the drag props; `pointer-event.js` recomputes `localCol`/`localRow`
per handler from the node's rect; `findDragTarget` walks ancestors for `onDragStart`; a drag session only
opens under the alternate screen) — reading a contract is not the same as observing delivery, and this
directory claims exactly the weaker thing.

## Environment defects found while taking this evidence (recorded, not held against the wave)

1. `mpd_verify_open` returns a value the harness cannot serialize ("value is not lossless JSON"). The loop
   IS written to disk (`.mpd/verify/loops/loop-20261007T120525-04d808.json`, status `armed`); only the
   caller never receives its id.
2. A bound verifier's envelope refuses `packages/*/README.md` and all of `evidence/**` while BLIND, which
   is narrower than the contract's §5 as first frozen. The citable home is `docs/tui.md` §3.4 + §11.5
   (and the `docs/tui.zh-CN.md` twin).
3. A team member cannot close its own board task: `agent_teams_task` answers
   `no team record in this workspace — approve a plan first` from a member session, and the captain is
   refused with `neither that owner nor this team's lead`. The board is therefore NOT a record of what
   finished; the lane reports and this directory are.

## Independent verification (a DIFFERENT agent's recorded verdict)

`verification/rec-20261007T123846-c9a991.json` — **PASS**, loop `loop-20261007T120525-04d808`, recorded by
a seat that read NO implementation file before recording (a fresh seat, spawned because the mechanical
`[blind-spent]` ratchet bars a seat that has once recorded a FAIL from ever recording that loop's PASS).

`verification/rec-20261007T123439-15d9ec.json` — the EARLIER seat's **FAIL**, kept on purpose: it is the
record that found finding **DOC-1** (`docs/tui.md` §3.3 still declared the workmate icon `◆` in the
present tense while §3.4/§11.5 declared `⬢`; same in the zh twin), which was repaired BEFORE the PASS.
`verification/rep-20261007T123439-87f654.json` is the repair it opened.

The verdict rests on the verifier's OWN bound runs: `tests` `ev-20261007T123812-e7850e` (1603 pass /
3 skip / 0 fail) · `typecheck` `ev-20261007T123825-e89b70` · `comments` `ev-20261007T123825-42c8fc` ·
`docs` `ev-20261007T123827-9d1123` · `dist` `ev-20261007T123827-6b90ef` (`30/30 targets fresh`, pinned
bun 1.4.0) · one probe witnessing 10 paths content-free. Its `sources` carry the sha256 of each document
it read, so the PASS is bound to the exact texts.

The verifier's two bounds are carried VERBATIM in the record: pointer-coordinate **DELIVERY is declared,
not proven**, and **artifact CONTENTS are unreadable to a bound seat** (existence, size and sha256 only).
Its PASS is exactly that much and no more. It also recorded five non-blocking observations, of which the
one worth chasing outside this wave is that the seat's FROZEN-DOC RESOLUTION hands every verifier the
PREVIOUS wave's plans (`.mpd/verify/seats.json`), forcing each seat to re-derive its citable band by hand
— a defect of the seat-resolution path, not of this wave.
