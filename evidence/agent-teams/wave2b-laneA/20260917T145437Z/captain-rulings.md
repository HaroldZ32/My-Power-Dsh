# t29 — repair r2: the captain's rulings, COPIED INTO THIS ARTIFACT (T-90)

Copied here because **a mailbox record id is not an anchor** (T-90: the artifact is the primary anchor,
the relay is secondary, the id is provenance). Quoted from the captain's message to this seat, read
while present; the bytes below are the ruling as delivered, and the artifact is this copy.

> **MY RULINGS, now in t29's acceptance verbatim — the review asked for two of them explicitly:**
>
> 1. **SCOPE: the ten unimplemented rows are OUT of t29.** They are separate implementation tasks
>    (t27 live; the rest created on each terminal because the platform refuses two live writers over
>    one path set — `inScope overlaps t27`). **t29 closes the SEVEN FINDINGS and nothing else.** This
>    is the DONE-WHEN amendment the old item 1 invited.
> 2. **F3 (T-64) — RULED: EXTEND.** A 2-cycle returning `[]` and reading as ordinary `blocking` is
>    exactly the state the row exists to end, so the PARTIAL escape is REFUSED: extend the reader to
>    cyclic ids and add the seeded cycle arm as the row's red side, reporting the cycle **AS ITSELF, by
>    name**.
> 3. **F4 — store the REVERT-STATE run of the COMMITTED `arm.mjs`** (that driver against the pre-fix
>    bytes) as the red side, and nest the superseded log **beside it, labelled**, naming the assertion
>    it contains that no longer exists in the committed driver. The stale file stays on disk — never
>    deleted, never silently overwritten.
> 4. **F5/F6 — RULED: NAME matching, not length matching, in BOTH fallbacks**, under a **NORMALIZED**
>    comparison (whitespace/case-insensitive) so a reworded-but-recognizable criterion still passes
>    while a **wrong-named entry of the right COUNT fails**. The refusal text must name the near-miss,
>    and a RED arm must prove the wrong-named/right-count case fails.
> 5. **F6 (acceptance side) — the NAME reading, enforced in `acceptanceCovered`** under the same
>    normalized rule; the count-only reading is withdrawn.
> 6. **F7 — the `commandsRun` parameter description names `reported` together with its required
>    `reason` label** (T-84 landed the status; the description never followed it).
>
> **ONE LEDGER TRAP, LIVE ON THIS TASK:** t29's contract was AMENDED by me while it is pending
> (revision 1 → your claim will read the amended text). If you meet `requires passed acceptanceResults
> for every acceptance item` at completion, **echo the LIVE contract's item strings verbatim** — read
> the stored array rather than a template you copied when you claimed — and note it to t30. Do not
> renegotiate the contract from inside the seal.

**Also delivered by the same message, and quoted for the record:** the review's own measurements
(`t19`, `needs_revision`, 7 findings at `evidence/review/wave2b-laneA/20260917T142959Z/`) — "your driver
0 red-side failures · self-fix-tests 109/15 files · plugin package 266/39 files · `--check` 88 regions /
9 files · `verify:docs` PASS with `carried 88/9 vs derived 88/9`" — those readings are the t13-era
revision; the tree has since moved twice (t27 landed 93/10, this repair lands **96/10**), which is
stated in the t29 README rather than inherited.
