# agent-references — on-demand reference material

Agent-facing, English-only reference files for the repository manual `AGENTS.md`. They live outside
the instruction-file discovery path (no `AGENT.md`/`AGENTS.md`/`CLAUDE.md` here), so they are never
auto-injected: an agent opens them when `AGENTS.md`'s "Reference Index (on-demand)" section, or a
pointer inside `AGENTS.md`, sends it here.

This tree is agent-facing, not human-facing: the bilingual rule does not apply, no `*.zh-CN.md`
twin is required, and `bun run verify:docs` does not discover these files.

In a packed artifact (`dist/mpd-package/`) there is no `AGENTS.md` and no Reference Index: the
pointers above do not resolve there, so each file in this tree stands alone — the two moved bodies
keep their `§N` provenance lines as historical citations of the repository manual, not links.

| File | Holds |
|---|---|
| `troubleshooting.md` | the full symptom → cause/fix table (former `AGENTS.md` §12 body) |
| `agent-teams-deltas.md` | the adopted agent-teams delta registry — the A1–D42 table, registry mechanics, live region count, wave-2 driver-script warning (former `AGENTS.md` §6 body) |
| `verification-flow.md` | the ordered verification flow behind `AGENTS.md` §4/§11 — AND the former §4 body verbatim (the full gate table with every per-row measurement): what each gate is worth, why the Docker real-machine lane is the LAST step, and the measured rootless / skip / `--require-docker` policy |
| `seam-adapters.md` | the TWO contact surfaces in detail (`AGENTS.md` §6): the harness adapter and the DSH-TUI adapter, the fourteen `tui*` seams with their binder/probe/degrade discipline, the R5 "no terminal writes" rule and its gates, the declared WEB-plane residual, and the upstream panel-seam ask |
| `upstream-dsh-tui-seam-request.md` | the upstream ask drafted from this bundle's DSH-TUI seam work |
| `overview-and-provenance.md` | the full `AGENTS.md` §1 body (moved verbatim 2026-10-06): what the bundle carries from upstream, the adopted-then-retired agent-teams body, the declared-dependency mount mechanism, the ULW/GOAL detail and the session-start gate's softer signals |
| `plugin-authoring.md` | the full `AGENTS.md` §6 body (moved verbatim 2026-10-06): the two adapter surfaces in detail, the counted host-setup bypass and the R1–R5 residuals, the delta-registry mechanics, the tool/guard/waterfall/subagent API signatures and the state-resolution rules |
| `qa-discipline.md` | the full `AGENTS.md` §7 body (moved verbatim 2026-10-06): the triple-isolation rationale, the live-case session-log decode trap, the durable-anchor (T-90) calibration bound and the preset/row conformance failure modes |
| `installer-and-profiles.md` | the full `AGENTS.md` §8 body (moved verbatim 2026-10-06): the one-command install in detail, the build-script-free dependency closure, the packed-artifact layout and the legacy `install-profile.ts` flow |
| `glossary.md` | the full `AGENTS.md` §13 body (moved verbatim 2026-10-06): every glossary term (DSH, bundle, patch layer, preset and the 0.1.7 preset-form change, mpd, golden) plus the long forms of the roster/workmate/slot definitions |
