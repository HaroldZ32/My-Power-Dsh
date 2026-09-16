# t58 — x1 pool-capability guard miss: a pooled `implementation` task reached the read-only Researcher

**Verdict of the investigation: the guard is correct in logic and blind in production, because it reads a
capability field (`member.toolDeny`) that the record it is handed does not carry.** Not a regression of
the delta; a data-source mismatch between the roster PROFILE (which has the deny list, used at spawn) and
the TEAM member record (which the scheduler reads, and which has no such field). Reproduced standalone
below. No tree edit was made.

Artifacts: `evidence/team-watchdog/pool-guard/20260915T1745Z/{repro.mjs,output.log,REPORT.md,result.json}`.

## 1. What the pool guard actually tests — quoted

`packages/mpd-agent-teams-plugin/lib/scheduler.js:233-238` (region `mpd-delta pool-capability-guard`):

```js
function taskCapabilityNeed(task) {
    return {
        writes: task.kind === 'implementation' || task.kind === 'repair' || (task.inScope ?? []).length > 0,
        exec: (task.verify ?? []).length > 0,
    };
}
```

`…/scheduler.js:245-256`:

```js
function taskCapabilityGap(task, member) {
    const denied = new Set(member?.toolDeny ?? []);          // ← line 246: the ONLY capability source
    const need = taskCapabilityNeed(task);
    const missing = [];
    if (need.writes)
        for (const tool of ['write', 'edit', 'mpd_hashline_edit'])
            if (denied.has(tool))
                missing.push(tool);
    if (need.exec && denied.has('bash'))
        missing.push('bash');
    return missing;
}
```

`…/scheduler.js:289-296` (the pool loop):

```js
    for (const task of tasks.filter(entry => isTaskReady(tasks, entry) && entry.assignee === undefined)) {
        const gap = taskCapabilityGap(task, member);
        if (gap.length > 0) {
            withhold(task, gap, false);
            continue;                                        // ← leaves it IN the pool (no delivery)
        }
        return task;
    }
```

So the guard keys on **the task's `kind`/`inScope`/`verify`** (what is needed) against **the member's
`toolDeny`** (what is withheld). It does NOT key on the task status (beyond readiness), and it DOES cover
unassigned pool tasks.

## 2. How the deny list is populated — and where the scheduler's member comes from

- **The list lives in roster PROFILE data** (the read-only roles carry seven names):
  `packages/mpd-bundle/cordis.patch.yml:400,407,415,422`
  `toolDeny: [write, edit, mpd_hashline_edit, bash, mcp__ast_grep__rewrite, mcp__ast_grep__scan, mcp__lsp__rename]`.
- **It is parsed into profile members** at `lib/profiles.js:334`:
  `toolDeny: optionalStringList(raw['toolDeny'], \`${path}.toolDeny\`)`.
- **It is consumed at SPAWN only** — `lib/members.js:586`:
  `toolFilter: { deny: [...CAPTAIN_TOOL_NAMES, ...(member.toolDeny ?? [])] }`
  (the delta comment for `member-tool-deny` records exactly this: "the TEAM path is mechanically
  restricted too"). After spawn, the deny list has done its job and is not persisted.
- **The scheduler reads the TEAM record**, not the profile: `scheduler.js:494`
  `const currentMember = fresh.members.find(candidate => candidate.name === memberName && candidate.status !== 'removed');`
  and `scheduler.js:524` hands that object to `nextCapableTask`.

**Measured on the live team record** (`.mpd/team/mpd-default/team.json`, read-only):
Researcher's record keys are
`id,name,role,provider,model,reasoningEffort,executionPrompt,fallback,joinedAt,status` — **there is no
`toolDeny` field** (`toolDeny === undefined`).

⇒ At `scheduler.js:246`, `member?.toolDeny ?? []` evaluates to **`[]`**, `taskCapabilityGap` returns
**`[]`**, and the pooled `implementation` task is **delivered**. Did Researcher carry the deny list at
dispatch time? **No.** Its seven names were never on the record the scheduler saw.

## 3. The exact condition that let it through — (b)/(e), not (a)/(c)/(d)

| candidate | ruling | evidence |
|---|---|---|
| (a) the guard only fires for `repair`, not `implementation` | **RULED OUT** | `taskCapabilityNeed` lists `'implementation'` explicitly (`scheduler.js:235`); shape A of the repro shows the guard withholding an `implementation` task |
| (b) a capability flag set from a different source than `toolDeny` | **THIS ONE** | the flag IS `toolDeny`; it is set on the **profile** member and applied to `toolFilter` at spawn (`members.js:586`), while the scheduler reads the **team** record (`scheduler.js:494`) that lacks it |
| (c) an unassigned task bypasses `nextCapableTask` | **RULED OUT** | the guard is the entry for exactly that case: `const task = recoverOwned ? owned : owned === undefined ? nextCapableTask(fresh.tasks, currentMember, …) : undefined` (`scheduler.js:518-528`), and its pool loop filters `entry.assignee === undefined` (`:289`) |
| (d) the withhold branch logs but still returns the task | **RULED OUT** | `scheduler.js:291-293` calls `withhold(...)` then `continue` — the candidate is skipped |
| (e) the scheduler reads a pre-spawn snapshot | **equivalent to (b) here** | the record it reads is the post-spawn TEAM record; the pre-spawn PROFILE record is the one that had the deny list |

**Exact condition:** `member.toolDeny === undefined` on the team member record + a pooled task whose
`kind`/`inScope` requires writes ⇒ `taskCapabilityGap` returns `[]` ⇒ delivery. Nothing else had to go
wrong.

## 4. Regression suite: raw result, and why it is blind

```
bun test packages/mpd-agent-teams-plugin/self-fix-tests/pool-capability-guard.test.mjs
 7 pass
 0 fail
 18 expect() calls
Ran 7 tests across 2 files. [291.00ms]
```

It passes while production missed, because of the **fixture shape**:
`self-fix-tests/pool-capability-guard.test.mjs:50-51`

```js
const readOnly = (name) => ({ name, toolDeny: READONLY_DENY })
const writer   = (name) => ({ name, toolDeny: [] })
```

The test constructs **profile-shaped** members (with `toolDeny`); production hands the guard a
**team-record-shaped** member (without it). The suite therefore exercises a shape that never occurs on the
dispatch path, and any future regression of the same class stays green.

## 5. Standalone reproduction (no tree edits) — raw output

`evidence/team-watchdog/pool-guard/20260915T1745Z/repro.mjs` imports the **real exported**
`nextCapableTask` and drives it with the same pooled task and two member shapes; shape B is the live team
record read verbatim from `team.json`.

```
shapeA_profileShapedMember: { memberKeys: "name,toolDeny", picked: null,
  withheld: [{ id: "t55", gap: ["write","edit","mpd_hashline_edit"], explicit: false }] }
shapeB_liveTeamRecordMember: { memberKeys: "id,name,role,provider,model,reasoningEffort,executionPrompt,
  fallback,joinedAt,status", toolDeny: null, picked: "t55", withheld: [] }
verdict: MISS REPRODUCED — the guard withholds the pooled implementation task ONLY when the member
  carries toolDeny; the live team record does not carry it, so the task is delivered to the read-only member.
```

Full raw output: `…/output.log`. The reproduction needs no adopted-code edit — the function is exported.

## 6. Minimal fix shape (RECOMMENDATION ONLY — not implemented)

Two **ADDITIVE** pieces; either alone closes today's hole, both together close the class:

1. **Carry the capability fact onto the record** — ADDITIVE region in `mpd-delta member-tool-deny-*`
   (`lib/members.js`), where the profile member is already in hand (`:586`): include
   `toolDeny: member.toolDeny` in the team member record it writes. The existing guard
   (`member?.toolDeny ?? []`) then reads truth with **no guard change**. ADDITIVE ⇒ self-heals after a
   re-materialize, and older records simply lack the field.
2. **Make absence conservative in the guard** — ADDITIVE region in `mpd-delta pool-capability-guard`
   (`lib/scheduler.js`), so records written before (1) cannot be handed a write task. Predicate, keyed on
   the roster's stable member NAMES (not the free-text `role`):

   ```js
   const READONLY_MEMBER_NAMES = new Set(['Architect','Researcher','Planner','Explorer','Reviewer','Plan Reviewer','Vision Analyst'])
   const denied = new Set(member?.toolDeny ?? (READONLY_MEMBER_NAMES.has(member?.name) ? ['write','edit','mpd_hashline_edit','bash'] : []))
   ```

   i.e. an unknown deny list is not treated as "can write" for a known read-only member.

**Wave placement:** a separate follow-up, not this wave. It is a scheduler-correctness defect in the
adopted plugin, unrelated to the settings-bridge work in flight, and it changes dispatch behaviour for
every team — it deserves its own fix + mount proof (`bun test packages/mpd-agent-teams-plugin` plus a
live dispatch arm) rather than a rider on the bridge wave. If it must ride this wave, piece (1) is the
single minimal change; piece (2) is the belt for pre-existing records.

## 7. What I could not determine

Whether the missing field is ALSO consumed elsewhere (e.g. any other reader of `member.toolDeny` on a team
record would be equally blind) — I checked the scheduler and members paths named in the task, not the whole
plugin. Worth one grep before the fix lands.
