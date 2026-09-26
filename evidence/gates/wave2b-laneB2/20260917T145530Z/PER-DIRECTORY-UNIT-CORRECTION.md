# NESTED CORRECTION — the per-directory `keys`/`claims` label overclaimed (t41, closing B2R3-F1 from the t37 review)

`result.json` in this directory is SEALED and is not rewritten. This note sits BESIDE it.

## What was wrong

`audit.units` labelled `per_directory_split[].keys` / `[].claims` as *"distinct A<n> keys
produced/CLAIMED **in that directory**"*, but the computation was `bucket.keys += row.keys.length` — a
**SUM over the directory's files of each file's own distinct count**. The label makes a
DIRECTORY-scoped claim; the code computed a FILE-summed one. On the current corpus the two coincide
(one key-producing file per directory), so the number was never wrong — the LABEL was.

## The falsifying counterexample (seeded — the corpus does not contain this shape)

| seeded shape | summing computation (pre-fix) | distinct ids in that directory (the label's claim) |
|---|---|---|
| **two** files in ONE directory, each producing and claiming `A1`–`A2` (the reviewer's shape) | `keys = 4`, `claims = 4` | `keys = 2`, `claims = 2` |
| **three** files in ONE directory, each producing `A1`–`A2` and claiming `A1`–`A3` (this round's arm — it also falsifies `violations`) | `keys = 6`, `claims = 8`, `violations = 2` | `keys = 2`, `claims = 3`, `violations = 1` |

`key_producers = 3` is correct in both (a FILE count) and is unchanged by this repair.

The three-file shape is shipped as the arm **`t80-directory-scope-dedup`** in
`node scripts/check-citations.mjs --driver-headers --self-test`, which spawns a child over the seeded
directory, reads the child's record and asserts `keys=2 / claims=3 / violations=1 / key_producers=3`
AND that the child exits **1** (the seeded shape carries a real claimed-but-unasserted `A3`). Re-take it
with that one command.

## The fix (the acceptance's first route: DEDUPE at directory scope)

The bucket now carries id SETS — `key_ids`, `claim_ids`, `mismatched_ids` — unioned across the
directory's files, and the record maps them to sizes; the scope-level `violations` is the same union
over rows. The predicates are stated INLINE in `audit.units` (the acceptance's other route — both are
now true):

* `per_directory_split[].keys` — "DISTINCT A<n> key ids produced anywhere in that directory — deduped at
  DIRECTORY scope (the UNION of the directory's files' key ids), never the sum of per-file counts"
* `per_directory_split[].claims` — "… deduped at DIRECTORY scope, never summed per file"
* `per_directory_split[].violations` — "DISTINCT mismatched A<n> key ids in that directory … deduped at
  DIRECTORY scope; never a sum of per-file counts and never a file count"
* `violations` (scope) — "DISTINCT mismatched A<n> key ids across the scope — deduped at SCOPE (the union
  over the scanned rows), never a sum of per-row counts"

## No current corpus number changed (the acceptance's other half)

| reading | before (`bc49d6c7…`) | after (`453d3d7f…`) |
|---|---|---|
| `skills/dsh-qa/scripts/` | files 46, key_producers 1, keys 9, claims 9, violations 0, no_claim_set 0 | **identical** |
| `skills/dsh-qa/scripts/lib/` | files 8, key_producers 1, keys 5, claims 5, violations 0, no_claim_set 0 | **identical** |
| scope `claim_set_parsed` / `violations` | 2 / 0 | 2 / 0 |
| `third_direction.measured` | 2 reference LINEs carry 5 tokens `{A1,A2,A3,A4,A6}` | **identical** |

The reviewer's own pre-fix parser reading is therefore reproduced AFTER the fix: 2 reference lines
carrying `{1,2,3,4,6}`. No number was deleted and no arm was narrowed: the citation `--self-test` is
still **25/25**, and the header-check arm set grew 3 → **4** (3 fixture arms + the seeded counterexample).

## The class requirement (why this is not round 5)

`audit.units_sweep` now travels with every record and SPLITS the verdicts by how they were reached:

* **`seeded_this_round`** — `per_directory_split[].keys`, `per_directory_split[].claims`,
  `per_directory_split[].violations`: each backed by the arm above, so the verdict is FALSIFIABLE by
  re-running one command.
* **`read_and_named_consistent`** — `directories[].files_scanned`, `per_directory_split[].files`,
  `per_directory_split[].key_producers`, `per_directory_split[].no_claim_set`, `claim_set_parsed`,
  `no_claim_set`, `third_direction.measured`, `matcher_error_directions[].measured`: verified by reading
  the label against the code (and, for `third_direction`, against the corpus that falsified its unit in
  t36). These remain ASSERTIONS and are named as such.

Reading labels against code marked these three fields CONSISTENT one round ago; only a seeded shape
falsified them. The split is published so a reader can tell which verdicts could survive a seed.

**Moment:** 2026-09-17T15:09Z (the run set in `evidence/gates/wave2b-laneB2/20260917T150936Z/`).
**Revisions:** `bc49d6c716652038d5418d9795b1b9d6bc96733d83955b96089e430e070a755b` (1257 lines) →
`453d3d7f499fc5660a9dc733584c59033326d5e3ce69e72439ce0da4f217f354` (1307 lines).
