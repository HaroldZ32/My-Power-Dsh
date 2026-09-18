# web-card-catalog (session binding) — the MPD settings card now finds a REAL live session

**Domain:** `evidence/web-card-catalog/20260918T073000Z/`
**Subject:** the Web settings dialog's `MPD` section (contributed by this bundle's web client). The
previous lane (`../20260918T062005Z/`) fixed the caller-scoped `remote.session` inject, and the card
then rendered `declared fallback — live catalog unavailable (no session is bound)` **in the user's real
browser**: `currentSessionIdOf()` resolved nothing, so `directoryFor()` was never even called.

## Verdict in one paragraph

**Fixed and proven in a real browser, with NO synthetic session injection.** The card's session read
assumed `sessions.list.getSnapshot().current` was an object (`{ sessionId }`); it is the session ID
**string**. Measured in a real Chromium against the live host: a workspace registered through the host's
own `workspace/create` RPC makes the app's OWN navigation policy create and open a session, at which
point `current` is a string and `directoryFor(current)` returns `status: "ready"` with 2 provider groups
(`deepseek-official` 4 + `opencode-go` 27 = 31 models) — while the pre-fix card still rendered
`no session is bound` with the three slot provider pickers offering only `deepseek-official`. After the
fix the same run renders **`live catalog — 2 providers · 31 models`**, all three slot provider pickers
offer `deepseek-official` **and** `opencode-go`, and there are **zero** `[mpd]` console entries other
than the single `info` transition.

## Why the earlier acceptance missed this (the circularity, stated plainly)

`../20260918T062005Z/step7-acceptance.mjs` bound the session by writing the app's own store:
`svc.list.set({ ...before, current: { sessionId: id } })`. It **set exactly the field the card reads, in
exactly the shape the card assumed** — so its green proved the inject chain works, not that a real
client ever populates `current` (or in what shape). The offline fixture was circular in the same way:
`{ list: { getSnapshot: () => ({ current: { sessionId } }) } }`. Both are replaced here by the measured
shape, and **no driver in this lane writes client state**: the only occurrences of `sessions.list.set`
in `step*.mjs` are the comments on lines 15/18 that say so (measured — `grep -n 'list\.set(' step*.mjs`
returns no call site).

## The measured session-discovery path (runtime truth)

1. **Register a workspace through the HOST API, BEFORE the app boots.**
   `POST /api/workspace/create` with `payload.args = { request: { path: <sandbox workspace> } }` →
   `{ ok: true, value: { workspace: { workspaceId, path, … }, created } }`.
   The FLAT form fails loud — measured (step2): `gateway/arguments-invalid … args fields do not match
   the descriptor: missing "request"; unexpected "path"`.
2. **The app opens the session itself.** With a workspace present at boot, `dsh-client-ui-workspace`'s
   `watchNavigation().reconcile()` picks `recentWorkspace(...)` and calls `connectWorkspace(workspaceId)`,
   which CREATES a session (`sessions.create({ workspaceId })`) and then `sessions.open(sessionId)`.
   Measured (step4/step6): `workspace.sessionIds` gained `session-33721638-64aa-49fb-8617-18ffafae2a6a`.
   **A workspace created AFTER boot changes nothing** — `reconcile()` latches `initial = "done"` the
   first time the list is ready with no workspace (`dsh-client-ui-workspace/lib/client.js:128-132`) and
   never re-evaluates. That latch is why steps 1–3 measured `current === undefined` for 48 s.
3. **The id is a STRING.** `sessions.list.getSnapshot()` is
   `{ ids, byId, current, phase, subagentsByParent, jobsBySession, currentAddress }` — measured key list,
   byte-for-byte. `typeof snapshot.current === "string"` measured on the live session. The host's own
   consumers agree at source level: `dsh-client-ui-session` passes `current` straight to
   `sessions.binding(current)` (`resolveCurrent()`), and `dsh-api-session-controller`'s `followCurrent()`
   indexes `snapshot.byId[current]`.
4. **The resolver's own requirement is satisfied by that id.** Probed from the CARD'S OWN scoped ctx
   (`ctx.inject(["modelDirectories","sessions","remote.session"], …)`), not from whatever injection fired
   last (an earlier probe version did that and reported a misleading `cannot get property "remote.session"
   without inject` — a PROBE defect, corrected by keying captured scoped ctxs by their dependency list):
   `directoryFor("session-33721638-…")` → `store.status: "ready"`,
   `groups: [{deepseek-official, 4}, {opencode-go, 27}]` → **2 providers / 31 models**.
5. **Fallback also measured.** For every `snapshot.ids` entry, `sessions.scope(id)` and
   `sessions.binding(id)` both resolve (the host mints a listed id's scope lazily:
   `eligible(id) = current === id || ids.includes(id)`), and `directoryFor(listedId)` returns the same
   `ready` / 2 groups / 31 models.

Client `sessions` service surface (measured, 41 keys): `binding, clear, create, eligible, followCurrent,
fork, handleConnected, handleControlFrame, handleSessionActivity, handleSessionAdded, handleSessionError,
handleSessionRemoved, handleSessionStatus, list, manager, materializeScope, open, openSubagent,
projectList, pruneScopes, refresh, refreshSubagents, resolve, resolveAgentScope, rootCtx, scope, scopeDrops,
scopeOf, scopes, search, searchResultLimit, sessionOf, setSubagentCatalogOpen, startScopeDrop,
subagentAddress, sweepDeferred, watched, deferredRemovals, drainScopeDrops, dropScope`. There is **no**
`sessions.get`, no `sessions.all`, and no `sessions.ids` (ids live in the list snapshot).

`getSnapshot()` carries **`ids`/`byId`, NOT `items`** — a source-level detail that would have misled a
fix written from the host type alone.

## The edits

| # | File · symbol | Before | After |
|---|---|---|---|
| 1 | `packages/mpd-bundle-plugin/src/settings-card.js` · `currentSessionIdOf` | `return current.sessionId ?? current.id` (always `undefined` for a string) | a STRING `current` is returned as-is; the object form is still accepted last, so an existing `{ sessionId }` injector keeps working |
| 2 | same file · new `listSnapshotOf` / `listedSessionIds` / `boundSessionIdOf` | — | `current` first; otherwise the first LISTED session for which BOTH `scope(id)` and `binding(id)` resolve (non-`blank` rows tried first). No `open()` is called |
| 3 | same file · `bindDirectory` | `currentSessionIdOf(sessions)` | `boundSessionIdOf(sessions)`; the no-session branch now records whether the list is still ENUMERATING |
| 4 | same file · `publish` / `fallback` | announced a `[mpd]` **warning** on the first fallback, which fires during app BOOT while the session list is still `pending` | the console announce is suppressed while the list is enumerating (the VISIBLE fallback paragraph is unchanged) — a warning means a degrade again |

**Edit 4 is MEASURED, not inferred** (`raw/step8-result.json`, `measurements.injectMoments`): with the
probe recording the session-list fact at the instant every injection fires, the card's own catalog
injection reports

```
["modelDirectories","sessions","remote.session"]  fired=true  listPhase="pending"  idCount=0  currentTypeof="undefined"
```

i.e. the card starts with the plugin, long before the list baseline arrives — `current` is `undefined`,
`ids` is empty, `phase` is `"pending"`. The pre-fix card announced a fallback *there* (step6/step7-pre-fix:
1 `[mpd]` warning as the FIRST console event of the page, before the settings dialog was ever opened).
After the suppression the same run emits **no** `[mpd]` warning. The `phase` is later `"ready"` with the
id string, which is the state the card now binds on.

`packages/mpd-bundle-plugin/src/team-page.js` was **checked and deliberately NOT changed**: its only
`current` read (line 785) flows into `ensurePolling`, which already does
`typeof sessionId === "string" ? sessionId.trim() : ""` (line 278) — it never shared the object
assumption. It also still declines to poll when no session is current, which is correct: it polls the
CURRENT conversation's teams, and substituting another session's teams would be wrong.

## RED → GREEN

Pre-fix artifact (served bytes, old source): after the fixtures were corrected to the MEASURED shape —
**12 of the 99 arms redden**, including the two new real-shape arms:

```
$ bun test ./packages/mpd-bundle-plugin        # pre-fix artifact -> raw/red-offline.log
(fail) … T-G: the MEASURED list shape (`current` is a session ID STRING) reaches the LIVE catalog
(fail) … T-H: with NO current session, a LISTED session that has BOTH scope and binding is bound
(fail) … T-A / T-B / T-E / T-F / D-1 / D-2 / D-3  and the three catalog rendering arms
 87 pass / 12 fail   (raw/red-offline.log)

$ bun test ./packages/mpd-bundle-plugin        # after the rebuild -> raw/green-offline.log
 100 pass / 0 fail / 984 expect() calls
```

The RED is not an artifact of the fixtures alone: the PRE-FIX bytes were served to a real browser with a
real current session and rendered the failure (step4, `raw/step4-result.json`):

```
liveCurrentSessionId            = "session-33721638-64aa-49fb-8617-18ffafae2a6a"
directoryProbeOnCardCtx.currentTypeof = "string"
directoryProbeOnCardCtx.store   = {"status":"ready","groups":[{"id":"deepseek-official","models":4},{"id":"opencode-go","models":27}]}
directoryProbeOnCardCtx.providers = 2, models = 31
card.statusText                 = "declared fallback — live catalog unavailable (no session is bound)"
slot provider pickers           = ["","deepseek-official"] x3
```

That isolates the defect to exactly ONE thing: the card's shape read of `current`. The inject chain, the
session id, and the resolver were all already correct in that very run.

## Rebuilt served artifact

```
$ node scripts/build-mpd-client.mjs
[build-mpd-client] wrote packages/mpd-bundle-plugin/client.js (327198 bytes)
$ stat -c%s packages/mpd-bundle-plugin/client.js
332454
$ sha256sum packages/mpd-bundle-plugin/client.js
c683ba23b48024469a0f4f6a2031dc2b1d0a25de1c7ce04ecb8c8687d1c12daf
```

(Served in-page by the sandbox profile's `node_modules/@mpd-dsh/mpd -> <repo>` symlink, so the browser
runs these bytes; the harness reads the same file.)

## Gates

| Command | Result |
|---|---|
| `bun test ./packages/mpd-bundle-plugin` | 100 pass / 0 fail (4 files) |
| `bun test packages/mpd-bundle-plugin` | 99 pass→100 pass / 0 fail, but discovers **324 files** (T-89 substring filter; harmless here, same verdict) |
| `bun test packages/mpd-config-plugin` | 81 pass / 0 fail |
| `bun run typecheck` | exit 0 (`$ tsgo --noEmit`) |
| `node scripts/verify-dist-fresh.mjs` | exit 0 — `ok: 20/20 targets fresh` |

Byte greps of the served `client.js`: `boundSessionIdOf` 2, `typeof current === "string"` 1,
`listedSessionIds` 2, `ctx.inject(["modelDirectories", "sessions", "remote.session"]` 1,
`declared fallback — live catalog unavailable` 1, `data-mpd-catalog-state` 2; and **ABSENT**:
`SETTINGS_KNOBS` 0, `ctx.get("modelDirectories")` 0, `return current.sessionId ?? current.id` 0.

## Acceptance (step7 + step8, no injection)

A real session created through the host API, the app navigated to it by its OWN policy, the MPD section
opened through the UI, the card read verbatim. **Run twice** (step7 and step8, fresh Chromium profiles) —
identical results:

```
[step8] LIVE current session id: "session-33721638-64aa-49fb-8617-18ffafae2a6a" (typeof measured: ["string"])
[step8] CARD status: "live catalog — 2 providers · 31 models"
[step8] CARD attrs: {"data-mpd-catalog-state":"live","data-mpd-catalog-providers":"2","data-mpd-catalog-models":"31",...}
[step8] SLOT provider pickers: [{"slot":1,"found":true,"values":["","deepseek-official","opencode-go"]},{"slot":2,"found":true,"values":["","deepseek-official","opencode-go"]},{"slot":3,"found":true,"values":["","deepseek-official","opencode-go"]}]
[step8] BROWSER catalog: {"status":200,"providers":2,"models":31,"providerIds":["deepseek-official","opencode-go"]}
[step8] CONSOLE: total=11 mpd=1
```

`mpd=1` is a single `console.info` — **no `[mpd]` warning of any kind**:

```
[{"domain":"console.info","text":"[mpd] model catalog: live catalog — 2 providers · 31 models"}]
```

The 10 non-`[mpd]` console entries are the app's own and are UNCHANGED by this fix — counted verbatim
from both runs' console dumps, the pre-fix run (step6) and the post-fix run (step8) carry the **identical**
non-`[mpd]` profile: 7 x `Error: cannot get required service "sessions" in inactive context`
(`AgentPresetSeatController`), 2 x `404 (Not Found)`, 1 x `[git-graph] auto-isolation disabled: the
workspaces service shape changed`. (The only difference between the two runs is the `[mpd]` entry itself:
step6 = 1 warning + 1 info, step8 = 1 info.)

See `raw/step8-result.json`, `raw/step8-console.json`, `step8.log`.

## Residuals

1. **`directoryFor(id)` has a side effect on the bound session** (source-measured,
   `dsh-client-ui-model-selection/lib/client.js:296-326`): it caches a `ModelDirectory` for that id and
   publishes a composer block via `conversation.blocks.set(id, …)`, cleared when the scope dies. The
   FALLBACK path therefore binds a directory to a listed session the user did not open, and lazily mints
   that session's scope. The value written is `undefined` unless the directory is non-routable, and the
   primary path (`current`) never does this — but it is a real, documented side effect of the fallback.
2. The fallback binds "any session with both scope and binding", which is a **catalog preview** choice:
   the catalog is host-global, so every bindable id returned the same `ready` / 2 groups / 31 models, and
   the card rebinds to `current` the moment a session becomes current. It is not "the session the user is
   looking at" during that window — by construction, because there is none.
3. `getSnapshot()` carries `ids`/`byId`, **not** `items` — even though the host's own
   `SessionManager.buildListSnapshot()` builds an `items` array. A fix written from the host TYPE alone
   would have read a field the store snapshot does not expose; `listedSessionIds` reads `ids` first and
   tolerates `items`/`byId` so another host build still yields candidates.
4. `bun test packages/mpd-bundle-plugin` (no `./`) discovers **324 files** while running the same 100
   tests (T-89: the positional arg is a substring filter). Use `./packages/mpd-bundle-plugin` for the
   authoritative 4-file run; both spellings were run and both are green.
5. `team-page.js` is **deliberately unchanged**: it already requires a string id and it polls the CURRENT
   conversation's teams, so extending the "any bindable session" fallback there would show a different
   session's teams. Reported, not fixed.
6. A session removed from the host list makes `directoryFor` throw again; the card degrades to its
   declared lists and NAMES the reason (existing behaviour, re-asserted by T-H2/D-1).

## Artifacts

`step1-discovery.mjs` (first probe; also the run that reproduces the user's failure with zero injection),
`step2-live-session.mjs` (found the `workspace/create` arg shape), `step3/4/5/6/7-acceptance.mjs` (the
pre-fix RED and the green acceptance), `cdp.mjs` + `probe-hook.js` (CDP client and pre-document probe;
the probe keys captured scoped ctxs by dependency list and records the session-list `phase` at the moment
each injection fires), `raw/step*-result.json`, `raw/step*-console.json`, `raw/{red,green}-offline.log`,
`raw/step*-*.png`, `sandbox/` (symlink to the reproducing lane's gitignored sandbox — credentials were
copied once there and are never echoed).

**No git write command was run. The user's live host was never touched: every process was started inside
`evidence/**/sandbox/` and killed at the end of its run.**
