# T6 — independent verdict, v0.18.0 upstream adaptation (three planes)

Verifier seat: `reviewer-3` (f49800a4-c8a0-453c-a534-6542cf7592ea)
Loop: `loop-20261107T055457-25618b` (delegate writer `senior-engineer-10`)
Recorded verdict first, from the frozen contract + docs + gate evidence; implementation read only for
diagnosis afterwards (see Bounds).

## Verdict

**FAIL — request changes.** Risk: medium-high. The artefact is close and most requirements hold with real
evidence, but **R6's verification half is unmet**: `compat.hosts` names the 0.18.0/0.19.0 band and **no gate
asserts it**, while a shipped bilingual doc states that a gate does. That is an acceptance criterion whose
proof does not exist, and the repo's own verification law says a claim no check exercises is not a claim.
Two secondary items (the aggregate gate's undisclosed environment prerequisites, and two inaccurate
declared-skip rationales) should be corrected in the same repair.

## R1–R14

| id | result | evidence |
|---|---|---|
| R1 | PASS | carriers at 0.2.2-rc.1 / 0.19.0: `package.json` three experimental deps, `bun.lock` (7 pins), `dsh-distribution.json` `host-tui@0.19.0` + 6 self-URN refs @0.18.0, both `compat.hosts`, docker defaults (4 files), `skills/dsh-qa/scripts` clean of 0.18.0, README version table; `manifest` gate green (ev-…081936) |
| R2 | PASS (with M3) | `engines.node >=24.9.0`; `engines.dsh ">=0.2.1-rc.2 <0.3.0-0"` spans 0.2.1-rc.5 and 0.2.2-rc.1 |
| R3 | PASS (with M2) | mount on 0.2.2 green: `evidence/upstream/0.2.2/2026-11-07T05-45Z/t7-bundle-lifecycle-both-exit.log`; route proven at the consult site from the child session's own `request/header`: `routing/README.md` + `decoded-session-evidence.log` |
| R4 | PASS | 0.2.1-rc.5 mount green, every boot check true, uninstall residue `[]`: same log |
| R5 | PASS | both manifests negotiate `compatible` against 0.19.0: `tui-admission-019.log` (`H.chain:bundle`, `H.chain:package`), 43 arms PASS |
| R6 | **FAIL** | band values correct, but no gate reads `compat.hosts`; see H1 |
| R7 | PASS | gate exists, 11th `verify:gates` member, in `gates.yml` + `publish.yml`, can FAIL — my own run of `--root …/broken` exits 1 naming `id-duplicate` |
| R8 | PASS | `--self-test` 44 arms (1 clean + 43 negative) covering manifest budget, slots/caps, per-locale limits, wants, effects, placements, view budgets, `engines.dsh` |
| R9 | PASS | 3 COMPAT negative arms (v2-only component / data binding / unresolvable view in a DECLARED static view) + `dshgo-view.test.ts` declared-view downgrade tests |
| R10 | PASS | absent kit = exit 3 NOT-PASSED (measured); present kit = exit 0 with `officialExit: 1` and the single `crosscheck-normalized` note; normalisation is narrow and legitimate |
| R11 | PASS | boot arm: a real 0.2.2-rc.1 boot lists `dshGo` in `ADAPTER_SEAMS … ABSENT=`; unit tests: `adapter-dshgo-surface.test.ts` "a bridgeless host registers nothing and reaches no bridge" |
| R12 | PASS | `docs` gate green (ev-…081929); AGENTS.md §2 rule 7 + §4 DSH-Go row present; `verify-manual-paths` exit 0 |
| R13 | PASS | 0.18.0 in `package.json` / `dsh-plugin.json` / `dsh-distribution.json`; `manifest` green |
| R14 | PASS as declared | sweep green in the RECORDED environment (kit + 0.2.2-rc.1 on PATH); skips are listed in `skipped`, never as rows; see M4/M5 for the skip rationales |

## Findings

### H1 (High) — R6's "a GATE asserts it" does not exist
`symptom` `compat.hosts` is correct in both manifests, but nothing in `scripts/`, `skills/dsh-qa/scripts/` or
`packages/*/src/` reads the field (only a stale comment). The only assertion is the TUI host's own
`negotiate`, and CI pins that host to the 0.19.0 coordinate resolved from `dsh-distribution.json`
(`gates.yml`, "Install the dsh-TUI host…"). So the 0.19.0 half is asserted every run and **the 0.18.0 half is
asserted only when the ambient installed host happens to be 0.18.0** (the captain's local run); dropping
`0.18.0` from the band would leave CI green. `docs/compatibility.md` §3 says "Both bands are real claims, and
a gate asserts the band" — the sentence is false.
`expected` A dedicated arm (the plan's "new compat arm") that fails when the band stops covering a declared
host, or two pinned admission runs (0.18.0 and 0.19.0) in the gate.
`doc_source` `.mpd/plans/v0.18.0-upstream-adaptation.md` §3 R6; `docs/compatibility.md` §3.

### M1 (Medium) — `verify:gates`, the manual's "one command", is red by default
My own run: exit 1, "FAIL - 2/11 member gate(s) failed: preset-conformance (exit=1), dshgo (exit=3)"
(`.mpd/verify/evidence/ev-20261107T082012-0de40f.log`). `dshgo` is 3 whenever `MPD_DSHGO_KIT` is unset
(measured: exit 3); `preset-conformance` reddens under the ambient 0.2.1-rc.5 harness. The 11/11 green needed
0.2.2-rc.1 first on PATH **and** a pinned checkout; both are in `result.json`'s environment block but not in
the manual's sentence.
`expected` State the two prerequisites beside "the one command for a patch/preset edit", or make the older-host
and no-kit cases explicit modes.
`doc_source` `AGENTS.md` §4 (gate table + the eleven-member paragraph); plan §3 R14.

### M2 (Medium) — routing claim wider than the proof
`docs/compatibility.md` §2 concludes "The four `agentOptions`-shaped routing sites therefore keep working";
the evidence bounds it to the consult site ("those three were NOT separately exercised live").
`expected` say "one of four sites proven live; three share the same seam" or exercise another site.
`doc_source` `docs/compatibility.md` §2 vs `evidence/upstream/0.2.2/2026-11-07T05-45Z/routing/README.md`.

### M3 (Medium) — `engines.dsh` admits untested harnesses
`>=0.2.1-rc.2` admits 0.2.1-rc.2/3/4, which no arm mounts, while the published matrix declares the minimum
supported as 0.2.1-rc.5. Install-time admission is therefore wider than the measured band.
`expected` floor at `>=0.2.1-rc.5` or name the wider band as tested.
`doc_source` `docs/compatibility.md` §1 table vs `package.json` `engines.dsh`; plan §3 R2.

### M4 (Medium) — credentialed Docker skip is misattributed
`result.json` says the browser/credentialed arm exits 3 "BY DESIGN"; `27-docker.log` records the cause as
`MISSING_CREDENTIAL` (no API key staged) and the arm as `UNMEASURED … MISSING PREREQUISITE`. §11 requires the
credentialed `--mode source --live` run; it is absent from this snapshot.
`expected` record "not run — no credential in this environment"; run it before the release tag.
`doc_source` `AGENTS.md` §11 step 2 (Docker, both runs).

### M5 (Medium) — oneclick skip rationale is wrong
`result.json` says the lane "installs from the published registry"; `scripts/docker-e2e.ts` installs from a
**git spec** and accepts `--spec`, so a pre-merge run against the branch ref was possible. The binding
constraint is the default-branch resolution, not publication.
`expected` state the real constraint and either run `--spec github:…<ref>` or defer explicitly to the release.
`doc_source` `AGENTS.md` §8 (one-command install / Docker proof spec) and §11.

### N1 (Nit) — zero-byte gate log
`39-typecheck-captain.log` is 0 bytes; the claim is independently verified (my typecheck evidence green), but
the log itself carries no result.
### N2 (Nit) — stale shipped comment
`packages/mpd-tui-adapter-plugin/src/index.ts` still says `compat.hosts` is "(0.17.0 since v0.15.5)"; the band
is 0.18.0 + 0.19.0.
### N3 (Nit) — `qa/tui-admission` real case skipped (absent fixture); declared, and covered by the static arm
plus the host chain.

## Declined to judge
- DSH-Go on a real device / Flutter host — none exists here; R8/R9 judge the standard, not pixels.
- PR bilingual body and CodeRabbit round state — no PR at this snapshot; §5 binds at the PR step.
- `VENDOR_LOCK.json` re-pin CONTENT — only that exactly one re-pin exists and `vendor` is green.
- Byte-identity of `specs/dsh-go/` against `ccch1mneyyy/dsh-Go@d5ad25c5` — no checkout/network in this seat.
- Docker image build — I did not re-run any Docker lane.
- `bun.lock` resolution semantics beyond the pins appearing — `--frozen-lockfile` is the evidence.

## Bounds of this review
Read: the frozen plan, `AGENTS.md`, `docs/compatibility.md`, `docs/dsh-go-standard.md`, `docs/tui-admission.md`,
`docs/drive-surface.md`, the wave's gate evidence logs, the three manifests, `scripts/verify-gates.ts`'s
declared-member table, `scripts/docker-e2e.ts` usage text, `gates.yml`, and test arm names. Ran: the DSH-Go
gate (self-test 44/44, no-kit exit 3, broken-root exit 1), `verify-no-host-override` (0), `verify-manual-paths`
(0), and the fixed-table evidence ids docs/comments/rows/vendor/manifest/typecheck/pack/dist/tests (all green)
plus `gates` (exit 1, red — cited above). Did NOT read implementation before recording; did NOT run Docker,
live-LLM or oneclick lanes.
