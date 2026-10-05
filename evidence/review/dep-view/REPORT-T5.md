# T5 REVIEW (final) — wave `mpd-tui-dep-view` — findings only

## LATE RECONCILIATION (07:36:52Z, HEAD `0c3654b7`, tree still moving)

The wave landed the W2 consumer (`src/dashboard-key.ts`, `src/settings.ts`, `src/index.ts`,
`src/scenes.ts`, docs) while this review ran, so three findings changed state and one NEW red appeared:

* **F1 — HALF CLOSED.** `agent-references/seam-adapters.md:144` was rewritten (it now says Ctrl+A
  opens the SAME panel "whenever the workspace's team projection holds a team with ≥1 task … and never
  at all when there is no team"). **`docs/tui.md:273-274` still says "No input, rewind, session-switch
  or compact interception is claimed" and `:495-496` "no interception is claimed"** — `docs/tui.md` IS
  in the diff, but that sentence was not touched. Still open.
* **F3 — CLOSED, correctly.** `dashboard-key.ts` orders the guards BEFORE the stop: `input === "a"` →
  `key.ctrl === true && key.meta !== true` → `deps.enabled()` → `deps.mergedSceneAvailable()` → team
  with ≥1 task (read at KEYPRESS time) → `typeof stop === "function"` → `stop.call(event)` →
  `openMergedScene()`, whose refusal is logged, not swallowed. Residual NOTE: if the scene seam is
  available but `open` refuses at that moment, the key is still consumed and only a debug line says so.
* **F12 — CLOSED, correctly.** The consumer avoids the hook-order trap: a `whenHostInput` subscription
  (exactly-once) bumps `useState` and the effect attaches on that later render
  (`React.useEffect(() => tui.whenHostInput(() => setArmed((p) => p + 1)), [])`).
* **F2 — STILL OPEN.** `hostInputEmitter()` only checks that `prependListener`/`removeListener` are
  functions; there is no identity check of the context value, so a foreign `ui.js` copy stays silent.
* **F14 — the `▶` arms were fixed** (`team-surface.test.ts` +122/-6) and **a NEW red replaced them**:
  `bun test packages/mpd-tui-plugin` → **145 pass / 4 fail**, all four about the new settings knob:
  * `plugin contract > every config key has a default in the schema` (`plugin.test.ts:275`) — the new
    config key has no declared default;
  * `full composition … > every seam activates …` (`plugin.test.ts:388`) —
    `expect(calls.sections[0].fields).toHaveLength(25)` → **Received length: 26**;
  * `settings section disclosure (t21) > every slot hint LEADS with the knob's human sentence …` and
    `> the registered section's 22 rows mirror the declaration` — the index/count-pinned arms shifted
    when the knob was inserted into the shared declaration.
  Root cause is ONE omission (no schema default) plus ONE pinned convention (`SETTINGS_KNOBS` count
  and the index-based disclosure arms). This is the answer to attack item 3: the knob does NOT yet
  follow the declared-knob pattern end to end.

HEAD `0c3654b751729a05bed9043314f2e89e7140f6fe` (branch `dev`), read at **07:27:41Z**, re-read
**07:32:44Z**, **07:33:29Z**, **07:34:53Z**, **07:35:35Z** — same hash every time, but **the tree moved
under the review** (T2/T3/T4 all wrote while I measured). Every verdict below carries its instant. All
evidence artifacts: `evidence/review/dep-view/` (`gates/*.log`, `probe-arrows.ts`, `probe-baseline.ts`,
`probe-candidates.ts`, `baseline/graph.ts` = the HEAD control copy).

## Gate state at the final measurement (07:35:35Z)

| command | result |
|---|---|
| `bun test packages/mpd-tui-plugin/test/graph.test.ts` | **0 fail**, exit 0 |
| `bun test packages/mpd-tui-plugin` | **144 pass / 4 fail**, exit 1 — all 4 = F14 |
| `bun test packages/mpd-tui-adapter-plugin` | **25 pass / 0 fail**, exit 0 (incl. `no-direct-tui-access` + its `--self-test`) |
| `node scripts/verify-comment-coverage.ts` | **FAIL, exit 1** — 4 violations, all F9 |
| `bun run typecheck` | **exit 1** — only F10's pre-existing errors, none in `packages/**` |

---

## OPEN FINDINGS

### F1 — BLOCKER (C6/C7): the repo now contradicts itself about Ctrl+A.

* `agent-references/seam-adapters.md` gained a new section ("The ONE contact that is not a seam: the
  host input bus (2026-10-05)") that honestly documents the contact — **and 100 lines below it, the
  older paragraph is untouched**: `:144` "… it opens on MPD's own combo (`alt+a`), and **`Ctrl+A` is
  never bound**."
* `docs/tui.md` is **not in the wave's diff at all** (`git status --porcelain docs/` → empty):
  `:273-274` "**No input, rewind, session-switch or compact interception is claimed.**" and
  `:495-496` "no interception is claimed."

The AGENTS.md §6 paragraph the wave added is right; these two are now false. T6 owns `docs/**` and
`agent-references/**`, so both must change in the integration commit.

### F14 — BLOCKER (live regression): the legend broke 4 PRE-EXISTING team-surface tests, and the
signal is real, not a stale assertion.

```
$ bun test packages/mpd-tui-plugin            # 07:35:35Z → EXIT=1
 144 pass / 4 fail
(fail) the team scene's focus > ↑/↓ moves the focus through the drawing, and the ▶ marker moves with it
(fail) the team scene's focus > `esc` UNPINS rather than closing, and closes once nothing is pinned
(fail) the team scene's focus > a CLICK pins a task and hovering previews one, without the keyboard
(fail) the team scene's focus > a click on BLANK space unpins rather than pinning nothing
error: expect(received).not.toContain(expected)   Expected to not contain: "▶"
Received: "… ▼/▸ blocker above → dependent below · ▶ focus lights its chain ✓ completed · …"
      at packages/mpd-tui-plugin/test/team-surface.test.ts:1019 (also :1061, :1084, :1111)
```

`git status --porcelain packages/mpd-tui-plugin/test/team-surface.test.ts` → **empty**: the file is
pre-existing and unmodified. Those four arms assert that with nothing focused the scene does **not**
contain `▶` — a property the legend's fixed text destroys, because `▶ focus` is now always on screen.
So `▶` has stopped being a focus-exclusive signal: any consumer (or future test) that greps the scene
for it gets a false positive. The wave must either reconcile those arms deliberately (accepting and
recording the new meaning) or make the legend visually distinct — but it cannot ship a red package
suite. **This is the wave's only user-visible-output regression that I could prove.**

### F2 — MAJOR: the module-identity failure mode is SILENT, and the documented "falsifier" cannot
falsify it.

Measured against the real host modules:

```
typeof em.prependListener: function
order with real InputEvent: mpd-prepend                    ← prepend + stop work; both host listeners skipped
InputEvent instanceof Event: true
order with a NON-Event object: mpd -> host                 ← the stop is ignored unless args[0] instanceof Event
StdinContext default: internal_querier: null, isRawModeSupported: false, a fresh EventEmitter
```

`lib/types/ink/hooks/use-stdin.js:7` = `useContext(StdinContext)`; the default
(`ink/components/StdinContext.js:6-13`) carries `internal_eventEmitter: new EventEmitter()`; the real
provider (`ink/components/App.js:216-223`) supplies the App's own emitter and
`internal_querier: this.querier` (`App.js:76`, never null). A second module copy therefore subscribes
to an emitter nobody feeds — **the takeover is simply absent and nothing is logged**.
`agent-references/seam-adapters.md` now says "the PTY lane `skills/dsh-qa/scripts/tui-deps-ctrla.ts` is
the falsifier". A PTY lane stages and pins ONE install, so it proves the takeover works *on that
install*; it cannot falsify "a different copy was preferred". The cheap real falsifier is a positive
identity probe inside the status-view component (presence-check `internal_querier`; absent → ONE log
line, register NO listener).

### F3 — MAJOR: intercept-then-fail is a DEAD KEY; the guard must run BEFORE the stop.

`dsh-adapter/scenes.js`: `open(id)` → `openScene()` returns **false and warns** when no scene is
registered; `register()` **throws** on a duplicate id / no live activation and returns a real disposer
only when accepted. `screens/Chat.js:3834-3842` is exactly the handler that the stop suppresses. If the
intercept fires and the open is refused, ctrl+a does nothing. The plugin can know without new host
contact: gate the stop on "the host gave me a disposer for `mpd-tui-subagents`".

### F4 — MAJOR: `ctrl+a` is user-REMAPPABLE; the intercept also bypasses the host's own precedence rules.

`shortcuts.d.ts` states the host's rule: reserved combos are refused so "collisions can never reach the
matcher — **and it follows user remaps made in /settings**", and "Overlays (pickers, dialogs, scenes,
the session browser) own the keyboard while open; shortcuts match only in the plain chat state".
`keymap.js:169` (dashboard default `ctrl+a`) vs `keymap.js:291` (`ctrl+a` fixed-reserved for editor
line-start). A user who remaps `dashboard` to another combo keeps line-start on `ctrl+a`; the intercept
takes it anyway and reports nothing. Decide and write it down.

### F12 — MAJOR (consumer-side, code not yet written): the hook-order + probe-settle trap.

`hostInput()` is `undefined` until the async probe settles (`void probeHostInput(...)` in the adapter's
apply), so the naive shape `const stdin = input ? input.useStdin() : undefined` **violates the rules of
hooks** — the hook count changes between the render before the settle and the one after, and React
throws inside the host's `PluginStatusViewBoundary` (the component is blanked, the takeover never arms).
The correct shape is a `whenHostInput` subscription that forces a re-render and an INNER component that
calls `useStdin()` unconditionally on every render. Acceptance arm: mount, resolve the probe AFTER the
first render, assert the listener attached with no further host-side re-render.

### F9 — MAJOR: `verify:comment-coverage` is RED — 4 violations, all in the captain's new QR script.

```
$ node scripts/verify-comment-coverage.ts          # 07:32Z → EXIT=1
VERDICT: FAIL — 4 violation(s) across 1 file(s).
skills/dsh-qa/scripts/tui-deps-ctrla.ts (4)
  356: comment — control   357: comment — controlFailedAsRequired
  361: comment — delta     362: comment — revisionFile
```

No lane file violates the gate; C7 requires it green.

### F8 — MINOR: `isReturn` diverges from the host's own `isPlainReturnInput`.

Lane `subagent-scene.ts` (`function isReturn`): `… || input === "\r" || input === "\n"`, and the guard
list is `ctrl | meta | shift` — **no `super`**, and the scene's `SceneKey` interface has no `super`
field. Host `utils/modifiers.js:28-30,36-47`: `!key.ctrl && !key.meta && !key.shift && !key.super`, and
the raw fallback is `/^[\r\n]+$/u.test(input)`. So (a) macOS Cmd+Enter opens the MPD detail where the
host's own dashboard refuses it, and (b) a raw `"\r\n"` chunk does NOT open it although the comment
claims "both spellings are accepted". C5 asks for parity with the host dashboard.

### F6 — MINOR: an arrowhead's tone can disagree with the edge feeding it.

In the boxes layout the `▼` is painted with `entryTone` (the CHILD's tone) while its connector uses
`edgeTone` (chain only while BOTH ends are in the focus chain) — with a focus set, a `dim` edge can
terminate in a `chain`-tone arrowhead.

### F5 — MINOR (documentation): the interceptor's lifetime is a status row's lifetime.

`screens/Chat.js:4361` renders status views only as `activePreview === null && statusViews.map(...)`,
and every exclusive surface early-returns before it (`Chat.js` render early returns at 4104, 4122, 4145,
4188, 4201, 4207, 4223, 4235, 4265 → interrupt panel, plugin scene, supervisor, tree, settings, subagent
detail, jobs panel, host dashboard, scene). That is what gives the takeover its "plain chat state only"
property for free — and it also means ctrl+a cannot switch to the MPD panel while the host dashboard is
already open. Write both down and prove the first in the PTY lane.

### F10 / F13 — NOTEs

* `bun run typecheck` is red only for 4 pre-existing errors in
  `skills/programming/scripts/typescript/check-no-excuse-rules.ts` (TS2307 ×3, TS7006), a tree-clean
  vendored path; zero errors in `packages/**`. C7's "typecheck green" needs this fixed or exempted.
* Unpinned candidate resolution is **order**-inferred (adapter module dir walk → `process.argv[1]` dir
  walk → every profile under `DSH_HOME` / `~/.dsh` / `~/.dsh-tui`). Measured on this machine: exactly
  ONE host install (`~/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui`, a real dir),
  the `web` profile carries only `@mpd-dsh`, no ancestor `node_modules` carries the host, and the pin
  (`MPD_DSH_TUI_HOST_ROOT`) is unset — so today's order is correct. A **pin is now EXCLUSIVE** (verified
  in the source: `if (typeof pinned === "string" && pinned.length > 0) return [pinned]`), which is the
  right call. The PTY lane should assert the logged `host contact bound: <root>` equals the profile it
  launched.
* At 07:32Z T3 had produced nothing on disk (no `dashboard-key.ts`, adapter unmodified, consumer files
  absent); by 07:34Z the adapter side had landed (host-contact resolver + `hostInput()` +
  `whenHostInput()`), while the plugin-side consumer was still absent at 07:35:35Z.

---

## CLOSED DURING THE REVIEW (found, then fixed by a lane — evidence the assertions have teeth)

| found (instant) | evidence | state |
|---|---|---|
| legend named only `▼` while the RAIL draws `▸` (8 ≤ cols ≲ 70) | `probe-arrows.log` @07:31/07:33: `legendMentions▼=true drawingHas▼=false drawingHas▸=true legendMentions▸=false` | **fixed by 07:35** — the legend now reads `▼/▸ blocker above → dependent below · ▶ focus lights its chain` (and `▼/▸ arrow` at 16/24) |
| a trailing blank cell at cols=24 (HEAD control: none) | `probe-arrows.log` @07:31 `trailingBlankCell:true`; `probe-baseline.log` HEAD `false` | **fixed by 07:33** (`rail24-current.log`: every rail row `endsWithSpace=false`) |
| the lane's own `graph.test.ts` 19 pass / 3 fail + TS2345 at `:179/:197` | `graph-test.log` @07:30:48 | **fixed by 07:32** (green; the tone-collapse arm was narrowed to `mode === "boxes"` — my HEAD control proves the rail never collapsed, so the narrowing is honest) |
| adapter negative control "a probe with no reachable host degrades to absent" FAILED — `Received: { useStdin: [Function: useStdin] }` | `adapter-final.log` @07:34:53 → EXIT=1 | **fixed by 07:35:22** (25/0) once the pin became exclusive |

Residual on the legend: at exactly 8 cols it now returns `[]` (the tersest variant outgrew the declared
`MIN_LEGEND_COLS = 8` floor), and in boxes mode the line names `▸`, a mark that layout never draws
(acceptable — the legend explains both layouts).

## WHAT I VERIFIED AS CORRECT

1. **The mechanism works on the host's real emitter** (measured, above): `prependListener` inherited
   from Node's `EventEmitter` (`ink/events/emitter.js:7`), the overridden `emit` iterating
   `rawListeners(type)` in array order (`:25-42`), the stop honoured only for `instanceof Event`
   (`:34-39`) — which the host's `InputEvent` is.
2. **The contact is not gratuitous.** `ctrl+a` is unreachable through any seam: `tuiShortcuts` refuses
   the reserved combo; `tui/input` is a submit-text decision, not a keypress; only 3 host modules name
   `internal_eventEmitter` (no `tui*` service exposes the bus; 14 services enumerated); the status kit
   deliberately omits `useStdin` (`status.d.ts:29-33`) and strips key/focus props (`:22`,
   `TuiStatusViewForbiddenBoxProps` includes `onKeyDown`/`onFocus`/`tabIndex`). The adapter's own
   comment block states the silent-default failure correctly.
3. **Arrow geometry, re-derived from the render** (`probe-arrows-final.log`): one edge → `▼` exactly on
   row `child.row − 1` at the child's centre, `┬` on the parent's bottom border, `┴` on the child's top
   border; fan-in of two → exactly ONE `▼`; the arrow row is inside NO hit rectangle; 9 hit rectangles,
   0 mismatches; every row ≤ cols at 24/40/70/100 (24/24, 40/40, 69/70, 99/100) with no trailing blank.
4. **Baseline control** (`git show HEAD:…` copy): `▼count=0` at HEAD, so the arrow is entirely new; the
   lane replaced exactly one connector cell (`│` → `▼`) and left the rectangles alone.
5. **Adapter host-contact design** (read at 07:34Z): env pin first and EXCLUSIVE, file-URL import,
   callable-`useStdin` shape check, one diagnostic line either way, never throws, `whenHostInput()`
   (exactly-once, disposer) removing the probe race, and `hostInput()` documented as a hook callable
   only during a render.
6. **Scope/lock discipline**: no lane touched a file outside its declared scope; `package.json` /
   `bun.lock` / `packages/*/package.json` untouched (**no new npm dependency**); no `dist/**` touched
   (**no lane dist rebuild**); frozen ids/titles intact (`TEAM_SCENE_ID`, `PLAN_SCENE_ID`,
   `SUBAGENT_SCENE_ID` — the only `SCENE_ID` hit in T4's diff is a context line);
   `no-direct-tui-access` PASS with its seeded negative control.

## WHAT I COULD NOT VERIFY WITHOUT A REAL TERMINAL

* End-to-end key delivery: that a live ctrl+a reaches the prepended listener and that the stop really
  suppresses the dashboard open (I verified the emitter's semantics with the host's own modules, not a PTY).
* That the resolved host copy is the SAME module instance the running TUI uses (F2's canary is the proof;
  only a live boot exercises it).
* That MPD's status-view component is mounted in the host's plain chat state (source-verified branch).
* T6's PTY negative control, and anything about the consumer's written code (absent at 07:35:35Z).

## MUST NOT HAVE (re-stated; the wave holds all of these today)

a second host-contact site outside `packages/mpd-tui-adapter-plugin`; any edit to a DSH-TUI file;
`dist/` rebuilds by a lane; a new npm dependency; any change to the frozen scene ids/titles; behaviour
changes outside the declared scopes. **ADDED**: no interception without a positive host-module identity
check (F2); no `stopImmediatePropagation()` before the plugin's own scene registration is known-good
(F3); no doc sentence claiming a sanctioned seam for ctrl+a — and none left claiming there is none (F1).

## AI-SLOP ASSESSMENT

Not slop: the legend's variant ladder (the smallest shape that satisfies "never a truncated falsehood"),
the GLYPH-derived key (no second spelling of the state marks), and the adapter's counted-contact
discipline. The slop-shaped risk is the opposite of duplication: reaching an unexported host internal
whose alternative must be argued where a reader meets it — the adapter's comment block does exactly
that, and that is the standard the rest of the wave should match.

## THE SINGLE CHANGE I WOULD MAKE FIRST

**Fix F14 before anything else** — reconcile the four `team-surface.test.ts` arms (and the meaning of
`▶` as a focus signal) in the same commit as the legend, because that is the one finding already
observable in the shipped output and currently red. Then, before the intercept is written, add the
F2+F3 guard pair (identity canary + registration precondition): both of those failure modes are
invisible in a demo.
