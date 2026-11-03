# Review B — independent verdict on the mail/plan lane (T5, loop `loop-20261103T034211-dc7ad1`)

**Reviewed work:** T3, lane B (`se-consume`) — C3 (mail bound configurable/disclosed/recoverable) and
C4's plan half (`agent_teams_plan create_task` empty-`write_scopes` warning), plus the lane-B tests.
**Contract:** `.mpd/plans/cellwork-vedit-p0-fix-r2.md` (frozen at wave start; revision 2).
**Verdict: PASS — approve** (verify record `rec-20261103T041318-faef6d`). **Risk level: low.** No Blocker, High or Medium defect found against C3/C4;
two Nit-level evidence gaps and forward observations are recorded below.

## 1. Assessment

Lane B's delivered surface matches every acceptance line the contract freezes for C3 and the plan half
of C4. The bound became one declared workspace knob (`mail.maxUndelivered`, default 8, `0` disables) read
through the existing config layer on the SINGLE `sendMany` path that both `cellwork_send` and
`agent_teams_mail` traverse; the refusal sentence names the recipient, the count, the bound, the knob and
both recovery paths; both tool descriptions disclose the shared enforcement; the four preservation rules
(team-scoped counting, ack frees exactly one, delivery frees exactly one, legacy/retired rows count for
nobody) each have a passing arm. `create_task` on a writing kind with absent/empty scopes still creates
the task, now returns a `warning` naming the consequence and the remedy, renders it, declares it in the
output-schema allowlist, states the rule in the tool description, and refuses a legitimate task in no
arm. R2 holds: exactly the two named superseded assertions moved, and both replacements keep the old
facts. The gate evidence is green on a tree whose fingerprint was identical before, after a 50 s settle
window, and after both gate runs.

## 2. Settled tree and gate evidence (cited in the record)

Fingerprint = `sha256(git status --porcelain + git diff)` over the whole working tree:

| moment (UTC) | fingerprint |
|---|---|
| 04:08:04Z (H1) | `8d46a8971b9dc95e935dab62a3ed984b2bc1e649fb644f4e598eb7a8293cc005` |
| 04:08:54Z (H2, after 50 s settle) | identical |
| 04:09:41Z (H3, after both gate runs) | identical |

- **tests** — `mpd_verify_evidence {kind:"gate", gate:"tests"}` → `ev-20261103T040859-8c70db`, **exit 0**
  (`bun test packages`: 3450 pass, 6 skip, 0 fail; 3456 tests across 229 files).
  The 6 skips are the comment-detector arms (binary absent) — by design, not a red.
- **typecheck** — `ev-20261103T040456-2cf7ba`, **exit 0** (`tsgo --noEmit`).
- Independent dist check on the same settled tree: `node scripts/verify-dist-fresh.ts` →
  `ok: 34/34 targets fresh (each rebuilt twice, byte-identical)`.
- **Retained, NOT the basis:** `ev-20261103T040423-9680f2` (tests, exit 1) is the pre-rebuild trace. Its
  two failures are the T-62 byte-identity arms (`mpd-ext-plugin`, `mpd-roles-plugin`) red because the
  adapter-source edit inlines into those committed `dist/` files; `packages/*/dist/**` is the integration
  lane's scope (contract §3/§6, T8). The captain rebuilt with the pinned toolchain; the re-run above is
  the basis. Log copy: `02-gate-tests-PRE-REBUILD-exit1.log`.

## 3. Criteria judged

### C3 — configurable, disclosed, recoverable bound

| contract line | verdict | evidence |
|---|---|---|
| default 8; one workspace key read per call through the config layer; BOTH tools via ONE `sendMany` | met | test titles and bodies: key/default, resolver (absent/invalid/throwing → 8, `0` disables, whole number honoured), the `agent_teams_mail` end-to-end arm at a declared 2, the shipped-default-8 arm, "the ONE sendMany path…"; gate green |
| refusal detail names recipient, count, bound and TWO recovery paths | met | store-level arm asserts `"senior"`, `2 undelivered`, `bound`, `mail.maxUndelivered`, `cellwork_inbox`, `agent_teams_mail {action:"read"}`, `cellwork_dispatch`, `reassign`, and that nothing was appended; tool-level arm asserts `2 undelivered` + both routes; the two superseded exact-string assertions now carry the key + recoveries |
| both tool descriptions state the bound and that it is shared (no false "official mail is a fallback") | met | `agent_teams_mail` description arm (key + names `cellwork_send`); `cellwork_send` description arm lives in lane A's `mail-bound-config.test.ts`, green in the same gate run |
| team-scoped counting; ack frees one; delivery frees one; legacy row counts for nobody; retired team counts for nobody | met | four dedicated arms: per-team scoping with a retired `team-retired` and an unstamped legacy row, ack-opens-one-slot, delivery-opens-one-slot, and "the tool applies the shipped DEFAULT 8" |
| no `mpd-gates.json` created in the checkout | met | dedicated arm asserts absence before and after driving the tool |

Cross-lane seam: lane A imports the shared resolver (`mailMaxUndeliveredOf`) from this store — no
duplicate resolver; the cross-package coupling inventory arm is green ("exactly the frozen set").

### C4 (plan half) — no silent empty write scopes

| contract line | verdict | evidence |
|---|---|---|
| absent/empty scopes on work/repair/integration → LOUD `warning` naming consequence + remedy; task still created | met | "a work task with no scopes is still created AND carries the warning" (task staged; warning names `NO write scopes`, `allows NO path`, `must stop`, `declare the scopes now`, `amend the contract before the first write`); "every WRITING kind warns" covers absent kind, `work`, `repair`, `integration`, explicit `[]` |
| output schema is an allowlist → `warning` needs a schema entry | met | arm asserts `hasOwnProperty(output.schema.properties, "warning")` and that the description states the rule |
| no refusal of a legitimate task | met | `requirement` and `review` kinds do not warn; a declared scope list does not warn; mid-run append warns and still appends; the overlap refusal still names the pair and both remedies, then a disjoint plan approves |
| rendered, not just present | met | the tool's own renderer is driven and contains the warning |

### R2 — moved assertions

Met: exactly 2 removed lines in the lane-B test tree, the two named superseded sentences; both
replacements keep recipient/count/bound and add the key + recoveries. Full evidence:
`04-r2-assertion-check.md`.

### Older VEdit observations (contract §0, CHECK-only)

Lane B reports O1–O4 with symbol + covering test + landing commit (`08-older-observations.md`), as the
contract requires; nothing was fixed without a captain ruling. I did not re-reproduce them live (bound
below); the report is internally consistent with the named tests.

## 4. Findings (non-blocking; ranked)

1. **Nit — the resolver's upper bound is not pinned by any acceptance arm.** The writer's claim that
   `mail.maxUndelivered` honours integers `0..1000` has no test: the resolver arm pins invalid inputs
   (−1, 1.5, `"8"`, throwing → 8), a whole number in range (3) and `0`; no arm exercises a ceiling or a
   value above one. The contract does not require a ceiling, so this is an evidence gap, not a contract
   breach. Direction: one arm pinning the ceiling as implemented (or drop the `0..1000` claim from the
   lane report).
2. **Observation (process) — lane B ships no `report.md`.** Contract §4 asks a lane that changes a tool
   schema/description to SAY SO in its report. Lane B's schema/description change is measured in
   `07-surface-budget.log` (6349/6400) but not stated as a report section. Direction: the captain states
   it in the integration/PR body; no code change needed.
3. **Observation (forward to the docs task/T7) — `docs/mail.md` contradicts the preserved rule.** Its
   line "an ACK (not a delivery) releases a slot" disagrees with contract C3 and the team-core README
   ("a transport delivery frees exactly one slot; an explicit read/ack frees exactly one slot"), and it
   still presents the bound as fixed 8 with no `mail.maxUndelivered` disclosure. This is the docs lane's
   work (T6), not a lane-B defect; T7 must reconcile both statements.

## 5. Declined to judge

- **The `0..1000` ceiling as behaviour** — no contract line and no test pin it; I did not read the
  implementation before the verdict. Declared as a bound, reported as finding 1.
- **C1 / C2 / C5 (D1, D4)** — lane A's items; T4 (`rev-cellwork`) owns them, out of this loop's scope.
- **C5 docs wording and the bilingual pair** — task T6/T7; this loop judges code and code tests only.
- **Live-mount conformance of the new output-schema field (`preset-conformance`) and the Docker lane** —
  integration/gate-sweep scope (T8); the wave contract assigns them there, and neither is runnable
  inside this review without a real mount.
- **The pre-rebuild red gate** — attributed to the integration-owned `dist/**` rebuild; re-ran green on
  the settled tree; not judged as a lane-B defect (captain's ruling and my own check agree).
- **O1–O4 live reproduction** — report-only per contract §0; I read the reports and their quoted test
  names but did not re-run the four scenarios beyond the gate suite that contains them.
- **Lane A's test additions** (`barrier-live-engine`, `mail-bound-config`, `split-scope-warnings`,
  `adapter-live-engine-seam`) — out of lane B's review, though they ran green in the same gate.

## 6. Bounds of this review

- **Read:** the frozen contract, `packages/mpd-team-core-plugin/README.md` (mail-bound section),
  `docs/mail.md`, lane-B evidence `00..08`, the lane-B acceptance test file
  `packages/mpd-team-core-plugin/test/vedit-p0-lane-b.test.ts`, the two moved-assertion diffs (R2 duty),
  and the three gate logs. **Not read:** lane-B production source (`src/index.ts`,
  `src/mailbox-store.ts`), its `dist/`, or lane A's source — the verdict rests on contract + repository
  docs + acceptance tests + gate evidence, and the tests are declarative evidence, not proof of
  implementation quality beyond what they execute.
- **Could not run:** a real harness mount (`preset-conformance`), the Docker real-machine lane, or a live
  LLM member — none is part of this review's loop. The gate runner used the PATH `bun` 1.4.2 while the
  build toolchain is pinned at 1.4.0; the T-62 byte-identity arms still passed, and the integration lane
  re-runs the sweep with the pinned toolchain.
- Verdict recorded before any production-implementation read, per the verification law; no code edited.
