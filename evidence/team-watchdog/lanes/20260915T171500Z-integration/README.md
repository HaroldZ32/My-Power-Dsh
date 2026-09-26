# w9 — the five team-watchdog QA lanes (t67)

Five first-class lanes under `skills/dsh-qa/scripts/`, each registered as a row in `skills/dsh-qa/SKILL.md`
and each shipping a `--self-test` whose NEGATIVE controls prove its assertions are falsifiable. All five
were run for real: their evidence lives in the sibling `<timestamp>-<lane>/` directories of this one.

| Lane | ACs | What it drives (real artifacts only) |
|---|---|---|
| `team-watchdog-heartbeat.mjs` | AC-1, AC-2 | mounts the REAL watchdog dist over the REAL adapter seam and drives the host's own event sequence for a member AND the captain; a FRESH `node` process reads the stamps back with plain fs; the tool stamp is asserted POST-completion-only (W-9), and no live member turn is claimed. |
| `team-watchdog-fault.mjs` | AC-3, AC-4, AC-9, AC-10, AC-17 | drives the VERIFIED w8 fixture (`runAll`) — all seven injected-silence cases — asserts each case's OWN observation fields, exposes the AC-17 halt-vs-pause contrast, and REPEATS the fixture's four `NOT_CLAIMED` entries verbatim. |
| `team-watchdog-scene.mjs` | AC-5, AC-10 | produces the escalation scene through the fixture's real engine, then re-reads `latest.json`, the immutable per-incident scene, the hold sidecar and `incidents.jsonl` from a FRESH process with plain fs; asserts the contracted field set. |
| `team-watchdog-config.mjs` | AC-11 | the five knobs in the ONE declaration and in BOTH front doors' BUILT bytes (set equality), the row-vs-namespace precedence, the LIVE re-read through `settings/document-updated` (no restart), and the measured clamp (`tickIntervalMs` below `warnSilenceMs`). |
| `team-watchdog-notify.mjs` | AC-12, AC-13, AC-14 | BOTH front doors: the web arm drives the REAL bundle route handlers + the REAL built `client.js` in the offline hook runtime (banner as the panel root's first child, one record, first-poll replay, acknowledge advancing only its own reader key); the TUI arm drives the REAL `mpdWatchdog` service through the REAL TUI module (composed status notice, replay dialog, `mpd-tui` watermark, replay stop). |

Shared plumbing: `skills/dsh-qa/scripts/lib/watchdog-lane.mjs` (stub context + the REAL `createDshAdapter`,
sandbox workspaces, plain-fs store readers, the fresh-process reader, the mandatory negative-control
scaffold).

**Deferred W14/W15 half landed** (and only that half): `skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs`
now reads `settings/describe` explicitly (`findNamespaceDescriptor`), names that read-back surface in the
result and asserts **W15** (the describe value agrees) and **W14** (the settings namespace's resolved value
equals the value the file on disk carries, read independently through a minimal JSONC reader), with two new
negative controls. The patch's `packages/mpd-tui-plugin` half stays DEFERRED with its notice-ordering
correction (the base notice must not pre-empt the write-skip notice).

## Gates on the settled tree (raw logs beside this file)

* `bun run verify:docs` → PASS (34 pairs, 0 failed) · `bun run typecheck` → exit 0.
* Every `skills/dsh-qa/scripts/*.mjs --self-test`, run INDIVIDUALLY: **40 pass, 1 fail** — the single
  failure is `agent-teams-messaging.mjs`, i.e. the owed VENDOR_LOCK skills pairing, not a code failure.
  The aggregate `bun run test:qa` aborts at that same case, which is why the individual sweep is the
  complete picture (`raw/selftests-individual.log`).
* `node scripts/verify-vendor.mjs` → **FAIL, as the contract expects**: `asset skills count drifted: 316 vs
  310` + `asset skills treeSha mismatch`. Tool-printed pre-commit state: **`tree=316/10c945f47a5e`** (pinned
  310/`8ec53287296e`). `VENDOR_LOCK.json` is OUT of this task's scope: the captain's re-pin lands in the
  SAME commit as these skills changes (AGENTS.md §9/§11).

## NOT CLAIMED

* No genuine provider wedge (the fixture's W-3) and no live dsh host/model turn: the heartbeat lane states
  that leg explicitly and asserts the strongest available witness instead.
* No real browser render and no real TTY keystroke drive: the notify lane asserts the rendered tree through
  the offline hook runtime and the TUI's composed status value + dialog request + the real watermark file.
* The honest fallback is stated in every notify result: without an acknowledge the replay is PERMANENT
  RE-DISPLAY BY DESIGN.
