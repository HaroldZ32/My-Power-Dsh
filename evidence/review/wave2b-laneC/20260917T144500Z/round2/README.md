# t34 — ROUND-2 REVIEW of wave-2b lane C (t17) after the t33 repair

**Seat:** `code-reviewer` · **task** `t34` (review, round 2) · **attempt** `61407985-9f1a-4f6d-afbc-b27de95fb4c0`
**Object:** the t33 repair of `evidence/team-watchdog/wave2b-laneC/20260917T1620Z-t17/` (record ADDENDUM 2 + `t17-result.json` + the repaired control arm in `packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts`), judged against the SAME frozen acceptance (`evidence/requirements/wave2b-laneC/20260917T1416Z-…`) at the CURRENT revision.
**VERDICT: pass.** Round 1's single finding (F1, the region count) is properly dispositioned; every instrument is red-observed; nothing new is a finding.

## 1. THE TREE MOVED BETWEEN ROUNDS — so every reading below is re-taken here

| what | round 1 (my pin) | round 2 (this review) |
|---|---|---|
| `lib/scheduler.js` | `4b824797195996fa` | **`405d4e364c289299`** (lane A's t27 added the T-13 `isNonDispatchableKind` conjunct at 14:45:53Z) |
| `lib/mpd-deltas.js` | `6ceff2ef931ba43c` | `6915cd8ba924ea3d` |
| `agent-references/agent-teams-deltas.md` | `a2120d45fca43ef1` | `4fd1ef5ccde94957` |
| the repaired control arm | — | `b10d4ac7b3f39752` |

## 2. ROUND 1's FINDING, DISPOSITIONED (round-2 acceptance criterion 6)

**F1 was:** the pin table carried `89` live region ids, unreproducible by any live predicate. **Disposition, re-taken by me at this revision:**

| predicate (named) | value |
|---|---|
| `MPD_DELTAS` entries / unique ids in `lib/mpd-deltas.js` | **93 / 93** |
| distinct files named in `MPD_DELTAS` | **10** |
| live `//#region mpd-delta` markers (unique ids, adopted files) | **93** — agrees |
| `node scripts/patch-agent-teams-fixes.mjs --check` | `93 mpd delta region(s) across 10 adopted file(s)` |
| `bun run ./scripts/verify-docs-parity.mjs` | PASS — `carried 93/10 vs derived 93/10 … markers agree: 93` |
| the OLD line-count confusion, run now | **94** (= 93 live + 1 non-region match) |

The record now carries value **93 / 10 at `2026-09-17T14:51:13Z`**, the predicate NAMED (`MPD_DELTAS`, corroborated by the marker scan and by the docs gate), the moment named, and the JSON keeps the correction visible: `liveRegionIds: 93`, `liveRegionIdsPredicate: "…(the registry file's own header comment is NOT a region)…"`, and `liveRegionIdsWas: {value: 89, why: …}`. Both file mtimes (14:49:39Z, 14:50:47Z) precede the reading moment, so 93/10 was correct AT ITS MOMENT and is still correct now. **A count presented WITH its predicate and its moment — closed.**

**Observation O1 (not a finding):** the ADDENDUM attributes the loose grep's off-by-one to "the registry file's OWN header comment". The off-by-one is real and reproduces exactly (94 vs 93 at these bytes), but the inflating match is **not** that header line — it is `packages/mpd-agent-teams-plugin/lib/tool-names.js:7`, a comment reading "…registered from a mpd-delta region in", whose `mpd-delta region` matches the same loose pattern. The header line does not match it (`//#region mpd-delta ...` has no `[a-z0-9-]` after the space). The lane's class is right, the count and predicate are right, and nothing downstream inherits a wrong number — which is why this stays an observation; naming the actual string makes the next re-derivation one grep shorter.

## 3. THE REPAIRED ARM — ATTACKED IN SCRATCH MIRRORS OUTSIDE THE WORKSPACE (criterion 3)

The instrument t33 changed is the 2a control arm's anchor on the readiness predicate. I rebuilt a mirror (`packages/{mpd-team-watchdog-plugin,mpd-agent-teams-plugin,mpd-dsh-adapter-plugin,mpd-config-plugin,mpd-tools-plugin,mpd-hashline-plugin}` + the `_deps` symlink), ran the arm file in three states, and deleted the mirror:

| state | reading |
|---|---|
| AS SHIPPED | **12 pass / 0 fail** — the arm runs and its control (a blocked member IS delivered once the dependency conjunct is spliced out) fires |
| **one SIBLING conjunct added** to `isTaskReady` (the exact failure t33 repaired) | **12 pass / 0 fail** — the repair achieved its purpose: another lane's sibling conjunct no longer breaks the arm |
| the arm's TARGET text perturbed (one space inside the dependency conjunct) | **11 pass / 1 fail**, loud: `expected exactly 1 anchor, found 0` — no silent no-op; `spliceOnce` refuses |

So the repair neither weakened the arm nor left it brittle: it is red-capable (ARM 2) and sibling-tolerant (ARM 1), and `spliceOnce` throws on any anchor count ≠ 1.

## 4. THE REST OF THE ROUND-2 CONTRACT, RE-RUN AT THE CURRENT REVISION

- **Decisive test RUN and reproduced** (my own `--out`): control **1 ticket / 1 delivery** · pure terminal **0 / 0** · recorded race **1 ticket / 0 deliveries + the NAMED decline** · region-STRIPPED **1 / 1**; `outcome` = NOT WOKEN; `equalityHalfHolds: false`; the driver's own `schedulerSha256` = **`405d4e36…`** (the revision it actually loaded). Exit 0.
- **Watchdog suite** (RED 138/1 at t33): **139 pass / 0 fail / 13 files**, exit 0.
- **`mpd-bg --self-test`** exit 0 · **`mpd-doctor --self-test`** exit 0.
- **Addendum A both directions**: `--live` PASS (`liveWithoutRestart: true`) · `--mutant restart-needed` **DETECTED (the assertion reddened)**, `liveness LOST`, `KNOBS DIVERGE` named.
- **T-25** exit 0 (naive vs frame-by-frame on the same store) · **T-41 absent** exit 2 with `MISSING ⇒ degrades …` and `verdict=DEGRADED missingOPTIONAL=ast-grep`.
- **Token census under the round-2 rule:** `inert in-process` **0**; `consistent with a stale host` **0**; the bare token appears verbatim only in the two third-party doctor captures (**1 + 1**), and the lane's OWN artifacts spell it split (`"in"` + `"ert"`) — which by the round-2 rule does **not** count as an appearance. Census unchanged and still exactly as the lane disclosed.
- **Clause 4:** the verify list is unchanged (package suite, four own drivers, two read-only `--self-test`s, the immutability arm) with no cross-lane re-derivation; `find packages/*/dist dist/mpd-package -newermt 2026-09-17T14:15Z -type f` is **empty** — nobody, including lane C, wrote a derived surface.

## 5. WHAT I DID NOT VERIFY (bounds, unchanged from round 1)

- The long-lived **host PROCESS**: unobservable here; `reload-check` cannot see it, and the decisive test's "restart" remains a NEW PROCESS importing the tree fresh (the driver's own `schedulerSha256` is the evidence of what was loaded). The pid-namespaced sandbox cannot see the host's start time, and the record does not claim it.
- The other wake routes (idle edge, approval/spawn-time dispatch, `memberSelections`, a stale on-disk snapshot read outside the lock) remain unmeasured — the residual stays **UNRESOLVED**, as the authority requires.
- The register's replay count (8 MEASURED EVENTS) was not re-derived; the record warns it moves.
- `test/**`-side pins in other packages were not audited; only the instrument this lane changed was attacked.
