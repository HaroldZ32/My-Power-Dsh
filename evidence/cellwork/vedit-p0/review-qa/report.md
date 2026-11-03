# Review QA — T10's stale `tui-admission` self-test expectation (non-weakening + the minimal manifest)

**Board row:** T11 — Review QA (no verify loop was opened for this QA-suite fix, per the captain)<br>
**Subject:** `skills/dsh-qa/scripts/tui-admission.ts` (+41/−7) at HEAD `d2032bf3`, T10 report
`evidence/dsh-qa/tui-admission-fix-t10/2026-11-03T04-22-14Z/report.md`<br>
**Verdict: PASS for the frozen subject** (the row named the *self-test* expectation, and that is fixed
correctly and without weakening) — **carrying ONE High finding that is the same stale expectation in the
case's OTHER half**, and which must become a follow-up row before anyone treats `tui-admission` as
evidence.<br>
**Risk:** LOW for the diff; **MEDIUM** for the case as a whole (its real mode is deterministically red).

## 1. Assessment

The fix is what the row asked for and it is done honestly. The red was real and its provenance is
recorded: the check asserted the four `session.*.intercept` rows the manifest used to declare, while
`dsh-plugin.json` declares `[]` since `776ac355` (PR #91) — a decision made after a MEASUREMENT, and the
manifest's own `x-mpd-tui-surfaces.decisionEvents` note documents that measurement verbatim ("with the four
`session.*.intercept` permissions the run answered `waiting_authorization / PERMISSION_NOT_GRANTED` … with
the minimal declaration the SAME run answers `compatible`"). The manifest is right, so the TEST was the
stale half, and T10 changed exactly that: `grantRows.length === 4` → `=== 0`, one shared projection
(`grantsOfManifest`) so the shipped read and the control cannot use two parsers, and a new negative control
that re-declares ONE `session.input.intercept` on a `structuredClone` and requires the projection to see it.
That control is genuinely two-sided — I confirmed both directions: the arm is green on the shipped
manifest (my run, exit 0) and red when a permission is re-declared (T10's `negative-control.log`, exit 1),
and the projection is the SAME function `manifestGrantRows()` calls. Nothing else moved: the diff is four
deleted lines, all named; the statement-level `check(` count went 18 → 19; no assertion or control was
dropped; `bun run test:qa` is green (my own run, exit 0) and the case self-test exits 0. The pinned
minimal surface is confirmed independently — `dsh-plugin.json` and `packages/mpd-tui-plugin/dsh-plugin.json`
both declare `permissions: []`, and the hard gate
(`packages/mpd-tui-plugin/test/manifest.test.ts :: "the hard gate: no permission is requested by either
declaration"`) passes 6/6. What I did find is the SAME defect class in the case's live half: the static
grant-table predicate `grants.ok` still requires the pre-decision three-state answer and is now
UNSATISFIABLE, so `node skills/dsh-qa/scripts/tui-admission.ts` (and `--static-only`) exit 1 forever —
measured, not inferred (§3 H1). That is a carry-over, not a regression of this diff, and it is why my
verdict is PASS-with-a-follow-up rather than a clean pass.

## 2. The captain's criteria, one by one

| # | criterion | verdict | observed evidence (mine, unless marked) |
|---|---|---|---|
| a | `dsh-plugin.json` permissions stay `[]`; the manifest hard gate still passes | **PASS** | `node -e` read: bundle `[]`, package `[]`; `bun test packages/mpd-tui-plugin/test/manifest.test.ts` → **6 pass / 0 fail**, including `the hard gate: no permission is requested by either declaration`; no permission re-added anywhere in the diff |
| b | self-test pins the minimal surface (0 rows); grant-writer/ledger arms NON-VACUOUS through the fixture clone | **PASS, one clause overstated (N1)** | `check(grantRows.length === 0, "… must declare NO intercept permission (the seam is inactive by design)…")`; the control is `structuredClone(manifest)` + `permissions.push({name:"session.input.intercept", scope:"tui/transcript"})` asserted through `grantsOfManifest`, the same projection `manifestGrantRows()` uses; T10's `negative-control.log` shows the control reddening (exit 1) with the re-declared row. The ledger reader arm is untouched (`readLedgerRecords` on a 3-line fixture: 1 kept, corrupt + blank skipped) |
| c | no other assertion / negative control weakened or removed | **PASS** | `git diff` 41+/7−: four deleted lines, all named in the T10 report; the moved scope assertion was already vacuous on an empty array (`[].every(...) === true`), so no working gate was lost; no control removed; statement-level `check(` 18 → 19 |
| d | `bun run test:qa` all-green and the case self-test exits 0 | **PASS** | `bun run test:qa` → `[test:qa] all self-tests passed`, exit 0 (`test-qa.log`); `bun skills/dsh-qa/scripts/tui-admission.ts --self-test` → `ok: structural rules, pane classification and spec-root resolution are two-sided`, exit 0 |
| e | only that one `skills/**` file changed; the captain owns the re-pin | **PASS** | `git status --porcelain skills/` → exactly ONE line (`skills/dsh-qa/scripts/tui-admission.ts`); `git status --porcelain VENDOR_LOCK.json` → clean; independent `node scripts/verify-vendor.ts` → exit 1 with **exactly one** failure, `FAIL - asset skills treeSha mismatch`, and every other asset `OK` — which is also the proof that no other vendored asset moved. Not fixed by me, as instructed |

## 3. Findings

**H1 — High — the same stale expectation survives in the case's live/static half, and it is now
UNSATISFIABLE.**
Where: `skills/dsh-qa/scripts/tui-admission.ts` :: the C3' static grant arms (`result.grants`, its `ok`
predicate) and the gate that consumes them, `staticGrantsOk` (used by BOTH `--static-only` and the full
live run).
What I MEASURED (my own run, artefacts preserved in this directory): `bun skills/dsh-qa/scripts/tui-admission.ts --static-only` →
`[tui-admission] static result ok=true` (the host's own admission library loaded, `parse=ok`,
`validatePlugin=ok`), and `[tui-admission] ok=false`, **exit 1**, with the record
`{"rows":[],"ungranted":"compatible","granted":"compatible","wrongScope":"compatible","ok":false}`.
Why it can never pass: the predicate requires `ungranted === "waiting_authorization"` **and**
`wrongScope === "waiting_authorization"`, but a permission-less manifest negotiates `compatible` without a
grant — exactly what the manifest's own `x-mpd-tui-surfaces.decisionEvents` note records as the measured
outcome, and what the run just observed. `grantRows` is now `[]`, so the grant tables are the empty table
three times over; the three-state arm has no subject left.
Why it matters: `tui-admission` can no longer produce a green real-mode record, so its evidence is
permanently red and an operator will either ignore it or be blocked by it. The stale prose is still there
too — the arm's comment says "the manifest's own four rows → `compatible`".
Direction (described, not applied): apply the SAME technique T10 used in the self-test to the live arms —
negotiate a `structuredClone(manifest)` carrying ONE `session.input.intercept` row and assert
none→`waiting_authorization`, its own rows granted→`compatible`, same name at an undeclared scope→
`waiting_authorization`; that restores the arms' discriminating power instead of deleting it. If the
captain prefers to declare the grant tables INAPPLICABLE for a permission-less manifest, then remove them
from the `ok` predicate and state the intended-red decision where `arm3`'s known red is already stated.
Either way: do not leave the case deterministically red and silent about it.

**N1 — Nit — the `tui/<point>` scope assertion is a tautology over a local literal.**
Where: `skills/dsh-qa/scripts/tui-admission.ts` :: `selfTest` (`writerRows` + the `every(row =>
row.scope.startsWith("tui/"))` check).
What: `writerRows` is a two-entry array literal declared three lines above the assertion, so the check
asserts that constants start with `"tui/"` and cannot fail; it exercises no production code.
Why it matters: the T10 report (and criterion (b)) says the scope vocabulary is "proven on declared
FIXTURE rows" — it is not proven, it is restated. The vocabulary's real control is the live arm's
wrong-scope negotiation (`wrongScopeRows` → `waiting_authorization`), which this offline arm cannot reach.
Direction: assert the round-trip through the production writer instead — write `writerRows`, read the
grant file back, and compare `grants[componentId]` rows' `{name, scope}` to what was written (that also
closes N2); or assert on `grantsOfManifest(withIntercept)[0].scope`, which at least crosses a projection.

**N2 — Nit (pre-existing) — the writer shape control never checks the row content.**
Where: same function, the `grantsBlock` assertion.
What: it requires `grants[componentId]` to be an ARRAY; a writer that dropped or mangled `name`/`scope`
still passes. Unchanged by T10, but the writer arm now runs on fixtures, so a content assertion is free.
Direction: one `expect`-style `check` on the first row's `{name, scope}`.

**N3 — Nit — the T10 report overstates one line.**
Where: `evidence/dsh-qa/tui-admission-fix-t10/2026-11-03T04-22-14Z/report.md` §2, last row.
What: "the grant-file writer's document shape and the `tui/<point>` scope vocabulary are now proven on
declared FIXTURE rows" — the shape half is true, the vocabulary half is N1.
Direction: soften to "asserted on fixture rows", or make N1 real.

## 4. Declined to judge (nothing disappears silently)

- **The currently-red `node scripts/verify-vendor.ts`** — DECLINED as a finding: it is the expected consequence of a `skills/**` edit and the captain's single re-pin is the fix (AGENTS.md §9), which the T10 lane correctly did NOT take. I independently confirmed the mismatch is exactly one asset (the skills corpus) and nothing else.
- **The live TUI arms (arm1/arm2/arm3, the real input submit, the revocation re-check)** — NOT RUN: no `@deepseek-harness-tui/dsh-tui` host is installed in this checkout (`node_modules/@deepseek-harness-tui/dsh-tui` absent), so tmux-pane arms are unreachable from this seat. The static admission library still loads from its own resolved root, which is why `--static-only` is observable at all.
- **`arm3`'s documented intentional red** ("this red is … OUR registration/attribution gap … it must stay RED, never be weakened") — an in-file decision, dated and reasoned; not mine to re-litigate.
- **Whether the grant-table arms should exist at all for a permission-less manifest** — that is the captain's product decision; H1 gives both acceptable directions rather than picking one.
- **Reader-facing docs for the TUI admission decision** — docs lane T6/`docs/tui*.md` own that wording; T10 touched no doc and needed none.
- **The `dsh-qa` SKILL.md case table row for `tui-admission`** — unchanged by the diff; the self-test asserts the row still exists (its own `skill` check), and it passes.

## 5. Bounds of this review

- **No live TUI host**, so the pane/ledger/revocation arms were not executed; my real-mode observation is `--static-only` only (which does exercise the host's admission library, the manifest validation and the three grant tables).
- I did NOT read the imported implementation `skills/dsh-qa/scripts/lib/tui-lane.ts` (the bodies of `writeExtensionGrants` / `readLedgerRecords`); I judged the arms by their assertions and by the observed static record.
- **Incident, disclosed:** my two `--static-only` runs each wrote their own `evidence/tui/lanes/<instant>/`; while cleaning the second, a bad "new directory" computation `rm -rf`'d 172 pre-existing directories under `evidence/tui/lanes/`. All **1546** files there are TRACKED and byte-identical to HEAD, and I restored them with the read-only `git archive HEAD -- evidence/tui/lanes | tar -x -C .`; `git status --porcelain evidence/tui/lanes` is now 0 lines. Permanently lost: at least one UNTRACKED directory, `evidence/tui/lanes/2026-11-01T06-42-03.545Z/` (no repo file references it). The files from my own two runs that matter are preserved here; the two run directories themselves are gone, as intended.
- I did not re-run T10's red-first (it needs a `git show HEAD:` scratch copy; their log records it, and the failure text matches the shipped check's old expectation).

## 6. Evidence in this directory

- `static-only-result.json`, `static-only-admission.json`, `static-only-output.log` — my `--static-only` run: `static ok=true`, `grants.rows=[]`, all three negotiations `compatible`, `grants.ok=false`, `ok=false`, exit 1 (the H1 measurement).
- `test-qa.log` — my `bun run test:qa` run: `[test:qa] all self-tests passed`, exit 0.
- The case self-test and the manifest hard gate were run in-session: exit 0 and 6/6 pass respectively.
