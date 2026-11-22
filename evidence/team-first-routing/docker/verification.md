# Rootless Docker source lane

Target implementation `532520024568a3dcb56635d55576520c679078d5`. The tracked working tree matched that commit before launch. The daemon reported rootless mode, Docker `29.9.2` and Compose `v5.7.0`.

## Canonical pack and isolated build input

The destination resolved to the repository's ignored, untracked `dist/mpd-package` directory. Its 685 regular files matched the previous generated baseline byte for byte, with no extra files or symlinks. The repository packer regenerated that destination from the exact tracked commit exported into a separate workspace scratch directory. Strict closure exited 0 at pack stamp `2026-11-22T18:19:35.258509993Z`, checking 30/30 declared packages and 672/672 identical compared files with zero missing required content. The one declared exemption is the QA-only roles probe.

The container build context was the tracked commit exported with `git archive --format=tar 532520024568a3dcb56635d55576520c679078d5 -- . ':(exclude)evidence'`, plus a copy of the regenerated canonical pack. All 681 package members matched the T5 tarball's bytes in both copies. The tarball SHA-256 is `ed7ff9d1fd49f7ddb6162a698ab618546a7410b0c5a079d1e00fe459201f9308`.

## Invocation

`node scripts/docker-e2e.ts --mode source --require-docker --no-browser` ran from the isolated checkout with a dedicated Compose project name and the driver's private Buildx configuration. With the live and browser controls disabled, this invocation exercises the required mount and user-surface arms on the pinned container host. T4 owns the independent evaluation of model routing and consult calls.

## Observed result

The driver and container both exited 0. The gate ran from `2026-11-22T18:19:42.695Z` to `2026-11-22T18:24:07.045Z`, taking 264.35 seconds. Of 244 assertions, 163 passed, zero failed and 81 were unmeasured. The driver recorded zero unmeasured required assertions. [Structured result](./result.json)

- The Ubuntu 24.04.5 container installed DSH `0.2.2-rc.5`. The Web profile installed the checkout, created a real `mpd` session, mounted the session-gate listener and ran an AST-grep tool call with a negative control.
- The TUI profile booted on a real PTY with `agentPreset=mpd`. The user-surface arm recorded 85 passes and 35 declared bounds. It observed the preset and roles rows and the live command corpus.
- In the container, all 35 compiled files were byte-identical to a rebuild with the canonical Bun `1.4.0`. The separate installer Bun was `1.4.5`. Mutating one copied packed artifact flipped the freshness arm to false as the negative control expected.
- The lane left 31 credential-dependent checks, 10 browser checks, four one-click checks and the model-driven MCP case unevaluated. The model-driven MCP case reported missing credentials. The direct mounted AST-grep call passed independently.

Raw driver, result and output log hashes are in the structured result. The full logs remain in the ignored Docker scratch export.
