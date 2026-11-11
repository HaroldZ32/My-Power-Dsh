# Round 9 bounds — PR #109 CodeRabbit round 2 (M1 Major, M2 Minor, m3–m6 Minor docs)

## M1 — `rebind` runs first, and `unfence` is gated on it

- **Order.** In one `cellwork_dispatch` call the `rebind` half now executes BEFORE the `unfence` half. The
  rebind writes the TEAM `executorRef` and mirrors the handle into the CELL row; the unfence then starts
  from the REBOUND record (`unfenceSeats(caller, current, …)`), so its cleared-row merge is built from the
  row the rebind just wrote and its own `mode`/`fenced` reads see that row. The old order had to run the
  unfence first because its pre-await snapshot would otherwise revert the mirror; passing the rebound
  record removes that need.
- **Gate.** The unfence runs only when (a) the call named no rebind at all, or (b) EVERY `rebind` entry
  answered `rebound:true` AND its CELL mirror was confirmed (the outcome carries no `cellRow`; the journal
  row says `cellRow:"mirrored"`). A failed entry, or a landed entry whose mirror write failed
  (`cellRow:"failed: …"`), WITHHOLDS the whole unfence list of that call.
- **Withholding is whole-call, deliberately.** A combined call is one repair statement for the seats it
  names; if identity could not be proven for one entry the call must not reopen ANY of its fences, or the
  operator's next pass can hand work to a handle the call just failed to prove. This is narrower than the
  old behaviour by design and is stated in the docs (EN + zh) and both READMEs.
- **Answer surface.** `unfenceWithheld: {reason:"rebind-failed"|"cell-mirror-unconfirmed", members,
  failed:[{member, reason, cellRow?}], detail, next}`. `detail` begins `fence stayed closed`; `next` names
  the re-run; `unfenced` is absent. The render prints one `unfence WITHHELD — fence stayed closed …` line
  after the rebind lines (the rebind lines now come first because the rebind runs first).
- **Journal.** One `dispatch-unfence-withheld` row with `reason`, `members`, `failed`, `detail` (contains
  the literal `fence stayed closed`) and `next`. No `member-unfenced`/`member-unfenced-forced` row is
  written for a withheld call.
- **`cellRow` bound.** "Confirmed" means the CELL mirror's `writeCell` returned without throwing — the
  signal the outcome and journal already carry. It is not a third independent read of the CELL file after
  the write; the TEAM write is separately verified by a fresh read-back.

## M2 — a refused rollback keeps the child

- **Choice.** `keepChild = bind.rollback === "failed" || bind.rollback === "refused"` (was: refused AND the
  surviving document names the child or carries no handle). Only a `restored` rollback now releases.
- **Why.** A `refused` rollback proves a concurrent writer committed. That writer's read-modify-write —
  team-core's `cancelTasks` included — may still commit the roster it read WHILE the bind was in flight,
  and that document can name the fresh handle. Releasing on "the document I read now names another handle"
  leaves such a roster pointing at a released child: the dangling handle the contract removes. Absence of
  a pending write cannot be proven from this side.
- **Cost.** A refused rollback now keeps an idle activation until the operator reconciles (the refusal
  carries `orphanChild` + `reconcileRequired` + the `rebind`/`unfence` repair, and the seat is fenced so
  `cellwork_supervise` shows it). The alternative — release, then hope no pending write resurrects the
  handle — is the failure mode being fixed. No release path is lost: `restored` still releases, and a
  pre-write refusal (`rollback` undefined) still releases.
- **Sentence.** The refusal names the pending-write hazard (`cancelTasks`) and says BINDING KEPT.

## m3–m6 (docs only, EN + zh mirrored)

- **m3** — the child release is an ATTEMPT through `dispose()`: a missing or throwing seam is reported,
  never claimed as a release. Updated in `docs/cellwork.md` (two places), `docs/cellwork.zh-CN.md` (two
  places), both package READMEs; the two code sentences that said "exposes no dispose seam" now also name
  the throwing case.
- **m4** — a landed rebind whose CELL mirror fails still answers `rebound:true` but carries
  `cellRow:"failed: …"`; the repair is NOT finished until the operator checks `cellRow` (absence =
  `mirrored`) and re-runs. `rebind` (identity) and `unfence` (fence) are stated as distinct halves; the
  mirror failure also withholds the unfence.
- **m5** — README(s) no longer say the handle MUST be named by a current row: when BOTH current rows name
  no handle, the journal's LATEST hand-over row is the evidence (the docs already stated the precedence;
  the evidence wording is now explicit in all four files).
- **m6** — `previousSessionId`/`previousSessionIdLiveness` is reported WHEN THE TEAM ROW IS READABLE and
  OMITTED when the TEAM record is missing or unreadable.

## Declared bounds / not proven

- The docs changes are wording; they are checked by `verify:docs` (pair, switch link, heading tree, links)
  but no test asserts the English/Chinese sentences themselves.
- The fail-before run installed the round-8 `protocol.ts` (`573c05d6…`) and `protocol-core.ts`
  (`36aec4e6…`) from `../2026-11-11T06-27-13Z/`; the restore was verified with `sha256sum -c`.
- A28's control proves the success path (rebind + unfence in one call, mirror survives the unfence), but
  the arm does not assert the whole `cellwork_dispatch` answer beyond the fields it names.
- The cross-process compare/rename residual (F2), the `cancelTasks` write itself (team-core, out of scope),
  and every round-1..8 bound are unchanged.
- No git write operation was run; the branch HEAD is still `84f6dd47`.
