# NOTES — t3 workmate rename+delete: how to read this evidence

Owner: Senior Engineer (task t3, attempt 1, completed). Contract: `.mpd/plans/workmate-rename-delete-contract.md` (A–M).

## Fastest path

- `20260910T131028Z/result.json` + `output.log` — the authoritative gate sweep on the FINAL bytes.
  Every check is green except `node scripts/verify-vendor.mjs`, and that red is **not this change** (see below).
- `boot-repro.log` — the defect reproduced on a REAL boot (before the fix).
- `20260910T131051Z-boot/boot-probe.log` — the same real boot AFTER the fix: 0 loader-apply errors.
- `gate-sweep.sh` / `boot-probe.sh` / `boot-route-probe.sh` — the executables that produce all of it.

## Gate state in the final sweep, and the one red

Green: `bun test packages` (287 pass / 0 fail), `bun run typecheck`, `bun run test:qa`, the three contract
`verify` commands (workmate.test.ts 4 pass; the verbatim dist rebuild; rename-delete.test.ts 21 pass),
`dsh plugin --profile w add` + `--dump-config` (row composed, path = the rebuilt dist), the REAL boot,
the live read-only in-use probe, and the isolation assertions.

RED — `[verify-vendor] FAIL - asset skills treeSha mismatch`: attribution evidence, all in `output.log`:

- this task's whole delta is `packages/mpd-workmate-plugin/{src,dist}/index.ts`, its tests and
  `evidence/workmate/` — **zero paths under `skills/`**, which is the failing asset;
- `output.log` records the vendor step as green in the 12:52 sweep (`20260910T125201Z`) and red at 13:10;
- the `skills/` writers are the dsh-qa QA-case files, mtimes 13:09:52 (`scripts/readonly-deny.mjs`) and
  13:10:47 (`SKILL.md`), i.e. after the green run, while `VENDOR_LOCK.json` was last written at 12:46:31
  and was never refreshed for them.

So the fix belongs to whoever owns those `skills/` edits (refresh the `skills` treeSha in
`VENDOR_LOCK.json` in the same change, or revert — §9): reported to the captain and to Deep Worker rather
than done here, because `VENDOR_LOCK.json` and `skills/` are other members' files.

## The defect this directory exists for

Deep Worker (t5) found it; I reproduced it before fixing:

```
unsupported JSON schema: schema.properties.archived.type must be a single type string
(type arrays are not supported)  ->  plugin tree failed to load
```

`mpd_workmate_delete` declared `archived: { type: ["string","null"] }`. The harness output-schema
validator accepts a single type per field, so the ENTIRE plugin tree aborted and the whole profile could
not boot — not just the workmate tools. My earlier boot check used `--dump-config`, which only COMPOSES
rows and never applies them, so it passed while the profile was down; `boot-probe.sh` (a real boot) is
the gate that catches this class and it is now part of `gate-sweep.sh`.

Fix: single type at the harness boundary (`archived: ""` with the renderer still saying
"PURGED (permanently removed)"), while the core keeps `archived: null` so contract §D's HTTP wire body is
unchanged. A regression test sweeps every registered output schema for a `type` array and pins both the
tool and wire shapes.

## t12 (P1 repair, same defect): apply proof and the live probe

`20260910T131805Z-t12/` — the t12 evidence set, produced on the fixed bytes:

- `t12.result.json` — all_passed true: src/dist type arrays 0, `archived: { type: "string" }`, and the three
  verify commands exit 0 (`bun test packages/mpd-workmate-plugin/test`, `bun run typecheck`,
  `bun skills/dsh-qa/scripts/readonly-deny.mjs`).
- `apply-boot.log` — fresh-process REAL boot of the full `mpd` profile in an isolated DSH_HOME:
  **0 apply-crash signatures** and the rows' own apply-time log lines present (adapter / bootstrap /
  codegraph). A tree that fails to apply aborts the boot, so the absence of an abort is the mount signal.
- `readonly-deny.log` — the accepted §R1 live proof now **PASSES**: a real, ANSWERING child from a fresh
  process (`spawnDriven: true`, `stubCalls: 4`, "the child was created and answered, with no unknown-tool
  refusal"), with `isolation.realWorkmateUntouched: true`. A child cannot be created by a tree whose apply
  aborted, so this independently confirms the repair.
- Observation for t5/t9, not a t12 criterion: the probe's `reinjectionDiagnostic` reports that re-injecting
  the two dead names still composed a child with NO refusal (`refusalSeen=false`), i.e. the refusal is not
  reproducible in this profile; the positive lane carries the proof, as the probe itself states.

## t12 extension: L1 folded in (one shape) + the MOUNT proof

`20260910T132303Z-mount/` — the mount proof, and it also proves the `oneOf` schema form.

- `mount-proof.result.json` / `mount-proof.log` — a REAL boot of the full `mpd` profile in an isolated
  DSH_HOME with a `--patch` overlay row (`mount-probe.mjs`, the pattern the repo's roles probe uses) as
  registration instrumentation. Verbatim:
  `[mount-probe] WORKMATE_TOOLS_PRESENT=7/7`,
  `[mount-probe] WORKMATE_TOOLS=mpd_workmate_list:ok,…,mpd_workmate_rename:ok,mpd_workmate_delete:ok`,
  `[mount-probe] WORKMATE_LIST_CALL=ok count=0`,
  `[mount-probe] WORKMATE_DELETE_INVALID_NAME=refused msg="mpd_workmate: invalid name \"Alice\" — names are
  ASCII, lowercase, [a-z0-9_-] only and must already be sanitized"`, `apply-crash signatures: 0`.
  So: the whole tree loads AND every workmate tool registers AND the repaired tool answers live.
  No `--dump-config` result is cited as load evidence anywhere in this directory.
- **The `oneOf` form is proven by booting, not assumed** (as §N1 demands): this boot carried
  `archived: { oneOf: [{ type: "string" }, { type: "null" }] }` and produced ZERO apply-crash signatures,
  so only the `type: [...]` ARRAY form is rejected while `oneOf` is accepted.
- **L1 (Architect) is folded in**: the tool now returns the service's `null` verbatim, so the tool, the
  service and the §D HTTP body report ONE shape; the `""` sentinel is gone. A test pins
  `archived.oneOf === [{type:"string"},{type:"null"}]`, `archived.type === undefined`, the tool's `null`,
  the service's `null`, the route's `null`, and the archive path on both surfaces.
- Verify on these bytes: `bun test packages/mpd-workmate-plugin/test` 26 pass / 0 fail (315 assertions),
  `bun run typecheck` clean, `bun skills/dsh-qa/scripts/readonly-deny.mjs` PASS with a live answering child.

Task bookkeeping note: t12 was already terminal when the captain requested this extension, so it could not
be re-claimed (`task status cannot move from "completed" to "claimed"`); the work landed and is reported
here and to the captain rather than under a new attempt.

## t9 review measurement: is the read-only restriction actually ENFORCED?

The shipped QA case asserts that the seven-name list *reached* the harness and that a child answered; it
never asserts that the child was *restricted*. I measured that directly with a reviewer copy of the case
(`probe-enforce.mjs`, byte-identical to `skills/dsh-qa/scripts/readonly-deny.mjs` apart from an absolutely
pinned repo root and stub instrumentation that records the tool NAME SET of every model request), run into
`enforce-probe/run.log`. Result, per stub call:

| lane | call 1 (parent) | **call 3 (the child)** |
|---|---|---|
| shipped (fixed) code | 87 tools, all 7 write-capable present | **81 tools, `writeCapableSeen: []`** |
| pre-fix names re-injected | 87 tools, all 7 present | **87 tools, ALL 7 present (bash, write, edit, …)** |

Conclusions:
- **The read-only guarantee is enforced and now PROVEN**: the child's own request carries none of the seven
  denied names (81 of the parent's 87 tools; the 6-tool delta is the restriction).
- **The failure mode in the sandbox lane is SILENT**: with the pre-fix names re-injected the child is created
  with the FULL write-capable set and no refusal is emitted — so the same defect that the contract describes
  as a loud `names unknown global tool[s]` refusal manifests as complete loss of the restriction here. The
  harness source agrees that both are possible: `dsh-subagent/lib/index.js:711` calls
  `childCtx.tools.restrict(composition.toolFilter)`, and `dsh-tools/lib/index.js:2804` throws only for names
  outside the scope's `restrictableNames`.
- **Pre-fix falsifiability does hold**, by a different route than the refusal: the pre-fix list (5 names) makes
  `filterSent.deny !== EXPECTED_DENY` fail an equality assertion the lane provably reaches (the pre-fix lane
  created a child and sent its filter).

## CORRECTION (t6-F1 / t15): what my mount proof did NOT prove

The mount-proof sentence "one is CALLABLE" was weaker than it read, and no reader should take it as
evidence about the output validator. That probe's tool call was `mpd_workmate_delete {name:"Alice"}` — an
INVALID name, refused BEFORE a value is produced — so `validateJsonSchemaValue` never ran. The tools
therefore passed my probe while the harness output validator rejected every SUCCESSFUL call
(`"value.ok" is not a declared property (additionalProperties: false)`) *after* the mutation had applied.
t6 found it, t15 repaired it. My valid-input measurement of the repaired build, plus the honest record of
my failed falsification attempt, is in `t15-valid-call/NOTES-t3-author-measurement.txt`.

Lesson for the delivery: registration or callability checks do NOT exercise value validation — only a
SUCCESSFUL tool call through the harness pipeline does.

## Known limits of this evidence (not overclaimed)

- `20260910T1302*` / `20260910T130447Z-bootroute/` — the HTTP route-liveness probe is **inconclusive**:
  in the sandboxed boot nothing ever bound the port (`boot-route-diag.txt`: listening sockets = 0) while
  the process stayed alive with 0 loader-apply errors. No live HTTP proof of the new routes is claimed;
  the route surface is proven offline (the full §D status/reason matrix in the package suite) and t6
  should exercise it end-to-end on the real harness.
- `20260910T125201Z/` is the pre-repair sweep. It is kept as the "before" state, but its green result
  must NOT be cited as current: it predates both the schema fix and the `skills/` vendor drift.
