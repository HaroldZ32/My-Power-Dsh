# The LIVE arms — the CJK corpus in a real isolated headless boot

Run: `evidence/gates/complexity-gate/2026-10-07T10-32-25Z/session-start-team-2026-10-07T10-36-01.185Z/`
(`MPD_QA_EVIDENCE_DIR` pointed at this lane's evidence dir; isolated `DSH_HOME` + sandbox `HOME` +
SEEDED sandbox workspace per side, one `dsh --profile mpd-headless "<prompt>"` boot per prompt).

## (ii) the owner's VERBATIM Chinese instruction STAGES A SHELL — `sides/cjk-positive/0/`

`row-log.txt` (the ROW's own log line, the primary evidence — never the model's prose):

```
[2026-10-07T10:36:55.822Z] [mpd-roles] session gate listener registered for agent "session-10415410-e005-419e-8b20-6dca9a20fe11" agentPreset=none
[2026-10-07T10:36:57.269Z] [mpd-roles] session gate fired for agent "session-10415410-e005-419e-8b20-6dca9a20fe11" signals=E mode=mechanical staged=1 plan=plan-20261007103657
```

`notices.json`: `notice.any=1 mechanical=1 signals=["E"] planIds=["plan-20261007103657"] shellShaped=1
inert=1 retiredVocabulary=0`; `teams.staged=1 planIds=[the same id] stagedMembers=0 stagedTasks=0
records=0`. So: the gate FIRED on signal E (the CJK-scale signal), STAGED exactly one 0-member/0-task
shell, injected exactly ONE mechanical notice naming the id the staging call RETURNED, and created ZERO
team records — staging is not spawning, and the three sources (row log, notice, staged slot) agree.

Before the repair the same bytes measured `trigger=false signals=[]` (see `corpus-before-after.out`), so
this boot is the falsification the fix had to flip.

## (the controls) the three Chinese NEGATIVE prompts stay SILENT — `sides/cjk-negative/{0,1,2}/`

| Side | Prompt | Notices | Staged | Gate installed |
|---|---|---|---|---|
| 0 | `这个函数是干什么的？` (9 Han) | 0 | 0 | yes (`gateInstalled: true`, last row-log line = `listener registered`) |
| 1 | `读一下 AGENTS.md 的第一节，然后告诉我它说了什么` (17 Han) | 0 | 0 | yes |
| 2 | `请解释一下这个项目里 preset 和 profile 到底有什么区别…` (52 Han, ZERO lexicon verbs) | 0 | 0 | yes |

Each side's `problems: []`, and each shows the gate MOUNTED (`gateInstalled: true`) with no fire line —
so "no notice" is a measured silence, not an absent gate. Side 2 is the load-bearing control: it clears
half of signal E's conjunction (scale) and fails the other half (verbs).

## (iii) a session already leading a team — the WIRING arm

The live boot's session id is generated per boot (`session-10415410-…`), so a pre-seeded team record
cannot name it in advance; the C7 arm is therefore driven where it CAN be driven deterministically:
`team-plane.test.ts`'s "WIRING: a session already leading a team stages NOTHING and injects NO notice",
which installs the real gate and drives the real `agent/pre-step` listener:

| Case | Record | Result |
|---|---|---|
| guard | `leadSessionId` = this session, 3 members | `{out: undefined, toolCalls: 0}` |
| twin | `leadSessionId` = another session, 3 members | `toolCalls: 1` (stages) |
| twin | `leadSessionId` = this session, 0 members (a SHELL) | `toolCalls: 1` (stages) |
| twin | no team at all | `toolCalls: 1` (stages) |

Notice behaviour chosen and stated: NO notice in any mode, and the session is NOT marked `acted`, so the
record is re-read on the next step and a session whose team ends is judged again.
