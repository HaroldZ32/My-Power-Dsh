# v0.18.0 — RE-VERIFICATION after repair (seat 2)

- Loop: `loop-20261107T055457-25618b` (frozen contract `.mpd/plans/v0.18.0-upstream-adaptation.md`, sha256 `6e61271b…`)
- Reviewed: branch `feature/upstream-0.18.0`, commit `d65bc680`, PR #103 → `dev`
- Record: `rec-20261107T092205-376636` — **FAIL** (repair task `rep-20261107T092205-00c855`)
- This seat is DIFFERENT from the first verdict (`rec-20261107T082328-68b5c0`). It judged the delta.

## Assessment (one paragraph)

The repair is real where it was mechanical — the COMPAT lane exists, reads `compat.hosts`, runs in every static
pass, fails on an empty band, on band drift and on a band that excludes the distribution coordinate, and its
`BOUND — NOT CHECKED` report is honest (`--static-only` exits 3, never green). The typecheck finding, the stale
comment, the `engines.dsh` floor, the routing-site doc, the documented `verify:gates` invocation and the
oneclick/credential Docker accounting are all genuinely repaired, and I measured the documented bare-run yield
(2/11 red) myself. But the requirement that drove the first FAIL (R6: "a band covering 0.18.0 and 0.19.0, and a
GATE asserts it") is still not met in the environment that gates merges: with the 0.19.0 host CI installs and
0.18.0 deleted from both manifests, the repaired gate reports PASS (48 arms, exit 0). The negative control only
reddens on a machine that happens to have a 0.18.0 host installed. Separately, the commit under review is RED in
CI: the `gates.yml` DSH-Go kit checkout path resolves outside `$GITHUB_WORKSPACE`, so run 42358482313 died before
any gate ran; a fix exists in the working tree but is uncommitted. **Risk level: High.**

## Findings (ranked)

### B1 · Blocker — the reviewed commit cannot run its CI gates

`.github/workflows/gates.yml` at HEAD declares the DSH-Go kit checkout with
`path: ${{ runner.temp }}/dsh-go-kit`; `actions/checkout` refuses a `path:` outside `$GITHUB_WORKSPACE`.
Measured run **42358482313** (headSha `d65bc680`, job "Static gates") failed at step 8
("Check out the pinned DSH-Go kit"); every later step — Static gate aggregate, Plugin manifest, Declaration
comments — was **skipped**. `publish.yml` carries the same step and would die before packing. A local fix
(`path: .dsh-go-kit`, `$GITHUB_WORKSPACE`, `.gitignore` entry) is present in the working tree but **uncommitted**
(`M .github/workflows/gates.yml`, `M .github/workflows/publish.yml`, `M .gitignore`), so the commit under review
is still red and the PR's "therefore runs in CI" is false at this SHA.
**Fix direction:** commit the fix, push, and cite a GREEN `gates.yml` run on the new SHA before merge. The
aggregate's `workflows` member only validates YAML shape and cannot stand in for a real run.
**Doc source:** plan §3 R7; AGENTS.md §4; `evidence/repair/0.18.0/ci/result.json`; gh run 42358482313.

### H1 · High — the COMPAT arm does not assert the 0.18.0 half

In a worktree copy with a 0.19.0 host (the version CI installs from `dsh-distribution.json`) and **both**
manifests cut to `["@deepseek-harness-tui/dsh-tui@0.19.0"]` — 0.18.0 deleted — the repaired gate prints
`COMPAT.band: PASS`, `COMPAT.band-parity: PASS`, `COMPAT.distribution-ref: PASS`, `COMPAT.host-version: PASS`,
`REPORT: PASS — 48 arms passed, 1 allowed deviation(s), 5 bound(s)`, **exit 0**. The repair's break-B control
reddens only because the author's machine discovers an ambient 0.18.0 host: `COMPAT.host-version` compares the
**discovered** version only (`hostVersionArm`), `--static-only` honestly reports BOUND, and nothing static pins
the two-host coverage (no unit test reads the band; CI runs no `bun test`). So deleting `0.18.0` — the exact
consequence the first verdict named — still leaves every CI workflow green.
**Fix direction:** assert the required coverage statically (pinned expected-band constant, or read the docs'
minimum host as data), or install both hosts in CI and run the host arm against each; then correct
`evidence/repair/0.18.0/fixes/README.md` §6 bound 2 ("That is exactly what R6 asked for") and
`docs/compatibility.md` §3's "now ASSERTS that published band".
**Doc source:** plan §3 R6; AGENTS.md §2 rule 7 and §4 ("a support claim no arm checks is not a claim");
`docs/compatibility.md` §3; `evidence/repair/0.18.0/fixes/README.md` §6.
**Bound on the experiment:** the 0.19.0 host was the ambient 0.18.0 payload relabelled in `package.json` (the
only field COMPAT reads); its admission chain still negotiated `compatible`, matching the wave's recorded 0.19.0
result. Not a substitute for a real 0.19.0 install.

### M1 · Medium — the shipped vendor pin is not the one the record shows

`VENDOR_LOCK.json` ships skills `fileCount 392` / `treeSha 3133e6fb…`, but the release row says "after the
wave's single re-pin (04-repin-write.log)", and `04-repin-write.log` records the **superseded** 391-file pin
(`7d1421d8… → 87d34451…`). The 391 → 392 transition (caused by `skills/dsh-qa/scripts/dshgo-standard.ts`
becoming git-tracked; the oneclick detail dates it to 16:42) has **no re-pin transcript**;
`42-vendor-after-repin.log` proves only the post-state. Two re-pins in one wave against §9's "exactly once", and
the second is unrecorded. The second is *mechanically* legitimate — `repin-vendor` enumerates the skills asset
from the **git index** ("file list: git index (391 shipped file(s))"), so staging a new file changes the pin's
subject — but the pin was taken before the corpus was final, which is the process smell.
**Fix direction:** record the final re-pin (or state the transition and why) and point the row at the log that
produced the shipped `treeSha`; stage the whole skills corpus before the single re-pin.
**Doc source:** AGENTS.md §9, §11 step 2; `result.json` verify-vendor row; `04-repin-write.log`, `42-vendor-after-repin.log`.

### M2 · Medium — the PR body still generalises one routing site to four

PR #103 (EN and zh) says "Model selection runs through four `agentOptions` sites, and this PR carries a run that
shows which model actually served the turn". The repaired `docs/compatibility.md` §2 now says **ONE** site was
exercised live and the other three are a declared bound. The human-facing contract was not brought along.
**Doc source:** AGENTS.md §5 ("never a claim the evidence does not carry"); `docs/compatibility.md` §2.

### M3 · Medium — the PR's gate-row summary misstates the one non-PASS row

"21 gate rows, 20 PASS, 1 owned-not-run (credentialed Docker); 1 declared skip" does not reconcile with the
wave's own `result.json`: the single non-PASS row is the **intermediate oneclick run** (`ok=false`,
`pack.staticCoherence`); the credentialed Docker `--live` run is **not a row at all** (it lives in `bounds` as
OWED). 20 PASS + 1 OWED + 1 skip cannot sum to 21.
**Doc source:** `result.json` rows 20–21 and `bounds`; AGENTS.md §5.

### N1 · Nit — the repair bundle commits a 0-byte gate log

`evidence/repair/0.18.0/fixes/typecheck.log` is **0 bytes** — the exact artifact class finding N1 raised. The N1
repair itself IS real: `39-typecheck-captain.log` (454 B) carries argv, tsgo version and exit 0, and the
frozen-table typecheck evidence (125 B, header + `$ tsgo --noEmit`, exit 0) is green. This is committed litter,
not a missing result.
**Doc source:** AGENTS.md §4; `rec-20261107T082328-68b5c0` finding N1.

### N2 · Nit — the manual's instruction-budget margin is 5 bytes

`AGENTS.md` is 63 483 B against the 65 536 cap: 2 053 B of margin, i.e. **5 B** above the declared 2 KB floor
(≤ 63 488 B). It complies; the next edit of any size trips the rule. The wave's own `46-r2-checks.log` records
the same razor margin.
**Doc source:** AGENTS.md §3.

### N3 · Nit — a cleared release blocker still reads as open

`result.json` `bounds` still says the oneclick lane "RAN … and FAILED one packaging assertion … Re-pack and
re-run before the tag", while row 21 records the post-re-pack PASS (`ok=true`, 159 passed / 0 failed,
containerExit 0). The stale text also justifies itself with a branch-not-pushed state that was true at run time
(run 08:59–09:07Z, PR created 09:08:56Z) but is not current.
**Doc source:** AGENTS.md §5; `result.json` bounds + rows 20–21.

## Repairs verified as real

| Item | Verdict |
|---|---|
| M3 `engines.dsh` | `>=0.2.1-rc.5 <0.3.0-0` — matches docs §1; both lines inside |
| N2 stale comment | `packages/mpd-tui-adapter-plugin/src/index.ts`: "the 0.18.0 + 0.19.0 band since v0.18.0" |
| M2 + H1-doc | `docs/compatibility.md`(+zh) §2 names ONE proven site, three unexercised; §3 lists the real arms |
| M1 documented invocation | AGENTS.md §4 + `docs/development.md`(+zh): exact `PATH=… MPD_DSHGO_KIT=…` line, both prerequisites, and the 2/11 measured yield — I reproduced **exactly** `2/11: preset-conformance (exit=1), dshgo (exit=3)` bare, and **11/11** with the inputs |
| M4 Docker | credentialed arm recorded as NOT RUN — NO CREDENTIAL, §11 `--live` runs OWED in `bounds` |
| M5 oneclick | first run **preserved** (`08-45-55Z`, ok=false, only `pack.staticCoherence`) **and** the fixed run exists (`08-59-18Z`, ok=true, 159/0); both committed; pack stamp 08:59:15Z, closure 667/0 |
| N1 typecheck | `39-typecheck-captain.log` non-empty with argv/version/exit 0 |
| `--self-test` | 18/18, four COMPAT controls genuinely red (empty band, parity, distribution ref, host 0.17.0) |
| Gates | `verify:gates` 11/11 (pinned env), `verify:docs` PASS, `verify-manual-paths` PASS, `verify-dist-fresh` 34/34, `verify-pack-closure` 667/0 |

## Declined to judge

1. Credentialed Docker `--live` runs — OWED and declared; no credential in this environment, and the lane is outside my bounds.
2. Flutter / DSH-Go device half — no device; R11's device claim is a declared bound.
3. `qa/tui-admission` absent-fixture skip — declared; the static arm and the host's own chain cover it.
4. The `engines.dsh` span as a publication claim with no arm asserting the span — accepted at the first verdict (R2); the repair changed only the floor, so I did not re-open it.
5. The frozen-table `gates` evidence id being red — that argv is the bare command, the documented default (M1); the env-carrying 11/11 run is the operative measurement.
6. `--manifest` fixture mode printing "the run read 0 manifest(s)" in the band-parity message — cosmetic, in a mode R6 does not use.
7. PR manual-paths counts (69/79) vs my run (70/81) — diagnostics, not audited subjects; the counts moved with the last AGENTS.md edit.
8. The oneclick stand-in spec (`git+file://` instead of `github:`) — at run time the branch was not on origin (PR created 09:08:56Z, after the 08:59–09:07Z run), so the deferral rationale was true then.
9. The dshgo cross-check's normalisation of the official checker's string-only `dsh.bundle.patch` assumption — recorded and reasoned at the first verdict; no delta.
10. LF-normalisation of one skills file during the re-pin — `repin-vendor` behaviour, not drift.

## Bounds of this review

- **Read:** frozen contract; AGENTS.md §3–§5/§9/§11; `docs/compatibility.md` (+zh §3); `docs/development.md` (+zh);
  both TUI manifests; `package.json`; `dsh-distribution.json`; `VENDOR_LOCK.json`; the COMPAT lane, host-version
  arm and host discovery in `scripts/verify-tui-admission.ts`; `gates.yml`/`publish.yml` (HEAD and worktree);
  `evidence/repair/0.18.0/**`; `evidence/release/0.18.0/2026-11-07T06-55-08Z/{result.json,03,04,05,06,38,39,42,46,48}`;
  both oneclick run dirs; the PR #103 body.
- **Did not read:** the full ~300-file diff; the DSH-Go gate implementation; the packer; the Docker scripts; the
  test suite; most zh-CN twins.
- **Did not run:** `bun test packages`, `test:qa`, the docker lanes, any device; no credentialed Docker; no CI
  execution (no push rights) — CI state was read from `gh run 42358482313` and the workflow files. CI state is
  a snapshot: the working-tree fix for B1 may be committed after this report.
- **Did run:** `verify:gates` (pinned env 11/11; bare 2/11), `verify:docs`, `verify-manual-paths`,
  `verify-dist-fresh`, `verify-pack-closure`, the admission gate in normal / `--static-only` / `--self-test`
  modes, and the 0.19.0-host simulation in a `/tmp` worktree copy. The repository was not mutated.

## Verdict

**FAIL — request changes.** The headline repair (H1) is host-dependent rather than requirement-complete, and the
commit under review is red in CI (B1, fix written but uncommitted); both must clear before this wave is merged.
