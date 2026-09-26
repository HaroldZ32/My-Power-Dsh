# Defect: `Cannot read properties of undefined (reading 'map')` on EVERY turn (fixed 2026-09-16)

**Symptom (as reported by the user).** In the DSH Web GUI, sending ANY message to an agent
running the `mpd` preset failed instantly. The harness recorded, ~120 ms after `turn/start`
and BEFORE any model call:

```json
{"type":"turn/end","seq":5559,"time":1789518527575,
 "data":{"turn":113,"reason":{"kind":"error",
  "error":{"message":"Cannot read properties of undefined (reading 'map')","code":"UNKNOWN"}}}}
```

The same failure repeated on every retry (`turn 114`) and survived a full `dsh` restart. The
message is state-dependent: with a `.mpd/plans/*.md` artifact present it reads
`… (reading 'findLastIndex')`, and a one-shot `--profile headless` boot died with
`dsh: UNKNOWN: Cannot read properties of undefined (reading 'length')`, exit 1.

**Root cause.** `agent/pre-step` is a **cordis waterfall**. `EventsService.waterfall`
(`packages/mpd-agent-teams-plugin/_deps/cordis/lib/index.js`) runs the listeners
outermost-first with `next` appended and composes them as
`(cbs.shift() ?? inner)(...args)` — so a listener that returns WITHOUT calling `next()`
**vetoes the remaining chain and its own return value BECOMES the step decision**
(`the last dispatch argument is treated as the innermost next … a listener that does not
call next() vetoes the rest of the chain`).

The team watchdog's heartbeat writer was registered as

```ts
subscribe(this.ctx, "agent/pre-step", (payload) => this.stamp("step", agentOf(payload)))
```

i.e. it returned a `HeartbeatStamp` (`{kind:"step", at, memberKey, taskId, …}`) — an object
with no `messages`. That stamp replaced the `{kind:"enter", messages}` decision, and the first
consumer to read `decision.messages` threw: the agent loop's `.length` check, the adopted
agent-teams policy's `.findLastIndex` (`spliceNotice`), or a `.map` in the assembly path,
depending on workspace state. A heartbeat is not a decision; the plugin was one line of
wrong contract away from breaking every session in the process.

**Fix.** `packages/mpd-team-watchdog-plugin/src/engine.ts` `WatchdogEngine.install()`:

- the `agent/pre-step` listener now stamps **and delegates** — `return next()` — with the
  stamping itself contained in a `try/catch` that warns (a thrown handler would otherwise be
  answered by `subscribe`'s wrapper with `undefined`, which is *itself* a veto);
- the `agent/session-start` (emit) and `agent/turn-stopping` (serial — `isBailed` stops the
  chain on any non-null/false/undefined return) handlers now return nothing at all.

**Why no existing gate saw it.** Every `team-watchdog-*.mjs` QA lane drives the built plugin
modules in-process through a fake adapter and never spawns a real `dsh`, so no lane ever
exercised a real harness turn with the row mounted; the package tests used a `stubCtx()` whose
`on` merely records handlers, so dispatch semantics were never applied.

## Artifacts

| Path | What it is |
|---|---|
| `20260916T010000Z/drive.mjs` | live driver: dev-web boot (base + web-app + this checkout) → `session/create` on `agentPreset: "mpd"` → `session/prompt` → read `turn/end` from the harness's own session log. Sandboxed `DSH_HOME` + `HOME`; workspace is a fresh temp dir (empty variant) or a copy of this repo's `.mpd` state (copied variant). |
| `20260916T010000Z/result.json`, `output.log` | AFTER the fix: both variants `turn/end {reason:{kind:"completed"}}`, the model answered, **0 crash signatures**. |
| `20260916T010000Z/before-fix/` | the SAME driver run against the rebuilt retired shape (`dist` rebuilt from the pre-fix source): empty → `… (reading 'map')`, copied → `… (reading 'findLastIndex')`, both at `seq 6`, `ok=false`. This is the falsifiability half: the driver really does go red on the defect. |

The permanent pin is `packages/mpd-team-watchdog-plugin/test/pre-step-waterfall.test.ts`
(it drives the REAL vendored cordis waterfall and carries a negative control that re-enacts
the retired shape, so the assertion cannot go vacuous). It fails 4/5 on the pre-fix code and
passes 5/5 after the fix.

## Reproduce

```bash
bun test packages/mpd-team-watchdog-plugin/test/pre-step-waterfall.test.ts   # the pin
node evidence/team-watchdog/pre-step-waterfall/20260916T010000Z/drive.mjs    # the live path
```

`drive.mjs` needs a model credential: `DEEPSEEK_API_KEY` in the environment (it is exported by
`~/.bashrc` on this machine; it is never written to any artifact). Without it the turn ends
with `MISSING_CREDENTIAL` instead of `completed` — the pre-step defect is still gone.

Base revision for both runs: `b53a651` + the working tree of 2026-09-16 (the watchdog wave's
uncommitted changes).
