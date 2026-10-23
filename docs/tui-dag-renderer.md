# The DAG renderer: character grid now, a self-built renderer deferred

[中文](./tui-dag-renderer.zh-CN.md)

**Decision record** for the MPD dependency DAG as drawn in the dsh-tui surfaces. Owner: the TUI lane
(`packages/mpd-tui-plugin`). Date: 2026-10-23. Input contract:
`.mpd/plans/watchdog-tui-panel.md` (“Also in this lane”). Status: **decided** — the DAG stays a
character grid this wave; a self-built renderer is deferred, with the conditions named in §5.

## 1. The question

The DAG in the MPD sidebar page (`panel.ts` → `panel-dag.ts` → `graph.ts`) is a **character grid**: every
node, edge, junction and legend cell is a Unicode glyph laid out by this bundle and drawn through the
host's `ui.Text` / `ui.Box`. The question this record answers is whether it should instead be rendered
through a terminal-graphics path — notcurses, or the host's own `ui.Image` primitive — and if not, what
exactly would have to change first.

## 2. What was evaluated

### 2.1 notcurses — NOT viable

Four independent reasons, any one of which is disqualifying:

1. **No Node/Bun binding exists here.** notcurses is a C library; the installed profile carries **no
   notcurses package** and **no FFI runtime** (the only `ffi` hit in the profile is a type declaration
   under `@types/node`, which ships no runtime). Using it would mean adding a native dependency of our
   own.
2. **It needs a C toolchain at install time.** The published bundle is deliberately **build-script-free**
   (`AGENTS.md` §8): the one-command install must not compile anything, and pnpm refuses dependency build
   scripts without an approval channel.
3. **It would own the tty.** notcurses drives output and input itself, while the host's Ink reconciler
   owns the frame, the layout, the key dispatch and the panel's mount/unmount lifecycle. Two owners of
   one terminal is not a seam; it is a race decided by whichever library wrote last.
4. **It has no render-to-buffer API.** Its output *is* the terminal — there is no “draw this into my cell
   grid” entry point, so there is nothing the host's renderer could composite a panel from.

The verdict is architectural and does not depend on a benchmark: even a perfect binding could not draw
inside the host's panel without displacing the host's renderer.

### 2.2 The reference `dsh-blender-plugin` — no graphics code

The reference implementation this bundle has followed for panel work ships **no graphics code at all**.
It used the host's panel seam — a React component rendered by the host's own reconciler — exactly as this
bundle does. It therefore provides no precedent for a terminal-graphics path, and no measured benefit to
copy.

### 2.3 The host `ui.Image` path — bounded, raster-only, non-interactive

The host does expose an image primitive (`ui.Image`, read from the installed dsh-tui **0.16.1** type
declarations). Its own contract rules out the DAG:

| Property (host's own words / declarations) | Consequence for the DAG |
|---|---|
| `TerminalImageSource = { data: Uint8Array, width, height }`, “immutable row-major sRGB pixels, four bytes per pixel in RGBA order” | The caller must supply **decoded pixels**. The host exports **no decoder and no rasterizer**: a DAG raster would have to be produced by us, from the graph layout, into an RGBA buffer |
| `children`: “Same-size terminal-cell fallback rendered when graphics are unavailable” | A **cell fallback is mandatory** — the character grid is still drawn under every image, so the grid cannot be retired, only duplicated |
| `presentation: 'preview' \| 'transcript'`; “Default keeps Kitty only”; `TerminalImageProtocolName = 'kitty' \| 'sixel'` | Graphics exist only on Kitty/Sixel terminals; every other terminal shows the fallback |
| “The component never emits protocol bytes itself. It contributes a normal Yoga leaf; the Ink host decides after layout…” | The image is a **static leaf**. There is no per-node hit-testing, no cell cursor, no key focus — the DAG's click-to-pin, focus movement and scroll are cell gestures the image cannot carry |
| Bounds: max edge 1024 (2048 for a preview), max decoded bytes, max frame bytes, max cells (a 128×128 cell box) and 64 placements | Even if drawn, the drawing is a fixed-size raster inside a box the host owns |

An image could therefore only be a **non-interactive picture with a mandatory grid underneath it**. For a
graph whose value is *which node is pinned, which task is focused, and where the reader is scrolled to*,
that is strictly less than what the grid already does.

## 3. The decision

1. **The DAG stays a character grid this wave.** It is interactive, it fits the 28-column sidebar floor,
   it is drawn by the host's own `ui.Text`/`ui.Box`, and its colours already come from host theme keys.
2. **A self-built renderer is deferred**, not rejected on taste: §5 names the four things that would have
   to exist before the question is worth re-opening.
3. **The colour contract is already the alignment baseline.** Any future renderer must produce the same
   six state colours the grid expresses through the host's theme keys (§4), so the two surfaces cannot
   disagree about what “failed” or “running” looks like.
4. **This record is the provenance for the “no graphics this wave” claim**, so a later reader does not
   have to re-derive it from a ticket.

## 4. The colour baseline: the WEB tones

`packages/mpd-tui-plugin/src/dag-theme.ts` carries `DAG_TONE_WEB_HEX` — the WEB view's own `TONE`
constants, recorded as **provenance**: nothing in the TUI renders a hex, the panel draws host theme
keys, and a fidelity test reads these values to prove the six states map 1:1 onto the WEB tones. A future
rasterizer must adopt exactly this table.

| Tone | Hex | Host theme key today |
|---|---|---|
| `completed` | `#12a150` | `success` |
| `running` | `#4d6bfe` | `activity` |
| `failed` | `#e5484d` | `error` |
| `blocked` | `#e08700` | `warning` |
| `cancelled` | `#8a94a6` | `inactive` |
| `open` | `#5b6472` | `subtle` |
| `focus` | `#5b6472` | `accentShimmer` |
| `chain` | `#5b6472` | `accent` |
| `edge` | `#d8dde5` | `promptBorder` |
| `dim` | `#8a94a6` | `inactive` |

The last four are the **drawing's own** tones (the WEB view expresses them through opacity and CSS
variables rather than a state name), which is why they share hexes with states above them.

## 5. What would have to change for a renderer

1. **A rasterizer.** The graph layout (`graph.ts`) produces cells and spans, not pixels. A renderer needs
   a layout → RGBA pass (glyph rasterization or a vector redraw), with font metrics the host does not
   expose.
2. **A protocol story with a real fallback.** Kitty/Sixel only, and the cell fallback is mandatory — so
   the grid stays regardless, and the renderer must be a strict improvement on top of it.
3. **Per-node interaction.** The image primitive is a leaf. Click-to-pin, key focus and scroll would have
   to be re-projected onto cells anyway — which is the grid's own model.
4. **A measured benefit.** Nothing in this wave's operator need (read the team's state, see the holds and
   incidents, find the pinned task) is blocked by glyph drawing; a renderer would have to show a benefit
   that survives the four costs above.

## 6. Evidence and bounds

- **Read from the installed host**: dsh-tui **0.16.1**'s own type declarations
  (`lib/types/ink/components/Image.d.ts`, `lib/types/ink/terminal-image.d.ts`,
  `lib/types/ink/hooks/use-terminal-images.d.ts`) — the quoted sentences and the bounds tables above are
  theirs, not restated from memory.
- **Read from the installed profile**: no `notcurses` package and no FFI runtime (a filesystem search
  under the profile's `node_modules`); the only `ffi` hit is a type declaration.
- **Not measured, stated as a bound**: no PTY graphics capture was attempted, and no performance number is
  claimed. The verdict is architectural (ownership, installability, fallback and interaction), so it does
  not rest on a screenshot.
- **The existing character-grid evidence** stays where it was recorded: the DAG's PTY captures under
  `evidence/tui/dag-port/verification/pty/` and the panel's own suite
  (`packages/mpd-tui-plugin/test/panel-dag.test.ts`) are grid evidence and are not re-used as graphics
  evidence here.
