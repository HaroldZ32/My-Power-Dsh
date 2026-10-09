# License Notices

- **This repository's own code is MIT** — [`LICENSE.md`](./LICENSE.md), `Copyright (c) 2026 HaroldZ32`.
  It is **not** under the Sustainable Use License any more: the de-omo program (waves A–F, 2026-10-08)
  purged and replaced every derived byte, and the licence swap itself is wave E.
- **Read this file as a RECORD, not as a claim.** It keeps (a) every still-true third-party notice and
  (b) the history of what was removed and why, with the tense corrected. A licence record that erases
  its own past is defective, so every `SUL-1.0` / "Sustainable Use" mention below is HISTORY: it
  describes the upstream project oh-my-openagent
  (<https://github.com/code-yeongyu/oh-my-openagent>; commit `8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29`,
  v5.0.0-beta.20) and the vendored content that used to carry those terms.
- This repository's roster names, stable ids and model-chain vocabulary are adapted from that upstream
  project; the CONTENT it supplied — the skill corpus, the MCP server snapshots, the vendored cores and
  the persona texts — has been re-sourced under permissive licences, rewritten or deleted, so no part of
  it remains as translated upstream source. That upstream is recorded as historical provenance in
  [`VENDOR_LOCK.json`](./VENDOR_LOCK.json) and is a *reference, not a dependency*.
- Third-party components keep their own licenses/notices in their source trees.
- DSH packages (@deepseek-ai/*) are MIT licensed and referenced as dependencies only.

## Skill corpus (MIT) — re-sourced from `code-yeongyu/lazycodex`

**The served skill corpus is no longer vendored from oh-my-openagent under SUL-1.0.** The 16 skills
ported from that corpus — `ast-grep`, `data-scientist`, `debugging`, `frontend`, `git-master`,
`init-deep`, `lsp-setup`, `programming`, `refactor`, `remove-ai-slops`, `review-work`,
`ultimate-browsing`, `ulw-execute`, `ulw-plan`, `ulw-research`, `visual-qa` — are sourced from the
SAME AUTHOR's own MIT re-license of that corpus:

- Repository: <https://github.com/code-yeongyu/lazycodex>
- Pinned revision: `6f08c77347a68eaa87f4e7656147e8d793c9a069`
- Source path: `plugins/omo/skills/<name>/`
- Licence: **MIT** — `Copyright (c) 2026 Yeongyu Kim`
- Re-license notice, quoted VERBATIM from `plugins/omo/components/rules/NOTICE` at the pinned
  revision (sha256 `8068fb3509c240a37192caa9192fad768ecec91b64cb5ce0dbd82aa03c37069a`):

  > Yeongyu Kim (https://github.com/code-yeongyu), author of omo, pi-rules, and this
  > package, licenses the source distributed in this repository under the MIT License.
  > If any source was ported from omo or pi-rules, that ported source is re-licensed
  > here under MIT for distribution as a Codex plugin. See LICENSE for terms.

  The copyright holder of the SUL-1.0 corpus and the licensor of this MIT grant are the same
  person, so the grant is the rightsholder's own re-license of the source it covers.

Every re-sourced skill carries its own `skills/<name>/ATTRIBUTION.md` recording the source path, the
pin, the full MIT permission text, the notice above and the list of local adaptations that are NOT
upstream. The three skills this repository wrote itself — `cordis-dev`, `dsh-qa` and `svn-master` —
are outside this section (see the `cordis-dev` entry below).

### `skills/review-work` — the review PANEL is this repository's own work (MIT)

The `review-work` skill is a MIXED file: its orchestration scaffolding is the re-sourced MIT content
described above, while its **review panel** — the four declared lanes (the orchestrator's own hands-on QA
lane plus three read-only reviewer lanes named after the specialist roster: Architect, Reviewer,
Explorer), the ONE merge table carrying the verdict tokens `PASS` / `FAIL` / `INCONCLUSIVE`, and the
degrade matrix — is **this repository's own work, MIT, `Copyright (c) 2026 HaroldZ32`**. It was authored
from this repository's own contract (`.mpd/plans/restore-three-capabilities.md`, stream S1) and from the
bundle's real surfaces (the specialist roster in `packages/mpd-roles-plugin/src/roles.data.ts`, the
roster provider's description-head routing rule, and the verification law). It is **not** derived from any
earlier upstream revision of the skill; the retired multi-agent lane sections the tree still carried were
deleted in the same change. The per-file split is recorded in `skills/review-work/ATTRIBUTION.md`, and the
conformance case `skills/dsh-qa/scripts/review-panel.ts` asserts the panel declaration as data.

**Third-party material carried BY those skills is unchanged and remains in force**, each with its own
notice in the skill's `ATTRIBUTION.md`:

- `skills/frontend` — brand design-system references from **Open Design** (Apache-2.0, full text at
  `skills/frontend/LICENSE-Apache-2.0.txt`), plus the taste-skill, ui-ux-db and designpowers
  references documented in `skills/frontend/ATTRIBUTION.md`.
- `skills/ast-grep` — the skill's own upstream carriers `SOURCE` and `LICENSE` (**MIT**,
  `Copyright (c) 2026 Yeongyu Kim`, `code-yeongyu/ast-grep-skill` @ `3148c69`).
- `skills/ultimate-browsing` — **CloakBrowser** (MIT wrapper; its binary ships under a separate
  binary licence) and **agent-browser** (Apache-2.0), both runtime dependencies whose source is not
  vendored.
- `skills/ulw-research` — an adapted verification idea from **insane-research** by fivetaku (MIT,
  `Copyright (c) 2026 fivetaku`).

## insane-search engine (MIT) — `skills/ultimate-browsing/engine/**`

`skills/ultimate-browsing/engine/**` (28 files) originates from
<https://github.com/fivetaku/insane-search> and is **MIT licensed**:

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

**Bound, stated rather than smoothed over:** this repository vendored its snapshot on 2026-06-21
(commit `a4e4ed797`, pre-0.7.0), *before* upstream shipped a `LICENSE` file, so the vendored tree
itself carries no licence text. Upstream reset its public history on **2026-08-06**, which means the
vendored commit is no longer reachable there; the text above was read from upstream's public `HEAD`
on 2026-10-08 (1065 bytes,
sha256 `e343d30bc6631a1c8377b7aac26e7b1c5b38366913a98ef71fe6861fe812dcd4`). Nothing was re-vendored and
no engine file was changed by this notice fix; full detail in
`skills/ultimate-browsing/ATTRIBUTION.md` §1.

## oh-my-openagent MCP servers (SUL-1.0, with one MIT component) — snapshots REMOVED

**This section is now a HISTORICAL record, kept for provenance: the snapshotted sources are gone.**
Between them the snapshots covered the three MCP servers this bundle used to ship
(`mpd-mcp-astgrep`, `mpd-mcp-gitbash`, `mpd-mcp-lsp`) and their four shared packages
(`mcp-stdio-core`, `utils`, `omo-config-core`, `lsp-core`), copied VERBATIM from the oh-my-openagent
repository (https://github.com/code-yeongyu/oh-my-openagent) at commit
`8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29` (v5.0.0-beta.20).

Licensing was MEASURED, never assumed: oh-my-openagent's own `LICENSE.md` placed its content under
the Sustainable Use License 1.0 — the UPSTREAM's terms, never this repository's current licence — and
six of the seven
snapshotted packages declared no `license` field at all; only `lsp-daemon`
(`@code-yeongyu/lsp-daemon`) self-declared MIT. The snapshot was therefore **SUL-1.0 with that one
MIT component — it was not MIT**, which is exactly why wave B2 replaced it rather than relicensed it.

**REMOVED in de-omo wave B2 (2026-10-08), and nothing was carried over from it:** the snapshot
(`vendor/mcp-src/**`, 459 files), the offline builder `scripts/build-mcp.ts`, the two built servers it
produced (`packages/mpd-mcp-{lsp,gitbash}/dist/cli.js` with their `BUILD.lock` files) and the LSP
build overlay (`packages/mpd-mcp-lsp/overlay/**`) are deleted outright — no SUL-derived source is
shipped or read any more, and the `VENDOR_LOCK.json` asset that fingerprinted the snapshot is gone with
it. What replaced each capability, under which licence, is recorded in
`packages/mpd-mcp-lsp/README.md` and `packages/mpd-mcp-gitbash/README.md`: our own ast-grep server
(wave B1), and thin launchers over the DECLARED npm dependencies `cclsp` (MIT), `@cyanheads/git-mcp-server`
(Apache-2.0) and `mcp-server-commands` (MIT licence file, no `license` field).

S2 adds NO new third-party component and NO vendored bytes: the language→server catalog, the config assembler and the HDL reference pages are our own MIT code. The only server this repository is wired to remains `typescript-language-server` (Apache-2.0), which arrives as a dependency of the already-declared `cclsp` (MIT); nothing is redistributed, because the bundle only SPAWNS a user-installed server. The catalog records the licence of every server it names, of which EIGHT are not permissive — Eclipse JDT LS EPL-2.0 · terraform-ls MPL-2.0 · Intelephense's server proprietary · C# Dev Kit language server proprietary · lemminx EPL-2.0 · nixd LGPL-3.0 · vhdl_ls MPL-2.0 · texlab GPL-3.0 — plus the Roslyn nuance (compiler and the standalone NuGet package MIT; the shipped C# Dev Kit server proprietary) and the `protols` dispute.

## Vendored plugin cores — REPLACED / WRITTEN, no SUL source (wave de-omo C)

The three `src/vendor/**` cores that the first audit missed were dealt with in one wave. **No SUL-1.0
bytes remain in any `src/vendor/**` tree**, and each surviving core is now fingerprinted by
`VENDOR_LOCK.json`.

- **`packages/mpd-hashline-plugin/src/vendor/**` — REPLACED, and MIT-derived.** The former core
  (`packages/hashline-core` at oh-my-openagent `8c57e46`, SUL-1.0) is gone. The tree is now our own
  TypeScript, ported from the **DESIGN** of `crates/pi-edit` in:

  - Repository: <https://github.com/can1357/oh-my-pi>
  - Pinned revision read: `602b6c812fa9ef774f359f1e399a09d30ee2eaca`
  - Source path: `crates/pi-edit/` (notably `src/text.rs`, `src/modes/hashline/{format,mismatch}.rs`,
    `src/diff_string.rs`)
  - Licence: **MIT** — the workspace manifest declares `[workspace.package] license = "MIT"`, and the
    crate inherits it via `license.workspace = true`
  - Copyright lines, quoted from the upstream `LICENSE`:

    > Copyright (c) 2025 Mario Zechner
    > Copyright (c) 2025-2026 Can Bölük
    > Copyright (c) 2026 Stencil Labs, Inc.

  The full MIT permission text is reproduced verbatim at the top of EVERY file under that
  `src/vendor/**` tree, together with the copyright lines above. `bun run verify-vendor` fingerprints
  the tree, and the port is a DELIBERATE REDUCTION: the fuzzy "autocorrect" heuristics of the replaced
  core are not reproduced (declared in `vendor/edits.ts`'s header).

  The hashline core in packages/mpd-hashline-plugin/src/vendor/** is our own TypeScript, designed from the `crates/pi-edit` crate of can1357/oh-my-pi at commit 602b6c812fa9ef774f359f1e399a09d30ee2eaca, whose workspace manifest declares MIT and whose LICENSE carries the text reproduced in every file header. One part of that tree is not a design port and has no upstream counterpart: the conservative repair pass (`repairReplacementBlock` in src/vendor/edits.ts, with its helpers findWrapSites, scanDelimiters, scanBlockStates, opensSomething, closesSomething, isFlushLeftBlock and pairIndent) is an ORIGINAL mpd implementation written for this repository, restoring by design a capability the replaced core had. No upstream source was read or copied for it.

  MIT License

  Copyright (c) 2025 Mario Zechner
  Copyright (c) 2025-2026 Can Bölük
  Copyright (c) 2026 Stencil Labs, Inc.

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

- **`packages/mpd-boulder-plugin/src/vendor/**` — WRITTEN HERE, mpd-owned.** The former core
  (`packages/boulder-state` at oh-my-openagent `8c57e46`, SUL-1.0) is gone; the tree is a durable,
  workspace-scoped JSON ledger plus per-task timers written in this repository against the contract the
  `mpd_boulder_*` tools already documented. It carries **no third-party source and no third-party
  licence obligation**, and the `.mpd` state-root convention and the legacy `codex:`/`opencode:`/`senpi:`
  session-id tolerance are preserved so older records still resume.

- **`packages/mpd-comment-checker-plugin/src/vendor/**` — DELETED as dead code.** Its two files
  (`apply-patch-edits.ts`, `types.ts`) had no importer anywhere in the repository, in source or in the
  built `dist/`; the plugin's actual dependency is the opt-in `@code-yeongyu/comment-checker` binary
  (MIT), which is not redistributed here.

## Agent Teams (MIT) — official plugin set, mounted by this bundle

From 2026-09-27 the bundle's team capability is the DeepSeek Harness OFFICIAL plugin set, mounted by
this bundle's own rows (`mpd-agent-team`, `mpd-tool-agent-team`, `mpd-ui-agent-team`) and reached only
through `mpd-dsh-adapter`:

- `@deepseek-ai/dsh-experimental-agent-team` (MIT) — the `ctx.agentTeams` `TeamService`: implicit-root
  roster, durable peer mailbox, shared task DAG.
- `@deepseek-ai/dsh-experimental-tool-agent-team` (MIT) — the scoped model-facing tools
  `spawn_teammate`, `send_message`, `list_agents`, `wait_agent`, `interrupt_agent`,
  `team_task_create` / `team_task_list` / `team_task_get` / `team_task_update`.
- `@deepseek-ai/dsh-experimental-client-ui-agent-team` (MIT) — the Web roster, shared task board and
  teammate navigation client.

All three are declared in this package's `dependencies` at the harness version they were validated
against and are distributed under the MIT License; none of their source is vendored into this
repository. See `docs/plan-0.1.7-adaptation.md` for the adoption record.

## dsh-agent-teams (MIT) — adopted plugin, DELETED; two relocated pieces remain

The `agent-teams` plugin was adopted from the dsh-agent-teams project (0.1.14 body, with the audited
upstream 0.1.16-rc.3 deltas backported — Harness subagent boundary, agent-scoped capabilities, tool
names, authenticated web routes, member turn-failure handling and the durability fixes;
https://github.com/NanmiCoder/dsh-agent-teams), distributed under the MIT License, adopted package
version `0.1.16-rc.3-mpd`.

**Its source is no longer in this repository.** The plugin was RETIRED from the composition on
2026-09-27 (no loader row mounted it; the harness shipped its own official Agent Teams plugin, see
the section above), and the `de-vendor-and-verify-law` wave then DELETED the whole body —
`packages/mpd-agent-teams-plugin/**`, 768 files — together with the three scripts that vendored,
patched and reclaimed it and the delta registry it was documented by. Nothing in this repository
reads, patches, fingerprints or copies it any more.

Two pieces of that work DO still ship, relocated into mpd-owned homes in the same commit as the
deletion, and both keep the MIT acknowledgement above:

- **The adopted browser client bundle** — `packages/mpd-bundle-plugin/adopted/agent-teams-client.js`
  (the 0.1.14 build) and its source map. It is embedded verbatim by
  `scripts/build-mpd-client.ts` into the shipped `packages/mpd-bundle-plugin/client.js`, which is
  what backs the AgentTeams sidebar tab. `packages/mpd-bundle-plugin/adopted/` is the source half of
  that artifact.
- **The DSH runtime modules this repository owns as its own code** —
  `packages/mpd-schemastery/`, the schemastery validator plus `cosmokit` used by four SHIPPED
  plugins, and the DSH framework modules (`cordis`, `dsh-tools`, `dsh-llm`, `dsh-session`,
  `dsh-scope`, `dsh-timeout`) that this repository's test suite drives directly. Both upstream
  notices are reproduced in full in `packages/mpd-schemastery/LICENSE`: Shigma
  (Copyright (c) 2021-present) for schemastery/cosmokit/cordis, DeepSeek (Copyright (c) 2026) for
  the `@deepseek-ai/dsh-*` modules.


## @code-yeongyu/comment-checker (MIT) — opt-in check binary

The optional comment/docstring detection binary used by mpd-comment-checker-plugin
is the npm package `@code-yeongyu/comment-checker` 0.8.0
(https://github.com/code-yeongyu/go-claude-code-comment-checker), distributed under
the MIT License. It is not redistributed in this repository; it is installed on
demand into `.toolchain` (installer flag `--with-comment-checker`).

## codegraph (MIT) — the `mpd-codegraph` row and `mcp__codegraph__*`

The code-graph runtime behind the `mpd-codegraph` row and the `mcp__codegraph__*` tools is
**codegraph** by Yeongyu Kim, distributed under the **MIT License** (`Copyright (c) 2026 Yeongyu Kim`).
The prebuilt server `packages/mpd-mcp-codegraph/dist/serve.js` is VENDORED into this repository and
sha256-pinned in `VENDOR_LOCK.json`, so the full licence text and the component notice travel with it
in `packages/mpd-mcp-codegraph/LICENSE` and `packages/mpd-mcp-codegraph/NOTICE`. Its platform bundles
may embed a Node.js runtime plus vendored JavaScript and WASM payloads whose texts are reproduced in
`packages/mpd-mcp-codegraph/NODE-RUNTIME-LICENSES.md` and inside the selected platform package under
`lib/node_modules/`.

## DeepSeek Harness 创造模式 skills (MIT) — adapted into `skills/cordis-dev`

The `cordis-dev` skill shipped in this repository's served skill corpus is an
adaptation, written for this bundle, of the four skills the DeepSeek Harness
ships with its `cordis` agent preset (创造模式 / creation mode):
`cordis-plugin-development` (+ its `references/` and `templates/`),
`editing-cordis-compositions`, `cordis-composition-reference` (+ its generated
`references/packages.md`) and `agent-experience`. Those files ship inside the
npm package `@deepseek-ai/dsh-agent-preset`
(https://github.com/deepseek-ai/deepseek-harness), distributed under the MIT
License, Copyright (c) 2026 DeepSeek — the same licence as the rest of the
`@deepseek-ai/*` harness packages this bundle already references.

What that means concretely: the knowledge transferred is the Loader patch
dialect, the plugin forms (Host / Web UI client / configuration-only MCP
bundle), the practices and the verification discipline; the wording here is this
repository's, and every section that is specific to this bundle (the adapter
seam rule, the mounting contract, the gate table, the goal plane) is ours. The
upstream files are NOT redistributed: this bundle references the installed
harness packages instead, and a reader who wants the upstream text verbatim can
read it at
`<dsh>/node_modules/@deepseek-ai/dsh-agent-preset/skills/` (the path the
`cordis-dev` skill names for its templates).

## Roster persona texts — re-sourced under permissive licences (wave D)

The eleven roster persona texts (`packages/mpd-roles-plugin/personas/*.md`, one per specialist, named in
AGENTS.md §13) are no longer adapted from `oh-my-openagent` (SUL-1.0). They are this repository's own
prose, **adapted from** the permissively licensed public agent prompts listed below: the seed supplied
the shape of the role's discipline, the wording is new, and no seed text is redistributed. Two of the
eleven — **Vision Analyst** and **Junior Engineer** — have NO upstream model and were written here.

| Role | Persona file | Adapted from (repository, path) | Licence | Copyright line |
|---|---|---|---|---|
| Architect | `oracle.md` | `anthropics/claude-plugins-official`, `plugins/code-modernization/agents/architecture-critic.md` (rev `f713a7c5`) | Apache-2.0 | no copyright line and no `NOTICE` file at that revision; the `LICENSE` was read verbatim |
| Researcher | `librarian.md` | `VoltAgent/awesome-claude-code-subagents`, `categories/10-research-analysis/research-analyst.md` (rev `721e9734`) | MIT | `Copyright (c) 2025 VoltAgent` |
| Planner | `prometheus.md` | `gsd-build/gsd-2`, `src/resources/agents/planner.md` (rev `33c00aaf`) | MIT | `Copyright (c) 2026 Lex Christopherson` |
| Deep Worker | `hephaestus.md` | `gsd-build/gsd-2`, `src/resources/agents/worker.md` (rev `33c00aaf`) | MIT | `Copyright (c) 2026 Lex Christopherson` |
| Senior Engineer | `sisyphus.md` | `VoltAgent/awesome-claude-code-subagents`, `categories/01-core-development/fullstack-developer.md` (rev `721e9734`) | MIT | `Copyright (c) 2025 VoltAgent` |
| Lead | `atlas.md` | `VoltAgent/awesome-claude-code-subagents`, `categories/09-meta-orchestration/multi-agent-coordinator.md` (rev `721e9734`) | MIT | `Copyright (c) 2025 VoltAgent` |
| Explorer | `explore.md` | `jayminwest/overstory`, `agents/scout.md` (rev `ff38f3f7`) | MIT | `Copyright (c) 2026 Jaymin West` |
| Reviewer | `metis.md` | `obra/superpowers`, `skills/requesting-code-review/code-reviewer.md` (rev `8ca22dba`) | MIT | `Copyright (c) 2025 Jesse Vincent` |
| Plan Reviewer | `momus.md` | `VeryGoodOpenSource/vgv-wingspan`, `skills/shared/references/plan-review.md` (rev `19e0695a`) | MIT | `Copyright (c) 2026 Very Good Ventures` |
| Vision Analyst | `multimodal-looker.md` | **none** — written here | — | — |
| Junior Engineer | `sisyphus-junior.md` | **none** — written here | — | — |

Per-file detail, the verbatim licence files, the fetched seed files and their sha256 values, and the
phrase-overlap measurement that shows the texts are not lifts, are under
`evidence/de-omo/personas/20261008T163931Z/`; the mapping table also sits beside the assets in
`packages/mpd-roles-plugin/personas/ATTRIBUTION.md`. The 11 names, the stable ids, the read-only deny
list, the `teamModels` slots and the persona loading contract are unchanged by this wave.

## Two self-declared upstream ports — settled (wave F)

Wave E's audit named two packages whose headers DECLARED an upstream port and left the legal question
open (`.mpd/plans/de-omo-decoupling.md` §15). A read-only evidence pass searched the upstream
repository directly and settled both; **de-omo wave F then acted on the verdicts.**

### `packages/mpd-memory-plugin` — **DERIVED: the reducer slice was REWRITTEN**

The evidence pass found all four decisive identifiers in `code-yeongyu/oh-my-openagent` on branch
`dev`, so the package's ~40-line reflection-reducer slice was a translation of upstream source rather
than an independent implementation:

- `completeTransition` — `packages/memory-core/src/reflection/machine.ts` (both `export function
  completeTransition(` and `export interface CompleteTransition`).
  <https://github.com/code-yeongyu/oh-my-openagent/blob/dev/packages/memory-core/src/reflection/machine.ts>
- `reflected_completed_steps` and `steps_since_last_successful_reflection` — inside
  `ReflectionTranscriptState` in `packages/memory-core/src/journal/cursor.ts`.
  <https://github.com/code-yeongyu/oh-my-openagent/blob/dev/packages/memory-core/src/journal/cursor.ts>
- `reservation` as a state field — `interface ReservationState`, then `MachineState.reservation`, in
  the same `machine.ts`.

**What wave F changed:** those three state-field names and the tool-description mention of
`completeTransition` are gone, replaced by this package's own vocabulary — `reflectionsCompleted`,
`stepsSinceReflection`, `pendingReflection` — with no behaviour change beyond the rename.

**The persisted-state bound (checked, not assumed):** the old names are REAL user data under
`.mpd/memory/**/runtime/reflection.json` (a live record carrying `reflected_completed_steps: 5` and a
`reservation` object exists in this workspace). Nothing else in the repository reads those fields —
`skills/dsh-qa`'s memory smoke case reads the write counter `steps` alone. The reader therefore KEEPS
a read-only compatibility path (`adoptLegacyState`): a legacy record is accepted and mapped onto the
current names, and the next reflection update persists the current names only, so no separate
migration step is needed. A test arm pins both halves.

**An over-claim corrected at the same time:** upstream `memory-core` is **Git-only** (`GitMemoryRepo`;
no `SvnMemoryRepo` exists upstream). The svn backend and the "VCS abstraction with git AND svn
backends" framing are OURS, and neither the source header nor either README presents them as
upstream-attributable any more. The header's feature list was also trimmed to what this package
actually ships (the upstream-described `dream` trigger is not implemented here).

**History kept:** the earlier draft DID mirror upstream's state-machine vocabulary (base `8c57e46`,
SUL-1.0). That is recorded in the package header and README pair as history, and wave F is what
replaced it; the end state is mpd-owned code re-expressed from DOCUMENTED BEHAVIOUR, with no
translated upstream source.

### `packages/mpd-ulw-plugin` — **INDEPENDENT: the provenance note was REWORDED**

The evidence pass found no verbatim upstream prompt, policy or error text, and found clauses that
cannot exist upstream (`EXACTLY five agent_teams_* tools exist on this harness`, `.mpd/ulw`, the
`mpdConfig` keys). The package is therefore NOT a port, and **no policy was rewritten.**

**What wave F changed:** the note in `src/index.ts` and in both READMEs now states precisely that the
discipline's SHAPE is upstream's while the WORDING shipped here is ours, re-expressed from the
documented upstream ultrawork discipline (base `8c57e46`). The header's "carries the full upstream
discipline" over-claim went with it.

**The one un-diffed residual, recorded honestly:** FOUR clauses of the policy could not be compared
against any upstream text — the ladder `PIN → RED → GREEN → SURFACE → CLEAN`, the "stop after 2
fruitless discovery waves" rule, the subagent barrier, and evidence-never-suppressed. They are ours
in wording; that they are upstream's in intent is unproven.

The evidence for this wave — the verdicts, the changed files, the persisted-state question and its
answer, the reworded text and the residual — is under
`evidence/de-omo/ports-f/20261008T170142Z/`.
