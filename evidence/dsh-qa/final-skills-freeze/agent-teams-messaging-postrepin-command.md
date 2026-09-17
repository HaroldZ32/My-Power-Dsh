# Post-re-pin closing datum — the one-line command, its reading today, and what it should read after the re-pin

NOTE (self-corrected): the first capture of this file printed `exit 0` because `PIPESTATUS` was clobbered by the command-substitution assignment; the lane really exits **1** here, re-measured without a pipe and stored in `agent-teams-messaging-pre-repin.log`. Captured 2026-09-17T04:30Z (BEFORE the re-pin, lock still `c0dab864…`/319).

## The command (the lock check lives in the lane's SELF-TEST, `agent-teams-messaging.mjs:329-335`)

```
bun skills/dsh-qa/scripts/agent-teams-messaging.mjs --self-test; echo "exit=$?"
```

With a log kept (use `${PIPESTATUS[0]}`, not `$?`, because of `tee`):

```
bun skills/dsh-qa/scripts/agent-teams-messaging.mjs --self-test 2>&1 | tee .mpd/scratch/agent-teams-messaging-selftest-postrepin.log; echo "exit=${PIPESTATUS[0]}"
```

## Reading BEFORE the re-pin (measured: exit **1**; raw log `agent-teams-messaging-pre-repin.log`)

```
[agent-teams-messaging] FAIL: VENDOR_LOCK skills asset is stale: lock=319/c0dab8641697 tree=323/68318157344a (re-pin in the same commit, AGENTS.md §9)
```

## Expected AFTER `node scripts/repin-vendor.mjs --write --i-know-this-is-the-captains-step`

```
[agent-teams-messaging self-test] ok: R1 exports + SHIPPED send/clear/interject wiring + this case drives the tool surface + scheduler exclusion on both reads + RED-arm transform applies + VENDOR_LOCK skills pin current (<n> files, <sha>)
exit=0
```

## NOT this command (it is a different measurement)

`node scripts/run-qa-lanes.mjs --only=agent-teams-messaging` runs the lane's REAL CASE, not its self-test. The lane is declared `suites: []` + `outsideSuites`, so this says nothing about the vendor lock. Keep it, if at all, as an optional extra.

## Whole-corpus re-check for the same step

`bun run test:qa` → expect `[test:qa] all self-tests passed` (**45/45**). Today it ABORTS at this one lane because the loop is fail-fast; the honest pre-re-pin reading is my continue-past-failure loop in `evidence/dsh-qa/final-skills-freeze/selftest-loop.log` (**44 PASS / 1 FAIL**).

