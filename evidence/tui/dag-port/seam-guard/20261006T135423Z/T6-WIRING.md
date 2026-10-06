# T6 — wiring the two independent pages (`dag`, `workmate`), and the R26 wording hand-off

## What I changed (three files, adapter NOT touched)

| File | Change |
|---|---|
| `packages/mpd-tui-plugin/src/index.ts` | imports `registerDagPanel` / `registerWorkmatePanel`; registers both pages after the merged `team` panel with `enabled: resolved.panel`; adds `openPage()` (the same four-state arbitration `panel.ts` owns for the merged view); reports `dagPanel` / `workmatePanel` outcomes + the discovered ids in the boot diagnostic; adds the two actions to the bare-`/mpd` picker |
| `packages/mpd-tui-plugin/src/commands.ts` | `CommandActions.openDag()` / `openWorkmate()` (typed `PanelRoute`); `/mpd dag` and `/mpd workmate` handlers print `pageLine(slug, route)` = `"dag · " + panelStatusLine(outcome, id)` |
| `packages/mpd-tui-plugin/src/command-trees.ts` | `COMMAND_ACTIONS` gains `dag`, `workmate`; two bilingual `COMMAND_CHILDREN` rows |

Lane discipline kept:

- **Adapter-only seam contact**: both pages register through the `TuiAdapter`
  (`tui.registerPanel`) — `packages/mpd-tui-adapter-plugin/src/index.ts` was NOT edited, so there is
  no 12-target dist fan-out (verified: the adapter's dist is FRESH).
- **Budget**: three panels on one activation (`team`, `dag`, `workmate`) against the host's
  `MAX_PANELS_PER_PLUGIN = 4` (`lib/types/dsh-adapter/panels.js`).
- **Slugs**: `dag` and `workmate` both satisfy the host's `SUB_ID_PATTERN ^[a-z][a-z0-9_-]*$`; the
  pre-prefix half is ours, the `<pluginId>:` half stays the host's (read back, never predicted).
- **Arbitration intact**: `alt+a` and `/mpd panel` still call `panel.openOrScene()`; the new pages call
  `openPage(page)` with the same vocabulary and each page's own scene fallback
  (`dag` → the merged subagents scene, `workmate` → the board scene). `takeoverArmed` and the legacy
  Ctrl+A contact are untouched.
- **Every page prints its own id**: `/mpd panel`, `/mpd dag`, `/mpd workmate` each name the final host
  id they went to, which is the only way a user can learn `<pluginId>:<slug>` (R25).

## The one test file that must change (NOT in this lane's write scope)

`packages/mpd-tui-plugin/test/plugin.test.ts` still asserts the OLD one-panel contract, so
`bun test packages/mpd-tui-plugin/test/` is red on it (279 pass / 2 fail; the other red is
`dag-fidelity.test.ts` R19 ownership). Exact edits needed, in the "full composition" test:

```
// line ~411-420
-    // tuiPanels (dsh-tui 0.13.0): ONE sidebar panel, with the FROZEN descriptor ...
-    expect(calls.panels).toHaveLength(1)
+    // tuiPanels (dsh-tui 0.13.0): THREE panels — the merged view plus the two independent pages
+    // (frozen R1/R12) — each with its own frozen descriptor and its own discovered id.
+    expect(calls.panels).toHaveLength(3)
     expect(calls.panels[0].apiVersion).toBe(1)      // team  (unchanged)
     ...
+    expect(calls.panels[1].id).toBe("dag")
+    expect(calls.panels[1].title).toBe("MPD DAG")
+    expect(calls.panels[1].icon).toBe("◈")
+    expect(calls.panels[1].order).toBe(11)
+    expect(calls.panels[2].id).toBe("workmate")
+    expect(calls.panels[2].title).toBe("MPD workmate")
+    expect(calls.panels[2].order).toBe(12)
+    expect(outcomeOf(report, "dagPanel").state).toBe("confirmed")
+    expect(outcomeOf(report, "workmatePanel").state).toBe("confirmed")
```

(the exact slugs/titles/orders live in `panel-dag.ts` / `panel-workmate.ts` and their own tests; the
assertion must read them from those modules rather than restate literals where the file already imports
them).

## R26 — the honest sentence (hand-off to `panel-surface` + `i18n.ts`)

`i18n.ts` key `panel.opened` is the false green. It currently claims a panel "opened" when all the
command actually knows is that the host composed an id and acknowledged the request. Replacement text
(one sentence changed ONCE, so all three pages inherit it through `panelStatusLine`):

```ts
  "panel.opened": {
    zh: "mpd 侧栏面板：宿主已接受 {id}；若没有出现面板，请在 /settings → 侧栏里把 {id} 加入面板列表，并按 Ctrl+B 展开（或开启“启动时展开侧栏”）",
    en: "mpd sidebar panel: the host accepted {id}; if no panel appeared, add {id} to the panel list in /settings → side panel, then press Ctrl+B (or turn on \"Side panel starts open\")",
  },
```

Why this wording and not a shorter one: it states only what was measured (the host accepted the id and
the open request), and it names the STEP that makes the panel visible — the two host switches this lane
root-caused. `panel.fallback` / `panel.refused` / `panel.unavailable` need no change: each already
describes something the code really knows. `/mpd dag` and `/mpd workmate` reuse whichever sentence
`panelStatusLine` returns, so they inherit the fix with no second edit.

## HOP RECORD — `packages/mpd-tui-plugin/test/plugin.test.ts` (granted by the captain)

WHY A HOP WAS NEEDED: the test file was not in this lane's declared write scope, but it asserted the OLD
one-panel contract (`expect(calls.panels).toHaveLength(1)`), so MY wiring turned it red. The captain
granted the file for exactly this amendment, on the condition that (a) only what my change invalidated is
touched, and (b) the grant is recorded here rather than looking like an unauthorised write.

WHAT WAS AMENDED (nothing else in the file):
- `calls.panels` length 1 → 3, with the two new descriptor blocks (`dag`: id/title `MPD DAG`/icon `◈`/
  order 11/minColumns 28; `workmate`: id/title `MPD workmate`/icon `◆`/order 12/minColumns 28) and the
  two new outcomes (`dagPanel`, `workmatePanel`, `confirmed` with their `act0:` ids), and the comment
  now states WHY three is the composition's own ceiling (the host's `MAX_PANELS_PER_PLUGIN` = 4).
- ONE neighbouring value, changed because the captain's own template ruling moved it, NOT because of my
  diff: the merged panel's `minColumns` assertion 32 → 28 (`panel.ts` `PANEL_MIN_COLUMNS` is 28 after
  the 32→28 ruling that closed the `panel-too-narrow` band). Left as a separate note here so an
  amendment is distinguishable from a rewrite.
- Nothing else: no assertion was relaxed, added or reordered.

BOUNDS: the bare-`/mpd` prefix arm (`startsWith("mpd:")`) was left UNTOUCHED and is green: `/mpd status`
still prints `boardSummary(...)` unchanged, and the `dag ·` / `workmate ·` prefixes belong to actions
this wave ADDED, not to the status line.
