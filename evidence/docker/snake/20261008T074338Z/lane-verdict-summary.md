# The Docker lane's own verdict for this run (E2-f)

source: evidence/docker/client-install/2026-10-08T08-06-30Z
copied-utc: 2026-10-08T08:50:30Z
lane-result.json sha256: 820f059df207efec47304870cb8a2a5d37c14464ca17541723eb4bfc5d3d7b3a
full logs kept where the lane wrote them: evidence/docker/client-install/2026-10-08T08-06-30Z/console.log (255563 B), evidence/docker/client-install/2026-10-08T08-06-30Z/output.log (268297 B)

## The driver's own summary line
containerExit=1  exitCode=3
verdict: ok=false complete=false passed=88 failed=3 null=3 FAILED=[build.bunInstall,boot.mcpTools,live.teamRecord] NULL=[tui.mergedPanelOpens,tui.mergedPanelOrder,live.nativeExecutor]
unmeasured(required): ["live.nativeExecutor"]
startedAt=2026-10-08T08:06:30.050Z  finishedAt=2026-10-08T08:44:27.123Z
liveRequested=true  browserEnabled=true  imageMiB=419

## Every FALSE and NULL row the container reported
FAIL build.bunInstall — bun install failed (exit=1) | raw: 2:error: Package "@mpd-dsh/mpd" is not linked 10:error: @mpd-dsh/mpd@link:/home/haroldzhao/MyProj/DshProj/My-Power-Dsh failed to resolve 
FAIL boot.mcpTools — an MCP tool is missing from the live registry — its stdio server did not come up | raw: MCP_TOOLS=2/3 MISSING=mcp__codegraph__codegraph_explore
NULL tui.mergedPanelOpens — the merged view's OPEN is not pane-observable on this host: with the 0.13.0 panel seam present it is a sidebar panel, a host-ACCEPTED open() changes zero bytes of a tmux capture, and the routed command's printed line does not reach the transcript either. The panel registration + accepted open ARE asserted, store-backed, by the sandbox lanes on the SAME host version (tui-panels, tui-deps-ctrla). Full-screen surfaces that this lane CAN see on this host are covered by the team-scene arms above | raw: panelSeam=present rowHits=1 module=present proofOwner=skills/dsh-qa/scripts/tui-panels.ts,tui-deps-ctrla.ts
NULL tui.mergedPanelOrder — the merged body's section order is NOT observable on this host: with the panel seam present the merged view is a sidebar panel and its rows do not reach a tmux capture, so this arm is not attempted here (the order is covered by the plugin's unit arms). Recording it as a pass would be a claim the pane does not carry | raw: panelSeam=present orderCoveredBy=packages/mpd-tui-plugin/test/panel.test.ts subagentMarker=line 7 [the host's own empty-state line (this session carries NO host subagent row)] teamMarker=line 0 header=line 6 emptyState=l
FAIL live.teamRecord — no team record exists at /work/ws/.mpd/team/teams after the live turn — the model did not reach agent_teams_plan approve (exit 0) | raw: see 15-headless-live.log
NULL live.nativeExecutor — not measured: no team record exists, so no executor handle could be read | raw: dir=/work/ws/.mpd/team/teams

## The live prompt the step-15 turn was given (the E1 knob at work)
[live-prompt] promptSource=caller (MPD_E2E_LIVE_PROMPT) bytes=377 firstLine="Write a playable classic Snake game as ONE self-contained file at `snake/index.html` in the current directory: no build step, no network access, no dependencies. Arrow keys (or WASD) steer, the snake grows and the score increases when it eats, hitting a wall or itself ends the game with a visible game over message, and Enter (or R) restarts. Keep everything in that one file."
