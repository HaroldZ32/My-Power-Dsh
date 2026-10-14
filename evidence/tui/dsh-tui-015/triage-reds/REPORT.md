# TRIAGE — the three tui-015 reds, judged at their true layer

Scope of this pass: `packages/**` + `evidence/tui/dsh-tui-015/triage-reds/**`. No `skills/**` byte was
touched (constraint), no git write was made. Every claim below carries the command that produced it.

Sandbox: `.mpd/recon/qa/tui-lanes/tui-015` (the frozen driver's own root, warm).
Host under test: `…/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui` = **0.15.0**.

---

## 0. THE ONE MECHANISM BEHIND (A) AND (B)

**The harness writes a session LOG STORE only once the session APPENDS an event.** On a command-only
`dsh-tui` boot the only append this composition performs is our own log-only
`mpd-tui/board-opened` record, appended by `/mpd board`
(`packages/mpd-tui-plugin/src/commands.ts#runAction` — the `action === "board"` arm calls
`recordBoardOpened`; `panel`, `workmates`, `plan`, `status` append nothing).

Proof (`probe-store-materialization.ts`, arms A/C/D/E, same warm root, one boot each):

| arm | drive | NEW session store | `command/run` in it |
|---|---|---|---|
| A | `Escape`, `/mpd panel` | **(none)** | `[]` |
| C | `Escape`, `/mpd board` | `e09b6c01-23b2-498c-95bf-76b805109f87` | `{mpd, " board"}` |
| D | `Escape`, `/mpd status` | **(none)** | `[]` |
| E | `Escape`, `/mpd board`, `Escape`, `/mpd panel` | `5bdd8a98-4ace-4b43-8e47-942780450efb` | `{mpd, " board"}`, `{mpd, " panel"}` |
| B | `Escape`, `/mpd panel`, `/mpd board` | **(none)** — the open sidebar panel swallowed the board keystrokes, so no append happened | `[]` |

The store is not "flushed late": `dump-store.ts 10c46e83…` shows the file carrying the session's WHOLE
history from its `session` record onward, so a store that exists at the end of a run contains the
commands that ran before the append. Arm E is the direct validation of the lane edit handed over in §1/§2.

**And the boots do NOT produce a blank session id.** Measured:

- `home/.dsh-tui/session-mounts.json` named the live session id `cd228151-681b-4604-87cb-17d49101c10a`
  for a probe boot that left no store (`probe-store-materialization.ts`, arm B).
- `dshhome/storages/session_projcache/sessions/` carries one entry PER BOOT (47 of them) — the boot's
  own `probe-store-materialization` arms are `37a20941…` (A) and `cd228151…` (B); the step3-final lane
  boots are `2b14e93d…` (mount), `bba926e1…` (deps-ctrla), `10c46e83…` (panels), `37ce7af8…`
  (team-surface), `3bd1f82a…` (settings-bridge), `476524bb…` (admission).
- The probe's own sidebar panel rendered the scope-`none` arm of `teamWorkflowLines`
  (`no team in this session — agent_teams_plan binds one here` + `this workspace holds 1 team(s), none
  bound to this session`, pane `probe/B-panel-then-board/panel-command.pane.txt`). That arm is reachable
  ONLY through `readScopedWorkflow`'s **session** branch, i.e. only with a NON-EMPTY session id.

**`last-run.json.sessionId == ""` is a different, benign fact**: the host stamps
`sessionId: resumable ? channel.agentId : ''` at boot
(`lib/types/dsh-adapter/plugin.js`, `refreshLastRunRecord`), i.e. `""` means "nothing was resumable when
this record was stamped", not "the session id is empty". It is not read by any MPD code path.

**Therefore our `workspaceRoot`/session resolution is NOT the defect.** It honours a populated id and
falls back to the marked workspace arm only when the id is genuinely absent — exactly as designed and
exactly as the C6-related `panel-dag.ts` surface states.

---

## 1. (A) `tui-team-surface` H1/H3 — class (i), LANE-side. HANDOFF TO THE SKILLS WRITER.

### Fact
`evidence/tui/team-surface-verify/2026-10-14T10-19-18.554Z/output.log`:
`host: fixture captainSessionId := "10c46e83-3b00-4300-ab55-1c63d62ee39e"` — and `10c46e83…` is the
**tui-panels** boot (`projcache` createdAt 1791973094309 = 10:18:14Z, inside the panels lane window
10:18:02–10:19:18), not this boot. This boot's own session is **`37ce7af8-4124-484f-92c5-9f8f476459dd`**.

Mechanism: `liveSessionId(root, workspace)`
(`skills/dsh-qa/scripts/tui-team-surface.ts`) reads the *harness store* — and this lane's boot writes no
store (§0), so on a warm root it returns the newest OTHER boot's id. The scene it then opens reads its
OWN live channel id (`sessionIdOf(props.channel)`), which is `37ce7af8…`; `mpdTeams.active(ws, 37ce7af8…)`
resolves nothing, so `readScopedWorkflow` takes its honest `scope: "none"` arm → `team === undefined` →
`MPD plan approval — (none)` / `no staged plan for team (none)`. H4 (no approval committed) follows.

So H1/H3 are NOT a packages defect: with the fixture keyed to a session that exists, the same code
renders the record (arm1 A4 offline proves the projection; the T8-era run where the fixture carried a
session this boot had created was reported in `repair/2d-boot-wall.md` as still red — that run's fixture
id was read from a store the run itself created, which is exactly what the edit below restores).

### Handoff — exact lane edits (skills writer)

**E1 — materialize this boot's store before the plan is staged.** In the `steps` array of
`tui-team-surface.ts` (`real()`, the `steps` that begin with `{ name: "plan-open", … }`), insert ONE step
BEFORE `plan-open`:

```ts
    // THE MATERIALIZER (measured: the harness writes a session store only on an APPEND, and the only
    // append this composition performs is our own log-only `mpd-tui/board-opened` record). Without it a
    // warm sandbox root answers `liveSessionId` with the PREVIOUS boot's session, the fixture is keyed to
    // a session this surface does not have, and the plan scene correctly renders `(none)`.
    { name: "session-materialized", keys: ["/mpd board", "Enter"], waitMs: 9000 },
    { name: "session-materialized-close", keys: ["Escape"], waitMs: 3000 },
```

**E2 — prefer a session THIS run created** (belt for E1; the pre-boot snapshot the reverted experiment
used). In `real()`, next to the existing fixture write, add a pre-boot snapshot:

```ts
  /** The session ids present BEFORE the boot, so the fixture reader can prefer one this run created. */
  const baselineSessions = new Set(sandboxSessionIds(root))
```

and in the `plan-open` step's `before` hook replace the reader call with:

```ts
        // THIS RUN'S session, never a neighbour's: the delta against the pre-boot snapshot is the only
        // session id this boot can be shown to own (a warm root's newest header may be another lane's).
        const fresh = sandboxSessionIds(root).filter((candidate) => !baselineSessions.has(candidate))
        const id = fresh.map((candidate) => liveSessionId(root, workspace)).find((candidate) => candidate !== undefined && fresh.includes(candidate)) ?? liveSessionId(root, workspace)
```

(`sandboxSessionIds` is already imported by the sibling lanes from `lib/tui-lane.ts`.)

**Named alternative, NOT recommended** (host-internal file, no documented API): read the boot's live id
from `home/.dsh-tui/session-mounts.json` → `owners[].sessionIds[]`, which the host writes at boot even
when no store materializes (measured). Offered only because it needs no extra keystrokes; it couples the
lane to an undocumented host artifact, which E1/E2 avoid.

**What remains for the final lane re-run:** re-run `tui-team-surface` on the frozen driver and check the
lane's own log line reads `fixture captainSessionId := "37ce7af8…"`-style (i.e. a session created by THIS
run) and that H1/H3 flip. Expected status table: `ok=false` with **H4 ONLY**.

---

## 2. (B) `tui-deps-ctrla` store arm — class (i), LANE-side. HANDOFF TO THE SKILLS WRITER.

### Fact
The lane's expectation is CORRECT and unchanged: the harness records
`command/run {name:"mpd", args:" panel"}` + `command/done {kind:"success"}` carrying the panel-opened
sentence (`dump-store.ts 10c46e83…`, records seq 5–6). What the lane lacks is a store to read it from,
because its drive (`driveSteps`, seam-present branch) submits `/mpd panel` only — and `/mpd panel` does
not append. Measured: arm A = no store; arm E = a store carrying BOTH the board and the panel pair.

### Handoff — exact lane edit (skills writer)

In `tui-deps-ctrla.ts#driveSteps`, the seam-present branch:

```ts
  const panelCommand: TuiStep[] = [
    // THE MATERIALIZER (measured): the harness writes a session store only on an APPEND, and the only
    // append in this composition is `/mpd board`'s log-only `mpd-tui/board-opened` record. Driven FIRST,
    // because a board command typed at an already-open sidebar panel is swallowed (measured).
    { name: "board-materialize", keys: ["/mpd board", "Enter"], waitMs: 9000 },
    { name: "board-materialize-close", keys: ["Escape"], waitMs: 3000 },
    { name: "panel-command", keys: ["/mpd panel", "Enter"], waitMs: 7000 },
    { name: "close-panel-command", keys: ["Escape"], waitMs: 2500 },
  ]
```

The `if (seamPresent) return [common[0], ...panelCommand, ...common.slice(1)]` shape is unchanged, so the
legacy-host branch keeps the `M-a` baseline untouched. The store arm is asserted only when
`seamPresent` (`evaluateStoreArms(fresh, seamPresent ? [PANEL_STORE_ARM] : [])`), so the legacy branch
needs no change.

**Do NOT weaken the arm.** `PANEL_STORE_ARM` already carries four negative controls in the lane's
`--self-test`, and arm E shows the arm becomes satisfiable exactly as written.

**What remains for the final lane re-run:** re-run `tui-deps-ctrla` and expect the store arm green
(`store arm: ok=true id=act1:team`), i.e. lane PASS against the frozen table.

---

## 3. (C) `tui-admission` arm3 — class (ii), PACKAGES-side, **NOT FIXED HERE**. The arm STAYS RED.

### Facts (measured on this host)
1. **The shape DOES exist.** `lib/types/dsh-adapter/plugin-host.js#subscribeDecision` records
   `{operation:'bind', resource:{kind:'decision-handler', id:`${identity.componentId}:${event}`},
   result:'applied'}` on its registered path, and
   `{operation:'bind', resource:{kind:'permission', id:event}, result:'failed',
   errorCode:'PERMISSION_NOT_GRANTED'}` otherwise — both attributed to the caller context. So
   `repair/2d-boot-wall.md`'s recorded cause ("there is no `decision-handler` resource kind at all on
   0.15.0") is right about the FILE and wrong about the HOST, and a corrected arm must not restate it.
2. **The grant flow works.** `probe-decision-seam.ts` (grant file written exactly as the lane writes it):
   admission loader `admitted=61 refused=0`; the lane's own `negctl` boot is the exact inverse
   (`admitted=0 refused=61`).
3. **Nothing our rows do reaches the ledger.** Granted boot ledger delta = 20 records, ALL
   `command/create/host`. Whole-file histogram (928 records): kinds `{command: 920, status: 8}`,
   attributions `{host: 920, undeclared: 8}`, operations `{create: 920, replace: 8}`. Zero records name
   `com.mpd-dsh.mpd-tui`; zero `decision-handler`; zero `scene`/`panel`, although our scenes and sidebar
   panel demonstrably registered and rendered.
4. Our subscription itself leaves no trace: with `DSH_TUI_DEBUG=1` and stderr redirected,
   `probe-decision-seam.ts` captured **0** lines carrying our `[mpd-tui]` prefix — the boot's own
   `disclose()` line (`decision-event seam ACTIVE…` / `… ready but NOT activated (first refusal: …)`)
   never reached the debug stream, so which branch our attempt took is still unproven.

### Judgement
The C3' arm was **not** written against a shape 0.15.0 lacks — it was written against a registration our
rows never manage to have RECORDED. That is a packages-side question
(`packages/mpd-tui-adapter-plugin/src/index.ts#requestDecisionEvent` + the identity/attribution plumbing
around it), NOT a lane-drive question: **no lane drive can satisfy arm3 as long as our registrations land
`undeclared`/absent in the ledger.**

**No packages fix was made.** The remaining candidates, each with the ONE experiment that kills it:
- *(c1)* `subscribeDecision` threw before its recording branch (`assertActivationContext` /
  `requireComponentIdentity` / `requiresDecisionEvents`). Falsifier: make our `disclose()` line readable
  (the `Log` sink swallows `ctx.logger` output — itself a finding) and read the refusal string.
- *(c2)* the call never happened because `whenBoundInternal("pluginHost", …)` never fired for this row.
  Falsifier: read the adapter's `requestDecisionEvent(...).outcome().state` at boot.
- *(c3)* the host writes through the CALLER's context and our injected scope cannot resolve
  `tuiEffectLedger`, so every effect we cause is silently unrecorded (the `?.record(...)` guards make it
  a no-op, never a throw). Falsifier: register one seam through a scope that is NOT a bare seam inject
  and see whether the record appears.
This is an architecture-level call (the roster's route is the consultant first); it is reported as the
open packages question rather than patched speculatively.

### Handoff — the arm wording correction (skills writer), assertion UNCHANGED
Keep `arm3` exactly as it is (`attributed.length > 0 && handlerBinds.length > 0`); keep it RED. Replace
only the recorded CAUSE, and add the differential witness the granted boot now supplies:

```
[tui-admission] arm3 attribution: attributed=0 decisionHandlerBinds(applied)=0 (ledger delta=20)
[tui-admission] arm3 host wiring: the host DOES emit `decision-handler` binds
  (lib/types/dsh-adapter/plugin-host.js#subscribeDecision) — the record never fires for us, so this red is
  OUR registration/attribution gap, not a missing host shape.
[tui-admission] arm3 identity differential: admission loader admitted=61 refused=0 (this boot) vs
  admitted=0 refused=61 (negctl) — the grant DID bind a Component identity, so the gap is after binding.
```

**Also a finding, not a licence to weaken arm3:** `arm4` is
`submitPane.includes(DECISION_SUBMIT_TEXT)` — it is satisfied by the lane's OWN keystrokes and is
therefore unable to discriminate a live handler from an absent one. It should be re-specified (e.g. the
host's own post-release log line, or a handler that rewrites the input observably) rather than cited as
proof the granted flow is observable.

---

## 4. BOUND (i) — `standDown()` vs `standDownToHostUnion()`: UNREACHABLE BY CONSTRUCTION

`runTick` (`packages/mpd-tui-adapter-plugin/src/index.ts`) evaluates the C2 self-heal gate BEFORE the
feed hand-off and RETURNS on it:

```ts
if (hostSelfHealsPanelCsv(probe.hostVersion ?? "")) { standDownToHostUnion(probe.prefs, probe.hostVersion ?? ""); return }
if (!onFeed && enterFeed(probe.prefs, probe.defaultIds)) return
decide(probe.prefs, false, probe.defaultIds)
```

so on a self-healing host `enterFeed` is never reached and `releaseFeed` is never set: there is no armed
repair feed for `standDownToHostUnion` to release, and the missing `releaseFeedNow()` is a no-op there.
`enterFeed` (the only writer of `releaseFeed`) runs only when the gate is FALSE, and the version it gates
on is re-read per tick from the SAME resolved host root (`loadPrefs` → `probeHostPrefs(hostRootCandidates())`
→ `readHostPackageVersion(probe.root)` reading `join(root,"package.json")`), which cannot change without a
reinstall inside one process.

**The one condition that WOULD make it a real double-writer**, stated for the verifier: a host version
reading that flips `< 0.15.0` → `>= 0.15.0` mid-process (or two different host roots alternating between
ticks). Then a live repair feed's listener would survive `standDownToHostUnion` and could still write the
CSV the stand-down promised never to touch. Making `standDownToHostUnion` mirror `releaseFeedNow()` would
close that class at zero behavioural cost on the reachable paths — deliberately NOT done here (the bound
was raised "for judgement", the reachable path is unaffected, and a speculative edit to a C2 code path is
outside a triage's minimal diff).

## 5. BOUND (ii) — C2 docstring scoping: FIXED (comment-only, dist-invisible)

`standDownToHostUnion`'s JSDoc said "THE KEEPER WRITES NOTHING on this path". Measured: the path calls
`settle()` → `announce()` → the mounted row's `onChange` → `recordPanelIds()` →
`writeFileSync(<ws>/.mpd/logs/mpd-tui-panels.json)` (`packages/mpd-tui-adapter-plugin/src/index.ts`), and
that file exists in the sandbox. The sentence is now scoped to the enable-list CSV, with the one file the
path DOES write named explicitly. The edit is a docstring only: the phrase never reached `dist/`
(`grep -c "THE KEEPER WRITES NOTHING" packages/mpd-tui-adapter-plugin/dist/index.js` → 0), so
`verify-dist-fresh` stays green with NO rebuild and no adapter fan-out.

---

## 6. THE C6-RELATED SURFACE (stated as asked)

The C6 fix lives in `packages/mpd-tui-plugin/src/panel-dag.ts`: a workspace-scope read pushes the explicit
marker row (`WORKSPACE_SCOPE_MARKER: no session id on this surface, showing the workspace's newest team`,
`panel-dag.ts:1036`), and a session-scope read with no team draws the honest empty state instead of the
workspace principal. That is the surface the (A)/(B) symptom was mis-attributed to: the SIDEBAR panel was
already correct in the measured run (it rendered the scope-`none` empty state naming the workspace's team
count, `probe/B-panel-then-board/panel-command.pane.txt`).

**Gap found, NOT fixed (reported):** the PLAN scene's non-usable branch bypasses the projection and
renders its own one-liner (`scenes.ts`, `const detail = team === undefined ? "no staged plan for team
(none)" : …`), so it drops the three-state provenance that `planProjectionLines` carries — which is
precisely why "blank session id" and "session id that resolves nothing" rendered identically and cost this
triage a full round. A one-line diagnostic improvement is available there; it is a user-visible change
with its own unit arms and was outside this task's mandate (the task's conditional fix — "if our
resolution ignores a workspace-scoped team when sessionId is blank" — does not apply: it does not ignore
it, measured above).

**Second gap found, NOT fixed (reported):** `mpd-tui-adapter-plugin`'s boot line
`TUI_SEAMS=(none composed)` is written SYNCHRONOUSLY inside `apply()`, before any deferred
`ctx.inject([id], …)` callback can run, so it is structurally always `(none composed)` at that moment.
`repair/2d-boot-wall.md` cites it as corroborating host state for the team-surface red; that
corroboration is void, and the line has already been misread once. The honest fixes are to take the
readout after the deferred binders settle or to label it "at provide time" — a message-string change,
therefore a `dist` change for the adapter and its importers, which belongs to the integration step.

---

## 7. WHAT I COULD NOT PROVE

- Which of *(c1)/(c2)/(c3)* is the actual decision-subscription blocker; the seam's own disclosure line
  is not observable (our `Log` sink swallows `ctx.logger` output; 0 `[mpd-tui]` lines in the debug
  stream).
- That the two proposed lane edits flip H1/H3 and the store arm end-to-end — they are validated by the
  isolated probes (arm E), not by a full lane re-run (that is the final lane re-run's job).
- Whether a mid-process host-version flip is possible in any real composition (bound (i)).
