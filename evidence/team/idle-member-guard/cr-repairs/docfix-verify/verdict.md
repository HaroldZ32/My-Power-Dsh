# T15 — blind verdict on the SKILL.md row correction (T14 docfix)

**Task:** T15 (P2a-CR-DOC-VERIFY). **Loop:** `loop-20261030T122451-4b74d7` (the P2a CR repair loop). **Verifier:** verifier-b (seat bound). **Writer:** dispatch-engine. **Verdict record:** `rec-20261030T124246-066ff6` (PASS, basis `blind`).

## Basis (read before the verdict)

- The T13 finding: `evidence/team/idle-member-guard/cr-repairs/verify/2026-10-30T12-34-27Z/verdict.md`, "Post-verdict observation" — the row described the pre-D6 proof (ZERO `tool/call`).
- `.mpd/plans/team-idle-member-guard-cr-repairs.md` — the frozen repair contract, D6 (the live case must assert ONE denied tool attempt carrying `DENIAL_TEXT` + ONE directive).
- The UPDATED `skills/dsh-qa/SKILL.md` case row (the subject), plus the D6 case assertions (contract D6 + the T13 live result's `proves`). No case-script/implementation/test read.

## What the row now asserts (checked line by line)

- Taskless member: **EXACTLY ONE idle directive** AND **exactly ONE registered tool attempt whose paired `tool/result` is an ERROR carrying the guard's one-line `DENIAL_TEXT`**; the member really calls `read`, so the denial is the proof (a quiet member would pass even with the guard removed).
- No `ZERO tool/call` claim and no "a tool call reddens the idle verdict" negative anywhere in the row.
- The self-test sentence names the shipped five idle negatives: missing attempt, attempt succeeded, wrong denial text, missing directive, doubled directive.
- The stub description matches the `[read, text]` main script; the owner's child script claims.
- `§3.4 lazy spawn` remains NOT claimed; the §6.1 one-turn bound stays declared.

The T14 writer's before/after rows match the worktree row, and the row's markdown shape is unchanged (one table line, four cells).

## Gates (evidence ids)

| Check | Result | Evidence id |
|---|---|---|
| `bun skills/dsh-qa/scripts/team-idle-member-guard.ts --self-test` | PASS — 12 arms incl. negative controls, exit 0 | log in this dir |
| `node scripts/verify-vendor.ts` | PASS (exit 0) — `VENDOR_LOCK.json` mtime 20:41:19 is AFTER the `SKILL.md` edit at 20:39:54, so the captain's final re-pin covers the docfix | `ev-20261030T124231-5aa1dc` |
| `bun run verify:docs` | PASS (52 pairs, 0 violations, 0 dead links) | `ev-20261030T124238-b01aac` |

The T14 writer's own warning (re-pin stamped 20:33:20 predating the 20:39:54 edit → vendor RED) is resolved by the captain's later re-pin; my vendor run is the check.

## Hashes (measured 2026-10-30T12:42:52Z)

```
skills/dsh-qa/SKILL.md      cf74efba2b7a55f2b30703fb8e13d7f5f7ec1958407459510fa985a8743bfa6a
team-idle-member-guard row  36a5269d90fb364a48fba753156d07038f684b145154d5a7e2e8028c323dd549
```

## Bounds

1. Documentation-only: this verdict makes no runtime claim; runtime behaviour is covered by the T13 live verdict `rec-20261030T123729-6131af`.
2. I did not read the case script or implementation/tests; the D6 assertions were judged from the contract, the T13 live result `proves`, and the observed 12-arm self-test output.
3. The working-tree SKILL.md diff has one other hunk — the `mcp-call` `<credentials-file>` placeholder (T12 D7a), already verdict-verified in T13; it is not part of this row.
4. The one-re-pin-per-wave history remains the captain's PR disposition; this verdict only confirms the current tree's single re-pin is green after the edit.
