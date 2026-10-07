<!-- docs-parity: exempt captain cross-check transcript, not a human-facing doc -->
# Captain cross-check: the session-start complexity gate, before vs after

Domain: `gates/complexity-gate`. Author: the captain (MPD main agent). Date: 20261007T103032Z (UTC).

**Why this exists.** The owner's instruction was 「验证当前工作量门」— verify the workload gate. The
formal fix and its negative control belong to Lane C (Junior Engineer) and the independent review to
the Reviewer; this is a CAPTAIN CROSS-CHECK, measured first-hand, of the frozen tip against the
working tree, so the delta does not rest on a single reporter.

**Method.** Both modules are imported raw under `node` type-stripping: the pre-change module is
extracted from git (`git show cae00e5a:packages/mpd-roles-plugin/src/complexity-gate.ts`) into a
temp directory OUTSIDE the repository, the after-image is the working-tree source. The predicate is
called with `{explicitFlag: false, activeBoulder: false}` so only the four soft signals can fire.
Raw transcript: `output.log`.

**Result.** The Chinese instruction the owner actually wrote is `no-fire []` on the frozen tip and
`TRIGGER ["E"]` after the fix; the English soft-complex control keeps `["B","C"]`; the simple
English question and two short-Chinese controls do not fire in EITHER state. Both directions hold, so
the change is not "fires on any Chinese text".

**Bound.** This measures the PURE predicate only. Whether a live session STAGES a shell, and whether a
session already leading a team is spared, are Lane C's live-boot arms and the Reviewer's verdict.
