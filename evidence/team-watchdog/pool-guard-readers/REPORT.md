# t59 — capability-blindness inventory: every reader and writer of the team-record member shape

Findings only. No adopted file was edited, no git command was run, nothing was fixed.
Scope: `packages/mpd-agent-teams-plugin/lib/**`.

## 0. The searches (reproducible, pasted)

```sh
grep -rn "toolDeny"    packages/mpd-agent-teams-plugin/lib/ --include=*.js | grep -v mpd-deltas.js
grep -rn "toolFilter"  packages/mpd-agent-teams-plugin/lib/ --include=*.js | grep -v mpd-deltas.js
grep -rn "CAPTAIN_TOOL_NAMES" packages/mpd-agent-teams-plugin/lib/ --include=*.js
grep -rn "MEMBER_TOOL_NAMES\|readOnly\|readonly" packages/mpd-agent-teams-plugin/lib/ --include=*.js | grep -v mpd-deltas.js
grep -rn "taskCapabilityGap(\|taskCapabilityNeed(" packages/mpd-agent-teams-plugin/lib/ --include=*.js | grep -v mpd-deltas.js
grep -rn "members.push\|members: \[\|\.members = \|members\.splice\|members\.map" packages/mpd-agent-teams-plugin/lib/*.js | grep -v mpd-deltas.js
grep -o '"mpd-delta [a-z-]*"' packages/mpd-agent-teams-plugin/lib/mpd-deltas.js | sort -u
```

`mpd-deltas.js` is excluded from the reader/writer counts because it holds the region REGISTRY text, not a
call path; it is checked separately in §4.

## 1. Every read of a capability/deny-derived field

| # | path:line | quoted line | object supplied by | verdict |
|---|---|---|---|---|
| R1 | `scheduler.js:246` | `const denied = new Set(member?.toolDeny ?? []);` | `scheduler.js:494` `const currentMember = fresh.members.find(candidate => candidate.name === memberName && candidate.status !== 'removed');` → `fresh` = the persisted team record | **TEAM-record → BLIND** (t58's root cause, reproduced) |
| R2 | `members.js:586` | `toolFilter: { deny: [...CAPTAIN_TOOL_NAMES, ...(member.toolDeny ?? [])] },` | the `member` parameter of `spawnMember(…)`; three call sites: `tools.js:2619` (team creation — iterates `draft.members` built at `:2582`), `tools.js:434` (staged-approval commit barrier — iterates the staged members), `tools.js:959` (runtime `agent_teams_add_member` — the record built at `:940-961`) | **BLIND for roster-created and staged teams; SAFE for runtime-added members** (see §3) |
| R3 | `capabilities.js:94` | `deny: TEAM_TOOL_NAMES.filter(name => !MEMBER_TOOL_NAMES.includes(name)),` | constant name sets imported at `capabilities.js:16` (`import { MEMBER_TOOL_NAMES, TEAM_TOOL_NAMES } from "./tool-names.js"`) — **no member record involved** | **SAFE** |
| R4 | `profiles.js:21` | `const MEMBER_KEYS = ['name','role','provider','model','reasoning_effort','executionPrompt','fallback','toolDeny'];` | profile parsing | **PROFILE → SAFE** |
| R5 | `profiles.js:334` | `toolDeny: optionalStringList(raw['toolDeny'], \`${path}.toolDeny\`) });` | the raw roster/profile entry | **PROFILE → SAFE** |
| R6 | `profiles.js:583` | `* @param value - the raw \`toolDeny\` entry.` (docstring of `optionalStringList`) | validator for the raw profile value | **SAFE** (not a reader) |
| R7 | `index.js:70` | `toolDeny: z.array(z.string()),` | zod schema for member config input | **SAFE** (validator) |
| R8 | `tools.js:879` | `toolDeny: {` | the `agent_teams_add_member` tool parameter schema | **SAFE** (validator) |

No other read of a capability-derived field exists: every other `member.*` access I found reads
`name`/`role`/`id`/`provider`/`model`/`status` (e.g. `tools.js:125` `members.map(member => member.name)`,
`tools.js:834` `member.name`/`member.role`/`member.provider`), none of which is a capability fact.

## 2. Answer to the open question — **NOT none; there is a SECOND blind reader**

**R2 (`members.js:586`, the spawn-time `toolFilter` merge) is blind for every team created from a roster
profile**, and for the same reason as R1: the record it receives was built without `toolDeny`.

Chain, quoted:
- creation mapping — `tools.js:2582-2597`:
  ```js
  members: profile.members.map((template, index) => {
      const selection = selections[index];
      return {
          id: '', name: template.name, role: template.role,
          provider: selection.provider, model: selection.model,
          reasoningEffort: selection.reasoningEffort,
          executionPrompt: template.executionPrompt ?? profile.executionPrompt ?? input.config.executionPrompt,
          ...selection.fallback === undefined ? {} : { fallback: selection.fallback },
          joinedAt: now, status: 'idle',
      };
  }),
  ```
  `template.toolDeny` is **never carried** — the profile template HAS it (`profiles.js:334`) and the record
  does not.
- spawn loop — `tools.js:2617-2619`:
  ```js
  for (const member of draft.members) {
      const selection = selections[spawned.length];
      await spawnMember(input.ctx, memberRuntime(input.config), input.memberSelections, selection, input.captain, draft, member, input.config.stateDir, input.exec.input);
  }
  ```
  so `member.toolDeny === undefined` at `members.js:586` ⇒ `toolFilter.deny === [...CAPTAIN_TOOL_NAMES]`
  ⇒ the roster's seven write-capable names are NOT denied for a team created from a profile.
- the same `draft.members` is what the staged path persists and what the commit barrier (`tools.js:434`)
  later spawns — so the staged route shares the drop.

**Consequence, stated as the task asks (which kind reaches which member):** for a roster-created team, a
read-only member (Researcher/Architect/Planner/Explorer/Reviewer/Plan Reviewer/Vision Analyst) can be
handed a pooled `implementation`/`repair` task by R1, AND its own session is not restricted from
`write`/`edit`/`bash` by R2 — i.e. the wave-4 delta `member-tool-deny-filter` is inert on the main
creation path. **Uncertainty I am stating rather than hiding:** I verified the DATA path end to end
(profile → record → spawn filter); I did NOT witness a live member session's tool list, because that needs
a member-session probe and this environment has no model credentials (the same limit t42 declares). The
recommended falsifier is one fixture assertion or one member-session tool-list read.

## 3. Every path that creates or copies a team member record

| # | path:line | quoted line (abridged) | `toolDeny` survives? |
|---|---|---|---|
| W1 | `tools.js:2582` | `members: profile.members.map((template, index) => { … return { id:'', name: template.name, role: template.role, provider, model, reasoningEffort, executionPrompt, …fallback, joinedAt: now, status: 'idle' }; })` | **NO — DROPPED.** The root write defect. Persisted to `team.json` (`writeTeam`/`createTeamDir`), so a LATER process reading the record is blind too |
| W2 | `tools.js:940-961` | `const member = { id:'', name, role, provider, model, reasoningEffort, executionPrompt, …(args.toolDeny === undefined ? {} : { toolDeny: [...args.toolDeny] }), joinedAt, status:'idle' };` then `fresh.members.push(member); await writeTeam(stateRoot, fresh);` | **YES when `args.toolDeny` is supplied; NO when it is omitted** (runtime `agent_teams_add_member` only) |
| W3 | `tools.js:392,411` | `fresh.members = fresh.members.filter(candidate => candidate !== member);` / `… filter(member => member.status !== 'removed');` | **PRESERVED** — filters, no field rebuild |
| W4 | `tools.js:2295` | `const roster = fresh.members.map(member => ({ ...member }));` | **PRESERVED** — spread copy |
| W5 | `profiles.js:211` | `members.push(member);` | profile list, not a team record → N/A (this is where the field EXISTS) |
| W6 | `tools.js:434` (staged-approval commit barrier) | `for (const [member, selection] of selections) { await spawnMember(…, member, …) }` | does not create a record; it spawns the staged members — **blind whenever those came from W1** |
| W7 | reassignment (`reassign_task`) | sets `task.assignee` / attempt fields only — no member-record write | **N/A** — no capability copy involved (the task moves; the member record is untouched) |

Only W1 and W2 create member records; W1 is the one that drops the field for every profile-created team,
and because the record is persisted, the blindness outlives the process.

## 4. Is any delta region supposed to carry it?

The registry's `toolDeny` regions are `mpd-delta member-tool-deny-{keys,parse,helper,config,param,add,filter}`:

```
"mpd-delta member-tool-deny-add"      "mpd-delta member-tool-deny-config"
"mpd-delta member-tool-deny-filter"   "mpd-delta member-tool-deny-helper"
"mpd-delta member-tool-deny-keys"     "mpd-delta member-tool-deny-param"
"mpd-delta member-tool-deny-parse"
```

**There is no region that carries `toolDeny` from the profile template into the team member record** — the
creation mapping W1 is untouched by every region. So the hole is not a regression and not a heal failure;
it is a region that was never written.

## 5. Fix coverage — what a fix MUST touch

**Necessary (fixes both readers and the persistence problem):**
1. **W1 — `tools.js:2582`, the creation mapping.** Add the field where the profile template is already in
   hand, e.g. `...(template.toolDeny === undefined ? {} : { toolDeny: [...template.toolDeny] })`.
   This single site repairs R1 (scheduler guard), R2 (spawn filter) and the staged/commit-barrier route,
   and — because the record is persisted — the later-process case the task calls out.
   New region, **ADDITIVE** (§4 shows no existing region owns this text), so it self-heals after a
   re-materialize.
2. **The already-persisted records.** Teams written before the fix carry no `toolDeny` and never will
   unless rewritten. Either (a) a migration/backfill from the roster profile at team load, or (b) piece 2
   of t58's recommendation — make R1 conservative (an absent `toolDeny` on a known read-only roster NAME
   counts as denied writes) — is therefore **necessary for existing teams**, not merely defensive.
   Note (b) fixes only the scheduler reader; the untouched spawn filter for old teams still needs (a) if
   the member's own tools matter.

**Merely defensive after the whole picture:**
3. Keeping a belt check in the guard even once W1 carries the field — cheap, and it protects against a
   future record-shape change or a hand-edited `team.json`, but not required by today's data.

**Also required for honesty:** correct the two comments that assert the record carries the names —
`scheduler.js:222` ("read-only roles carry the seven write-capable names in `toolDeny`") and
`members.js:578-583` ("carried as profile data") — because their wording is what let a green suite coexist
with a live miss. The data lives on the PROFILE member; it must be carried onto the record.

**Placement:** separate follow-up (it changes every team's spawn filter, i.e. more than dispatch), with its
own mount proof — a fixture that spawns a roster team and asserts both the record field and the effective
deny set, plus one member-session tool-list read if credentials are ever available.

## 6. Limits of this report

- I traced data paths, not live member sessions (no model credentials here — the same limit t42 states).
- `client.js` (the browser half) also shapes member objects for display (`client.js:493,2680`); it is a
  consumer of the snapshot, not a writer of team state, so it is out of the blindness set — but I note it
  because a UI that shows capabilities would read the same blind field.
