// PREPARED PATCH — replacement for the T-19 test in
// `packages/mpd-agent-teams-plugin/self-fix-tests/tool-boundary-hold-and-contract-seat.test.mjs`
// (currently: "T-19: the status surface names BOTH pause mechanisms and defers the hold").
//
// WHY IT MUST CHANGE: that pin encodes the WAVE-1 behaviour the user's ruling abolished — it asserts
// the status text contains `team watchdog hold` and `session-watchdog-status`, i.e. the two-peer
// wording + the deferral. The collapse (t21) makes those strings absent BY DESIGN, so the pin reddens
// and must be REQUALIFIED, not left lying (the T-81 precedent). The requalified pin keeps every
// guarantee the old one carried (no new resume verb; the hold is not gated at a tool boundary) and
// adds the drift guards + the live-hold and fail-open readings.
//
// CONTEXT the patch relies on: this file's `registerTools()` stub ALWAYS answers `isHeld` with
// `HOLD_VIEW = { held: true, holdId: "hold-probe-1", at: 1_700_000_000_000, reason: "silence probe" }`
// for TEAM_ID, so the live-hold case needs no new fixture — and the old surface printed
// `agent-teams halt not active` in exactly that state (measured in the t21 driver, state 3).
//
// ── replacement block (drop-in for the existing `test("T-19: ...") { ... }`) ──────────────────────

test("T-19: the status surface names ONE pause mechanism and reports the hold as its INTERNAL implementation", async () => {
    const { workspace, captain, member } = fixture()
    try {
        const { tools } = registerTools(workspace, captain, member)
        const status = tools.get("agent_teams_status")
        // The stub's hold is LIVE (HOLD_VIEW), so this render is the state the old surface got wrong:
        // it printed `agent-teams halt not active` while the team was held.
        const held = await status.execute({}, { agent: member })
        const heldText = status.output.render({}, held)[0].text
        expect(heldText, "one mechanism, named once").toContain("Pause: agent-teams halt ACTIVE (one mechanism: agent_teams_halt")
        expect(heldText, "the hold is the mechanism's internal implementation, not a peer").toContain("PRESERVING hold is its INTERNAL implementation")
        // Diagnostics survive the collapse: the operator still gets WHICH hold and WHY.
        expect(heldText).toContain("hold-probe-1")
        expect(heldText).toContain("silence probe")
        expect(heldText).toContain("released only by its own session-watchdog-resume")
        // DRIFT GUARDS: the wave-1 two-peer wording and its deferral are ABSENT.
        expect(heldText).not.toContain("· team watchdog hold:")
        expect(heldText).not.toContain("run session-watchdog-status")
        // no NEW resume verb on this surface (unchanged wave-1 guarantee)
        expect(heldText).not.toContain("agent_teams_resume")

        // The structured payload carries the same single-mechanism view (the acceptance names both).
        expect(held.pause.mechanism).toBe("agent_teams_halt")
        expect(held.pause.active).toBe(true)
        expect(held.pause.halt).toBe(false)
        expect(held.pause.internal_implementation.kind).toBe("team-watchdog-preserving-hold")
        expect(held.pause.internal_implementation.hold_id).toBe("hold-probe-1")
        expect(held.pause.internal_implementation.released_by).toBe("session-watchdog-resume")
        expect(JSON.stringify(held.pause)).not.toContain("TWO")

        // A HALTED record (no hold) reads ACTIVE with the same single-mechanism framing — the
        // pre-existing assertion shape is kept, so the pin still guards THIS half too.
        const halted = await status.execute({}, { agent: captain })
        halted.halted = true
        halted.pause = { ...halted.pause, active: true, halt: true, internal_implementation: { ...halted.pause.internal_implementation, state: "not-held", hold_id: undefined } }
        const haltedText = status.output.render({}, halted)[0].text
        expect(haltedText).toContain("Pause: agent-teams halt ACTIVE (one mechanism: agent_teams_halt")
        expect(haltedText).toContain("no hold is set")
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("T-19: with NO watchdog service the status says the hold is NOT READABLE — never a guessed hold", async () => {
    const { workspace, captain, member } = fixture()
    try {
        // A registration whose service store answers nothing: the read must FAIL OPEN and must not
        // invent `no hold is set` (which would be a false negative an operator would trust).
        const tools = new Map()
        const ctx = {
            tools: { register: (definition) => { tools.set(definition.name, definition) } },
            agents: { get: (id) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
            subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
            effect: () => () => undefined,
            on: () => () => undefined,
            logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
            get: () => undefined,
        }
        registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
        const status = tools.get("agent_teams_status")
        const value = await status.execute({}, { agent: member })
        const rendered = status.output.render({}, value)[0].text
        expect(rendered).toContain("hold state not readable on this host")
        expect(rendered).not.toContain("no hold is set")
        expect(value.pause.internal_implementation.state).toBe("not-readable")
        expect(value.pause.active).toBe(false)
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

// ── END replacement block ────────────────────────────────────────────────────────────────────────
//
// The patch also updates the FILE HEADER's T-19 line (currently "names BOTH pause mechanisms and
// explicitly defers the team watchdog's hold to `session-watchdog-status`; it adds no resume verb")
// to: "T-19 — `agent_teams_status` names ONE pause mechanism (`agent_teams_halt`); the team
// watchdog's PRESERVING hold is reported as its INTERNAL implementation, read for DISPLAY through the
// watchdog's own service (fail-open, gates nothing); it adds no resume verb."
