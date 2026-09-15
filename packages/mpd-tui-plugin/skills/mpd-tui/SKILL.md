---
name: mpd-tui
description: Use when a user in a DSH-TUI session asks for the mpd board, the mpd status line, or the workmate library — and when explaining which mpd capabilities are TUI-native and which are still web-only.
---

# MPD TUI surfaces

The `@mpd-dsh/mpd` bundle ships a TUI-native surface pack (row `mpd-tui`,
package `packages/mpd-tui-plugin`). In a `dsh-tui` profile it provides:

- **`/mpd`** — opens the full-screen board, prints the status line, or lists the
  workmate library. Subcommand completion is contributed through the TUI
  command-tree seam.
- **`alt+m`** — open the board (team + task ledger, boulder work ledger, plans,
  workmate library).
- **`alt+w`** — pick a workmate from the durable library through a host dialog,
  then open the board.
- **`alt+r`** — recompute the keyed status line immediately.
- **Status line** — one `mpd` contribution above the prompt:
  `mpd: team <name> <members>·<done>/<total> · boulder <active>/<works> · plans <n> · workmates <n>`.
- **Transcript renderers** — the bundle's log-only session events
  (`agent-teams/*`, `mpd-tui/board-opened`) render as plain text rows, live and
  on replay.
- **`/settings` section** — the mpd.jsonc knobs declared as editable fields; every
  hint states on screen that a save **is written** to `<workspace>/.mpd/mpd.jsonc` for the
  live session workspace(s) and that its behaviour change **needs a restart** (the knobs are read
  at plugin mount). The pre-t35 "not bridged" claim is deleted.

## What is NOT claimed (say this plainly, do not over-claim)

1. **The decision-event seam is not active.** `tui.dsh/v1alpha1#DecisionEvents`
   cannot be registered by a profile-installed plugin (admission is
   token-gated and unreachable). The plugin attempts the mediated registration,
   expects the refusal, warns once, and intercepts nothing: no input, rewind,
   session-switch or compact hook exists.
2. **The `/settings` section is bridged to `.mpd/mpd.jsonc` (t35), with a
   RESTART for the behaviour change.** The section declares the real mpd.jsonc
   knobs and edits them under the harness settings namespace `mpd`;
   `mpd-config` observes that namespace through the adapter's settings seam and
   rewrites the value into `<workspace>/.mpd/mpd.jsonc` (comments and key order
   preserved) for the live session workspace(s). The config layer sees the value
   immediately; the *plugins* read their config at mount, so the behaviour
   change waits for a restart. With no live session there is no workspace to
   write to: the save stays in settings and the surfaces say so. The field hints
   carry that two-part statement on screen.
3. **The web-only surfaces have no rendering face in the TUI.** The agent-teams
   sidebar, the workmate tab and the bundle floater do not render there; the
   board, status line and dialogs are *equivalents*, not parity.
4. **The packaged skill under `packages/mpd-tui-plugin/skills/` is not served.**
   The skill corpus is served from `<bundle>/skills` by `mpd-bootstrap`; this
   package-local copy is an asset only.

## Working notes for an agent

- State is read from the **calling session's workspace** (`.mpd/team`,
  `.mpd/boulder.json`, `.mpd/plans`) plus the user's workmate library under
  `$HOME/.mpd/workmate`. Nothing is written.
- If a surface is missing in a session, check the boot log for
  `mpd TUI surfaces: …` — a web profile logs
  `no DSH-TUI service is composed in this profile`.
- Do not "fix" a missing seam by mounting the package a second time: the bundle
  patch owns the `mpd-tui` row id, and a duplicate loader entry id is rejected.
