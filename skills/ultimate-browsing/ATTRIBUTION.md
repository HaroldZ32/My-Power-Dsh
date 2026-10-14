# ATTRIBUTION / NOTICE — `ultimate-browsing`

> **Honest provenance statement.** The body of this skill is **upstream content re-sourced under its
> own author's MIT grant**. It was **not** written in this repository. Until wave A of the de-omo
> decoupling (`.mpd/plans/de-omo-decoupling.md`) the corpus was ported from
> `code-yeongyu/oh-my-openagent` (SUL-1.0); it is now sourced from the same author's MIT re-license of
> that corpus. Where a file below is listed as ours, that file is this repository's own work.

## Source

- Repository: <https://github.com/code-yeongyu/lazycodex>
- Pinned revision: `6f08c77347a68eaa87f4e7656147e8d793c9a069`
- Source path: `plugins/omo/skills/ultimate-browsing/`
- Source licence: **MIT**, `Copyright (c) 2026 Yeongyu Kim` (LICENSE at the pinned revision)
- Re-sourced: 2026-10-08 — every file the two trees share was rebuilt from the pinned bytes, with
  this repository's local adaptations re-applied and Codex-harness-only material removed
  (`## Codex Harness Tool Compatibility` / `## Codex Subagent Reliability` blocks,
  `multi_agent_v1.*` calls, `lazycodex-*` agent types, `~/.codex/...` agent paths).

### Local adaptations in this repository (NOT upstream)

our frontmatter `description`; the Tier-2 section and `references/chrome-stealth.md` document CloakBrowser + agent-browser (upstream's names the author's own in-house Codex browser library); cookie state under `~/.local/state/mpd-cookies`; `.gitignore`; `scripts/tests/**` are ours.

The third-party sections BELOW (§1 insane-search engine, §2 first-party reference content, §3 CloakBrowser, §4 agent-browser) are untouched by this re-source and remain in force.

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

## 1. insane-search engine — vendored upstream snapshot, modified

`engine/**` originates from the **insane-search** project and is NOT
project-original code, despite being heavily modified since import.

- Upstream source: https://github.com/fivetaku/insane-search
- Vendored into this repository on 2026-06-21 by commit
  **`a4e4ed797`** (`feat(ultimate-browsing): vendor insane-search engine (junk-excluded)`),
  via an explicit file whitelist that excluded caches and smoke-test junk.
- Baseline: the upstream state as of that date, a **pre-0.7.0 snapshot**.
  Upstream's CHANGELOG dates 0.7.0 to 2026-06-22; imported files carry no
  version marker. We have never re-vendored since; the tree has diverged in
  both directions.
- Modifications by this project (non-exhaustive): de-personalization
  (`4743199a5`), the Phase 2.5 surrogate retrieval stage and surrogate registry,
  the provenance/trust result contract, the `bias_check.py` no-site-name CI gate,
  module split of the fetch chain, and the Python test suite under
  `engine/tests/`.
- License: **MIT**. The vendored snapshot predates upstream's `LICENSE` file, so the
  snapshot itself carries no license text; the license below was read from upstream's
  public `HEAD` (`https://raw.githubusercontent.com/fivetaku/insane-search/main/LICENSE`,
  fetched 2026-10-08, 1065 bytes, sha256
  `e343d30bc6631a1c8377b7aac26e7b1c5b38366913a98ef71fe6861fe812dcd4`) and is the standard
  MIT text.
- **Snapshot-vs-HEAD bound.** Upstream reset its public history on **2026-08-06**, so the
  commit we vendored from (`a4e4ed797`, 2026-06-21) is no longer reachable in upstream's
  public history and cannot be re-fetched or diffed against. The license text below is
  therefore taken from upstream's current public `HEAD`, not from the vendored revision —
  this repository does not claim the two are byte-identical, only that upstream's project
  license is MIT.
- **Fixed by NOTICE only (2026-10-08).** The missing-notice defect was fixed by documentation:
  this file carries the upstream MIT notice text, and no LICENSE/NOTICE carrier under `engine/**`
  was added or changed. SEPARATELY, the same wave's lazycodex re-source rebuilt five `engine/**`
  files from the pinned bytes (licensing in §2): `engine/AGENTS.md`,
  `engine/templates/package.json`, `engine/templates/playwright_mobile_chrome.js`,
  `engine/templates/playwright_real_chrome.js`, `engine/tests/test_playwright_templates.py`.

```
MIT License

Copyright (c) 2026 fivetaku

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

The binding version policy — which upstream baseline we sit on, why we stay
pinned, what a future re-vendor must preserve, and what it must not import — is
[`engine/AGENTS.md` §UPSTREAM BASELINE AND VERSION POLICY](engine/AGENTS.md).

---

## 2. Upstream first-party content (no third-party source vendored here, except `engine/**` — §1)

The following is the **upstream author's own first-party content**, not third-party
material, so it carries no third-party license obligation — with ONE exception, the
`engine/**` entry below, whose origin IS third-party (§1). It is **not** work written in
this repository:

- `references/insane-search/**`, `SKILL.md` and `references/chrome-stealth.md` — re-sourced
  from `code-yeongyu/lazycodex` @ `6f08c77…` under the MIT grant recorded at the top of this
  file (see **Source**).
- `engine/**` — the exception above: five files rebuilt from the same pinned revision on
  2026-10-08 — `engine/AGENTS.md`, `engine/templates/package.json`,
  `engine/templates/playwright_mobile_chrome.js`, `engine/templates/playwright_real_chrome.js`
  and `engine/tests/test_playwright_templates.py`. Those rebuilt bytes travel under
  lazycodex's **MIT** grant (`Copyright (c) 2026 Yeongyu Kim`, top of this file), while the
  engine's OWN origin is unchanged — **`fivetaku/insane-search`, MIT** (§1), which stays in
  force for the rest of `engine/**`.
- `references/agent-reach/**` and `scripts/extract_cookies.py`, `scripts/cookie_paths.py`,
  `scripts/cookie_crypto.py` with their tests — ported from the same author's earlier corpus
  and carrying no counterpart in the pinned revision. First-party to that author; they are
  listed here so that no reader mistakes them for work authored in this repository.

These reference platform-native CLIs and public APIs by name (e.g. `xhs`, `yt-dlp`,
`agent-reach`, `mcporter`, Jina Reader, V2EX public API). Those are external tools the
user installs separately; this skill includes none of their source.

---

## 3. CloakBrowser (CloakHQ) — Tier-2 stealth Chromium (runtime dependency)

The Tier-2 stealth browser is **CloakBrowser**, installed at runtime via `pip`
(`pip install cloakbrowser`). No CloakBrowser source is vendored in this repository.

- Source: https://github.com/CloakHQ/CloakBrowser
- Pinned runtime version: **0.5.7** (documented in `references/chrome-stealth.md`;
  this is a documented version string, not an automated drift check).
- Wrapper source license: MIT License.
- Binary license: the compiled CloakBrowser Chromium binary downloaded by
  `cloakbrowser.ensure_binary()` is governed by the separate CloakBrowser
  Binary License:
  https://github.com/CloakHQ/CloakBrowser/blob/main/BINARY-LICENSE.md
- Redistribution note: this npm package does not redistribute the CloakBrowser
  binary, does not repackage it, and does not include it in `skills/` or
  `dist/skills`. Users who run the Tier-2 setup download the binary directly
  from CloakHQ's official distribution channels and must comply with that
  binary license.

MIT wrapper source license:

```
MIT License

Copyright (c) 2026 CloakHQ

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

---

## 4. agent-browser (vercel-labs) — Tier-2 CDP automation CLI (runtime dependency)

The Tier-2 automation CLI is **agent-browser**, installed at runtime via `npm`
(`npm i -g agent-browser`). No agent-browser source is vendored in this repository.

- Source: https://github.com/vercel-labs/agent-browser
- Pinned runtime version: **0.34.0** (documented in `references/chrome-stealth.md`;
  documented version string, no automated drift check).
- Licensed under the Apache License, Version 2.0 (the "License"); you may not use
  these files except in compliance with the License. You may obtain a copy of the
  License at:

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software distributed under
  the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, either express or implied. See the License for the specific language governing
  permissions and limitations under the License.

- **Changes (Apache-2.0 §4(b)):** none. agent-browser is installed unmodified at
  runtime; no agent-browser source file is copied, modified, or redistributed by this
  skill. This skill only documents how to invoke the upstream CLI.

- **NOTICE:** the upstream agent-browser distribution may include a `NOTICE` file. As
  this skill redistributes no agent-browser source, no upstream NOTICE content is
  bundled here; consult the upstream repository for its `NOTICE` file when present.

- **Trademark notice:** "agent-browser" and "Vercel" are referenced by name for
  identification only. No trademark license is granted under the Apache License 2.0
  (Section 6).
