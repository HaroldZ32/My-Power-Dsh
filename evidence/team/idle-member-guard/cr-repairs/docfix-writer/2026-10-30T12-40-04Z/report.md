# T14 — SKILL.md case row aligned with the shipped D6 proof

**Row:** T14 (P2a-CR-DOCFIX, repair of the T13 post-verdict Medium finding).
**Scope:** `skills/dsh-qa/SKILL.md` only — no code, no test, no dist, no re-pin (captain's).
**Case unchanged:** `skills/dsh-qa/scripts/team-idle-member-guard.ts` was NOT edited by this row.

## Why

The row still described the PRE-D6 proof: it required the taskless member's session to record
**ZERO `tool/call` rows**, and listed "a tool call" as a REDDENING negative for the idle verdict. The
shipped D6 case proves the opposite thing: the stub issues one `read` attempt and the verdict requires the
paired `tool/result` to be an ERROR carrying the guard's `DENIAL_TEXT` (plus exactly one idle directive).
A row that says a tool call reddens the verdict contradicts the shipped case it documents.

## Exact BEFORE (committed HEAD; T12 did not touch this row)

| team-idle-member-guard | team-plane idle-member guard (P2a) | the §3.1-3.3 + Amendment 1 guard on a REAL boot: the Lead's plan (TWO members, ONE task) is staged and approved through the REAL `agent_teams_plan` tool by a mounted probe row (`lib/team-idle-member-guard-probe.ts`), the team executor raises BOTH members, and the verdicts come from the HARNESS session log only — the task owner's session must record an `agent_teams_task` call WITH a non-error result, while the TASKLESS member's session must record ZERO `tool/call` rows and EXACTLY ONE idle directive (the user-role message the per-agent pre-step injects); both members must carry an executor handle in the team record, so "zero calls" is about a spawned member and never an absent one. The model step is a local stub: its child script (selected by a marker in the owner's spawn prompt) drives the owner's claim, while every other request is plain text. `--self-test` is the offline falsifier — each detector against a POSITIVE and a NEGATIVE fixture (an errored result and a prose-only narration both REDDEN the owner verdict; a tool call, a missing directive and a doubled directive each REDDEN the idle verdict), plus two pins that the directive and denial literals this case asserts are the plugin's own source text. §3.4 lazy spawn is NOT claimed: the §6.1 one-turn bound stays declared. Evidence → evidence/team/idle-member-guard/live/&lt;ts&gt;/ | P2a/idle-member-guard |

## Exact AFTER (working tree)

| team-idle-member-guard | team-plane idle-member guard (P2a) | the §3.1-3.3 + Amendment 1 guard on a REAL boot: the Lead's plan (TWO members, ONE task) is staged and approved through the REAL `agent_teams_plan` tool by a mounted probe row (`lib/team-idle-member-guard-probe.ts`), the team executor raises BOTH members, and the verdicts come from the HARNESS session log only — the task owner's session must record an `agent_teams_task` call WITH a non-error result, while the TASKLESS member's session must record EXACTLY ONE idle directive (the user-role message the per-agent pre-step injects) AND exactly ONE registered tool attempt whose paired `tool/result` is an ERROR carrying the guard's one-line `DENIAL_TEXT` — the member really calls `read`, so the denial itself is the proof (a quiet member would pass even with the guard removed); both members must carry an executor handle in the team record, so the denial is about a spawned member and never an absent one. The model step is a local stub: its child script (selected by a marker in the owner's spawn prompt) drives the owner's claim, while every other request issues the `read` attempt and then answers in plain text. `--self-test` is the offline falsifier — each detector against a POSITIVE and a NEGATIVE fixture (an errored result and a prose-only narration both REDDEN the owner verdict; for the idle verdict a MISSING attempt, an attempt that SUCCEEDED, a denial text that is not the guard's, a missing directive and a doubled directive each REDDEN it), plus two pins that the directive and denial literals this case asserts are the plugin's own source text. §3.4 lazy spawn is NOT claimed: the §6.1 one-turn bound stays declared. Evidence → evidence/team/idle-member-guard/live/&lt;ts&gt;/ | P2a/idle-member-guard |

## What changed in the row

- `ZERO `tool/call` rows and EXACTLY ONE idle directive` → `EXACTLY ONE idle directive ... AND exactly one
  registered tool attempt whose paired tool/result is an ERROR carrying the guard's one-line DENIAL_TEXT`,
  with the reason the attempt is required (a quiet member would pass even with the guard removed).
- `so "zero calls" is about a spawned member` → `so the denial is about a spawned member`.
- `every other request is plain text` → `every other request issues the read attempt and then answers in
  plain text` (the stub's main script is `[read, text]`; the owner's child script claims instead).
- `a tool call, a missing directive and a doubled directive each REDDEN the idle verdict` → `a MISSING
  attempt, an attempt that SUCCEEDED, a denial text that is not the guard's, a missing directive and a
  doubled directive each REDDEN it` (the case's five idle negatives, verbatim in substance).

## Command and observed result

```
$ bun skills/dsh-qa/scripts/team-idle-member-guard.ts --self-test
[self-test] PASS overlay names the probe and its record file
[team-idle-member-guard] self-test PASS — 12 arms incl. negative controls
exit=0
```

(The case itself is unchanged; the run confirms the documented 12-arm self-test is the one that ships.)

## Bounds

- Documentation-only row: it proves nothing about runtime behaviour, and the live QA case remains
  verifier-b's (after the captain rebuilds dist).
- `skills/**` changed again in this repair, so the captain's single `repin-vendor --write
  --i-know-this-is-the-captains-step` remains the final corpus re-pin; I ran no re-pin.
- The row's markdown shape is unchanged: one table line, four cells (`cells=4` in `change.log`).

## Evidence

- `change.log` — before/after rows, the table-shape check, and the self-test (with its own exit code).
- This report.

## Cross-cutting fact for the captain (found while sampling)

The working tree already carries the captain's dist rebuild AND a `VENDOR_LOCK.json` re-pin — both
stamped **20:33:20** — while THIS row's `SKILL.md` edit landed at **20:39:54**. The re-pin therefore
predates this row's bytes: `node scripts/verify-vendor.ts` exits **1** with
`FAIL - asset skills treeSha mismatch`. The single final re-pin must run AFTER this row's edit is tracked
(or the edit must be folded into the commit whose tree the re-pin records). I did not run the re-pin.
