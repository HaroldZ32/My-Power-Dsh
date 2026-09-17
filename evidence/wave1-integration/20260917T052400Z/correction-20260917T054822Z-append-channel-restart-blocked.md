# Nested correction: the append channel is RESTART-BLOCKED, not unreachable

**Filed by:** captain (MPD) · `2026-09-17T05:48:22Z` · parent **byte-untouched**
**Parent:** `POST-COMPLETION-append-channel-unreachable.md` (`2026-09-17T05:43:32Z`, t35 / packaging-engineer)
**Corrects:** the parent's TITLE and its closing claim that this seat cannot exercise the channel.
**Leaves intact:** every byte the parent measured — the argument silently dropped, the stored output unchanged,
the `T-61` instance framing. Those readings are correct, and they are the reason this note exists.

## The mechanism a seat cannot see from inside a running session

`node scripts/mpd-bg.mjs reload-check packages/mpd-agent-teams-plugin/lib/tools.js` →

```
[mpd-bg] RESTART-REQUIRED module=packages/mpd-agent-teams-plugin/lib/tools.js mtime=2026-09-17T05:42:47.547Z
newest-session=/root/.dsh/sessions/--root-dshProj-my-power-dsh--/7dd72fcd-9d2e-492f-8d31-8c073fbec2ea \
  mtime=2026-09-17T04:06:39.137Z
— dsh caches plugin modules at session start (T-21): restart dsh before judging this edit
```

`output_append` **is declared**: `packages/mpd-agent-teams-plugin/lib/tools.js:1841`, plus the
`mpd-delta terminal-output-append` region that re-applies it (`lib/mpd-deltas.js`) and its apply sites for a
terminal and a running task. The module carrying those declarations was written at **05:42:47Z**; the process
serving this session started at **04:06:39Z**. The live process therefore serves the schema it registered at
session start, an unknown argument is tolerated and dropped before any handler sees it, and the call returns
`completed` having stored nothing. The captain's own `update_task` schema in that same process lacks the key too,
which is expected: one process serves every seat, captain included.

**So this is T-21 (no plugin hot reload), not a missing feature.** After a restart the key is in the model-facing
schema and the channel is exercisable. What the parent observed remains exactly true *for that process* — the
correction could not be appended to `t35`'s record — but the remedy is **restart `dsh`**, never re-implement the
channel that already exists and is already reviewed
(`evidence/agent-teams/wave-review/20260917T030916Z/adopted-suite.log`).

## Falsification criterion (so this note can itself be refuted)

1. Restart `dsh`, then read the registered `update_task` schema. If `output_append` is still absent, **this note
   is WRONG** and the parent's stronger claim stands.
2. With the key present, append to a TERMINAL task's output: the stored bytes must **GROW** and the previous
   value must remain a **byte-prefix** of the new one (append-only, never replaced).
3. If (1) passes and (2) still stores nothing, the parent's claim is restored at the HANDLER level rather than the
   process level — and the finding becomes a code defect witnessed by the schema, not a restart artifact.

## The pinned digest in the parent was accurate when taken — and the register moved TWICE in the next ten minutes

The parent pins `.mpd/TODO.md` at `94bf0cfc43fb30e5…`. That was a true reading at its write time (05:43:32Z).
The register then moved twice, both times because a finding was FOLDED INTO it rather than dropped:

| moment (UTC) | register sha256 (first 16) | size | what moved it |
|---|---|---|---|
| 05:43:32Z — the parent's reading | `94bf0cfc43fb30e5` | — | the partition as the wave closed |
| 05:46:07Z | `d37e5ea5aa8b84a4` | 49,717 B | new §8.6 row `T-83` (T-53 is instrument-scoped) + direction 3 |
| 05:50:16Z | `c0046ee33e4b0785` | 51,499 B | new §8.6 row `T-84` (a required-to-report red has no ledger surface) |

None of those values is wrong: the register is a LIVING ledger, untracked by design (`.gitignore:21`), and a
digest of it pins bytes at a MOMENT. The captain re-derived the partition from the staged bytes and the two
generated artifacts came back BYTE-IDENTICAL (`reconcile-register.py` exit 0; 36 fixed + 3 already-fixed +
5 partial = 44 touched, 16 untouched, 60 total, 22 new rows, three directions clean, 0 disagreements).

This is the same family the wave filed twice from the other side (the checkout restamp index and the t74
mtime-and-revision correction), now from a third side: **a hash of the bytes is a revision identity; an mtime is
a moment-bound reading; and a digest quoted in a record survives only until the next legitimate write.** Read
`.mpd/TODO.md` from disk, and read every pinned digest in this directory as a reading with a timestamp — this
one included.
