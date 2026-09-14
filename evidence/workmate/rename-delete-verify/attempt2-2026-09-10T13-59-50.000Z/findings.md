# t6 — Independent verification, ATTEMPT 2 (re-run on the repaired bytes)

Timestamp dir: `attempt2-2026-09-10T13-59-50.000Z` · Verifier: Reviewer · Attempt `5450fad8-8dba-4006-b740-2bd0a421bbed`

## Verdict: PASS — every acceptance criterion exercised and green

Attempt 1 failed on F1 (both new agent tools rejected by the harness output validator while the
mutation still applied) and F2 (vendor fingerprint). Both were re-measured here **on the repaired
bytes**: F1 is fixed (src declares `ok` in both output schemas, dist rebuilt after src), F2 is green
(vendor PASS, the earlier red was the documented transient lag under §R3 and was withdrawn).

Baseline unchanged by this task: HEAD `f69708809ed63a57461aa6730d297afc09e772a3`, `git status
--porcelain` = 65 entries before **and** after; my only delta is this untracked evidence directory.

## Gates — all exit 0

| gate | exit | evidence |
|---|---|---|
| `bun test packages` | 0 | 293 tests, 290 pass, 3 skip (opt-in comment-checker binary), 0 fail — `gate-bun-test.log` |
| `bun run typecheck` | 0 | `tsgo --noEmit` clean — `gate-typecheck.log` |
| `bun run test:qa` | 0 | all self-tests passed — `gate-test-qa.log` |
| `node scripts/verify-vendor.mjs` | 0 | PASS — `gate-vendor.log` |
| isolated `DSH_HOME` boot (`mpd-headless --dump-config`) | 0 | install exit 0, dump exit 0, `mpd-roles` + `mpd-workmate` + `mpd-hashline` rows present — `boot-check.log`, `dump-config.txt` |

## F1 fix — re-verified independently, three ways

1. **Harness acceptance** (`result-focused2.json`, 21/22): `FIX.rename-tool-output-accepted`,
   `FIX.delete-archive-tool-output-accepted`, `FIX.delete-purge-tool-output-accepted`,
   `FIX.no-invalid-output-error-anywhere`, `FIX.rename-tool-returns-ok-and-name` and
   `FIX.delete-tool-returns-ok-and-purged` all PASS — the exact calls that were rejected in attempt 1.
2. **Tool layer** (`result-tools.json`, 19/19): `tool.rename` → `{ok:true,name:"probe-2",from:"probe-1",renamedFrom:["probe-1"]}`;
   purge → `{ok:true,name:"probe-2",archived:null,purged:true}`; confirm-required still refused.
3. **Routes/lifecycle** (`result.json`, 59/59): the §D matrix is unchanged and still correct
   (200 / 405+`allow: POST` / 400 invalid JSON / 400 invalid-name / 404 unknown / 409 collision /
   409 in-use naming team **and** member / 400 confirm-required), success bodies still carry `ok` per §D.

The single FAIL in the focused lane is `deny.both-dead-names-are-unregistered` — my own deliberately
visible **non-decisive** control (`hasTool` reads the GLOBAL view, which is not the `restrict()` view).
It is recorded as never-a-pass and is not evidence in either direction.

## Read-only fix — §S1 run by t6 on the final bytes (`s1/`)

A copy of the accepted case, retargeted into this evidence directory so its output stays in scope:
`node s1/…` → **exit 0, `ok=true`**, `restrictError=false`, `missingCredential=false`, `stubCalls=4`,
and the enforcement lane proves more than list acceptance:

```
childRequests 1 · parentRequests 3 · childToolCounts [81] · parentToolCount 87
childLeaksWriteCapable []  · childHasStructuredOutput true · parentHasAllSeven true
```

The child's own model requests can see 81 tools while the parent sees 87, and **none** of the seven
write-capable names leak to the child — the read-only authority is enforced, not merely accepted.
The re-injection control stays silent in this profile (`refusalSeen=false`); that is documented as
not reproducible here and was **not** used as evidence in either direction (§S2/§W1).

## Isolation

Every exercise ran with `DSH_HOME` and `HOME` under a `mktemp` sandbox, asserted in the evidence.
The real `~/.mpd/workmate` is byte-identical before/after (`sha ce635a4d…`, 5 files); the real
`~/.dsh` was never written.

## Residual (per §N3, never claimed as passed)

"A spawned read-only child EXECUTES a model turn" needs a real provider credential; none is reachable
in this deployment. The §S1 stub lane proves composition + enforcement, which is the strongest
available statement, and nothing in this report claims the model-turn half.

---

## Addendum — mixed-state hazard caught AFTER the attempt-2 completion (re-verified on the current bytes)

When attempt 2 was finalised, packages/mpd-workmate-plugin/dist/index.js had just been REBUILT at
14:10:18Z — after my F1 measurements (focused2 14:00:28Z, tools 14:05:47Z) and before the completion
landed. That is exactly the mixed state the captain warned about, so every F1-critical reading was
re-taken on the current bytes and the originals preserved for attribution:

- preserved originals: result-focused2-measured-on-1358dist.json,
  result-tools-measured-on-1358dist.json, result-routes-measured-on-1358dist.json
- re-run on the current dist: result-focused2.json 21/22 with ALL SIX FIX.* checks passing
  (FIX.rename-tool-output-accepted, FIX.delete-archive-tool-output-accepted,
  FIX.delete-purge-tool-output-accepted, FIX.no-invalid-output-error-anywhere,
  FIX.rename-tool-returns-ok-and-name, FIX.delete-tool-returns-ok-and-purged); the single FAIL is
  still the documented NON-DECISIVE deny.both-dead-names-are-unregistered global-view control
- result-tools.json re-run on the current dist: 19/19
- verify-routes.mjs re-run on the current dist: 59/59 (summary-routes-current.json)

packages/mpd-workmate-plugin/src/index.ts did NOT move (21:50:45 CST), so the second dist build is a
rebuild of the same source; source and dist agree on the fix markers
(required: ["ok", "name", "from"], 2× ok boolean property, oneOf present for archived).

Fast gates re-run on the current bytes: bun test packages 293 tests / 290 pass / 3 skip / 0 fail;
bun run typecheck exit 0; node scripts/verify-vendor.mjs PASS exit 0; verify-routes.mjs 59/59.

---

## Addendum 2 — provenance of the §S1 runs (which bytes were exercised)

Requested form: record the hash of the file actually run, and characterize any later delta.

RUN 1 (the reading cited in the attempt-2 payload, taken 14:07-14:12Z) exercised the SHIPPED case as it
stood at that moment, WITHOUT the provenance guard that exists now. My copy, which carries only my two
intentional path patches (`repoRoot` literal + `outDir` retargeted into this evidence dir), is:

    sha256 1274e2ec0559d79e0e37e775f7ba361172d3cad90076b9880fd78308994132c1   readonly-deny-s1.mjs

RUN 2 (taken 14:26-14:31Z, on the CURRENT shipped revision) — copy and its source:

    shipped at run: ba6b490813e077609ad426591c751c6f2510728903b46bcecda230d2e05f90a4   skills/dsh-qa/scripts/readonly-deny.mjs
    copy run:       755cb5a1a722839e61c1d9426a62fc76447f885484fbfa052c2b303b551badd2   readonly-deny-s1-current.mjs
    result:         exit 0, PASS — positive lane ok=true; reinjectionControl ok=true with
                    mutationLoaded=true and injectedNamesSeenByAdapter=["str_replace_editor","apply_patch"];
                    childRequestsUnderRestriction=0; isolation ok (realWorkmateUntouched=true)
    logs:           s1-current-run.log, s1-current/<ts>/result.json, s1-current-shipped-hash.txt, s1-current-copy-hash.txt

THE DELTA BETWEEN RUN 1 AND RUN 2 IS **NOT** COMMENT-ONLY. Beyond my two path patches, the current file
adds real control-lane code and tightens an assertion:

- a provenance guard computing `diagSent = steps.reinjectionDiagnostic.filterSent?.deny ?? []` and
  `mutationLoaded = DEAD_NAMES.every((n) => diagSent.includes(n))`, with a block comment explaining that
  without it a control cannot distinguish "the degradation happened" from "the mutation never ran";
- the control's `ok` changed from `diagChild.length === 0 && ...` to
  `mutationLoaded && diagChild.length === 0 && ...`, and two fields were added to the reported object
  (`mutationLoaded`, `injectedNamesSeenByAdapter`);
- the control's `note` text was extended.

So the captain's "comment-only 6daf8884 -> e540d0d9" description is superseded: the file I measured from
is `ba6b4908...` and it carries the provenance guard. Vendor lock refreshed again in the same unit
(lock mtime 22:24:52 CST, skills treeSha c66efeef...); `verify-vendor` exit 0 PASS and the case self-test
reports 23 checks. RUN 2 is the current-revision reading; RUN 1 remains valid for its own bytes.
