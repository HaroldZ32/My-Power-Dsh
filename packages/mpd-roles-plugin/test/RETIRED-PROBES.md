# Retired probes in this package's `test/` directory

## `captain-investigation-evidence.ts` — RETIRED 2026-10-17

**What it was.** A live lane-L probe (2026-10-08) that booted a headless session and asserted the
CAPTAIN-INVESTIGATION guard: the top-level `mpd` agent's `read`/`grep`/`glob` on a SOURCE path refused,
the documentation band still readable, and the boot line reporting `captainInvestigation=<mode>`.

**Why it is gone, not repaired.** The user's 2026-10-17 ruling withdrew that guard together with the
delegation gate and the verification law's write guard (`.mpd/plans/harness-021-rollback.md`, R1: one
agent, its whole tool pack, steered by the persona prompt). `packages/mpd-roles-plugin/src/index.ts`
no longer installs `installCaptainInvestigationGuard`, so the boot line reports
`captainInvestigation=absent reason=withdrawn:2026-10-17-user-ruling(captain.investigation)` and the
probe's every assertion describes a surface that no longer exists. Keeping it would fail a CORRECT tree
— the one thing this repository's rule 7 forbids — and re-purposing it into a second withdrawal probe
would duplicate `skills/dsh-qa/scripts/captain-full-tools.ts`, whose boot-line arm is the
discriminating falsifier for the withdrawal.

**What replaces it as a guard against the ceremony coming back.** Three standing arms, none of them a
duplicated live lane:
- `skills/dsh-qa/scripts/captain-full-tools.ts --self-test` fails if the shipped apply site contains any
  of the three install calls, and its live lane fails unless the boot line reports all three as absent;
- `packages/mpd-roles-plugin/test/team-plane.test.ts` still pins the read-only guard's deny list and the
  session gate's OPT-IN default;
- the withdrawn modules (`src/captain-investigation.ts`, `src/delegation-gate.ts`, `src/verify-guard.ts`)
  stay SHIPPED as reference implementations with their own unit arms — no install references them, and
  the cross-package coupling inventory is what would notice a new edge.
