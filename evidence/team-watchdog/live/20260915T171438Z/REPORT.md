# t68 — w10 independent verification of the five watchdog lanes

**Verdict: PASS.** All five lanes were re-run by me from a clean sandbox I created, all five `--self-test`s
pass with named negative controls, both tree gates pass, and every mechanism the captain named was traced
to the REAL thing rather than a proxy. **No defects found, no fixes made, no lane edited.**

Evidence root (mine, fresh): `evidence/team-watchdog/live/20260915T171438Z/`
(`raw/{heartbeat,fault,scene,config,notify}.log`, `raw/gates-and-selftests.log`, `raw/exits.txt`, and each
lane's own timestamped output under `<lane>/`).

## 1. The five re-runs — raw results

```
bun skills/dsh-qa/scripts/team-watchdog-heartbeat.mjs --out …/heartbeat   exit=0  PASS — 13 checks, 0 failed
bun skills/dsh-qa/scripts/team-watchdog-fault.mjs     --out …/fault       exit=0  PASS — 11 checks, 0 failed
bun skills/dsh-qa/scripts/team-watchdog-scene.mjs     --out …/scene       exit=0  PASS — 10 checks, 0 failed
bun skills/dsh-qa/scripts/team-watchdog-config.mjs    --out …/config      exit=0  PASS — 10 checks, 0 failed
bun skills/dsh-qa/scripts/team-watchdog-notify.mjs --surface both --out …/notify
                                                                          exit=0  PASS — 18 checks, 0 failed
```

Each lane wrote its own fresh timestamped directory under MY root (no implementer directory reused), and
each `result.json` records `ok=true` with every check passing (`notClaimed` counts: 2 / 4 / 2 / 2 / 2).

## 2. Tree gates — the revision I judged is the pinned one

```
node scripts/verify-vendor.mjs   -> [verify-vendor] PASS  (asset OK: _deps 635 files, 4 MCP dists)
bun run verify:docs              -> [verify-docs-parity] pairs=34 failed=0 exempt=15 — PASS
```

## 3. The five `--self-test`s — every negative control flips its own check

```
heartbeat: PASS (7 checks)   negative:captain→H8, negative:fresh-read→H9, negative:pre-dispatch→H5
fault:     PASS (10 checks)  negative:captain-missed→F5, negative:scene-hold-mismatch→F9, negative:not-claimed-dropped→F10
scene:     PASS (7 checks)   negative:log-shorter→S7, negative:pointer→S9, negative:fresh-process→S1
config:    PASS (8 checks)   negative:restart-needed→C8, negative:no-clamp→C9, negative:halt-action→C10
notify:    PASS (15 checks)  negative:bytes→T7, negative:bytes-unchanged→N1, negative:fallback-hidden→N2
```

Every mutation names the check that goes red — so no lane can pass vacuously.

## 4. The four specific mechanisms, traced to source

**(a) heartbeat's "fresh process reads the stamps back with plain fs" — REAL.**
`skills/dsh-qa/scripts/lib/watchdog-lane.mjs:138 freshProcessRead(paths)` spawns a **separate
`process.execPath` child** running an inline script whose entire toolset is `node:fs`
(`readFileSync`/`existsSync`) and which prints `{pid, node, reads}`:

```js
const child = spawnSync(process.execPath, ["-e", script, JSON.stringify(paths)], …)
```

No plugin import, no lane module state, no mount — the lane cannot make the read succeed by its own
caches. The self-test enforces it (`negative:fresh-read → H9 "a read that did not come from a fresh
process"`).

**(b) fault's AC-17 contrast — the REAL adopted `haltTeamWork` is CALLED, with a FATAL guard.**
The fixture (`packages/mpd-team-watchdog-plugin/test/fixtures/inject.mjs`) refuses to proceed if the real
export is absent and then calls it:

```js
562  if (typeof tools.haltTeamWork !== "function") {
563    return { ok: false, observation: { error: "haltTeamWork is not exported by the adopted lib" }, … }
567  const result = await tools.haltTeamWork({ … })
579  mechanism: "haltTeamWork (the adopted mass-cancel path), imported from packages/mpd-agent-teams-plugin/lib/tools.js and CALLED — never stubbed",
```

and the export is real: `packages/mpd-agent-teams-plugin/lib/tools.js:268 export async function
haltTeamWork(input) {`. The lane reads that observation and asserts it
(`fault.mjs:65 F8 … cancelledTasks >= 1 && sha256Changed === true && wouldReddenAC17 === true`).

**The fixture's NOT_CLAIMED entries are repeated BYTE-IDENTICALLY, enforced** — the lane compares the echo
against the fixture's own export index by index:

```js
73  add("F10", echoed.length === (observed.notClaimedSource ?? []).length && echoed.every((line, index) => line === (observed.notClaimedSource ?? [])[index]),
74    "the fixture's NOT_CLAIMED entries are repeated VERBATIM (" + echoed.length + " entries, byte-identical)")
```

against `inject.mjs:706 export const NOT_CLAIMED = [ … ]`, including "`haltTeamWork` cancels; the fixture
does not claim that the halt path is ever the RIGHT mechanism" (`:710`). A paraphrase or a dropped entry
goes RED — proven by `negative:not-claimed-dropped → F10`.

**(c) notify's web arm — the REAL built bytes driven by the REAL route payload, not source strings.**
`team-watchdog-notify.mjs:29 webClient: join(REPO, "packages", "mpd-bundle-plugin", "client.js")` (the
**built** bundle client) and `:32 webHarness: …/test/client-harness.mjs` (the offline hook runtime). W1–W3
assert on the payload the route just produced and on the tree that payload renders
(`web.payload?.banner?.incidentId === web.incidentId && … replay === true`, one activity record with
`ackRequired === true`, and a first poll that fetches with no user action). Self-test negative
`negative:bytes → T7 "built TUI bytes with no notice/dialog wiring"` proves the byte assertions are
falsifiable.

**(d) config's live re-read — no restart required.**
`team-watchdog-config.mjs:83 const fired = await mounted.fire("settings/document-updated", "mpd", 7)` fires
the host's own raw-section event through the adapter bridge on the mounted REAL engine, then reads the live
knobs: the run printed `settings/document-updated listeners fired: 1 — live knobs:
{warnSilenceMs:30000, tickIntervalMs:10000, warnStreakToEscalate:3, …}` with the clamp reported
(`must be < watchdog.warnSilenceMs (30000); clamped`). Negative `restart-needed → C8` proves a
restart-only re-read would go red. The lane discloses the level: "driven through the adapter's own
`settings/document-updated` bridge on a stub harness (the host's event, the real row) — not through a live
GUI session".

## 5. NOT-CLAIMED honesty check

Nothing marked not-claimed is in fact witnessed, and nothing claimed is unwitnessed:

| lane | NOT_CLAIMED items | my check |
|---|---|---|
| heartbeat | no LIVE member turn; no pre-dispatch tool stamp | consistent — the witness is the mounted real plugin + host events read by a fresh process; no live turn was driven by me either |
| fault | W-3 genuine wedge not reproducible; harness stubbed; no live host; halt is not the RIGHT mechanism | consistent — I verified the halt path IS the real adopted one and that the fixture says only that it *would* redden AC-17 |
| scene | snapshot is injected silence; scene produced in-process, read from outside | consistent with the plain-fs fresh-process read I traced |
| config | live re-read via the adapter bridge on a stub harness; clamp from the running engine | consistent — I traced the event firing and the engine-reported knobs |
| notify | no browser render, no TTY keystroke drive; permanent-redisplay fallback stated | consistent — the built client runs in the offline hook runtime, `fetch` served by the route payload |

The synthetic layers are disclosed in every lane where they exist (fault/config use the word "stub";
heartbeat/scene/notify describe the synthetic event injection and the offline runtime instead) — no lane
hides a proxy behind a claim.

## 6. What I could NOT verify here, and why

- **No live model turn**: this environment has no model credentials, so a real member turn, a real provider
  wedge (the fixture's W-3) and any model-driven behaviour are unwitnessed — disclosed by the lanes
  themselves and true of my re-run too.
- **No browser and no real TTY**: the web panel's rendered output is asserted through the offline hook
  runtime over the real built client, and the TUI arm asserts composed values + the real watermark file;
  a keystroke drive belongs to `tui-panels`.
- **I could not mutate a lane to falsify it myself** (the task forbids edits to `skills/**`), so the
  falsification of expectations is the lanes' own `--self-test` negative controls, which I re-ran and which
  name the exact check each mutation reddens.
- I spot-checked the fixture's halt leg and its NOT_CLAIMED list; I did not re-derive every fixture case's
  internal arithmetic beyond the lane-level assertions and their negative controls.

## 7. Outcome

No finding to report: every claim I could test reproduced, every mechanism named by the captain is the REAL
thing (this process's plain-fs reader; the imported-and-called adopted halt path with a FATAL stub guard;
the built client driven by the route payload; a live re-read through the host's own event), and the
not-claimed set is honest in all five lanes.
