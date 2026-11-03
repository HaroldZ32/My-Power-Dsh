# Review docs — bilingual accuracy and parity (T7)

**Reviewed work:** T6 (the 10 bilingual files) + T12 (the team-compact README pair fix), owned by `je-docs`.
**Contract:** `.mpd/plans/cellwork-vedit-p0-fix-r2.md` (C1–C5, R8, R9), judged against the landed behaviour
in the frozen contract and the repository documentation band.
**Verdict: PASS — approve.** **Risk level: low.** No Blocker, High or Medium finding; two Nit-level
coverage notes and one declared bound are recorded below.

## 1. Assessment

Every behaviour the frozen contract introduces is now stated, in both languages, where a reader of the
repository would look for it: the mail bound as a workspace knob with its default, `0`-disables rule,
team scoping and the two recovery paths (and no longer "an ACK, not a delivery, releases a slot"); the
compaction barrier returning its promise to the host's serial dispatch, the live-handle engine as the
FIRST resolution with the id-keyed seam only as fallback and NO pre-attempt sleep, the in-place
`promoted` outcome, and the reseed parent order ending in the distinct `reseed-parent-unavailable`; the
non-fatal split `warnings` channel and the frozen contract's scope-extension recovery; the activation
`notice` (kept contracts not rewritten, owner-only dispatch, the stage-4 exception); the adapter's
`compactionEngineForLiveAgent`; and the team-compact pair no longer claiming a single engine site. The
headings, switch links, CJK content and every relative target resolve: the docs gate is green on a doc
set whose fingerprint did not move before, during or after the gate run. No version literal, root
README, CHANGELOG, AGENTS.md or packaging manifest moved.

## 2. Gate evidence

- **docs** — `mpd_verify_evidence {kind:"gate", gate:"docs"}` → `ev-20261103T043005-3706a1`, **exit 0**:
  `pairs=55 failed=0 violations=0 links=500 dead=0 files=131 — PASS`.
- Doc-set fingerprint (sha256 over every `*.md` in the verify-docs discovery band, sorted):
  `a64444f9b757da87d17959223e002220e66971dd6de3ea5dd511a3c64c6a300b` at **04:28:53Z** (H1),
  identical at **04:29:43Z** (50 s settle, H2) and at **04:30:11Z** (after the gate, H3).
  The whole-tree fingerprint moved during the first settle window only because another seat was writing
  QA/docker logs OUTSIDE the docs band; the docs set itself never moved.
- No verify LOOP exists for T7 (`.mpd/verify/loops` carries no loop with `taskId: "T7"` opened today, and
  the captain's T7 message names none), so this written verdict is the record and `mpd_verify_record`
  was not possible; the gate id above is the cited evidence.

## 3. Criteria judged

| # | requirement | verdict | evidence |
|---|---|---|---|
| a | EN and zh-CN BOTH updated; switch links intact; heading tree + real CJK | met | all 6 pairs touched (12 files, +199/−49); every EN file carries `[中文](./<pair>.zh-CN.md)`, every zh file `[English](./<pair>.md)`; the docs gate enforces pair, switch link, heading tree, CJK and link resolution on 131 files / 500 links, 0 dead |
| b | mail prose no longer says an ACK (not a delivery) frees a slot; names `mail.maxUndelivered` (default 8, 0 disables), team scoping, BOTH ack+delivery freeing a slot | met | `docs/mail.md` + zh: "**An acknowledgement frees one slot, and so does a delivery**", knob/default/0-disables/absent-falls-back-to-8, per-recipient-per-team, ONE store path serving both tools, two recovery paths; `docs/cellwork.md` + zh and both README pairs carry the same rule |
| c | cellwork prose: serial await; live-handle engine first; no pre-attempt sleep; in-place promote; reseed parent order + `reseed-parent-unavailable`; split warnings non-fatal + contract recovery; activate notice (kept contracts not rewritten, owner-only dispatch, stage-4 exception) | met | `docs/cellwork.md` §"Compact"/§"Promote or reseed" and the zh twin; the shared mail/bound prose; the tool table rows for `cellwork_split`/`cellwork_activate`; `packages/mpd-cellwork-plugin/README` pair (split warnings, contract recovery line, activate notice, reseed order) |
| d | adapter README names `compactionEngineForLiveAgent` | met | adapter README pair adds `liveAgent`/`liveAgents`, `compactionEngineForAgent`, `compactionEngineForLiveAgent` rows — the live-handle seam described as the barrier's FIRST choice and never the registry |
| e | team-compact pair no longer claims one seam | met | the pair now says the ONE memoized body is the adapter's, reached by the live-handle seam first or the id-keyed seam through the registry, sharing one engine cache; the "in exactly one place: `compactionEngineForAgent`" sentence is gone in both languages |
| f | no version literals / root README / CHANGELOG / AGENTS / package.json moved | met | `git status` shows no version carrier and no root README/CHANGELOG/AGENTS touched; a version-literal grep over the changed docs finds none; T12 touched only the team-compact README pair |
| g | no overclaim beyond the declared bounds | met, with one declared bound | the prose states the reseed fallback and the failure paths ("If there is no safe range, or compaction fails…"), never promises compaction always succeeds, and does not invent an upper config bound (the `0..1000` claim from the lane report is NOT in the docs). Bound: the sentence "the host's serial dispatch AWAITS it" is stated as fact — it is the contract's own C1 host rule (vendored cordis `serial` + the repo's serial-dispatch note), and §8's honest bound (the installed host package is outside this checkout) is not restated in the human docs |

## 4. Findings (non-blocking, ranked)

1. **Nit — `docs/user-guide.md` and its zh twin do not mention the new `create_task` `warning`.** The
   user guide documents `agent_teams_plan` staging, dependency answers and `write_scopes` at length, so a
   captain reading only the guide would not expect the warning (the team-core README pair does state it).
   The frozen contract requires the warning in the TOOL DESCRIPTION (met) and does not require the user
   guide; T6's declared file set did not include it. Direction: a captain ruling on whether the guide's
   `agent_teams_plan` section gets one sentence (docs-only, no behaviour change).
2. **Nit — the reseed-failure suffix is not documented.** Contract C2 keeps appending
   `; the reseed failed: <message>` on a host throw; the human docs describe the parent order and the
   `reseed-parent-unavailable` refusal but not that suffix. It is a journal detail outside T6's listed
   claims; noting it so the omission is a decision, not an accident.
3. **Bound, not a finding — the awaited-promise statement.** See (g): the docs assert the host rule the
   contract itself lays down in C1; the §8 residual (host package not opened in this checkout) stays a
   contract bound. I did not open the installed host package either.

## 5. Declined to judge

- **The `0..1000` ceiling claim from the lane report** — the docs correctly do NOT state it; judged in
  T5 as an unpinned claim, out of docs scope.
- **Bilingual prose style / translation naturalness beyond accuracy** — I checked meaning-bearing
  statements clause by clause where they encode behaviour; I did not grade literary style.
- **Implementation fidelity of every claim** — this review judges the docs against the frozen contract
  and the landed behaviour it describes; it did not re-run the code lanes' tests (T5/T4 did), and the
  docs gate does not execute behaviour.
- **`docs/user-guide*.md`, `docs/handover/**`, CHANGELOG, root README** — untouched by this wave
  (verified); their content is out of T6's scope.
- **Version literals** — none moved (verified); the release lane owns them (contract R8).
- **A live-mount check that the tool descriptions match the docs** — integration scope (T8).

## 6. Bounds of this review

- **Read:** all 12 changed files' diffs and the full changed sections, the frozen contract, and the gate
  log. Did not read implementation source; the docs were judged against the contract's frozen
  statements and the probe I could run (`verify:docs`).
- **Could not run:** `mpd_verify_record` (no T7 loop exists — see §2), a real mount / `preset-conformance`,
  the Docker lane. The review is documentation-only and does not edit code or docs.
- Scope note: R9 was honoured — the only writes were this directory (`review-docs/**`); nothing was
  deleted or moved anywhere.
