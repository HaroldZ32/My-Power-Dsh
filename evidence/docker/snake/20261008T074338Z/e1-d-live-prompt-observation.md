# E1-d CLOSED BY OBSERVATION — the caller-supplied live prompt reached a real container VERBATIM

captured-utc: 2026-10-08T08:41:43Z
source-file: evidence/docker/client-install/2026-10-08T08-06-30Z/console.log
source-sha256-at-capture: 75568814607b9842c7d092ea87597f15676da780dc9759a00bef89c74b452536
source-bytes-at-capture: 201306

## The line, verbatim (grep -a '\[live-prompt\]')

[live-prompt] promptSource=caller (MPD_E2E_LIVE_PROMPT) bytes=377 firstLine="Write a playable classic Snake game as ONE self-contained file at `snake/index.html` in the current directory: no build step, no network access, no dependencies. Arrow keys (or WASD) steer, the snake grows and the score increases when it eats, hitting a wall or itself ends the game with a visible game over message, and Enter (or R) restarts. Keep everything in that one file."

## What it shows, and nothing more
- promptSource=caller (MPD_E2E_LIVE_PROMPT): the entrypoint's step-15 selection took the CALLER's
  prompt, not its own default team-plane prompt.
- bytes=377: the value arrived at its full length, so the three forwarding layers
  (host env -> scripts/docker-e2e.ts '-e MPD_E2E_LIVE_PROMPT' -> compose environment
  interpolation -> entrypoint) carried it without truncation or substitution.
- firstLine= is byte-identical to the prompt this lane exported (compare with
  live-prompt-invocation.txt in this evidence dir).
- It does NOT prove anything about the model turn's quality; that is E2-c's job.
