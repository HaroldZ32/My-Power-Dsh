# S1 evidence packet — the review PANEL (`skills/review-work`) + its QA case + the wave's single re-pin

- Wave: `restore-three-capabilities` (contract `.mpd/plans/restore-three-capabilities.md`, stream S1)
- Board task: **T2** (`panel-writer`, kind `work`)
- Writer: the S1 Senior Engineer lane. Verification is a DIFFERENT agent's job (T5, a Reviewer).
- Packet built: 2026-10-08T23:49Z – 2026-10-09T00:05Z (UTC). Raw logs sit beside this file; the
  machine-readable digest is `result.json`.

## 1. What the panel is

`skills/review-work/SKILL.md` now orchestrates **four lanes** — exactly one more than the three roster
reviewers, because the orchestrator's own hands-on QA lane is the fourth:

| # | Lane | Roster role | Lane discipline |
|---|------|-------------|-----------------|
| 1 | Manual QA | — (the orchestrator, in person) | hands-on, never edits |
| 2 | Quality & architecture | Architect | read-only findings |
| 3 | Correctness & risk | Reviewer | read-only findings |
| 4 | Missed context | Explorer | read-only findings |

- **The three reviewer lanes are spawned through the OFFICIAL team path**: `mpd_role_persona` supplies
  the persona TEXT per lane, `spawn_teammate` creates one member per lane whose `description` BEGINS with
  the roster name (that head is the roster provider's whole routing channel, so the member gets its
  `teamModels` slot), and one task per lane lands on the shared board. The skill names the board step but
  deliberately does NOT spell the `team`-prefixed tool names: the retired-spelling rule below forbids that
  prefix anywhere under `skills/review-work/**`, and the case enforces it literally.
- **ONE merge table** (`## The merge table`), declared once and filled in for the report; the report
  template references it rather than re-declaring it, so "one table" is a property the case can assert
  rather than a promise in prose.
- **Verdict tokens**: `PASS` | `FAIL` | `INCONCLUSIVE`.
- **Degrade matrix (written, not implied)** — three rows, each naming what the lane can still reach:
  1. official team tools absent → one-shot `mpd_role_spawn` per lane (roster persona + read-only guard
     still apply) → PASS allowed;
  2. a lane's model slot unresolvable → that lane INCONCLUSIVE, naming member + slot, **never a
     substituted model** → INCONCLUSIVE only;
  3. `mpd-roles-plugin` unmounted → plain `subagent` lanes labelled `panel=advisory` (no persona, no
     read-only guard) → **can never produce a PASS**.
  Plus the cross-cutting rules: silence is not a verdict (one bounded followup, then INCONCLUSIVE), and
  a panel FAIL is BLOCKING only as a BOUND verification seat (`mpd_verify_seat` + `mpd_verify_record`) —
  otherwise ADVISORY, and the report says which.

`skills/review-work/ATTRIBUTION.md` and `LICENSE-NOTICES.md` now state the provenance split: the PANEL is
this repository's own work (MIT, `Copyright (c) 2026 HaroldZ32`), authored from the contract and the
bundle's real surfaces (roster data, roster routing, verification law); the surrounding orchestration
scaffolding stays the re-sourced MIT upstream body. The retired multi-agent lane sections that the tree
still carried were DELETED (by line range, so their bytes were never re-read), and the stale verdict block
is gone.

## 2. Acceptance criteria vs observed evidence

### AC1 — `skills/dsh-qa/scripts/review-panel.ts` exits 0, and its `--self-test` (negative control) exits 0

```
$ node skills/dsh-qa/scripts/review-panel.ts
[review-panel] panel declaration audit
checks: 15  failed: 0
  ok   prose-lane-count — prose declares 4 lane(s)
  ok   panel-lane-table — 1 table(s) carry both 'Roster role' and 'Lane discipline'
  ok   panel-table-count-equals-prose — panel table rows=4 prose=4
  ok   lane-roles-in-ROLES — Architect=in-ROLES Reviewer=in-ROLES Explorer=in-ROLES
  ok   read-only-lanes — 3 lane(s) carry 'read-only findings'
  ok   roster-readonly-per-lane — Architect=roster-readonly Reviewer=findings-only-by-description Explorer=roster-readonly
  ok   merge-table-single — 1 table(s) carry both 'Lane' and 'Verdict'
  ok   merge-table-lanes-match — merge=[Manual QA, Quality & architecture, Correctness & risk, Missed context] panel=[Manual QA, Quality & architecture, Correctness & risk, Missed context]
  ok   merge-table-count-equals-prose — merge rows=4 prose=4
  ok   verdict-tokens — PASS FAIL INCONCLUSIVE all declared
  ok   degrade-matrix — mpd_role_spawn panel=advisory INCONCLUSIVE all written down
  ok   no-stale-all-N-verdict — no hard-coded lane/agent count
  ok   no-retired-spelling — no retired spelling
  ok   tree-no-retired-spelling — 2 file(s) scanned; no retired spelling
  ok   tree-no-stale-all-N-verdict — 2 file(s) scanned; no hard-coded lane/agent count
[review-panel] PASS
[review-panel] evidence -> evidence/restore/s1/2026-10-08T23-49-54-091Z
exit=0
```

```
$ node skills/dsh-qa/scripts/review-panel.ts --self-test
[review-panel self-test] ok: positive control passes all 13 checks
[review-panel self-test] ok: a lane renamed to a non-roster role reddens lane-roles-in-ROLES
[review-panel self-test] ok: a prose count that disagrees with the tables reddens merge-table-count-equals-prose
[review-panel self-test] ok: a merge table missing a lane reddens merge-table-lanes-match
[review-panel self-test] ok: a lane that stops declaring read-only findings reddens read-only-lanes
[review-panel self-test] ok: a second merge table reddens merge-table-single
[review-panel self-test] ok: a missing degrade anchor reddens degrade-matrix
[review-panel self-test] ok: a missing verdict token reddens verdict-tokens
[review-panel self-test] ok: a stale hard-coded lane count reddens no-stale-all-N-verdict
[review-panel self-test] ok: a retired spelling reddens no-retired-spelling
[review-panel self-test] ok: tree scan finds both retired spellings and the stale count, and only in the poisoned file
[review-panel self-test] ok: a clean tree scans clean (negative control holds in both directions)
[review-panel self-test] all arms passed
exit=0
```

Both also exit 0 under the sweep's own runner binary (`bun`), which is what `test:qa` spawns:
`bun skills/dsh-qa/scripts/review-panel.ts` → `exit=0`, and `--self-test` → `exit=0` (log `case-bun.log`).

**Negative control, in both directions, on REAL input (not only on fixtures).** The first real run of
this case, against the real tree before one repair, exited **1** — it caught two merge tables:

```
[review-panel] FAIL: merge-table-single, merge-table-lanes-match, merge-table-count-equals-prose
exit=1     # evidence/restore/s1/2026-10-08T23-47-59-234Z/{result.json,output.log}
```

The repair (the report template now REFERENCES the single merge table instead of re-declaring it) is what
turned the same case green, so the observation discriminates on the shipped artifact rather than only
inside a fixture harness.

### AC2 — every lane role named in the skill is a member of `ROLES` (asserted BY THE CASE)

The assertion is `lane-roles-in-ROLES`, and it is an IMPORT-AND-COMPARE, never a grep: the case does
`import { ROLES } from "../../../packages/mpd-roles-plugin/src/roles.data.ts"` and requires each lane's
`Roster role` cell to be a member by name, and requires exactly three lanes to name one.

```
$ node skills/dsh-qa/scripts/review-panel.ts    # observed line
  ok   lane-roles-in-ROLES — Architect=in-ROLES Reviewer=in-ROLES Explorer=in-ROLES
```

Its negative control (`--self-test` arm 1) renames a lane's role to `Gatekeeper` and requires that SAME
check id to redden — which it does (`Gatekeeper=NOT-IN-ROLES`). Full supporting quotes in
`roles-assertion.log`.

### AC3 — no retired spelling (`team_*`, `.mpd/teams/`) under `skills/review-work/**`

Measured BASELINE, before this lane's first edit — the shipped file was already clean, so the criterion is
a regression lock rather than a repair:

```
$ grep -rnE 'team_[a-zA-Z_]|\.mpd/teams|agent_teams' skills/review-work/
(no output)  exit=1   <- grep exit 1 = no match
```

The case asserts it twice per run: over the document text (`no-retired-spelling`) and over every file in
the directory (`tree-no-retired-spelling`, 2 files scanned). The `--self-test` proves both arms
discriminate: an injected `<prefix>task_create` token and an injected state path in a temp directory are
found and located, while a clean tree scans clean. The forbidden literals are assembled from fragments
inside the case so that the case file itself is not a place to grep one out of.

### AC4 — the stale "ALL 5 lanes" verdict block is gone; prose count == merge-table count

- The stale block was removed with the retired lane sections (deleted by line range on 2026-10-08; three
  matches — two "ALL 5 lanes" and one "ALL 5 agents" — are absent from the tree).
- The case asserts the count three ways: the opening prose sentence (`through exactly four lanes`), the
  panel lane table (4 rows) and the merge table (4 rows). Observed: `prose-lane-count — prose declares 4
  lane(s)`, `panel-table-count-equals-prose — panel table rows=4 prose=4`,
  `merge-table-count-equals-prose — merge rows=4 prose=4`.
- Its negative control (`--self-test` arm 2) bumps the prose to "five" and requires
  `merge-table-count-equals-prose` to redden.

### AC5 — the case is registered where this repository registers QA cases, drift green

Registration is TWO places (the machine registry and the human case table). Verbatim diff of both files
(`registration.diff`):

```diff
diff --git a/skills/dsh-qa/SKILL.md b/skills/dsh-qa/SKILL.md
@@ -93,6 +93,7 @@ corpus and its golden fixtures have been extracted out of this repository.
 | tool-output-validation | plugin tools | ... | C5/C7 |
 | skill-catalog-probe | plan-d install | ... | Plan D |
+| review-panel | review-work skill (S1 restore) | asserts the PANEL DECLARATION as DATA, not by eye: ... | S1/restore |
 | relocate-smoke | plan-d relocate | ... | Plan D/P5 |

diff --git a/skills/dsh-qa/cases.json b/skills/dsh-qa/cases.json
@@ -183,6 +183,14 @@
         "absent-staged-pack"
       ]
     },
+    {
+      "case": "review-panel",
+      "script": "skills/dsh-qa/scripts/review-panel.ts",
+      "suites": [
+        "all"
+      ],
+      "immutabilityGuard": "exempt: no caller-supplied output target — the evidence dir is derived internally from a <utc-stamp> path, so a caller cannot point this lane at an existing directory"
+    },
     {
       "case": "session-start-team",
```

The case carries **no skippable prerequisite**: it either passes or fails, so it belongs in the `all`
suite and cannot silently degrade to a SKIP. The drift gate, verbatim (`drift.log`):

```
$ node scripts/run-qa-lanes.ts --check-drift
[run-qa-lanes] discovery: 43 lane script(s) discovered (43 listed, 0 unlisted, 17 outside every suite); .ts entries 43, underscore-excluded 0
[run-qa-lanes] immutability required=8: team-watchdog-boot, ... exempt=35
[run-qa-lanes] manifest and disk agree (49 entries, 43 lane script(s) discovered) and the immutability guard is declared
exit=0

$ node scripts/run-qa-lanes.ts --list | grep review-panel
review-panel	lane	all	skills/dsh-qa/scripts/review-panel.ts
exit=0
```

## 3. Every gate run, with its observed exit code

| Command | Exit | Log | Note |
|---|---|---|---|
| `node skills/dsh-qa/scripts/review-panel.ts` | **0** | `case-real-node.log` | 15 checks, 0 failed |
| `node skills/dsh-qa/scripts/review-panel.ts --self-test` | **0** | `case-selftest-node.log` | 1 positive control + 10 mutant arms + 2 tree arms |
| `bun skills/dsh-qa/scripts/review-panel.ts` (+ `--self-test`) | **0 / 0** | `case-bun.log` | the runner the sweep uses |
| `node scripts/run-qa-lanes.ts --check-drift` (+ `--list`) | **0** | `drift.log` | manifest and disk agree |
| `node scripts/verify-comment-coverage.ts` | **0** | `comments.log` | `VERDICT: PASS` — 371 files, the new case included |
| `bun run test:qa` | **0** | `test-qa.log` | `[test:qa] all self-tests passed` (43 cases incl. this one) |
| `bun run typecheck` | **1** | `typecheck.log` | NOT this lane's: all 4 errors are in `packages/mpd-mcp-lsp/test/cclsp-config.test.ts` (stream S2, in flight). No error names a file of S1. The same command was exit 0 on the S1 state alone minutes earlier. Re-run at integration. |
| `node scripts/verify-vendor.ts` (BEFORE the wave re-pin) | **1** | `vendor-before-repin.log` | Expected: `asset skills count drifted: 372 vs 371`, `asset skills treeSha mismatch`, `asset packages/mpd-hashline-plugin/src/vendor treeSha mismatch` |
| `node scripts/repin-vendor.ts` (dry run) | **0** | `repin-dryrun.log` | Would re-pin exactly 2 assets: `skills` (S1) and `packages/mpd-hashline-plugin/src/vendor` (S3) |
| `node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step` (THE wave's ONE re-pin) | **0** | `repin-write.log` | `WRITE : linesChanged=3 bytes 4504 -> 4504 (differingBytes=120)` |
| `node scripts/verify-vendor.ts` (AFTER the re-pin) | **0** | `vendor-after-repin.log` | `asset OK` × 7 then `PASS - 7 shipped asset(s) fingerprinted`; zero FAIL lines |
| `node scripts/verify-docs-parity.ts` | **0** | `docs.log` | `pairs=47 failed=0 violations=0 ... dead=0 — PASS` |

## 4. The wave's SINGLE re-pin — DONE, and why it waited

`node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step` ran **exactly once**, at
**2026-10-08T23:51Z**, after board task **T4 (`hashline-writer`) reported `completed` at
2026-10-08T23:49:57Z** — i.e. only once the second invalidated asset had stopped moving.

It was deferred on purpose rather than omitted:

- The wave carries exactly ONE re-pin, and it had to cover TWO invalidated assets: the `skills` corpus
  (this lane, 371 → 372 files) and `packages/mpd-hashline-plugin/src/vendor` (stream S3).
- At the time this packet began, the S3 lane was still writing — the vendor tree's newest mtime kept
  advancing while the first logs were captured (`edits.ts` at 23:47:48Z). Re-pinning then would have
  locked a moving tree, and S3's next write would have invalidated the lock again: exactly the
  "two coupled commits / a second re-pin" failure the one-writer rule exists to prevent.
- The re-pin's OWN dry run was re-taken immediately before the write and still showed the same two
  assets, so nothing else had entered the fingerprint in the meantime (`repin-dryrun.log`).

The lock delta, verbatim (3 lines, `VENDOR_LOCK.json` only — no other file was re-pinned):

```diff
     "skills": {
-      "fileCount": 371,
+      "fileCount": 372,
-      "treeSha": "1169952b376923e25ac078a8dfc530279525c4a4b2aebc960a8c49f832a2c084"
+      "treeSha": "cd15617139d73c35e9758d84cca6b58410e3b2bf3339edd19362a19d7860ceca"
     },
     "packages/mpd-hashline-plugin/src/vendor": {
-      "treeSha": "7c38d4f18e056e2f79eac37908cc6250dd8d917185609b3e7a5b3c13f2be0495",
+      "treeSha": "7e6a28e2b1c6dc9c3942bb17da5cef86ae8398af6ed63bfe3cd128a08701c34a",
     },
```

`node scripts/verify-vendor.ts` after the write: `PASS - 7 shipped asset(s) fingerprinted` (exit 0).

**BOUND, stated rather than implied:** the lock is valid only while BOTH trees are frozen. Any further
`skills/**` edit — including a repair after the verification seat's verdict — invalidates the corpus
treeSha again and re-pins with it; and any further S3 vendor edit invalidates that asset. The S1 lane
holds the write and re-runs `verify:vendor` if either moves.

## 5. Cross-lane observations (outside S1's write scope, reported rather than absorbed)

1. **`bun run typecheck` is RED at packet time**, from `packages/mpd-mcp-lsp/test/cclsp-config.test.ts`
   (stream S2, in flight). S1 did not touch it. It must be green before the wave's gates are read.
2. **The hashline vendor tree was still moving** (stream S3) — see §4. This is the concrete reason the
   single re-pin cannot be taken yet.
3. **Roster data nuance, reported honestly**: `packages/mpd-roles-plugin/src/roles.data.ts` marks
   `Reviewer` with `readonly: false` even though its roster description says "no fixes". Consequence the
   panel lives with: lanes 2 and 4 (Architect, Explorer) are mechanically denied the write tools, while
   lane 3 (Reviewer) is read-only by DISCIPLINE and by its roster description. The case does not paper
   this over — it reports the per-lane property in `roster-readonly-per-lane` on every run
   (`Reviewer=findings-only-by-description`). Changing the roster flag is outside S1's write scope.

## 6. What this packet does NOT prove

- **The panel was never RUN as a live four-lane review.** No `spawn_teammate` round happened in this lane,
  so what is proven is the DECLARATION (counts, roles, merge table, degrade matrix, retired spellings)
  plus the case's own discrimination — not a live panel producing four verdicts. The live flow is
  exercised the first time someone actually runs `review-work` on a real change set (T8's Docker lane is
  the closest scheduled place for the skill to load).
- **The `Reviewer` lane's read-only property is not mechanically enforced** (see §5.3).
- **The re-pin landed, and its validity is conditional** (§4): it holds while the `skills` corpus and the
  S3 vendor tree stay frozen; a post-verdict repair to `skills/**` re-pins with it.
- **`bun run typecheck`** was RED for a reason outside this lane (§5.1); "S1's files typecheck clean" is
  read from the absence of any S1 path in that error list, not from a green exit code of its own.

## 7. Files this lane wrote

- `skills/review-work/SKILL.md` — the panel (rewritten around the panel lanes, the degrade matrix and the
  ONE merge table; the retired lane sections and the stale verdict block removed)
- `skills/review-work/ATTRIBUTION.md` — the provenance split, stated
- `skills/dsh-qa/scripts/review-panel.ts` — the new QA case (15 checks, 11 self-test arms)
- `skills/dsh-qa/cases.json`, `skills/dsh-qa/SKILL.md` — registration
- `LICENSE-NOTICES.md` — the S1 panel paragraph (the S2/S3 sections are handed over separately by their
  writers, as the contract requires)
- `evidence/restore/s1/**` — this packet
- `VENDOR_LOCK.json` — PENDING: one re-pin, once the S3 vendor tree freezes (§4)
