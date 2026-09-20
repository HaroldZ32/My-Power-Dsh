# t1 — Requirements + runtime dependency inventory: “the bundle installs every plugin it depends on”

**Author:** Architect (team `mpd-install-deps`, task `t1`, attempt 2). **Kind:** requirements (round 1).
**Mode:** read-only analysis — no file edits, no shell. Every citation is `file#symbol` (AGENTS.md T-55: never a bare line number).
**In scope:** `evidence/install-deps/requirements/**`. Companion artifact: `inventory.json` (machine-readable form of §6).

---

## 0. Method, and where I stand on the captain-measured facts

I did **not** re-derive the captain's harness measurements `CM-1…CM-8` (they were taken against the installed
`dsh 0.1.5-rc.1` with a shell I am not permitted to use). I adopt them as **premises**, marked `[CM-n]` wherever
one carries a criterion, and I say so in each place rather than re-asserting them as my own.

What I **did** verify myself, from artifacts on disk (explicit-file reads only, no shell):

| # | Claim | Status | Evidence (file#symbol) |
|---|---|---|---|
| V1 | `dsh-better-sidebar@0.19.0-alpha.1` declares `dsh.client` (5 client injects) **and** `exports["./client"]` | **confirms CM-4’s premise** | `/root/.dsh/profiles/web/node_modules/dsh-better-sidebar/package.json#dsh.client`, `#exports` |
| V2 | Its server half exports `inject = ["webServer","sessions","webRuntime","tools"]` | **confirms CM-5** | `/root/.dsh/profiles/web/node_modules/dsh-better-sidebar/lib/index.js#inject` (exported at `#export {…inject…}`) |
| V3 | It registers the prefix route `/sidebar/api` through `ctx.webServer.register` | confirms the duplication mechanism | same file, `#apply` → `ctx.effect(() => ctx.webServer.register({ … path: "/sidebar/api" … }))` |
| V4 | It ships its own bundle patch with an order-limited duplicate guard and states “no runtime singleton guard is added” | confirms the duplicate hazard is the ECOSYSTEM’s own documented one | `/root/.dsh/profiles/web/node_modules/dsh-better-sidebar/cordis.patch.yml` |
| V5 | The user’s real web profile does **not** declare `dsh-better-sidebar` in `dependencies` nor in `dsh.profile.bundles` — yet the package is present on disk | **the reported symptom, verbatim** | `/root/.dsh/profiles/web/package.json#dependencies`, `#dsh.profile.bundles` |
| V6 | It is present because `@linxin666/dsh-web-all@0.3.20` declares it (`"dsh-better-sidebar": "0.19.0-alpha.1"`) and mounts it with an **UNGUARDED** row `web-ui-better-sidebar` | **new finding, see §5.1** | `/root/.dsh/profiles/web/node_modules/@linxin666/dsh-web-all/package.json#dependencies`; `…/cordis.patch.yml` (insert `web-ui-better-sidebar`) |
| V7 | `@deepseek-ai/dsh-agent-presets@0.1.5-rc.2` and `@deepseek-ai/dsh-mcp-client@0.1.5-rc.2` are present in the shared installation closure | **confirms CM-7’s HOST verdict** | `/root/.dsh/profiles/node_modules/@deepseek-ai/dsh-agent-presets/package.json`, `…/dsh-mcp-client/package.json` |
| V8 | The CLIENTS half of the mpd bundle declares hard injects `["slots","locale"]`; `betterSidebar` is reached only through a runtime `ctx.inject` | refines CM-7 | `packages/mpd-bundle-plugin/src/web-client.js#REQUIRED_SERVICES`, `#mountSidebarPages` |
| V9 | The mpd bundle’s only external row names are `@deepseek-ai/*` (host) and `@mpd-dsh/mpd*` (self); no third-party plugin row exists and no `dependencies` block exists in the manifest | **confirms CM-7** | `packages/mpd-bundle/cordis.patch.yml` (all `name:` values), `presets/mpd/agent.cordis.yml` (all row names), `package.json` |
| V10 | Composition dumps distinguish the planes by row: web has `@deepseek-ai/dsh-host-webserver` + `id: agent-presets`; the dsh-tui composition has neither (it carries `dsh-tui-agent-presets`) | new, enables the guard candidates in §5.5 | `evidence/tui/composition/20260915T053445Z/raw/web-dump-config-final.txt`, `…/tui-dump-config-final.txt` |
| V11 | The profile’s own patch layer is documented as applied **after every bundle layer** | layering fact for the guard and for ordering | `/root/.dsh/profiles/web/cordis.patch.yml` (its own header) |
| V12 | `scripts/pack-mpd.mjs` writes its OWN manifest for the packed artifact | new, see AC-8 | `scripts/pack-mpd.mjs#writeBundleManifest` |

**Refinements** (not disagreements): (i) CM-7 is right that the two sidebar pages are required by
`packages/mpd-bundle-plugin/src/**`, but the dependency is a **runtime** `ctx.inject(["betterSidebar"])`, not a
declared `inject` — so its absence is SILENT (no page, no error), not a pending entry. (ii) CM-5's inject list is
confirmed exactly (V2). One **tension** is stated in §5.2 and must be settled by measurement, not by argument.

---

## 1. The user clause, restated as the requirement

> `dsh plugin --profile <p> add @mpd-dsh/mpd` (one command, no second install step) must leave the profile in a
> state where the bundle’s shipped web GUI actually renders: the sidebar HOST plugin those GUI pages register
> into is installed, resolvable **and mounted**; and the mechanism must cover the whole dependency class, so the
> next third-party runtime plugin the bundle needs cannot repeat this defect.

Three explicit non-goals: it must not make a non-web composition (`dsh-tui`) fail to boot; it must not create a
profile that fails to boot because the plugin is mounted twice; and it must not silence the failure — a missing
host is a bug, not a warning.

---

## 2. Definitions — the class boundary

A **runtime plugin dependency** is a package that must be **(a)** resolvable from the profile root at boot **and**
**(b)** mounted by a loader entry, for a capability the bundle ships to work. Only packages that are **neither**
part of the dsh installation closure **nor** shipped inside the bundle are actionable by us:

| Verdict | Meaning | Action required of the bundle |
|---|---|---|
| **HOST** | Provided by the dsh installation closure (`$DSH_HOME/profiles/node_modules/@deepseek-ai/**`, V7) | none — never declare, never bundle |
| **SELF** | Shipped inside `@mpd-dsh/mpd` (own `packages/**`, vendored `_deps/**`, embedded client modules) | none — the exports map is the delivery mechanism |
| **MUST-BE-INSTALLED** | Third-party, outside both closures | **declare it in the bundle manifest AND mount it with a guarded row** |
| **BUILTIN** | Loader builtin (`cordis:group`) | none |
| **TOOLCHAIN-OPTIONAL** | External binary, already an `optionalDependencies` entry; absence degrades | none new |
| **SOFT-OPTIONAL** | Service reached only by runtime `ctx.inject`; absence degrades silently, never boot-fatal | none (but see AC-4) |

**The MUST-BE-INSTALLED set today is exactly one package: `dsh-better-sidebar`** [CM-7, re-verified as V9].
Everything else in the inventory (§6) is HOST, SELF, BUILTIN, TOOLCHAIN-OPTIONAL or SOFT-OPTIONAL.

---

## 3. Acceptance criteria (numbered; each falsifiable by a command or an artifact)

### AC-1 — Declaration completeness
Every row **name** in `packages/mpd-bundle/cordis.patch.yml` and every row **name** in
`presets/mpd/agent.cordis.yml` is classified HOST / SELF / BUILTIN, and every MUST-BE-INSTALLED package it names
appears in the bundle manifest’s `dependencies`.
**Falsifier:** `node -e` / a repo check that extracts every `name:` from those two files, subtracts
`@deepseek-ai/*`, `@mpd-dsh/mpd*`, `cordis:*` and every `SELF`-classified vendored id, and exits non-zero when the
remainder is not a subset of `Object.keys(require('./package.json').dependencies)`. Today it exits non-zero
(`dsh-better-sidebar` is unlisted; `dependencies` is absent entirely).
**DoD:** the check runs non-zero-before / zero-after and its output is stored; the inventory in §6 enumerates the
full reference set with no unclassified row.

### AC-2 — Fresh-profile resolution (a REAL `dsh plugin add`, not a hand-made sandbox)
On a fresh isolated `DSH_HOME`, `dsh plugin --profile <p> add <bundle-path-or-packed-artifact>` is followed by an
assertion that `dsh-better-sidebar` **resolves from the profile directory** — e.g. the realpath of
`<profileDir>/node_modules/dsh-better-sidebar/package.json` exists after the install, or
`node --input-type=module -e "import.meta.resolve('dsh-better-sidebar')"` run from `<profileDir>` succeeds.
**Falsifier:** that assertion after a real install; the negative control is AC-3(a) — with the package absent the
boot log carries `plugin(s) failed to load`.
**DoD:** the install log and the resolution evidence are stored under `evidence/install-deps/**` with the UTC
instant each was read (AGENTS.md §7: a hash/quoted state carries its measurement moment).

### AC-3 — Mounted on the web plane with no boot-fatal signature
A **real mounting boot** of that profile (never `--dump-config`, which composes rows without executing plugin
code) shows: (a) no `plugin(s) failed to load` (`assertEntriesLoaded`, `[CM-5]`); (b) no `did not activate` /
`pending (waiting for service:` (`assertEntriesActivated`, `[CM-5]`); (c) no `duplicate prefix route` (V3/V4);
(d) an ACTIVATED fibre for the sidebar entry; (e) the served client set contains `dsh-better-sidebar/client.js`
(HTTP 200 from the index-discovered `/plugins/…` URL, `[CM-4]`).
**Falsifier:** the boot log scanned for those three strings (absent) plus the two positives; the served-client
HTTP evidence.
**DoD:** boot log + HTTP transcript stored; the three strings asserted ABSENT by a recorded assertion, not by eye.

### AC-4 — The mpd tabs actually get their host (positive evidence, not the absence of an error)
Because `betterSidebar` is reached with a runtime `ctx.inject` (V8), a missing host produces **no error at all**:
the two pages silently never register. The criterion is therefore positive: on that boot the mpd client’s
`ctx.inject(["betterSidebar"], …)` callback fires and the AgentTeams tab (`mpd-agent-teams`) and the workmate tab
(`mpd-workmate`) are registered (per the sidebar’s own `registerTab` service).
**Falsifier:** the existing case `skills/dsh-qa/scripts/agent-teams-sidebar.mjs` extended so its boot arm is driven
by the REAL install (its current `bootProbe` hand-symlinks `@deepseek-ai`, `@linxin666`, `dsh-better-sidebar` from
the user’s profile into a sandbox profile — that shortcut must not be the evidence for AC-2) plus a
`betterSidebar`-fired assertion; the case’s own honesty rule (real-boot vs declared fallback, stated in
`result.json`) applies.
**DoD:** the case passes with the real-boot arm taken, and `result.json` names which arm produced the proof.

### AC-5 — Exactly one mount, in BOTH install orders (no new boot-killer)
(i) **Order A** — the aggregate is present first, mpd last (the order `dsh plugin add` produces when mpd is added
last, and the order of the user’s own profile): exactly ONE enabled entry whose `name === 'dsh-better-sidebar'`,
no `duplicate prefix route`.
(ii) **Order B** — mpd first, an aggregate that mounts the sidebar added later: the profile must still **boot**.
Today that order boots (mpd mounts nothing); a naive guarded insert makes it fatal (the guard sees only rows
processed BEFORE it — V4 states the same limitation for the sidebar’s own guard, and the aggregate’s row is
UNGUARDED, V6). **A `duplicate prefix route` in either order fails this criterion; a documented “known
limitation” does not satisfy it.**
**Falsifier:** two isolated profiles (one per order), each installed by the real `dsh plugin add`, each with a
mounting boot; assert the three signatures of AC-3(a-c) absent and exactly one sidebar mount.
**DoD:** both boot logs stored; the guard mechanism named in the change description; if the reverse order cannot
be made safe inside the bundle, that is a blocking finding for the review task, not a footnote.

### AC-6 — Non-web plane obligation (dsh-tui must stay green)
A `dsh-tui`-composition profile boots green with the new row **disabled or absent**: no
`pending (waiting for service: webServer…|webRuntime…)` and no `did not activate`, because
`dsh-better-sidebar`’s own `inject` (V2) names two services that composition never provides `[CM-5]`.
**Falsifier:** (i) the composition dump of the TUI plane shows the sidebar row disabled/absent (composition-only
evidence — explicitly NOT load evidence, AGENTS.md §4), **and** (ii) a real TUI boot log scanned for the
terminal-only activation-failure signatures already used by `skills/dsh-qa/scripts/team-watchdog-boot.mjs`
(`did not activate`, `pending (waiting for service`, `failed to apply loader entry`).
**DoD:** both stored; the guard expression that produces the disabled state is quoted in the evidence.

### AC-7 — No new hard `inject` in bundle-owned code
No mpd-owned plugin row gains a web-only or optional service in its declared `inject`; third-party and optional
services stay behind runtime `ctx.inject` (the pattern of V8 / `web-client.js#mountSidebarPages`), because a
declared-but-unprovided service is fatal on the server plane (`assertEntriesActivated`) and on the client plane
the web boot hard-fails the page (the `assertEntriesActive` → “Failed to load plugins” class recorded in
`packages/mpd-bundle-plugin/src/web-client.js#REQUIRED_SERVICES`).
**Falsifier:** a textual assertion over every `export const inject` in `packages/*/src/**` plus a boot in a
composition that provides none of the optional seams.
**DoD:** assertion output + the webless boot log stored.

### AC-8 — The packed artifact keeps the guarantee
`node scripts/pack-mpd.mjs` writes the packed manifest itself (`#writeBundleManifest`, V12), so a dependency
declared only at the repo root would ship **absent** in `dist/mpd-package/package.json`. The packed manifest must
declare the same runtime dependency, and `dsh plugin --profile <p> add dist/mpd-package` must satisfy AC-2/AC-3.
**Falsifier:** run the pack, read `dist/mpd-package/package.json`, install from the artifact, boot.
**DoD:** pack output + packed manifest + boot evidence stored; `node scripts/verify-pack-closure.mjs` still
exit 0 (its exit code certifies completeness + byte identity only — AGENTS.md T-91 — so it is NOT cited as
freshness evidence).

### AC-9 — Docs stay truthful, bilingually
Human-facing docs that today tell the reader to install the sidebar themselves (`docs/user-guide.md` under the
profile note, `README.md` under the community-plugin list, and their `*.zh-CN.md` twins) are updated in the SAME
change: the web plane no longer needs a second install, and any remaining statement is scoped to non-web planes.
**Falsifier:** `bun run verify:docs` exits 0, plus a documented grep assertion that the “install it yourself”
instruction is gone for the web plane.
**DoD:** both files of each pair updated in one change; `verify:docs` evidence stored.

### AC-10 — Standing gates unchanged
`bun test`, `bun run typecheck`, `bun run test:qa`, `bun run verify:rows`,
`node skills/dsh-qa/scripts/preset-conformance.mjs --self-test` stay green; `skills/**` keeps its ONE writer and
the wave ships exactly ONE `VENDOR_LOCK.json` re-pin in the same commit (AGENTS.md §9) **only if** a skill file
truly changed.
**Falsifier:** each command’s exit code recorded.
**DoD:** an evidence file listing every command, its exit code and the artifact it produced.

---

## 4. The fatal failure modes the fix must not introduce (harness symbols)

| # | Mode | Harness symbol that throws | Trigger |
|---|---|---|---|
| F1 | an ENABLED entry whose module does not resolve | `assertEntriesLoaded` — `plugin(s) failed to load: <names>` `[CM-5]` | the declared dependency was not installed / not resolvable from the profile root `[CM-1, CM-3]` |
| F2 | an ENABLED entry left PENDING on a service the composition never provides | `assertEntriesActivated` — `N entries did not activate / <name>: pending (waiting for services: …)` `[CM-5]` | mounting `dsh-better-sidebar` (inject V2) in a `dsh-tui` composition |
| F3 | TWO entries mounting the same plugin | the plugin tree fails at boot with `duplicate prefix route` (two `/sidebar/api` registrations, V3) | the naive insert + an aggregate that also mounts it (V4/V6) |
| F4 | a CLIENT entry left pending | `assertEntriesActive` → “Failed to load plugins” (recorded in `packages/mpd-bundle-plugin/src/web-client.js#REQUIRED_SERVICES` comments) | declaring a client service the web composition does not mount (the class AC-7 forbids) |

F1–F3 are the three the contract names; F4 is their client-plane counterpart and is included because the bundle
ships a client entry that talks to the same plugin.

---

## 5. Findings that change what the implementation must do

### 5.1 The duplicate-mount arm is REAL, in the user’s own profile (V5/V6)
`@linxin666/dsh-web-all@0.3.20` declares `dsh-better-sidebar` as its dependency **and** mounts it UNGUARDED as
`web-ui-better-sidebar`. So on the machine where the defect was reported, the sidebar IS mounted — by the
aggregate, not by us. Two consequences: (i) the fix must be proven on a profile WITHOUT that aggregate (a fresh
`add` of the bundle alone), and (ii) any row we insert must back off there or it kills a boot that works today.

### 5.2 A tension to settle by measurement, not by argument
`scripts/pack-mpd.mjs#writeBundleManifest` still carries the claim “A plain `dependencies` entry is NOT enough:
pnpm … never links a bundle’s transitive deps into the profile root”, with the repro
`evidence/plan-e/e1-team-route/2026-08-27T07-38-13.142Z` — and that repro’s `bundleDependency` step is a
manifest/relocation check (`version: null, min: 0.1.13`), not a proof about pnpm’s linking. CM-3 says the harness
today **heals** the profile with a module fallback over the non-installation layers’ closure.
**Requirement:** the wave settles this by a REAL install + boot (AC-2/AC-3), never by choosing one side of the
comment. If the declaration alone does not deliver resolution, the fix must add whatever the harness actually
needs (and say so in the evidence).

### 5.3 Order B is a regression the naive shape introduces (§AC-5)
Guard visibility is forward-blind (`[CM-6]`, V4). Candidate mechanisms, in order of preference:
1. **Reference-list probe (order-independent).** The `!!js` expression also consults what can contribute rows
   besides already-processed entries: the profile manifest’s `dsh.profile.bundles` and each declared bundle’s
   `cordis.patch.yml`, plus the profile’s own patch layer (V11 — documented as applied after every bundle layer).
   Node’s globals are reachable inside the loader’s evaluator (`new Function('ctx', …)`), so
   `process.getBuiltinModule('node:fs')` is available if a bounded file read is needed `[CM-6]`.
2. **Entry-list guard only** (the shipping precedent, V4): satisfies order A, does NOT satisfy order B.
3. Eliminated: making the bundle a `dsh.profile.bundles` member — a bundle’s dependency never joins the profile’s
   bundle stack `[CM-1]`; and mounting the plugin at runtime through `ctx.plugin()` — the browser half is
   discovered from LOADER ENTRIES `[CM-4]`, so a runtime-only mount would deliver the server half and **no UI**.

### 5.4 Client-half discovery pins the shape
The sidebar’s UI needs `dsh.client` + `exports["./client"]` found from **a loader entry named
`dsh-better-sidebar`** `[CM-4]`, V1. Any design must therefore end with a real, enabled loader row in web
compositions — not a service injected by our own plugin.

### 5.5 The non-web guard predicate, with composition evidence
Two predicates discriminate the planes in the repo’s own composition dumps (V10):
`[...ctx.loader.entries()].some((e) => e.options.name === '@deepseek-ai/dsh-host-webserver' && !e.disabled)`
(recommended — it is exactly the provider of `webServer`, the service the sidebar injects) and
`… e.options.id === 'agent-presets' && !e.disabled` (the row dsh-web-app inserts; the TUI plane carries
`dsh-tui-agent-presets` instead). In the web dump both rows precede the mpd band (`dsh-host-webserver` before
`id: mpd-web-compat`), so the guard can see them. Whichever is chosen, AC-6’s falsifier is what proves it.

### 5.6 The packed manifest is written separately (V12) — see AC-8.

---

## 6. Runtime dependency inventory (authoritative)

Reference set enumerated from the three declaration surfaces plus the client sources. `fatal?` = the failure mode
if the reference cannot be satisfied (`F1`…`F4`, or `degrade` = silent/non-fatal).

### 6.A `packages/mpd-bundle/cordis.patch.yml` — every row `name:`

| # | Row id(s) | name | Verdict | fatal? | Evidence |
|---|---|---|---|---|---|
| A1 | `agent-presets`, `dsh-tui-agent-presets` | `@deepseek-ai/dsh-agent-presets` | HOST | F1 | V7 (0.1.5-rc.2 in the shared closure); id-target restates the stock config, `cordis.patch.yml` comments |
| A2 | `mcp-astgrep`, `mcp-gitbash` (disabled), `mcp-lsp`, `mcp-codegraph`, `mcp-context7`, `mcp-grepapp` (6 rows) | `@deepseek-ai/dsh-mcp-client` | HOST | F1 | V7 |
| A3 | `mpd-web-compat` | `@mpd-dsh/mpd` | SELF | F1 | `package.json#exports`, `#main`; the row exists so `dsh-client-modules` finds the client (`[CM-4]`) |
| A4 | `mpd-dsh-adapter`, `mpd-config`, `mpd-team-watchdog`, `mpd-tools`, `mpd-modelchain`, `mpd-ext`, `mpd-roles`, `mpd-ulw`, `mpd-hashline`, `mpd-boulder`, `mpd-comment-checker`, `mpd-codegraph`, `mpd-memory`, `mpd-workmate`, `mpd-team-compact`, `mpd-bootstrap`, `mpd-tui` (17 rows) | `@mpd-dsh/mpd/packages/<pkg>/dist/index.js` | SELF | F1 | repo tree; exports map `"./packages/*"` |
| A5 | `agent-teams` | `@mpd-dsh/mpd/packages/mpd-agent-teams-plugin/lib/index.js` | SELF | F1 | vendored `_deps/**` closure (`scripts/vendor-agent-teams.mjs`); the row is deliberately UNGUARDED because the closure is shipped |
| A6 | (config data, not rows) | 11 role names `Architect … Junior Engineer` | n/a | — | `cordis.patch.yml` `sessionTeamPolicy.roster` |

### 6.B `presets/mpd/agent.cordis.yml` — every row `name:`

| # | Count | Reference | Verdict | fatal? |
|---|---|---|---|---|
| B1 | 24 distinct packages / 28 rows | `@deepseek-ai/dsh-persona`, `dsh-agent-instructions`, `dsh-tool-bash`, `dsh-tool-pwsh`, `dsh-tool-fs`, `dsh-tool-fs-search`, `dsh-tool-jobs`, `dsh-skill-filesystem`, `dsh-tool-skill`, `dsh-command-goal`, `dsh-tool-goal`, `dsh-plan-mode`, `dsh-compaction-basic`, `dsh-command-compact`, `dsh-compaction-tool-result-pruner`, `dsh-tool-subagent-control` (+`/list-agents`), `dsh-tool-subagent` (4 rows, 2 `disabled: true`), `dsh-workflow-worker-thread`, `dsh-tool-workflow`, `dsh-tool-ralph`, `dsh-tool-ask-user`, `dsh-tool-todo`, `dsh-tool-web`, `dsh-tool-present` | HOST | F1 (preset mount refuses the whole preset) |
| B2 | 3 rows | `cordis:group` | BUILTIN | n/a |

### 6.C extension plane (`extensions/**`)

| # | Reference | Verdict | fatal? | Evidence |
|---|---|---|---|---|
| C1 | `mpd-ext-example` (skills + flows + roles + a stdio MCP server `command: node`, `args: [server.mjs]`) | SELF, `enabled: false` | none (disabled by default) | `extensions/mpd-ext-example/mpd-ext.json#contributes`; the MCP server is a bundled, dependency-free script |
| C2 | user-installed extension manifests (future) | MUST-BE-INSTALLED by their author, not by this bundle | F1 class for their own rows | `mpd-ext-plugin` discovery contract |

### 6.D client plane (`dsh.client`) and runtime service injects

| # | Reference | Where | Verdict | fatal? |
|---|---|---|---|---|
| D1 | `dsh.client.inject: []`, `platform: web` (root manifest, packed manifest, installer shim) | `package.json#dsh.client`; `scripts/pack-mpd.mjs#writeBundleManifest`; `scripts/install-profile.mjs` shim | SELF | — |
| D2 | hard client injects `["slots","locale"]` | `packages/mpd-bundle-plugin/src/web-client.js#REQUIRED_SERVICES` | HOST | F4 if wrong |
| D3 | `betterSidebar` (runtime `ctx.inject`) — the reported defect | `web-client.js#mountSidebarPages` | **MUST-BE-INSTALLED** | silent: no tabs, no error |
| D4 | `modelDirectories`, `remote.session` (runtime `ctx.inject`) | `packages/mpd-bundle-plugin/src/team-page.js` | SOFT-OPTIONAL (provider is another plugin’s fibre; degrades to the declared list) | degrade |
| D5 | `settingsScope` (runtime `ctx.inject`) | `packages/mpd-bundle-plugin/src/settings-card.js` | SOFT-OPTIONAL | degrade |
| D6 | `@nanmicoder/dsh-agent-teams` `require` in the combined client | `scripts/build-mpd-client.mjs`; embedded verbatim adopted client self-registers the id | SELF (same file) | F4 class if the embedding breaks |

### 6.E manifests (`package.json`)

| # | Reference | Verdict | Note |
|---|---|---|---|
| E1 | `dependencies`: **absent entirely** | — | the defect: no runtime dependency is declared at all |
| E2 | `optionalDependencies`: `@ast-grep/cli`, `@colbymchenry/codegraph`, `@code-yeongyu/comment-checker` | TOOLCHAIN-OPTIONAL | consumed by the ast-grep/codegraph MCP launch scripts and two plugin rows; absence degrades — unchanged by this fix |
| E3 | `devDependencies`: `@typescript/native-preview`, `bun-types` | not runtime | — |
| E4 | `packages/mpd-agent-teams-plugin/_deps/{cordis,dsh-agent,dsh-llm,dsh-scope,dsh-session,dsh-subagent,dsh-timeout,dsh-tools,schemastery}` | SELF | vendored closure; no npm resolution at runtime |

### 6.F non-package runtimes

| # | Reference | Verdict | Note |
|---|---|---|---|
| F1 | `node` (MCP rows spawn `command: node`) | HOST | the harness runs on Node ≥20 |
| F2 | `wave-mcp` / `traceweave-mcp` Python servers | excluded by design | their rows are commented out and documented as opt-in (`cordis.patch.yml` wave rows) |

---

## 7. Hand-off notes for the implementation / verification / review tasks

1. The ONE actionable package is `dsh-better-sidebar` (pin it; the ecosystem’s current version is
   `0.19.0-alpha.1`, V1). Do not invent a second one from prose — §6 is the reference set.
2. Deliver BOTH halves: a declaration in the manifest (and in `pack-mpd.mjs#writeBundleManifest`, AC-8) **and** a
   real loader row in the bundle patch — neither alone produces a working GUI (§5.4).
3. The row needs TWO guards: non-web plane (AC-6, use §5.5’s evidence-backed predicate) and duplicate mount
   (AC-5, §5.3 — order-independent or the wave must surface a blocking finding).
4. Proof is a MOUNTING boot, never `--dump-config` (AGENTS.md §4). The three fatal signatures are F1–F3; assert
   them absent explicitly.
5. Evidence for a live boot must be sandboxed on ALL THREE axes — `DSH_HOME`, `HOME` and the workspace cwd
   (AGENTS.md §7) — because the workspace state under `.mpd/**` is what the plugin rows write.
6. Do not broaden the class by declaring host packages; `@deepseek-ai/*` stays out of `dependencies` (V7, §2).
7. If the implementation touches `skills/**` at all, the single-writer + single-re-pin rule applies (AC-10);
   prefer a QA case that needs no skill edit.

## 8. Out of scope (non-goals)

- Re-architecting how `dsh plugin add` reconciles profile bundles (harness behaviour, `[CM-1]`).
- Making non-web compositions gain a sidebar (they must merely stay green).
- Changing the `_deps` vendoring of the adopted agent-teams plugin.
- Any change to `skills/**` corpus content, unless a QA case genuinely requires it (then AC-10’s rule applies).
