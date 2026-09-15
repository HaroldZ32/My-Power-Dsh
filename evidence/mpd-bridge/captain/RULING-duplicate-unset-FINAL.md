# Captain ruling (FINAL): duplicate keys — SET updates the LAST, UNSET removes ALL

Recorded at commit time because t39's completion text describes a MID-STATE of the code and terminal
task results are immutable. This note is the authoritative statement of the shipped semantics.

## The rule

| Operation | A path declared more than once | Why |
|---|---|---|
| **SET** | edit the **LAST** occurrence, succeed, and warn with every occurrence line | `JSON.parse` is last-wins (measured), so the last occurrence is the only observable one |
| **UNSET** (direct call or the `DELETE` sentinel) | remove **EVERY** occurrence of that exact path, in one descending-span pass | the file is the DURABLE PROJECTION of the settings layer: after an unset the key must be absent, or an earlier occurrence would stay effective while the settings layer reports it unset — the exact silent divergence this bridge exists to remove |
| **Refusal** | only for unprovable spans and duplicated **INTERMEDIATE** keys (`ambiguous-intermediate`, both directions), unparsable documents, `read-only` targets | those are the cases where the target span cannot be proven |

Measured in the shipped tree: `packages/mpd-config-plugin/src/jsonc-edit.ts:513` `surgicalDelete` splices
every matched span (comment: "CAPTAIN'S DELTA vs the design"), and the suite pins it —
`test/jsonc-edit.test.ts:170` (describe "U6 duplicate keys — the settled ruling: SET updates the LAST,
UNSET removes ALL"), `:203` "unset: EVERY occurrence is removed…", `:216` the `DELETE` sentinel.

## The correction this note makes

t39's completion output records the captain ACCEPTING "delete the LAST occurrence only" for unset — that
was measured against the tree as it stood at that moment (`test/jsonc-edit.test.ts:185` then read
"removing the LAST occurrence, leaving the first readable"). The same task then shipped the delete-ALL
implementation, which the same suite now asserts. **delete-ALL is the FINAL rule and is correct**; the
earlier "inverse of the write" argument only holds if the file's earlier occurrence were an untouchable
user original, which the projection contract explicitly does not grant.

Nothing in the code needs to change. The wave's documentation (task t37) must state THIS table, and the
review (t36) must judge `surgicalDelete` against it.
