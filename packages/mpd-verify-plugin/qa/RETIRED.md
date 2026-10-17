# RETIRED — the authored twin of the `verify-law` QA case (2026-10-17)

`packages/mpd-verify-plugin/qa/verify-law.ts` was the **authored** copy of the QA case that the wave's
single `skills/**` writer placed at `skills/dsh-qa/scripts/verify-law.ts`. The two copies were kept
byte-identical by an anti-drift arm inside the case.

**Why the twin is gone.** The 2026-10-17 user ruling withdrew the verification law's mechanical write
guard, and the case was RE-PURPOSED to assert the new behaviour (a code write LANDS with no loop armed;
the retired `verify.mode: "hard"` knob is inert). A second, verbatim copy of a body that now belongs to
the skill corpus invites exactly the drift the old arm existed to catch — and this directory is outside
the single `skills/**` writer's mandate, so the copy could not be maintained there.

**Where the case lives now (the ONLY copy).** `skills/dsh-qa/scripts/verify-law.ts`, registered in
`skills/dsh-qa/SKILL.md`, run by `bun run test:qa`. Its `--self-test` also asserts that this retired twin
stays ABSENT, so a well-meant re-copy fails loudly instead of silently re-introducing a second body.

**Nothing here is needed at runtime**: no row, preset, patch, script or test imports from this directory.
