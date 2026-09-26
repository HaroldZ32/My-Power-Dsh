# t58 addendum — both recorded instances, the dispatching branch, and the region's real mismatch

Follows `REPORT.md` in the same directory. New raw evidence: `repro-2instances.mjs` +
`output-2instances.log`.

## 1. Which branch dispatched them (was `nextCapableTask` even consulted?)

**Yes — for an UNASSIGNED task the guard IS the path, and there is exactly ONE delivery point.**

- `packages/mpd-agent-teams-plugin/lib/scheduler.js:540` `const attemptId = beginTaskAttempt(task, currentMember.name);`
  is the **only** call site of `beginTaskAttempt` in the file (grep: 1 hit), so every dispatch goes
  through the selection immediately above it.
- The selection (`scheduler.js:522-527`, region `mpd-delta pool-capability-select`):

```js
const task = recoverOwned ? owned : owned === undefined
    ? nextCapableTask(fresh.tasks, currentMember, (blocked, gap, explicit) => noteDispatchDecline(...))
    : undefined;
```

An unassigned task has no owner ⇒ `owned === undefined` ⇒ `recoverOwned === false` ⇒ **`nextCapableTask`
is called**. There is no unguarded second dispatcher.
- Inside `nextCapableTask` (`scheduler.js:270-298`) the pool loop already covers this shape:
  `tasks.filter(entry => isTaskReady(tasks, entry) && entry.assignee === undefined)` (`:289`).
- The member is the TEAM record: `scheduler.js:494`
  `const currentMember = fresh.members.find(candidate => candidate.name === memberName && candidate.status !== 'removed');`

So the branch is reconstructed: **unassigned pooled task → `nextCapableTask` → pool loop → gap check →
`beginTaskAttempt`**, and the guard *was* consulted for both instances. It simply found no gap.

## 2. Is the guard keyed on `kind` or something narrower?

**On `kind`, and `implementation` is explicitly included** — it is NOT narrower than its own comment:

```js
// scheduler.js:235
writes: task.kind === 'implementation' || task.kind === 'repair' || (task.inScope ?? []).length > 0,
```

Both recorded tasks are `kind=implementation` (`t55` → now Deep Worker, attempt 2; `t57` → now Junior
Engineer, attempt 2 — attempt 1 was the read-only member in each case), so the write half was detected.
**The predicate is not the defect.** The `repair`-only hypothesis is ruled out.

## 3. The mismatch that IS real — the region's data-source assumption

The guard's own docstring/comment claims a fact about the DATA:

```js
// scheduler.js:222
 * read-only roles carry the seven write-capable names in `toolDeny`) received a write
```

That is true of the roster PROFILE (`packages/mpd-bundle/cordis.patch.yml:400/407/415/422`) and false of
the object the guard receives. Measured on the live team record for **both** dispatched members:

```
Researcher memberKeys = id,name,role,provider,model,reasoningEffort,executionPrompt,fallback,joinedAt,status   toolDeny = null
Architect  memberKeys = id,name,role,provider,model,reasoningEffort,executionPrompt,fallback,joinedAt,status   toolDeny = null
```

and the deny list is applied only at spawn (`members.js:586`
`toolFilter: { deny: [...CAPTAIN_TOOL_NAMES, ...(member.toolDeny ?? [])] }`, from the profile member).
So the finding is a **comment/behaviour mismatch about where the capability fact lives**, not a narrowed
predicate: the guard reads `member.toolDeny` from a record that never carries it.

## 4. Both recorded instances reproduce — with controls

`repro-2instances.mjs` drives the real exported `nextCapableTask` with the LIVE team records:

| case | member shape | picked | withheld |
|---|---|---|---|
| t55 (as recorded: pool → Researcher) | live team record of Researcher (`toolDeny` absent) | **`t55`** | `[]` |
| t57 (as recorded: pool → Architect) | live team record of Architect (`toolDeny` absent) | **`t57`** | `[]` |
| control A | profile-shaped read-only (`{name, toolDeny: READONLY_DENY}`) | `null` | gap `["write","edit","mpd_hashline_edit"]`, explicit `false` |
| control B | write-capable member (`{name:"Deep Worker", toolDeny: []}`) | **`t55`** | `[]` |

Verdict line: *"BOTH RECORDED INSTANCES REPRODUCE … the task was never short of a capable recipient."*
Control B matters: the pool was not empty of capable members — the task was handed to a read-only one
**instead of** waiting, which is exactly the contract the guard states.

## 5. Fix shape — unchanged, and now unambiguous

ADDITIVE only (no REPLACEMENT region is needed, because the predicate is correct):
1. carry `toolDeny` onto the team member record at creation (`lib/members.js`, region
   `mpd-delta member-tool-deny-*`), where the profile member is already in hand; the existing guard read
   then becomes truthful with no guard change;
2. in `mpd-delta pool-capability-guard`, treat an absent `toolDeny` on a known read-only roster NAME as
   denied writes, so records written before (1) cannot receive a write task;
3. correct the region comment at `scheduler.js:222` to say the deny list comes from the PROFILE and must
   be carried onto the record — the current wording is what let a green test coexist with a live miss.

Placement: separate follow-up, not this wave (changes dispatch for every team; needs its own fix +
mount proof). Not implemented — findings only, as the task contracts.
