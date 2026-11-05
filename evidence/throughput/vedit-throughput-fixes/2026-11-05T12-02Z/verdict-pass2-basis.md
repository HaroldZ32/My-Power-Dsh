# Re-check verdict basis — F1 / F2 / F3 repairs (frozen BEFORE any repair read)

Frozen instant: **2026-11-05T12:17:07Z**
Reviewer: `reviewer-1` (roster Reviewer), task **T10**.
Prior verdict under review: `.mpd/reviews/vedit-throughput-2026-11-05T12-03Z.md` — REQUEST CHANGES (FAIL),
findings F1 (High), F2 (Medium), F3 (Low), F4–F7 non-blocking.

Frozen contract (unchanged, v2): `.mpd/plans/vedit-throughput-fixes.md`. Binding docs: `AGENTS.md`,
`packages/mpd-team-watchdog-plugin/README.md` (+ zh-CN twin), `agent-references/supervision.md`,
`packages/mpd-roles-plugin/README.md`, `packages/mpd-dsh-adapter-plugin/README.md`.

## Reviewed state (pinned by me, not by the builder's report)

- Wave commits: `4a565086` (implementation) → `9c87a4a7` (docs/evidence) → `f383c7ec` (F1/F2/F3 repairs).
- Re-check subject = the delta `9c87a4a7..f383c7ec` **plus** everything it could have regressed in the
  surface the first review covered (`4f102eca..9c87a4a7`).
- Working tree at freeze: clean apart from untracked `evidence/**` directories.

## Scope

Re-judge **F1, F2, F3 only**, plus regressions in the reviewed surface. F4–F7 are NOT re-litigated
unless a repair touched them.

## Pre-committed PASS criteria (written before reading the repair)

### F1 — consult bash exemption must be decided per CHILD (contract §D2.6)

§D2.6 says: "if the child's CURRENT tool call is `bash` and still in flight → DO NOT interrupt …
otherwise → … interrupt the child". The subject of the decision is **the child**, not its role.

A PASS requires ALL of:

1. The activity the deadman consults is addressed by **child identity** — the `DshAsyncAgent.id` the
   adapter seam returned, or the child's session id — and TWO children of the SAME role therefore
   occupy TWO independent activity slots.
2. `onDeadman` (or its successor) resolves the exemption from the record's OWN child identity. If the
   lookup key is still `record.role` (or any string derived from the role / delegation label), it is a
   FAIL regardless of any documentation, because two concurrent same-role consults then share one slot
   and a sibling's tool start/end overwrites the other's `current`.
3. Tool start/end attribution cannot let a SIBLING's `end` clear a child's still-OPEN `bash`
   (`noteToolEnd` must be matched per child, e.g. by `(child, tool)` rather than a shared `current`).
4. The ROLE LABEL survives only as a DISPLAY fallback (activity text / last-observed string). A label
   used as a decision key, or as the sole activity address, is a FAIL.
5. The BLOCKING path (`mpd_role_spawn`) passes the child identity too — §D2.2 re-expresses it on the
   async seam, so both paths must share the same per-child supervision; a blocking consult that still
   records activity under a role label is the same defect.
6. A **behavioural test** exists that would REDDEN on the label-keyed design: two concurrent consults
   of the SAME role, one wedged with an open `bash`, one not — asserting the bash holder is NOT
   interrupted and the other IS. A test that only exercises one child, or two children of DIFFERENT
   roles, does not discriminate and does not satisfy the finding.
7. If the harness hook genuinely cannot attribute a tool call to a child session, the repair must SAY
   SO and provide a per-child channel the adapter itself owns; an unexplained fallback to the label is
   a FAIL.

### F2 — watchdog documentation and the `forceAfterMs` front doors (contract §D3.2/§D3.6)

A PASS requires ALL of:

1. The three NOT-CLAIMED bullets in `packages/mpd-team-watchdog-plugin/README.md` no longer assert the
   pre-D3 posture: (a) no wedge detection inside a hanging tool, (b) an in-flight turn is never
   aborted, (c) no team mutation by construction. Each must either be DELETED or rewritten to the true
   residual — the honest residual being that mutation happens through team-core's published action
   service with the recorded lead session, never by the watchdog writing the team record itself.
2. `forceAfterMs` appears in that README's knob table (the frozen §3 table), described as read live
   per tick with `0` disabling the rule (§D3.6).
3. `forceAfterMs` reaches at least one FRONT DOOR — `cordis.patch.yml` watchdog row config, or the
   `mpd-config` `SettingsSchema` + `FIELDS` — **or** the README states a NAMED residual with a reason
   for its absence. An unnamed absence is a FAIL; a named, reasoned residual is a PASS on this item.
4. The `*.zh-CN.md` twin carries the same three corrected bullets and the same knob row (bilingual rule,
   `AGENTS.md` language policy), and `verify:docs` is green.
5. No other doc in the band still contradicts the D3 posture in a way the repair introduced.

### F3 — an open bash with NO start stamp still exempts (contract §D3.3)

A PASS requires ALL of:

1. The exemption is decided from the in-flight TOOL NAME (`bash`), not from the presence of a numeric
   `inFlightSince` stamp: a member whose in-flight bash carries no stamp is still EXEMPT.
2. `inFlightMs` in that case is computed from `now` (0 or a positive elapsed), never `NaN`/`undefined`,
   and the `long-bash` incident it can emit names a finite elapsed.
3. The A/B of §D3.3 is preserved: while bash is open there is NO age bound; the ONE `long-bash`
   incident is recorded at the `forceAfterMs` boundary and the member is re-evaluated after the call
   returns.
4. A test covers the stamp-less case.

## Regression surface (bounded to what the repairs touch)

- Tool-surface pins (roles/workmate/cellwork) — the LOCKED tool lists must still be asserted, not relaxed.
- Read-only deny parity: **10** names in both `mpd-roles-plugin` and `mpd-workmate-plugin`; leaf deny
  **4** names; cellwork verifier posture intact (§D2.7) — unchanged by this repair.
- D1 re-team settlement, D3 force action wiring, D0 shared-base coverage: no behavioural change unless
  a repair touched it, in which case the §D1/§D3/§D0 clauses are re-read against it.
- **Test integrity**: no gate weakened, no test edited to make a change pass, no assertion deleted
  without a replacement. A relaxed pin is a FAIL even if every gate is green.

## Evidence the verdict must carry

Gates re-run at the reviewed state, cited by `mpd_verify_evidence` id: `tests` (package suites the
repair touches: watchdog, team-core, roles/workmate), `typecheck`, `comments`, `rows`, `docs` (a README
changed), `preset-conformance` (only if a patch row changed), `dist` (to establish the dist bound).

**Dist bound, pre-committed:** `packages/*/dist/**` is the integration owner's scope (§Cross-cutting
rules) and the captain rebuilds it after the repairs. Behaviour is therefore verified against `src/`
through the tests that import `src/` directly; if any judged behaviour depends on the COMMITTED dist I
must either verify against a rebuild or state the bound explicitly. I will not write outside
`.mpd/reviews/**`, so a rebuild by me is not available — the bound is stated instead.

## Verdict rules

- PASS requires: this contract clause cited per finding + at least one gate evidence id + the frozen
  docs. FAIL requires per finding: severity, symptom, expected behaviour, doc source.
- I do not fix anything. I write only inside `.mpd/reviews/**`.
- Citation by path + symbol, never by line number (`AGENTS.md` §12, T-55).
