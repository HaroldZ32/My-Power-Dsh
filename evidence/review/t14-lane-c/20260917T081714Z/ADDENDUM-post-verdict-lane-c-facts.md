# ADDENDUM (nested beside the sealed t14 verdict) — the four post-verdict lane-C facts the captain handed over

**Task:** t14 (review-C) · **Reviewer:** code-reviewer · **Written:** 2026-09-17T08:2xZ
**Status of the verdict:** t14 is TERMINAL (verdict=pass, attempt 4, attempt_id `7c133ef3-5e5b-4d95-a3d7-86d0d5661efb`). My PIN-2 `diff` against the live tree was EMPTY when I re-checked, so this page ADDS readings; it does not revise the verdict. `result.json` was not edited.

## FACT 1 — the config lane's own `--self-test` (VERIFIED)

```
bun skills/dsh-qa/scripts/team-watchdog-config.mjs --self-test        -> exit 0
[self-test] ok   live-live: pass/0
[self-test] ok   live-restart-needed: fail/1
[self-test] ok   live-not-same-instance: fail/1
… (8 negative mutants, each failing its own check by name)
[self-test] PASS — team-watchdog-config (8 checks, 0 failed)
```
Raw: `lc-config-selftest.out`. The captain's three arm readings are quoted verbatim and present.

## FACT 2 — `--mutant restart-needed` exits 0 while the assertion goes RED (VERIFIED)

```
bun skills/dsh-qa/scripts/team-watchdog-config.mjs --mutant restart-needed --out <review>/cfg-mutant  -> exit 0
[mpd-team-watchdog-test] KNOBS DIVERGE (§7.3): … warnSilenceMs: live=90000 file=900000 …
[team-watchdog-config] --live (mutant restart-needed) mounted=90000 file=900000 sameInstance=90000 fileApplied=true restartRequired=true
[team-watchdog-config] liveWithoutRestart: false — liveness LOST: …
[team-watchdog-config] mutant restart-needed: DETECTED (the assertion reddened)
```
Raw: `lc-config-mutant.out`, `cfg-mutant/live-result.json`. Detection is the success condition, as stated.

## FACT 3 — the KICK row (T-48) is row (g) of `watchdog-redesign.mjs` and MUST run under `bun` (VERIFIED both ways)

Row definition read from source: `id: "g"`, `kind: "suite"`, `KICK_INSTRUMENT = "packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts"`.

```
bun skills/dsh-qa/scripts/watchdog-redesign.mjs --row g --out <review>/row-g-bun   -> exit 0
  RED   verdict: RED   — instrument=…lane-c-wave2.test.ts exit=0 readings=pass kickControl=pass claimUpdateControl=pass
  GREEN verdict: GREEN — instrument=…lane-c-wave2.test.ts exit=0 readings=pass kickControl=pass claimUpdateControl=pass
  PASS — 9 checks, 0 failed
  NOT CLAIMED: a --row subset run verdicts only the requested rows (g); it is NOT the contract's full §9 verdict
```
Raw: `row-g-bun.out`, `row-g-bun/result.json`.

**Cross-check against my own pin (independent):** the row's `instrumentSha256` is `8ffc36053f5f98ef18bd130ecff8b55eadd4e3d571fc847345d85e07ffa7121d` — the SAME file my t14 PIN-2 pinned (`8ffc36053f5f98ef`), and the driver's own `green.fingerprints` are `engine=a82913cc…`, `dist=6aa3069c…`, `machine=47511b5d…` — all equal to my pinned values. The instrument is one file (12 tests), the clean-form set published in `CORRECTION-clean-form-readings.md`.

**The trap, reproduced:** `node skills/dsh-qa/scripts/watchdog-redesign.mjs --row g --out <review>/row-g-node` → exit 1, `CRASH: Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/.mpd/red-baseline/packages/mpd-team-watchdog-plugin/src/team.js' imported from …/.mpd/red-baseline/packages/mpd-team-watchdog-plugin/src/machine.ts`. Characterisation: the failure is Node's ESM resolver refusing the RED tree's TypeScript/extension-less imports while LOADING the baseline — it reproduces with the committed driver and does not involve lane C's change, but the message names the red tree, so it reads like a lane-C regression if run with `node`. The driver's own usage prints `bun …` on every line, so no fix is required; recorded so the next reader does not misattribute it.

## The one surface still UNVERIFIED (unchanged by this addendum)

`packages/mpd-agent-teams-plugin/lib/tools.js`, region `mpd-delta status-pause-mechanisms`: mtime `2026-09-17 15:23:16.600902675 +0800` = **07:23:16Z**, i.e. PRE-VERDICT and untouched since; the text still reads *"TWO pause mechanisms can stop this team … this line NAMES both mechanisms and DEFERS the hold to its owner"*. **t21 is now CLAIMED** (attempt 2, agent-teams-engineer) — the collapse is in flight but NOT landed, so the single-mechanism claim remains verified on the tools + the watchdog's own status tool + the SOURCE doc pair, and UNVERIFIED on the agent-teams status line. My t14 addendum-1 note therefore stands on the current bytes; `t32` (falsify t21) is the queued review for it.
