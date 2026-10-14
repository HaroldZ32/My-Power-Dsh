# ATTRIBUTION / NOTICE — `data-scientist`

> **Honest provenance statement.** The body of this skill is **upstream content re-sourced under its
> own author's MIT grant**. It was **not** written in this repository. Until wave A of the de-omo
> decoupling (`.mpd/plans/de-omo-decoupling.md`) the corpus was ported from
> `code-yeongyu/oh-my-openagent` (SUL-1.0); it is now sourced from the same author's MIT re-license of
> that corpus. Where a file below is listed as ours, that file is this repository's own work.

## Source

- Repository: <https://github.com/code-yeongyu/lazycodex>
- Pinned revision: `6f08c77347a68eaa87f4e7656147e8d793c9a069`
- Source path: `plugins/omo/skills/data-scientist/`
- Source licence: **MIT**, `Copyright (c) 2026 Yeongyu Kim` (LICENSE at the pinned revision)
- Re-sourced: 2026-10-08 — every file the two trees share was rebuilt from the pinned bytes, with
  this repository's local adaptations re-applied and Codex-harness-only material removed
  (`## Codex Harness Tool Compatibility` / `## Codex Subagent Reliability` blocks,
  `multi_agent_v1.*` calls, `lazycodex-*` agent types, `~/.codex/...` agent paths).

### Local adaptations in this repository (NOT upstream)

our frontmatter `description`; the dependency-cache scripts use `MPD_DATA_SCIENTIST_CACHE` / `~/.cache/mpd-data-scientist` instead of the upstream cache paths. Four legacy reference docs (`common-scenarios.md`, `execution-templates.md`, `integration-patterns.md`, `performance-benchmarks.md`) were dropped in this wave: unreferenced after the re-source and superseded by upstream's `execution-surfaces.md`, `placement.md`, `polars-lane.md` and `visualization.md`.

### MIT License (verbatim from the source repository's LICENSE)

```
MIT License

Copyright (c) 2026 Yeongyu Kim

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
```

### Re-license notice (verbatim from the source repository)

Quoted verbatim from `plugins/omo/components/rules/NOTICE` at the pinned revision
(sha256 `8068fb3509c240a37192caa9192fad768ecec91b64cb5ce0dbd82aa03c37069a`):

> Yeongyu Kim (https://github.com/code-yeongyu), author of omo, pi-rules, and this
> package, licenses the source distributed in this repository under the MIT License.
> If any source was ported from omo or pi-rules, that ported source is re-licensed
> here under MIT for distribution as a Codex plugin. See LICENSE for terms.

The copyright holder of the SUL-1.0 corpus and the licensor of this MIT grant are the same person, so
the grant above is the rightsholder's own re-license of the source it covers. This file records
provenance only — it does not change this repository's own licence.

---
