# Independent verification — `/mpd-codegraph` defect-closure wave

Verifier seat: `reviewer` (session aafdffa3), bound to loop `loop-20261028T094451-dddefe`.
Recorded verdict: **PASS** — `rec-20261028T102333-0045ca` (2026-10-28T10:23:33Z), basis `blind`,
10 gate-evidence logs, 10 cited documents, findings `[]`.
Basis: frozen contract `.mpd/plans/fix-codegraph.md` (sha256 `fd0fa2c7…`, 5977 B, read at
2026-10-28T09:45:02Z), the documentation band (`docs/**`, `.mpd/**`, `evidence/**`,
`agent-references/**`), and measurements I ran myself. Product implementation was not read.

Frozen tree measured: HEAD `046a04baf867d3edf1c0dac089ecf7254404f8d5`, branch
`fix/codegraph-reachability`, tracked tree clean at 2026-10-28T10:13:36Z; four commits
`c3f5b6c0`, `b0a200aa`, `489aad8c`, `046a04ba` on top of `origin/dev` `f5beb1ae`.
Re-checked after my runs (2026-10-28T10:2xZ): tracked tree still clean, HEAD unchanged.

## Assessment

The wave is sound and the three defects are closed by measurement, not narrative. The command that
0.16.1 lost is live on both asserted surfaces on the frozen tree, the QA case now reddens on exactly
that failure and on nothing else, the stale smoke assertion reads the sink and still fails when the
marker is absent, the MCP regression has a named mechanism reproduced in both directions, and the
docs state the measured truth in both languages. Risk level: **LOW**. One process issue (the verify
loop's declared scope omits the shared MCP package where the D-3 fix lives) is recorded as a
condition, not a code defect.

## Measurements I ran myself (frozen tree)

### AC-1 / AC-7 — real isolated mount on the frozen pack

Case: `node skills/dsh-qa/scripts/user-surface-mount.ts --profile <sandbox profile> --evidence <dir>`,
profile = the real dsh-tui profile with `node_modules/@mpd-dsh/mpd` replaced by this tree's
`dist/mpd-package` (codegraph dist sha256 `9da754c4…`, byte-equal to HEAD's committed dist).

- exit **0**; `assertions=119 passed=86 failed=0 findings_or_bounds=33`
- `userSurface.command.mpd-codegraph` → **PASS (gating)** `registry=true paletteCount=1 paletteRows=mpd-codegraph plane=shared plane`
- every other contributed command PASS gating (`ulw`, `ultrawork`, `cellwork`, `agent-teams`, `mpd`, `mpd-model`)
- `userSurface.findings` → `-` (zero findings)
- `userSurface.bundleResolution` → `source=profile … sameCopyDigests=true`
- `probe phase=tick-14 loaderEntries=155 commands=34`; palette pane
  `palette/cmd-mpd-codegraph.pane.txt` draws the row and the executed `/mpd-codegraph`
- 69 row assertions: **no verdict changed** against the pre-fix composition (same names, same ok/null
  shape, identical witness counts `sink 12 / registration 11 / loader-active 10 / disabled 3 / bound 33`)

Artifacts: `evidence/reviews/codegraph-reachability/2026-10-28T10-18-05Z/user-surface-green/`.

### AC-3 — independent negative control

Same pack, ONE file swapped for the pre-fix build from `origin/dev`
(`sha256 8b13219f…`, `var inject = []`), same case, same everything else:

- exit **1**; `assertions=119 passed=85 failed=1`; `FAILED=[userSurface.command.mpd-codegraph]`
- that assertion: `ok=false`, `gating=true`, `registry=false paletteCount=null`
- `userSurface.row.mpd-codegraph` still PASS (the row mounts and its sink is non-empty), `findings -`,
  `commands=33`

So the red is caused by the unreachable command alone, and the false green the contract cites
(`evidence/gates/user-surface/2026-10-28T09-42-52Z/`: `ok:true`, command `ok:null gating:false`,
finding `documented-command-unreachable:mpd-codegraph`) is now a gating FAIL.
Artifacts: `…/2026-10-28T10-18-05Z/user-surface-broken/`.

### AC-8 — gates, run through `mpd_verify_evidence` on the frozen tree

| gate | id | observed |
|---|---|---|
| gates | ev-20261028T101643-febd61 | PASS — **9/9** members green |
| tests | ev-20261028T101650-c5f5e3 | **2658 pass / 6 skip / 0 fail** (2664 across 158 files) |
| typecheck | ev-20261028T101721-e9ad69 | `tsgo --noEmit` exit 0 |
| docs | ev-20261028T101722-1b8237 | pairs=52 failed=0 violations=0 links=471 dead=0 — PASS |
| manifest | ev-20261028T101726-0bd79e | PASS — `npm pack --dry-run` 1087 files, 0 required paths absent |
| comments | ev-20261028T101728-83ac56 | PASS — 479 files / 43586 declarations |
| rows | ev-20261028T101731-b26e2c | 37 row ids match the 2-file layer |
| vendor | ev-20261028T101733-b81ed4 | PASS — 7 shipped assets fingerprinted |
| dist | ev-20261028T101733-09d874 | **34/34 fresh**, pinned bun 1.4.0, 1 declared NOT COVERED (`serve.js`, sha-pinned prebuilt) |
| pack | ev-20261028T101734-294987 | exit 0; closure re-run: **627/627 identical, 0 drift**, 523/524 sources present +1 declared exemption, stamp 2026-10-28T10:17:34.719Z |

Also run by me: `preset-conformance --self-test` PASS (32 harness rows, mpd preset 29 child rows,
parity 27/27, negative controls 4/4 reddened); `user-surface-mount --self-test` **arms=68 failed=0**;
`codegraph-smoke --self-test` exit 0. Vendor re-pin confirmed in the SAME commit as the skills change
(`489aad8c`): skills `treeSha 3b62edda… → 37a7ae10…`, 388 files, exactly one re-pin this wave.

## Findings, ranked

1. **Medium (process, not code) — the verify loop's declared scope omits the package that carries the
   D-3 fix.** `loop-20261028T094451-dddefe` declares
   `packages/{mpd-codegraph,mpd-dsh-adapter,mpd-mcp-codegraph}/`, `skills/dsh-qa/`, `docs/`,
   `package.json` — but the fix lives in `packages/mpd-mcp-shared/bin-resolve.ts` (and its test),
   with `dist/launch.js` of `mpd-mcp-codegraph` as the only emitted byte change. The written
   justification holds on the merits (the tier-ordering predicate the defect is about lives in that
   shared resolver; patching the launcher would leave the predicate wrong for the next consumer), and
   the fan-out is corroborated: `b0a200aa` touches exactly those two mcp packages plus their dist, the
   two rebuilt ast-grep dists are byte-identical and absent from the commit, and `verify-dist-fresh`
   independently proves every committed dist equals a from-src rebuild. **Direction:** amend the loop
   record's scope to include `packages/mpd-mcp-shared/`, or state the delta in the PR body — the
   verdict's envelope should not under-declare what it covered.
2. **Nit (process) — docs scope expanded beyond AC-6's named three pairs.** `046a04ba` also corrects
   `docs/feature-audit.md` and `docs/upstream-parity-ledger.md` (+ zh twins). Both corrections are of
   present-tense claims the wave's own measurement falsifies (`/agent-teams` IS registered today;
   my run shows `registry=true paletteCount=1`), they add no new claim, and they were disclosed.
   Judged acceptable under AC-6's intent; minimal-diff rule still favours the smaller set.
3. **Nit (evidence shape) — AC-4's live artifacts do not pin the case file's bytes.** The recorded
   green/negative-control runs predate the commit that froze `codegraph-smoke.ts`, and neither
   artifact records the sha of the case that ran. Mitigated: I read the committed predicate's exit
   path (`ok=false → process.exit(1)`), ran its offline self-test on the frozen file (PASS, including
   absent/empty/non-initialized sink arms), and the recorded live results are internally consistent
   (green `initSink.chars=205`, tool 502 chars; negative `chars=0`, same tool still succeeds).
   Direction: have the case file its own source hash in `result.json` (a general QA improvement, not
   this wave's blocker).

## Conditions the PR must carry

- **D-3 bound (AC-5).** The end-to-end one-click lane was NOT re-run: it installs the DEFAULT branch,
  which cannot carry an uncommitted fix. The mechanism is settled (red stamps "added 4 packages" vs
  green "added 5"; arms: shim-pinned → 0 tools/timeout, complete pin → `codegraph_explore`; gate
  fall-through → 1 tool; negative control → 0/timeout). The PR must state this bound and that the
  release sweep owes `--mode source --require-docker --no-browser` then
  `--mode oneclick --require-docker --no-browser` (§11), plus the declared follow-up
  (`scripts/install-mcp.ts` `ensureNpmToolchain` verify+retry) which is outside T3's scope.
- **Web plane.** Unmeasured (the case's own `doesNotProve`); the docs now say so. Not a pass, not a
  failure — a stated bound.
- **Scope delta** from finding 1, in the PR body (or the loop record amended).

## Declined to judge

- The Web command surface — not measured by the case; docs now declare it unmeasured. Not graded.
- The AC-2 diagnosis narrative content — `diagnosis.md` was not read (per instruction: only after a
  FAIL); AC-2 is graded from the recorded mechanism (board T1/T4 with symbol references), the fix's
  shape, and the measured before/after + mutation proof.
- Whether the seam-declaration fix is the "best" design versus an adapter-level fix — the contract
  grades the measured effect and the mechanism, not design preference; the chosen fix is plugin-local
  and leaves the adapter untouched.
- The prebuilt `packages/mpd-mcp-codegraph/dist/serve.js` NOT-COVERED entry — declared and sha-pinned,
  outside this wave's scope.
- The Docker lane — not in AC-8, rootless host, and the one-click lane cannot see the fix today.
- The other six commands' "Web + TUI" doc cells — covered by the new scope paragraph declaring Web
  unmeasured; not re-graded per row.
- The `mpd-mcp-shared` change as an out-of-scope WRITE — see finding 1: the justification holds; the
  defect is the loop record's scope declaration, not the change.

## Bounds of this review

- I did not read `packages/*/src` of the product changes, the diagnosis/RCA narratives, or any dist
  content beyond content-free hashes. My basis is the contract, the documentation band, the evidence
  artifacts, and my own runs.
- I re-ran ONE real TUI mount for the fixed tree and ONE for the broken control; one host, one
  architecture, one boot each. Palette evidence is a pane capture, not a pixel diff.
- No live model turn is proven by my AC-1 run (no credential staged; the case's `doesNotProve`).
- I did not re-run the live `codegraph-smoke` lane (credentialed, and AC-8 does not require it); AC-4
  is graded from the committed predicate + self-test + the recorded live/negative artifacts.
- I did not run any Docker lane; no lane was skipped and counted as a pass.
- I did not commit anything; artifacts are untracked under `evidence/reviews/`. The tracked tree
  remained clean before and after my work.

## Verdict

**PASS** — every acceptance criterion is satisfied by a measurement on the frozen tree, the defect
class is closed by a live negative control I reproduced myself, and the remaining gaps are explicit
bounds and one disclosed process condition.
