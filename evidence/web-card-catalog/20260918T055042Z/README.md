# web-card-catalog — a real browser reproduces the "one provider" defect in the Web MPD settings card

**Domain:** `evidence/web-card-catalog/<timestamp>/`
**Subject:** in the Web settings dialog's `MPD` section (contributed by this repo's bundle web
client), the three *team model slot* provider pickers offer ONLY `deepseek-official`, although the
host's model catalog carries a second provider (`opencode-go`, 27 models). The card is supposed to
acquire the catalog live through `ctx.inject(["modelDirectories","sessions"], …)` and to print
either `live catalog — N providers · M models` or `declared fallback — live catalog unavailable
(reason)`.

## Verdict in one paragraph

**Reproduced in a real browser against a real dsh web host running in an isolated sandbox.** The
served client bytes are the FIXED sources — measurement A refutes the stale-bytes hypothesis
byte-for-byte — so the defect is runtime. The card's acquisition fires correctly
(`ctx.inject([...], cb)` invokes its callback, and the scoped ctx resolves both services), and then
dies one call later: `modelDirectories.directoryFor(sessionId)` throws
`cannot get property "remote.session" without inject`. cordis services are CALLER-scoped, and
`ModelDirectoryResolver.directoryFor()` reads `this.ctx.remote.session`; the card's inject list
never included `remote.session`, so the read is rejected, the card's `catch` degrades to its
declared option lists, and the UI shows exactly one provider while the browser-side catalog holds
two. Adding `"remote.session"` to the inject list is **measured** to fix it: the directory then
reports `status=ready` with `deepseek-official` (4) + `opencode-go` (27).

## Measurements (all five requested)

| # | Question | Answer | Where |
|---|---|---|---|
| A | Is the served client stale? | **No** — served = repo `client.js` + an 85-byte sourcemap suffix; all four markers present/absent as intended | `result.json → A_servedBytes` |
| B | What does the page show? | status line `declared fallback — live catalog unavailable (no session is bound)`, `data-mpd-catalog-state=fallback`, `providers=0`, `models=0`; every slot provider `<select>` offers only `""`/`deepseek-official` | `result.json → B_pageObservation` |
| C | What does the browser-side catalog hold? | **2 providers / 31 models** (`deepseek-official` 4, `opencode-go` 27) — host RPC, in-page RPC, and the client's own service | `result.json → C_browserCatalog` |
| D | Console during the section render | 15 events: 14 errors / 1 warning, **none from `[mpd]`** — the card's failure path is console-silent | `result.json → D_console` |
| E | Why does acquisition fail? | callback fires ✓, services resolve ✓, `directoryFor` **throws** `cannot get property "remote.session" without inject` ✗ | `result.json → E_instrumentation` |

## Reproduction (five drivers, in order)

```bash
cd /root/dshProj/my-power-dsh
bun evidence/web-card-catalog/20260918T055042Z/step1-sandbox.mjs        # isolated DSH_HOME/HOME/workspace
bun evidence/web-card-catalog/20260918T055042Z/step2-host-bytes.mjs    # boot + token URL + measurement A + host catalog
bun evidence/web-card-catalog/20260918T055042Z/step3-browser-cdp.mjs   # real Chromium over CDP: B, C, D, E
bun evidence/web-card-catalog/20260918T055042Z/step4-session-bind-probe.mjs  # binding isolation + render transition
bun evidence/web-card-catalog/20260918T055042Z/step5-inject-deps.mjs   # the fix hypothesis, measured
```

`cdp.mjs` is the CDP client (Chromium driven with Bun's global `WebSocket` — the npm `playwright`
package is NOT resolvable in this repo, verified). `probe-hook.js` is the pre-document
instrumentation.

## Sandbox

`sandbox/` holds an isolated `dsh-home` (a faithful copy of `~/.dsh/profiles/web` plus the sibling
`profiles/node_modules` link farm), a sandbox `HOME`, the fixture workspace, the ONE-TIME
`settings.yaml`/`.credentials.yaml` copies and the Chromium profile. It is gitignored
(`.gitignore`: `evidence/**/sandbox/`) and no credential value appears in any artifact here.

## What was NOT proved

See `result.json → notProved`. The important one: the "a session is current" precondition was
established by an **explicit state injection** through the app's own sessions store, not by a UI
drive — in this sandbox the composer shows *Choose a workspace to start* and the workspace picker is
a native dialog a headless CDP session cannot operate.
