# t6 — Review: the guarded sidebar mount + the dependency declaration

**Task:** `t6` (team `mpd-install-deps`, member **Reviewer**), attempt 1, `attempt_id`
`e77d0fee-732a-4e7e-80ae-8c750c240e26`.
**Kind:** review round 1. **Reviewed work:** t2 (implementation, Senior Engineer) and t4 (docs,
Junior Engineer) — judged from the FILES IN THE TREE, never from the task descriptions.
**Verdict: `needs_revision`** — one high and one medium finding (R1, R2); three low findings
(R3–R5) and one pre-existing observation (R6). Every other checked property PASSES (see §3).
**No fix was applied by this lane**; `checks.mjs` is read-only against the repository and the
only writes are inside `evidence/install-deps/review/**`.

## 0. The revision actually reviewed (sha256 + the UTC instant read)

| path | sha256 | read at (UTC) |
|---|---|---|
| `packages/mpd-bundle/cordis.patch.yml` | `6ab4df7eb2e4dbe515406044ef580c698f004b355f4ea0bde4d2e327baeb711a` | 2026-09-20T03:40:07Z → 03:45:34Z |
| `package.json` | `64e9797767e086db02428946fa9c4764786695f493fe9c14352b065a099a634f` | same |
| `scripts/pack-mpd.mjs` | `52b4245dc46e8f3f1de87b7f16ac0adda11370fb5606a420d9ea97b7836cdb07` | same |
| `scripts/install-profile.mjs` | `98b29e101bd0e7d146311e9f191905389d0fd0c645275044950bde232220b94a` | same |
| `README.md` | `a32d515e6dfa7eab8c948938b63ddb27aedcb3f05c175ee47bd66e975a7a8d3c` | same |
| `README.zh-CN.md` | `061801c903560a4357c4877f58fa51a7a87c9a08d2175579b19476585e2fd8b0` | same |
| `docs/design.md` | `3f9499e2bbfb964ccf25a8c0d21cd41f66b663879ee2f1e46404167db2d206e9` | 2026-09-20T03:45:34Z |
| `docs/user-guide.md` | `897046cf22d84cb42cf04d76cda6cbafa74f2ad8cc15fad13820d92b674ec5ad` | 2026-09-20T03:45:34Z |

**Hash sandwich:** the first six hashes were read at `03:40:07Z` and re-read at `03:45:34Z`
unchanged (`hashes.start.txt` / `hashes.end.txt`), so the revision is SETTLED across this review.
The guard's own bytes were read from the patch line and compared byte-for-byte with
`scripts/install-profile.mjs#SIDEBAR_GUARD` and with the packed artifact
(`dist/mpd-package/cordis.patch.yml`): all three bodies are 2493 bytes and IDENTICAL
(`checks.out.txt`).

**Harness under review** (`dsh` 0.1.5-rc.1 CLI, files read at 03:45:34Z):
`lib/profile-boot-Dk-7KqJc.js` `8b79b5c7…`, `@deepseek-ai/dsh-app-boot/lib/index.js` `d8fdfe41…`,
`@deepseek-ai/cordis-plugin-loader/lib/index.js` `95f3651b…`,
`@deepseek-ai/cordis-plugin-include/lib/index.js` `2194500a…`,
`@deepseek-ai/dsh-host-webserver/lib/index.js` `040500dc…`,
`@deepseek-ai/dsh-web-app/cordis.patch.yml` `1c0209b8…`.

## 1. The guard under review (quoted decisions, not paraphrased)

The row `mpd-better-sidebar` (`name: dsh-better-sidebar`) carries one `disabled: !!js` expression
whose clauses are, in order: (1) `fs.existsSync(<profileDir>/node_modules/dsh-better-sidebar)`;
(2) `bundles.indexOf('dsh-better-sidebar') >= 0`; (3) for every name in
`<profileDir>/package.json` → `dsh.profile.bundles`, read that layer's `dsh.bundle.patch` text and
disable when it contains `dsh-better-sidebar` and does NOT contain `mpd-better-sidebar`;
(4) `[...ctx.loader.entries()].some(e => e.options && e.options.name ===
'@deepseek-ai/dsh-host-webserver' && e.options.disabled !== true)` OR
`bundles.indexOf('@deepseek-ai/dsh-web-app') >= 0`; else `return false` (mount). One outer
`try/catch` returns `true` on any throw. Full extracted text: `guard.raw.txt`.

## 2. Findings

| id | severity | file + symbol | problem | required fix |
|---|---|---|---|---|
| **R1** | **high** | `packages/mpd-bundle/cordis.patch.yml` → `mpd-better-sidebar` row, guard clause 3 (`for (const bundle of bundles)` reading `dsh.bundle.patch`) | The duplicate-mount back-off only reads layers declared in `<profile>/package.json#dsh.profile.bundles`. The harness applies MORE patch layers than that: `profile-boot-Dk-7KqJc.js#allPatches` composes `[...bundlePatches, ...profile.patches (<profileDir>/cordis.patch.yml), ...homePatches ($DSH_HOME/cordis.patch.yml), ...overlays (--patch)]`. A sidebar row in any of those three layers, with an id other than `mpd-better-sidebar`, is invisible: I evaluated the SHIPPED guard text against a real-fs composition with the package present, no bundle layer mounting it and the web plane present → `false` (mount) — `checks.out.txt` probe `F1`. Two mounts then both call `ctx.webServer.register` for the sidebar's route; `dsh-host-webserver#register` throws `webserver: duplicate <kind> route "<path>"` — the exact fatal mode the wave's own requirements name **F3** ("TWO entries mounting the same plugin", `duplicate prefix route`, two `/sidebar/api` registrations). The row's own comment says clause 3 covers "any OTHER layer", so the code under-covers its stated contract. | Extend the same fs scan to the two files the guard can already read: `<profileDir>/cordis.patch.yml` and `$DSH_HOME/cordis.patch.yml` (disable on a `dsh-better-sidebar` mention there, exactly like clause 3); for `--patch` overlays either reach them through the loader/cmdline scope or state the bound in the same commit. The MINIMAL acceptable alternative is R2's narrowing, but then the row comment must be narrowed with it. |
| **R2** | medium | `README.md` §"The sidebar host — 1 inserted row" + `README.zh-CN.md` (只挂载一次) + `docs/design.md` §4 table row `mpd-better-sidebar` | The user-facing sentence "It mounts **once**: the row disables itself where another layer already mounts the package" (and design's "where another layer's patch already names the package") is broader than the shipped guard: the last three patch layers of every composition are not consulted (R1). AC-9 ("docs stay truthful, bilingually") therefore fails on this sentence even though every other doc claim I checked holds. | Narrow both languages' sentences to what the guard proves — "another **declared bundle layer**'s patch (`dsh.profile.bundles`)" — and name the file the guard reads; or land R1 and keep the sentence as written. |
| **R3** | low (latent) | `packages/mpd-bundle/cordis.patch.yml` guard clause 4 (`hasWebEntry` / `hasWebLayer`) | `e.options.disabled !== true` is the recursion-safe RAW read, but `cordis-plugin-loader#Entry.disabledOf` keeps a `!!js` expression as its `{__jsExpr}` marker, so a webserver row disabled by an expression still counts as PRESENT; and the OR with `bundles.includes('@deepseek-ai/dsh-web-app')` makes the entry test irrelevant whenever the layer is declared. Measured: the probe "web-app layer declared, webserver entry DISABLED by `!!js`" still returns `false` (mount). Latent today — `@deepseek-ai/dsh-web-app/cordis.patch.yml` inserts the `webserver` row with **no** `disabled` key — but a composition that declares the layer and disables that row would mount the sidebar with no `webServer` service → the fatal pending-entry mode (requirements F2). | Treat a `disabled` value carrying the `__jsExpr` marker as "not proven present" in `hasWebEntry` (fail-closed), keep the raw read (the recursion reason stands), and write the bound into the guard comment. |
| **R4** | low | `packages/mpd-bundle/cordis.patch.yml` guard clause 3 (the `text.indexOf('mpd-better-sidebar') < 0` self-exclusion) | Self-exclusion is a whole-FILE substring test, not layer identity: a FOREIGN declared layer whose patch mounts the package **and** happens to mention `mpd-better-sidebar` anywhere (a comment, a mirrored note) is skipped by the exclusion. Measured: probe `F4` returns `false` (mount) with the web plane present while the foreign layer's own patch inserts `web-ui-better-sidebar` → double mount again. The author's bound #3 (`implementation/README.md` §6) covers only "mounted from code", not this. | Exclude the OWN layer by identity (skip the bundle whose resolved patch path is this file / whose package dir is the mpd bundle), or match a row (`- id: …` + `name: 'dsh-better-sidebar'`) instead of the bare substring. |
| **R5** | low (evidence precision) | `evidence/install-deps/implementation/README.md` §2 ("both halves measured"); `README.md` §"Install from a packed artifact" ("pnpm installs the declared dependency") | No pnpm run exists in the reviewed evidence: all six compositions use the hand-written profile recipe in that file's §4, so only the `healProfileModuleFallback` half is MEASURED; the "pnpm does NOT link a bundle's transitive deps into the profile root" half (and the packed-install sentence) are structural claims — true per `AGENTS.md` §1/§12, but not measured in that directory. Likewise AC-2's "REAL `dsh plugin add`, **not** a hand-made sandbox" was not satisfied by any artifact of the reviewed revision: the QA case states the sandbox cannot run it (`qa-case/…/result.json#installRecipe.why`). The concurrent verification lane's real install (`evidence/install-deps/verification/20260920T034229Z/real-install/plugin-add.log`, exit 0 at 03:42:36Z, pnpm v11.23.0) was still running at 03:45Z with no `result.json`. | Label each half with its evidence class (measured vs structural), and cite the verification lane's real-install result once it lands — that is what satisfies AC-2; the author directory should not carry a "both halves measured" heading without one. |
| **R6** | low, PRE-EXISTING (no fix required by this change) | `scripts/install-profile.mjs#buildPlan` + `#SIDEBAR_GUARD`; `cordis-plugin-include#applyEntryPatches` | The legacy installer mirrors the row with the SAME id (`mpd-better-sidebar`) that the bundle patch inserts, and `applyEntryPatches` pushes inserts with no duplicate-id check. A profile carrying BOTH the legacy home patch and the bundle layer therefore has two entries with one id (the duplicate-id boot failure `AGENTS.md` §6 warns about). This holds for all 26 mirrored ids, so it is not introduced by this change — recorded so nobody reads "the guard text is byte-identical" as a safety property of the two-writer pair. | None in this wave; if the legacy installer is retired, drop its row set rather than mirroring it. |

## 3. What PASSES (checked, with the evidence that decided it)

**3.1 The three named fatal modes, against the guard's actual text and measured behaviour**

| mode (requirements §4) | guard behaviour | evidence |
|---|---|---|
| F1 unresolvable entry (`assertEntriesLoaded`) | clause 1 disables whenever `<profileDir>/node_modules/dsh-better-sidebar` is absent | clause text (raw read) + author comp5 (`DISABLED - … not resolvable`), QA-case arm `package-absent` (404 on `/sidebar/api`, 0 fatal signatures), my probe (real fs, no package → `true`) |
| F2 pending entry (`assertEntriesActivated`) on a non-web plane | clause 4 disables when neither the webserver entry nor the `@deepseek-ai/dsh-web-app` layer is present | clause text; author comp4 = a REAL dsh-tui boot in tmux (guard line `DISABLED - no web plane in this composition`, 0 pending/failed entries); QA-case TUI arm; my probe (`true`) |
| F3 two mounts (`duplicate prefix route`) | covered for DECLARED BUNDLE LAYERS in both install orders; **not** covered for the profile/home/`--patch` layers (R1) and not for a foreign patch that mentions our id (R4) | author comp2/comp3 (`DISABLED - bundle layer @linxin666/dsh-web-all already mounts it in its own patch`, exactly one `fiber=true`) + my probes (aggregate first / after, and resolvable one level up → `true`); counter-probes `F1`/`F4` → `false` |

Composition search statement (the acceptance asks for it explicitly): **I found no composition among
the SHIPPED stack shapes** (web bundle-only; web + aggregate in either order; dsh-tui; headless
base+web-app tuple; packed artifact) where the guard mounts while a second mount exists or while the
web plane is absent. I DID find compositions outside that set where it mounts while a second mount
exists: any of the three non-bundle patch layers mounting the package (R1), and a foreign layer whose
patch mentions our row id (R4). Both are user/third-party-authored, neither is a shipped template.

**3.2 Recursion / throw safety.** The shipped text reads `e.options.disabled` — the RAW node — and
never `e.disabled`, so it does not re-enter another row's `!!js` expression
(`Entry#disabledOf` is what re-evaluates; the loader comment "The raw node stays in the options"
matches). `Entry#refresh` (`if (this.fiber) return; if (this.disabled) return; …`) confirms an
ENABLED decision is permanent once a fiber exists — measured in the author's comp1 boot log, where
the guard's first look is forward-blind (`SIDEBAR-PROBE … fiber=false`, 180 entries) and the same
row is `fiber=true` at 182 entries. Every throw path returns `true`: the outer `catch` wraps the
whole body; `say`, `readJson` and `readText` are individually wrapped. Measured live: absent
`ctx.loader` → `DISABLED - guard threw Cannot read properties of undefined (reading 'entries')` →
`true`; absent `baseUrl` → `DISABLED - guard threw baseUrl is not defined` → `true`
(`checks.out.txt`). One log line per distinct decision via the `globalThis.__mpdSidebarGuardSeen`
dedup — no log storm.

**3.3 The declaration (both halves).** `package.json` gains exactly the `dependencies` arm
(`dsh-better-sidebar: 0.19.0-alpha.1`); `scripts/pack-mpd.mjs#writeManifest` emits the same arm and
the packed `dist/mpd-package/package.json` is BYTE-EQUAL to it (measured). The corrected comment is
accurate in both halves against the harness source: `healProfileModuleFallback` does symlink the
dependency closure of every non-installation bundle layer into `<profile>/node_modules`
(`dsh-app-boot#healProfileModuleFallback`, order measured by the captain's probes: heal runs before
the loader). The pnpm half is structural (R5). The packer's quote-aware `!!js` rewrite
(`#decouplePatch`, `(?!['"])`) is confirmed on the artifact: the packed row's guard body is the same
2493 bytes as the source (the pre-fix form would have made the row a truthy string literal).

**3.4 Counted claims.** Patch insert-id set = 26 ids (my parse) = `node scripts/verify-rows-parity.mjs`
exit 0 = `node scripts/install-profile.mjs --self-test` exit 0 (guard byte-parity asserted by the test
itself). Both gates were run by this lane inside the 03:40:07Z–03:45:34Z window above. `README.md`
says 28 `- id:` = 26 inserts + 2 id-targets and groups 18+4+1+1+2 = 26; `README.zh-CN.md` says the
same (28/26); the packed patch carries the same 26 ids. No count drifted.

**3.5 Docs.** Checkout prerequisite (`bun install`, or `bun add … --ignore-scripts`) and the Web-GUI
sections match the shipped behaviour; the two GUI surfaces are sidebar-only with no floater fallback
(`packages/mpd-bundle-plugin`, `docs/tui.md` carries no stale floater claim any more). The only
overstatement found is R2.

**3.6 Evidence quality.** The author directory is labelled AUTHOR-RUN / ADVISORY with per-artifact
`measured_at_utc` and a hash sandwich; the QA case separates a "COMPOSITION ONLY (`--dump-config`,
never load evidence)" section from a "REAL mounting boot" section per arm, and its result.json says
so in-band; the captain's cross-check is a separate hand-built sandbox with its own boot + HTTP
fetches; the boot logs carry the loader-side witness (`[mpd-better-sidebar] mount guard: …` and
`SIDEBAR-PROBE {…fiber=…}`) rather than only prose. No artifact I read cites a `--dump-config` output
as load evidence.

## 4. Bounds of this review

1. I did not run a mounting boot (that is t5's lane; its run was in flight while I reviewed). My
   runtime-side evidence is (a) the harness source, (b) the author/QA/captain boot artifacts, and
   (c) `checks.mjs`, which evaluates the SHIPPED guard text verbatim against real filesystem
   compositions. `checks.mjs` never writes outside `evidence/install-deps/review/**`.
2. R1/R4 are demonstrated on synthetic compositions built to be the shape the harness composes
   (bundles list + layer patches + entries); I did not boot the overlay case, because the overlay
   path is fully determined by `profile-boot#allPatches` (read) and the second mount's failure is
   fully determined by `dsh-host-webserver#register` (read).
3. The `--patch` overlay half of R1 is not reachable by a declaration scan of files; it needs either
   a loader/cmdline seam or a documented bound. That choice is the captain's, not mine.
4. The concurrent verification lane may close R5 by landing its real-install artifact; nothing in
   R1–R4 depends on it.

## 5. Review-lane artifacts

| file | what it is |
|---|---|
| `RESULT.md` | this review |
| `guard.raw.txt` | the `mpd-better-sidebar` row's `disabled: !!js` scalar, extracted byte-exact |
| `checks.mjs` | read-only checks: patch ≡ installer ≡ packed guard bytes; packed dependencies arm; insert-id equality; 12 synthetic composition probes over the shipped guard text |
| `checks.out.txt` | the run's output (each probe names its composition and the guard's decision) |
| `hashes.start.txt` / `hashes.end.txt` | the sandwich (03:40:07Z / 03:45:34Z, identical) |
