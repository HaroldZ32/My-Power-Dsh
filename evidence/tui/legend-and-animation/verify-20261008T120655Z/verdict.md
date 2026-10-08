# VERDICT — the DAG legend wording, and the animation that dragged the box border

**Verifier:** an independent agent (Reviewer seat), NOT the writer, NOT bound to a verification loop.
**Verdict recorded at:** 2026-10-08T12:14Z.
**Artifact root:** `evidence/tui/legend-and-animation/verify-20261008T120655Z/`
**Frozen contract judged:** `.mpd/plans/tui-legend-and-animation-fix.md` (sha256 `6ed1e953…012938`).
**Subject:** `packages/mpd-tui-plugin` — `src/panel-core.ts`, `src/dag-theme.ts`, `src/subagent-scene.ts`,
`test/panel-legend-mount.test.ts`, `test/scene-visuals.test.ts`.

---

## VERDICT: **PASS** — both defects, by measurement; and the box bound is **CLOSED**, not restated.

A PASS resting on my own assertions would be worthless, so every claim below is a **measurement with a
falsifier**. The strongest single piece of evidence in this artifact is the **negative control (§3.3)**:
the pre-fix orbit was transplanted into a copy of the shipped tree and **the same harness reported the
user's exact defect** (the node box's right border walked `10 → 11 → 10 → 12`). The harness can fail, and
the shipped code passes it.

### The revision is settled — hash sandwich, start == end

| file | sha256 (read 12:07:00Z AND 12:11:32Z — identical) |
|---|---|
| `src/panel-core.ts` | `cc8bef85a8810c3cec2aa617335f763c07186f2a5e5e853a744d26769310ce2f` |
| `src/dag-theme.ts` | `eee4848cc0b0c845a4e4252793f91a70e652b185fc15bd594de960856b597616` |
| `src/subagent-scene.ts` | `5350459d347701c4123d4ab241e3c3f52893485b289728962cdbdfdc327b1f40` |
| `test/panel-legend-mount.test.ts` | `b69dea39b268a74dcb19d46baf1689d1bdbc2ddb4f52c84aa3ba4e875e15d817` |
| `test/scene-visuals.test.ts` | `9a5e500fd1bd8a4e4f1e97bfd5de29e0e9c50071b27486bfd8345ff0a9316bda` |

The wave is **uncommitted** against `HEAD = 20f312636b1f6fcdb43441d785494d98c3b8df08`; that is what
let me construct the pre-fix subject without touching a product file. No product file was modified by
this verification (`git status --short` tracked-modified set is unchanged: `00-git-tracked-modified.txt`).

---

## 1. DEFECT A — the legend, DRIVEN and printed verbatim

**Harness:** `harness/measure-legend.ts` — imports and CALLS the shipped `legendLinesFor`.
**Command:** `.toolchain/node_modules/.bin/bun evidence/tui/legend-and-animation/verify-20261008T120655Z/harness/measure-legend.ts`
**Raw output:** `01-legend.txt` — **exit 0**.

### The drawn line, verbatim (156 and 100 columns, one line, 65 cells)

```
✓ completed · ◐ running · ○ open/blocked · ✗ failed · ⊘ cancelled
```

At 60 columns it **wraps rather than shrinks** (two lines, 51 + 11 cells):

```
✓ completed · ◐ running · ○ open/blocked · ✗ failed
⊘ cancelled
```

The user's reported `○ open=blocked · ○ blocked=open` is **gone**; the two states now share ONE entry
`○ open/blocked` and **no `=` appears anywhere**.

### The six §1 conditions, judged on the drawn string (all PASS at 156/100/60)

| # | Contract condition | Measured result |
|---|---|---|
| 1.1 | exactly ONE `○` entry naming BOTH `open` and `blocked` | `entries starting "○ " = ["○ open/blocked"]` — exactly 1, names both |
| 1.2 | no `=` anywhere; no two entries state one fact | `no "=" anywhere` PASS **and** `marks = ["✓","◐","○","✗","⊘"]` — 5 entries, 5 DISTINCT marks |
| 1.3 | `○` still the mark; `DAG_TONE_GLYPH` NOT changed | `GLYPH.open="○" GLYPH.blocked="○"`; table in `DAG_STATE_TONES` order `["✓","◐","○","✗","○","⊘"]` — equals the contract's frozen table |
| 1.4 | the four distinct states keep one entry each | `completed`/`running`/`failed`/`cancelled` each name exactly 1 entry, at every width |
| 1.5 | widest wording + WRAP-NOT-SHRINK survive | every line `≤ cols`; all six states present as whole words even at 60; entries never dropped at these widths |
| 1.6 | every entry interpolated FROM the contract | every drawn mark is a value OF the frozen table; set equality with the table's distinct values |

`DAG_TONE_GLYPH`'s literal is untouched by the wave — the **only** diff line mentioning it is
`+const RUNNING_FRAMES: readonly string[] = Object.freeze([DAG_TONE_GLYPH.running ?? "◐", "◓", "◑", "◒"])`,
which *reads* it. Contract §3's "do not change `DAG_TONE_GLYPH`" holds.

### 1.1 FALSIFICATION — is the rule an accident of this one pair? (attempted, and it HELD)

Rather than confirm, I broke the argument's premise: I copied the shipped `src/` tree and mutated **one
literal of the glyph table** in the copy (no product file written), then drove the **real composer
function body** against the mutated contract.

| mutant | glyph table | drawn key |
|---|---|---|
| 1 — three carriers of one mark | `cancelled:"○"` too | `✓ completed · ◐ running · ○ open/blocked/cancelled · ✗ failed` |
| 2 — TWO shared marks at once | `cancelled:"✗"` | `✓ completed · ◐ running · ○ open/blocked · ✗ failed/cancelled` |

Both held: **one entry per mark, every carrier named, no `=`**, and the four/three other states kept one
entry each. The rule is **general, not special-cased to the `open`/`blocked` pair** — it is driven by
glyph equality over the contract's own table, and no state name is spelled in the composer.

**What this falsification does NOT show (stated, not glossed):** both mutants change the glyph **data**,
not the grouping **algorithm**; and neither exercises a state whose glyph is missing (`?? "?"`), where two
states would be grouped under `?`. I did not falsify the rule; I also did not exhaust the space in which
it could break.

---

## 2. DEFECT B — the running mark's cell width, EVERY phase, over FOUR cycles

**Harness:** `harness/measure-frames.ts`.
**Raw output:** `02-frames.txt` — **exit 0**.

Phases 0..15 (4 full cycles of 4), every one measured:

```
phase | slot | frame | cellWidth | utf16 | codepoints | graphemes | codePoints
    0 |    0 | ◐     |         1 |     1 |          1 |         1 | U+25D0
    1 |    1 | ◓     |         1 |     1 |          1 |         1 | U+25D3
    2 |    2 | ◑     |         1 |     1 |          1 |         1 | U+25D1
    3 |    3 | ◒     |         1 |     1 |          1 |         1 | U+25D2
   …   |  (0..3 repeating for phases 4..15 — periodic, identical every cycle)
```

- **Every one of 16 phases is EXACTLY one cell** (`widths observed = [1]`). Cross-checked with
  primitives that are NOT the package's own: `String.length` = 1, code points = 1, and an
  `Intl.Segmenter` grapheme count = 1. The claim does not rest on `cellWidth` alone.

**(a) The frames DIFFER — the animation is KEPT.**
`distinct frames = ["◐","◓","◑","◒"] (count 4)` equals `DAG_ANIM.frames = 4`; the orbit is periodic
(`phase0 == phase+4`). A static mark would satisfy the width and violate the ruling — it is not static.

**(b) No frame collides with a glyph another state owns.**
Marks owned by the other states, **read out of the frozen table at run time**: `["✓","○","✗","⊘"]`.
Forbidden set also includes `" "`, `"."`, `"·"`, `""`. Each of the four frames reports
`collides-with-another-state=false`.

**(c) The frame at the contract's `staticPhase` IS the contract's own `running` glyph.**
`runningGlyph(DAG_ANIM.staticPhase = 0) = "◐"` and `DAG_TONE_GLYPH.running = "◐"` — **equal**. A host with
no animation timer draws exactly that, and the legend names that same mark (`◐ running`), so the degraded
drawing and the key agree.

**Degradation (§2.5), all one cell:** `NaN→"◐"`, `+Inf→"◐"`, `-Inf→"◐"`, `-1→"◒"`, `-3→"◓"`, `3.7→"◒"`,
`1e9→"◐"`. Non-finite phases degrade to the contract's glyph rather than throwing.

**One table, two surfaces:** `subagent-scene`'s `RUNNING_FRAMES` is the **same reference** as
`DAG_ANIM.runningFrames` (identity `true`), all one cell — the second consumer cannot drift.

---

## 3. THE DRAWN TERMINAL BOX — the honest bound, **CLOSED**

The contract declares that a constant LABEL width does not by itself prove the terminal BOX's border never
moves. I did not restate that bound — I **closed it**, by rendering the real thing.

**Harness:** `harness/measure-box.ts` — mounts the SHIPPED `createDagPanelComponent` with the **installed
host's own React and ink renderer** (the same mount the package's mounted-instance suite performs), forces
each phase of the orbit, and captures the **rendered frame**, borders included.
**Raw output:** `03-drawn-box.txt` (raw frames: `harness/03-frames-raw.json`) — **exit 0**.

### The real frame (60×120, phase 0), the running node's box visible

```
   [ 0] "┌MPD───────────────────────────────────────────────────────┐"
…
   [ 6] "│╭────────╮                                                │"
   [ 7] "││ ✗ T1   │                                                │"
…
   [12] "│╭───┴────╮                                                │"
>> [13] "││ ◐ T2   │                                                │"
   [14] "│╰───┬────╯                                                │"
…
>> [41] "│✓ completed · ◐ running · ○ open/blocked · ✗ failed       │"
   [42] "│⊘ cancelled                                               │"
   [44] "└──────────────────────────────────────────────────────────┘"
```

Both fixes are visible **in one real frame**: the drawn legend row is the fixed key, and the running node
sits inside a box.

### The border, measured per phase

| measurement | per phase (0..7) | verdict |
|---|---|---|
| node box **right border** column | `[10,10,10,10,10,10,10,10]` | **never moves** |
| node box top/bottom corner column | `[10,…]` / `[10,…]` | never moves |
| the **animated mark's** column | `[3,3,3,3,3,3,3,3]` | fixed |
| panel right border column | `58` every phase | fixed |
| the node row drawn **verbatim** | `││ ◐ T2   │…` → `││ ◓ T2   │…` → `││ ◑ T2   │…` → `││ ◒ T2   │…` | only the mark changes |
| every row's cell width, whole frame | one single width vector for all 8 phases | **`distinct width vectors = 1`** |
| cells differing from the static frame | **exactly 1** — `{"row":13,"col":3,"from":"◐","to":"◓"}` | the animation changed one cell and nothing else |

### 3.3 THE NEGATIVE CONTROL — the harness is proven able to fail

**Harness:** the same `measure-box.ts`, pointed at a copy of the tree with **one literal changed**
(`VERIFY_SRC=`), restoring the **pre-fix orbit** `[base, base·, base, base··]`.
**Raw output:** `03b-drawn-box-NEGATIVE-CONTROL.txt` — **exit 1**, mutant kept at
`harness/control-mutant-dag-theme.ts`.

```
FAIL | B1 the BOX AROUND the running node is byte-identical apart from the mark
     | [["││ <FRAME> T2   │…"],["││ <FRAME>· T2   │…"],["││ <FRAME> T2   │…"],["││ <FRAME>·· T2   │…"], …]
FAIL | B1 the NODE BOX's right border is the SAME COLUMN at every phase
     | border columns = [10,11,10,12,10,11,10,12]
```

**This is the user's report, reproduced in a real render**: with the old orbit the node box's right border
advances and retreats (`10 → 11 → 12`), and the label's own text is pushed right. The shipped code holds
the same border at `10` for every phase. The measurement discriminates the defect from the fix.

It also demonstrates **why a label-width check alone was not enough**: in the control, the **row's total
cell width stayed 60** (`PASS | B1 the drawn width vector is IDENTICAL`) because the renderer pads rows to
the panel width. The *padding* was constant; the **box interior was not**. A width-vector assertion would
have stayed green under the defect — measuring the box is what catches it.

### 3.4 The declared stand-in (stated, not hidden)

The host seam `ui.useAnimationTime` is supplied by MY harness (a controllable clock) because it is the
host's timer and the package's own test kit omits it. **Everything else is shipped code**: the panel
component, the drawing, the phase arithmetic, the glyph substitution and the ink renderer. The stand-in
decides only WHICH phase is drawn — exactly the job of a host timer.

---

## 4. THE TWO RE-POINTED SUITES — property, or echo?

**Method:** a three-arm mutation matrix. The re-pointed tests were run against (A) the real tree,
(B) a copy of the tree with **no** source revert, and (C) a copy whose three `src` files were reverted to
`HEAD` (**the pre-fix implementation**). B exists so a failure in C cannot be blamed on the copy itself.

| arm | subject | result | raw output |
|---|---|---|---|
| A | real tree | **28 pass / 0 fail** (609 expect() calls) | `04a-suites-real.txt` |
| B | copy, no revert | **28 pass / 0 fail** | `04b-suites-copy-control.txt` |
| C | **copy, pre-fix source** | **26 pass / 2 fail** | `04c-suites-PRE-FIX.txt` |

In C the two failures are **exactly** the two re-pointed assertions, and they fail on the **property**,
not on a string the implementation happens to emit:

```
panel-legend-mount.test.ts:511
  expect(sharedEntries).toHaveLength(1)
  error: expect(received).toHaveLength(expected)
  Expected length: 1
  Received length: 2          ← the pre-fix key printed TWO `○ ` entries
```
```
scene-visuals.test.ts:814
  expect(`${state} named=${named}`).toBe(`${state} named=1`)
  Expected: "open named=1"
  Received: "open named=2"    ← the pre-fix key named `open` twice
```

### Judgment: **they pin the PROPERTY.** A test that echoed the output would have passed here.

- They read the glyph **from the contract table** (`DAG_TONE_GLYPH.blocked`), never a re-typed literal.
- They assert **counts and memberships** — one `○` entry, both carriers named, each state named exactly
  once, no `=` — rather than an expected sentence. The contract deliberately left **the spelling** to the
  writer; these assertions correctly do **not** pin `/` vs any other join, so they survive a re-spelling
  while still failing the tautology. That is the right level.
- They discriminate the three bad shapes: `○ open=blocked · ○ blocked=open` (2 entries), `○ open · ○ blocked`
  (2 entries), and a dropped carrier (0 for `blocked`) all fail; only one-entry-per-mark passes.

**Residual weaknesses, reported rather than implied:**
1. `scene-visuals.test.ts:810` reads `composed.at(-1)` as "the state key line". At these budgets (96/100
   columns) the key is one line, so it is correct today; if a future wording made it wrap, the arm would
   fail **loudly** (several states would count 0) rather than silently pass — acceptable, but the
   assertion would then be misattributed to the wrong cause.
2. Neither named suite pins the **animation** property; that lives in `panel-dag.test.ts` (also changed by
   this wave). There, `panel-dag.test.ts:982-991` genuinely fails pre-fix on a **measured** violation
   (`expect(cellWidth(glyph)).toBe(1)` → `Expected: 1 / Received: 2`) and on a "breath" that was
   indistinguishable from static (`expect(breath).not.toBe("◐")` → pre-fix `runningGlyph(2)` WAS `◐`).
   **But** the arm at `panel-dag.test.ts:1015` ("the DRAWN running label keeps ONE width…") aborts in C on
   `TypeError: undefined is not an object (evaluating 'DAG_ANIM.runningFrames.map')` — it fails because the
   pre-fix contract lacks the field, **not** because it measured a wider label. **That arm is therefore not
   proven able to detect a moving border.** The only thing in this artifact that proves the border defect
   is detectable is my own §3.3 negative control.

---

## 5. The contract's §4.3 gates (checked, since "done" includes them)

| gate | command | result | artifact |
|---|---|---|---|
| package suite | `.toolchain/node_modules/.bin/bun test packages/mpd-tui-plugin/test` | **448 pass / 0 fail**, 20 files, 8.93s | `05-package-suite.txt` |
| typecheck | `bun run typecheck` (`tsgo --noEmit`) | **exit 0** | `08-typecheck.txt` |
| declaration comments | `bun run verify:comments` | **PASS** — 367 files, 32439 declarations | `07-comments.txt` |
| **dist freshness** | `node scripts/verify-dist-fresh.ts` | **30/30 fresh**, 7 NOT COVERED listed, pinned bun 1.4.0 | `06-dist-fresh.txt` |

The dist check matters for the fix actually shipping: the row loads `dist/index.js`, and it is **fresh** —
so the shipped artifact carries both fixes, not just the source tree.

---

## WHAT I COULD **NOT** VERIFY (explicit, unglossed)

1. **The real host's own `useAnimationTime`.** I stubbed the seam (declared in §3.4). I did not measure the
   host's 125 ms cadence, nor that the real timer starts/stops with `active`.
2. **A real PTY / real terminal.** The frame came from the ink renderer over a fake TTY at **60 columns**.
   I did not measure other widths, other heights, a resized terminal, or a host with scrollbars/scrollback.
3. **The other two DAG surfaces** (the board/plan scenes and the merged subagent panel) were not rendered
   for the box claim. I only asserted their shared one-cell table by reference identity.
4. **The writer's own reported numbers** — I did not read or reuse them; nothing here is derived from them.
5. **The vision defect recorded in contract §5** (Vision Analyst cannot see images) — out of scope, untouched.
6. **Whether the rule holds when a state's glyph is MISSING** (`?? "?"`, two states grouped under `?`) — my
   mutants changed data, not that branch.
7. **The pre-fix `panel-dag.test.ts` arm at :1015** — shown above to fail structurally, not by measurement.
8. **Provenance of the uncommitted tree** — who wrote which line. Attribution is not part of this verdict.

## THE ONE THING I WOULD CHANGE FIRST

Nothing blocking; both fixes are measured good. The first thing I would touch is
**`packages/mpd-tui-plugin/test/panel-dag.test.ts:1015`**: the "DRAWN running label keeps ONE width"
arm is the only assertion that claims to measure the drawn box, and it is **not proven falsifiable** — it
aborts on a missing contract field before it can measure anything. Give it a width assertion that fails on
a MOVING BORDER (as §3.3 does: track the node box's own right-border column across the captured phases),
so the suite — not just an out-of-band verifier — would catch a regression that re-widens a frame.

## ARTIFACTS

```
evidence/tui/legend-and-animation/verify-20261008T120655Z/
├── verdict.md                              ← this file (the durable anchor)
├── 00-git-tracked-modified.txt             the tree's modified set (proves I edited no product file)
├── 01-legend.txt                           MEASUREMENT 1 raw output (exit 0)
├── 02-frames.txt                           MEASUREMENT 2 raw output (exit 0)
├── 03-drawn-box.txt                        MEASUREMENT 3 raw output, REAL render (exit 0)
├── 03b-drawn-box-NEGATIVE-CONTROL.txt      pre-fix orbit → the border MOVES (exit 1) — the falsifier
├── 04a-suites-real.txt                     the two suites, real tree — 28 pass / 0 fail
├── 04b-suites-copy-control.txt             the two suites, unmodified copy — 28 pass / 0 fail
├── 04c-suites-PRE-FIX.txt                  the two suites vs pre-fix code — 26 pass / 2 fail
├── 05-package-suite.txt                    full package suite — 448 pass / 0 fail
├── 06-dist-fresh.txt                       30/30 targets fresh
├── 07-comments.txt                         verify:comments PASS
├── 08-typecheck.txt                        tsgo --noEmit exit 0
├── 09-panel-dag-real.txt                   panel-dag.test.ts on the real tree — 55 pass / 0 fail
├── 10-panel-dag-PRE-FIX.txt                panel-dag.test.ts vs pre-fix — 50 pass / 5 fail
└── harness/
    ├── measure-legend.ts                   MEASUREMENT 1 (+ the two mutant falsifications)
    ├── measure-frames.ts                   MEASUREMENT 2
    ├── measure-box.ts                      MEASUREMENT 3 (+ `VERIFY_SRC` for the control)
    ├── control-mutant-dag-theme.ts         the negative control's mutated table, kept verbatim
    └── 03-frames-raw.json                  the captured frames, every phase
```
