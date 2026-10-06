# Visual review — WEB dependency-DAG port to the MPD TUI

Reviewer: Vision Analyst (roster, read-only) · scope `evidence/tui/dag-port/visual/**`
Date: 2026-10-06 · verdict authority: R3, R4, R6, R8, R9, R10, R14

## 0. What I could and could not judge — READ THIS FIRST

**This review ran while the wave was still landing, and the artifact set changed underneath it.** I
record both states honestly rather than pretending to have reviewed a finished port.

| Declared by the plan | At first pass | At final pass |
|---|---|---|
| `src/dag-theme.ts` (captain, frozen interface) | **PRESENT** | PRESENT — reviewed (F10, F11) |
| `src/panel-dag.ts` (panel-surface) | ABSENT | **LANDED** — reviewed (F12–F14) |
| `src/panel-core.ts` (shared chrome) | ABSENT | **LANDED** — reviewed (F12) |
| `src/dag-layout.ts` + `test/dag-layout.test.ts` (dag-geometry) | ABSENT | **STILL ABSENT** |
| `src/panel-workmate.ts` (panel-surface) | ABSENT | **STILL ABSENT** |
| `test/dag-fidelity.test.ts` (fidelity-verifier) | ABSENT | **STILL ABSENT** |
| `evidence/tui/dag-port/verification/pty/**` | ABSENT | **EXISTS BUT EMPTY OF FRAMES** — see below |

**The PTY captures exist as a partial run and contain NO rendered frame.** `verification/pty/run/summary.json`
is `{"widths": [], "verdicts": []}`; `matrix-run.log` is one line, `[fidelity] capturing 200 cols …`,
and stops there (200 cols is in any case not one of the four widths R15 asks for). The only pane log
the run wrote, `run/w200/tui-pane.log`, holds 2397 bytes of shell echo — the `env -i … dsh-tui` command
line and an OSC 3008 marker — with no panel drawn. I grepped every new capture for box-drawing
characters: the only hits are the `seam-guard/` frames, which show the host's own LAUNCHPAD sidebar
(`│ ‹ 待办 › ▸ ◆`) and **not the DAG page**. So **no capture of the DAG panel at any width, with or
without CJK, exists to review**, and R9's badge, R10's drawn special states, R11's detail body and
R14's whole-surface consistency remain **NOT JUDGEABLE BY ME**. I will not invent a verdict for them.

**But the port's RENDERING PATH is judgeable, because it was shipped by reuse.** `panel-dag.ts`
imports and calls the ancestor's three renderers directly —
`layoutBoxes(tasks, width, focus)` (line 212), `layoutList(...)` (line 216) and `layoutRail(...)`
(line 218) — and its own header states the drawing "comes from `graph.ts` and is REUSED, never
re-implemented". **The box drawing the DAG page will print is therefore byte-for-byte the function
whose CJK output I measure below.** That makes F2–F5 not baseline risks but live defects in the
shipping path, demonstrated by executing the very function the panel calls.

**What I did instead, and why it is evidence rather than opinion.** `src/graph.ts` is the port's
DIRECT ANCESTOR: its `layoutGraph(tasks, cols, focus)` returns the same `{ lines, hits, width, mode,
cycles, chain }` shape the plan's frozen `layoutDag` contract returns, with the same
`"boxes" | "rail" | "list"` mode vocabulary and the same `▼` entry marker R4 says to preserve. Its
exported `legendLines(cols)` is what R6's "explicit legend" clause is about. So I rendered it to a
real CELL GRID with the toolchain the repository ships (`bun`, the same `cellWidth`/`clampCells` the
renderer itself imports) and measured the grid myself. That establishes the **fidelity floor the port
must not regress** and exercises every one of the seven judgement questions' machinery. Renders,
repro scripts and raw output: `baseline-render.txt`, `render-baseline.ts`, `cjk-probe.ts`,
`span-probe.ts`, `border-isolate.ts` in this directory.

Every finding below therefore says **ANCESTOR** or **CONTRACT (dag-theme.ts)** in its subject line. No
finding is attributed to the port.

## 1. Findings

### F1 · ANCESTOR — the legend OMITS `blocked`, so the one glyph two states share is resolved WRONGLY · **HIGH** · **DIVERGES from the WEB reference and from R6** · **FIXED IN THE PORT — see F12**

The `six-states` fixture renders one task per state on a single rank. At 120 cols the drawn content
row is, verbatim:

```
│ ✓ T1 WRK Compl│   │ ◐ T2 WRK Runni│   │ ✗ T3 WRK Faile│   │ ○ T4 WRK Block│   │ ⊘ T5 WRK Cance│   │ ○ T6 WRK Open │
```

`T4` is `blocked` and `T6` is `open`. **They are drawn with the identical glyph `○`, on the same row,
and the board carries no other mark that separates them.** The legend printed directly beneath it is,
verbatim:

```
✓ completed · ◐ running · ○ open · ✗ failed · ⊘ cancelled
```

**Five entries for six states: `blocked` is absent at every width.** At 48 cols the legend is
`✓ done · ◐ run · ○ open · ✗ fail · ⊘ cancel` — still five, still no `blocked`. The legend therefore
does not merely fail to disambiguate `blocked` from `open`; **it asserts the opposite of the truth**,
telling the reader that `○` means `open` while `T4` sits on the board marked `○` and is actually
blocked. On a dependency DAG whose entire purpose is to tell a captain what is held, the panel
currently reports a blocked task as an open one.

This is exactly the failure R6 was written to prevent and it is the clause most worth holding the port
to. The WEB reference has no legend at all, so the port's legend is meant to be an IMPROVEMENT on the
WEB — as shipped in the ancestor it is partially an improvement (a legend exists and degrades
honestly by width) and partially a defect (it is untruthful). **`DAG_STATE_TONES` in the frozen
contract already lists all six — `completed, running, open, failed, blocked, cancelled` — and the
LANDED `panel-dag.ts` builds its key from that table via `legendLinesFor`, so the port FIXES this
omission; see F12.** F1 stands as the record of what the port must not regress to, and as the reason
`dag-geometry`/`panel-surface` must never re-type the ancestor's five-entry legend.

### F2 · **LIVE IN THE PORT** — a box's RIGHT BORDER IS LOST on every CJK content row · **HIGH** · **DIVERGES from the WEB reference**

`panel-dag.ts:212` calls `layoutBoxes` for the boxes mode, so this defect is what the DAG page prints
for any CJK subject. Demonstrated by executing that exact function.

The `cjk` fixture (`T1 冻结验收契约`, `T2 移植布局几何`, `T3 真机 PTY 验证`) at 120 cols draws, verbatim:

```
 0 ┌────────────────────────────────┐
 1 │ ✓ T1 WRK 冻 结 验 收 契 约      
 2 └────────────────┬───────────────┘
```

Line 1 has **no closing `│`**, while lines 0 and 2 DO close at column 33 with `┐` and `┘`. The box is
therefore **open on the right-hand side on every content row**, at every width tested (120/80/48/32).
Measured, on the same fixture and the same code path:

```
CJK   row 1: codepoints=28 cellWidth=34 endsWith│=false
ASCII row 1: codepoints=34 cellWidth=34 endsWith│=true
```

Both rows occupy exactly 34 cells, which is the box width; only the ASCII row SPENDS its 34th cell on
the border. I isolated the cause from content overrun with a single-task repro
(`border-isolate.ts`) — a subject of ONE wide character already loses the border:

```
ascii-short  subjectCells=  7 contentCodepoints= 34 contentCells= 34 endsWith│=true
   "│ ✓ T1 WRK Port it               │"
cjk-1        subjectCells=  2 contentCodepoints= 33 contentCells= 34 endsWith│=false
   "│ ✓ T1 WRK 冻                     "
```

So the loss is **unconditional for CJK content, not a function of label length**, and the ASCII control
with a 34-cell subject (`ascii-34`) still keeps its border. A long CJK subject is worse still:
`cjk-20` (`冻` × 20) emits `"│ ✓ T1 WRK 冻 冻 冻 冻 冻 冻 冻 冻"` — 26 codepoints, 34 cells, **ending
mid-air after the eighth `冻` with neither padding nor border**.

This is precisely the cell-width bug question 4 asks about, and I name the exact line: **`cjk @ 120
cols`, line 1, `│ ✓ T1 WRK 冻 结 验 收 契 约      `** (and its siblings at lines 7 and 13, and the
same three lines at 80/48/32 cols). Note the box's TOP and BOTTOM rows are correct at 34 codepoints, so
this is a per-row content defect and not a geometry defect — which is why it should be fixed in the
label writer, not in the layout arithmetic.

### F3 · **LIVE IN THE PORT** — a stray space is emitted after EVERY wide character; proven slot-vs-cell mismatch at `graph.ts:472` · **MEDIUM** · **DIVERGES from the WEB reference**

The raw spans the layout emits for the CJK content row are exactly:

```
text:  "│ ✓ T1 WRK 冻" | " " | "结" | " " | "验" | " " | "收" | " " | "契" | " " | "约" | "      "
tone:  completed     | blank| completed| blank| completed| blank| completed| blank| completed| blank| completed| blank
```

The `blank`-toned single-space spans between the wide characters are not padding the renderer chose;
they are **array slots that were never written**, reading as background because the cell's tone falls
back to `blank`. The mechanism is in the label writer:

```ts
// graph.ts:472
for (const char of clampCells(stripControl(" " + body), nodeWidth - 2)) { label(top + 1, cursor, char, at); cursor += cellWidth(char) }
```

`label(row, col, char, at)` writes **one array slot per character**, while `cursor += cellWidth(char)`
advances **two cells per wide character**. The two disagree for exactly the characters `sanitize.ts`'s
`WIDE` regex classifies as wide, so the intervening slot is skipped. Consequence: the subject
`冻结验收契约` (6 characters, 12 cells) is drawn across 17 cells and the label is inflated by 5 cells —
the same inflation that pushes the content into the border cell, so F2 and F3 are two symptoms of one
arithmetic error and should be fixed together. The WEB reference lays CJK out natively and has no such
path.

### F4 · **LIVE IN THE PORT** — subjects are truncated MID-WORD with no ellipsis · **MEDIUM** · **DIVERGES from the WEB reference**

The WEB reference draws the subject with `textOverflow: "ellipsis"` (`team-view.ts`, the subject along
`CSS.node`). The ancestor clips silently. Verbatim evidence, `six-states` @ 120 cols, every subject cut
mid-word:

```
│ ✓ T1 WRK Compl│   │ ◐ T2 WRK Runni│   │ ✗ T3 WRK Faile│   │ ○ T4 WRK Block│   │ ⊘ T5 WRK Cance│
```

and `chain` @ 32 cols, where the final character of the subject is dropped:

```
│ ✓ T1 WRK Freeze the acceptanc│
```

A reader cannot tell a clipped subject from a short one. Severity is MEDIUM rather than HIGH because
the state glyph, the id and the kind abbreviation all survive intact — only the free text is lossy.

### F5 · **LIVE IN THE PORT** — width degradation is INCONSISTENT: one board degrades to `rail`, another clips `boxes` · **MEDIUM-HIGH** · **DIVERGES from the port's own declared floor**

Question 6 asks whether 32 cols degrades to a smaller layout rather than truncating a lie. The answer
is **sometimes**. The `fanin` board at 32 cols degrades correctly and honestly:

```
-- fanin @ 32 cols -> mode=rail width=32 lines=4
 0 ✓ T1 REQ Freeze the theme table
 1 └─▸ ◐ T3 INT Join the    ⇠ T1+T2
 2    └─▸ ○ T4 REV Verif    ⇠ T3+T1
 3 ✓ T2 WRK Port the geometry
```

That is a genuine degradation: the mode changes to `rail`, full subjects are preserved, and the extra
blockers are named inline (`⇠ T1+T2`) instead of being dropped — an honest improvement on what a fixed
168px column could do. But at the SAME 32 cols the `chain` board stays in `boxes` and clips
(`│ ✓ T1 WRK Freeze the acceptanc│`), and the `cjk` board stays in `boxes` and loses its border (F2).
So the width alone does not determine the mode, and a 32-col panel can silently produce a clipping
box layout. The frozen contract declares `DAG_PANEL_MIN_COLUMNS = 32`, promising that 32 cols is a
supported floor; the ancestor meets that promise for one board shape and not another. The port should
either guarantee `rail` at the floor or guarantee an ellipsis mark in `boxes` — not leave the outcome
to the fixture.

### F6 · ANCESTOR — edges ARE legible and ARROWED, and a fan-in IS distinguishable from a chain · **no severity** · **IMPROVES ON the WEB reference (which has no arrowhead)**

Question 3 passes. The `fanin` board at 120 cols, verbatim:

```
 0 ┌────────────────────────────────┐   ┌────────────────────────────────┐
 1 │ ✓ T1 REQ Freeze the theme table│   │ ✓ T2 WRK Port the geometry     │
 2 └────────────────┬───────────────┘   └────────────────┬───────────────┘
 3                  │                                    │
 4                  ├────────────────────────────────────┘
 5                  ▼
 6 ┌────────────────┴───────────────┐
```

- **The `▼` entry marker R4 requires is present**: `ARROWHEAD ▼ count = 2`.
- **A fan-in is distinguishable from a chain.** `T3` rests on TWO blockers; both risers (columns 17 and
  53) merge at row 4 into one horizontal bus that arrives at `T3`'s centre, and exactly ONE `▼` is
  drawn. That single arrowhead for a two-parent fan-in is **by design and not a defect** — the source
  records that every converging parent writes the same cell, so the arrowhead count is per dependent,
  not per edge.
- **A long edge crossing a rank stays readable and does NOT overpaint a box.** `T4` rests on `T3` AND on
  `T1`, so the `T1 → T4` edge spans two ranks. It routes down column 17 through rows 9–11, which is the
  gap between `T3`'s box (rows 6–8) and `T4`'s box (rows 12–14), and enters `T4` at its centre `┴`. It
  crosses no box.
- The `rail` carries the same reading in its own geometry, naming the non-primary blockers inline
  (`└─▸` plus `⇠ T1+T2`), so nothing is lost when boxes are dropped.

### F7 · ANCESTOR — ASCII border alignment is CLEAN: every box closes on ONE column · **no severity** · **MATCHES**

Every box's hit rectangle is identical: `cols 0..33` at 120/80/48 cols and `cols 0..31` at 32 cols, and
every top/bottom border row is exactly 34 codepoints ending `┐` / `┘` at column 33. There is **no
wobble on the ASCII fixtures**. I record this explicitly because question 4 asks for it and because a
crude metric can fake a wobble: my first pass reported `distinct=2` for the chain, which was an
artifact of counting the vertical connector `│` that sits in the GAP between ranks as if it were a box
border. Read through the hit rectangles, the answer is one column. The wobble is real only on the CJK
fixture (F2), where it is a cell-width bug as suspected.

### F8 · ANCESTOR — chrome: the legend degrades honestly by width; header, footer and panel frame are NOT judgeable · **MEDIUM (legend partial) / NOT JUDGEABLE (rest)**

The legend is present at every width and drops wording rather than lying — a truthful degradation:

```
120/80 cols: ▼/▸ blocker above → dependent below · ▶ focus lights its chain
48 cols:     ▼/▸ blocker → dependent · ▶ focus
32 cols:     ▼/▸ arrow · ▶ focus
```

Below the floor it returns nothing rather than a cut line. Its only defect is F1 (the missing `blocked`
row). **A header row, a footer key-hint row and a bordered panel frame are ABSENT from this module** —
the ancestor draws the graph and the legend only. Per R6 those belong to `panel-dag.ts`, which does not
exist, so I cannot judge whether they are present, aligned or truthful. Same for R9 (panel badge + 1-cell
icon), R10 (empty / cycle / failed-dependency states), R11 (pinned detail body) and R14 (whole-surface
consistency).

### F9 · ANCESTOR — a dependency CYCLE is detected and reported rather than hidden · **no severity** · **MATCHES R10**

The `cycle` fixture (`T1` blockedBy `T2`, `T2` blockedBy `T1`) is reported structurally rather than
drawn as a plausible acyclic picture: `cycles=["T1","T2"]` on the returned view, with each task pushed
to rank 0 and the cycle listed for the caller to print. R10's cycle clause is satisfied at the layout
level. I could not judge the cycle's *drawn* treatment, because that requires the port's scene.

### F10 · CONTRACT — `dag-theme.ts` reproduces the WEB reference's tables exactly, and its host-key claim is TRUE · **no severity** · **MATCHES**

I verified the frozen contract against the WEB reference token by token, and against the installed
host. **Every check passed.**

| Claim in `dag-theme.ts` | Verified against | Result |
|---|---|---|
| six state hexes are the WEB `TONE` constants | `team-view.ts:254-261` | **exact**: `#12a150`, `#4d6bfe`, `#e5484d`, `#e08700`, `#8a94a6`, `#5b6472` |
| glyph table | `team-view.ts:264` | **byte-identical**, including the deliberate `blocked:"○"` / `open:"○"` collision |
| `DAG_KIND_ABBREV` | `team-view.ts:319-323` (`kind.req`→`REQ` … `kind.int`→`INT`) | **exact**: `REQ/WRK/REV/FIX/INT` |
| `edge` provenance `#d8dde5` | WEB `CSS.edge` | exact |
| `focus` / `chain` provenance `#5b6472` | WEB `FOCUS_EDGE` (`team-view.ts:392`) | exact |
| `dim` provenance `#8a94a6` | WEB `CSS.dim` (`team-view.ts:236`) | exact |
| "every member of this union is a key the installed host declares" | host `lib/types/theme.d.ts` | **TRUE** — all ten (`success` 45, `error` 46, `warning` 47, `activity` 28, `inactive` 39, `subtle` 41, `accent` 22, `accentShimmer` 26, `promptBorder` 35, `text` 37) |
| "the host's 73-key `Theme` interface" | host `lib/types/theme.d.ts` | **TRUE** — 73 members counted |

Two notes, neither of them a defect worth blocking on. (a) `DAG_TONE_WEB_HEX`'s docblock says "The
hexes are the WEB view's own `TONE` constants", but five of its eleven entries legitimately come from
other WEB tokens (`CSS.edge`, `FOCUS_EDGE`, `CSS.dim`) and `blank` maps to `""`, which has no WEB source
at all — the WEB has no `blank` tone because untouched cells are the *absence* of a tone. Tightening
that sentence would let a fidelity test assert "every state entry is a TONE constant" honestly instead
of having to except five rows. (b) `DAG_TONE_GLYPH` is typed `Readonly<Record<string, string>>` rather
than `Record<DagTone, string>`, and its docblock promises `?` for an unknown state — but this module
declares data only, so **the `?` fallback is not implemented in any file that exists yet**. Whoever
writes `dag-layout.ts` must supply it; there is nothing to inherit.

### F11 · CONTRACT — the animation budget is DECLARED but entirely UNVERIFIED · **not judgeable** · **R8**

`DAG_ANIM` declares `intervalMs: 125`, `frames: 4`, `staticPhase: 0`, and the contract states that a
host offering no timer must draw the static frame. **A static capture cannot show motion, and no
capture exists at all.** I state plainly for R8: **the running-state animation is UNVERIFIED by me.** I
can neither confirm that `useAnimationTime` is wired nor that the four frames differ nor that a
timer-less host degrades — all three require the port's renderer and a real PTY. The static-phase
*contract* is declared and internally consistent; that is the most that can be said today.

## 2. Findings on the LANDED port surface (`panel-dag.ts`, `panel-core.ts`)

These are read from the landed source, not from a rendered frame — no frame exists (section 0). They
are structural guarantees about what will be drawn, and each is a candidate for the real-PTY pass to
confirm or refute.

### F12 · PORT — the legend is built from the contract and makes the two `○` states name EACH OTHER · **no severity** · **IMPROVES ON both the WEB reference and the ancestor** — F1 is FIXED

`panel-dag.ts:536` renders the key through `panel-core.ts`'s `legendLinesFor(measured.cols, arrow)`,
which reads the six states out of `DAG_STATE_TONES` rather than re-typing them, and — beyond simply
listing six rows — names the twin for any state that shares a mark:

```ts
// panel-core.ts:624-631
const entries: string[] = DAG_STATE_TONES.map((state) => {
  const glyph = DAG_TONE_GLYPH[state] ?? "?"
  const twin = DAG_STATE_TONES.find((other) => other !== state && DAG_TONE_GLYPH[other] === DAG_TONE_GLYPH[state])
  return twin === undefined ? `${glyph} ${state}` : `${glyph} ${state}=${twin}`
})
```

Resolving that against `DAG_STATE_TONES = ["completed","running","open","failed","blocked","cancelled"]`
and the contract's glyph table yields `✓ completed · ◐ running · ○ open=blocked · ✗ failed ·
○ blocked=open · ⊘ cancelled`. **Both `○` rows now name each other**, so neither can be read as the
other, and the `?` fallback F10 noted as unimplemented is in fact supplied here. Two further
protections are in the same function: the key **wraps rather than abbreviates** ("a legend exists to be
unambiguous"), and a line that does not fit is **dropped rather than cut** ("a legend that reads
`✗ fai` is a truncated falsehood"). This is a genuine improvement on the WEB reference, which has no
legend at all, and it discharges R6's disambiguation clause — **provided the real-PTY pass confirms it
is actually reachable at panel widths**, which is the one thing I cannot check.

### F13 · PORT — chrome, badge, empty state and `failedBy` are all present in the render path · **no severity, but UNVERIFIED visually** · **appears to satisfy R6/R9/R10**

Structurally present and each wired to a real caller: a bordered frame and header naming the team and
its progress (`headerFacts`, with a progress bar), the legend (F12), a footer of key hints, a badge
derived from the page's own projection via `dagBadge`/`publishBadge` on change rather than per render
(R9), a documented empty state, and `failedDependencies`/`failedBy` carried in the pinned detail body
separately from the blocked state (R10, OPT-1 — "the drawing does not need them" but the detail body
does). `panel-dag.ts:511` also prints a `view <mode> · N tasks` row, and the mode is chosen by
geometry (`layoutBoxes` may REFUSE, then rail, then `layoutList` as the dense fallback) — which is
what finally gives the previously unreachable `layoutList` a caller, satisfying R7. **I cannot confirm
any of it is drawn correctly, aligned, or reachable: that needs the missing frames.**

### F14 · PORT — the boxes renderer is REUSED, so F2–F5 will appear in the DAG page · **HIGH** · **DIVERGES from the WEB reference**

`panel-dag.ts` states the drawing "comes from `graph.ts` and is REUSED, never re-implemented" and
calls `layoutBoxes` (line 212), `layoutList` (line 216) and `layoutRail` (line 218). That is a sound
engineering choice in itself — one drawing, three consumers — but it means the CJK right-border loss
(F2), the wide-character slot/cell mismatch (F3), the silent mid-word truncation (F4) and the
inconsistent narrow-width mode choice (F5) are **inherited unchanged into the shipped DAG page**.
Note also that the plan's frozen contract named a new `layoutDag(...) => DagView` with
`mode: "boxes"|"rail"|"list"`, and `src/dag-layout.ts` does not exist: what shipped is the ancestor's
`GraphView` behind the new panel instead. That substitution is worth the captain's explicit blessing,
because it moves the four defects above from "the old module's problem" to "the new page's problem".

## 3. The single worst visual defect

**F2 / F14 — the DAG page's box drawing loses the RIGHT BORDER of every CJK node on every content row.**

`panel-dag.ts:212` draws nodes with the ancestor's `layoutBoxes`, and executing that exact function
shows that a box whose subject is CJK never closes on the right: the top and bottom border rows carry
`┐`/`┘` at column 33, while the content row between them ends in open space. At 120 cols, verbatim:

```
 0 ┌────────────────────────────────┐
 1 │ ✓ T1 WRK 冻 结 验 收 契 约      
 2 └────────────────┬───────────────┘
```

The repro is a single wide character — `│ ✓ T1 WRK 冻                     ` (33 codepoints, 34 cells,
no closing `│`) against the ASCII control `│ ✓ T1 WRK Port it               │` (34 codepoints, 34 cells,
closing `│`) — so it is unconditional for CJK and not a function of label length, and it holds at
120/80/48/32 cols alike. Every CJK-subject task in a Chinese-language session therefore renders as a
box that is visibly broken on one side, and the same slot/cell mismatch (F3) additionally inserts a
stray space after each wide character, inflating a 6-character subject across 17 cells instead of 12.

I rank this worst **among the defects that are still live**, because it is unconditional, it is on the
shipping path, it corrupts the drawing rather than merely shortening it, and the wave has no capture
that would have caught it — the CJK fixture is exactly the case the missing PTY matrix was supposed to
cover. Note the distinction from the single worst defect *found*: that was F1, the ancestor's legend
omitting `blocked` while printing `○ open` over a blocked task. F1 was the more dangerous defect
because it was a confident lie about state rather than a visible break, **and the port has fixed it**
(F12 — the key is built from `DAG_STATE_TONES` and the two `○` states now name each other). Had the
port re-typed the ancestor's five-entry legend, F1 would still be the answer.

## 4. What the captain must supply for a verdict on the drawn page

1. **Finish the PTY matrix.** `verification/pty/run/summary.json` must carry a non-empty `widths`
   array, and the run must cover **120 / 80 / 48 / 32 cols** — it currently starts at 200 cols, which
   is not one of the four widths R15 asks for, and stops before writing a frame. Text frames are
   sufficient; I read the cell grid myself.
2. **Include the fixture that matters most and is currently missing: a CJK board.** It is the one that
   exposes F2/F3, and it is the case a `boxes`-mode panel in a Chinese-language session will hit.
3. Also cover: a single chain; a **2+ blocker fan-in**; a **long edge spanning two ranks**; **all six
   states on one board** (to confirm F12's `○ open=blocked · ○ blocked=open` key is actually drawn);
   an **empty** board; a **cycle**; and a **failed blocker** (`failedBy`, R10's OPT-1 rule).
4. One capture with `useAnimationTime` present and one with it absent, plus tick timestamps, for R8 —
   with the static capture I can confirm the frame, never the motion.
5. One capture showing the **frame, header, footer, badge and empty state** together (R6/R9/R10), and
   one of the **workmate** page (R12), which has no source file yet.

Until those exist, F1–F9 describe the **ancestor baseline the port inherits** (F2–F5 through the reuse
at F14), F10–F11 describe the **frozen contract**, and F12–F14 describe the **landed front-end** from
source only. **Nothing in this file is a verdict on a drawn DAG page, and I make no claim that the
panel is visible, reachable, or correctly laid out.**
