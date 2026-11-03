# R2 check — moved assertions in the lane-B test diff

Contract `.mpd/plans/cellwork-vedit-p0-fix-r2.md` R2: "the old assertion and its replacement are named in
the lane report and the reviewer checks both. No other assertion moves."

## Measured: `git diff -U0 -- packages/mpd-team-core-plugin/test/`

```
 packages/mpd-team-core-plugin/test/mailbox-store.test.ts       | 10 +++++++++-
 packages/mpd-team-core-plugin/test/pr42-review-repairs.test.ts | 10 +++++++++-
 2 files changed, 18 insertions(+), 2 deletions(-)
```

Two removed lines TOTAL in the lane-B test tree — exactly the two superseded assertions:

```diff
-    expect(String((refused as Extract<SendResult, { ok: false }>).detail)).toBe('"senior" already has 8 undelivered message(s) (bound 8) — it is not keeping up')
-    expect(refused.refused).toBe('"Senior Engineer" already has 8 undelivered message(s) (bound 8) — it is not keeping up')
```

Their replacements (both keep recipient + count + bound, add the config key and BOTH recovery paths):

```diff
+      '"senior" already has 8 undelivered message(s) and the bound (mail.maxUndelivered) is 8 — it is not keeping up.'
+      + " Two recovery paths: acknowledge its inbox (cellwork_inbox for a cell seat, or agent_teams_mail {action:\"read\"} for a team member),"
+      + " or reassign the rows behind it (cellwork_dispatch {reassign:[{task_id, owner}]}). Nothing was written.",
...
+      '"Senior Engineer" already has 8 undelivered message(s) and the bound (mail.maxUndelivered) is 8 — it is not keeping up.'
+      + " Two recovery paths: acknowledge its inbox (cellwork_inbox for a cell seat, or agent_teams_mail {action:\"read\"} for a team member),"
+      + " or reassign the rows behind it (cellwork_dispatch {reassign:[{task_id, owner}]}). Nothing was written.",
```

Both are declared in-place with `CHANGED BY VEDIT-P0 C3/D2 (R2: …)` comments naming the counterpart file.

## Verdict on R2

- No assertion removed or moved outside the two contract-changed ones.
- Both replacements still assert the OLD facts (recipient, count 8, bound) and add the new ones, so the
  superseded sentence did not silently weaken into a substring-only check of the new wording.
- The new acceptance file `packages/mpd-team-core-plugin/test/vedit-p0-lane-b.test.ts` is UNTRACKED
  (new), which is why `git diff --name-only` does not list it; `git status --porcelain` does.
