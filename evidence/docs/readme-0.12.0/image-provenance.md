# README image set — provenance for v0.12.0

Every image the product page and the documentation hub reference, with the method that produced it.
No image in this set is hand-taken, drawn in an editor, or synthesised; each one is the shipped
bundle's own output, captured on a real machine.

## The set

| Asset | Source | Method |
|---|---|---|
| `hero-web-tui.png` | composed | the Web **Team** tile beside the DSH-TUI `/mpd team` tile, labelled |
| `web-team-board.png` | `docker/ui/out/shots/06b-team-board.png` | Playwright + headless Chromium driving the real app, cropped to the bundle's own **Team** view (x ≥ 890 of a 1600-wide viewport) |
| `web-plugins-installed.png` | `docker/ui/out/shots/03-plugins.png` | same, cropped to the `Installed` block |
| `web-settings-mpd.png` | `docker/ui/out/shots/04-settings-mpd.png` | same, cropped to the MPD settings card (the harness's left nav is excluded) |
| `web-agent-presets.png` | `docker/ui/out/shots/05-settings-agent-presets.png` | same, cropped to the Agent presets page including the `mpd` CUSTOM card |
| `tui-team-dag.png` | `tmux capture-pane -e -J` on session `tui` | the real TUI's ANSI byte stream, rasterized at the character grid tmux computed |
| `tui-status-line.png` | same | a thin strip around the plugin's own keyed status row |
| `tui-workmates.png` | same | the `MPD workmate` sidebar page |
| `zh-CN/*` | the same lanes, run with the app in its 简体中文 locale | the Web tiles from the Chinese render; the terminal tiles from a TUI session started with `DSH_TUI_LANG=zh` |

## What the terminal tiles ARE, stated precisely

The TUI is a terminal application. The lane captures its output as the **ANSI byte stream it emitted
onto a real PTY** — `tmux capture-pane -e -p -J`, where tmux is itself a terminal emulator and has
therefore already resolved every cell, every attribute and every explicit colour. The rasterizer
(`.mpd/readme-ref/tui-render.py` at capture time; see *Reproducibility* below) only paints that grid.

Two consequences, both declared rather than implied:

1. **The page background is a CHOICE, not an observation.** dsh-tui queries the terminal with OSC 11
   for its background and otherwise assumes its `dark` palette, and it deliberately leaves the
   terminal's own background showing — it never paints one. The rasterizer uses the dark palette's own
   deep warm charcoal (`#22262E`, the palette's `inverseText` in `lib/types/theme.js`), so the
   render stays inside the theme's own colour family. **Every foreground colour and every explicit
   background comes from the byte stream; only the page background is the lane's.**
2. **The zh-CN terminal tiles are not visibly different in their scene bodies.** The TUI localizes its
   command descriptions and its status line but not its scene bodies; only `tui-status-line.png`
   differs between the two locales. The README states this in its own caption, because the images make
   it look like an omission when it is a documented product decision.

## Why the lane looks the way it does — three dead ends already paid for

1. **X is not available in this image.** An Xvfb + xterm + `import` lane was built and measured:
   with one X owner, a fresh lock, `docker exec -d` and output redirected to files, `xdpyinfo`, `xwd`
   and `import` all returned **exit 124 with zero bytes**. The server accepts the socket and never
   answers a setup request, independent of which client is used. Do not rebuild this.
2. **`xterm -sb 0` is a trap.** `-sb` is a BOOLEAN in xterm; it does not take a number, so the `0`
   falls through as the positional SHELL argument and xterm refuses to start with
   `No absolute path found for shell: 0`. Use `+sb`.
3. **`pkill -f <pattern>` self-matches.** `pkill -f "xterm -display :99"` kills the CALLING SHELL,
   because the shell's own command line contains that literal text. Use `pkill -x <name>`. This cost
   two silent rounds; it is the same class as the repository's own T-24 note.

And one trap on the Web side: the app opens a **first-run "Add an API key" modal** that dims
everything behind it, so a probe taken without dismissing it resolves against a masked page. The
existing driver's `dismissGates()` handles it; this container has no key, so "Configure later" is the
branch that applies.

## The fixture is what makes the images worth looking at

The captures are populated because the lane seeds a real state root before shooting: a team with a
**diamond** dependency graph (T1 → {T2, T3} → {T4, T5} → T6) at `phase: active`, plus a boulder work,
two plan files and three workmate instances under `~/.mpd/workmate`. The team is named
**`Dual Surface Demo`** — the same name on both surfaces in the hero, which is what makes the pairing
read as one run rather than two screenshots.

**Marker discipline, and the bug it caught.** The team-surface marker `Dual Surface Demo` is NOT
unique to the team scene: the chat screen's keyed status line also reads
`mpd: team Dual Surface Demo 5·2/6 · …`. A capture gated on that marker therefore fired on the CHAT
screen once, producing an image that looked plausible and was of the wrong surface. **The lesson is
recorded because it generalises: a readiness marker must be unique to the surface it gates.** The
shipped images were each confirmed by looking at them, not by trusting a marker.

## Reproducibility

- **Web tiles**: reproducible today — `docker/ui/capture.mts` drives the app and the crops are a
  declared rectangle table.
- **Terminal tiles**: produced by the recipe above, and the recipe is now COMMITTED —
  `docker/ui/tui-render.py` is the rasterizer and `docker/ui/tui-capture.sh` drives the scenes;
  `docker/ui/entrypoint.sh` runs them behind a guard. **But the lane is NOT proven to produce the
  shipped set end to end**, and that is stated rather than implied: the one end-to-end run performed
  FAILED at its own pre-flight assertion (a scene marker that the chat surface also satisfies) and
  wrote no PNGs, and the assertion was fixed afterwards without re-running. What IS proven by
  measurement is narrower and worth having: `docker/ui/tui-render.py` reproduces the reference
  renderer **byte-for-byte** on the captured pane, and every shipped terminal tile was located inside
  its source render and diffed, so "which command produced this tile" is a fact rather than a claim.
  Re-running the lane is a RECORDED FOLLOW-UP.

## A defect found in a SHIPPED image, and fixed

The first rendering of `zh-CN/tui-status-line.png` drew the Chinese words as **tofu** — empty boxes —
because `DejaVuSansMono` carries no CJK coverage and the rasterizer had no fallback face. It was
caught by a lane writer reading the image, not by any gate: `verify-docs-parity` asserts that a
referenced image RESOLVES, and says nothing about what it shows. The tile was re-rendered through the
corrected rasterizer (a second face for wide glyphs, `NotoSansCJK`), and the corrected file now reads
`mpd: 团队 Dual Surface Demo 5·2/6 · boulder 1/2 · 计划 2 · workmate 3`.

Two README alt texts were also corrected in the same pass, because a check of the images against
their own captions found they did not match: one promised "the `/mpd` command tree open" above a
three-row strip of the status line, and the other called a cropped scene "a full-screen terminal
scene". Both now describe what is actually in the file. **The lesson is the same one this wave keeps
re-learning: an image is verified by looking at it, and a caption is verified against the image.**

## What this evidence does NOT claim

- Not that any gate covers the images. `verify-docs-parity` asserts that every referenced image
  RESOLVES; it says nothing about what an image shows. That judgement rests on the reviewer having
  looked at each file, which was done — and which is exactly how the tofu was eventually caught.
- Not that the capture lane is exercised end to end (see *Reproducibility*).
- Not pixel identity with any particular terminal. The claim is the facts on screen.
