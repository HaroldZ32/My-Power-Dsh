# HANDOFF — exact `skills/**` edits (single skills writer)

Source of the measurement: `evidence/tui/dsh-tui-015/triage-reds/REPORT.md` §1/§2.
Do not edit `skills/**` from any other seat. Both edits are lane-drive-only; no assertion is weakened.

---

## E1 — `skills/dsh-qa/scripts/tui-team-surface.ts` (item **A**)

### E1a — insert the materializing steps BEFORE `plan-open`

In `real()`, in the `steps: TuiStep[]` array whose FIRST entry is
`{ name: "plan-open", before: (): void => { … }, keys: ["/mpd plan", "Enter"], waitMs: 9000 }`,
insert these two entries immediately BEFORE it:

```ts
    // THE MATERIALIZER (measured 2026-10-14, 0.15.0): the harness writes a session store only once the
    // session APPENDS an event, and the only append this composition performs on a command-only boot is
    // our own log-only `mpd-tui/board-opened` record, appended by `/mpd board`
    // (`packages/mpd-tui-plugin/src/commands.ts#runAction`). Without it a warm sandbox root answers
    // `liveSessionId` with the PREVIOUS boot's session, the fixture is keyed to a session this surface
    // does not have, and the plan scene — correctly — renders `no staged plan for team (none)`.
    // MUST BE FIRST and MUST BE CLOSED: the board command typed at an already-open sidebar panel is
    // swallowed by that panel (measured: probe arm B produced no store), and the board scene owns the
    // keyboard until Esc.
    { name: "session-materialized", keys: ["/mpd board", "Enter"], waitMs: 9000 },
    { name: "session-materialized-close", keys: ["Escape"], waitMs: 3000 },
```

### E1b — prefer a session THIS run created (belt for E1a)

In `real()`, beside the existing fixture write (`const baseRecord = stagedRecord()` /
`writeTeamFixture(workspace, { ...baseRecord, captainSessionId: "sess-not-yet-attached" })`), add the
pre-boot snapshot:

```ts
  /** The session ids present BEFORE the boot, so the fixture reader can prefer one THIS run created. */
  const baselineSessions = new Set(sandboxSessionIds(root))
```

and inside the `plan-open` step's `before` hook, replace

```ts
        const id = liveSessionId(root, workspace)
```

with

```ts
        // THIS RUN'S session, never a neighbour's. `liveSessionId` reads the harness STORE, and a warm
        // root's newest header can belong to another lane's boot; the delta against the pre-boot snapshot
        // is the only session id this boot can be shown to own, so a delta member wins over the newest.
        const fresh = sandboxSessionIds(root).filter((candidate) => !baselineSessions.has(candidate))
        const own = fresh.map(() => liveSessionId(root, workspace)).find((candidate) => candidate !== undefined && fresh.includes(candidate))
        const id = own ?? liveSessionId(root, workspace)
```

Add `sandboxSessionIds` to the lane's import list from `./lib/tui-lane.js` (the sibling lanes already
import it).

---

## E2 — `skills/dsh-qa/scripts/tui-deps-ctrla.ts` (item **B**)

In `driveSteps(...)`, the seam-present half, replace

```ts
  const panelCommand: TuiStep[] = [
    { name: "panel-command", keys: ["/mpd panel", "Enter"], waitMs: 7000 },
    { name: "close-panel-command", keys: ["Escape"], waitMs: 2500 },
  ]
```

with

```ts
  const panelCommand: TuiStep[] = [
    // THE MATERIALIZER (measured 2026-10-14, 0.15.0): this store arm reads the HARNESS's session store,
    // and the harness writes that store only once the session APPENDS an event. `/mpd panel` appends
    // nothing; `/mpd board` appends our log-only `mpd-tui/board-opened` record (the ONE append this
    // composition performs), which materializes the store carrying the whole session history — including
    // the `/mpd panel` `command/run` + `command/done` pair this arm asserts. It is driven FIRST and
    // CLOSED, because a board command typed at an already-open sidebar panel is swallowed by that panel
    // (measured: probe arm B produced no store, arm E produced one carrying both pairs).
    { name: "board-materialize", keys: ["/mpd board", "Enter"], waitMs: 9000 },
    { name: "board-materialize-close", keys: ["Escape"], waitMs: 3000 },
    { name: "panel-command", keys: ["/mpd panel", "Enter"], waitMs: 7000 },
    { name: "close-panel-command", keys: ["Escape"], waitMs: 2500 },
  ]
```

`if (seamPresent) return [common[0], ...panelCommand, ...common.slice(1)]` is unchanged, so the
legacy-host branch (`M-a` baseline) is untouched; the store arm is asserted only when `seamPresent`
(`evaluateStoreArms(fresh, seamPresent ? [PANEL_STORE_ARM] : [])`), so no other branch needs the step.

---

## E3 — `skills/dsh-qa/scripts/tui-admission.ts` (item **C**): wording only, ARM STAYS RED

Keep `arm3` EXACTLY as it is (`attributed.length > 0 && handlerBinds.length > 0`). Replace the recorded
CAUSE — 2d's "0.15.0 emits no `decision-handler` resource kind" is false about the host — with these
three lines beside the existing `arm3 attribution:` line:

```ts
  // THE HOST DOES WIRE THIS SHAPE (measured 2026-10-14 on 0.15.0): `subscribeDecision`
  // (lib/types/dsh-adapter/plugin-host.js) records `{kind:'decision-handler', id:`<componentId>:<event>`}`
  // on its registered path and a `permission`/PERMISSION_NOT_GRANTED record otherwise. Neither appears:
  // 928 ledger records, kinds {command:920, status:8}, attributions {host:920, undeclared:8}. So this red
  // is OUR registration/attribution gap, not a missing host shape — it must stay RED, never be weakened.
  say("arm3 host wiring: `decision-handler` binds are wired by plugin-host.js#subscribeDecision but none fired")
  say("arm3 identity differential: admission loader admitted=" + grantedAdmissions + " refused=" + grantedRefusals
    + " (this boot) vs admitted=" + negativeAdmissions + " refused=" + negativeRefusals + " (negctl)")
```

`grantedAdmissions`/`grantedRefusals`/`negativeAdmissions`/`negativeRefusals` are counts of
`admission loader admitted` / `admission loader refused` over each boot's `stderrFile`; measured values are
`61/0` (granted) and `0/61` (negctl), which proves the grant DID bind a Component identity.

**Separate finding (do not use it to weaken arm3):** `arm4` is
`submitPane.includes(DECISION_SUBMIT_TEXT)`, which the lane's own keystrokes satisfy — it cannot
discriminate a live handler from an absent one and should be re-specified.
