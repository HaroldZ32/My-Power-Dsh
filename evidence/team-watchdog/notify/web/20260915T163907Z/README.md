# w5 — the Web front door for a stuck team (t63)

**Deliverable:** when a team is stuck or held, the AgentTeams sidebar panel shows a banner at the
TOP of the panel plus one activity record, a user who was not watching still learns about it on the
next load (the unread replay), and an explicit **Acknowledge** stops the replay.

**Reader key (stable):** `web-panel` — the per-reader key this front door owns in
`<workspace>/<stateDir>/watchdog/read-watermark.json`. The state route is
`/plugins/mpd-team-watchdog/state?reader=web-panel`, the acknowledge route is
`/plugins/mpd-team-watchdog/ack`.

## Where the code lives

| Path | Change |
|---|---|
| `packages/mpd-bundle-plugin/src/watchdog-web.ts` | NEW. The reader + acknowledge + the two route registrations. Reads the watchdog package's DOCUMENTED store contract (`hold/<teamId>.json`, `incidents.jsonl`, `read-watermark.json`, `scene/<teamId>/latest.json`) and nothing else; the acknowledge re-reads the watermark, raises ONLY its own reader key, writes a sibling temp file and renames it, so another reader's key can never be dropped. |
| `packages/mpd-bundle-plugin/src/index.ts` | The bundle's server half (`mpd-web-compat`, `exports["."]`) now registers those routes — soft-probed (`webServer`, else `httpServer`), effect-owned, per-request workspace resolution through the adapter (`mpdDsh.workspaceRootsAll()`, falling back to `DSH_WORKSPACE_ROOT`/cwd), `team.stateDir` from `mpdConfig` else `.mpd/team`. A webless profile keeps the plugin a pure marker. |
| `packages/mpd-bundle-plugin/src/team-page.js` | The client: the `watchdog` store slice, the FIRST poll on mount, the banner as the panel root's FIRST child, one record per unread incident heading the body, the acknowledge button, and en/zh copy. When nothing is stuck the children shape is byte-for-byte the pre-banner one (`aside > [head, teams body]`). |
| `packages/mpd-bundle-plugin/client.js` | Rebuilt (`node scripts/build-mpd-client.mjs`, twice — byte-identical). |
| `packages/mpd-bundle-plugin/dist/index.js` | Rebuilt server half (`bun build … --target node --format esm`). |
| `packages/mpd-bundle-plugin/test/team-page.test.mjs` | One assertion updated: the fetch pin now names the TWO routes the page may talk to (the adopted team-state route and this front door) instead of the single old one — a foreign fetch still fails it. |

**No adopted file is touched:** `packages/mpd-agent-teams-plugin/**` has the same `git status` before
and after this pass (the entries there are w7's delta regions), and the watchdog package is untouched
— the panel gets its extra state from OUR route, never from an adopted-file change.

## How it was verified (no browser exists here)

`driver.mjs` (re-runnable: `MPD_REPO_ROOT=$PWD bun evidence/team-watchdog/notify/web/<ts>/driver.mjs`)
exercises the REAL code on both sides: the REAL route handlers over a sandbox workspace store, and the
REAL built `client.js` through the offline hook harness with `fetch` served by the payload the route
just produced. It asserts, in order:

1. the route registers and its payload carries `stuck`, the banner (hold + incident ids, cause, task,
   attempt) and exactly ONE activity record;
2. mounting the page fetches the route **without any user action** (the first poll = the replay);
3. the rendered tree has the banner as the panel root's **first child**, carrying the payload's own
   values, and the record in the body (asserted on the rendered output, never on the source);
4. the REAL acknowledge handler advances `read-watermark.json` — bytes and sha256 before/after differ,
   and the OTHER reader's key (`tui-panel: 5`) survives;
5. after the acknowledge the replay stops (`replay:false`, `unread:[]`, `activity:[]`, no record
   element). The durable hold still reports the team as paused, which is current state, not a replay:
   removing the hold sidecar (the watchdog's own resume) clears the banner on the next poll;
6. a FRESH client on the same store replays nothing (the acknowledged incident stays quiet);
7. a SECOND, unacknowledged incident replays on the next start with no user action;
8. the adopted package is untouched (before/after `git status` identical), plus a NEGATIVE CONTROL —
   with no watchdog payload the panel renders exactly the pre-banner shape.

Raw output, the payloads, the rendered tree and the watermark before/after are under `raw/`.

## NOT CLAIMED

* **A real browser render and a click-driven save.** No browser binary exists in this environment; the
  rendered claims come from the offline hook runtime driving the REAL built client against payloads the
  REAL route handlers produced. To see it yourself: `dsh --profile web`, open the GUI, open the
  AgentTeams tab while a team is held — the banner sits above the panel head and the record above the
  team sections; press Acknowledge and reload — it does not come back.
* The live GUI round trip through the host's authenticated route (the host gate for non-static routes
  is not part of this pass; the handlers themselves are exercised in-process).
* **The honest fallback, stated rather than hidden:** without an acknowledge the replay is permanent
  re-display BY DESIGN (`replay:true` in the payload and the on-screen line under each record).

## Gates (all green, logs in `raw/`)

`bun test packages/mpd-bundle-plugin` (68 pass / 0 fail) · `node scripts/build-mpd-client.mjs` twice
(byte-identical: `f98aa305…`, 296735 bytes) · `bun run typecheck` · `bun run verify:docs` (34 pairs,
0 failed) · `bun skills/dsh-qa/scripts/agent-teams-sidebar.mjs --self-test` (17 checks) · the driver
(17/17 checks, verdict passed) · `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` (the AGENTS.md mount
gate, run because the change is boot-visible: `[bundle-lifecycle] PASS`, the row still loads and the web
profile boots with the new server half).

**Scope note.** The contract's `inScope` names `src/team-page.js`, `client.js` and this evidence
directory. A browser client cannot read the workspace store, and the hard rule forbids touching the
adopted package, so the two routes live in OUR package's server half: `src/watchdog-web.ts` (new),
`src/index.ts` (registers them) and the rebuilt `dist/index.js`; one assertion in
`test/team-page.test.mjs` was updated because the page now legitimately talks to two routes. The
rebuilt `client.js` is the WAVE's shared artifact and therefore also carries the current
`src/settings-card.js` bytes (w4's in-flight knob rows), since a single script owns the client build.
