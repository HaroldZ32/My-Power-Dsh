# T-75 — NOT APPLICABLE TO LANE A (captain ruling; carrier is `t19`)

**Recorded by:** `agent-teams-engineer` (`t8`, lane A) · `2026-09-17T07:29Z`

## The ruling this file obeys (quoted verbatim)

`.mpd/plans/friction-p2-wave-captain-log.md`, section **A-1**, **Ruling 2 — T-75 has NO lane-A surface;
it is RE-SCOPED to `t19` (docs-parity-engineer):**

> The Architect flagged its own reading as unquoted, and it was right to. The register's measured instance
> (wave-1 journal row 223) is the **AGENTS.md §6 pointer revert**: `t39` moved the delta-table pointer
> `A1–D26 → A1–D38` (hash chain `1eac90f4… → 54b6f31e… → 24b4490e…`) and a LATER §6 rewrite restored the
> pre-`t39` text — a **FILE-level stale-snapshot revert**, not the amend path and not the `contractVersion`
> stamps. Consequence for lane A: do **not** fabricate a plugin-side surface for T-75 and do **not** soften
> its acceptance. Report T-75 in your completion as **NOT APPLICABLE TO THIS LANE**, citing this section as
> the reason and `t19` as its carrier.

## What lane A therefore did (and did not do)

- **Did not** implement any plugin-side stale-snapshot guard, and did not touch `lib/snapshot.js` or the
  amend path of `lib/tools.js` for T-75. A fabricated surface would have been a contract-shaped fiction:
  the register's measured instance is a DOCUMENT reaching for a value a later writer reverted.
- **Did** leave the wave's T-75 acceptance item to its carrier `t19` (a DERIVATION rule — the hand-carried
  pointer/count is checked against the artifact-derived value — with a seeded pre-`t39` value as the
  negative control, per A-1's own "T-75's carrier (`t19`) scope" paragraph).
- The acceptance text's own severity statement stands: what T-75 closes for a plugin is at most the
  PLUGIN's record-write surface; the measured instance was never that.

## Why this is not a "softened acceptance"

The lane-A acceptance item 3 as frozen asks for a seeded revert with a negative control. Under the
captain's ruling that demonstration belongs to `t19`; lane A's correct completion is the NA statement
above (A-1 also fixes the reporting channel: "the owner **QUOTES this section in its completion
`output`**, and the verifier (`t12`) judges that paragraph **against this file**").

## Readings supporting the NA (all from files, none from memory)

| reading | value |
|---|---|
| the frozen lane-A acceptance item 3 | `evidence/agent-teams/t8-lane-a/20260917T071056Z/source-t1-acceptance.md` lines 26–31 |
| the plan's own lane-A surface for T-75 (superseded) | `.mpd/plans/friction-p2-wave.md` §8 "Lane A" item 3 (`lib/snapshot.js` + the write path in `lib/state.js`) — A-1 supersedes it for this lane |
| the captain's re-scope + carrier | `.mpd/plans/friction-p2-wave-captain-log.md` §A-1 Ruling 2 |
| lane A files touched FOR T-75 | none (no diff in `lib/snapshot.js`; `lib/state.js` changed only for T-79 — symbol `assertTaskRearmable`) |
