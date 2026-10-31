# Review — the readonly-deny self-test update (T32)

**Task:** board T32 — prove the QA self-test update (T31) is HONEST: the arms were not weakened to pass.
**Basis:** T31's frozen wording (the red arm list) + T32's six numbered items + the shipped rows the case
asserts against. **Reviewer:** R1 `reviewer-cellwork`. **Write scope:** this file ONLY; I edited no case,
SKILL, src or gate. (The scratch artefacts I used were removed after quoting; §7 R9 keeps no runnable copy
in the checkout.)

## Anchors (hash + measurement moment)

| artefact | sha256 | read (UTC) |
|---|---|---|
| `skills/dsh-qa/scripts/readonly-deny.ts` (reviewed) | `dec089ab43e3c08388a16083d1016cda119ac08fdcb28e3ab967e3ab479ae531` | 07:40:39Z |
| `skills/dsh-qa/SKILL.md` (reviewed) | `ffc225d739e1d476b896c995f29c7e2a913a048e4f41763338b37c8306d1dae5` | 07:40:39Z |
| `skills/dsh-qa/scripts/readonly-deny.ts` @ `dev` (baseline for the diff audit) | `ba8d4b76bac7fa1e1f35e34f293016f5c839702ebb84082a08d8ceedfcfa6793` | 07:40:39Z |

Diff scope: 2 files, `+57/−20` — the case script and ONE line of `SKILL.md` (the readonly-deny row).

## Commands actually run (quoted)

```
node skills/dsh-qa/scripts/readonly-deny.ts --self-test
  → exit 0;  [readonly-deny self-test] ok: 53 checks

bun run test:qa
  → exit 0;  55 distinct case scripts invoked;  0 FAIL;  2 SKIP (the two absent-fixture TUI cases:
             tui-distribution, tui-spec-conformance);  [test:qa] all self-tests passed
```

No vendor `treeSha` red appeared at my measurement moment. The two SKIPs are the documented
absent-fixture TUI lanes (`vendor/meta-protocols/dsh-distribution`, `dsh-ecosystem-spec`), unrelated to
this case.

## Item-by-item verdict

### 1) The canonical EIGHT are asserted PRESENT in the applied list — **PASS**
Three unchanged arms pin the declared list to the eight names, by CONTENT and on both the source and the
built row a live boot loads:
`checks.push(["roles src carries exactly the expected eight names", JSON.stringify(srcDeny) === JSON.stringify(EXPECTED_DENY)])`,
`… "roles dist carries exactly the expected eight names" …`, `… "roles src === roles dist (dist is not stale)" …`,
where `EXPECTED_DENY` is the literal eight. The APPLY SITE is pinned to BOTH lists in one call:
`checks.push(["the child's ONE restriction is the canonical eight PLUS the leaf pair (no second layer)", rolesSrc.includes("dsh.restrictAgentToolsRetained(agent, [...READONLY_DENY, ...LEAF_SPAWN_DENY])")])`.
So an apply of ONLY the leaf pair fails the site literal, and an apply of only the eight fails it too.
The strongest part is behavioural and UNCHANGED: the live arm still asserts
`childSpy.length > 0 && parentShowsAllDenied && childSpy.every((c) => c.writeCapableVisible.length === 0)` —
a leaf-pair-only apply would expose the eight to the child and redden this.

### 2) The two leaf names are asserted applied in the SAME retained call — **PASS**
`EXPECTED_LEAF_DENY = ["mpd_role_spawn", "mpd_workmate_spawn"]`; `EXPECTED_CHILD_DENY = [...EXPECTED_DENY, ...EXPECTED_LEAF_DENY]`;
the one-call literal above is the same retained call; and the pair is separately pinned in BOTH rows:
`roles src declares exactly the leaf spawn pair`, `roles dist declares the same leaf spawn pair (dist is not stale)`,
`workmate dist declares the same leaf spawn pair`, `workmate src declares the same leaf spawn pair`.

### 3) The witness count is DERIVED from the list — **PASS**
`const CHILD_SCOPE_RECORD: string = "read-only child: applied " + EXPECTED_CHILD_DENY.length + " denials (+ the leaf spawn boundary) to its own tool scope"`
— the needle's number comes from the concatenated list, never a hard-coded 10. The ROW's own template is
asserted to report the RUNTIME count (`… applied \" + outcome.applied.length + \" denials (+ the leaf spawn boundary) to its own tool scope`),
and the case records `expectedChildDenyList: EXPECTED_CHILD_DENY` in its `result.json` (the evidence names
all ten). A future list change moves the needle with it instead of rotting.

### 4) The OLD "plain `restrictAgentTools(` is GONE" arm still exists and still fails closed — **PASS**
```
checks.push(["the applier passes the canonical list WHOLE and the plain restrictAgentTools call is GONE",
  rolesSrc.includes("dsh.restrictAgentToolsRetained(agent, [...READONLY_DENY, ...LEAF_SPAWN_DENY])")
  && !rolesSrc.includes("dsh.restrictAgentTools(")])
```
The absence literal stops at the paren on purpose (`…Retained(` cannot satisfy `…Tools(`), and the arm
ALSO requires the combined retained call — so a revert to the plain applier, or to a truncated list,
reddens it.

### 5) No arm deleted, no check relaxed — **PASS**
Mechanical diff of the arm inventory (`checks.push` labels) between `dev` and the reviewed file:
**48 → 53** assertions. Exactly ONE label disappeared — `the child-scope sentence the ROW emits reports the
APPLIED count` — and its replacement is 1:1, the same assertion STRICTLY STRONGER (`… reports the APPLIED
count and names the leaf boundary`); that arm encoded the superseded pre-leaf sentence, which is the defect
the contract changes. Five genuinely new arms were added (roles src/dist leaf pair, the combined-call arm,
workmate dist/src leaf pair). Every other arm's body is untouched: the remaining hunks are the header
comment, the two constants, `parseDenyArray`→`parseToolArray` (same regex, parameterized by declaration
name — call sites updated mechanically with the SAME comparison), and `result.json` gaining
`expectedChildDenyList`. Relaxation greps: no `toBeGreaterThan`/`toBeLessThan`/`toBeTruthy`, no
`length >=` assertion added (the case's assertions are boolean `checks.push`; the live pair's comparisons
are unchanged); the eight-name `JSON.stringify` array comparisons are retained; the needle cannot match a
PRE-LEAF row because it requires the literal `" (+ the leaf spawn boundary)"` while a pre-leaf row reads
`read-only child: applied 8 denials to its own tool scope`.

### 6) The live-lane witness quotes the product's line — **PASS**
From `evidence/workmate/roles-readonly/2026-10-31T07-30-40.713Z/result.json`:
`steps.positive.childScope.appliedLine` =
`[2026-10-31T07:30:49.058Z] [mpd-roles] read-only child: applied 10 denials (+ the leaf spawn boundary) to its own tool scope`
(and the same verbatim line under `steps.enforcement.childScopeLine`; the reinjection diagnostic carries the
row's optional suffix: `… to its own tool scope (pruned as unknown in this composition: str_replace_editor, apply_patch)`).
The ROW emits
`"[mpd-roles] read-only child: applied " + outcome.applied.length + " denials (+ the leaf spawn boundary) to its own tool scope"`
plus that optional `" (pruned as unknown in this composition: …)"` append — so the witness MATCHES the
row's sentence exactly (10 = the eight + the pair), including the pruned suffix form. Note: the sibling
`output.log` in that directory is the boot's stdout/stderr only and does NOT carry the row line; the witness
lives in `result.json`'s row-log surfaces, which is the anchor the item names.

## Findings

**None.** No Blocker/High/Medium/Nit on the six items. Two non-issues recorded so nothing is silently
dropped: (a) `SKILL.md`'s prose still says the witness comes from `restrictAgentTools` while the row calls
`restrictAgentToolsRetained` — cosmetic, pre-existing, and the offline arm asserts the real call; (b) the
`dev` baseline copy used for the arm-inventory diff was deleted after its hash was recorded (write-scope
hygiene, not an evidence loss: the numbers are quoted above).

## Verdict

**PASS.** The update encodes the POST-leaf contract without weakening anything: the applied list is
pinned to the canonical eight PLUS the leaf pair in one retained call, the witness count is derived from
the list, the pre-leaf needle cannot match, the plain-call absence arm still fails closed, and the arm
inventory grew 48 → 53 with exactly one superseded arm replaced 1:1 by a strictly stronger form. The
self-test runs green at 53 checks and the QA suite at 55 cases; the recorded live-lane witness quotes the
row's emitted sentence verbatim.

**Bounds:** I did not re-run the live lane (no host checkout/toolchain for the real `mpd_role_spawn` lane);
item 6 is judged from the recorded evidence, which is what the item specifies. I did not run the release
sweep beyond `test:qa`, did not judge the vendor re-pin (the captain's step; no treeSha red observed), and
edited nothing outside this file. The transient `--self-test`/`test:qa` logs and the `dev` baseline copy I
produced were removed after their observed lines and hashes were quoted here, because this task's write
scope is this file ONLY; the captain's own sweep logs in the same directory are untouched.
