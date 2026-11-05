# Verdict — VEdit throughput fixes (D1 + D2 + D3)

**Verdict: REQUEST CHANGES (FAIL)**
Reviewer seat: `reviewer-1` (independent verifier; different agent from every writer). No code, test or
gate was edited by this seat; the only files written are under `.mpd/reviews/**` (plus the gate log the
verify plane wrote itself).
Reviewed state fingerprint: `git diff` sha256 **663fa32428c9bafc718ce2b8f85eeb764e9b32ac84c77e2878fc53e9dfa2451f**
(9 283 diff lines), HEAD `4f102eca` on `fix/vedit-throughput`, read at **2026-11-05T12:03:03Z**.
Full reviewed diff archived at `.mpd/reviews/tmp/vedit-wave-reviewed.diff` (artifact anchor).
Verdict basis (pre-implementation, timestamped): `.mpd/reviews/vedit-throughput-review-basis.md`.
Contract: `.mpd/plans/vedit-throughput-fixes.md` (contract v2, including the §D3.3 amendment and the
four amendments this seat's audit produced).

---

## 1. Assessment

The wave delivers all three defects with the shape the frozen contract asks for, and the evidence is
real: 13 gates green including a real preset boot, the two new tools genuinely mounted, the D1 re-team
gate re-arms on an ended/clean-terminal board without breaking the `session-start-team` c7 fixture, the
D2 async seam returns before the child settles with `spawnAgent` kept as its blocking projection, and
the D3 force supervisor fixes the name-keyed owner map, measures the task's own `startedAt`, honours the
no-age-bound bash exemption, and lands handoff → interrupt → requeue → split → mailbox → journal with
the captain-guard in two independent places. Cross-plane claims are covered by real tests
(autoproject-style consult through the deadman; cell-backed seat through the force path), and the D1
concurrency counter rides the adapter's documented POST hook rather than a second observation path.
Two things hold it back: (a) the consult deadman decides "is my current call bash?" from an activity
bucket keyed by the delegation LABEL, so with two concurrent consults of the same role a sibling's tool
start/end can overwrite or CLEAR an open bash and the deadman then interrupts the very child §D2.6
forbids it to interrupt — the declared bound is not merely conservative, it is wrong in the dangerous
direction; and (b) the watchdog package's own README, which AGENTS.md §3 declares to be that plugin's
contract, still documents the pre-D3 posture ("no wedge detection inside a hanging tool", "an in-flight
turn is not aborted", "no team mutation") and omits the new `forceAfterMs` knob from its frozen §3
three-layer table. Risk level: **MEDIUM** — one High correctness gap confined to same-role concurrency,
one Medium contract/documentation drift, the rest Nit; nothing found that breaks D1 or D3.

---

## 2. Gate evidence (all run by this seat at the reviewed state)

| Gate | Evidence id | Result |
|---|---|---|
| `bun run typecheck` | `ev-20261105T120211-057d77` | PASS (exit 0) |
| `verify:comments` (`verify-comment-coverage.ts`) | `ev-20261105T120212-36f7e3` | PASS (exit 0) |
| `verify:docs` (`verify-docs-parity.ts`) | `ev-20261105T120215-2eab23` | PASS (exit 0) |
| `verify:manifest` (`--pack`) | `ev-20261105T120215-a3c8c4` | PASS (exit 0) |
| `verify:rows` | `ev-20261105T120217-55d6a1` | PASS (exit 0) |
| `verify-vendor` | `ev-20261105T120218-e3e2ab` | PASS — 7 assets fingerprinted, `skills` 391 files (after the captain's re-pin; see §6) |
| `bun test` (7 touched packages) | `ev-20261105T120130-32b8ab` | PASS (exit 0) |
| `bun run test:qa` (all `--self-test`, incl. `session-start-team`) | (own log `.mpd/reviews/tmp/gates/test-qa.log`) | PASS — C7 driven BOTH ways, 80 `ok:` lines, "all self-tests passed" |
| `bun skills/dsh-qa/scripts/bundle-lifecycle.ts` (real MOUNT) | `.mpd/reviews/tmp/gates/bundle-lifecycle.log` | PASS |
| `node skills/dsh-qa/scripts/preset-conformance.ts` (real preset mount + negative control) | `.mpd/reviews/tmp/gates/preset-conformance.log` | PASS |
| `node scripts/verify-dist-fresh.ts` | `.mpd/reviews/tmp/gates/dist-fresh.log` | PASS — 34/34 targets fresh (pinned bun 1.4.0; 1 declared NOT COVERED) |
| `node scripts/verify-manual-paths.ts` | `.mpd/reviews/tmp/gates/manual-paths.log` | PASS (resolved=157) |
| `node scripts/verify-no-host-override.ts` | `.mpd/reviews/tmp/gates/no-host-override.log` | PASS |

Not run (declared in §8): the Docker lane (no install/mount-path change in this wave), any live-LLM
lane, and a live VEdit throughput measurement.

---

## 3. Findings (ranked)

### F1 — HIGH — the consult deadman's bash exemption is decided per ROLE LABEL, not per child

- **What.** Every consult child is spawned with `label = <role name>`
  (`packages/mpd-roles-plugin/src/index.ts`, the `spawnAgentAsync`/`spawnAgent` call in the blocking and
  async raise paths). The per-tool activity bucket is keyed by that label:
  `packages/mpd-roles-plugin/src/index.ts#activityLabel` derives the label from
  `dsh.subagentLabelOf(exec.agent)`, and `#noteToolStart` / `#noteToolEnd` read and write ONE bucket per
  label. The deadman then asks for that same label: `packages/mpd-roles-plugin/src/spawn-async.ts#onDeadman`
  calls `deps.activityOf(record.role)` and exempts only when `activity?.current?.name === "bash"`.
  With two concurrent consults of the SAME role (exactly what D2 exists to enable — nothing prevents
  `mpd_role_spawn_async {role:"Senior Engineer"}` twice), both children share one `current` slot:
  a sibling's `noteToolStart` OVERWRITES the open bash, and a sibling's `noteToolEnd` CLEARS it.
  The deadman then sees "no bash open" and interrupts the child whose own bash call is still in flight.
- **Symptom.** A legitimate long verification run can be killed at the 15-minute boundary when another
  consult of the same role is running — the precise outcome §D2.6's exemption exists to prevent. The
  mirror error also exists (a wedged sibling is exempted while the twin holds bash), which only delays
  the rule.
- **Expected (contract §D2.6).** "if the child's CURRENT tool call is `bash` and still in flight → DO
  NOT interrupt" — the subject is THE CHILD, not its role. The only exemption must be decidable per
  consult.
- **Doc source.** `.mpd/plans/vedit-throughput-fixes.md` §D2.6 (the exemption and "Never interrupt …
  a child that is not this consult's"), and the same paragraph's handoff obligation.
- **Direction of fix (described, not applied).** Key the activity bucket by the child's immutable
  identity — the `DshAsyncAgent.id` the adapter now returns, or the child agent's session id that
  `subagentLabelOf` already reads — and pass `record.handle?.id` (available from the moment `arm()` runs)
  into `deps.activityOf`; keep the label only as a display fallback when no id exists. A behavioural
  test must pin it: two consults of one role, one with bash open, one wedged → only the wedged one is
  interrupted.
- **Status of the builder's declared bound.** The builder declared "two CONCURRENT consults of the SAME
  role share one activity entry … conservative: an open bash is never killed". That description is not
  accurate: the shared entry can be cleared or overwritten by the twin, so an open bash CAN be killed.
  This is why it is a finding rather than an accepted bound.

### F2 — MEDIUM — the watchdog package's own contract still describes the pre-D3 plugin, and the new knob is outside the frozen three-layer table

- **What.** `packages/mpd-team-watchdog-plugin/README.md` (AGENTS.md §3: "Each packages/<pkg>/README.md
  holds that plugin's own contract") now contains a correct new "The force supervisor (2026-11-05)"
  section, but still ships three NOT-CLAIMED bullets that D3 reverses:
  - "**No wedge detection INSIDE a hanging tool.** … never escalated or paused" — D3 now FORCES a member
    inside a non-bash hanging tool (pinned by the wedge-force test "the SAME wedged member with a
    NON-bash tool open IS forced").
  - "**An in-flight turn is not aborted.** … only a real chat interrupt ends a wedged turn" — D3 aborts
    it through the adapter interrupt seam.
  - "**No team mutation, by construction.**" — the second sentence (only watchdog-owned files are
    written) is still literal truth, but the heading now understates the shipped behaviour: the
    watchdog directs a board requeue + split through `mpdTeamActions`.
  Separately, the frozen-knob paragraph ("These numbers are the frozen §3 table … the three layers must
  agree exactly") is false for `forceAfterMs`: it is present in `machine.ts#WATCHDOG_DEFAULTS` and in the
  row's `Config` schema, but ABSENT from the bundle patch's watchdog row config
  (`cordis.patch.yml`, the `mpd-team-watchdog` row) and from `mpd-config-plugin`'s
  `SettingsSchema.watchdog` / `FIELDS`; the README knob TABLE does not list it either (only the new
  prose section does).
- **Symptom.** A reader of the package contract is told the plugin does not do the thing this wave makes
  it do, and the new knob cannot be discovered or set through the front doors, while the row-config
  comment claims those layers must agree exactly.
- **Expected.** The package contract matches the shipped behaviour (AGENTS.md §3, §4 Doc pairs), and a
  knob the README calls part of the frozen §3 table is declared in the layers that table names — or the
  residual is named explicitly (the README already has that pattern for `toolInFlightMaxMs`).
- **Doc source.** AGENTS.md §3 (package README is the plugin contract) and §4 (Doc pairs); contract
  §D3.6 ("`forceAfterMs` is read live per tick like the other knobs").
- **Direction of fix (described).** Rewrite the three NOT-CLAIMED bullets for the D3 posture; add
  `forceAfterMs` to the knob table, to the watchdog row config in `cordis.patch.yml`, and to
  `mpd-config`'s schema + `FIELDS` (or document it as a front-door residual with the same sentence the
  package already uses for `toolInFlightMaxMs`); update the zh-CN twin in the same commit.

### F3 — LOW — the D3 bash exemption is silently gated on a clock being present

- **What.** `packages/mpd-team-watchdog-plugin/src/machine.ts#observeWedge` exempts only when
  `tool === "bash" && typeof inFlightSince === "number"`. An open bash whose start instant is not
  observable falls through to the force path and the member is interrupted.
- **Expected (contract §D3.3).** While the in-flight tool is `bash`, the member is EXEMPT for as long as
  that call is open — the tool name is the exemption, not the presence of a timestamp.
- **Doc source.** `.mpd/plans/vedit-throughput-fixes.md` §D3.3.
- **Direction of fix.** Exempt on the tool name alone and use `now` for the `inFlightMs` field when the
  stamp carried no start instant.

### F4 — NIT — `acted` is written but never read

- `packages/mpd-roles-plugin/src/session-gate.ts#installSessionGate` keeps `acted` (`add`/`delete`) and
  exposes it on `SessionGateInstall`, but the step handler no longer tests it; the settlement is
  `ReTeamState.lastFiredAt` / `planId`. Either read it (as a cheap early return) or drop it from the
  install outcome so a test cannot assert a state production does not honour.

### F5 — NIT — blocking consult records are never evicted

- `packages/mpd-roles-plugin/src/spawn-async.ts#collect` deletes a record only when collected. A
  blocking `mpd_role_spawn` leaves its record in `records` for the life of the process, so
  `mpd_role_consult {action:"list"}` grows without bound in a long session (the VEdit session made 47
  calls). Mark a blocking record collected after `settle`, or cap the map.

### F6 — NIT — the async tool defers argument validation into the background

- `mpd_role_spawn_async` returns `{state:"running"}` and only then validates role/task/route inside
  `raiseConsultAsync` (a typo becomes a failed consult). The blocking tool throws the teaching error
  synchronously. A synchronous pre-flight (role + task non-empty) before `consultSupervisor.start` would
  make the two surfaces behave consistently.

### F7 — NIT — cellwork guard: two overlapping deny lists now depend on a precedence subtraction

- `packages/mpd-cellwork-plugin/src/guard.ts#VERIFIER_DENY_TOOLS` gained the two consult names (as §D2.7
  requires) while `#VERIFIER_NO_DELEGATION` also carries them, so
  `#cellworkGuardDecision` must subtract the delegation list from the write list to keep the right
  refusal sentence. The subtraction is correct and tested, but the declaration comment still says "the
  eight names", and the two names were appended with a doubled space on one line
  (`"mcp__lsp__rename_symbol_strict",  "mpd_role_spawn_async",`). Prefer a comment at the list
  declaration naming the precedence instead of only at the branch.

---

## 4. The two declared bounds — rulings requested by the Lead

**Bound 1 — D2 supervision keyed by the child LABEL.** **NOT ACCEPTABLE as stated** (see F1). The
contract's "the child's CURRENT tool call" is NOT honoured per consult: it is approximated per role, and
the approximation fails in the dangerous direction because a sibling's tool start/end can clear or
overwrite the shared slot. The conservative half (a wedged consult exempted while its twin holds bash)
would be acceptable as a documented liveness delay; killing a child whose own bash is open is not. If the
Lead chooses not to fix it in this wave, it must be recorded as a KNOWN BOUND in
`agent-references/supervision.md` and the package README with the failure mode stated, and a follow-up
repair task opened — it cannot be described as "an open bash is never killed".

**Bound 2 — four names in the LEAF deny lists.** **ACCEPTED as a defensible closure.** Two of the four
are load-bearing: `mpd_role_spawn_async` is a spawn tool and denying it is what keeps "a consult is a
leaf" true (without it a child could delegate again through the new surface); `mpd_role_consult` is a
defensive extra because `cancel` mutates another consult and a child has nothing legitimate to read
there. This is an extension of §D2.7's sentence, not a contradiction of it, and the parity assertions in
roles/workmate plus the cellwork verifier list are updated and green. Recorded as a deliberate closure —
no finding.

---

## 5. The Lead's three AGENTS.md clauses, checked against the shipped code

| Clause | Verdict |
|---|---|
| §1 async-consult paragraph (`mpd_role_spawn_async` returns a consultId at once; `mpd_role_consult` lists/waits/collects/cancels; every consult carries the 15-minute deadman; an open bash is the only exemption) | **Accurate for the shipped tools and the deadman.** Caveat: "its only exemption" is true as written but, per F1, the exemption is not reliably applied per child under same-role concurrency. Recommend the long form (`agent-references/supervision.md`) state the label-keying bound if F1 is not repaired. |
| §1 re-team paragraph (live until ended; clean-terminal = ≥1 task, all completed/cancelled, none failed; failed blocks auto-end and re-team; afterConsults default 4; marker `[AgentTeams] Re-team rule`; state file path; `team.reteam.enabled` gates only the volume trigger) | **Accurate.** Matches `complexity-gate.ts#readTeamBoard` (`hasTasks` load-bearing), `#readLeadingTeam`, and `session-gate.ts#stepHandler` including the "enabled gates only rules 5–6" branch. |
| §13 ten names + T-93 | **Accurate.** `READONLY_DENY` is ten in both roles and workmate (parity pinned), T-93 matches the re-arm/blocked behaviour. |

---

## 6. State drift observed during the review (not a finding at the reviewed state)

At the moment this seat first ran the vendor gate, `node scripts/verify-vendor.ts` FAILED with
`asset skills treeSha mismatch`: T6 had edited `skills/dsh-qa/scripts/readonly-deny.ts` (and later
`skills/dsh-qa/SKILL.md` + `skills/dsh-qa/scripts/lib/mcp-dependency.ts`) without a `VENDOR_LOCK.json`
re-pin (AGENTS.md §9 + §11: the re-pin must land in the same commit). While this review was in progress
the captain re-pinned; at the reviewed state `verify-vendor` PASSES (`skills` 391 files,
`ev-20261105T120218-e3e2ab`). **Watch item for the commit:** any FURTHER `skills/**` edit re-reddens the
vendor gate until the single re-pin is refreshed again; the commit must carry exactly one re-pin for the
final skills tree.

---

## 7. Test integrity check (no weakening found)

The ten modified tests are pin updates the contract itself requires (deny-list counts and contents, the
new tool list, the new knob field), not relaxed assertions: the `readonly-deny` self-test moved 8→10 and
the leaf pair→four, `leaf-boundary`/`adapter-identity`/`rename-delete` follow the new lists, and
`tool-inflight`/`team-plane`/`support` add the `forceAfterMs` field with a comment explaining that those
candidates have no `status`/`startedAt` so the wedge rule cannot fire and the arms stay what they were.
The one invariant that was RELAXED — cellwork's "VERIFIER_DENY_TOOLS and VERIFIER_NO_DELEGATION are
disjoint" — is a direct consequence of §D2.7's mandated overlap, and the replacement assertions still
pin which refusal sentence wins (see F7). New coverage matches the contract's acceptance bullets one for
one: D1's ten arms (ended/clean-terminal/empty-board/failed/live-wins/resolvers/auto-end-once/re-arm/
persistence/scope/off), D2's seven (peak in-flight ≥2, wait+collect, non-bash deadman, open-bash
exemption, cap queueing, blocking shape, default bound), D3's thirteen watchdog arms plus eight
team-core arms (session-id owner, force-once, below-bound, forceAfterMs 0 falsifier, absent plane,
retryable re-arm, bash open, non-bash forced, resolver, absent service, lead never forced; and
handoff/requeue/split, one continuation row, session-id owner, captain refusal, interrupt refusal still
requeues, handoff failure retryable, cellwork inheritance, non-in_progress refusal). No test was edited
to make a red gate green; every gate was green from a clean run by this seat.

---

## 8. Bounds of this review (what I did not read / could not run)

- Did NOT read: `packages/*/dist/**` diffs (relied on `verify-dist-fresh` 34/34 fresh); the zh-CN
  document bodies (relied on `verify:docs`, which is green, and read the English twins only); the full
  592-line D1 test addition (read every test NAME plus the critical auto-end/volume/re-arm arms and the
  notice/resolver fixtures); `evidence/**` runtime records; packages the wave does not touch.
- Did NOT run: the Docker real-machine lane (not marked for this wave — no `files`/`dsh.*`/patch-row/
  install-path change beyond a row's config text), any live-LLM lane, the live `readonly-deny` lane, or
  a real VEdit throughput measurement — so I cannot state that the incident's 45.6 h/serial-consult
  pathology is measurably gone, only that the mechanisms it was caused by are fixed and tested.
- No verify LOOP was opened for this wave, so this verdict is recorded here (and on T4) rather than
  through `mpd_verify_record`; the gate evidence ids above are the ones `mpd_verify_evidence` produced at
  the reviewed state.
- Shell caveat: the tree is LIVE (uncommitted). The reviewed fingerprint is stated in the header; if the
  diff sha changes before the commit, the changed hunks are not covered by this verdict.

---

## 9. Verdict

**REQUEST CHANGES.** Justification: D1 and D3 implement their contract clauses with green gates, real
mount evidence and cross-plane tests, but D2's deadman decides the bash exemption from a role-labelled
activity bucket, so a concurrent same-role consult can be interrupted while its own bash call is open —
the one outcome §D2.6 forbids — and the watchdog package's own README still documents the pre-D3 posture
while its frozen §3 knob table omits `forceAfterMs`. Repair F1 (identity-keyed activity), correct the
README/config drift in F2, and the wave is approvable; F3–F7 are non-blocking polish.
