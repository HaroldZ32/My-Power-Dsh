# NESTED LABEL — the superseded red side, kept beside its replacement (t29 / review finding R4)

**What this file labels:** `arm-before.out.txt` in this directory is the red side of the SUPERSEDED
first design of T-64, not of the shipped one. It is KEPT (never deleted, never overwritten) and it is
*superseded*, not authoritative.

**The replaced assertion it contains** — quoted from `arm-before.out.txt` verbatim:

> `FAIL [T-64/green] dependencyStates names the unresolvable id separately`

The committed driver does not contain that assertion any more (measured: `grep -c` on
`arm.mjs.pre-cycle-extension` = **0**), because the first design added an `unresolved: []` third key to
the `dependencyStates` return shape and the shipped design keeps the exact two-bucket shape and adds
READER functions instead. A count alone would not have shown this: the stale log records **7** failures
while the shipped driver's red side records **6**.

**The reproducible pair (produced by t29, independent of the reviewer's copy):**

| artefact | revision | reading |
|---|---|---|
| `arm.mjs.pre-cycle-extension` | sha256 `36de7d01e48c441f393034d4034bb768fd7af58e249d38923fcdb7de8dbb4af0` — the byte-for-byte committed driver as the review pinned it (`PIN.txt`), preserved here so the pair below stays reproducible AFTER `arm.mjs` gained the T-64 cycle arm | — |
| `arm-before-committed.out.txt` | that driver vs a scratch mirror whose `lib/` was restored from `git HEAD` (`packages/mpd-agent-teams-plugin/lib`, `_deps` linked; scratch outside the workspace and deleted in the same bash call) | **RED-SIDE FAILURES: 6, exit 1** — the same count the review measured (`my-arm-before-revert.out.txt`) |

**The cycle-arm pair** (added by t29 for finding R3) is `arm-cycle-before.out.txt` /
`arm-cycle-after.out.txt`, produced by the EXTENDED `arm.mjs` (its new sha256 is recorded in
`evidence/agent-teams/wave2b-laneA/20260917T145437Z/README.md`); the extension is additive — the
T-87/T-84/T-64 arms and their assertions are untouched.
