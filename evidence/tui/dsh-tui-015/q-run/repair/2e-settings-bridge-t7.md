# STEP 2e — `tui-settings-bridge` T7 (zero-write): WHICH write, WHERE it comes from, and the verdict

Lane: `tui-settings-bridge` (T7 lives in `skills/dsh-qa/scripts/lib/settings-bridge-lane.ts`,
`evaluateTuiSurface`).

## 1. Re-run against the rebuilt dist

```
$ sha256sum packages/mpd-tui-plugin/dist/index.js
529b2eb7363d94311ed43515c96a519dabac2f5656bfd05712b256e7b188e26e  packages/mpd-tui-plugin/dist/index.js
mtime 2026-10-14 16:20:27 +0800   (== the revision the T8 run measured: `revision.sha256` in
                                   evidence/tui/dsh-tui-015/q-run/tui-deps-ctrla.evidence/result.json)
```
The dist under test is the working-tree rebuild (marked ` M` by `git status`), i.e. the same bytes the
T8 run judged, and the adapter's own `src/index.ts` is also modified in this wave. T7 reddened on this
dist (T8: `T7: FAIL … offenders: ["writeFileSync","appendFileSync","mkdirSync","rmSync"]`).

## 2. WHICH write, and WHERE it comes from — measured on the built bytes

The dist carries **12 write-API occurrences**, and `bun build`'s own path comments attribute every one
of them to a module that is NOT this package:

```
$ bun <attribution probe over packages/mpd-tui-plugin/dist/index.js>
mkdirSync      | packages/mpd-mcp-shared/log-sink.ts               | excused
rmSync         | packages/mpd-mcp-shared/log-sink.ts               | excused
mkdirSync      | packages/mpd-mcp-shared/log-sink.ts               | excused
rmSync         | packages/mpd-mcp-shared/log-sink.ts               | excused
writeFileSync  | packages/mpd-tui-adapter-plugin/src/index.ts      | excused
appendFileSync | packages/mpd-tui-adapter-plugin/src/index.ts      | excused
mkdirSync      | packages/mpd-tui-adapter-plugin/src/index.ts      | excused
mkdirSync      | packages/mpd-tui-adapter-plugin/src/index.ts      | excused
writeFileSync  | packages/mpd-tui-adapter-plugin/src/index.ts      | excused
appendFileSync | packages/mpd-tui-adapter-plugin/src/index.ts      | excused
mkdirSync      | packages/mpd-tui-adapter-plugin/src/index.ts      | excused
writeFileSync  | packages/mpd-tui-adapter-plugin/src/index.ts      | excused
own-module offenders: (none)
```

- `packages/mpd-mcp-shared/log-sink.ts` — the rotating log sink (`closeSync/openSync/renameSync/writeSync` + `mkdirSync`/`rmSync`), inlined at dist line ~1047.
- `packages/mpd-tui-adapter-plugin/src/index.ts` — the adapter's OWN file sink (`appendFileSync`, dist ~2587) and `recordPanelIds()` writing `<root>/.mpd/logs/mpd-tui-panels.json` (`mkdirSync` + `writeFileSync`, dist ~3110).
- `packages/mpd-tui-plugin/src/**` — **no writer at all**: `grep -rn "writeFileSync|appendFileSync|mkdirSync|rmSync|cpSync|unlinkSync|createWriteStream" packages/mpd-tui-plugin/src/` returns only the two COMMENTS in `src/watchdog.ts` that state the invariant, and `src/log.ts` says the sink "comes from the seam adapter (`tui.diagnosticSink(...)`), which is also where the file primitives live".

## 3. When the writers entered the TUI dist (pre-existing, not this wave)

```
$ for i in 20 18 16; do git show HEAD~$i:packages/mpd-tui-plugin/dist/index.js | grep -c 'writeFileSync|appendFileSync|mkdirSync|rmSync'; done
HEAD~20 -> 0
HEAD~18 -> 0
HEAD~16 -> 9
```
The bundle gained the write names between `HEAD~18` and `HEAD~16`, i.e. in the v0.12.0 seam era
(`9e91beb3 feat(seams)!: one adapter per plane, zero host overrides, R5 terminal silence` and the commits
around it) — **long before wave tui-015-adaptation**, so this is NOT a new regression introduced by the
0.15.0 work.

## 4. Verdict: stale LANE PATTERN, updated — not a packages regression

The invariant is real and stays pinned, but its SUBJECT is the package's own modules: `bun build`
INLINES imported modules, and this entry legitimately imports the adapter that OWNS the diagnostics file
sink (requirement R5 is satisfied precisely because the plugin asks the adapter for a sink instead of
writing files itself). A whole-bundle grep counts BORROWED bytes.

Repair (in `skills/dsh-qa/scripts/lib/settings-bridge-lane.ts`):
- new exported `TUI_WRITE_APIS` + `ownModuleWriteOffenders(dist)`: attributes every occurrence to the
  `// packages/…` path comment above it and returns only the ones under
  `packages/mpd-tui-plugin/src/`. **FAIL-CLOSED**: an occurrence in no segment at all (a dist that
  stopped emitting path comments, or text appended after the last one) counts as an OFFENDER.
- `T7` now reads that helper; `tui-settings-bridge.ts`'s header comment was updated to the RUNNING-process
  wording (its old text still said "after a restart").
- three new self-test controls pin the behaviour: a writer borrowed from an inlined dependency module is
  EXCUSED, the same writer under `packages/mpd-tui-plugin/src/index.ts` reddens, and an UNATTRIBUTED
  writer reddens. The existing `T7` fault (append `writeFileSync(`) still flips the check, because the
  appended text sits in the last segment, `// packages/mpd-tui-plugin/src/index.ts`.

```
$ bun skills/dsh-qa/scripts/tui-settings-bridge.ts --self-test
[tui-settings-bridge self-test] ok: 19 web-arm + 8 TUI-arm + 4 client-shape injected faults each flip
their own check; all three synthetic green artifacts pass
exit=0
```

## Bounce decision

**No bounce to the captain**: nothing in `packages/**` needs changing for T7. The only packages-side
judgement this leaves open (stated, not decided here) is whether inlining the adapter's file sink into
the TUI bundle is itself acceptable — that is the adapter's DESIGN (`src/log.ts`'s comment and the R5
requirement say the sink belongs to the adapter), so this lane treats it as sanctioned and pins the
package's own modules instead.
