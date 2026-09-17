REVIEW t24 (rev-D) — independent reproduction of wave-2b lane D, captured 2026-09-17T14:59:07Z

## 1. FINDING F1 (blocker): the T-69 wrapper rewrite references an UNDEFINED `REPO` — 5 corpus lanes crash
Reproduced by running the lane's OWN declared --only selection (10 lanes): exit 1, 5 FAIL + 1 timeout.
Every failing lane's log carries the same error (grep 'REPO is not defined' = 1 per file):
  mount-assert         ReferenceError: REPO is not defined
  agent-teams-adopt    ReferenceError: REPO is not defined
  workmate-library     ReferenceError: REPO is not defined
  bundle-lifecycle     ReferenceError: REPO is not defined
  team-route-rewire    ReferenceError: REPO is not defined
  session-start-team   no REPO error (timeout 300s; its own --self-test exits 0)

The offending line, mount-assert.mjs main() (the lane's own new line, from its diff):
  const run = spawnSync(process.execPath, [join(REPO, "scripts", "dump-config.mjs"), ...])

## 2. The static proof, per changed file: `REPO` uses at HEAD vs now, and whether any binding defines it
  skills/dsh-qa/scripts/agent-teams-adopt.mjs              join(REPO,...) pre=0 post=1 defined-binding=0
  skills/dsh-qa/scripts/bundle-lifecycle.mjs               join(REPO,...) pre=0 post=3 defined-binding=0
  skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs       join(REPO,...) pre=8 post=8 defined-binding=1
  skills/dsh-qa/scripts/lib/tui-lane.mjs                   join(REPO,...) pre=4 post=5 defined-binding=0
  skills/dsh-qa/scripts/mount-assert.mjs                   join(REPO,...) pre=0 post=1 defined-binding=0
  skills/dsh-qa/scripts/relocate-smoke.mjs                 join(REPO,...) pre=0 post=0 defined-binding=0
  skills/dsh-qa/scripts/session-start-team.mjs             join(REPO,...) pre=0 post=0 defined-binding=0
  skills/dsh-qa/scripts/team-route-rewire.mjs              join(REPO,...) pre=0 post=1 defined-binding=0
  skills/dsh-qa/scripts/tui-team-surface.mjs               join(REPO,...) pre=9 post=9 defined-binding=0
  skills/dsh-qa/scripts/workmate-library.mjs               join(REPO,...) pre=0 post=1 defined-binding=0
  skills/dsh-qa/scripts/workmate-team-member.mjs           join(REPO,...) pre=0 post=0 defined-binding=0
  skills/dsh-qa/scripts/wave2b-lane-d.mjs                  join(REPO,...) pre=0 post=7 defined-binding=1

## 3. The arms do not cover the edited path: every modified driver's --self-test exits 0
  skills/dsh-qa/scripts/agent-teams-adopt.mjs              --self-test exit=0
  skills/dsh-qa/scripts/bundle-lifecycle.mjs               --self-test exit=0
  skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs       --self-test exit=0
  skills/dsh-qa/scripts/lib/tui-lane.mjs                   --self-test exit=0
  skills/dsh-qa/scripts/mount-assert.mjs                   --self-test exit=0
  skills/dsh-qa/scripts/relocate-smoke.mjs                 --self-test exit=0
  skills/dsh-qa/scripts/session-start-team.mjs             --self-test exit=0
  skills/dsh-qa/scripts/team-route-rewire.mjs              --self-test exit=0
  skills/dsh-qa/scripts/tui-team-surface.mjs               --self-test exit=0
  skills/dsh-qa/scripts/workmate-library.mjs               --self-test exit=0
  skills/dsh-qa/scripts/workmate-team-member.mjs           --self-test exit=0

## 4. The lane's OWN --only log: 3 case lines, not the 10 declared, and it already carried a FAIL
3
[mpd-qa:(only)] PASS case=wave2b-lane-d evidence=evidence/dsh-qa/wave2b-laneD/2026-09-17T14-42-24.090Z/result.json log=evidence/dsh-qa/wave2
[mpd-qa:(only)] PASS case=workmate-team-member evidence=evidence/plan-f/workmate-team-member/2026-09-17T14-42-25.789Z log=evidence/dsh-qa/wa
[mpd-qa:(only)] FAIL case=session-start-team reason=exit-1 exit=1 evidence=evidence/dsh-qa/session-start-team/2026-09-17T14-43-43.007Z log=e
[mpd-qa:(only)] exit 1 (0=all green, 2=some unavailable, 1=some failed, 3=runner error)

## 5. What REPRODUCED (positives, verified by me)
- single-writer from outside: exactly ONE task holds a corpus pattern (t18, skills/**); the other 2b lanes hold none
- the ONE re-pin is OWED: VENDOR_LOCK.json unmodified (git status empty), `repin-vendor --check` exit 1
  MY re-derivation at my own moment: computed (LF) treeSha=234010aeb8e359a0f61b701b616d091edc7ea54acd999413716cefc001fd8c70 fileCount=324
  the lane's preview quoted the SAME values; superseded previews named; the raw-bytes value is marked NEVER-write
- union rule: tree shows 14 entries (13 M + 1 ??), all under skills/**, 14 distinct, every quoted sha256 reproduced (14/14)
- `--check-drift` exit 0: '46 lane script(s) discovered, 46 listed, 0 unlisted, 19 outside every suite', immutability required=10
- the T-80 rule: `node ./scripts/check-citations.mjs --driver-headers` -> 54 files, 2 claim sets, 0 violations
- lane D's driver `bun ./skills/dsh-qa/scripts/wave2b-lane-d.mjs --self-test` -> exit 0, 7/7 arms
- `bun run test:qa` ABSENT from the lane's verify; the lock-asserting lane `agent-teams-messaging` is excluded from --only (named in the acceptance, NOT named in the lane's README)

## 6. BOUNDS of this review
- T-25's live store reading was not taken (no --store anywhere): I did not take one either
- session-start-team's 300s timeout is NOT attributed; its own --self-test exits 0 and it carries no REPO error
- the corpus digest was read ONCE at my moment (the lane's preview reproduced exactly); a second read after any further edit is required
