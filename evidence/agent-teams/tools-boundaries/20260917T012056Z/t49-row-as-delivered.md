# The T-49 row AS DELIVERED — quoted for the `t31` reviewer

`t9` is `completed`, so its record's `output`/`acceptance` are immutable (terminal records cannot be
edited — the same immutability the captain recorded in plan §8 L13). Per the corrected procedure
(plan §7 A1 + §8 L8/L19: "the owner QUOTES it in its completion `output`, and verifiers judge that
paragraph against this file"), this file is the durable quote. The record's own 7th
`acceptanceResults` entry carries the same A1 content in summary; this file carries it in full,
together with the post-completion measurements of the three negative controls.

Authority: `.mpd/plans/friction-p1-wave.md` §7 A1 (as ruled 2026-09-17), §8 L11 (T-49 landed +
`t39` documentation risk) and §8's T-49 correction-in-place. Implementation: `t9`, attempt
`2dcbbdaf-1273-4f56-82a8-a481fe6af050`. Pins: `t41` (both refusal paths).

## The row

**T-49 RED (measured 2026-09-17, this wave's own startup):**
1. Every member's spawn payload carried `toolFilter.deny` **including** `agent_teams_task_contract` —
   the chain was `lib/tool-names.js:10` (the name IS in `TEAM_TOOL_NAMES`) while `MEMBER_TOOL_NAMES`
   omitted it, so it landed in `CAPTAIN_TOOL_NAMES`, which `lib/members.js:586`
   (`toolFilter: { deny: [...CAPTAIN_TOOL_NAMES, ...(member.toolDeny ?? [])] }`) denied to every member.
2. The tool was ABSENT from the member's advertised schema list (105 tools writer seat / 98 read-only
   seat) — the deny did hide it.
3. Effect measured across all 9 member sessions: **two read-only seats (Architect, Explorer) each
   called it once and each got one `Error: unknown tool "agent_teams_task_contract"`** (harness
   `UNKNOWN_TOOL`); the other 7 members never called it.
4. Why a member tries at all: the name is discoverable from the workspace manual's delta row D6 and
   the tool's own description promises it is "available to the captain and to any member" — so a seat
   that follows its instructions FAILS.

Re-verified independently by the owner before editing: `tool-names.js:10` in `TEAM_TOOL_NAMES`,
absent from `MEMBER_TOOL_NAMES` (:12-14) → present in `CAPTAIN_TOOL_NAMES` (:15) → denied at
`members.js:586`. Owner's live post-fix flip (same module import): `MEMBER_TOOL_NAMES` includes it,
`CAPTAIN_TOOL_NAMES` = 9 does not, `is the contract tool member-visible? true`.

**T-49 GREEN (the ONLY accepting path):** `agent_teams_task_contract` is reachable by EVERY seat —
the `MEMBER_TOOL_NAMES` allow-list in `lib/tool-names.js` includes it, so BOTH recomputation sites
heal from the one edit (`tool-names.js:15` → `members.js:24`/`:586` spawn `toolFilter`, and the
inline filter at `lib/capabilities.js:94` runtime `tools.restrict`; `lib/index.js:185` untouched) —
and a MOUNTED boot shows a READ-ONLY seat listing it AND reading a contract through it. Keeping the
surface captain-only is NOT an accepted alternative (it would require removing the discovery path —
delta row D6 + the description's "captain and any member" — i.e. making the manual less truthful
than the code).

**Delivered evidence for that GREEN:** `result.json` / `driver.mjs` in this directory — a real
`dsh --profile mpd-headless` boot in an isolated `DSH_HOME` + sandbox `HOME`/workspace, driven by a
local model stub: the read-only member's **83-tool** advertised list INCLUDES
`agent_teams_task_contract` (captain seat: 99), and the member's harness session log records
`tool/call agent_teams_task_contract` with a NON-ERROR `tool/result` carrying the real contract
(`Task t1 [claimed] verification — T49 contract read`, `Assignee: Architect (attempt 1,
attempt_id 6267f678-…)`), which the harness then returned to the member's model.

**Negative controls (added by the captain's refinement; measured post-completion, 2026-09-17,
log: `t49-controls-probe-postfix.log`):**
- (a) a NON-PARTICIPANT caller is still refused: `you do not lead or belong to any active team yet`;
- (b) an UNKNOWN task id is refused WITH the known-ids list: `task "t99" does not exist in team
  "t49 controls" (known tasks: t1)` (`lib/tools.js:2148-2149` behaviour, confirmed live);
- (c) the chosen shape is the allow-list, NOT a widened deny exception: `lib/members.js:586` was NOT
  touched, so every other harness write tool stays denied for a read-only seat — asserted, not
  assumed: the in-process test drives the REAL `spawnMember` payload (deny still carries
  `write`/`edit`/`bash`) and the mounted boot shows the read-only seat's 83 tools exclude
  `bash`/`write`/`edit` and `agent_teams_approve`.

(a) and (b) are MEASURED but not yet PINNED as tests — that is task **`t41`** ("pin T-49's two
refusal paths (non-participant, unknown task id) in the self-fix suite"), whose owner is the same
engineer; they will be pinned in
`packages/mpd-agent-teams-plugin/self-fix-tests/tool-boundary-hold-and-contract-seat.test.mjs` with
no library change.
