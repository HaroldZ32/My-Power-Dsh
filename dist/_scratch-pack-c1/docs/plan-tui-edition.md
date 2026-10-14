> **Why this file is committed here.** The working copies of this contract and this report live under
> `.mpd/`, which is **gitignored** — nothing under `.mpd/` is ever committed. This pair is the
> repository's durable, auditable record, written on the captain's direct instruction as part of the t14
> integration pass and refreshed twice afterwards (AC-15 → `passed` with the R6 evidence; then the t23
> disposition, the t29-predicate residual and the landed `VENDOR_LOCK` re-pin + green gate sweep). Both
> are process records and are exempt from the bilingual-document rule (AGENTS.md §3). The evidence they
> cite is committed under `evidence/tui/`.

# DSH-TUI Edition — Frozen Requirements & Acceptance Contract

- **Artifact owner / task**: `t1` (requirements, Lead) — deliverable `.mpd/plans/dsh-tui-edition.md`
- **Status**: FROZEN as the acceptance contract of this wave. Every downstream task (`t2`…`t15`),
  verification lane and review judges its result against the AC list in §4. This is a **contract,
  not a re-design**: the task DAG is fixed by the captain (`t15` reviews it adversarially, it does
  not rewrite it here).
- **Repair round 2 (`t17`)**: this revision applies the eight amendments required by the t2 Plan
  Review (`needs_revision`): the named `scripts/install-profile.ts` mirror edit and its owner; the
  `PLUGIN_PKGS` omission + the class-wide regression assertion R11; the owned extraction
  prerequisite for the spec-conformance lane; the TUI-default-preset mechanism + dual-profile
  negative control; the AC-12 static/live split; the pinned spec-data root + `loadSpecData()`
  assertion; `eight` → `seven`; and AC-9's explicit acceptable/excluded pane states. AC numbering is
  unchanged.
- **Repair round 3 (`t19`)**: the t18 re-review found that t17's AC-11 prescribed an
  `agent-presets` **INSERT** while the DELIVERED mechanism is a **pair of id-targets**
  (`agent-presets` for the web plane + `dsh-tui-agent-presets` for the TUI plane) — the INSERT, read
  literally, would have produced two entries with id `agent-presets` in a web composition and killed
  the boot. This revision rewrites AC-11/AC-15/§5/§7.2c to the delivered pair with the loader
  semantics that make it safe, replaces R4 in AC-15 with the gates that can actually witness a
  roster composition, fixes the patch-comment evidence citation so it names an artifact that exists,
  corrects the regression-lane range to R1–R11, and states the 25-package count in §0 and §5.
- **Subject**: give `@mpd-dsh/mpd` (this repo, v0.9.1; `packages/` holds 24 pre-existing package dirs
  + `packages/mpd-tui-plugin` created by `t4` = **25**, measured 2026-09-15, excluding the gitignored
  `packages/node_modules` entry) a DSH-TUI edition — TUI-native surfaces plus ecosystem admission
  artifacts — without breaking the existing web profile.
- **Normative revision**: the HOST's own built-in admission profile shipped inside
  `@deepseek-harness-tui/dsh-tui@0.10.1` (vendored copy at
  `/root/dshProj/tui/dsh-TUI/dsh-ecosystem-spec/{registry,protocols,schemas}`), **not** the spec
  repo's current `main` (`84a305d`, which has the TUI admission content removed from its tree).
- **Sources of truth (all already on disk, all read-only for us)**:

| Source | Path | Status |
|---|---|---|
| Captain recon dossier (measured facts, path:line, sandbox recipe) | `.mpd/recon/CAPTAIN-RECON.md` | exists |
| Recovered admission spec (13 seams, TUI Admission v0.15, checklists) | `.mpd/recon/spec-history/plugin-admission-and-development.md` | exists (1053 lines) |
| Spec satellites | `.mpd/recon/spec-history/{README.md,adapters_dsh-tui-v0.15.md,conformance_README.md,registry_README.md,PLUGIN-ADMISSION-CHECKLIST.md,SPEC-WRITING-RULES.md}` | exist |
| Plugin shape template | `/root/dshProj/tui/plugin-template/` (`src/{index,events,registration}.ts`, `themes/example.json`, `skills/example-skill/`, `cordis.patch.yml`) | exists; has **no** `dsh-plugin.json` |
| Host checkout (READ ONLY) | `/root/dshProj/tui/dsh-TUI` @ `b246411` (v0.10.1) | exists; no `node_modules`, no `lib/` |
| Distribution meta-protocol | `/root/dshProj/tui/dsh-ecosystem-spec/vendor/meta-protocols/dsh-distribution` | exists |

## 1. User decisions (verbatim)

**The six decisions**, quoted exactly from the task charter:

- **D1** — "full port (all ~25 packages usable under a dsh-tui profile, plus TUI-native panels)"
- **D2** — "ALL seams wanted"
- **D3** — "ALL four verification lanes wanted"
- **D4** — "package name @mpd-dsh/mpd-tui"
- **D5** — "license stays SUL-1.0"
- **D6** — "ONE bundle-level dsh-plugin.json (not 25 per-package manifests)"

**Four further verbatim clauses of the same charter**, treated as equally binding:

- **D7** — "the normative revision is the HOST's own built-in admission profile (dsh-tui@0.10.1
  vendored copy), not the spec's current main"
- **D8** — "web-only faces get TUI-native equivalents plus full live verification"
- **D9** — "the decision-event seam is to be built as 'ready but not activated' with the manifest
  complete and the gap disclosed"
- **D10** — "TUI sessions must default to the mpd preset"

How the contract realises them:

- **D1** is discharged by AC-1, AC-12 (every package classified with the observation that proves
  the classification) and AC-4/AC-5 (the TUI-native panels).
- **D2**: all 13 seams of the recovered spec are accounted for in §2.2 — seven of them are built by
  `t4` (seams 6 and 8–13), five are already carried by the existing bundle (seams 1, 3, 4, 5, 7) and
  seam 2 is host-unavailable ⇒ **NOT CLAIMED** (§6). (`t4` therefore ships **eight** surface
  modules: the seven activation-gated seams plus the ready-but-not-activated decision-event seam.)
- **D3** is realised as the six executable lanes of §3 (the ecosystem's four — admission,
  conformance, distribution, live-TTY — plus the panels lane and the repo regression lane, so no
  requested verification is dropped).
- **D4** is discharged by the `t4` package identity (`packages/mpd-tui-plugin/`, its `package.json`
  name) and by AC-10's stable unique plugin id; the path is listed in §5 and the module specifier is
  fixed in §7.1.
- **D5** — the license is **unchanged**: `LICENSE.md` is not touched by any task in this wave, and no
  artifact may claim a license change.
- **D6** is discharged by AC-10: exactly one `dsh-plugin.json`, at the repo root, covering the whole
  bundle (never 25 per-package manifests).
- **D7** is the normative pin at the head of this document, discharged by AC-8/AC-9 (the host's own
  parser and the host's own `/plugins check`).
- **D8** (web-only faces) is discharged by AC-12 (each web-only package is classified as `web-only`
  with the observation that proves it), by the TUI-native equivalents of AC-4/AC-5, and by
  NOT CLAIMED item W-3.
- **D9** (decision-event seam) is discharged by AC-6 (ready-but-not-activated) and NOT CLAIMED
  item W-1.
- **D10** is discharged by AC-11 (measured from a captured screen/session record, never from the
  patch text).

## 2. Scope

### 2.1 In scope for this wave

- One new plugin package `packages/mpd-tui-plugin/` (`t4`).
- One bundle-level `dsh-plugin.json` at the repo root + the `mpd-tui` row in the bundle patch +
  the TUI composition / preset default (`t5`).
- One `dsh-distribution.json` at the repo root + bilingual TUI docs (`t6`).
- Five QA lanes under `skills/dsh-qa/scripts/` (`t7`, the wave's only `skills/**` writer) and their
  registration in `skills/dsh-qa/SKILL.md`.
- Evidence under `evidence/tui/**` (`t4`–`t14`), reviews (`t12`, `t13`), research (`t11`), seam audit
  (`t10`), integration ledger/report (`t14`).
- `VENDOR_LOCK.json`: **not** edited by any task. The wave's single skills-corpus re-pin is the
  captain's commit (`t9` computes the new `treeSha`, `t14` reports it).

### 2.2 Seam coverage (D2)

| # | Seam (spec) | Carrier in this wave | Contract reference |
|---|---|---|---|
| 1 | session events (`session/event`, `agent/status`, log-only `session.append`) | existing bundle + `t4` renderer events (two iron rules: log-only, write `KNOWN_SESSION_EVENT_TYPES`) | AC-4, AC-6 |
| 2 | `tuiPrompt` slot | **host does not provide it** | W-5 (§6) |
| 3 | skill packaging | existing `mpd-bootstrap` (skills served from `<bundle>/skills`) | AC-1 |
| 4 | theme (static asset) | `t4` ships a theme asset | AC-4 |
| 5 | system-prompt section | existing adapter rows | AC-1 |
| 6 | `tuiSettingsSections` | `t4` (new) | AC-4, AC-5 |
| 7 | profile composition (`cordis.patch.yml`) | `t5` | AC-2, AC-3, AC-11 |
| 8 | `tuiScenes` (full-screen board) | `t4` (new) | AC-4, AC-5 |
| 9 | decision events (`tui.dsh/v1alpha1#DecisionEvents`) | `t4` ready-but-not-activated only | AC-6, W-4 |
| 10 | `tuiDialogs` | `t4` (new) | AC-4, AC-5 |
| 11 | `tuiStatus` | `t4` (new) | AC-4, AC-5 |
| 12 | `tuiShortcuts` | `t4` (new) | AC-4, AC-5 |
| 13 | `tuiRenderers` | `t4` (new) | AC-4, AC-5 |

### 2.3 Host APIs this contract consumes (no invented API)

Service ids and their registration sites were measured in the host checkout at `b246411`:

| Service id | Host registration | Guard |
|---|---|---|
| `tuiStatus` | `src/dsh-adapter/status.ts:263` | `requirePluginCaller` |
| `tuiDialogs` | `src/dsh-adapter/dialogs.ts:286` | `requirePluginCaller` (`:302`) |
| `tuiRenderers` | `src/dsh-adapter/renderers.ts:81` | `requirePluginCaller` |
| `tuiSettingsSections` | `src/dsh-adapter/settings-sections.ts:48` | `requirePluginCaller` |
| `tuiScenes` | `src/dsh-adapter/scenes.ts:80` | `requirePluginCaller` |
| `tuiCommandTrees` | `src/dsh-adapter/command-trees.ts:40` | `requirePluginCaller` |
| `tuiShortcuts` | `src/dsh-adapter/shortcuts.ts:96` | `requirePluginCaller` |
| `tui.dsh/v1alpha1#DecisionEvents` | `src/dsh-adapter/plugin-host.ts:415-430` (`admit` throws), `:435-496` (`admitInternal`, token-gated), `:890-914` (`getHostAdmission*`), zero production callers | identity + static permission + live grant ⇒ **unreachable for a profile-installed plugin** |

Method-level signatures are **not** asserted by this contract. The documented idioms it relies on
are the ones in the recovered spec (`status.set(key,text)`; `shortcuts.register(combo,{description,
handler})`; `renderers.register(type, fn)`; `dialogs.select/confirm/input`; `tuiSettingsSections.
register({ns,title,fields})`; `tuiScenes.register({…})` + `.open(id)`; `ctx.get(id, false)` soft
probe + `ctx.effect` cleanup). **`t10` audits every service id and every method actually called by
`packages/mpd-tui-plugin` against the host source at `b246411` and reports any divergence as a
finding**; a divergence is a defect in `t4`, not a licence to widen this contract.

## 3. Lane vocabulary and exact commands (D3)

Six lane names are canonical; every AC in §4 names one of them. `t7` ships the five scripts; each
ships `--self-test` (the gate form, no live host) alongside the real run (the evidence form).

| Lane | Real run (evidence) | Gate form |
|---|---|---|
| **live-mount** | `bun skills/dsh-qa/scripts/tui-mount.ts` | `bun skills/dsh-qa/scripts/tui-mount.ts --self-test` |
| **panels** | `bun skills/dsh-qa/scripts/tui-panels.ts` | `bun skills/dsh-qa/scripts/tui-panels.ts --self-test` |
| **admission** | `bun skills/dsh-qa/scripts/tui-admission.ts` | `bun skills/dsh-qa/scripts/tui-admission.ts --self-test` |
| **distribution** | `bun skills/dsh-qa/scripts/tui-distribution.ts` | `bun skills/dsh-qa/scripts/tui-distribution.ts --self-test` |
| **spec-conformance** | `bun skills/dsh-qa/scripts/tui-spec-conformance.ts` | `bun skills/dsh-qa/scripts/tui-spec-conformance.ts --self-test` |
| **regression** | R1–R11 below | `bun run test:qa` includes every `--self-test` |

Lane 6 (regression) command set, referred to by id in §4:

- **R1** `bun run typecheck`
- **R2** `bun test packages/mpd-tui-plugin`
- **R3** `bun run test:qa`
- **R4** `node scripts/verify-rows-parity.ts`
- **R5** `node skills/dsh-qa/scripts/preset-conformance.ts`
- **R6** `bun skills/dsh-qa/scripts/bundle-lifecycle.ts` (web profile still mounts)
- **R7** doc switch-link + linkage check:
  `node -e "const fs=require('fs');for(const f of ['docs/tui.md','docs/tui.zh-CN.md']){if(!/\[(中文|English)\]\(\.\/tui\./.test(fs.readFileSync(f,'utf8')))throw new Error('switch link missing in '+f)}for(const f of ['docs/index.md','docs/index.zh-CN.md','README.md','README.zh-CN.md']){if(!fs.readFileSync(f,'utf8').includes('tui'))throw new Error('TUI page not linked from '+f)}"`
- **R8** NOT-CLAIMED disclosure check:
  `node -e "const t=require('fs').readFileSync('docs/tui.md','utf8');for(const k of ['NOT-CLAIMED','decision-event','admission','0.1.5-rc.2','web-only'])if(!t.includes(k))throw new Error('docs/tui.md missing '+k)"`
- **R9** delivery-ledger check (t14):
  `node -e "const t=require('fs').readFileSync('.mpd/plans/dsh-tui-edition-report.md','utf8');for(const k of ['AC-1','NOT-CLAIMED','dsh plugin --profile dsh-tui add'])if(!t.includes(k))throw new Error('report missing '+k)"`
- **R10** host gates (best effort, `t9`): from a workspace-local copy, e.g.
  `cd .mpd/recon/host-copy && npm run verify:plugin-spec` (each gate recorded verbatim with its exit
  code and its *actual* meaning — a green host gate validates the HOST's plugin subsystem, never our
  plugin). If the copy cannot be built, the exact blocker is recorded and the gate set is reported
  BLOCKED, not passed.
- **R11** packed-tree / `PLUGIN_PKGS` consistency (gates the whole silent-omission defect class, not
  just this package): every `@mpd-dsh/mpd/packages/<pkg>/dist/index.js` row of the bundle patch must
  be listed in `PLUGIN_PKGS` in `scripts/pack-mpd.ts`, else `scripts/pack-mpd.ts` would pack a
  tree that omits the package while still exiting 0:
  `node -e 'const fs=require("fs");const patch=fs.readFileSync("packages/mpd-bundle/cordis.patch.yml","utf8");const pack=fs.readFileSync("scripts/pack-mpd.ts","utf8");const pkgs=[...new Set([...patch.matchAll(/packages\/([a-z0-9-]+)\/dist\/index\.js/g)].map(m=>m[1]))];const missing=pkgs.filter(p=>!new RegExp("\""+p+"\"").test(pack));if(missing.length)throw new Error("PLUGIN_PKGS missing: "+missing.join(","));console.log("R11 ok: "+pkgs.length+" patch rows present in pack-mpd PLUGIN_PKGS")'`
  (Negative control measured 2026-09-15: before the `mpd-tui-plugin` entry was added this command
  exited 1 with `PLUGIN_PKGS missing: mpd-tui-plugin` on a patch carrying 16 plugin rows.)

## 4. Acceptance criteria (AC-1 … AC-20)

Each item is falsifiable by the named lane. "Evidence" is where the raw artifact must land.

| ID | Claim (falsifiable) | Lane | Exact command(s) | Evidence / judging task |
|---|---|---|---|---|
| **AC-1** | The bundle installs into a `dsh-tui` profile and mounts as the **third patch layer**: `dsh.profile.bundles = ["@deepseek-ai/dsh-base","@deepseek-harness-tui/dsh-tui","@mpd-dsh/mpd"]`, the status line shows our counters (`Skills 18 · Tools 94` class), our MCP rows launched, and the raw log carries **zero** apply-crash signatures (`unsupported JSON schema\|JsonSchemaError\|plugin tree failed to load\|failed to apply loader entry\|Error:`). | live-mount | `bun skills/dsh-qa/scripts/tui-mount.ts` | `evidence/tui/lanes/<ts>/` + re-run in `evidence/tui/live/<ts>/` (t8) |
| **AC-2** | **Single-install doctrine**: one command `dsh plugin --profile dsh-tui add /root/dshProj/my-power-dsh` in a clean sandbox yields the whole capability set (plugin + manifest + skills + MCP rows) — no second install path, no per-package `dsh plugin add`. | live-mount | `bun skills/dsh-qa/scripts/tui-mount.ts` (asserts the install step + the triple bundle layering) | `evidence/tui/lanes/<ts>/install.log` |
| **AC-3** | **No duplicate loader entry id** in any composition touched by this wave (bundle patch, presets, overlays): the boot log shows no `duplicate loader entry id`, and row parity holds. The `mpd-tui` patch row must be **mirrored in `scripts/install-profile.ts`** (owner `t5`, §5) — a named, owned edit, because the legacy installer is that flow's only row source; **R4 (`scripts/verify-rows-parity.ts`) is the gate that proves the mirror**: it compares the bundle patch's `- insert:` id set with the installer's `--dry-run` id set, so a patch row without its installer mirror fails R4 (measured green 2026-09-15 on 24 ids incl. `mpd-tui`; the mirror row is at `scripts/install-profile.ts:171-178`). | regression | R4, plus the boot-log scan in AC-1 | `evidence/tui/composition/<ts>/` (t5), `evidence/tui/live/<ts>/` (t8) |
| **AC-4** | Each of the seven activation-gated UI seams really renders in the real TUI: status-line text, scene opens and exits, `/settings` section visible, a renderer line in the transcript, a shortcut fires, a dialog appears, the command tree entry is present. | panels | `bun skills/dsh-qa/scripts/tui-panels.ts` | pane capture + raw ANSI under `evidence/tui/lanes/<ts>/` |
| **AC-5** | The plugin contract holds: `name` / `Config` (type) / `Config` (schemastery schema) / `apply(ctx, config)`, **no default export**, `.js` suffixes on relative imports, every config key defaulted, cleanup through `ctx.effect`, and **no thrown error when every TUI service is absent** (`ctx.get(id, false)` per seam, warn-once degrade). | regression | R2 (+ R1) | `evidence/tui/plugin/<ts>/` |
| **AC-6** | The decision-event seam (seam 9) is **ready but not activated**: the registration attempt is wrapped, a refusal (no verified identity / no grant) is the expected outcome, it is warned **once**, no admission is faked, and the refusal cannot break `apply`. | regression, panels | R2 and `bun skills/dsh-qa/scripts/tui-panels.ts` | `evidence/tui/plugin/<ts>/`, `evidence/tui/lanes/<ts>/` |
| **AC-7** | The panels lane **fails loudly** when a seam surface does not render — proven by a recorded **negative control** (an intentionally absent service or an asserted string that cannot appear), never by a vacuous pass. | panels | `bun skills/dsh-qa/scripts/tui-panels.ts` (negative control recorded) | `evidence/tui/lanes/<ts>/negative/` |
| **AC-8** | `dsh-plugin.json` is accepted **and projected** by the host's own admission algorithm at the pinned revision, with the input digests recorded. **Spec-data root is pinned**: the installed payload `<node_global>/@deepseek-harness-tui/dsh-tui/dsh-ecosystem-spec/` (its `registry/registry-0.15.json` = sha256 `c3090dd129aadb06f87b56ad…`, byte-identical to the host checkout), fallback the external checkout `/root/dshProj/tui/dsh-TUI/dsh-ecosystem-spec/` @ `d28c267`. The lane must **assert the loaded spec data is defined (`loadSpecData() !== undefined`) before emitting any verdict** — a missing/empty root must fail loudly (the host surfaces `plugins-check-spec-unavailable`) and must never be scored as a pass — and it records parse → project → profile/registry validation with the five-state negotiation. | admission | `bun skills/dsh-qa/scripts/tui-admission.ts` | `evidence/tui/lanes/<ts>/admission.json` |
| **AC-9** | The host's own `/plugins check <absolute path to dsh-plugin.json>` inside the **live TUI** reports an acceptance-compatible pane state — `compatible` \| `compatible_degraded` \| `waiting_authorization` (the same five-state vocabulary AC-8 uses; `rejected` / `unknown` is a FAILED item, not a pass) — with captured pane + raw log, and the pane must contain **none** of the named failure states: `Not parseable JSON` (`plugins-check-invalid-json`), `plugins-check-schema-failed`, `plugins-check-invalid`, `plugins-check-spec-unavailable`. | admission | `bun skills/dsh-qa/scripts/tui-admission.ts` (drives tmux) | `evidence/tui/lanes/<ts>/plugins-check.pane.txt` |
| **AC-10** | The manifest tells the truth: `manifestVersion` 0.15, stable unique plugin id, `facets.host` entry + `apiVersion: v1alpha1`, **no `provides`**, **no `requires.services`**, no client/worker facets, `permissions` limited to what the code uses, every subscription/contribution traceable to real code, the entry pointing at `packages/mpd-tui-plugin/dist/index.js`, and the decision-event permissions present **only** as an optional requirement with a written fallback. | admission (+ t13) | `bun skills/dsh-qa/scripts/tui-admission.ts` | `evidence/tui/lanes/<ts>/admission.json` |
| **AC-11** | A TUI session defaults to the **mpd** preset — measured from a decoded session record or a captured TUI pane, never inferred from the patch text. **Delivered mechanism (owner `t5`; `packages/mpd-bundle/cordis.patch.yml` is inside its inScope) — a PAIR of id-TARGETs, each living in exactly ONE composition; an INSERT is explicitly NOT used**: (1) `agent-presets` (name `@deepseek-ai/dsh-agent-presets`, config `{default: mpd, roots: [<bundle>/presets @ system]}`) for the **web/base plane**, where `dsh-web-app` inserts that row; (2) `dsh-tui-agent-presets` (same name, same config) for the **`dsh-tui` plane**, where dsh-tui's own patch mints that scoped id. **Loader semantics that make the pair safe**: an id-target is a **per-key shallow override** (`cordis-plugin-include/src/index.ts:120-124` assigns only the keys the patch carries and skips `id`), so the host row's `disabled` guard survives untouched; an id-target that matches no entry is only the **WARNING** `patch: entry "<id>" not found` (`…/cordis-plugin-include/src/index.ts:112`) and applies nothing; a duplicate entry id is **FATAL** (`cordis-plugin-loader src/config/group.ts:64` throws `duplicate loader entry id`, with no `disabled` exemption). **If an INSERT is ever preferred it must carry its OWN id (e.g. `mpd-tui-agent-presets`) and extend the R4 installer mirror — NEVER id `agent-presets`** (dsh-web-app inserts that id in a web composition ⇒ two entries with one id ⇒ dead boot). Honest limit: if measurement shows the pair cannot coexist in some profile, this AC is recorded **NOT CLAIMED** with the measured artifact. | live-mount, regression | `bun skills/dsh-qa/scripts/tui-mount.ts` and R5 | `evidence/tui/lanes/<ts>/preset.pane.txt`, `evidence/tui/composition/<ts>/` |
| **AC-12** | Every package **directory** under `packages/` is classified **usable / inert / web-only**, each with the patch/row observation that proves it (an unexercised package is classified from an explicit observation such as "row mounted + inert under TUI", never inferred from the row's presence alone). `packages/node_modules` is **excluded**, and the **count must be stated explicitly with the revision classified**: 24 pre-existing package dirs (the number the t2 review measured) plus `packages/mpd-tui-plugin`, which `t4` creates — 25 measured in the tree on 2026-09-15 after `t4` landed. Split: `t5` writes the **static composition classification** to `evidence/tui/composition/<ts>/ledger.json`; `t8` adds the **live confirmation** under `evidence/tui/live/<ts>/`. | live-mount, regression | `bun skills/dsh-qa/scripts/tui-mount.ts` (live confirmation, t8), R4 + R11 (static composition) | `evidence/tui/composition/<ts>/ledger.json` (t5) **and** `evidence/tui/live/<ts>/` (t8) |
| **AC-13** | `dsh-distribution.json` is validated by the **dsh-distribution conformance CLI** (protocol repo copied into the workspace so builds stay in-sandbox), with command, revision and output recorded; if it cannot run, the exact blocker is stated and the descriptor is marked **NOT fully validated**. | distribution | `bun skills/dsh-qa/scripts/tui-distribution.ts` | `evidence/tui/lanes/<ts>/distribution.json` |
| **AC-14** | The ecosystem conformance suite is executed per requirement against our manifest and a captured host descriptor, using the pinned upstream parser/suite rather than a re-implementation, with input revisions **and** digests recorded. Two revisions, two roles: **PRIMARY** = the host's own pinned spec submodule `/root/dshProj/tui/dsh-TUI/dsh-ecosystem-spec/` @ `d28c267` (`conformance/{tests/run.js,tests/admission-core.js,tests/std-modules.js,tests/validate-manifest.cli.test.js,requirements-v0.15.json,fixtures/}`) — the suite exists ONLY in the populated git checkout (the installed payload ships `registry/ protocols/ schemas/`), so the lane runs it from a workspace-local copy and records the copy root + revision + digest; **CROSS-CHECK** = the archived `6e2cf58` content, whose extraction is an explicit, owned prerequisite of this lane (`t7`, cross-checked by `t9`): `git -C /root/dshProj/tui/dsh-ecosystem-spec archive 6e2cf58 old \| tar -x -C .mpd/recon/spec-history/` — verified to carry **95 files** under `old/` (incl. `old/scripts/conformance.mjs`, `old/scripts/validate-manifest.mjs`, `old/schemas/`, `old/registry/`, `old/protocols/`), referenced as `.mpd/recon/spec-history/old/...`. The target is described as the host's built-in **`tui-admission/0.15`** profile, never "the current ecosystem standard". | spec-conformance | `bun skills/dsh-qa/scripts/tui-spec-conformance.ts` | `evidence/tui/lanes/<ts>/spec-conformance.json` |
| **AC-15** | **Dual-profile negative control** for the composition, witnessed by the gates that can actually see a roster: (a) a **dual-profile composition/boot-log scan** asserting that each roster id-target ABSENT in that profile appears ONLY as the warning `patch: entry "<id>" not found` (`cordis-plugin-include/src/index.ts:112`) and that the composed config contains **exactly ONE** `@deepseek-ai/dsh-agent-presets` entry — the existing `web-dump-config.err` / `web-dump-config.txt` pair under `evidence/tui/composition/20260915T053445Z/raw/` is the shape (its only warning is the TUI-plane id missing, and it carries one roster row); the `dsh-tui` profile shows the same in reverse; (b) **R6** (`bun skills/dsh-qa/scripts/bundle-lifecycle.ts`) for the real web boot. **R4 is NOT a witness here** — it stays named only for the `mpd-tui` insert-row mirror (AC-3/AC-18). Adding the `mpd-tui` row and the two roster id-targets must break neither profile. | regression | R6, R3 + the dual-profile composition scan | `evidence/tui/composition/20260915T053445Z/raw/web-dump-config.{err,txt}`, `evidence/tui/live/<ts>/` (t8) |
| **AC-16** | Bilingual docs exist and are wired: `docs/tui.md` + `docs/tui.zh-CN.md` each carry the language switch link directly under the title and are linked from `docs/index.md`, `docs/index.zh-CN.md`, `README.md`, `README.zh-CN.md`. | regression | R7 | `evidence/tui/docs/<ts>/` |
| **AC-17** | The artifacts the user reads are honest: the docs carry the per-package compatibility ledger and a NOT-CLAIMED section naming the blocked decision-event seam, the web-only surfaces and the engine version skew; no sentence asserts a verification result that no evidence directory backs. | regression | R8 (+ t13) | `evidence/tui/docs/<ts>/` |
| **AC-18** | The repo regression set is green on the wave's final revision: typecheck, package tests, `test:qa`, row parity — **R4 is the gate proving the `scripts/install-profile.ts` mirror of the `mpd-tui` patch row** — plus the packed-tree consistency assertion **R11** (every `@mpd-dsh/mpd/packages/<pkg>/dist/index.js` row of the bundle patch is in `PLUGIN_PKGS`). | regression | R1–R5, R11 | `evidence/tui/conformance/<ts>/` |
| **AC-19** | The delivery is one coherent artifact set: every AC has a final status (passed / failed / not-claimed) with its backing path, the report names the install command + verified lanes + NOT-CLAIMED list + residual captain work (single `VENDOR_LOCK` re-pin and the commit) and the upstream recommendation, and an evidence index lets a third party walk from each claim to its raw artifact including the negative controls. | regression | R9 | `.mpd/plans/dsh-tui-edition-report.md`, evidence index under `evidence/tui/` |
| **AC-20** | The host's own `verify:plugin-*` gates are either run from a workspace-local copy with per-gate honesty about what they prove, or reported BLOCKED with the exact blocker; they are **never** presented as a conformance verdict on our plugin. | regression | R10 | `evidence/tui/conformance/<ts>/host-gates.json` |

Items a lane cannot witness are still recorded — as `not-claimed` with the reason and the artifact
that shows the gap (t14 ledger rule: "no item is left unstated").

## 5. Deliverable-to-path table

`new` = created by this wave; `edit` = existing file amended; `evidence` = produced, not committed as
source. Every path below either already exists in the repo or is created by a task in this DAG —
there are no phantom references.

| Path | Producer | State |
|---|---|---|
| `.mpd/plans/dsh-tui-edition.md` | t1 (this file) | new |
| `packages/mpd-tui-plugin/{src/**,dist/index.js,package.json,README.md,README.zh-CN.md,themes/**,skills/**}` | t4 | new |
| `evidence/tui/plugin/<ts>/` | t4 | new (evidence) |
| `dsh-plugin.json` (repo root) | t5 | new |
| `packages/mpd-bundle/cordis.patch.yml` (`mpd-tui` row + the two preset-roster id-targets of AC-11: `agent-presets` for the web plane, `dsh-tui-agent-presets` for the TUI plane) | t5 | edit |
| `scripts/install-profile.ts` (mirror row `{id: "mpd-tui", name: p("packages/mpd-tui-plugin/dist/index.js"), config: {}}` in the same position as the patch row; R4 is the gate — see AC-3/AC-18) | **t5** (named, owned edit; `scripts/` must be added to t5's inScope by the captain — until then this edit is unowned and unchecked, and the weaker alternative is a DAG amendment giving `scripts/` to a task) | edit (mirror row already present at `scripts/install-profile.ts:171-178`, measured 2026-09-15) |
| `scripts/pack-mpd.ts` (`PLUGIN_PKGS` entry `"mpd-tui-plugin"`; the class is gated by R11) | t5 (t6 may carry it) | edit (applied by t17) |
| `presets/mpd/agent.cordis.yml` (only if the TUI default requires it) | t5 | edit |
| `evidence/tui/composition/<ts>/ledger.json` | t5 (static classification) | new (evidence) |
| `dsh-distribution.json` (repo root) | t6 | new |
| `docs/tui.md`, `docs/tui.zh-CN.md` | t6 | new |
| `docs/index.md`, `docs/index.zh-CN.md`, `README.md`, `README.zh-CN.md` | t6 | edit |
| `evidence/tui/docs/<ts>/` | t6 | new (evidence) |
| `skills/dsh-qa/scripts/tui-mount.ts` | t7 | new |
| `skills/dsh-qa/scripts/tui-panels.ts` | t7 | new |
| `skills/dsh-qa/scripts/tui-admission.ts` | t7 | new |
| `skills/dsh-qa/scripts/tui-distribution.ts` | t7 | new |
| `skills/dsh-qa/scripts/tui-spec-conformance.ts` | t7 | new |
| `skills/dsh-qa/SKILL.md` (case table) | t7 | edit |
| `evidence/tui/lanes/<ts>/` | t7 | new (evidence) |
| `evidence/tui/live/<ts>/` | t8 | new (evidence) |
| `evidence/tui/conformance/<ts>/` | t9 | new (evidence) |
| `evidence/tui/` (index) | t14 | new |
| `.mpd/plans/dsh-tui-edition-report.md` | t14 | new |
| `VENDOR_LOCK.json` (single skills-corpus re-pin) | **captain's commit** — no task edits it | edit at commit time only |
| `.mpd/recon/qa/**` (sandbox scratch) | sandbox, not a deliverable | new (scratch) |
| `.mpd/recon/host-copy/` (workspace-local copy of the host checkout, for R10) | t9 | new (scratch) |
| `.mpd/recon/spec-history/old/**` (archived `6e2cf58` suite content, AC-14 cross-check) | t7 (owned extraction prerequisite; `git -C /root/dshProj/tui/dsh-ecosystem-spec archive 6e2cf58 old \| tar -x -C .mpd/recon/spec-history/`) | new (scratch, extracted from the spec git history at `6e2cf58`; 95 files) |

⚠ **Spec-data warning for the admission lane**: `.mpd/recon/dsh-TUI/` is **NOT** a complete host copy —
its `dsh-ecosystem-spec/` directory is **empty** (it is a depth-1 clone with uninitialised
submodules). For anything admission-related (`loadSpecData`, `/plugins check`, the suite) use the
installed payload `<node_global>/@deepseek-harness-tui/dsh-tui/dsh-ecosystem-spec/` or the populated
checkout `/root/dshProj/tui/dsh-TUI/dsh-ecosystem-spec/` (@`d28c267`) — never the recon clone.

Existing repo paths this contract relies on: `packages/` (24 pre-existing package dirs +
`packages/mpd-tui-plugin` = **25**, measured 2026-09-15, excluding the gitignored
`packages/node_modules` entry), `skills/dsh-qa/scripts/`, `scripts/verify-rows-parity.ts`,
`package.json`, `presets/mpd/`, `evidence/`, `docs/index.md`.

## 6. NOT CLAIMED

Stated up front so no downstream artifact can over-claim:

- **W-1 — Decision-event seam is not activated: blocked by host admission unreachability.**
  `tui.dsh/v1alpha1#DecisionEvents` cannot be registered by a profile-installed plugin: the public
  `admit()` throws
  (`src/dsh-adapter/plugin-host.ts:415-430`), `admitInternal` is token-gated (`:435-496`),
  `getHostAdmission*` has **zero production callers** (`:890-914`). Consequence: no input / rewind /
  session-switch / compact interception is claimed; the seam is shipped **ready-but-not-activated**
  (AC-6) and the manifest declares its permissions only as an optional requirement with a fallback.
  Faking admission with the test token is forbidden. Upstream path is researched by `t11`.
- **W-2 — Identity-gated services are not claimed.** `storage.local`, `messages.observe`, and the
  mediated (attributed) `registerCommand` path require the same verified Component identity; the
  effect ledger therefore attributes our surface as `undeclared` today. Not claimed as working.
- **W-3 — Web-only faces have no TUI rendering face.** The agent-teams sidebar, the workmate tab and
  the bundle floater (`dsh.client.platform = web`) do not render in the TUI; the TUI-native
  equivalents are the full-screen board / status line / dialogs built by `t4` (D8), and the web
  profile is untouched (AC-15). "TUI-native equivalent" is **not** a claim of pixel or feature parity.
- **W-4 — Engine version skew.** The host prints `⚠ The dsh engine (0.1.5-rc.2) is newer than the
  0.1.5-rc.1 this UI is validated against` and keeps running (advisory only for a newer patched
  engine). Our verification therefore runs against the installed 0.1.5-rc.2 engine, not the
  engine revision the UI was validated against.
- **W-5 — Seam 2 (`tuiPrompt` slot) is host-unavailable.** dsh-TUI does not provide it; no claim.
- **W-6 — Host-internal gates are not our conformance.** The host's `verify:plugin-*` suite validates
  the HOST's plugin subsystem; even a green run is not a conformance verdict on this bundle, and it
  may be BLOCKED (the checkout has no `node_modules`/`lib/`, `@dsh-std/*` are `workspace:*` peers,
  and writing into `/root/dshProj/tui/dsh-TUI` is outside the sandbox).

## 7. Binding rules and measured constraints

1. **Single install**: `dsh plugin --profile dsh-tui add /root/dshProj/my-power-dsh` is the whole
   install; there is no second install path and no per-package `dsh plugin add` (AC-2). The bundle
   patch owns the `mpd-tui` row id and the module specifier
   `@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js`; the package itself must **not** carry a
   `cordis.patch.yml` (a second mount would duplicate a loader entry id — the loader rejects
   duplicate entry ids outright) (AC-3).
2. **No duplicate loader entry id** in any composition (bundle patch / preset / overlay); a row that
   is already in the bundle patch must not also live in a QA overlay (AGENTS.md §6).
2b. **Every row has two mirrors, and each mirror has a gate**: a plugin row added to the bundle patch
   must also be declared by `scripts/install-profile.ts` (**R4** proves the row-id mirror) and its
   package must be listed in `PLUGIN_PKGS` of `scripts/pack-mpd.ts` (**R11** proves the packed-tree
   mirror; without it `npm run pack` exits 0 while shipping a tree that dies
   `ERR_MODULE_NOT_FOUND` on that row). The `mpd-tui` edits are named in §5 with owner `t5`.
2c. **TUI default preset is composition, not code — and it is a PAIR of id-TARGETs, never an
   INSERT.** The frozen mechanism in `packages/mpd-bundle/cordis.patch.yml` is two id-targets, each
   present in exactly one composition: `agent-presets` (name `@deepseek-ai/dsh-agent-presets`,
   config `{default: mpd, roots: [<bundle>/presets @ system]}`) for the web/base plane, where
   `dsh-web-app` inserts that row, and `dsh-tui-agent-presets` (same name/config) for the `dsh-tui`
   plane, where dsh-tui's own patch mints that scoped id. Loader semantics: an id-target is a
   **per-key shallow override** (`cordis-plugin-include/src/index.ts:120-124`) — only the keys we
   name change, so the host row's `disabled` guard survives; an id-target that matches nothing is a
   **warning**, `patch: entry "<id>" not found` (`…:112`), and applies nothing; a duplicate entry id
   is fatal (`cordis-plugin-loader src/config/group.ts:64`). A second insert with id `agent-presets`
   must NEVER be added — `dsh-web-app` already inserts it in a web composition (AC-11, dual-profile
   control AC-15).
3. **No pipe on stdout**: the host refuses to boot when stdout is not a TTY
   (`dsh-tui requires an interactive terminal (stdout must be a TTY)`), so every live lane boots
   inside tmux and captures with `capture-pane -p -J` + `pipe-pane` raw logs.
4. **One tmux process per lane**: a tmux server does not survive across shell invocations, so each
   lane spawns, drives, captures and kills tmux inside a single process.
5. **Isolation**: `DSH_HOME`, `HOME`, npm/pnpm cache+store all inside the workspace
   (`.mpd/recon/qa/...`, recipe in `CAPTAIN-RECON.md` §5); never the real `~/.dsh`, `~/.dsh-tui`,
   `~/.mpd` or `~/.npm` (the last is read-only). Assert the sandbox paths.
6. **Single skills writer**: `t7` is the only writer of `skills/**` in this wave; the corpus
   `treeSha` re-pin in `VENDOR_LOCK.json` rides in the captain's commit (AGENTS.md §9/§11).
7. **Read-only host/spec**: `/root/dshProj/tui/**` is outside the sandbox; nothing there may be
   written. Anything needed must be copied into the workspace first.
8. **No git writes by workers**: only the captain commits/branches (AGENTS.md §5).
9. **State resolution**: any `.mpd` state the plugin reads resolves through
   `dsh.workspaceRoot(exec)` (session cwd first), never the process cwd, never `~/.dsh`.
10. **Untrusted input**: everything rendered into the status line / transcript goes through the
    host's scalar-only, cell-width, sanitized path; non-scalars are dropped, never stringified.

## 8. Change control

An AC may change only through the captain (task amendment, or a repair task such as `t17` that the
captain scopes onto this file); the downstream tasks re-run from the amended contract. Workers and
reviewers must not silently weaken an AC: a criterion that cannot be met is reported as **failed** or
**not-claimed** with its artifact, never restated.

## 9. Consumers

| Task | Judges against |
|---|---|
| t2 (Plan Reviewer) | AC-1…AC-20 executability, path resolution, no invented host capability (re-review after `t17`) |
| t4, t5, t6, t7 | the ACs they own (§4 rows) + §7 rules (t5 also owns the `scripts/install-profile.ts` and `scripts/pack-mpd.ts` edits named in §5) |
| t8 (live) | AC-1, AC-2, AC-4, AC-6, AC-7, AC-11, AC-12 (live half), AC-15 |
| t9 (conformance) | AC-3, AC-8…AC-10, AC-13, AC-14 (cross-check half), AC-18, AC-20 |
| t10 (seam audit) | §2.3 host-API table |
| t11 (research) | W-1 upstream path, claim vocabulary |
| t12, t13 (reviews) | AC-5, AC-6, AC-10, AC-16, AC-17; t13 also judges AC-3's mirror ownership and AC-11's preset guard — the DELIVERED pair of id-targets (`agent-presets` + `dsh-tui-agent-presets`), never an INSERT |
| t14 (integration) | every AC has a final status + artifact; AC-19 |
| t17 (repair round 2) | this file + `scripts/pack-mpd.ts` (the eight t2-review amendments) |
