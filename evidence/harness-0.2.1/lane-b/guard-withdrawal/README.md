# Lane B evidence — the guard rollback (harness-021-rollback)

Recorded by the lane B writer (Deep Worker). Frozen contract: `.mpd/plans/harness-021-rollback.md`
(requirements R1, R7; TODOs 5 and 6).

## What this lane changed

- `packages/mpd-roles-plugin/src/index.ts` — the ONE `apply()` install site no longer calls
  `installVerifyGuard`, `installCaptainInvestigationGuard` or `installDelegationGate`. The boot line keeps
  a token for each of them and prints `=<name>=absent reason=withdrawn:2026-10-17-user-ruling(<knob>)`,
  never a mode. `installReadonlyGuard` and `installAskUserQuestionGuard` are unchanged and still install.
- `packages/mpd-roles-plugin/src/complexity-gate.ts` — `resolveGateMode` now defaults to `off` (an absent
  key AND every unknown value), and only an explicit `"mechanical"` / legacy `true` arms the ceremony.
- `packages/mpd-roles-plugin/src/session-gate.ts`, `src/ask-user-guard.ts` — doc headers corrected.
- `packages/mpd-roles-plugin/test/team-plane.test.ts` — the `resolveGateMode` arms and every arm whose
  SUBJECT is the staging route now ask for `mechanical` explicitly (`MECHANICAL_OPT_IN`), because the
  default read is `off`.
- `packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` — the ONE
  `VERIFY_SERVICE` entry deleted (the inventory may only shrink; the import is gone with the install).
  Scope extension granted by the captain for exactly this file.
- `skills/dsh-qa/scripts/verify-law.ts` — REPURPOSED: asserts the code write LANDS with no loop armed, and
  that the retired `verify.mode: "hard"` knob can no longer deny.
- `skills/dsh-qa/scripts/delegation-gate.ts` — REPURPOSED: asserts a `subagent` call is NOT refused, and
  that an explicitly spelled `delegation.gate: "deny"` is inert.
- `skills/dsh-qa/scripts/session-start-team.ts` — the mode-resolver arms and the live sides follow the
  `off` default; sides that measure the MECHANICAL route seed it explicitly.
- `skills/dsh-qa/scripts/captain-full-tools.ts` — NEW: one isolated boot proving the top-level agent
  reads a source path, writes a code path with no loop armed, runs `bash`, is OFFERED the whole pack, and
  sees the withdrawn guards reported `absent`.
- `skills/dsh-qa/SKILL.md` — the two re-purposed rows rewritten (reason in the row) and the new case
  registered.
- `packages/mpd-ulw-plugin/test/commands.test.ts` — REPURPOSED (scope granted by the captain for this ONE
  file): its helper treated an omitted `team.gate` as "the mechanical default", so flipping the default
  reddened six arms. Each of those six now opts in explicitly (`workdirs("mechanical")`) with the reason
  written above it. The ULW production code was NOT touched.

## The boot line, verbatim

Produced by a REAL sandbox boot of the CHANGED source. `dist/**` is not this lane's write scope, so the
row was rebuilt into a scratch path and the SANDBOX home patch (never the repo) was pointed at it:

```
.toolchain/node_modules/.bin/bun build packages/mpd-roles-plugin/src/index.ts \
  --target node --format esm --outfile /tmp/<sandbox>/build/mpd-roles/index.js
DSH_HOME=/tmp/<sandbox> node scripts/install-profile.ts --yes --dsh-home /tmp/<sandbox> \
  --profile mpd-headless --skip-toolchain
# the sandbox home patch's ONLY change: the mpd-roles row's `name:` points at the scratch build
env -u DEEPSEEK_API_KEY DSH_HOME=/tmp/<sandbox> HOME=/tmp/<sandbox> \
  dsh --profile mpd-headless "Reply with the single word ok."   # cwd = a fresh sandbox workspace
```

`<ws>/.mpd/logs/mpd-roles.log`:

```
[2026-10-17T13:27:40.612Z] [mpd-roles] team plane: readOnlyGuard=installed deny=8 verifyGate=absent reason=withdrawn:2026-10-17-user-ruling(verify.mode) captainInvestigation=absent reason=withdrawn:2026-10-17-user-ruling(captain.investigation) delegationGate=absent reason=withdrawn:2026-10-17-user-ruling(delegation.gate) askUserQuestion=installed rosterSection=agent-scoped order=605 sessionGate=off
```

The boot exited 0 and the session answered its turn (`ok`), so the line is a live apply, not a dry run.
Bound, stated: the shipped `packages/mpd-roles-plugin/dist/index.js` still holds the PRE-wave bytes — the
pinned-toolchain rebuild is the wave's integration step (T-88), and the F1 arm below reddens until it
lands.

## The full-tool-pack witness, measured on the same scratch build — CORROBORATIVE ONLY

One more sandbox boot (same scratch build, source file COPIED into the sandbox workspace) driven with a
forced three-call prompt, then decoded from the HARNESS session log (`lib/session-evidence.ts`), never
from the model's prose:

```
boot_exit=0
code_written=yes
loop_files=
PACK_OFFERED=["bash","edit","glob","grep","read","subagent","write"]
read:  called=true succeeded=true
write: called=true succeeded=true
bash:  called=true succeeded=true
mpd_verify_open: called=false
```

**BOUND, measured by the verification lane — NOT this lane's discovery, and it changes what the block
above is worth:** a one-shot HEADLESS boot never composes an agent preset. The harness's own
`@deepseek-ai/dsh-headless` `assertAdoptable` throws
`session "…" runs under agent preset "…", which the one-shot runner does not compose`, and the withdrawn
guards were AGENT-SCOPED, so they never armed in this lane at all. The PRE-wave tree on 0.2.0 AND 0.2.1
already passed these exact read/write/bash arms, with `verifyGate=installed captainInvestigation=deny` on
its boot line. The arms above therefore witness that the pack is intact and callable on this composition;
they do NOT discriminate the withdrawal. What discriminates in THIS lane is the boot line (a stale dist
prints modes) and, after the rebuild, `captain-full-tools.ts`'s `DISCRIMINATING-guard-state-reported`
arm — its read/write/bash siblings carry the `corroborative-` prefix for exactly this reason. A
discriminating LIVE agent-preset arm needs the web profile's `session/create` with `agentPreset: "mpd"`,
which is the verification lane's subject.

## Gates run

| command | result |
|---|---|
| `bun test packages/mpd-roles-plugin` | 155 pass, 1 fail — the failure is `F1 shipped artifact > the committed dist is the byte-identical product of a canonical build (T-62)`, i.e. the stale `dist/` this lane may not write; every other arm is green |
| `bun run typecheck` | exit 0 (`tsgo --noEmit`, no output) |
| `node scripts/verify-comment-coverage.ts` | VERDICT: PASS — 406 files, 36138 declarations |
| `bun test packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` | 2 pass, 0 fail |
| `node skills/dsh-qa/scripts/verify-law.ts --self-test` | exit 0 |
| `node skills/dsh-qa/scripts/delegation-gate.ts --self-test` | exit 0 |
| `node skills/dsh-qa/scripts/captain-full-tools.ts --self-test` | exit 0 |
| `node skills/dsh-qa/scripts/session-start-team.ts --self-test` | exit 0 |
| `bun run test:qa` | 50 of 51 green; `preset-conformance.ts` reddens on `the mpd preset declares row(s) the installed standard preset does not declare at all: time-context, tool-schedule, tool-plugin-market` — the parallel preset lane's 0.2.1-rc.2 adaptation against this machine's INSTALLED 0.2.0-rc.2 harness, i.e. F1's environment, not a guard-rollback arm |
| `bun test packages` (whole suite, 1981 tests) | 2 fail, both DERIVED-ARTIFACT arms: `packages/mpd-roles-plugin/test/adapter-identity.test.ts` and `packages/mpd-ext-plugin/test/adapter-identity.test.ts` — each asserts its committed `dist/` is the byte-identical product of a canonical build, and the wave's rebuild (lane F) has not run yet. Everything else is green, including the six `mpd-ulw-plugin` arms this lane re-purposed. |
| `bun test packages/mpd-ulw-plugin` | 24 pass, 0 fail (after the re-purpose) |
| `bun run verify:docs` | exit 0 (no human-facing doc in this lane's diff; `skills/**` and `evidence/**` are outside the parity band) |

## Stale probes — DISPOSED (scope extended by the captain)

- `packages/mpd-roles-plugin/test/captain-investigation-evidence.ts` — RETIRED (deleted). It probed the
  withdrawn reconnaissance denial; the reason is recorded in
  `packages/mpd-roles-plugin/test/RETIRED-PROBES.md`, which also names the three standing arms that
  replace it (no duplicated live lane).
- `packages/mpd-verify-plugin/qa/verify-law.ts` — RETIRED (deleted). It was the AUTHORED twin of the
  re-purposed `skills/dsh-qa/scripts/verify-law.ts`; the reason is recorded in
  `packages/mpd-verify-plugin/qa/RETIRED.md`, and the case's `--self-test` now FAILS if the twin comes
  back (a well-meant re-copy reddens instead of silently re-introducing a second body).
