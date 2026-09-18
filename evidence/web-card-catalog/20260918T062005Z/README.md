# web-card-catalog (FIX) — the MPD settings card now reaches the LIVE catalog in a real browser

**Domain:** `evidence/web-card-catalog/20260918T062005Z/`
**Subject:** the Web settings dialog's `MPD` section (contributed by this bundle's web client). The
reproducing lane (`../20260918T055042Z/`, kept byte-identical) measured the defect: the three *team
model slot* provider pickers offered only `deepseek-official` while the browser's own catalog carried
two providers, because `modelDirectories.directoryFor()` **threw**
`cannot get property "remote.session" without inject` — cordis services are CALLER-scoped.

## Verdict in one paragraph

**Fixed and proven in a real browser.** Both live-catalog acquisition sites now declare the
caller-scoped chain (`remote.session`) in the **dynamic** `ctx.inject([...])` list — never in the
module's declared `inject`/`REQUIRED_SERVICES`. The offline harness gained a caller-scoped service
model (a method that throws unless the *calling* ctx declared the dotted seam), four new/changed test
arms are RED on the pre-fix artifact and GREEN after the rebuild, and the acceptance run against the
rebuilt served bytes renders the card's status line **`live catalog — 2 providers · 31 models`** with
all three slot provider pickers offering `deepseek-official` **and** `opencode-go`, and **zero**
`[mpd]`-prefixed console events.

## The edits

| # | File · symbol | Before | After |
|---|---|---|---|
| 1 | `packages/mpd-bundle-plugin/src/settings-card.js` · `createLiveCatalog` → returned `start()` | `hostCtx.inject(["modelDirectories", "sessions"], (scoped) => bind(scoped))` | `hostCtx.inject(["modelDirectories", "sessions", "remote.session"], (scoped) => bind(scoped))` |
| 2 | `packages/mpd-bundle-plugin/src/team-page.js` · the `catalogFiber` assignment inside `registerTeamSidebarTab` | `ctx.inject(["modelDirectories"], (catalogCtx) => …)` | `ctx.inject(["modelDirectories", "remote.session"], (catalogCtx) => …)` — `sessions` is deliberately NOT listed: that page never reads it |
| 3 | `packages/mpd-bundle-plugin/src/settings-card.js` · `bindDirectory`'s `catch` | swallowed the throw and reported `the host resolved no model directory for this session` | appends the rejected seam (`…: cannot get property "remote.session" without inject`, capped at 160 chars) — the degrade is visible AND named, which is what kept this defect silent |

Doc comments in both files were rewritten to state the measured rule (first-level seams such as
`this.ctx.remote` are satisfied by the RESOLVER's own `static inject`; only DOTTED seams are
re-rooted at the CALLER's injection fiber — so `remote.session` is necessary, `remote` is not). The
dynamic-only rule is preserved: a declared-but-unregistered service on a loader ENTRY is page-fatal
(`assertEntriesActive`), a parked dynamic injection merely never fires.

Nothing the previous lane built was weakened: the store subscription, `directory.load()`, the
live/fallback status line + `data-mpd-catalog-*` attributes, the 22 mirrored rows, the parity test,
the one-batch mutate with the revision fence and the `SETTINGS_KNOBS`-free served bytes all stay
(asserted by the same suite, 92/92 green).

## The harness change (`packages/mpd-bundle-plugin/test/client-harness.mjs`)

New export `callerScopedService({ reads, methods })`: a service whose methods receive the CALLER's
ctx and **throw** `cannot get property "<seam>" without inject` when the caller's inject list does
not declare every seam in `reads`. `scopedCtx(deps).get(name)` now returns such a service BOUND to
`deps` (a plain service passes through untouched), which is exactly the measured cordis behaviour:
the service resolved from an injection is bound to the injecting ctx.

## RED → GREEN

Pre-fix artifact sha256 `d481554e73b6feecc6610b4fc2905cee38575d8cce4eb897ac10232e1af08419`
(byte-identical to the committed pre-fix `client.js`; rebuilt from `git show HEAD:<src>` to be sure).

```
$ bun test ./packages/mpd-bundle-plugin            # pre-fix artifact  -> raw/red-final.log
(fail) … T-E: the LIVE catalog is reached when — and only when — the caller-scoped chain is satisfied
(fail) … T-F: an UNSATISFIABLE caller chain degrades VISIBLY, naming the rejected seam
(fail) … T-D: the SERVED client.js carries the inject acquisition and the fallback marker
(fail) staged plan approval > a CALLER-SCOPED modelDirectories reaches the staged team …
 88 pass / 4 fail   (raw/red-final.log)

$ bun test ./packages/mpd-bundle-plugin            # after the rebuild -> raw/green-final.log
 92 pass / 0 fail / 912 expect() calls
```

T-E also asserts the *mechanism*, not just the outcome: with the pre-fix list the fixture's method
body never runs (`calls.directoryFor === 0` — the rejection happens in the bound wrapper).

## Rebuilt served artifact

```
$ node scripts/build-mpd-client.mjs
[build-mpd-client] wrote packages/mpd-bundle-plugin/client.js (319331 bytes)   # pre-suffix byte count
$ stat -c%s packages/mpd-bundle-plugin/client.js
324561            # on disk: the build appends its sourcemap/path suffix (+5230 bytes)
$ sha256sum packages/mpd-bundle-plugin/client.js
dec392b2ac7586b30a9fd0fbd9666d47bcc7af34bf8e312c5afa0628dbfd5b2b
```

Cross-check with the SERVED bytes: the host answers the combo URL
`/plugins/??…,@mpd-dsh/mpd/client.js&rev=…` with **324646** bytes = 324561 + **85** — the same 85-byte
sourcemap suffix the reproducing lane measured, i.e. the browser really loads THIS artifact
(`raw/step7-result.json → servedClient.mpdClientUrls[0]`).

Byte greps on the built artifact: old-form settings-card list `ctx.inject(["modelDirectories", "sessions"]`
→ **0**, `ctx.inject(["modelDirectories"]` (old team-page list) → **0**, `SETTINGS_KNOBS` → **0**,
and both new call sites present (`fiber = hostCtx.inject(["modelDirectories", "sessions", "remote.session"]`,
`catalogFiber = ctx.inject(["modelDirectories", "remote.session"]`). The same markers are re-checked
on the bytes the **host actually serves** in the acceptance run (`step7` → `servedBytesCarryFix: true`).

## THE ACCEPTANCE PROOF (real Chrome over CDP, real sandboxed `dsh web` host)

Driver: `step7-acceptance.mjs` (step3's scaffolding; the fixed nav locator the reproducing lane's
phase 3 lacked). Flow: hydrate → open Settings → **MPD** (baseline) → Escape → `session/create` over
the host's own RPC → make it current through the app's own store (`sessions.list.set` on the captured
scoped ctx — an **EXPLICIT state injection, NOT a UI drive**; the workspace picker is a native dialog
headless CDP cannot operate) → re-open Settings → MPD → read the card.

```
PHASE A card (no session bound):  declared fallback — live catalog unavailable (no session is bound)
PHASE C card (session current):   live catalog — 2 providers · 31 models
PHASE C attrs: {"data-mpd-catalog-state":"live","data-mpd-catalog-providers":"2","data-mpd-catalog-models":"31"}
slot provider pickers (verbatim, all three identical):
  teamModels.slot1.provider -> ["", "deepseek-official", "opencode-go"]
  teamModels.slot2.provider -> ["", "deepseek-official", "opencode-go"]
  teamModels.slot3.provider -> ["", "deepseek-official", "opencode-go"]
slot model pickers (verbatim count): 32 options each ("", deepseek-flash … muse-spark-1.3-contributor)
browser's own catalog (session/modelCatalog): 2 providers / 31 models / [deepseek-official, opencode-go]
console: 14 events total, 0 with the [mpd] prefix
VERDICT ok=true  (raw/step7-result.json, screenshot raw/step7-phaseC-card-with-session.png)
```

## Gates on the final tree

| Command | Result |
|---|---|
| `bun test packages/mpd-bundle-plugin` (task spelling; substring filter, 324 files) | **92 pass / 0 fail** — `raw/green-task-spelling.log` |
| `bun test ./packages/mpd-bundle-plugin` (path-qualified, 4 files) | **92 pass / 0 fail** — `raw/green-final.log` |
| `bun test ./packages/mpd-config-plugin` | **81 pass / 0 fail** — `raw/config-plugin-tests.log` |
| `bun run typecheck` | exit 0 — `raw/typecheck.log` |
| `node scripts/verify-dist-fresh.mjs` | exit 0, `ok: 20/20 targets fresh`, 7 NOT COVERED listed — `raw/dist-fresh.log` |

## What was NOT proved

1. **The team-page path is not browser-proven.** Its fix is covered by the offline twin arm
   (`staged plan approval > a CALLER-SCOPED modelDirectories reaches the staged team`), but the
   sandbox host has no **staged** team, and `directoryForTeam` only runs for `phase === "staged"`.
2. **The session precondition was injected, not driven.** Same limitation as the reproducing lane:
   the composer's workspace picker is a native dialog headless CDP cannot operate, so `current` was
   set through the app's own `sessions.list.set`. The card's own read path (`sessions.list.getSnapshot().current`)
   and its store subscription are what consumed it.
3. **`["modelDirectories","remote.session"]` (no `sessions`) is measured only for the team page** via
   the offline harness; the card keeps `sessions` because IT reads `sessions.list`.
4. **A latent duplicate of the same defect class remains in adopted code**:
   `packages/mpd-agent-teams-plugin/lib/client/ActivityPanel.js` calls
   `modelDirectories.directoryFor(team.captainSessionId)` unguarded inside a React render, and its
   plugin declares a STATIC `inject = ['conversationEvents','slots','sessions','locale','modelDirectories']`
   without `remote.session`. It is **not reachable in this bundle today** — `src/team-page.js` states
   it deliberately does not render the adopted `ActivityPanel`, and the adopted client's `apply()` is
   never called — so it is reported, NOT fixed (a static addition there would be page-fatal, and any
   change to adopted `lib/` must go through `scripts/patch-agent-teams-fixes.mjs` + `--write-registry`).
5. **9 app-level console exceptions** (`AgentPresetSeatController.currentSession` →
   `cannot get required service "sessions" in inactive context`) appear in the acceptance run. They
   are from the host's own frontend, carry no `[mpd]` marker, and appear in the pre-fix lane as well;
   they are NOT attributed to this change, but they are also not explained here.
6. `packages/mpd-bundle-plugin/client.js` is a derived artifact: per T-88 it belongs to the
   integration task's `inScope`, and this lane rebuilt it with `node scripts/build-mpd-client.mjs`.
   **No git write command was run.**

## Artifacts

`step7-acceptance.mjs` (acceptance driver), `cdp.mjs` + `probe-hook.js` (copies of the reproducing
lane's CDP client and pre-document instrument), `raw/step7-result.json`,
`raw/step7-settings-dialog.html`, `raw/step7-phaseC-card-with-session.png`,
`raw/step3-browser.json` (the pre-fix sequence re-run against the fixed bytes), `raw/red-final.log`,
`raw/green-final.log`, `raw/source-and-test.diff`, `sandbox/` (symlink to the reproducing lane's
gitignored sandbox — credentials were copied once there and are never echoed).

**A superseded intermediate attempt is kept as `step6.log` + `raw/step6-*`** (its driver was
deleted): it bound the session through the ROOT ctx's `sessions` service BEFORE the card had ever
mounted, and the injection did not stick (`sessions after binding: currentId: null`, card still
`no session is bound`). Step7 replaced it with the reproducing lane's proven order — let the card
mount once so the app's own scoped ctx is captured, then inject through THAT service — and that is
the run reported above.
