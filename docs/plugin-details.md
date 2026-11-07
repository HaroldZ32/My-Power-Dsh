# MPD — what this plugin adds to DeepSeek Harness

**English** | [中文](./plugin-details.zh-CN.md)

**my-power-dsh** (package `@mpd-dsh/mpd`) is a DeepSeek Harness plugin bundle. It does not replace the
harness: it installs beside it, mounts through its own `cordis.patch.yml` layers, contributes the **MPD
(Main Working Agent)** preset, a specialist roster, a shared team board, durable workmates, a memory store,
verification surfaces and native **DSH-Go** panels. Everything is workspace-scoped under `.mpd/`; the
bundle leaves no home copy, and uninstalling it leaves no installed residue.

## What MPD adds to DSH

- **A preset built for real work.** `mpd` is a main working agent with the roster, the team plane, the
  workmate library, memory and the verification tools already wired.
- **Eleven specialists.** Architect, Researcher, Planner, Deep Worker, Senior Engineer, Lead, Explorer,
  Reviewer, Plan Reviewer, Vision Analyst and Junior Engineer — used as one-shot consults
  (`mpd_role_spawn`), as team members, or as durable workmates.
- **A shared board.** A captain stages a plan with `agent_teams_plan`, approves it, and the board is driven
  with `agent_teams_task` / `agent_teams_dispatch`; the team's dependency graph, owners and review rows are
  visible in the **Team** sidebar view, the TUI's `/mpd team` scene and the DSH-Go team panel.
- **Workmates and memory.** `mpd_workmate_*` keeps a durable, evolving instance per specialty under
  `~/.mpd/workmate`; `mpd_memory_*` keeps a VCS-backed memory for the workspace.
- **Verification surfaces.** `mpd_verify_open` / `mpd_verify_evidence` / `mpd_verify_record` make a
  writer-verifier split auditable instead of a promise.
- **A native DSH-Go surface.** Two panels, a composer strip, composer and message actions, and tool cards —
  declared statically in the manifest, rendered by the app, and silent on a host without the bridge.

## The specialist roster

The roster is a set of teammate instantiation templates, addressed by name. A single consultation is one
bounded delegation that returns one report; multi-member work uses the team plane, where each member keeps
its own model route (`agentRoutes.<Agent>` in `mpd.jsonc`). A specialist that proves useful can be
instantiated as a **workmate**: a durable instance with its own persona, memory and note card that carries
continuity across sessions.

## The team board

Team work is staged, not improvised. The captain creates a plan, adds members with their personas, adds
tasks that each declare their dependency answer (`blocked_by` or an explicit `independent: true`) and their
write scopes, then approves. Approval executes the plan: members are started, the board is seeded, and a
goal plus a todo list anchor the run. A verification row is owned by a DIFFERENT agent than the writer, and
a recorded FAIL bounces the work back as a repair task.

## Workmates and memory

A workmate lives in the user's home under `~/.mpd/workmate`, evolves through `mpd_workmate_reflect`, and is
reused by note match (`mpd_workmate_match`). Memory is workspace-scoped and VCS-backed
(`mpd_memory_write` / `mpd_memory_read`), with a reflection cycle every few entries so the agent carries
lessons forward. Neither surface is required for the bundle to boot.

## The DSH-Go panels

The bundle declares a DSH-Go protocol-1 manifest: two panels (`mpd` workbench and `mpd-team` board), one
composer strip, two composer actions and two message actions, each panel naming a hand-written static view
under `dsh-go/views/`. The host half binds the `dshGo` bridge through one deferred
`ctx.inject(["dshGo"], …)` in the adapter; a host without the bridge registers nothing, logs one
`dshGo=absent` line and does not poll. The standard, the gates and the bounds are in
[`dsh-go-standard.md`](dsh-go-standard.md).

## Where the full documentation lives

- [`../README.md`](../README.md) — the product page: surfaces, feature inventory, install, quick start.
- [`index.md`](index.md) — the documentation hub.
- [`user-guide.md`](user-guide.md) — the task-oriented guide.
- [`tui.md`](tui.md) — the DSH-TUI edition; [`tui-admission.md`](tui-admission.md) — its admission record.
- [`drive-surface.md`](drive-surface.md) — the DSH-Go / team / question-relay seams for integrators.
- [`compatibility.md`](compatibility.md) — the three-plane compatibility matrix and the display-metadata
  contract (icon, `meta` wrapper, `meta.detail`).
- [`development.md`](development.md) — gates, QA, packing, release flow.
- [`../CHANGELOG.md`](../CHANGELOG.md) — what changed in each release.
