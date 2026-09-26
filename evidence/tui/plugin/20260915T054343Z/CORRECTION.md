# CORRECTION to the t4 completion record (written by t23)

The t4 delivery was recorded as complete on the strength of `bun run typecheck`,
`bun test packages/mpd-tui-plugin` (29 pass) and a probe of the BUILT entry. Those
results were real, but the package was **INERT in a real dsh-tui boot**:

- every seam used `ctx.get('<service>', false)` at apply time, and in this harness
  a service is only reachable from a context that INJECTED it — an inject-free row
  gets `undefined` for `commands`, `settings` and all seven `tui*` services, so all
  of them took their "service not composed" branch;
- the unit tests passed only because the fakes returned services from `get`
  unconditionally, i.e. the fakes did not model the host;
- measured proof and root cause:
  `evidence/tui/plugin/20260915T054343Z/mount-instrumentation/FINDING.md`
  (instrumented rows mounted in a real profile; `report-no-inject.json` vs
  `report-with-inject.json`).

Repaired under **t23** (`evidence/tui/plugin/20260915T060934Z/`): the deferred
`ctx.inject(['<service>'], scoped => …)` form activates every seam; the status
line, board scene, shortcuts, dialogs, `/mpd` command, command-tree completion and
the `/settings` section are all demonstrated in real boots (pane captures in that
directory's `mount/`), the unit tests now model the host (they fail when a service
was not injected), and refusals are reported honestly instead of being inferred
from a disposer's type.

One surface remains NOT demonstrated: a `tuiRenderers` transcript line — see
`../20260915T060934Z/mount/README.md` §"NOT demonstrated".
