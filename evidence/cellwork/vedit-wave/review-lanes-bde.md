# R2 — review of lanes B, D and E against the frozen contract

**Seat:** R2 (`reviewer-planes`), board task **T7**.
**Contract:** `.mpd/plans/cellwork-vedit-wave.md` (261 → 284 lines during the review; the appended §7 R8/R9
were read and applied). **Branch:** `fix/cellwork-vedit-wave` (no git write command was run; `git show`,
`git status`, `git diff` only).
**Review instant:** 2026-10-31T05:44:40Z. Source hashes read at that instant:
`evidence/cellwork/vedit-wave/bde/logs/source-hashes-at-review.txt` — identical to the hashes taken
before the first probe, so nothing moved under the review (split `d37e1b98…`, requirements `ab11bca1…`,
gates `f74c82e3…`, tools `f31ea6e6…`, ledger `9d90ba1f…`, captain-investigation `c7e463cf…`,
roles index `9995bc0b…`, cellwork guard `cbebd8ca…`, prompts `62533716…`).
**Verdict:** **APPROVE (lanes B, D, E)** — every acceptance item for C1-validation, C9, C10, C2-server, C3,
C4 and C5 passes on my own probes; no Blocker/High/Medium finding; two Nit observations, neither
reachable by a contract-shaped caller.

## 1. Method, and what makes this review independent

1. The acceptance checklist was written from the contract **before any diff was read**:
   `evidence/cellwork/vedit-wave/bde/checklist.md`.
2. Verdicts rest on **my own probes** (`probes/probe-lane-{b,d,e}.ts`), not on the lanes' new tests. The
   lane suites were run too (they are the writer's claim), but no acceptance line cites them as proof.
3. The probes import the **shipped source modules** and drive the **shipped tool definitions** through
   `registerVerifyTools` with a captured registry, so the subject is the code under review.
4. The pre-change behaviour was executed for lane B (`probes/probe-red-b.ts` materialises
   `git show HEAD:…` into a mktemp tree and runs it), so the "red before the fix" claim is measured for
   B. For D and E the new symbols are absent at HEAD, which makes the new tests necessarily red — the
   textual inspection is in `logs/red-lane-de-inspection.log`.
5. **Evidence hygiene (R9):** every probe workspace and every pre-change copy lives under `mktemp -d`;
   only logs land under `evidence/`. `evidence/cellwork/vedit-wave/` contains **no `*.test.ts`** and the
   checkout root has **no `mpd-gates.json`** (`find` asserted after the run).
6. **Invocation discipline:** each package was run alone (`bun test packages/<one-package>`), never
   several in one command; repo-root `bun test` was not run (evidence fixtures and the live-team suites
   are not isolated).

## 2. Acceptance checklist — item by item

Legend: **PASS** = observed on the subject; **PASS (inspection)** = the criterion is inside a tool handler
that needs a live mount, judged from the shipped source and named as such; no FAIL exists in this table.

### Lane B — `split.ts`, `requirements.ts` (C1-validation, C9, C10)

| Item | Verdict | Proof command / site | Observed |
|---|---|---|---|
| B01 `member?: string` in the split task input, one spelling | PASS (inspection) | `flow.ts` `cellwork_split` → `parameters.tasks.items.properties.member`; `split.ts` `SplitTaskInput.member`; the handler maps it into `SplitTaskInput` (line-level symbol: the `submitSplit` call site) | schema declares `member: {type:"string"}`, not in `required`, `additionalProperties:false`; no second spelling anywhere |
| B02 absent ⇒ member name is `ownerRole` | PASS | `probe-lane-b.ts` | `resolved members=["Senior Engineer","Seat 1","Seat 2"]` (task A absent ⇒ role) |
| B03 present ⇒ name is `member`; `ownerRole` still validated | PASS | `probe-lane-b.ts` B03/B02 | declared member resolves; `unknown-owner-role` still fires beside a declared member |
| B04 `member-invalid` (empty / >64 / control / path separator) | PASS | `probe-lane-b.ts` (7 cases incl. the 64-char boundary) | empty, whitespace-only, 65 chars, `\u0001`, `/`, `\` all ⇒ `member-invalid`; 64 chars ⇒ no finding |
| B05 `member-role-conflict` (one member, two ownerRoles) | PASS | `probe-lane-b.ts` | `["member-role-conflict"]` |
| B06 several tasks share one member; several members share one role | PASS | `probe-lane-b.ts` B06 (added at 05:43Z) | one role with 3 seats and two tasks on `Seat 1` ⇒ findings `[]` |
| B07 `self-review` compares resolved members when both declared, else ownerRole | PASS | `probe-lane-b.ts` (4 cases) | same member ⇒ `self-review`; different members ⇒ allowed; no members + same role ⇒ `self-review`; different roles ⇒ allowed |
| B08 refused submission writes `split/<rev>.refused.json` (accepted:false + full findings) | PASS | `probe-lane-b.ts` | `1.refused.json` exists, `accepted=false`, `findings.length` equals the returned verdict's |
| B09 accepted verdict never overwritten; both coexist | PASS | `probe-lane-b.ts` | `1.json` accepted + `1.refused.json` both present; after a later refusal the canonical bytes are byte-identical (1540 B); `latestSplit` answers the acceptance |
| B10 `split-refused` journal row carries the findings | PASS (inspection) | `flow.ts`, the `split-refused` append (the `findings:` mapping beside `refused:`) | the row maps `code`, `taskKey`, `detail` — not counts. The handler needs a live cell/board; the wave sweep's mount is the mechanical arm |
| B11 section body runs until the next same-or-higher heading | PASS | `probe-lane-b.ts` B11 | a document whose `## Constraints` opens with `### Assumptions` finalizes: `ok=true`, `missing=[]` |
| B12 whitespace-only body is still missing/empty | PASS | `probe-lane-b.ts` B12 | `ok=false`, `missing=["Constraints"]` |
| G04 red-before-green (lane-B defects unit-testable) | PASS | `probe-red-b.ts` (executes HEAD's modules) | RED-CONFIRMED ×3: refusal landed at `1.json` (no `.refused.json`), accepted resubmission overwrote it; `###` inside Constraints was refused as empty; `member` was ignored (no `member-invalid`, no `self-review`, no resolved member on the verdict) |

Lane-B gate: `bun test packages/mpd-cellwork-plugin` → **146 pass / 0 fail, exit 0**
(`logs/tests-cellwork-final.log`); its two new files alone → **15 pass / 0 fail**
(`logs/lane-b-tests.log`).

### Lane D — `gates.ts`, `tools.ts`, `ledger.ts` (C2-server, C3)

| Item | Verdict | Proof | Observed |
|---|---|---|---|
| D01 `writer_id` trimmed, non-empty, ≤200 | PASS | `probe-lane-d.ts` D01/bounds | `"   "` refused; 201 chars refused; 200 chars accepted |
| D02 delegate + `writer_id` ⇒ `writer.id` IS that value | PASS | `probe-lane-d.ts` D01/D02 (loop file read back) | `{"kind":"delegate","id":"session-S","reason":"member: Alice"}` |
| D03 absent ⇒ unchanged `delegate:pending` | PASS | `probe-lane-d.ts` D03 | `"delegate:pending"` |
| D04 `writer:"self"` + `writer_id` ⇒ refusal | PASS | `probe-lane-d.ts` D04 | refused naming `writer_id` (and `writer_reason`, same sentence) |
| D05 `writer_reason` stored on `writer.reason` | PASS | `probe-lane-d.ts` D05 | `"member: Alice"` |
| D06 acceptance: same loop, writer records ⇒ `same-agent`; different session ⇒ accepted; file names the member | PASS | `probe-lane-d.ts` D06 (FAIL arm **and** a PASS arm citing a produced gate evidence id) | writer `session-S` ⇒ `{"reason":"same-agent","detail":"…same agent (\"session-S\")…"}`; `session-T` ⇒ accepted (`writerId=session-S`, `verifierId=session-T`); `writer.reason` on disk is `member: Alice` |
| D07 `mpd_verify_record` refuses `writerId === verifierId` | PASS | `probe-lane-d.ts` D06/refused | refusal reason is the stable `same-agent`; the check lives in `record.ts` (untouched by this wave) and is now reachable because the id is real |
| D08 absent project file ⇒ frozen table unchanged | PASS | `probe-lane-d.ts` D08 + D08/control | `tests` ⇒ `bun test packages`; `typecheck` ⇒ `bun run typecheck`; `GATE_TABLE.length === 10` |
| D09 shape; `cmd` defaults to `argv.join(" ")` | PASS | `probe-lane-d.ts` D09/D15 | project `tests` ⇒ `cmd` is the joined argv; an explicit `cmd` is kept (`project audit label`) |
| D10 `version` optional, must be 1 | PASS | `probe-lane-d.ts` D13/version-2 | `version:2` ⇒ refused naming file+problem |
| D11 id `^[a-z][a-z0-9-]{0,31}$` | PASS | `probe-lane-d.ts` D13/bad-id | `"Bad_Id"` refused with the pattern in the sentence |
| D12 `argv` 1..32 non-empty strings ≤4096 | PASS | `probe-lane-d.ts` D13 (4 arms) | non-array, empty, numeric element and 4097-char element all refused; each sentence names file+gate+position |
| D13 malformed file refuses, names file+problem, NO silent fallback | PASS | `probe-lane-d.ts` D13 (10 arms) | all ten refused with `mpd-gates.json at the workspace root is invalid (…), so the gate call is refused instead of falling back to the frozen table`; the tool wrote `0` new evidence rows in every arm |
| D14 ≤32 entries | PASS | `probe-lane-d.ts` D13/too-many + D14/boundary-32 | 33 refused; 32 accepted |
| D15 project entry first, frozen second; ADD or OVERRIDE | PASS | `probe-lane-d.ts` D09/D15/override + D15/fallback + D15/unknown | override runs; a non-declared frozen id still resolves; an id nothing declares is refused naming the effective vocabulary |
| D16 `argv[0]` is the program, `shell:false`, cwd = workspace, `gateTimeoutMs` | PASS | `probe-lane-d.ts` D16/cwd + D16/shell-false + D16/timeout | child cwd = temp workspace; `$((1+1)) && echo SHELL` arrives as ONE verbatim argument (no shell); a killed child reports exit `124` in 304 ms on a 300 ms budget |
| D17 evidence header names the EFFECTIVE cmd | PASS | `probe-lane-d.ts` D17/header + D17/tool-header + D15/meta | log line `# gate tests cmd: node -e …`; evidence metadata carries the same `cmd` and the loop id |
| D18 resolved per call, never cached | PASS | `probe-lane-d.ts` D18/per-call | rewriting the file changes the next resolution immediately |

Lane-D gates: `bun test packages/mpd-verify-plugin` → **74 pass / 0 fail, exit 0** (`logs/tests-verify.log`);
its two new files alone → **16 pass / 0 fail** (`logs/lane-d-tests.log`).

### Lane E — `captain-investigation.ts`, roles `index.ts`, cellwork `guard.ts`, `prompts.ts` (C4, C5)

| Item | Verdict | Proof | Observed |
|---|---|---|---|
| E01 captain reads `AGENT.md`/`AGENTS.md`/`CLAUDE.md` by basename, any depth, inside AND outside the root | PASS | `probe-lane-e.ts` E01 | 20-path allow table: root, nested (`packages/x/src/CLAUDE.md`), relative sibling (`../VEdit/AGENT.md`), absolute sibling (`/home/someone/VEdit/AGENTS.md`), absolute-in-root — all readable |
| E02 everything else unchanged: source refused, `..` refused, only read/grep/glob intercepted | PASS | `probe-lane-e.ts` E02 + E02/decision + E02/scope | source paths, non-instruction `..`, nested README, absolute outside-root non-instruction, empty path all refused; `write` passes through; a child session passes; `mode:"allow"` passes |
| E03 refusal text advertises the TRUE band | PASS | `probe-lane-e.ts` E03 | contains `AGENT.md`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `README.zh-CN.md`, `CHANGELOG.md`, `LICENSE*.md`, the sentence "no `README*` glob", both routes, the opt-out |
| E04 `mpd_role_spawn` forwards maxDepth = caller depth + 1; top-level = 1 | PASS | `probe-lane-e.ts` E04 (9 header shapes) | `{}`→1, depth 0→1, depth 1→2, depth 3→4, origin subagent (no depth)→2, origin+depth2→3, negative→1, `"2"`→3, 1.9→2; the registered tool passes `maxDepth: spawnMaxDepthOf(exec.agent)` |
| E05 planner (`member`, name `cell-planner`) refused on source paths; the documented band readable | PASS | `probe-lane-e.ts` E05 + E05/decisions | 11-path allow and 7-path refuse tables all correct; bare call refused; other members untouched; only read/grep/glob; name trimmed+lower-cased; an unresolved root fails closed |
| E06 planner refusal teaches BOTH routes and says why | PASS | `probe-lane-e.ts` E06 | `cellwork_recon`, `Explorer`, `Researcher`, `mpd_role_spawn`, "read-only roster role", the context reason and the band are all present |
| E07 planner prompt tells it to delegate | PASS | `probe-lane-e.ts` E07 | every one of the 18 `PLANNER_RECON_LINES` is inside `plannerPrompt` (`staging.ts` spreads it; the splitter prompt is untouched — R2) |
| E08 the two bands are one contract (lists + semantics, pinned by a test importing both) | PASS | `probe-lane-e.ts` E08 + `band-parity.test.ts` | four literals equal (prefixes, root files, instruction basenames, licence regex source+flags); a 20-path table agrees with the contract and with each other; the shipped parity test imports both modules, no runtime cross-package import exists (grep) |
| E09 R1: the `captain-investigation.test.ts` edit is limited to the superseded assertion | PASS (inspection) | `git diff` of that file | one hunk: nested `AGENTS.md` flipped to allowed + its title/comment; nested `README.md` refusal still asserted; no other assertion moved |

Lane-E gates: `bun test packages/mpd-roles-plugin` → **185 pass / 0 fail, exit 0** (`logs/tests-roles.log`);
`bun test packages/mpd-cellwork-plugin` → **146 pass / 0 fail, exit 0**; its four new files alone →
**21 pass / 0 fail** (`logs/lane-e-tests.log`).

### Lane-wide gates (§4)

| Item | Verdict | Proof | Observed |
|---|---|---|---|
| G01 verify + roles package tests green on the pinned toolchain | PASS | `.toolchain/node_modules/.bin/bun test packages/mpd-verify-plugin` / `… packages/mpd-roles-plugin` | 74/0 and 185/0, exit 0 (separate invocations, R9 discipline) |
| G02 cellwork package tests green | PASS | `.toolchain/node_modules/.bin/bun test packages/mpd-cellwork-plugin` | 146/0, exit 0 |
| G03 `node scripts/verify-comment-coverage.ts` green | PASS | `node scripts/verify-comment-coverage.ts` | `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature`, 501 files, exit 0 |
| G04 red-before-green credibility | PASS | `probe-red-b.ts` (lane B executed); `logs/red-lane-de-inspection.log` (D/E) | lane B: 3/3 RED executed; lane D/E new symbols absent at HEAD (`PROJECT_GATE_FILE`/`resolveGate`/`loadProjectGates` 0, `writer_id`/`writer_reason` 0, `CAPTAIN_INSTRUCTION_BASENAMES` 0, `spawnMaxDepthOf`/`maxDepth` 0, `PLANNER_`/`cell-planner` 0, `PLANNER_RECON_LINES` 0) |

### Transient reds seen during the review — checked, not reported as findings (R9 lesson)

- 13:28 run of `bun test packages/mpd-verify-plugin packages/mpd-roles-plugin`: 1 fail
  (`F1 shipped artifact …`, header `packages/mpd-roles-plugin/test/adapter-identity.test.ts`). Cause:
  the committed roles `dist/index.js` was stale against lane E's src **at that moment**; it was rebuilt
  at 13:30:24 and `node scripts/verify-dist-fresh.ts` then reported roles/verify `FRESH` (cellwork still
  `STALE` while lanes A/C edited). Derived surfaces are the captain's integration step; re-runs are green.
- 13:29 `bun test packages/mpd-cellwork-plugin`: 1 fail, `dispatch-reassign.test.ts` (lane A's file, mid-edit).
  Final run: 146/0.
- 13:28 `verify-comment-coverage`: 2 violations in `packages/mpd-cellwork-plugin/test/mail-order.test.ts`
  (lane A's file). Final run: PASS.
  Every header above named a `packages/…` path, never an `evidence/…` scratch copy, so none of these was
  a scratch-tree artefact.

### §7 rulings that bear on these lanes

- **R1 (the superseded assertion):** E09 above — the single authorized edit, checked line by line.
- **R2 (the planner prompt):** E07 above — `PLANNER_RECON_LINES` is exported by lane E's `prompts.ts` and
  spread into `plannerPrompt` only; `git diff` shows the splitter prompt untouched.
- **R4 (the fenced field):** not applicable to lanes B/D/E; the member record field is lane A + lane C's
  coupling. Confirmed neither lane-B/D/E file names `fenced`.
- **R5/R6 (superseded / invalidated tests):** lanes B and D touched no existing test; lane E's single edit
  is R1's. No assertion was weakened to obtain a pass.
- **R7 (team mail):** outside these lanes; not judged here.
- **R8 (comment-only `recon.ts`):** lane C's file; I did not review it beyond confirming it is not in
  lanes B/D/E.
- **R9 (evidence hygiene):** applied — probes and the pre-change copy live under `mktemp -d`, only logs
  under `evidence/`, no `*.test.ts` in this evidence tree, no `mpd-gates.json` in the checkout root;
  per-package test invocation only.

## 3. Ranked findings

No Blocker / High / Medium. Two Nits, both non-behavioural for any contract-shaped caller.

**N1 (Nit) — `writer_reason` is refused above 200 characters, a bound the contract does not state.**
- Where: `packages/mpd-verify-plugin/src/tools.ts`, `openTool` (the `writer_reason` shape guard).
- What: C2 bounds `writer_id` (trimmed, non-empty, ≤200) but says nothing about `writer_reason`; the
  implementation applies the same trim + 1..200 bound and refuses otherwise. A 201-character reason that
  the contract says should be "stored on `writer.reason` when given" is refused instead.
- Why it matters: only contract fidelity — a member name is ≤64 chars (C1's own bound), so a caller that
  obeys the contract cannot reach it.
- Direction of a fix (described, not applied): either drop the bound for `writer_reason`, or state it in
  the contract/README so the refusal has a written basis.

**N2 (Nit) — a project gate's explicit `cmd` is refused above 4096 characters, a bound the contract does
not state.**
- Where: `packages/mpd-verify-plugin/src/gates.ts`, `loadProjectGates` (the `cmd` branch).
- What: C3 caps `argv` elements at 4096 and does not bound `cmd`; the implementation caps and refuses
  `cmd` too.
- Why it matters: a project whose `cmd` label is a long diagnostic string would be refused where the
  contract admits it; no realistic label is that long.
- Direction of a fix: drop the cap, or record it in the docs lane's text for C3.

**Out-of-lane observation (not counted in this verdict; belongs to lane C / R1):** the `split-refused`
append in `packages/mpd-cellwork-plugin/src/flow.ts` carries a comment saying "the accepted resubmission
overwrites the split file — the journal is the durable half". After C9 that is no longer true: a refusal
lands at `<rev>.refused.json` and survives an accepted resubmission. The code is right (the row does carry
the findings); the comment is stale. Nit for lane C / R1.

## 4. Declined to judge (each with its reason on the same line)

1. **Case-insensitive instruction basenames (C4)** — the implementation admits `agents.md`/`Agent.md`,
   which the literal "BASENAME is `AGENT.md`…" does not; it is a declared Windows-safety choice, it
   admits no source path (only instruction-shaped names), and it cannot widen the band's danger — declined.
2. **A section whose entire body is a nested heading counts as content (C10)** — the contract mandates
   only the whitespace-only refusal; a body containing a `###` line is not whitespace, so the literal
   criterion is met — declined (no rule says heading-only is empty).
3. **"An accepted verdict is never overwritten" read literally across two ACCEPTED submissions** — a newer
   accepted submission for the same revision replaces the earlier canonical file; I read the clause as the
   defect's shape (a refusal must not overwrite an acceptance), and the newest acceptance is the graph an
   activation must use — declined; the docs lane should state it.
4. **The unknown-gate refusal can list an overridden id twice (project ids then frozen ids)** — cosmetic
   duplication in one sentence — declined.
5. **Member/role comparison uses `roleKey` (lowercase, punctuation-collapsed)** — `"Senior Engineer"` and
   `"senior-engineer"` count as the same role for `member-role-conflict`/`self-review`; this is consistent
   with role-existence validation in the same module — declined.
6. **`..` segments are admitted for instruction basenames (C4 bullet 1 vs bullet 2)** — the motivating
   sibling project's path necessarily contains `..`; every non-instruction `..` spelling stays refused —
   declined as an interpretation, not a defect.
7. **One side declares a member and the other does not ⇒ ownerRole comparison** — this is the contract's
   literal fallback ("falls back to comparing `ownerRole` otherwise") — declined.
8. **R6 existing-test edits** — lanes B and D changed no existing test; lane E's single edit to
   `captain-investigation.test.ts` is R1-authorized and limited to the superseded assertion — declined
   (no finding).
9. **Pre-existing unused helper `gateIds` in `tools.ts`** — present at HEAD, not introduced by lane D —
   declined as not a wave finding.
10. **Working-tree `dist/**` changes** — derived surface; `verify-dist-fresh` reported roles/verify
    `FRESH` at my read; the author of the rebuild is unrecorded and the wave sweep owns the gate —
    declined as a lane finding.
11. **`writer_reason` is trimmed as well as bounded** — benign normalization; no caller is affected by a
    leading/trailing space in a member label — declined.

## 5. Bounds of this review

- Not run here (T9's wave gates, not lane acceptance): `bun run typecheck`, `verify:docs`,
  `verify:manifest`, `verify:rows`, `verify-no-host-override`, `preset-conformance`, the Docker lane, the
  repo-root `bun test`. The captain's observed state is quoted above only as context, never as my proof.
- No live dsh mount: `mpd_verify_open`/`mpd_verify_record`/`mpd_verify_evidence` were driven through the
  shipped definitions (`registerVerifyTools` + a captured registry), and the cellwork predicates directly.
  The `cellwork_split` handler (board lookup, journal append) and the harness-side JSON-schema validation
  of the three changed schemas need the mount; B01 and B10 are marked "inspection" for exactly that
  reason. `preset-conformance` is the mechanical arm for the schema changes.
- I did not review lanes A, C or F except where they touch my items: C2's caller side in
  `activate.ts` (it passes `writer_id` = the member's session id and `writer_reason` = `member: <name>` —
  the wiring is present; R1 should verdict it), C9's journal site in `flow.ts` (verified by inspection),
  and the C1 schema wiring in `flow.ts`. Lane F's documentation (T8) is pending, so the three package
  READMEs do not yet describe C1's `member`, C2's `writer_id`, C3's `mpd-gates.json`, C4's band or C5's
  planner rule; I judged from the frozen contract, and `verify:docs` is a wave gate.
- The lanes' own tests were run but not used as proof; lane B's RED was executed, lanes D/E's RED is
  argued from symbol absence at HEAD (their new test files import symbols that did not exist), not from
  executing the pre-change tests.
- The live team record changed while this review ran (lanes A/C were still `in_progress` at 13:26 local);
  the reads above are pinned by the hash file at 05:44:40Z. The wave sweep must re-run its gates on the
  settled tree.

## 6. Evidence inventory (all under this directory)

- `checklist.md` — the pre-diff acceptance checklist.
- `probes/probe-lane-b.ts` — 21 checks, exit 0 (`logs/probe-lane-b.log`).
- `probes/probe-lane-d.ts` — 35 checks, exit 0 (`logs/probe-lane-d.log`).
- `probes/probe-lane-e.ts` — 11 checks, exit 0 (`logs/probe-lane-e.log`).
- `probes/probe-red-b.ts` — 3/3 RED-CONFIRMED against `git show HEAD:` modules, exit 0
  (`logs/probe-lane-red-b.log`; a scratch tree under `mktemp`, removed at end of run).
- `logs/source-hashes-at-review.txt` — the reviewed hashes.
- `logs/tests-verify.log`, `logs/tests-roles.log`, `logs/tests-cellwork-final.log` — per-package suites.
- `logs/lane-b-tests.log`, `logs/lane-d-tests.log`, `logs/lane-e-tests.log` — the lanes' own new files.
- `logs/comments-rerun.log` — the comment gate PASS.
- `logs/red-lane-de-inspection.log` — the HEAD symbol-absence inspection for lanes D/E.
- `logs/tests-verify-roles.log`, `logs/tests-cellwork.log`, `logs/tests-cellwork-rerun.log`,
  `logs/comments.log` — the transient-red runs quoted in §2 (kept so the intermediate state is auditable).
