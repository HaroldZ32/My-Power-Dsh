# t32 — PRE-REGISTRATION (no review performed; the object is not yet shipped)

**Task:** t32 — review, falsify t21 (the pause-status surface) · **Reviewer:** code-reviewer · **inScope:** `evidence/review/t21-status-line/**`
**Written:** 2026-09-17T08:3xZ · **Gate check at writing time:** `t21` = **in_progress** (attempt 2, agent-teams-engineer) and `lib/tools.js` is ALREADY being edited (mtime 08:31:54Z = 16:31:54 +0800). **Per the captain's instruction I did NOT start the review** — the object is the SHIPPED bytes. This page freezes the PRE-change baseline so the change direction is provable when t21 lands, and records the exact clauses I must check.

## 1. The pre-t21 baseline (frozen by hash, captured BEFORE t21 started editing)

| reading | value | source |
|---|---|---|
| working-tree `packages/mpd-agent-teams-plugin/lib/tools.js` (pre-t21) | sha256 `5fe18cdf62af6801e7fe52512920c023ac591adc2c0449a09ecd78f157bc68dd` | MY pin: `evidence/review/t12-lane-a/20260917T080041Z/PIN-1.txt` (08:00:41Z) and `PIN-2.txt` (08:21:11Z), with `mtime 2026-09-17 15:23:16 +0800` (07:23:16Z) |
| the same file at git HEAD | sha256 `0e0908e5b002c934…` (`git show HEAD:packages/mpd-agent-teams-plugin/lib/tools.js`) | HEAD differs from the working tree in OTHER wave-2 hunks (t8's guard etc.) but carries the SAME region text — verified |
| the wave-1 red baseline's copy | sha256 `49025f4d9901fb25…`, region occurrences **0** | so the pre-change region is NOT recoverable from `.mpd/red-baseline`; the copies above are the load-bearing ones |

**The pre-change region text, verbatim** (region `mpd-delta status-pause-mechanisms`; identical in HEAD and in the pre-t21 working tree, and quoted in my t14 addendum as the measured UNVERIFIED text):

```
//#region mpd-delta status-pause-mechanisms (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
        // T-19 (wave 1, adopted side): TWO pause mechanisms can stop this team and only ONE
        // of them is an agent-teams record. `halted` is ours and is rendered above (and in
        // the payload). The team watchdog's PRESERVING hold lives in the watchdog's own
        // store, and this surface no longer reads it: the reader region that used to sit in
        // this file went with the two tool-boundary guards, because a hold must stop NEW
        // DISPATCH only and must never refuse a member's own claim/update/kick. So this line
        // NAMES both mechanisms and DEFERS the hold to its owner instead of guessing at it —
        // and it adds no resume verb: releasing a hold stays the watchdog's own
        // `session-watchdog-resume`, a captain action.
        `Pause: agent-teams halt ${team.halted ? 'ACTIVE' : 'not active'} · team watchdog hold: not read on this surface — run session-watchdog-status (released only by its own session-watchdog-resume)`,
//#endregion mpd-delta status-pause-mechanisms
```

**In-flight state, explicitly NOT a reading:** the current working-tree `lib/tools.js` is `b08a7d6c38194311…` (mtime 08:31:54Z) and the region has moved (region markers now at lines 3585/3591). Any reading taken from this revision is meaningless for the verdict; it is recorded here only so a later reader can tell "mid-edit" from "shipped".

## 2. The clauses I must check against the SHIPPED text (not the author's summary)

* **The user's T-19 ruling, as carried verbatim by the r-C acceptance (`t3`):** "`agent_teams_halt` becomes the SOLE external mechanism; the watchdog's PRESERVING hold is demoted to its internal implementation. Surface, tools and docs expose one mechanism." — clause 1 = the semantics (ONE external pause, the hold named as the internal implementation); clause 2 = **BOTH TOOLS STAY REGISTERED**.
* **The captain's three-surface ruling** (`.mpd/plans/friction-p2-wave-captain-log.md:180`): "(i) SEMANTICS in `t10`; (ii) the STATUS LINE in `packages/mpd-agent-teams-plugin/lib/tools.js` (lane A's file) → new task `t21` …; (iii) the README pair → `t20`. **Both tools stay REGISTERED (`holds-lifecycle.test.ts` pins the three tool names), so no tool-schema change and no mounted-boot tool-list reading.**"
* **The register rows:** `.mpd/TODO.md:155` (the friction + §Fix: "one pause surface with one resume, or a status line that says which mechanism is active") and `:517` (the wave-2 status: "two pause mechanisms coexist — PARTIAL. The pause union reports and the surface names the active mechanism (t13); consolidating … is not attempted this wave").
* **The t32 acceptance's tool list, verbatim:** `agent_teams_halt`, `session-watchdog-hold` and `session-watchdog-status` must remain in the tool list (the holds-lifecycle pin stays green); a tool removed without a mounted-boot tool-list reading is a FINDING.

## 3. The plan I will execute when t21 goes terminal (captain's constraints 1–3 + T-89)

1. **Pin by hash with a settle window**: hash `lib/tools.js`, the pinning test, `holds-lifecycle.test.ts` and the packer/registry inputs at first read, re-hash after a settle window, and state which revision every reading belongs to.
2. **Quote the ruling verbatim and check each clause against the SHIPPED rendered text + structured payload** — never against the author's summary. The pre-change text above is my "before"; the shipped text is the "after".
3. **Make the pin prove it can redden**: revert the collapse in a scratch copy of `lib/tools.js` (recorded recipe, occurrence-count asserted, copy path named, `.test.*`-free so it cannot be discovered by a substring filter per T-89), run the pinning test against the reverted copy, and keep BOTH readings (green on shipped, RED on reverted).
4. **Diagnostics survive**: the status must still name WHICH mechanism is active and the hold's id/reason when one is — a collapse that loses the operator's diagnosis is a separate defect, not a pass.
5. **Both tools stay registered**: verify the three names above via the holds-lifecycle pin AND, where possible, a mounted-boot tool-list reading (the comment above says no schema change is expected, so absence of a mounted reading is not per-se a finding — but a REMOVAL without one would be).
6. **Form**: `./`-prefixed PATH form for every `bun test`; no git writes; findings structured (id/severity/problem/requiredFix/file) and they FAIL the task; judge the SOURCE files (the packed README pair is pre-edit until the captain's single re-pack — an ordered state, not a defect).

**Status: waiting for `t21` to go terminal. Nothing in the shipped tree was touched; no test, driver or tool was run for this page.**
