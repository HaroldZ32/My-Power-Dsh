t21 BLOCKER — a wave-landed workmate guard is UNSATISFIABLE in a POSIX sandbox (cross-lane product defect)
Recorded by qa-lane-engineer, 2026-09-17T03:25Z. Owner of the code: packages/mpd-workmate-plugin (T-43 lane, platform-engineer).

WHAT HAPPENS
`workmate-library --no-skip` (t21 verify 1) fails from ~03:08Z onward while it passed at 02:53Z. Root cause is
NOT the lane: every workmate mutation is refused 403 by the T-43 real-home guard, which misreads the SANDBOX as
the real library.

MEASURED (all in this directory / on this host)
1. `HOME=/tmp/fakehome node -e '…os.homedir()'` → `HOME=/tmp/fakehome | os.homedir()=/tmp/fakehome | equal=true`
   i.e. on POSIX `os.homedir()` FOLLOWS the HOME environment variable.
2. Invoking the plugin guard exactly as a sandboxed QA boot does (HOME=<sandbox>, DSH_HOME=<sandbox>):
   `REFUSED: mpd_workmate: refusing to fixture mutation inside the REAL library /tmp/fakehome/.mpd/workmate while
    DSH_HOME=/tmp/fakedsh marks an isolated/QA boot — …`
   The guard's predicate is
     `if (home !== undefined && home !== "" && resolve(home) !== resolve(realHome) && inside(resolve(home))) return`
   and `realHome = homedir()` is COMPUTED FROM THAT SAME `home`, so the `resolve(home) !== resolve(realHome)` test
   can never be true for a sandboxed boot. The guard therefore refuses exactly the recipe its own message
   prescribes ("set HOME=<sandbox> (T-43)").
3. The documented override does bypass it: `MPD_DSH_WORKMATE_ALLOW_REAL_HOME=1` → `ALLOWED via override`.
   t21 does NOT use that override: silencing an isolation guard to make a lane pass is the green-washing pattern
   this wave forbids.
4. The HOME-independent primitive that would make the predicate work:
   `os.userInfo().homedir` = `/root` while HOME=/tmp/fakehome → `ignores HOME = true`.
5. Timeline (dist rebuild vs lane runs):
   - `packages/mpd-workmate-plugin/dist/index.js` mtime 2026-09-17 10:54 local (= 02:54Z);
     `src/index.ts` mtime 10:31 local (= 02:31Z).
   - `evidence/plan-f/workmate-library/2026-09-17T02-53-17.548Z` → `files.ok=true, uses=2, flow.ok=true` (old dist)
   - `…T03-08-05.586Z` → files.ok=false, flow.ok=false · `…T03-14-09.939Z` → flow.ok=true, files.ok=false
   - `…T03-18-40.091Z` → files.ok=false (the plugin's refusal text is in that run's output.log)
   So the guard landed in THIS wave and broke every sandboxed workmate mutation from that moment.

IMPACT (beyond t21)
Any QA lane that mutates the workmate library under a sandboxed HOME now fails: `workmate-library` (t21 verify 1),
`workmate-team-member`, and the workmate steps inside the agent-teams lanes. A normal session is unaffected
(no DSH_HOME → the guard returns early), which is why only the QA surface shows it.

FIX DIRECTION (owner's scope, packages/**)
Compare the library root against a HOME-independent notion of the real home, e.g.
`const realHome = userInfo().homedir` (node:os) instead of `homedir()`, keeping the current semantics:
with DSH_HOME set → allow only when HOME is set, resolves OUTSIDE the real home, and the library root lies inside
HOME; otherwise refuse 403 with the same message. Add a self-test arm for both sides.

WHAT I DID NOT DO
No edit to packages/**, no `MPD_DSH_WORKMATE_ALLOW_REAL_HOME=1` in the lane, no weakening of the lane assertion.
t21 stays open: its four items are implemented and evidenced; verify 1 is blocked by this defect.
