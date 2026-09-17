# FIELD-UNITS SWEEP (t36, captain's acceptance item 2) — every published count in the checker's audit block, read against its own label

**Method.** For each count the T-80 audit block publishes, I read the FIELD, its LABEL, the VALUE it
printed in the live record `driver-headers-live-2/result.json` (moment `2026-09-17T14:57:48.822Z`),
and the SUBJECT it actually counts — then either confirmed them consistent, FIXED the number, or
stated the unit in the record's new `audit.units` registry. The registry (12 entries) now travels with
every record, and `audit.moment` carries the moment all the counts were taken.

| # | field | published value | unit the label implies | unit it actually counts | verdict |
|---|---|---|---|---|---|
| 1 | `directories[0].files_scanned` | 54 | files | driver files under the scope | consistent |
| 2 | `per_directory_split["skills/dsh-qa/scripts/"].files` | 46 | files | driver files in that directory | consistent |
| 3 | `…["skills/dsh-qa/scripts/"].key_producers` | 1 | producers (= files) | files producing ≥1 `add("A<n>…")` key | unit stated |
| 4 | `…["skills/dsh-qa/scripts/"].keys` | 9 | keys | distinct A<n> keys produced | consistent |
| 5 | `…["skills/dsh-qa/scripts/"].claims` | 9 | keys | distinct A<n> keys CLAIMED in headers | consistent |
| 6 | `…["skills/dsh-qa/scripts/"].violations` | 0 | keys (ambiguous label) | mismatched KEYS in that directory | unit stated ("KEYS, never files") |
| 7 | `…["skills/dsh-qa/scripts/"].no_claim_set` | 0 | rows (ambiguous label) | driver ROWS whose header claims nothing | unit stated |
| 8 | `per_directory_split["skills/dsh-qa/scripts/lib/"]` (files/key_producers/keys/claims/violations/no_claim_set) | 8 / 1 / 5 / 5 / 0 / 0 | as above | as above | consistent + units stated |
| 9 | `claim_set_parsed` | 2 | claim sets | driver ROWS yielding ≥1 claim (one set per row) | unit stated |
| 10 | `no_claim_set` | 0 | rows | driver ROWS whose header claims nothing | unit stated |
| 11 | `violations` | 0 | keys (ambiguous) | mismatched KEYS, the sum of the per-directory numbers | unit stated |
| 12 | `third_direction.measured` | **2 reference LINE(s) carry 5 A<n> tokens** | reference LINES | reference LINES (sum over rows of their `reference_lines` carrying a token) | **FIXED in t36** — it printed `1 … line(s)` while that 1 counted FILES; the field now also carries `unit:` |
| 13 | `matcher_error_directions[0]` (over-report, naive) | "1 file(s) flagged and 1 key(s) reported as mismatched, against 0 with the precise rule" | files + keys, inline | files + keys | consistent (units inline) |
| 14 | `matcher_error_directions[1]` (under-report, non-recursive) | "1 key producer(s) found against 2" | key producers | files producing keys | consistent (unit inline) |
| 15 | `matcher_error_directions[2]` (under-report, `.js` assumption) | "0 key producer(s) found against 2" | key producers | files producing keys | consistent (unit inline) |
| 16 | `matcher_error_directions[3]` (over-report, whole-repo literal) | "25 key-producing .mjs file(s) repo-wide against 2 in scope" | files | files | consistent (unit inline) |
| 17 | `moment` (new) | `2026-09-17T14:57:48.822Z` | — | the moment every count above was taken | added by this sweep |

**Fields OUTSIDE the audit block, named so the boundary is explicit:** `drivers[]` publishes `keys`,
`claims`, `reference_lines`, `reference_tokens` as LISTS (not counts — a list cannot be mislabelled);
`matches`/`matches_self_reference` in the anchor-scan record publish lists of matches with their paths
and lines; the citation run's counters (`citations_checked`, `symbol_only_anchors_verified`,
`line_dependent_anchors_verified`, `rot_line_number_only_anchors`, `pending`, `illustrative`,
`passed`/`total`) each name their subject in the field name itself (citations / anchors / checks) and
were NOT part of this sweep's scope — the sweep covers the T-80 **audit block** as the acceptance
states.

**Why the registry is the fix rather than a comment:** a reader of ANY future record now finds, beside
the numbers, the sentence that says which subject each one counts — and `audit.moment` says when. That
is the same rule the two nested corrections carry for the two counts that were wrong
(`LINES-COUNT-CORRECTION.md`, `THIRD-DIRECTION-UNIT-CORRECTION.md`): a derived count states its
predicate and unit, or it is not recorded.
