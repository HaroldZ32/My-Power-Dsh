<!-- docs-parity: exempt prior-phase report (the TUI edition delivery report) — named in the AGENTS.md Language-policy enumeration of exempt prior-phase reports (captain ruling on T60-F1) -->
> **Why this file is committed here.** The working copies of this contract and this report live under
> `.mpd/`, which is **gitignored** — nothing under `.mpd/` is ever committed. This pair is the
> repository's durable, auditable record, written on the captain's direct instruction as part of the t14
> integration pass and refreshed four times afterwards (AC-15 → `passed` with the R6 evidence; then the
> t23 disposition, the t29-predicate residual and the landed `VENDOR_LOCK` re-pin + green gate sweep; then
> the settings-bridge wave of Amendment 3 / §9; then the documentation closure of Amendment 4 / §10). Both
> are process records and are exempt from the bilingual-document rule (AGENTS.md §3). The evidence they
> cite is committed under `evidence/tui/`.

# DSH-TUI edition — delivery report (t14)

**What this is.** `@mpd-dsh/mpd` (this bundle, v0.9.1) now has a DSH-TUI edition: a TUI-native plugin
package, a bundle-level admission manifest, a dsh-tui composition in which the bundle mounts as the
third patch layer and TUI sessions default to the `mpd` preset, bilingual documentation, and five
first-class QA lanes that prove the result against the real host. This report states exactly what was
verified, what is NOT claimed, and what remains — nothing here is a projection.

> **Amendment 1 (captain-directed, after t14's terminal completion).** AC-15 moved `not-claimed` →
> `passed`: the captain ran R6 itself on the current revision (`bun skills/dsh-qa/scripts/bundle-lifecycle.mjs`
> → `[bundle-lifecycle] PASS`, EXIT=0) and the evidence landed at
> `evidence/dsh-qa/bundle-lifecycle/2026-09-15T07-24-59.974Z/` (console copy
> `evidence/tui/delivery/20260915T072355Z/raw/web-profile-boot.log`). The run writes no product artifact,
> so every pin in §2 is unmoved.
>
> **Amendment 2 (captain-directed, t31 follow-up).** Three additions, nothing else changed: the **t23
> disposition** in §4/§8 (one unsatisfiable-as-written criterion, host-side cause, no repair owed), the
> **t29-predicate residual** in §6 (an under-specified checker false negative; the mirror is byte-exact
> and t27's checker is 28/28), and the **landed `VENDOR_LOCK` re-pin + green gate sweep** in §2/§3/§6.

## 1. Install

```sh
dsh plugin --profile dsh-tui add /root/dshProj/my-power-dsh
```

One command is the whole install: the repo root IS the bundle package (`dsh.bundle.patch` → the bundle
patch; the `mpd-tui` row is composed from it), the skills corpus and the `mpd` preset are SERVED from
the bundle by reference, and a packed release artifact is produced by `node scripts/pack-mpd.mjs` when
publishing (`dsh plugin --profile dsh-tui add dist/mpd-package`). Measured single-install evidence:
`evidence/tui/live/20260915T063140Z/raw/install-fresh-root.sh` (exit 0 on a fresh root) and the triple
`dsh.profile.bundles = ["@deepseek-ai/dsh-base","@deepseek-harness-tui/dsh-tui","@mpd-dsh/mpd"]` in
every mount result.

## 2. Revision pins (sampled at write time)

| Artifact | sha256 / value |
|---|---|
| `dsh-plugin.json` | `84ed4a5d5aac3fb07949f0f62bb7e7afdfa1e96de2c19de02974381eeb1201c9` (frozen by t24) |
| `packages/mpd-tui-plugin/dist/index.js` | `5dce2563fd0e3b20afede061297b9bfc9856593703974fac44f8642830b85e6f` — **98883 bytes**, mtime `2026-09-15T06:23:20Z` |
| `docs/tui.md` | `0d899a4d308fdf17…` (advanced by t29's §6.4) |
| `docs/tui.zh-CN.md` | `c1c0dc39ba6485af…` (advanced by the post-t30 §6.4 mirror) |
| `packages/mpd-bundle/cordis.patch.yml` | `3866dc11b52aa3ae…` |
| `presets/mpd/agent.cordis.yml` | `0be8781f1570e9ca…` |
| `dsh-distribution.json` | `a0177b0b2a53e053…` |
| skills corpus | `fileCount 307`, treeSha `ba0c3922889614225dfd3c30b97ed369ee9b5b0ae374635a5d52d561123816ef` — **re-pinned in `VENDOR_LOCK.json`** (verify-vendor: `asset OK: skills 307 files`) |

**Digest discipline (binding for anything that quotes a hash).** A digest is the artifact's identity;
a byte size is derived information that must be re-measured (`stat -c %s`) at write time; and a digest
that changed mid-run invalidates the result. The lanes enforce this themselves: every result carries
`revision`/`revisionDelta`/`manifestDigest` plus a `REVISION.json`, and a mid-run change is a named
FAIL. History is kept, never rewritten: `evidence/tui/plugin/20260915T054343Z/CORRECTION.md` (the t4
record was inert in a real boot), `evidence/tui/plugin/20260915T060934Z/result.json` `sizeCorrection`
(the stale 98788 → measured 98883), `evidence/tui/live/20260915T063140Z/CORRECTION-renderer-causation.md`
(the renderer cause, retracted and replaced), and the manifest chain
`evidence/tui/composition/20260915T053445Z/raw/manifest-digest-chain.json`
(`31587972… → 7701c48c… → 824b74f8… → 84ed4a5d…`).

## 3. Verified lanes (all on the pinned revision above)

| Lane | Command | Result | Evidence |
|---|---|---|---|
| live-mount | `bun skills/dsh-qa/scripts/tui-mount.mjs --sandbox-root <root>` | **PASS** — triple layer in order, `mpd-tui` composed, zero apply-crash signatures, keyed status line + counters, preset `mpd` from the session this run created, isolation clean | `evidence/tui/lanes/2026-09-15T07-05-19.752Z/`, independent `evidence/tui/live/20260915T063140Z/lanes/tui-mount/` |
| panels | `bun skills/dsh-qa/scripts/tui-panels.mjs --sandbox-root <root>` | **6 of 7 surfaces render**; `/settings` renders WITH its unbridged marker; `/mpd` never reaches the model; `tuiRenderers` NOT-CLAIMED (host-side); negative control fails as required | `evidence/tui/lanes/2026-09-15T07-05-58.634Z/`, `evidence/tui/plugin/20260915T060934Z/mount/` (20 captures) |
| admission | `bun skills/dsh-qa/scripts/tui-admission.mjs --sandbox-root <root>` | **PASS** — host-pinned parse → project → profile/registry validation → five-state negotiation; live `/plugins check` = `waiting_authorization`, `forbidden: []`; three negative controls | `evidence/tui/lanes/2026-09-15T07-08-44.315Z/` |
| distribution | `bun skills/dsh-qa/scripts/tui-distribution.mjs --sandbox-root <root>` | **PASS** — the protocol's own CLI ran in-sandbox: install/build/check exit 0, `fullyValidated: true` | `evidence/tui/lanes/2026-09-15T07-07-47.413Z/` |
| spec-conformance | `bun skills/dsh-qa/scripts/tui-spec-conformance.mjs --sandbox-root <root>` | **PASS (7/7 with the pinned parser)** — plus the upgrade where the protocol's own `validate-manifest.mjs` RAN and independently confirmed `waiting_authorization`; the suite runner's blocker is named (a git-submodule fetch) | `evidence/tui/lanes/2026-09-15T07-07-04.875Z/`, `evidence/tui/conformance/20260915T064521Z/` |
| regression | `bun run typecheck`; `bun test packages`; `node scripts/verify-rows-parity.mjs`; `node skills/dsh-qa/scripts/preset-conformance.mjs`; `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` | typecheck 0; 547/0 tests; rows parity 0 at 24 ids; preset-conformance PASS with its negative control; mount boot PASS; **R6 `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` PASS, EXIT=0** (web-profile boot: web triple layer, `boot http:true`, corpus served from the checkout, `noHomeCopy`, `layerDurability ok`, `uninstall ok` with `residue: []`). **Full gate sweep green on the frozen revision:** `node scripts/verify-vendor.mjs` PASS (after the single re-pin: `asset OK: skills 307 files`), **`bun run test:qa` all self-tests passed, exit 0**, `bun run typecheck` exit 0, `bun test packages` 547/0, `install-profile --dry-run` exit 0, R4 rows-parity 24 ids, R5 preset-conformance PASS with its negative control, R6 PASS, R7/R8/R11 ok | `evidence/tui/conformance/20260915T064521Z/`, `evidence/tui/lanes/*/` |

## 4. Acceptance ledger

Every AC of the frozen contract has a final status with its artifact:
**`evidence/tui/ACCEPTANCE-LEDGER.md`**. Summary: **18 passed, 1 failed (AC-4), 1 not-claimed
(AC-20)**. The two non-green rows, stated plainly:

- **AC-4 — failed (6 of 7 surfaces).** `tuiRenderers` does not render. Our registration is accepted
  and our log-only `mpd-tui/board-opened` event is provably persisted, but the host refuses a plugin
  renderer for a session-event type it has already seen: `dsh-adapter/renderers.ts:63` snapshots the
  known-type set at module load and `:148-149` rejects a registration for a type in it. Because a
  bundle-shipped plugin must register its event type before that capture (iron rule 2 — an
  unregistered log-only type makes sessions **unresumable**), the renderer seam and resume safety are
  mutually exclusive **by construction** on dsh-tui 0.10.1, and no change inside
  `packages/mpd-tui-plugin` can fix it. A fresh type added at the profile-patch layer (evaluated after
  the capture) is NOT denied — the discriminator is ORDER, measured across a cross-run with six fresh
  types (`evidence/tui/live/20260915T063140Z/raw/canary/cross.*`). The plugin reports `requested`,
  never `confirmed`, because the host offers no read-back and a refusal returns the same no-op
  disposer as a success. **t23 disposition:** t23 is the honest record of ONE criterion that is
  unsatisfiable as written — six boots produced no transcript row while the session log carried the
  event, and the cause is host-side (ORDER, as measured above). No repair task is owed, so the team
  status line's "t23 failed without a follow-up repair" must not be read as unfinished work: the
  surface is discharged as NOT-CLAIMED item 2 in the ledger / `docs/tui.md` §10 item 10, verified by
  t28 and t30.
- **AC-20 — not-claimed (blocked).** The host's own `verify:plugin-*` gates cannot run here:
  `npm run verify:plugin-spec` in a workspace-local copy dies `ERR_MODULE_NOT_FOUND` for `tsx` (no
  `node_modules`/`lib`/vendor build in the read-only checkout). They validate the HOST's plugin
  subsystem, not this bundle, and are never cited as a verdict on it.

## 5. NOT-CLAIMED

1. **Decision-event seam** — blocked by host admission unreachability (`src/dsh-adapter/plugin-host.ts:415-430` throws,
   `:435-496` token-gated, `:890-914` zero production callers). Ready but not activated; no input /
   rewind / session-switch / compact interception is claimed. The manifest declares its permissions
   only as an optional contract with a written fallback.
2. **`tuiRenderers` transcript row** — see AC-4 above; disclosed to the reader in `docs/tui.md` §10
   item 10 and its Chinese twin.
3. **Identity-gated services** (`storage.local`, `messages.observe`) — deliberately NOT declared in the
   manifest, so they stay closed by construction; `/mpd` runs through the host's unattributed
   `commands` service, which is why the effect ledger names it `undeclared`.
4. **Web-only surfaces** — the agent-teams sidebar, the workmate tab and the bundle floater
   (`dsh.client.platform = web`) have no TUI rendering face; the TUI-native equivalents are not a
   feature-parity claim.
5. **Engine version skew** — the host prints that the installed engine (0.1.5-rc.2) is newer than the
   0.1.5-rc.1 it was validated against; verification ran against the installed engine.
6. **Seam 2 (`tuiPrompt`)** — the host does not provide it.
7. **Host-internal gates** — blocked, as in AC-20.
8. **Any lane that could not run**: the pinned conformance suite runner (a `git submodule` fetch this
   repo's rules forbid inside a QA task) and the packed-install end-to-end boot — the packed tree's
   closure is **import-verified with a falsifying control** and guarded inside `pack` by two loud-FAIL
   checks, but a packed install was never booted (`evidence/tui/packaging/20260915T064658Z/`). (The web
   boot is no longer in this list: R6 ran and passed on the current revision — §3.)

## 6. What remains

**For the captain (commit-time).** The wave's SINGLE `VENDOR_LOCK.json` re-pin has **LANDED** —
`skills` `fileCount 307`, treeSha `ba0c3922889614225dfd3c30b97ed369ee9b5b0ae374635a5d52d561123816ef`
(the tool prints `tree=307/ba0c39228896`), and `node scripts/verify-vendor.mjs` reports
`asset OK: skills 307 files` / PASS — so `bun run test:qa` is **all self-tests passed, exit 0** and the
captain's gate sweep is green on the frozen revision. What remains is the commit itself (branch
`feature/tui-edition`, no version bump). No task edited `VENDOR_LOCK.json`. One captain-directed post-review pass is also recorded: the `docs/tui.zh-CN.md`
§6.4 mirror (t30's medium finding `T30-DOCS-1`) was pasted after t30 from the pre-staged snippet at
`evidence/tui/composition/20260915T071619Z-docs-mpd-command/zh-6.4-snippet.md`, with its own evidence
and assertion at `evidence/tui/composition/20260915T072139Z-zh-mirror-paste/`
(`README.md`, `result.json`, `doc-assertion-captain-zh-mirror.mjs`) — named provenance, no task id,
because it closed a gap whose owner's inScope could not reach the Chinese page.

**Named residual — t29's zh predicate is under-specified (a checker false negative, not a missing
mirror).** Re-running t29's checker
`evidence/tui/composition/20260915T071619Z-docs-mpd-command/doc-assertion-t29.mjs` gives verdict
`failed` at 12/13, sole failure `item3.docs/tui.zh-CN.md`, because its positive branch demands the
service name UNBACKTICKED while both the English section and the pre-staged Chinese snippet write
`` `commands` 服务`` / `` `commands` service`` — so the predicate is false for the payload it
prescribes and cannot witness the mirror. The mirror itself is proven byte-exact (both fenced payloads
are literal substrings of the page) and t27's shipped checker
`evidence/tui/docs/20260915T070743Z/doc-assertion.mjs` is 28/28 green, exit 0. t29's evidence script
was left untouched (a past task's measurement record) and the page was not contorted to satisfy a
broken regex. Evidence: `evidence/tui/composition/20260915T072139Z-zh-mirror-paste/` (`result.json` →
`t29PredicateResidual`, `raw/t27-doc-assertion.json`, `raw/t29-doc-assertion.json`).

**For upstream (recommendation, from t11 — corrected for what our manifest actually requires).**

> dsh-TUI ships the admission machinery but never calls it from the loader.
> `TuiPluginHostRuntime.admitInternal` (src/dsh-adapter/plugin-host.ts:435-496) is gated by a
> module-private Symbol (:783-784), the public `admit()` deliberately throws (:415-430), and the
> exported production accessor `getHostAdmission()` (:904-914) has zero callers in `src/` and in the
> published `lib/`. Consequently every plugin loaded from a DSH profile row is attributed `undeclared`
> in the effect ledger and cannot obtain a Verified Component identity. Proposed minimal change,
> entirely inside dsh-TUI: in the plugin-host row's `apply()` (src/dsh-adapter/plugin-host.ts:970-987)
> register a global `internal/plugin` listener on the composition root — the seam
> `host-access.ts:156` already uses, with `fiberBelongsToComposition` (host-access.ts:263-282) as the
> documented guard — and on each published activation resolve the owning loader entry's PACKAGE root
> (rows live inside a bundle whose per-package directories carry no manifest) and call
> `admission.admit(fiber.ctx, manifestText, { source: path })`, tolerating
> `COMPONENT_ALREADY_ADMITTED` and log-degrading on any failure so a malformed manifest can never break
> the loader. Plugins without a manifest stay `undeclared`, which keeps today's behaviour and the
> ledger honest. No token exposure, no engine change, no new package export.
>
> **The ask is TWO-part; loader wiring alone is not sufficient.** Admission negotiates permissions, and
> the shipped registry defaults only `commands.invoke` to `allow` — `storage.local.read/write`,
> `messages.observe.read` and all four `session.*.intercept` permissions default to `deny` with no
> permission-level `optional` flag. With no grant row, `negotiate()` returns `waiting_authorization`
> and `admitInternal` accepts only `compatible`/`compatible_degraded`, binding no identity. So the
> wiring must be accompanied by a grant path (`extension-grants.json` keyed by component id) or a
> deliberate defaults decision for first-party TUI plugins. Scope note for this delivery: our manifest
> declares ONLY `tui.dsh/v1alpha1#DecisionEvents`; `storage.dsh/v1alpha1#LocalStorage` and
> `messages.dsh/v1alpha1#MessageObserver` are not declared and therefore stay closed by construction
> even after an upstream fix — any sentence implying "the three capabilities" would be false for this
> manifest. KEEP is the right shape for us because a decision permission must be declared STATICALLY
> before the grant test (`decision-guard.ts:269-279`, throw at `:277-278`): omitting it would make the
> seam permanently unreachable rather than merely inactive.
>
> **Second, independent ask (renderer).** `dsh-adapter/renderers.ts:63` freezes
> `BUILTIN_SESSION_EVENT_TYPES = new Set(KNOWN_SESSION_EVENT_TYPES)` at module load and `:148-149`
> refuses any registration for a type in that set. Because a bundle row must register its own log-only
> event type before that capture (to keep sessions resumable), a stable plugin renderer line is
> unattainable for a plugin that ships through the bundle layer, while a plugin added at the
> profile-patch layer (registered after the capture) works. Minimal fix: refuse only the true built-ins
> frozen at process start, or expose a read-back so a plugin can distinguish an accepted registration
> from a refused one.

## 7. Attribution and provenance (this wave produced several no-task-id passes)

- `scripts/pack-mpd.mjs`'s `PLUGIN_PKGS` `mpd-tui-plugin` entry ← **the Lead's t17 repair** (one array
  element, no duplicates, `node --check` ok); Deep Worker's only edit to that file is the `cpAssets()`
  per-package asset table (`themes`/`skills`), now recorded under **t25**, verified by a real
  `node scripts/pack-mpd.mjs` run and the packed-tree import check; the `mpd-tui` mirror row in
  `scripts/install-profile.mjs` ← **t5** (Deep Worker) and `node scripts/verify-rows-parity.mjs` exits
  0 with 24 matching ids. Evidence: `evidence/tui/composition/20260915T062202Z/{attribution.json,PACKAGING.md,raw/*}`.
- `packages/mpd-bundle/cordis.patch.yml` splits as rows → t5/t17, citation block → t19 plus a
  **captain-directed R2-3 comment pass with no task id** (comment-only: of the wave's 82 added / 2
  removed lines, 74 are `#`-prefixed and all 8 non-comment lines belong to the two t5-owned rows).
- Evidence-only passes with no task content, indexed with their named provenance:
  `evidence/tui/composition/20260915T061519Z/` (the host's own preset roster showing our `mpd` marked
  `（默认）`, plus the web-side counts: 201 composed ids, 0 duplicate ids, one `agent-presets` row with
  `default: mpd`), `evidence/tui/composition/20260915T062202Z/` (pack-mpd attribution + gates), and
  `evidence/tui/packaging/20260915T064658Z/{BY-DESIGN-AUDIT.md,raw/by-design-audit.json}` (the five
  by-design items re-derived on the current revision).
- The packed-tree closure class is walked class-wide and has exactly **two** members
  (`mpd-mcp-astgrep/launch.mjs`, `mpd-mcp-codegraph/launch.mjs`, both importing
  `../mpd-mcp-shared/bin-resolve.mjs`, the second also `./daemon-policy.mjs`); `mpd-mcp-gitbash` and
  `mpd-mcp-lsp` ship no launcher and exec `dist/cli.js`, already shipped by `cpDist()`.
- **Review history, unsmoothed**: t28's first round failed prematurely because the auto-created repair
  had been routed to a read-only member and never started; the repair landed and the re-review passed.
  t13's first rounds likewise went `needs_revision` → repaired → retried. That history is why the docs
  and the ledger are correct now.
- Two out-of-wave follow-ups, neither a defect: vendored MCP `dist/` freshness (build tooling; the
  vendor gate pins those files by hash) and the offered renderer-append cleanup.

## 8. Honesty statement

No artifact in this delivery claims a capability, verification level or safety property that its
evidence does not support. Specifically: **AC-4 is failed at 6/7 and disclosed in the docs**;
**AC-20 is not-claimed** (host gates blocked, reason named); the packed install was not booted
end-to-end; the decision-event seam is not activated; the manifest never
declares a capability the code cannot reach; and every digest quoted above was sampled at write time.
Two named residual/disposition items are recorded rather than smoothed: **t23** is the honest record of
ONE unsatisfiable-as-written criterion (the renderer surface, host-side cause, no repair owed, discharged
as NOT-CLAIMED item 2 / `docs/tui.md` §10 item 10), and **t29's zh predicate** is an under-specified
checker false negative — the mirror is byte-exact and t27's shipped checker is 28/28 green, while t29's
own script was left untouched. The captain's gate sweep is green on the frozen revision (verify-vendor
PASS after the single re-pin, `test:qa` all self-tests passed exit 0) — and **red on the current working
tree** because `skills/**` grew again after that re-pin; §9's correction names the three files, the
tool-printed `tree=310/8ec53287296e`, and the re-pin the captain owes. Where an earlier artifact was
wrong (the t4 inertness record, the 98788 size, the first renderer causation), the correction is
appended and the original kept — never rewritten.

> **Amendment 3 (t50, after the settings-bridge wave).** The wave t35–t49 turned the `/settings`
> section's named follow-up into delivered, evidenced behaviour (the `mpd` settings namespace is
> served by `packages/mpd-config-plugin`, whose write-back projects a saved edit into the live
> session workspace's `<workspace>/.mpd/mpd.jsonc`). That moved one artifact pin, closed one residual and
> narrowed one NOT-CLAIMED item, so the bilingual docs, both package README pairs, this report and
> the acceptance ledger carry dated amendments; §2/§3/§4 above and the ledger's rows are the
> TUI-edition records and stay as written. Full block: §9.

## 9. Amendment 3 — the settings-bridge wave (2026-09-15, t50)

**What changed, and where the change is recorded.** The bridge capability itself was built and
verified by t35–t49; this integration pass (t50) is the documentation and record half. Nothing in §1–§8
was rewritten — superseded statements are marked, in place, with the measured replacement.

| Record | Amendment |
|---|---|
| `docs/tui.md` §6.2 (+ `docs/tui.zh-CN.md` mirror) | the "not bridged" limitation text was REPLACED by the bridged behaviour: read-in precedence L0 < L1 < L2 < L3, write-back with comments/key order/trailing commas preserved, the workspace-target rule (`no-live-session` / `ambiguous-multi-root`, no file written, value never lost), `applies: 'restart'`, and the honest evidence level (`Observed`, two real boots) |
| `docs/tui.md` §6.5 (new, + zh mirror) | the duplicate-key table — SET edits the LAST occurrence (the warning names every occurrence line), UNSET removes EVERY occurrence, refusal only for unprovable spans / `ambiguous-intermediate` / unparsable / read-only, with the durable-projection rationale and a citation of `evidence/mpd-bridge/captain/RULING-duplicate-unset-FINAL.md` |
| `docs/tui.md` §3.1 (new, + zh mirror) | the Web GUI settings card — `ctx.slots.inject("settings.plugin.item", …)` registration with `key: "mpd"`, the `settingsScope.bind(...).mutate(...)` write seam, read-only scope behaviour, field parity with the TUI descriptor; evidence level `Observed` for registration + built bytes, with the **browser render explicitly NOT witnessed** and the exact steps to see it |
| `docs/tui.md` §10 item 9 / the §3 settings row / §11.1 (new, + zh mirror) | NOT-CLAIMED #9 no longer leads with the bridge (it is a claimed capability now); the §3 settings row points at §6.2/§6.5/§3.1; §11.1 supersedes the two §11 statements the wave moved |
| `packages/mpd-tui-plugin/README.zh-CN.md` | the zh settings row still read "**未与文件打通**" — corrected to mirror the EN row ("**bridged**"; a save writes the file, and the plugin behaviour needs a restart) |
| `packages/mpd-config-plugin/README.md` + `README.zh-CN.md` | new `/settings` bridge (write-back) section: precedence, trigger + lock/CAS/atomic rename, comment preservation, the workspace-target rule and the never-lost clause, restart timing, degenerate targets, the duplicate-key rule, and the evidence citations |
| this report, §9 | the record above |
| `evidence/tui/EVIDENCE-INDEX.md` | the bridge evidence directories and the bridge lanes are indexed with their re-run commands |
| `evidence/mpd-bridge/integration/` | this pass's raw path-existence and doc-consistency output |

**Pins re-measured at write time** (`sha256sum` + `stat -c %s`, 2026-09-15):

| Artifact | TUI-edition revision (§2) | Current revision |
|---|---|---|
| `packages/mpd-tui-plugin/dist/index.js` | `5dce2563fd0e3b20…`, 98883 bytes | `cf4b3813a344c9d5…`, **105305 bytes** |
| `packages/mpd-config-plugin/dist/index.js` | (pre-bridge) | `15733c1e0791aee1…`, 99868 bytes |
| `packages/mpd-bundle-plugin/client.js` | `dd9c88933a316277…`, 282453 bytes | unchanged, 282453 bytes |
| `dsh-plugin.json` | `84ed4a5d5aac3fb0…`, 8088 bytes | unchanged, 8088 bytes |

The package dist moved because the wave reworded the `/settings` field disclosure; the manifest and the
bundle client did not. `VENDOR_LOCK.json` is the captain's single re-pin for the wave (`assets/skills`:
307 files / treeSha `ba0c3922889614225dfd…`) and was not touched here.

**Gates on the FROZEN revision (the captain's t14/t31 sweep — unchanged by this documentation pass, which
writes no product artifact):** `bun run test:qa` all self-tests passed, exit 0; `node scripts/verify-vendor.mjs`
PASS; `bun run typecheck` 0; `bun test packages` 547/0; rows parity 24 ids; R6 `bundle-lifecycle` PASS.

> **Correction (t50, measured on the working tree — merge blocker, not caused by t50).** Two of those
> gates are **RED on the current tree**, because the bridge wave (t35–t49) added three lane scripts under
> `skills/` — `skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs`,
> `skills/dsh-qa/scripts/tui-settings-bridge.mjs`, `skills/dsh-qa/scripts/web-settings-bridge.mjs` — and
> modified three tracked ones (`skills/dsh-qa/SKILL.md`, `skills/dsh-qa/scripts/tui-panels.mjs`,
> `skills/dsh-qa/scripts/extension-isolation.mjs`) **after** the wave's single `VENDOR_LOCK` re-pin
> (307 / `ba0c3922…`) had landed. Measured: `node scripts/verify-vendor.mjs` exits 1 with
> `FAIL - asset skills count drifted: 310 vs 307` and a treeSha mismatch; `bun run test:qa` exits 1 at
> `agent-teams-messaging` with `VENDOR_LOCK skills asset is stale: lock=307/ba0c39228896
> tree=310/8ec53287296e`. The three files are still uncommitted (`git status` shows them untracked), so
> the remedy is the captain's single re-pin of `assets/skills` in the same commit as those `skills/**`
> changes (AGENTS.md §9/§11). **`VENDOR_LOCK.json` and `skills/**` are outside t50's scope and were not
> touched by this pass.** Raw logs: `evidence/mpd-bridge/integration/raw/{verify-vendor-t50.log,test-qa-t50.log}`;
> the finding is also recorded in `evidence/mpd-bridge/integration/REPORT.md` and the ledger's third
> amendment. No statement in this report claims a gate that the current tree fails.
>
> **Correction to that correction (t51, measured minutes later).** The re-pin LANDED while t51 was in
> progress: `VENDOR_LOCK.json` `assets/skills` is now **310 files / treeSha
> `8ec53287296edb43b1f622046ff932a8e339f081184622854db4a2c0445a3268`**, `node scripts/verify-vendor.mjs`
> exits **0** with `asset OK: skills 310 files` + `PASS`, and `bun run test:qa` is re-measured in the same
> pass: `bun run test:qa` exits **0** (`all self-tests passed`) — `evidence/mpd-bridge/integration/t51/raw/test-qa-t51.log`. The block above is kept as the record of the moment
> it measured; the re-pin is **no longer owed**.

**NOT-CLAIMED after this pass (the bridge's own edges, carried from t49):** the Web card's real browser
render (registration + built bytes only) and a specific front door's rendering are not witnessed here;
the decision-event seam and the seven-surface accounting are unchanged from §5; and the bridge's
`no-live-session` / `ambiguous-multi-root` skips change no file by design — they are disclosed
behaviour, never silent success. No statement in this amendment turns any of them into a pass.

**Attribution:** the capability and its lanes ← t35–t49 (their own evidence under `evidence/mpd-bridge/`,
re-review verdict PASS at `evidence/mpd-bridge/review/REREVIEW-t49.md`); the bilingual docs, the README
pairs, this amendment, the ledger and index amendments and the integration record ← **t50** (Lead).

**Honesty note (unchanged in kind).** Every digest in this amendment was measured in the same step that
wrote it; every superseded sentence is marked as superseded rather than deleted, and the original rows
above remain as the records of the revision that produced them.

> **Amendment 4 (t51, documentation closure — 2026-09-15).** Three documentation deltas that t50 could
> not carry (it was already terminal when their dispatch arrived) are now closed, in both languages and
> additively: §6.2 gained the namespace base's **cardinality rule** and the **fixed-for-process-lifetime**
> disclosure; a new **§6.6** states the scopes and the **cross-home boundary** (t38's D1); and §3.1's
> Web-card evidence level is now complete (offline hook harness + built/served bytes witnessed; a real
> browser render and a click-driven save NOT witnessed). Nothing already-correct was rewritten, no AC
> row changed status, and no source, `skills/**`, `VENDOR_LOCK.json` or `package.json` was touched.
> Full block: §10.

## 10. Amendment 4 — closing the documentation deltas (2026-09-15, t51)

**Inputs read before writing:** `evidence/mpd-bridge/review/REREVIEW-t49.md`,
`evidence/mpd-bridge/review/RESOLUTION-ruling-and-base.md` (the FINAL base/ownership state — the shipped
`baseForNamespace()`), `evidence/mpd-bridge/dual-path/REPORT.md` (t38's PASS + D1),
`evidence/mpd-bridge/web-card/{report.md,result.json}` (`claims.witnessed` / `notClaimed` / `reproSteps`),
and `packages/mpd-config-plugin/src/index.ts:511`.

| Delta | Where it landed (both languages) | What it now says |
|---|---|---|
| **A — the base and its cardinality** | `docs/tui.md` §6.2 (+ zh twin): a three-row table; also `packages/mpd-tui-plugin/README{,.zh-CN}.md` item 2 and both `mpd-config-plugin` READMEs | one live root ⇒ that workspace's `<workspace>/.mpd/mpd.jsonc`; zero roots ⇒ the mount-time (exec-less) root (`DSH_WORKSPACE_ROOT` or the process cwd), an absent file there giving an **empty base** = schema defaults — the **normal boot path**, since this row usually precedes any live session; more than one root ⇒ **no file base invented** (`base: undefined`, reason `ambiguous-multi-root`, every candidate warned and surfaced by `states()`), and a save in that state is refused, so the ambiguity cannot reach disk |
| **A — the timing disclosure** | same places | the base is **fixed for the process lifetime** because the host exposes **no disposal handle** for a live registration (its own settings installers keep their base fixed the same way) — which is exactly why the shipped sentence is "takes effect for the mpd plugins **after a restart**"; the **resolved value** plus the config layer's **per-call file reads** are what the plugins use, so each session still resolves its own file. No sentence on the page promises a live-refreshed base |
| **B — D1, the cross-home boundary** | `docs/tui.md` §6.6 (new) + zh twin | the four scopes by mechanism (DSH-HOME `settings.yaml` + user `mpd.jsonc`; workspace `<workspace>/.mpd/**`; HOME `~/.mpd/workmate`; bundle presets + corpus), and the boundary: **one DSH home ⇒ the settings document is shared; separate DSH homes ⇒ two documents, so an edit is invisible as a settings VALUE across doors — while `<workspace>/.mpd/mpd.jsonc` still converges because both doors write that same file** |
| **C — the Web card's complete evidence level** | `docs/tui.md` §3.1 + zh twin | witnessed: the registration contract in the **built and served** `client.js` (`dd9c8893…`, 282453 B), the registration shape + field parity in the card's suite, the module's render/write/refuse/read-only behaviour in the **offline hook harness**, and the **write path end to end** through the host's authenticated settings API (`web-settings-bridge.mjs` W1–W13); **NOT witnessed**: a real browser render and a click-driven save (`cardClaim.W3.witnessed === false`), with the human repro steps retained |

**Records.** This report (and its `.mpd` twin) carry Amendment 4 + §10; `evidence/tui/ACCEPTANCE-LEDGER.md`
carries a fourth amendment; `evidence/tui/EVIDENCE-INDEX.md` §7.1 indexes the added claims and this pass's
raw output. Attribution: the facts ← t34 (design), t35 (implementation), t38 (D1), t39 (final base
ruling), t41 (card), t49 (re-review), t50 (the surrounding docs); the closure edits ← **t51** (Lead).

**Gates.** `node evidence/tui/docs/20260915T070743Z/doc-assertion.mjs` and the captain's
`cited-paths-exist.mjs` were re-run over the edited files; their verdicts and digests are recorded in
`evidence/mpd-bridge/integration/t51/` and in the ledger's fourth amendment.

**Gate state at t51's close (re-measured, after the captain's re-pin landed):**
`VENDOR_LOCK.json` `assets/skills` = **310 files / treeSha
`8ec53287296edb43b1f622046ff932a8e339f081184622854db4a2c0445a3268`**; `node scripts/verify-vendor.mjs`
→ **exit 0** (`asset OK: skills 310 files`, `PASS`); `bun run test:qa` → **exit 0**, `all self-tests
passed` (`evidence/mpd-bridge/integration/t51/raw/test-qa-t51.log`). The re-pin is therefore **closed**, not owed.

**Still NOT claimed (unchanged):** AC-4 6/7 (the renderer's transcript row, NOT-CLAIMED #10), AC-20's
blocked host gates, the Web card's real browser render and click-driven save, and the packed-install e2e
boot.
