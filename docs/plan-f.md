# Plan F — Native adoption of dsh-agent-teams as the primary invocation model

Status: **PROPOSED (2026-08-27)** — design locked by owner decisions; waves start on approval.

Owner decisions (2026-08-27 Q&A):
- Q1 integration: **full native adoption** — upstream v0.1.14 TypeScript source moves into
  `packages/mpd-agent-teams` as a first-party package (build from source, free modification);
  the Web panel keeps the upstream-built `lib/client.js` artifact; the `third-party/` copy and
  `scripts/vendor-agent-teams.mjs` retire (the script is repurposed as the `_deps` materializer).
- Q2 main-agent switch: **new `mpd-captain` preset** carries the team-first protocol; the 11
  existing `mpd-*` OMO presets stay untouched as the leaf base layer. Progressive migration.
- Q3 leaf iteration: **new tool `mpd_leaf_iterate`** — Ralph-style fresh-round loop with
  structured handoff, hard round cap, evidence under `.mpd/leaf/`.
- Q4 gates: **gates into the runtime** — new `mpd_gate_run` tool (bun test / tsgo / qa self-test);
  a leaf's completion criterion is a real passing gate run; failure continues iteration.
  The repo process gates (AGENTS.md §4) remain binding for every wave as always.
- Q5 depth model: **configurable, default 3 levels**, no hard-coded cap; keep the possibility of
  deeper recursion. The captain must perform an upfront **project-scale assessment** and decide
  which layer is terminal before spawning; small projects stay shallow (captain + one-shot leaves,
  no team). A node budget guard prevents runaway trees.

## 1. Goal and scope

Replace the current OMO-style delegation-first main loop (sisyphus: mandatory delegation check,
decompose, parallel one-shot fan-out, oracle protocol) with a **team-first invocation model**:

1. **Captain** (main agent, new `mpd-captain` preset) drives `agent_teams_*`: create team,
   stage the task DAG, approve, scheduler claims ready work.
2. **Members** are durable continuable subagents (depth 1) with executor bases (sisyphus /
   hephaestus / sisyphus-junior).
3. **Leaves** are one-shot children (depth 2, configurable deeper) whose persona is one of the
   OMO `mpd-*` presets (oracle / librarian / prometheus / explore / metis / momus /
   multimodal-looker / executor roles), with spawn-time `toolFilter` tightening and a
   per-project self-iteration loop (`mpd_leaf_iterate`) whose exit condition is a real gate run
   (`mpd_gate_run`).
4. dsh-agent-teams becomes first-party source: adopted, modified, and built by this repo.

## 2. Verified current state (survey notes)

- Vendored plugin: `third-party/dsh-agent-teams` = upstream-built JS (`lib/*.js`, ~10k LOC)
  + `_deps/` runtime closure produced by `scripts/vendor-agent-teams.mjs` (host-package
  snapshots with import rewrites). Bundle row `agent-teams` config: `stateDir: .mpd/team`,
  `memberProvider: spawn`, `memberMaxDepth: 1` (packages/mpd-bundle/cordis.patch.yml).
- Members are continuable subagents: `ctx.subagents.startContinuable` + `followup` +
  `interrupt`; persona + toolFilter applied at spawn; `memberMaxDepth` is passed through as
  the member's `maxDepth` (lib/tools.js:2184 -> lib/members.js:391). Raising it to 2 enables
  member -> leaf delegation today; the host enforces the cap (`SubagentDepthError`).
- plan-e already rewired all persona/skill team guidance to `agent_teams_*`; the remaining
  OMO-first behavior lives in the main presets' delegation sections
  (packages/mpd-presets-plugin/presets/mpd-sisyphus/agent.cordis.yml).
- OMO base layer: 11 `mpd-*` presets; `docs/omo-parity-gap.md` records the upstream rule that
  read-only agents never join teams as members (they are one-shot consultations) — this maps
  cleanly onto the leaf layer.

## 3. DSH host seams this plan builds on (verified in the installed host)

- `ctx.subagents`: one-shot `start` + `startContinuable/followup/interrupt/reportFrom/
  listChildren`; request options `maxDepth / toolFilter / persona / outputSchema / agentOptions`.
- Child composition joins the parent preset, then applies per-child persona + toolFilter —
  the OMO-base injection point (leaf persona references preset ids, no text duplication).
- Depth accounting: child = parent depth + 1, capped by `maxDepth` at every start.
- `dsh-tool-subagent` default `maxDepth = 3` — agent -> subagent -> sub-subagent is the host
  default; we were the ones pinning it to 1.
- Ralph (`dsh-tool-ralph`): fixed fresh-child round loop with structured handoff and round cap —
  the pattern `mpd_leaf_iterate` follows (but with gate-run exit criteria, which Ralph lacks).
- `dsh-goal-round-driver`: same-session auto-continuation — noted as an alternative, not used
  initially (nesting goals inside one-shot children is unverified).
- `dsh-tool-workflow`: staged fan-out; complementary to teams, not the main chain.
- Preset plane cannot do per-tool permissions (disabling tool-fs kills reads too); spawn-time
  `toolFilter` + `ctx.tools.guard` are the enforcement seams we use instead of persona text.

## 4. Target architecture

```
user
 └─ captain  (mpd-captain preset; team-first protocol; upfront scale assessment)
     └─ member xN (continuable, depth 1; executor bases: sisyphus / hephaestus / sisyphus-junior)
         └─ leaf (one-shot, depth 2..N per config; persona = mpd-* OMO preset;
                  toolFilter tightened; mpd_leaf_iterate + mpd_gate_run; no further delegation)
```

- Read-only advisors (oracle / librarian / explore / metis / momus / prometheus /
  multimodal-looker) are leaves only — preserving the upstream OMO member rule.
- Two iteration levels: team level review -> repair -> re-review (agent-teams quality gates,
  already present); leaf level fresh-round self-iteration (new, gate-terminated).
- Depth policy (Q5): `memberMaxDepth` configurable (default 3). Captain assesses project scale
  in the planning turn and chooses the terminal layer; small projects use direct one-shot leaves
  with no team. Guardrail: configurable node budget (`maxNodes` / per-leaf round cap) so "deeper
  recursion stays possible" without runaway cost.

## 5. Waves (each wave = feature branch + AGENTS.md §4 gates + evidence)

### W0 baseline lock
1. Download upstream v0.1.14 tarball (tag `v0.1.14`, GitHub) to a pinned asset path; record
   SHA256 + commit in `VENDOR_LOCK.json` assets block.
2. LICENSE-NOTICES.md: record fork base, MIT, author, and our modification scope.
Evidence: `evidence/plan-f/w0/upstream-lock.json`.

### W1 native adoption (`packages/mpd-agent-teams`)
1. New package: upstream `src/` (host plane) imported verbatim; `src/client/` kept for future
   use (panel still ships the upstream-built `lib/client.js` + assets for now).
2. Build: `tsc -p tsconfig.json` -> `lib/`; then the `_deps` materialization/rewrite step
   (repurposed `scripts/vendor-agent-teams.mjs`) so bare `@deepseek-ai/*` imports resolve
   relative to the package under every install layout (pnpm never links bundle transitives).
3. package.json: `name: "@mpd-dsh/agent-teams"`, exports `.` / `./client` / `./package.json`,
   `dsh.client` block preserved; MIT provenance.
4. Bundle patch: row id `agent-teams` -> `name: '@mpd-dsh/mpd/packages/mpd-agent-teams'`,
   config `stateDir: .mpd/team`, `memberProvider: spawn`, `memberMaxDepth: 3`.
5. `pack-mpd.mjs`: add the package to `PLUGIN_PKGS`; drop the `third-party` copy step.
6. Delete `third-party/dsh-agent-teams`; repurpose the vendor script.
7. Update AGENTS.md §1/§12 rows and LICENSE-NOTICES.
Gates: bun test (ported upstream TDD scripts + our smoke), tsgo, dsh-qa mount assert (row path
change), relocate-smoke (staged install + boot + 11 presets), team-route-rewire re-run incl. web
panel route 200. Evidence: `evidence/plan-f/w1/`.

### W2 invocation-model switch (`mpd-captain`)
1. New preset `packages/mpd-presets-plugin/presets/mpd-captain/` (preset.yml +
   agent.cordis.yml, model composition copied from sisyphus): team-first protocol —
   default `agent_teams_create` + DAG for multi-unit work; one-shot `subagent` only for
   quick single consultations; upfront scale assessment deciding terminal layer; honest
   cost/latency disclosure.
2. Built-in team profiles (plugin `profiles` config) mapping OMO roles to member/leaf bases:
   executors = sisyphus / hephaestus / sisyphus-junior; advisors = leaf-only one-shots.
3. Bundle patch: add `mpd-captain` to bootstrap preset list (version bump for re-copy).
4. Retire `mpd-team-plugin`: remove bundle row `mpd-team`; keep source archived (superseded by
   agent-teams; role-pool inversion recorded in plan-e).
5. usage-section wording: adjust `usageSectionText` so team-first is the DEFAULT mode, not an
   opt-in keyword.
QA: headless e2e — captain creates team -> stages DAG -> approve -> member claims -> member spawns
leaf -> leaf reports -> captain converges. Evidence: `evidence/plan-f/w2/`.

### W3 leaf layer (`mpd-leaf-plugin` + `mpd-gate-run`)
1. New plugin `packages/mpd-leaf-plugin`: tool `mpd_leaf_iterate` —
   inputs: objective, base preset id (mpd-*), maxRounds (default 3), gate contract;
   loop: spawn one-shot leaf (persona = preset persona text, toolFilter deny delegation +
   team tools, model route per `mpd_modelchain_resolve`), collect structured report +
   gate run, feed prior output as next-round context; exit = gate pass or round cap;
   evidence JSON per run under `.mpd/leaf/<id>/`.
2. New tool `mpd_gate_run` (same or sibling plugin): executes the repo gate suite
   (bun test / tsgo --noEmit / qa self-test) in the project workspace, returns pass/fail +
   clipped log; used as leaf completion criterion (Q4) and usable by members/captain.
3. Read-only leaf enforcement: spawn-time `toolFilter` (deny write/edit + delegation tools for
   advisor bases) + a `tools.guard` in mpd-tools-plugin keyed by leaf scope — stronger than
   persona text, closing part of the parity-gap "no per-tool permissions" limitation.
4. Bundle patch rows + version bump.
QA: golden tasks >= 2 hardware (RTL module + testbench, lint cleanup) with iteration-round and
gate evidence; cost/latency measurement for depth 2 vs depth 3. Evidence: `evidence/plan-f/w3/`.

### W4 convergence & release
1. Full gate sweep (verify-vendor with new lock, bun test, tsgo, test:qa, relocate-smoke, boot
   check); `docs/plan-f.md` -> COMPLETE with evidence links.
2. Docs: README (invocation model), AGENTS.md §1/§3/§12, LICENSE-NOTICES, PLAN.md status note.
3. Version bump 0.3.0; release branch per §11.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Web panel rc drift | ship upstream-built `lib/client.js` untouched; web-route evidence every wave |
| `_deps` closure vs host type drift | `_deps` materialized from the host install (existing mechanism); re-run on DSH upgrades |
| Cost/runaway from depth 3 + recursion | node budget + per-leaf round caps + leaf denies further delegation + captain scale assessment |
| 10k-LOC source absorption burden | upstream code and our delta layered apart; pruning roadmap toward a thin core once behavior is test-locked |
| goal-in-child composition | avoided initially; `mpd_leaf_iterate` is self-contained |
| Preset re-copy staleness | `mpd-bootstrap` is version-stamped — bump package version whenever presets/profiles change |

## 7. Follow-ups after W4 (backlog)

- Build the Web panel from `src/client/` (React) once host client packages are pinned — today
  the upstream artifact is safer.
- Prune unused agent-teams modules (fallback route, model-directory validation) toward the thin
  core.
- Spike: goal-round-driver as an alternative leaf continuation (only if Ralph-style rounds show
  context-loss problems in golden runs).
