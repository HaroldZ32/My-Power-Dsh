# License Notices

- This repository is derived from the upstream project (upstream commit 8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29, v5.0.0-beta.20).
- License: Sustainable Use License 1.0 (SUL-1.0). See LICENSE.md for the full text.
- Third-party components keep their original licenses/notices in their source trees.
- DSH packages (@deepseek-ai/*) are MIT licensed and referenced as dependencies only.

## dsh-agent-teams (MIT) — adopted plugin, first-class main code

The `agent-teams` plugin (tools `agent_teams_*`, Web activity panel, team scheduler)
is adopted from the dsh-agent-teams project (v0.1.14,
https://github.com/NanmiCoder/dsh-agent-teams) and distributed under the MIT License.
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
