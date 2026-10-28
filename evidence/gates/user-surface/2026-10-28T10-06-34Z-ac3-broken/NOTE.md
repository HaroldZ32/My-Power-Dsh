# AC-3 negative control — a composition whose `/mpd-codegraph` is unreachable REDDENS

This run is DELIBERATELY BROKEN; its red is the point. It is the live half of
`.mpd/plans/fix-codegraph.md` AC-3.

## The ONE difference from the green run

`evidence/gates/user-surface/2026-10-28T10-04-49Z-ac3-green/` boots `dist/mpd-package`. This run boots a
byte copy of that pack in which exactly one file — `packages/mpd-codegraph-plugin/dist/index.js` — is the
PRE-FIX build taken from git HEAD:

    git show HEAD:packages/mpd-codegraph-plugin/dist/index.js \
      > <broken pack>/packages/mpd-codegraph-plugin/dist/index.js

- pre-fix build: `sha256 8b13219fbaf1f8e49889df201a5b78d6f66f0768a4874e3a83f547c1ce2dfce2`,
  declaring `var inject = [];` (line 1996) — the D-1 boot-order race: the row mounts ACTIVE, logs
  `init status=ok`, and `/mpd-codegraph` never reaches the registry.
- fixed build: `sha256 9da754c45b39c63952e6fa5aa2ff73a4e0a2363f06e9ca4aac46040b7bb43237`,
  declaring `var inject = dshSeamInject(DSH_SEAM_COMMANDS)`.

Harness, TUI, preset, every other row and the case itself are identical to the green run.

## Observed

    assertions=119 passed=85 failed=1 findings_or_bounds=33 FAILED=[userSurface.command.mpd-codegraph]
    boot failures=[]   problems=0   commands=33   exit 1

| assertion | verdict | raw |
|---|---|---|
| `userSurface.command.mpd-codegraph` | **FAIL (`gating: true`)** | `registry=false paletteCount=null paletteRows=- plane=shared plane` |
| `userSurface.row.mpd-codegraph` | PASS | `sink=<ws>/.mpd/logs/mpd-codegraph.log bytes>0 state=2` |
| `userSurface.findings` | PASS | `no non-gating finding on this run` |
| `userSurface.bundleResolution` | PASS | `source=profile … version=0.16.1 profileVersion=0.16.1 sameCopyDigests=true` |

So the red is caused by the unreachable command ALONE: the composition mounted completely
(`boot failures=[]`), the row is healthy, the bundle version is identical, and the command is recorded as
a FAILED **gating** assertion — not as the `ok:null` finding the retired whitelist produced.

## Before this change (the false green being closed)

`evidence/gates/user-surface/2026-10-28T09-42-52Z/` is the same pre-fix composition against the OLD case:
`ok: true`, with `userSurface.command.mpd-codegraph` recorded as `ok: null`, `gating: false`, finding
`documented-command-unreachable:mpd-codegraph`. Same bundle behaviour, opposite verdict.

## Bounds

- One boot, one machine; palette witness is a TUI capture.
- The mutation is confined to the sandbox pack copy under `.qa-ac3/broken/`; no repo artifact, profile or
  `~/.dsh` was modified.
