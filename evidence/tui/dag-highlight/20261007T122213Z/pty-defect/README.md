# A defect only the REAL PTY could find — the `⤢` control renders no cell

Frozen revision `97952cdea5d8a6c5a58fc82c9b42a8c3603e036d86003963d7848b8fa83bfb5e`, real terminal
(private tmux socket, sandbox `DSH_HOME`, sandbox `HOME`, sandboxed workspace), capture
`../pty/w220/open1.pane.txt` line 5, byte-exact:

```
││MPD DAG                                                            │
```

The DAG page's TITLE ROW is drawn (its `MPD DAG` label is the new chrome) but the `⤢` control occupies
NO cell on it, while the SAME constant (`PANEL_FULLSCREEN_GLYPH`, `panel.ts`) renders correctly in the
page's own footer on the same revision:

```
││⤢ fullscreen · ↑↓/jk move · Enter pin · Esc unpin · ⇧↑↓/⇧→ scroll 1/3 │
```

So the glyph, the string and the constant are all sound: **the title row's LAYOUT is what fails**.

## Why every unit arm was green

The chrome arms read the kit DOUBLE, which records props and never performs a layout pass. An element
with `key: "title-fullscreen"` therefore reads as PRESENT while the host lays it out to zero cells. The
captain's own acceptance instrument has the same blindness — it drives handlers and reads props, and it
reported AC8 `fullscreenControlClicked=1` on the very revision whose real terminal draws no control.

**This is the class of defect the contract's PTY requirement exists for**, and it is the concrete
evidence for the honest bound stated everywhere else in this wave: headless arms prove RESOLUTION,
a real terminal proves RENDER, and neither one proves DELIVERY.

## Disposition

Bounced back to the chrome lane as a repair, with: (a) a layout that provably places the glyph in the
REAL host, decided by a PTY pane and not by a double; (b) a check of the same helper on the merged and
workmate pages, which share it; and (c) a test arm that fails on a prop-recording double — or an honest
comment saying that double cannot see layout, rather than an arm that reads as coverage.
