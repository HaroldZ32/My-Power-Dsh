# Amendment note — why the SERVICE-ONLY read is the better design, not just a smaller patch

**Added at the captain's request after t62 amendment 1 was ACCEPTED** ("say so plainly in that
amendment's note, because the smaller diff is a real simplification, not just a smaller patch").
This file ADDS to the recorded evidence; it rewrites none of it — `RESULT.md`, `result.json` and
every file under `raw/` are untouched.

- **Amendment**: t62 amendment 1 (service-primary enforcement), captain-verified, post-terminal.
- **Artifact**: this directory (`evidence/team-watchdog/pause/20260915T164700Z/`).
- **Superseded iteration**: `evidence/team-watchdog/pause/20260915T163526Z/` (the file-read version of
  the same five call sites / same region ids), kept as a record.

## The design claim, plainly

**Reading the durable hold file in exactly ONE place — inside the `mpdWatchdog` service — is the
better design than having each gate read it.** It is not merely a smaller diff. Four properties
follow from the single reader, and none of them can be had when two adopted files each parse the
file:

1. **One authority for "is this team held".** The service owns hydration, the in-memory map, the
   cross-process file fallback and the field tolerance. No second implementation exists that could
   disagree with it, so the two readers cannot drift.
2. **Fail-open becomes a property of the COMPOSITION, not of a parser.** With the row absent the
   service is absent and the gate reads *nothing*: a complete, well-formed hold record sitting on
   disk cannot stop a team (check **E1**). Under the file-read version that guarantee was weaker by
   construction — any gate that parses a file can be influenced by one.
3. **Cross-process knowledge is solved once.** The `source: "file"` → `"memory"` transition
   (checks **D1/D2**) is a property of the single reader; with per-gate file reads, every gate would
   need its own cache invalidation story for the same fact.
4. **The adopted diff stays purely declarative.** The gates now contain no I/O, no cache, no
   `node:fs` import and no duplicated schema knowledge:

| | file-read iteration | service-primary revision |
|---|---|---|
| `scheduler.js` | **70** insertions / 0 deletions | **58** / 0 |
| `tools.js` | **72** / 0 | **60** / 0 |
| `node:fs` import inside a region | 2 files | **0** |
| mtime-keyed cache + its bound | 2 files | **0** |
| dual-spelling tolerance (`holdId ?? id`, …) | 2 files | **0** (the service normalises) |
| regions | 53 across 9 files | 53 across 9 files (unchanged ids) |

The 24 lines that disappeared are not "less code for the same behaviour" — they are a whole second
reader (file I/O, cache, schema tolerance) that no longer has a reason to exist.

## What this does NOT change

The durable record is still the contract's artifact and is still authoritative:
`<workspace>/<stateDir>/watchdog/hold/<teamId>.json` = `{id, teamId, since, cause, taskId, attemptId,
sceneAt}` (per `HoldRecord` in `packages/mpd-team-watchdog-plugin/src/sidecars.ts` and the package
README). The gate simply stopped being a second reader of it. The captain's ruling stands: the FILE
spelling is authoritative, and the `{teamId, holdId, at, reason, actor, source}` shape quoted in the
original dispatch text is the reader-VIEW spelling returned by `isHeld()` — recorded as the captain's
error, with no w3 follow-up.
