# CITATIONS, DURABLE FORM — an audit of MY OWN evidence after lane A's (fair) catch

**Written:** 2026-09-17 · **Reviewer:** code-reviewer · **Why:** my closing message cited lane A's `2b-refinements.md` by LINE (`line 221`, `lines 346–347`) and those lines had already drifted (§4d → line 190, §4g → line 374). They flagged the class rather than the message — and the audit that followed found the same class INSIDE MY OWN sealed evidence, already decayed.

> **READ THIS FIRST.** The audit table below QUOTES pointers that have rotted, because a rot cannot be proved without displaying the form that rotted — so this page necessarily contains copyable pointers, and the only protection is structural rather than editorial. Those columns are **EVIDENCE, never templates**; the citable form for every row is in *The durable forms* section. **A document about pointer drift that hands the reader copyable pointers has only moved the problem.** (Banner added at lane A's suggestion; the table was already labelled below, but the label must be read BEFORE the table.)

## The audit (measured, not theoretical)

Line-number citations of MOVABLE artifacts in my evidence, and whether they still resolve:

| my citation | as written | now | verdict |
|---|---|---|---|
| `.mpd/TODO.md` T-19 rows | `:155` and `:517` | **`:163` and `:525`** | **ROTTED (+8)** — the register was edited after my review |
| `.mpd/plans/friction-p2-wave-captain-log.md` ruling | `:180` | `:180` | still resolves (the log is frozen) |
| `holds-lifecycle.test.ts` tool-name pin | `:372` | `:372` | still resolves; file sha `133f3c6342961c64…` unchanged |

So **2 of 3** movable-artifact citations in my record have already rotted — inside a SEALED `result.json` (`t21`) and my `PRE-REGISTRATION.md`, neither of which may be edited. This page is the durable index beside them.

**READING RULE for the table above (the Architect's catch, applied here):** the "as written" and "now" columns QUOTE rotted pointers because a rot cannot be proved without showing the form that rotted — they are EVIDENCE, never templates. Do not copy anything from those two columns into a new citation; the citable form for every row is in "The durable forms" below (id / heading / assertion text + file + sha). A document about pointer drift that hands the reader copyable pointers has only moved the problem.

## The durable forms (use these, not my line numbers)

* **Register row**: id **`T-19`** in `.mpd/TODO.md` (two occurrences: the original row and the §8.6 wave-2 row), revision I measured for this index: sha256 **`34c7fedcc8ea86fe…`**. A row is addressed by its ID; a section by its heading text.
* **Captain-log ruling**: the paragraph whose first sentence is *"**Ruling: T-19 closes across THREE surfaces, each with exactly one owner.**"* in `.mpd/plans/friction-p2-wave-captain-log.md`, revision **`a7dd677944fd8d92…`** — the SENTENCE is the address, the line is not.
* **Watchdog tool-name pin**: the assertion `expect([...ctx.__stub.tools.keys()].sort()).toEqual(["session-watchdog-hold","session-watchdog-resume","session-watchdog-status"])` in `packages/mpd-team-watchdog-plugin/test/holds-lifecycle.test.ts`, revision **`133f3c6342961c64…`** — the assertion text is the address.
* **Anything I measured in a file I pinned**: the pinned sha is the address; the line number is supporting detail for THAT revision only (e.g. the t21 pin `6021bf6dfce594ed…`, the pin-test revisions `afb3233519db7fac…` / `1145f15bcc52765c…`).

## The rule, adopted for my own pages

Cite a movable artifact by **id / heading / assertion text + file + sha**. A line number is admissible only as supporting detail for a NAMED revision of a file whose hash I state in the same sentence.

**Applied to the page that taught me the rule:** I read lane A's `2b-refinements.md` §4d/§4g at revision **`e7a9586949300f51f67a3540599da59c9036260bcfdef54fc4a250a1e23e13c3`** (37,340 B) — the revision the section ids above refer to — and by the time this page was finished the file had moved **at least six times** (the last I observed: `17920a1a168e9c87…` / 44,742 B). This page therefore records ONLY the revision I read and claims nothing about the current one: an "as of" line is itself a moment, and enumerating the moves only produces a longer stale list. **A reader wanting the current text must re-read the file; the section IDS (§4d, §4g) survive the movement, the shas do not** — which is exactly the difference the rule draws.
