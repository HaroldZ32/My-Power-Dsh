# The independence contract

**English** | [中文](./independence.zh-CN.md)

This page is the written form of acceptance criterion **A1.3** (`docs/plan-0.1.7-adaptation.md`,
wave `mpd-seam-convergence`): the parts of this bundle are **independent packages**, and the
couplings that remain between them are **counted**, not assumed away. It states what is measured,
by what instrument, and — in the last section — what it deliberately does **not** claim.

The contract has five clauses, and each one has an executable witness:

| Clause | Witness |
|---|---|
| A package is its own unit: its own source tree, its own build entry, its own `dist/` | `node scripts/verify-dist-fresh.ts` rebuilds every entry and compares bytes |
| A package reaches the harness only through the adapter's seam-name vocabulary | `packages/mpd-dsh-adapter-plugin/src/index.ts` exports it; the rows import it |
| No package patches another package's objects at runtime | the coupling gate's `global-write` rule |
| Cross-package edges are source-level imports, inlined per artifact | the coupling gate's `cross-package-import` rule + `verify-dist-fresh` |
| The residual couplings are a frozen, identity-keyed, shrinking set | `packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` |

## 1. What is measured, and by what

### 1.1 One package, one unit

Every directory under `packages/` is a self-contained unit: a `src/` tree with one or more entries,
its own `dist/` artifacts, and a manifest **when it needs one**. Measured 2026-10-02: **30 package
directories, 26 of them carrying their own `package.json`.**

The four that carry none are not exceptions to independence, they are packages whose metadata lives
elsewhere: `mpd-codegraph-plugin` is mounted by its own row through the bundle's `exports` map, the
two MCP servers (`mpd-mcp-codegraph`, `mpd-mcp-shared`) are launched through their own
`launch.ts`, and `mpd-tui-adapter-plugin` is being created by this same wave. **No package in this
tree declares another package of this tree as a dependency** — not in `dependencies`, not in
`devDependencies`, not in `peerDependencies`, not in `optionalDependencies`. Measured: zero
`@mpd-dsh/*` specifiers across all 26 manifests. Every cross-package edge in this repository is a
**source-level relative import**, which is what the next two sections are about.

### 1.2 One package, one row

A package becomes a capability by being named as a row in one of the two shipped patch layers —
`cordis.patch.yml` (the host plane) or `presets/mpd.patch.yml` (the preset plane) — and never by
editing the harness, by writing a home directory by hand, or by pushing a row into another layer
(AGENTS.md §8). Measured 2026-10-02: **23 distinct `packages/*/dist/*.js` row targets** in
`cordis.patch.yml`. A row addresses a path inside the package; it never reaches into another
package's internals to reconfigure it.

## 2. No runtime override, no runtime handoff

The contract forbids the shape that makes "independent" untrue even while every `import` looks
clean: one package **reaching into another through the process**. That shape is a write to a shared
global. The gate therefore owns a `global-write` rule, and the measurement is:

* **`packages/*/src` contains ZERO writes to a process global.** Measured 2026-10-02: the only
  `globalThis` occurrences in the whole band are three lines in `mpd-hashline-plugin`'s vendored
  xxhash — two documentation sentences and one **read** (`const runtime = globalThis as typeof
  globalThis & { Bun?: BunHashRuntime }`), the plugin's runtime probe for the native fast path.
* **The only globals the bundle writes at all live in shipped patch expressions**, i.e. in
  `cordis.patch.yml` guards that the loader evaluates, not in any package's module body: **two
  warn-once registries, in three expressions** — `globalThis.__mpdSidebarGuardSeen` (the
  `mpd-better-sidebar` mount guard) and `globalThis.__mpdTuiPlaneGuard` (the two TUI-plane team
  guards). Each is the guard's own "have I already said this?" flag, keyed on its own message. It is
  process-wide **state about a warning**, never a channel between packages: nothing reads those keys
  to obtain another package's objects. One test seeds `__mpdSidebarGuardSeen`
  (`packages/mpd-bundle-plugin/test/sidebar-guard-profile-dir.test.ts`); no other consumer exists.

The second forbidden shape is a row **providing** a service id the harness owns — the mechanism by
which a bundle would replace a host component rather than add to it. The gate's
`harness-service-provide` rule reads `ctx.provide("<name>", …)` against the harness seam-name
vocabulary, and the measurement is: **the band provides only MPD-owned services** —
`mpdDsh`, `mpdRoles`, `mpdConfig`, `mpdExtensions`, `mpdWorkmate` — and **zero harness seam ids**.

## 3. Cross-package imports are source-level, and the build inlines them

Every cross-package edge in this repository is written as a **relative specifier into the sibling's
`src/` tree**, for example `../../mpd-dsh-adapter-plugin/src/index`. Measured 2026-10-02: **zero
imports of a sibling's `dist/`**, and zero sibling `package.json` dependencies (§1.1).

That has three consequences, and all three are checkable:

1. **There is no shared module identity.** `bun build` resolves the specifier at build time and
   **inlines the sibling's module body** into the consumer's own `dist/index.js` (as any bundler
   does for a source-level import). Measured: the adapter's module body is present in **18
   distinct `dist/index.js` artifacts**; `function dshSeamInject` and the adapter's helpers appear
   verbatim inside e.g. `packages/mpd-boulder-plugin/dist/index.js`. Two rows that both "import the
   adapter" do not share an object graph — they each own a copy.
2. **An adapter edit changes the artifacts of the rows that consume it**, and only theirs: `bun
   build` tree-shakes an export a consumer never references. Measured while single-sourcing the
   seam names: after exporting new constants from the adapter, a rebuild of a **non-consuming**
   consumer (`mpd-codegraph-plugin`, `mpd-bundle-plugin`) produced a bundle with **zero**
   occurrences of the new names.
3. **The binder is `node scripts/verify-dist-fresh.ts`.** It rebuilds every entry from the repo
   root and compares the artifact byte-for-byte, which is what makes "did you rebuild what you
   invalidated?" a checkable question instead of a habit. It is also the honest arbiter when an
   artifact changes for a reason unrelated to content. Measured 2026-10-02, six artefacts reported
   `STALE` and NONE of them was caused by a content change from this wave's adapter edit: four
   (`mpd-bundle-plugin`, `mpd-codegraph-plugin`, `mpd-qa-roles-probe`, `mpd-team-watchdog-plugin`)
   carried only bun's own codegen signature — the recorded toolchain is **bun@1.4.0** and this
   checkout runs **bun 1.4.2**, which renames colliding bindings differently (`config2` → `config`)
   and emits a different module-helper preamble — while the other two (`mpd-tui-plugin`,
   `mpd-team-core-plugin`) are rows other lanes are editing in place. That is exactly why the gate
   prints the toolchain it used.

## 4. The sanctioned coupling classes

Four kinds of coupling are **allowed**; they are called out here so "independent" is never read as
"no imports", and each is enforced in the gate rather than trusted:

1. **A row imports the adapter.** `packages/mpd-dsh-adapter-plugin` is the ONE code-level contact
   surface with the harness (AGENTS.md §6); a package that starts importing an adapter is being made
   *more* independent, so adapter-targeted imports are **exempt from the frozen inventory and
   allowed to grow**. The exemption is an allowlist of package NAMES, never a `*-adapter-plugin`
   suffix rule — a suffix rule would let any package rename itself into the exemption. Measured
   2026-10-02: **47 such imports.**
2. **A row imports the adapter's seam-name vocabulary.** The cordis `inject` arrays no longer spell
   harness service ids as free literals. `DSH_SEAM_TOOLS`, `DSH_SEAM_SUBAGENTS`, `DSH_SEAM_SKILLS`,
   `DSH_SEAM_AGENTS`, `DSH_SEAM_COMMANDS`, `DSH_SEAM_SESSIONS`, `DSH_SEAM_WEB_SERVER`,
   `DSH_SEAM_WEB_RUNTIME` and `DSH_SEAM_AGENT_PRESETS` are exported from the adapter, and a row
   builds its array with `dshSeamInject(...)`, which returns the same strings. A harness rename now
   lands in **one file**. The runtime values are verified unchanged by importing each rebuilt
   `dist/index.js` and printing its `inject`.
3. **A shared pure module is imported instead of forked.** `mpd-bootstrap-plugin` imports
   `mpd-ext-plugin`'s skill-frontmatter subset, `mpd-roster-provider-plugin` imports
   `mpd-config-plugin`'s slot table, `mpd-ext-plugin` imports `mpd-roles-plugin`'s roster data. In
   each case ONE declaration is the contract; a second copy is how two spellings drift apart.
4. **Type-only imports across packages.** A `import type { TeamRecord } from
   "../../mpd-team-core-plugin/src/team-store.js"` is **erased by the build** and creates no runtime
   edge — but it is still a source-level dependency on a sibling's internal module path, so it is
   frozen like any other.

## 5. The pinned debt: the retired body's vendored `schemastery`

The bundle adopted one third-party plugin outright (the `agent-teams` body), which is now
**RETIRED from the composition** but still present at `packages/mpd-agent-teams-plugin`. Its tree
carries a vendored dependency, and live packages import **that copy**:

* the tree: `packages/mpd-agent-teams-plugin/_deps/schemastery` — **6 files, 65,846 bytes of
  content** (92 KB as `du` reports it), including `lib/index.ts`, `lib/index.cts`, the declaration
  map and `LICENSE`;
* **four live files** import it: `mpd-config-plugin/src/index.ts`,
  `mpd-config-plugin/src/settings-schema.ts`, `mpd-team-watchdog-plugin/src/index.ts`,
  `mpd-tui-plugin/src/index.ts`;
* the body's own `lib/index.ts` imports the same tree through a different specifier
  (`../_deps/schemastery/lib/index.ts`).

This is **PINNED DEBT, not an oversight**. Moving the tree out of the retired body would duplicate a
third-party library while the body still needs it, so the debt is recorded here with a **named
follow-up**: when the body is deleted, its `_deps/schemastery` tree moves to a first-class home and
the four importers are re-pointed in the same commit. The gate freezes the four importers so the
follow-up cannot grow a fifth.

## 6. The counted inventory: identity-keyed, frozen, and it can only shrink

`packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` is the enforcement.
It scans `packages/mpd-<name>/src/**/*.ts` (comments stripped, line structure preserved) and reports
three classes: cross-package imports, global writes, harness-service provides.

* **Identity, never position.** An entry is `file :: normalized line text`. A line number would rot
  with the next edit above it (T-55), so it is not part of the key.
* **Frozen means it can only shrink.** A coupling with no entry fails as **NEW**; an entry that
  matches nothing fails as **STALE**. Deleting an entry is therefore how a coupling is retired —
  deliberately, in the commit that retired it — and the set can never drift into a fiction.
* **The frozen set is 14 entries**, plus 47 exempt adapter imports, measured 2026-10-02.
* **Both directions are proven.** `--self-test` seeds a fixture tree with every shape the rules must
  accept or reject (14 arms), and the real band is scanned with the real inventory: red on a seeded
  violation, green on the tree as it stands.
* **The blind spots are declared, never silent** — the discipline
  `packages/mpd-dsh-adapter-plugin/test/no-direct-team-access.test.ts` established: non-`.ts` files
  under a scanned `src/` are printed as NOT COVERED; a `ctx.provide(...)` whose first argument is a
  constant is printed as NOT STATICALLY READABLE; and the retired body's `lib/` tree is printed as
  DECLARED OUT OF BAND with its live file count (55 files), so the exclusion is measured rather than
  assumed.

Regenerate the inventory with `bun packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts --print-inventory`
(read-only) after a deliberate, reviewed change.

## 7. What this contract does not claim

* **It does not claim there are no couplings.** It claims they are enumerated, counted and
  shrinking.
* **It does not cover the TUI plane's web-service couplings.** `betterSidebar`, `shortcuts`,
  `locale`, `configForms` and `sidebarRightTabs` are a separate, separately frozen inventory with a
  named follow-up adapter (plan A2.3); the DSH-TUI plane's own convergence is plan A2.2.
* **It does not convert the QA probe.** `packages/mpd-qa-roles-probe/src/index.ts` still spells
  `["agentPresets", "tools"]` literally. It is a QA-only probe, owned by no lane of this wave, and
  it is left untouched and named here rather than silently left behind.
* **It is a static gate.** A coupling routed through a variable, a re-export barrel, or a
  dynamically computed specifier is not seen by a line scan; the unreadable-provide bucket names the
  part of that bound the gate can actually observe.
