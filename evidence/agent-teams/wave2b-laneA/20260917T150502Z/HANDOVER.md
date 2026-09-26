# t40 (impl-A/4, lane A slice ②) — HANDOVER: honest PARTIAL, four rows named, nothing smoothed

**Status:** the slice is NOT implemented. This artifact is the handover the acceptance sanctions
("an honest PARTIAL with its uncovered half named is still a better outcome than a smoothed
completion"), written from measurements taken in this attempt rather than from a plan.

**Why stopped before editing:** the four rows are four independent deliverables (a 42-pin absence-sweep
across two corpora, a routing predicate, a new monotone token threaded through every write path, and a
plan-format unification). This attempt did not have the working budget left to implement even one of
them AND run its red-first arm + registry cycle + heal suite + the cross-lane reading + evidence to the
standard the rest of this lane holds. A half-landed registry change or an unverified token would have
been worse than nothing: the strip/heal suite is the only arm that catches a placement fault (t29), and
a token that is written but not validated breaks every record reader.

## The slice's STARTING STATE, pinned (so the next attempt does not re-derive it)

| reading (this turn, full logs in this directory) | result |
|---|---|
| `bun test ./packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs` | **21 pass / 0 fail**, exit 0 (`baseline-heal-suite.log`) — the registry is healable at this revision |
| `bun test ./packages/mpd-agent-teams-plugin` | **269 pass / 0 fail / 2380 expect(), 40 files**, exit 0 (`baseline-plugin-suite.log`) |
| `node scripts/patch-agent-teams-fixes.mjs --check` | exit 0 — **96 regions across 10 adopted files** (`baseline-registry-check.log`) |

| starting revision | sha256 |
|---|---|
| `lib/state.js` | `85e579acf1441870335ba5a4f5e25e5ea92ac7394ed60ef24891afd7da926336` |
| `lib/tools.js` | `39d77fe6826d19375ea682dfc21aeb42995f1ff818aeb5d1e0ac96b1c1455ea1` |
| `lib/quality-gates.js` | `01ea2f92319a732f42d5a956c947b9b00fdba20640ec8c8ed77a037ae12ce929` |
| `lib/mpd-deltas.js` | `464610bcad077c85aaeb98469a45c399fd08dd38ce9004e7bae45c59ad8d66c0` |
| `agent-references/agent-teams-deltas.md` | `4d6cedd8fff33c803a73409f3fe2d02e718d84ae02a20aef22afb6e892b467f6` |

## The four rows: acceptance read, and the uncovered half NAMED per row

### T-92 — absence pins: assert in CODE with comments stripped (+ the audit re-taken)

**Uncovered, in full.** Nothing was changed. The acceptance's own clause is the work order: the fix is
either "strip comments before matching" or "state the prose constraint beside the pin", and the audit
that names its directories with their split must be RE-TAKEN at the fix's revision (never inherited:
`self-fix-tests` 25 / `test` 17 = 42 is the wave-2a measurement, and it is a measurement of THAT
revision). **The `test/**` half is inside this task's granted hop** (`packages/mpd-agent-teams-plugin/test/**`),
bounded to T-92's absence pins — any pin left out of reach must be NAMED, not counted.
*Next step:* enumerate the pins by literal (`not.toContain(` / `toContain(` on identifier strings) in
the two corpora, add ONE shared `stripComments()` helper to the self-fix-tests fixture set, convert the
sweep, then run the seeded pair the DECISIVE clause names (a COMMENT naming the pinned identifier stays
green; the identifier in CODE reddens) and RE-TAKE the split by directory. Both matcher-error directions
must be declared in the audit (whole-tree literal scan over-reports; a `*.mjs`-only glob under-reports).

### T-93 — the routing half (the register mint is the integration's; `.mpd/TODO.md` is out of scope here)

**Uncovered, in full.** The acceptance fixes the shape precisely, and it is the part most likely to be
implemented wrongly: **the fix must be keyed on BOTH halves** — the KICK COMPOSE surface always mints a
fresh attempt id (so an attempt-id EQUALITY predicate is unmeasurable there and a fix keyed only on it
would be unverifiable), while the DISPATCH surface produces exactly
`delivery.attempt_id == completion.attempt_id` on a TERMINAL task (so terminality alone would miss
nothing there but would not cover the kick path). The routing reading must come from the GENERATOR'S OWN
OUTPUT, never from a grep for a field name; a proxy reading is declared as a proxy and never counted as
PASS. NEG CONTROL: a team whose ONLY seat is read-only must produce a loud refusal or a captain route.
*Next step:* reuse lane A's wave-2a note §4f rung (`writeTaskArtifact()` + the `readOnly` boolean and
the emitter that already computes the predicate), drive the review → repair generator on a fixture team,
and assert the assignee's executability from the generated task's own fields.

### T-06 — the monotone token (+ the panel hop request)

**Uncovered, in full.** Sized, not implemented: the only monotone id counter today is `taskSeq`
(validated at `lib/state.js`'s team-record shape chain, `Number.isSafeInteger(value['taskSeq'])`), and
the durable write funnel is `writeTeam(stateRoot, state)` = `atomicWriteText(… team.json …)` at
`lib/state.js` — ONE funnel, called from `members.js` (3), `scheduler.js` (6), `tools.js` (20),
`state.js` (1). So the token can be bumped in the funnel and validated in the same shape chain.
**The measured RISK that makes this row bigger than it looks:** 15 files under
`packages/mpd-agent-teams-plugin/test/` reference `taskSeq`, i.e. they read team records; a NEW field
added to EVERY written record breaks any exact-shape/deep-equality pin among them — and this slice's
`test/**` grant is bounded to T-92's absence pins, NOT to T-06's record shape. Before editing, measure
those 15 files for exact-record pins; if any pin needs touching, that is a NAMED hop request (the
captain's amendment), not an undeclared write.
*Next step:* bump in `writeTeam`, accept it in the shape chain (a sibling region, never nested, never
splitting the validator), surface it in `renderStatus` next to the per-task state it belongs to, then a
driver with the DECISIVE reading (token strictly increases across a transition, and the printed state
matches the record AT that token) plus the NEG CONTROL (a fixture write that does NOT move the token must
redden the assertion, so no constant can satisfy it). The panel copy is a NAMED hop request for the
built client — never an edit to `lib/client.js`'s built artifact.

### T-42 — ONE plan format

**Uncovered, in full.** Nothing surveyed in depth this attempt beyond the acceptance: one declared
convention across the session-start "soft plan artifact" path and the DAG seed path, with the same plan
file through BOTH paths yielding the same task set (ids + subjects), and a plan whose item ids collide
refused/reported, never silently merged. In-lane site: `lib/session-start.js` (and the seeding path).
*Next step:* drive one fixture plan through both paths and compare the sets mechanically — that
comparison IS the DECISIVE reading; then unify the convention at whichever path is the outlier.

## What this attempt did NOT do (bounds, stated so nothing is implied)

- **No `lib/**` edit, no registry write, no `test/**` edit** — so the placement rules and the heal-suite
  requirement are met vacuously by the baseline above, NOT by new work.
- **The cross-lane reading was NOT taken** (`bun test ./packages/mpd-team-watchdog-plugin`): it is
  required *after the edit*, and there is no edit. It remains owed by the next attempt.
- No repo-wide aggregate; `dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json`, `.mpd/plans/**`,
  `skills/**` untouched.

## Recommendation to the captain

**Split slice ② into four tasks (one row each), in this order: T-92 (it owns the granted `test/**` hop)
→ T-06 (cheap but needs the record-shape measurement first) → T-93 (two-halves predicate) → T-42.**
Each row then gets its own red-first arm, its own registry cycle with the heal suite, and its own
evidence — which is the shape the rest of this lane has been held to, and the reason t13's PARTIAL and
t27/t29's completions are trusted.
