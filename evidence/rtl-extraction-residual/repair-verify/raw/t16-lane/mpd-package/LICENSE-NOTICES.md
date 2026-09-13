# License Notices

- This repository is derived from the upstream project (upstream commit 8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29, v5.0.0-beta.20).
- License: Sustainable Use License 1.0 (SUL-1.0). See LICENSE.md for the full text.
- Third-party components keep their original licenses/notices in their source trees.
- DSH packages (@deepseek-ai/*) are MIT licensed and referenced as dependencies only.

## dsh-agent-teams (MIT) — adopted plugin, first-class main code

The `agent-teams` plugin (tools `agent_teams_*`, team scheduler; its Web views back the
AgentTeams sidebar tab contributed by `mpd-bundle-plugin`)
is adopted from the dsh-agent-teams project (0.1.14 body, with the audited upstream
0.1.16-rc.3 deltas backported into `lib/` — Harness subagent boundary, agent-scoped
capabilities, tool names, authenticated web routes, member turn-failure handling and the
durability fixes; https://github.com/NanmiCoder/dsh-agent-teams) and distributed under the
MIT License. The adopted package version is recorded as `0.1.16-rc.3-mpd`; the browser
bundle (`lib/client.js`) is still the 0.1.14 build.
It ships as **first-class main code** at `packages/mpd-agent-teams-plugin/` (lib +
assets + package manifest; loaded via the bundle exports map; plugin row id
`agent-teams`, tools `agent_teams_*` kept stable). Its server-side runtime closure is
vendored under `packages/mpd-agent-teams-plugin/_deps/` with each package's own LICENSE
retained:
- `@deepseek-ai/schemastery`, `@deepseek-ai/cosmokit`, `@deepseek-ai/cordis`,
  `@deepseek-ai/dsh-scope`, `@deepseek-ai/dsh-timeout`, `@deepseek-ai/dsh-llm`,
  `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-tools`,
  `@deepseek-ai/dsh-agent` (MIT, Copyright (c) 2021-present Shigma and the DeepSeek team —
  versions pinned to the host installation at vendor time; regenerate via
  `node scripts/vendor-agent-teams.mjs`);
- `zod` (MIT) and `@standard-schema/spec` (MIT).
Native package-name resolution cannot be relied on (pnpm never links a bundle's
transitive deps into the profile root, and code outside the profile's node_modules
cannot see `@deepseek-ai/*`), hence the vendored closure. Original license text retained at
`packages/mpd-agent-teams-plugin/LICENSE`.

Local adaptations in the adopted main code (all marked in-source with `LOCAL ADAPTATION`):
- `memberPersona` injects the workmate library's persona/memory for members named after a
  workmate;
- `lib/members.js` degrades instead of aborting when the host harness build does not expose
  `ctx.subagents.registerContinuableSetup` (dsh 0.1.2-rc.1 and every later host, incl.
  0.1.5-rc.2, dropped the seam): the member model-selection bridge is disabled with a
  warning, and members keep the Harness descriptor provider/model. Without this guard a
  single missing optional seam aborted the whole plugin tree at boot, so no bundle row
  (skills, preset, tools) could load.
- `lib/harness-compat.js` + `lib/members.js` take the live child Agent from the
  `agent/session-start` payload (`setup(agent.ctx, agent)`) instead of reading
  `childCtx.agent`. An agent-scoped Cordis ctx refuses undeclared property reads, so the
  ctx read threw `cannot get property "agent" without inject` on dsh 0.1.5; because the
  listener also fires for the captain's own session-start, that disabled team mode entirely
  (boot exited 1 with "member initialization failed"). `agent` is not a registerable
  service — the host only injects `agents` (plural registry) — so the Agent must come from
  the payload. The legacy `registerContinuableSetup` path keeps `childCtx.agent` as a
  fallback, where that ctx does carry it.

MIT License

Copyright (c) 2026 程序员阿江(Relakkes)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## @code-yeongyu/comment-checker (MIT) — opt-in check binary

The optional comment/docstring detection binary used by mpd-comment-checker-plugin
is the npm package `@code-yeongyu/comment-checker` 0.8.0
(https://github.com/code-yeongyu/go-claude-code-comment-checker), distributed under
the MIT License. It is not redistributed in this repository; it is installed on
demand into `.toolchain` (installer flag `--with-comment-checker`).
