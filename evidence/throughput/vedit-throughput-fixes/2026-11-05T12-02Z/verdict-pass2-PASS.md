# Re-check verdict — F1 / F2 / F3 repairs (wave `vedit-throughput`)

Instant: **2026-11-05T12:22:24Z**
Reviewer: `reviewer-1` (roster Reviewer, task **T10**), independent of the builders.
Reviewed state: `f383c7ec` (repair commit) — parent HEAD; wave = `4a565086` → `9c87a4a7` → `f383c7ec`;
prior reviewed state (first review) was `4f102eca`. Working tree re-checked AFTER the gate sweep:
0 tracked modifications, `HEAD` unchanged, so nothing drifted under the judgement.
Basis frozen BEFORE any repair read: `.mpd/reviews/vedit-throughput-recheck-basis.md` (2026-11-05T12:17:07Z).
Prior verdict under repair: `.mpd/reviews/vedit-throughput-2026-11-05T12-03Z.md` (REQUEST CHANGES).

## Verdict: **PASS** — F1, F2 and F3 are repaired; two LOW findings, neither blocking

Risk of the re-checked state: **LOW**. No regression found in the reviewed surface, no gate weakened,
no test edited to make a change pass. The two findings are documentation/robustness items a next
reader can fix in one line each; they do not contradict a contract clause.

Contract of record (unchanged): `.mpd/plans/vedit-throughput-fixes.md` (FROZEN v2). Docs of record:
`AGENTS.md`, `packages/mpd-team-watchdog-plugin/README.md` (+ `README.zh-CN.md`),
`agent-references/supervision.md`, `packages/mpd-roles-plugin/README.md`.

## F1 (was HIGH) — the bash exemption is decided per CHILD: **REPAIRED**

Adjudication against §D2.6 ("if the child's CURRENT tool call is `bash` and still in flight → DO NOT
interrupt … otherwise → … interrupt the child") and the pre-committed criteria 1–7.

1. **Decision key is the child, not the role.** `spawn-async.ts#consultActivityKeyOf` reads
   `agent.session.id` and returns the roster label ONLY under the `label:` prefix when the agent
   carries no session id; `consultLabelKey` spells that fallback. Two children of one role therefore
   occupy two buckets.
2. **The deadman reads its OWN child's bucket.** `spawn-async.ts#onDeadman` calls
   `deps.activityOf?.(record.handle?.id, record.role)` — the first argument is `DshAsyncAgent.id`,
   and `ConsultSupervisorDeps.activityOf` is documented as child-id-first with role as display
   fallback. `index.ts` wires `activityOf` to `toolActivity.get(childId)` and consults
   `consultLabelKey(role)` ONLY when the child reported no id at all.
3. **A sibling can no longer clear an open bash.** `index.ts#noteToolStart` / `noteToolEnd` write and
   close the bucket selected by `activityKey(exec)` (same child-id derivation), so a sibling's
   `end` addresses a different key. Structurally impossible, not merely untested.
4. **Label is display-only.** It survives as (a) the `label:` fallback key and (b) the human-readable
   `role=` in `consult-long-bash`; no decision reads it as an identity.
5. **The blocking path passes the child identity too.** `index.ts` starts the blocking
   `mpd_role_spawn` through `consultSupervisor.start({ raise: () => dsh.spawnAgentAsync({…}) })`, so
   the SAME handle (`record.handle.id`) feeds the deadman — §D2.2's "both paths share supervision"
   holds.
6. **The behavioural test discriminates.** `consult-supervision.test.ts` "two consults of ONE role:
   only the WEDGED one is interrupted, the bash-holding twin is untouched" starts two same-role
   consults, gives only `bash-child` an open `bash`, and asserts
   `interrupts === ["wedged-child"]`, `bashHolder.state === "running"`, `wedged.state ===
   "interrupted"`. On the superseded label-keyed design the supervisor passed the ROLE as the first
   argument, so the bash holder would have been interrupted as well and the assertion would redden —
   it is a real regression lock, not a restatement.
7. **Identity equation, established from the adapter's own code.** `DshAsyncAgent.id` is
   `raw.childId` (`activationHandleOf`), documented as the child SESSION id (`childId` is the
   optional pre-reservation the continuation manager mints); the same value is what
   `subagents.interrupt(targetSessionId)` and `sendMessage` receive; and the adapter resolves a live
   agent by `agent.session.id === childId` (`sessionIdOfAgent`, `liveAgent`). So the write key and
   the read key are the same namespace. Bound: see "Declared bounds" — no live child boot was run.

## F2 (was MEDIUM) — watchdog docs and the `forceAfterMs` front doors: **REPAIRED**

- **The three pre-D3 NOT-CLAIMED bullets are gone, replaced by true D3 statements.** "No wedge
  detection INSIDE a hanging tool" → "**No pardon for a hanging NON-bash tool**" (state the r6 rule,
  then that past `forceAfterMs` a non-`bash` open tool IS a force target; the one exemption is an
  OPEN `bash`, any age, no clock needed, one `long-bash` incident). "An in-flight turn is not
  aborted" → "**An in-flight turn IS aborted — by the force supervisor, never by the hold**".
  "No team mutation, by construction" → "**No team FILE is written here — the board IS mutated, by
  DIRECTION**" (through `mpd-team-core`'s `mpdTeamActions`). §D3.4's decider/actor seam is now
  described as it ships.
- **`forceAfterMs` is in the frozen §3 knob table** (`| watchdog.forceAfterMs | 900000 | …`, §D3.2 /
  §D3.6 semantics: `0` disables, read live per tick).
- **Both front doors that belong to this wave's scope are wired**: the bundle patch row config
  (`cordis.patch.yml`, watchdog row, with a comment naming the three agreeing layers) and
  `mpd-config`'s `SettingsSchema.watchdog.forceAfterMs`. `machine.ts`'s `WATCHDOG_DEFAULTS` carries
  it and `resolveKnobs`/`loadKnobs` include it in the knob-key list.
- **The one remaining gap is a NAMED residual with a REASON, which I verified rather than accepted
  on trust.** The shared render list (`SETTINGS_KNOBS` in `mpd-config`) and the Web card's mirrored
  `FIELDS` in `packages/mpd-bundle-plugin/src/settings-card.ts` do not carry the row yet; the README
  says so and says why (adding it in `mpd-config` alone reddens that package's no-drift parity pin).
  Confirmed: `packages/mpd-bundle-plugin/test/settings-card.test.ts` asserts
  `SETTINGS_KNOBS` length **47** AND `FIELDS.map(path) === SETTINGS_KNOBS.map(path)`, and asserts the
  card SOURCE must NOT import `SETTINGS_KNOBS`. The residual is factual, precisely scoped to another
  package, and `forceAfterMs` is settable today through the row config and `.mpd/mpd.jsonc`. Under
  the re-check criteria this is a PASS, not an omission.
- **The zh-CN twin matches**: the knob row, the "seven of them / one named residual" paragraph and
  all four corrected bullets are present and say the same things. `verify-docs-parity` is green
  (55 pairs, 0 violations, 0 dead links).
- No other statement in the band contradicts the D3 posture any more; the superseded
  "`toolInFlightMaxMs` is not in the front-door declaration yet" bullet — itself stale, since that
  knob IS declared — was replaced by the truthful `forceAfterMs` residual.

## F3 (was LOW) — the tool NAME is the exemption, never a clock: **REPAIRED**

- `machine.ts#observeWedgeDecision` now branches on `tool === "bash"` ALONE; the numeric stamp no
  longer gates the exemption. `inFlightMs` is `typeof inFlightSince === "number" ? now - inFlightSince
  : 0` — the stamp-less case reports **0**, never `NaN`/`undefined`.
- §D3.3's A/B is intact: an open bash ⇒ exempt with NO age bound, ONE `long-bash` incident at the
  `forceAfterMs` boundary (`longBashReported` guard), re-evaluated after the call returns; `0` still
  disables the rule (`forceAfterMs <= 0` returns false before any decision).
- **Tests**: two machine-level cases — the candidate's own stamp (`inFlightTool: "bash"`,
  `inFlightSince: null`) and the fold-only shape (`channelInFlightTool: "bash"`,
  `channelInFlightSince: null`) — both assert exactly `["long-bash"]` with `inFlightMs: 0`.
- Note on the word "now": with no start instant there is nothing to subtract, so `0` is the only
  honest reading; `now` is used the moment a stamp exists. My frozen basis allowed either `0` or a
  positive elapsed, so this is PASS, and the choice is documented in the code comment.
- Honest bound: both current producers still always carry a clock (`HeartbeatStamp.at` is a required
  number; the channel fold types `openCalls` with `since: number`), so the stamp-less branch is
  DEFENSIVE on today's harness rather than reachable in production. That is the right direction to
  have fixed it (a decision point should not require a clock), but it is not evidence of an observed
  production shape and I do not claim one.

## Regression surface (bounded)

- Files touched: `packages/mpd-roles-plugin/src/{index,spawn-async}.ts`,
  `packages/mpd-config-plugin/src/settings-schema.ts`,
  `packages/mpd-team-watchdog-plugin/src/machine.ts`, `cordis.patch.yml`, the two watchdog READMEs,
  two tests, and the rebuilt `dist/` of five packages. **D1's re-team settlement and D3's force
  action wiring are untouched**, so their first-review adjudication stands unchanged.
- Tool surface unchanged: `index.ts`'s repair hunks all fall inside the consult-activity plumbing
  (`toolActivity`, `activityKey`, `noteToolStart`/`noteToolEnd`, `consultSupervisor`); no tool was
  added, removed or re-parameterized, and the tool-surface pins passed (roles 296, workmate 83).
- Deny posture unchanged: the read-only list is still the **ten** names of §D2.7 (roles `index.ts`
  carries both new names; workmate the same) and the leaf list is still **four** — neither was
  weakened by the repair.
- The supervisor is composed in exactly ONE place (no other package imports `spawn-async`), so the
  `activityOf` signature change has no hidden consumer.
- `packages/*/dist/**` is FRESH at the reviewed state (34/34 targets rebuilt byte-identically), so
  the committed bytes carry the repair — the "captain rebuilds dist" caveat does NOT apply and no
  dist bound is needed.
- Test integrity: the only pre-existing assertion touched is the bash-exemption arm's `activityOf`,
  updated to the new child-id signature with the SAME asserted outcome (`c3` is the handle id); the
  rest is new coverage. No gate edited, no assertion deleted, no tolerance widened.

## New findings (non-blocking)

**N1 — LOW — a superseded comment states the DEFECT as the contract.**
`packages/mpd-roles-plugin/src/index.ts`, the `consult supervision` header paragraph: "The child's
tool activity, keyed by the child's OWN label (its role name — the identity the sanctioned adapter
helper `subagentLabelOf` exposes)" sits immediately above the F1-repair paragraph that says the
opposite. Symptom: the next reader who stops after the first paragraph reads label-keying as the
intended mechanism and can reintroduce F1 while "restoring the comment's contract". Expected: delete
the three superseded lines and keep the per-child paragraph. Doc source: `AGENTS.md` §6 (a comment
states the contract/invariant/reason) and contract §D2.6. Non-blocking because behaviour, tests and
docs all state the correct design; this is a one-line deletion in a file the wave already touches.

**N2 — LOW — the fallback is asymmetric, so an id-less activation loses the exemption instead of
falling back.**
Write side key: `agent.session.id` when present, else `label:<role>`. Read side fallback trigger: the
HANDLE reported no id (`record.handle.id === ""`). Those are facts about two different objects, so a
composition whose ACTIVATION reports no id while the CHILD AGENT still carries a session id writes
`<session id>` and reads `label:<role>` — a miss, and the bash holder is interrupted (the F1 harm
direction, in a narrower composition). Unreachable on the pinned harness: `childId` is minted on
0.2.1+, and the native team executor REFUSES an id-less start outright, so `handle.id` is empty only
on a foreign/older host. Expected: mirror a `label:<role>` bucket on write when the agent exposes a
label, or make `activityOf` try the child id and then the label key. Doc source: contract §D2.6
("never interrupt a child that is not this consult's" — the exemption must survive a degraded
identity surface). Non-blocking: no pinned-harness path reaches it, and the fix direction is a
two-line change.

## Verified residual (recorded, not a finding)

`forceAfterMs` is absent from `mpd-config`'s `SETTINGS_KNOBS` and from
`packages/mpd-bundle-plugin/src/settings-card.ts`'s mirrored `FIELDS`. The README names this residual
AND its reason; I verified the reason against the parity pin (`settings-card.test.ts`: length 47,
`FIELDS` paths ≡ `SETTINGS_KNOBS` paths, card source must not import the symbol). It is a
cross-package scope of that package's own front-door contract, not a defect of this wave — a wave
that edited those two files would have been outside its declared write scopes.

## Declared bounds

1. **No live child boot.** The identity equation (handle id = `childId` = `agent.session.id` for a
   child's own tool call) is established from the adapter's own identity helpers and the harness
   generation contract, not from a live model run: this session ran no LLM turn and no real deployed
   child. A live proof would need the Docker/live lane, which I did not run (see below).
2. **The F1 test stubs the read side.** It proves per-child DISCRIMINATION in the supervisor and the
   key function separately; the index.ts activity map itself is not exercised end-to-end (no boot
   seam for a child's pre-tool hook exists in a unit test). Verified statically instead: both sides
   use the same derivation, the map is keyed by the child id, and a sibling's `end` addresses a
   different key.
3. **F3's stamp-less shape is defensive** (both producers currently always stamp a clock).
4. **No verify-plane loop.** A loop cannot be opened by a reviewer seat for this wave, so the
   `mpd_verify_record` ledger carries no row; the certified artifact is this file plus the gate logs
   and ids below. Same bound the first review declared.

## Declined to judge

Live VEdit throughput restoration; the Docker lane; the zh-CN body's prose quality beyond parity;
`evidence/**`; behaviour of any host that is not the pinned 0.2.1 line; F4–F7 of the first review
(untouched by the repair); the PR body and CodeRabbit reconciliation (the captain's step).

## Gate evidence at the reviewed state (`f383c7ec`)

| Subject | Result | Evidence |
|---|---|---|
| `typecheck` | exit 0 | `ev-20261105T121946-503e0a` |
| `comments` | exit 0 | `ev-20261105T121948-b9cb8c` |
| `tests` (whole tree) | 3586 pass, 6 skip, **0 fail**, 3592 tests / 240 files | `ev-20261105T121953-ebd322` |
| `rows` | 36 row ids match the 2-file patch layer | `ev-20261105T122031-6ad49a` |
| `docs` | 55 pairs, 0 failed, 0 violations, 0 dead links | `ev-20261105T122032-043c69` |
| `dist` | 34/34 targets fresh (rebuilt twice, byte-identical) | `ev-20261105T122034-4395ae` |
| per-package suites (re-run by name) | watchdog 174 · team-core 611 · roles 296 · workmate 83 — all 0 fail | this session |
| `preset-conformance` (real mount, patch row changed) | PASS — 32 rows checked, `agentPreset=mpd`, negative control fires `agent-preset/invalid` | `evidence/dsh-qa/preset-conformance/2026-11-05T12-20-42.306Z` |
| `verify-no-host-override` (patch row edited) | PASS — 0 of 0 id-targets collide with 214 host-declared ids | `.mpd/reviews/tmp/gates/recheck-no-host-override.log` |
| `verify-manual-paths` | PASS — resolved 157, every audited path exists | `.mpd/reviews/tmp/gates/recheck-manual-paths.log` |

## What would make this wave mergeable

Nothing new. Two one-line fixes (N1 deletion, N2 fallback symmetry — either both or N1 alone) are
welcomed in the integration commit but are NOT conditions of this PASS; the F1/F2/F3 blockers of the
first verdict are closed on evidence.
