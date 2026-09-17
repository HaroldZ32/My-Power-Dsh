# Wave-2b LANE A — executable acceptance (r-A, frozen BEFORE any implementation)

**Seat:** Architect (requirements, read-only). Written through the platform artifact channel — the only write a denied seat has
(lane A's own §4f measurement, `evidence/agent-teams/wave2b-notes/20260917T091500Z/2b-refinements.md`).

**Authority:** `.mpd/plans/friction-p2-wave-2b.md` — body sha256 `0dd3d2fd4744802d37031477…` (cited by the plan itself; the tail is
abbreviated there and NOT reconstructed here), §4 (lane map + write sets), §5 (lane A table), §6 (DAG), §7 (serialization), §8
(lane-scoped gates), §9 (evidence convention), amendment **A2.3** (lane A's set made file-exact) and amendment **A3** (the user's
conference answer: **IMPLEMENT** T-11/T-13/T-27/T-44; none may be closed by documented ruled form). Register: `.mpd/TODO.md`.

**Moment of this freeze:** the `t7` record's own timestamps — `createdAt` 1789653768557 = **2026-09-17T14:02:49Z**, `updatedAt`
1789653788200 = **14:03:08Z** (read from `.mpd/team/friction-p2-wave/team.json` read-only; no shell on this seat). Every command below
is to be run at ITS OWN revision, and every count in it re-taken rather than inherited (report §5 rule 4).

**What is frozen:** the DONE-WHEN for the 13 rows the plan assigns to lane A plus the A/2 carrier **T-11** — per row: deliverable,
OBSERVABLE, DECISIVE, NEGATIVE CONTROL, EVIDENCE path shape. The plan is the WHAT; this file is the DONE-WHEN. Register order is
kept (§8.5 rows first, then §8.6 rows, then the minted T-93); the A/2 carrier sits in register position.

---

## 1. WRITE SET — file-exact, from A2.3 as landed

**A-1 (the 13 rows)**
- `packages/mpd-agent-teams-plugin/lib/{tools,state,quality-gates,scheduler,session-start,profiles,command,index,mpd-deltas}.js`
- `packages/mpd-agent-teams-plugin/lib/types/types.d.ts`
- `packages/mpd-agent-teams-plugin/self-fix-tests/**` (directory scope allowed: A2.2's round-2 wording names it as a unit A is the ONLY writer of)
- `agent-references/agent-teams-deltas.md`
- `scripts/patch-agent-teams-fixes.mjs`

**A/2 (T-11)** — declared on CREATION, file-exact, non-overlapping with A-1's files (plan §4's A/2 row; A-1 must be **terminal**,
not merely started — plan §6, so the `inScope overlaps` validator never sees two open tasks over one file).

**Regenerated, never hand-edited:** `lib/mpd-deltas.js` is produced by `node scripts/patch-agent-teams-fixes.mjs --write-registry`
(plan §8's A row). A region change therefore lands as: edit → `--write-registry` → `--check`. The registry count is cited by
**row id + region ids + the registry sha** (B3 clause (b)), never by a line and never inherited.

**Excluded as DERIVED — they belong to the captain's integration task, not to this lane's verify** (plan §7.4/§7.8):
`packages/*/dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json`, `.mpd/plans/**`. Measured for this lane's own package: it has **no
`src/` and no `dist/`** (it ships `lib/`) — so `verify-dist-fresh` is not a lane-A surface at all, and the only derived artifact the
lane touches is the regenerated `lib/mpd-deltas.js` + its doc `agent-references/agent-teams-deltas.md`.

**HOP CANDIDATES (named, not silently dropped — plan §7.8):** files that EXIST in the package but are NOT in A2.3's set. If a row's
only site is one of these, the task records a hop request naming the file and the captain widens the set; dropping the path from
`changedPaths` is the forbidden move (lane C's 2a words: the green gate would then be a lie about the shipped artifact).
1. `packages/mpd-agent-teams-plugin/lib/snapshot.js` — the WEB-PANEL team snapshot (`assembleTeamSnapshot`, imported by `lib/index.js`).
   Relevant to **T-06**: the model-facing status text is `renderStatus` in `lib/tools.js` (in-set), but if the revision token must
   also reach the panel snapshot, that file is a hop.
2. `packages/mpd-agent-teams-plugin/test/**` — the package's own tests (17 of the 42 absence assertions, B3 clause (e)). Relevant to
   **T-92**: `self-fix-tests/**` is in-set, `test/**` is not.
3. Also present, outside A2.3's set: `lib/{client,capabilities,event-types,events,harness-compat,types,web-routes,members,tool-names}.js`.

---

## 2. VERIFY — lane-scoped, `./` form (T-89's contract half: this file is where that half is discharged)

Green INSIDE lane A's own scope, every path `./`-qualified (plan §8's A/A2 line):

- `bun test ./packages/mpd-agent-teams-plugin/self-fix-tests/`
- `bun test ./packages/mpd-agent-teams-plugin/`
- `node scripts/patch-agent-teams-fixes.mjs --check`
- when a region changes: `node scripts/patch-agent-teams-fixes.mjs --write-registry` · then `--check` again
- the row's own driver, when the row ships one: `node ./evidence/agent-teams/<slug>/<stamp>/<driver>.mjs` (its red-side run is the
  negative control, §5 below)

**FORBIDDEN in this lane's verify (integration-only, plan §7.4 as strengthened by A2.1):** `bun run verify:gates`,
`bun run test:qa`, `bun run test:qa:all`, `node scripts/verify-dist-fresh.mjs`, `bun run typecheck`, `node scripts/verify-vendor.mjs`,
`node scripts/verify-pack-closure.mjs`. A red surface a lane cannot keep green is reported in the EVIDENCE, never as a verify entry
(A2.1's round-2 correction), and the lane's verify names only what the lane itself controls (T-84's extended §Fix).

---

## 3. PREREQUISITES AND ORDERING (carried from the plan as explicit gates)

1. **A-1 terminal BEFORE A/2 (T-11) is created** — plan §6. Terminal, not started.
2. **T-11 is REAL IMPLEMENTATION under A3** — the ruled-form close is withdrawn for it, as for T-13/T-27/T-44.
3. **One impl task for the 13 rows** (plan §6's impl-A; one review `rev-A`, and `rev-A2` for T-11): the refusal surface is shared by
   T-84 and T-87 and the absence pins by T-92 — splitting them across tasks would let two writers disagree about one predicate.
4. **No dependency on another lane's file.** Lane A's set touches no file another lane owns; its only cross-lane inputs are readings
   (documented in §6 below).

---

## 4. PER-ROW ACCEPTANCE (register order; `§home` = the row's place in `.mpd/TODO.md`; the shape in quotes is the plan §5 lane A
compression of the row's own §Fix sentence)

### T-06 — `§8.5` (P2 16) · body §1 · trap · M — "a monotone revision/version token on the team record surfaces in the status payload, so 'claimed' cannot be read after terminal (and the reverse); token, not a freshness bug"
- **DELIVERABLE:** a monotone token on the team record (its write path is `lib/state.js`) surfaced in the model-facing status text
  (`renderStatus`, `lib/tools.js`).
- **OBSERVABLE:** two status reads straddling one task transition carry different tokens, and each printed task state belongs to the
  token printed with it — "claimed" after terminal (and the reverse) is unreachable under a single token.
- **DECISIVE:** a driver reads the token, performs a transition, reads again: token strictly increased AND the printed state matches
  the record at that token.
- **NEG CONTROL:** an un-bumped fixture (a write that does not move the token) must REDDEN the assertion — the check cannot be
  satisfied by any constant.
- **EVIDENCE:** `evidence/agent-teams/<slug>/<stamp>/` with both readings and the record bytes. Verify: §2.
- **In-lane sites:** `lib/state.js`, `lib/tools.js`. Hop if the panel copy is required: §1's hop 1.

### T-08 — `§8.5` · body §1 · friction · M — "ONE id-allocation scheme across the plan-seed path (positional) and `create_task` (counter) — or the two schemes made explicit and stable across a staged-plan edit"
- **DELIVERABLE:** one scheme, or two declared schemes whose ids are stable across a staged-plan edit.
- **OBSERVABLE:** after seeding a plan, editing it (remove + re-add an item) and re-seeding, untouched tasks keep their ids and new
  ids cannot collide with survivors.
- **DECISIVE:** the driver compares id SETS (not counts) across the two seeds and asserts stability + disjointness.
- **NEG CONTROL:** an edit that removes an id a dependent names must be REPORTED as an unresolved reference (T-64's class), never
  renumbered silently — that fixture is the red side.
- **EVIDENCE:** driver + both runs. Verify: §2.

### T-11 — `§8.5` · body §1 · gap · M · **A/2 CARRIER** — "a next-claimable/capacity view per member fed by the scheduler's ready-set helper" (plan §4.3's conference item; **A3: implement**)
- **DELIVERABLE:** a per-member next-claimable/capacity view on the readable surfaces, FED BY the scheduler's own ready-set helper
  (not a second implementation of the predicate).
- **OBSERVABLE:** in a team with a chain (t1 → t2) the view names the ready task for the idle member and shows the blocked one as
  blocked; a member holding an in-progress task is not shown as ready for it.
- **DECISIVE:** the view's ready set equals the scheduler's ready set for the same revision — compared mechanically in the driver.
- **NEG CONTROL:** zero ready tasks prints `none` (absence printed as absence, never an omitted line), and a busy member is not
  listed as claimable.
- **EVIDENCE:** both runs. Prereq: **A-1 terminal**; the file-exact set is declared at creation (§1).
- **A3 note:** the register row's §Fix ("show per-member next claimable task in the status") is implementation-shaped; the ruled-form
  fallback existed only in plan §4.3's recommended default and is withdrawn.

### T-13 — `§8.5` · body §1 · gap · M — "a deferred/waived kind (or a ruled form): the kind enum, the quality-gate predicates and the dispatch filter agree with the row" (**A3: implement; the ruled form is withdrawn**)
- **DELIVERABLE:** a `deferred`/`waived` task kind that NEVER dispatches, with the kind enum, the quality-gate predicates and the
  dispatch filter in agreement (the register's §Fix: "a `deferred` task kind that never dispatches").
- **OBSERVABLE:** a deferred task is never offered to a seat, never claimed by the pump, and does not consume the one-unfinished-task
  allowance; status shows the kind.
- **DECISIVE:** driver creates a deferred task, pumps the dispatch path, asserts (a) no offer/claim, (b) the kind renders, (c) a
  member holding only that task is still eligible.
- **NEG CONTROL:** the SAME shape without the kind MUST be offered — proving the filter keys on the kind, not on the fixture.
- **EVIDENCE:** both runs. Verify: §2. In-lane: `lib/quality-gates.js`, `lib/scheduler.js`, `lib/state.js`.

### T-14 — `§8.5` · body §1 · friction · M — "the second half lands: a helper that fills `evidence` from the task's declared evidence dir, consumed by BOTH render sites"
- **DELIVERABLE:** a helper filling the completion-payload template from the task's DECLARED evidence dir, consumed by the prompt
  template AND the contract render (register §Fix: "render a filled template from the evidence dir so a member pastes rather than
  authors it").
- **OBSERVABLE:** for a task with a declared evidence dir, both render sites show the same pre-filled field set, with the evidence
  path taken from the record.
- **DECISIVE:** the two renders' field sets are compared mechanically and are equal; the evidence path equals the task's own dir
  (sourced from the record, not from prose).
- **NEG CONTROL:** a task with NO declared evidence dir renders the template WITHOUT inventing a path — and a driver asserting
  "a path is always present" must redden on it.
- **EVIDENCE:** both renders + the record. In-lane: `lib/tools.js` (both sites).

### T-15 — `§8.5` · body §1 · friction · S — "`coverageOf` stops being free text: a typed/validated shape at the param schema and the coverage builder (currently string-equality grouping)"
- **DELIVERABLE:** a validated shape at the param schema plus a coverage builder that groups by clause ID (register §Fix: "pick
  clause ids from a list, not free text").
- **OBSERVABLE:** two near-duplicate spellings of one clause land in ONE bucket; an unknown id cannot be invented.
- **DECISIVE:** the builder's own output shows one bucket for the two spellings (mechanical comparison).
- **NEG CONTROL:** an invalid/unknown clause id is REFUSED at the schema (red run), not silently bucketed.
- **EVIDENCE:** schema + both runs. In-lane: `lib/tools.js`.

### T-27 — `§8.5` · body §3 · friction · S — "the contract tool accepts a BATCH shape (or a sibling tool) so N contracts are one call" (**A3: implement**)
- **DELIVERABLE:** a batch/sibling read (register §Fix: "a batch read").
- **OBSERVABLE:** one call returns N contracts, each block naming the id it belongs to; a missing id appears AS ITSELF.
- **DECISIVE:** a driver requests 3+ contracts in ONE call and asserts every requested id is present and attributed, and that one
  nonexistent id is reported unresolved rather than dropped.
- **NEG CONTROL:** a batch of ONE must equal the single-id call's content shape, and an empty batch must be refused loudly.
- **EVIDENCE:** both runs. In-lane: `lib/tools.js`.

### T-42 — `§8.5` · body §7 · friction · L — "ONE plan format: the session-start 'soft plan artifact' path and the DAG seed path stop coexisting with two conventions"
- **DELIVERABLE:** one declared convention across the session-start path and the DAG seed path (register §Fix: "let a plan file seed
  a team DAG (or link the two by id)").
- **OBSERVABLE:** the same plan file through BOTH paths yields the same task set (ids + subjects).
- **DECISIVE:** a driver takes one plan file through both paths and compares the resulting sets mechanically.
- **NEG CONTROL:** a plan whose item ids collide must be refused/reported, never silently merged.
- **EVIDENCE:** both seeds. In-lane: `lib/session-start.js` (and the seeding path inside the set).

### T-44 — `§8.5` · body §7 · friction · M — "approval without the Web panel (a command or a tool reachable from the text surface)" (**A3: implement**)
- **DELIVERABLE:** a text-surface approval path with the SAME two-phase semantics as the panel path (register §Fix: "a CLI approval
  path with the same two-phase semantics").
- **OBSERVABLE:** a staged plan is approved from the text surface with no Web panel involved, and the released entry unblocks.
- **DECISIVE:** the driver approves through the text path and asserts the resulting record fields are identical to the panel path's
  transition for the same staged plan.
- **NEG CONTROL:** a NON-captain seat calling the same path is REFUSED with a reason — authorization enforced at the boundary, the
  interjection lane's own standard ("a description is not a guarantee").
- **EVIDENCE:** both runs + the refusal. In-lane: `lib/tools.js`, `lib/command.js`.

### T-64 — `§8.6` · gap · P2 — "An UNRESOLVABLE dependency is folded into PARKED."
- **DELIVERABLE:** unresolvable dependencies reported as themselves, naming the id.
- **OBSERVABLE:** a dependency naming a nonexistent id (or a cycle) is named in the scheduler/status output; PARKED is not the
  reported state for it.
- **DECISIVE:** the fixture with the phantom id names that id in the output.
- **NEG CONTROL:** a LIVE-but-unfinished dependency still reports PARKED — the legitimate state is not erased.
- **EVIDENCE:** both runs. In-lane: `lib/scheduler.js`, `lib/state.js`.

### T-84 — `§8.6` · gap · P2 — "A red the contract requires to be REPORTED has no ledger surface" (+ its extended §Fix: a lane's verify names only what the lane can keep GREEN; cross-lane aggregates to integration)
- **DELIVERABLE:** a ledger surface for a reported red — an explicitly-labelled reported-red entry (or the append channel surfaced
  on the built-in tool).
- **OBSERVABLE:** a task whose contract requires reporting a red completes WITH a labelled reported-red entry in the record, and the
  record still satisfies the platform rule (`verify failure must fail the task`: a reported red must be expressible WITHOUT a
  `failed` verify command).
- **DECISIVE:** the driver completes such a task and asserts (a) the entry is present and labelled, (b) the task completed.
- **NEG CONTROL — the one that matters:** a genuinely FAILED verify command must STILL fail the task. A surface that becomes a bypass
  fails this row.
- **EVIDENCE:** both runs. Shares the refusal surface with **T-87**; one task, one predicate.

### T-87 — `§8.6` · trap · P2 — "A completion payload template is generated at CLAIM time, so an AMENDED acceptance invalidates it" (§Fix: regenerate on amend, OR name the unmatched item + the count; mechanism pinned: stored NINE vs display joining 4+5 ⇒ 8)
- **DELIVERABLE:** (a) the template regenerates when the contract is amended, OR (b) BOTH refusals name the unmatched item and the
  count — `acceptanceResults` AND `commandsRun` (the plan §5 shape names both).
- **OBSERVABLE:** the measured repro no longer reproduces: claim under revision N, amend, complete with a payload built from the
  CURRENT contract → accepted; and a payload missing one item is refused WITH the item named.
- **DECISIVE:** the driver rebuilds the nine-item array + the display's eight-item join and asserts (i) the accepted path and
  (ii) the refusal naming the item/count.
- **NEG CONTROL:** a payload with a genuinely wrong item is still refused — the validator is not weakened into acceptance.
- **EVIDENCE:** lane A's note §4d is the measured input (the ledger-gate refusal); the driver reproduces the join. In-lane:
  `lib/tools.js`, `lib/quality-gates.js`.

### T-92 — `§8.6` · trap · P2 — "A NEGATIVE-ASSERTION pin makes an identifier unusable in PROSE" (§Fix, either shape: assert absence in CODE with comments stripped, OR state the prose constraint beside the pin; audit must NAME its directories + split and declare BOTH matcher-error directions)
- **DELIVERABLE:** absence asserted in CODE (comments stripped before matching) or the prose constraint stated beside the pin; plus
  the audit that names the directories it covers with their split.
- **OBSERVABLE:** a COMMENT naming the pinned identifier does not redden the pin; the identifier in CODE does.
- **DECISIVE:** the seeded pair above, run in one driver — the comment case green, the code case red.
- **NEG CONTROL:** the code case IS the control (a fix that strips the code as well fails it); the audit must be run over BOTH
  directions of the matcher error (whole-tree literal scan over-reports; a `*.mjs`-only glob under-reports — B3 clause (e)).
- **EVIDENCE:** the audit's own run + the pair. The split (B3 (e): `self-fix-tests` 25 / `test` 17 = 42) is RE-TAKEN at the fix's
  revision, never inherited (clause (a): a green reading is true of one revision). Hop if a pin lives in `test/**`: §1 hop 2.

### T-93 — **MINT** (the register's §8.8 tail declares the mint point: "the rows that ROLL to wave 2b (34 ids, minting from T-93)"; no row text exists yet) · routing · M — "the auto-generated repair routes to a seat that can execute it: write-kind tasks to a writer, or to the reviewed artifact's author; the generator reads the seat's deny list the way the spawn surface does"
- **DELIVERABLE (two halves):** (i) the register row T-93 itself, minted with its class/priority/§Fix, so the id exists to cite;
  (ii) the routing fix — write-kind repairs to a writer, or to the reviewed artifact's author.
- **OBSERVABLE:** for a review carrying findings, the generated repair's assignee is never a seat whose deny list makes the
  acceptance unsatisfiable; the deny-list read is the SAME read the spawn surface uses.
- **DECISIVE:** a driver reproduces the measured shape (review → repair) and asserts the assignee's executability, with the
  generator's predicate asserted equal to the spawn surface's (shared helper, or an asserted equivalence).
- **NEG CONTROL:** a team whose ONLY seat is read-only must produce a loud refusal or a captain route — never a repair that cannot
  complete. That is the t18/t38/t41 pattern, measured on this wave four times.
- **EVIDENCE:** lane A's note §4f (`writeTaskArtifact()` + the named `readOnly` boolean; the emitter that already computes the
  predicate) is the rung for the refusal half.

---

## 5. NEGATIVE CONTROLS PER INSTRUMENT (so a repair cannot ship a green that cannot redden)

| instrument the lane changes | its control |
|---|---|
| `lib/**` plugin code | `bun test ./packages/mpd-agent-teams-plugin/self-fix-tests/` (15 suites) and `bun test ./packages/mpd-agent-teams-plugin/` |
| the delta registry (`lib/mpd-deltas.js`, `agent-references/agent-teams-deltas.md`) | `--write-registry` then `--check`; the heal suite `self-fix-tests/registry-context-heal.test.mjs` catches an unregistered region (note §4g instance 1) |
| `scripts/patch-agent-teams-fixes.mjs` | its own guard refusals + the `--check` run above |
| every new pin the lane adds | the row's own seeded red side (T-92's pair is the model: comment green / code red) |
| every new driver the lane ships in `evidence/**` | a `--self-test` arm or a seeded red run; a driver with no red side is not an instrument (report §5 rule 7) |

---

## 6. FINDINGS AND BOUNDS (the payload's knowledge half)

**F1 — A3 supersedes plan §4.3, not the register.** No register row presumes a ruled-form close: T-11's §Fix ("show per-member next
claimable task in the status"), T-13's ("a `deferred` task kind that never dispatches"), T-27's ("a batch read") and T-44's ("a CLI
approval path with the same two-phase semantics") are all implementation-shaped. The ruled-form presumption lived in **plan §4.3's
recommended default**, which A3 withdraws; what genuinely changes is that these four rows now need a deliverable + verify + REVIEW
surface (A3), and lane A/2 exists to keep T-11's size out of A-1.

**F2 — the B3 clause-set label is STALE in the plan's errata.** The field
`reading_bound.for_wave_2b` (`evidence/gates/t75-derived-values/20260917T072029Z/result.json`) carries clauses **(a)–(g)**, not (a)–(e):
probing `\(f\)` and `\(g\)` each match the field's own line, while a 2000-character LINE view shows only (a)–(e) — the field is one
long line and a line viewer truncates mid-clause, which is exactly ER-1's recorded cause. A1/A2.4 and the E1b errata still say
"(a)–(e)", so the plan's label is stale relative to the field's own 09:52Z rebuild. **Action:** the captain amends the errata; r-A
cites (a)–(g). **Bound on THIS seat:** (f) and (g) exist (probe above) but their TEXT was not readable through the line view; whoever
freezes T-92's acceptance must re-take the field with a JSON-aware reader, never a line view.

**F3 — named hops, not silent drops** (plan §7.8): `lib/snapshot.js` (T-06's panel half), `test/**` (T-92's pins there), and the
nine further `lib/*.js` files listed in §1.3.

**F4 — shape provenance.** The quoted shapes in §4 are plan §5's compressions of each row's §Fix; where the register row's own §Fix
says something the compression drops, both are quoted (T-14, T-15, T-27, T-44, T-87, T-92, T-93). The register's own rows are the
source of record; this file freezes them executably rather than re-deriving them.

**F5 — moment-bound readings inside this file.** The `t7` timestamps in the header, the 42-assertion split (B3 (e)) and the registry
count are all readings of a revision. Each is re-taken by the task that uses it (report §5 rule 4); none is a property of 2b.

---

## 7. VERDICT OF THIS FREEZE

Lane A can start: the write set is file-exact, the verify set is green inside it, the ordering (A-1 terminal → A/2) is explicit, the
four A3 rows are implementation-shaped with reviews, and every instrument the lane will change has a control named. The three
integration-only surfaces (`dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json`) and the derived registry are excluded here and
routed to the captain's integration task, where the single re-pin and the single re-pack land.
