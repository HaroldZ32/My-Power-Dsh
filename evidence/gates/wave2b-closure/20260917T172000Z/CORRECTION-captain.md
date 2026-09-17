# CORRECTION to CLOSURE-TABLE.md's HEADER arithmetic (captain, 2026-09-17T17:2xZ) — the row SET stands, the sentence does not

**The table's 35 rows are CORRECT and stay as they are.** The header's arithmetic sentence is wrong and is replaced below. This
is a nested correction beside the record, never a rewrite of it.

## What the table says, what is true, and the measurement that settles it

| claim | status | measurement |
|---|---|---|
| the table carries **35 rows** | **TRUE** | 35 rows read from the file; the set is the 34 register-backed rolling ids **plus T-93** |
| "53 = 19 closed by wave 2a + **35** rolling into wave 2b" | **FALSE** | `53 = 19 + 34`: the register's own decomposition is 27 originally-planned P2 + T-74/T-87/T-88/T-89/T-90/T-91/T-92 (7) = **34** |
| "35 = the plan §5 item table's **36** ids minus the 19 §8.8 closes" | **FALSE as stated** | §5 minus §8.8 is **34**, because the intersection is EMPTY (0). The 36th id is not removed by §8.8 at all |

## The exact decomposition (§5: 41 rows, 36 distinct base ids)

* **41 rows** in §5's item table, of which **7 are VARIANT rows that fold into their base id**: `T-88 (doctrine)`, `T-79 test`,
  `T-41 (probe)`, `T-69 (lane half)`, `T-77 (driver half)`, `T-80 (arms)`, `T-25 (reader half)`. A filter that matches only a
  bare `| T-nn |` first cell sees 34 rows and **cannot see T-69 at all** — which is how the captain's own first pass over this
  table produced "34" and disagreed with the table's 35.
* **36 distinct base ids** = the **34 register-backed rolling ids** + **T-93** + **T-79**.
  * **T-93** is minted SEPARATELY — plan §1: *"which is minted as T-93 so the register-backed 34 are not re-numbered"* — so it is
    a row of this closure **without** being one of the 34. F7's clause *"T-93 present as its own row"* is exactly that
    distinction, and a table that folded it into the 34 would make the clause vacuous.
  * **T-79** is CLOSED by wave 2a (§8.8, PARTIAL: state half and delivery half landed, mechanism unresolved) and what rolls is
    its **decisive host-restart TEST** (plan §A12) — a TASK, not a register row, which is why the carry-forward mints no id.
* **§5 ∩ §8.8 = ∅**, so no id was double-subtracted; the register tail's `53 = 19 + 34` was right all along.

## The sentence that replaces the header's

> **Arithmetic: `53 = 19` closed by wave 2a `+ 34` register-backed rows rolling into wave 2b. This table carries those 34 rows
> PLUS `T-93` as its own separately-minted row (35 rows total). New rows discovered in wave 2b mint from `T-94`. The two named
> carry-forwards are TASKS, not rows: T-79's decisive host-restart test (plan §A12) and T-19's seeded negative-control lane.**

## Why this correction exists at all

The difference between 34 and 35 was a **filter that could not match its target** (a bare-id regex against a table carrying
`T-69 (lane half)`), and it was caught by disagreeing with a seat's independently assembled artifact rather than by re-reading
the prose. It is the fourth instance of that class in the captain's own hands this session (a piped exit code; a registry grep
whose character class could not span the id's space; a guessed body-slice sha; this one), and it is recorded because the
closure's arithmetic is the one number a later reader will quote without re-deriving.
