# Acceptance ledger — DSH-TUI edition (t14)

Maps every acceptance item of the frozen contract `.mpd/plans/dsh-tui-edition.md` (AC-1 … AC-20) to a
final status and the artifact that backs it. Statuses are `passed`, `failed` (attempted, result
negative/incomplete) or `not-claimed` (no evidence supports the claim; nothing was demonstrated).

**Revision pins, sampled at write time (2026-09-15):**

> **Amendment (captain-directed, after t14's terminal completion).** AC-15 was upgraded `not-claimed` →
> `passed` when the captain ran the frozen contract's regression lane R6 itself on the current revision
> (`bun skills/dsh-qa/scripts/bundle-lifecycle.mjs`, `[bundle-lifecycle] PASS`, EXIT=0) and the evidence
> landed at `evidence/dsh-qa/bundle-lifecycle/2026-09-15T07-24-59.974Z/`. Nothing else changed; the run
> writes no product artifact, so the pin table above is unmoved.
>
> **Second amendment (captain-directed, commit-time; t31 then verified it).** Three disclosures, none of
> them a status change except AC-18's stale clause:
> 1. **AC-4 carries a `failed` row that owes no repair** — the t23 disposition, stated in the AC-4 row
>    and in "How to read the two non-green rows" below; no repair task exists or is owed, and no
>    acceptance row moves.
> 2. **A checker residual, named rather than smoothed.** Re-running t29's own checker
>    `evidence/tui/composition/20260915T071619Z-docs-mpd-command/doc-assertion-t29.mjs` returns
>    `failed` at 12/13, sole failure `item3.docs/tui.zh-CN.md`, because its positive branch demands the
>    service name UNBACKTICKED while both the English section and the pre-staged Chinese snippet write
>    `` `commands` 服务`` / `` `commands` service`` — the predicate is false for the very payload it
>    prescribes, so it cannot witness the mirror. The mirror is proven byte-exact, and t27's shipped
>    checker `evidence/tui/docs/20260915T070743Z/doc-assertion.mjs` is **28/28 green, exit 0**
>    (`evidence/tui/composition/20260915T072139Z-zh-mirror-paste/result.json` →
>    `t29PredicateResidual`, `raw/t27-doc-assertion.json`, `raw/t29-doc-assertion.json`). t29's evidence
>    script was left untouched and the page was not contorted to satisfy a broken regex.
> 3. **AC-18's "re-pin outstanding" clause is now history.** The wave's single `VENDOR_LOCK.json`
>    re-pin landed (`skills` `307` / `ba0c3922…`, `lockedAt` `2026-09-15T07:26:59Z`), after which
>    `node scripts/verify-vendor.mjs` is **PASS** (`asset OK: skills 307 files`) and `bun run test:qa` is
>    **all self-tests passed, exit 0** — the raw logs are in `evidence/tui/delivery/20260915T072355Z/raw/`.

| Artifact | sha256 (first 16) | Notes |
|---|---|---|
| `dsh-plugin.json` | `84ed4a5d5aac3fb0` | frozen by t24; the anchor for t9/t12/t13/t28/t30 |
| `packages/mpd-tui-plugin/dist/index.js` | `5dce2563fd0e3b20` | **98883 bytes**, mtime `2026-09-15T06:23:20Z` (the measured-authority pair) |
| `docs/tui.md` | `0d899a4d308fdf17` | advanced by t29's §6.4 |
| `docs/tui.zh-CN.md` | `c1c0dc39ba6485af` | advanced by the unattributed post-t30 §6.4 mirror (gap t30 raised, now closed) |
| `packages/mpd-bundle/cordis.patch.yml` | `3866dc11b52aa3ae` | rows t5/t17, citation block t19 + the captain-directed R2-3 rewrite |
| `presets/mpd/agent.cordis.yml` | `0be8781f1570e9ca` | |
| `dsh-distribution.json` | `a0177b0b2a53e053` | |
| skills corpus | treeSha `ba0c3922889614225dfd3c30b97ed369ee9b5b0ae374635a5d52d561123816ef` | 307 files; VENDOR_LOCK re-pin is the captain's |

| AC | Status | Backing artifact(s) |
|---|---|---|
| **AC-1** bundle mounts as the third layer, zero apply-crash signatures, counters rendered | **passed** | `evidence/tui/lanes/2026-09-15T07-05-19.752Z/` (mount, `REVISION.json` + `dump-config.txt` + pane + raw log); independent re-runs `evidence/tui/live/20260915T063140Z/lanes/tui-mount/`, `evidence/tui/lanes/2026-09-15T07-08-44.315Z/` |
| **AC-2** single-install doctrine (one `dsh plugin --profile dsh-tui add <repo>`) | **passed** | `evidence/tui/live/20260915T063140Z/raw/install-fresh-root.sh` (exit 0 on a fresh root) + the triple `dsh.profile.bundles` in every mount result |
| **AC-3** no duplicate loader entry id; the installer mirror is real | **passed** | `node scripts/verify-rows-parity.mjs` → 24 ids incl. `mpd-tui`; `evidence/tui/composition/20260915T062202Z/` (parity + gates); t28's id sweep (24 inserts + exactly 2 column-0 id-targets, `"duplicate loader entry id": 0`) |
| **AC-4** all SEVEN activation-gated surfaces render | **failed** | 6 of 7 render (`evidence/tui/lanes/2026-09-15T07-05-58.634Z/`; `evidence/tui/live/20260915T063140Z/lanes/tui-panels/`; `evidence/tui/plugin/20260915T060934Z/mount/`); `tuiRenderers` is NOT-CLAIMED, host-side — see `docs/tui.md` §10 item 10 and NOT-CLAIMED below — **t23 disposition:** t23 is the honest record of ONE criterion that is unsatisfiable as written; six boots produced no transcript row while the session log carried the event, and the cause is host-side (ORDER: `renderers.ts:63` snapshots the known-type set at load, `:146-149` refuses a type in it, while a bundle row must register its log-only type before that capture to keep sessions resumable). No repair task is owed, so the status line's "t23 failed without a follow-up repair" must not be read as unfinished work: the surface is discharged as NOT-CLAIMED item 2 here / `docs/tui.md` §10 item 10, verified by t28 and t30. |
| **AC-5** plugin contract holds (shape, defaults, cleanup, no throw without services) | **passed** | t12 PASS at `5dce2563…` (`evidence/tui/review/t12/{REVIEW.md,result.json}`); `bun test packages/mpd-tui-plugin` 37/0; `bun run typecheck` exit 0 |
| **AC-6** decision-event seam ready-but-not-activated (no faked admission, warn once) | **passed** | `evidence/tui/review/t12/REVIEW.md` (t10-F1/F2 closed; `() => false` sentinel covered; `requested` never `confirmed`); `evidence/tui/plugin/20260915T060934Z/` (refusal arms) |
| **AC-7** the panels lane fails loudly, with a recorded negative control | **passed** | `evidence/tui/lanes/2026-09-15T07-05-58.634Z/negative/control.json` (`control.ok === false` on the REAL panes); `evidence/tui/live/20260915T063140Z/lanes/tui-panels/negative/` |
| **AC-8** manifest accepted AND projected by the host's own algorithm; spec root pinned | **passed** | `evidence/tui/lanes/2026-09-15T07-08-44.315Z/{admission-static.json,result.json}`; `evidence/tui/conformance/20260915T064521Z/01-admission-static.log`; `loadSpecData()` asserted non-undefined before any verdict |
| **AC-9** live `/plugins check` in an acceptable state, forbidden family excluded | **passed** | `…/07-08-44.315Z/plugins-check.pane.txt` → `waiting_authorization`, `forbidden: []`; independently confirmed by the protocol's own `validate-manifest.mjs` (`evidence/tui/conformance/20260915T064521Z/`, `pinned-cli` exit 0) |
| **AC-10** the manifest tells the truth (no `provides`/`requires.services`, optional DecisionEvents, four permissions) | **passed** | t13/t28/t30 reviews (`evidence/tui/review/`, task records) + `…/admission-static.json` digests; the `/mpd` vs `contributes.commands: []` wording now documented in `docs/tui.md` §6.4 (t29) |
| **AC-11** TUI sessions default to the `mpd` preset; the delivered pair of id-targets | **passed** | `node skills/dsh-qa/scripts/preset-conformance.mjs` PASS (live session `agentPreset: mpd`, negative control RED); `evidence/tui/composition/20260915T061519Z/raw/preset-roster-top.pane.txt` (host roster marks ours `（默认）`); `evidence/tui/lanes/2026-09-15T07-05-19.752Z/preset.session.json` |
| **AC-12** per-package classification (usable/inert/web-only; node_modules excluded) | **passed** | `evidence/tui/composition/20260915T053445Z/ledger.json` (t5 static, measured at its revision) + `evidence/tui/live/20260915T063140Z/` (t8 live). **Supersession:** the `mpd-tui-plugin` row in t5's ledger is measured pre-repair (`inert`); after the t21/t23 rebuilds the package is live — t8's live lane is the superseding witness |
| **AC-13** `dsh-distribution.json` validated by the protocol's own CLI | **passed** | `evidence/tui/lanes/2026-09-15T07-07-47.413Z/{result.json,distribution-cli.json}` → install/build/check exit 0, `fullyValidated: true` |
| **AC-14** pinned conformance suite executed per requirement, revisions+digests recorded | **passed** | `evidence/tui/lanes/2026-09-15T07-07-04.875Z/spec-conformance.json` (7/7 with the pinned parser at `d28c267`, three-way identity true) + the upgrade `evidence/tui/conformance/20260915T064521Z/` (the protocol's own CLI RAN, exit 0). **Recorded blocker:** the suite runner needs `git submodule update --init --recursive vendor/dsh-std` (work tree + network) — forbidden inside a QA task, named not hidden |
| **AC-15** dual-profile control: the web profile still boots (R6) + no duplicate id | **passed** | `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` on the current revision → `[bundle-lifecycle] PASS`, EXIT=0: `evidence/dsh-qa/bundle-lifecycle/2026-09-15T07-24-59.974Z/{result.json,boot.log,output.log}` (console copy `evidence/tui/delivery/20260915T072355Z/raw/web-profile-boot.log`). Measured steps all `ok:true`: one-command install with the WEB triple `["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","@mpd-dsh/mpd"]` (our bundle is the third layer of the web profile too), composed, **boot http:true**, corpus served from the checkout `skills/`, preset resolved from the installed profile copy with `trust: system`, `noHomeCopy {skills:[],presets:[]}`, `layerDurability ok`, `uninstall ok` with `residue: []` and `mpdState: []`. Composition half as before (`evidence/tui/composition/*/ledger.json`: 24 ids, one `mpd-tui`, no duplicate-id markers) |
| **AC-16** bilingual docs exist and are wired (switch links, index/README links) | **passed** | `docs/tui.md` + `docs/tui.zh-CN.md`; `evidence/tui/docs/20260915T070743Z/` (doc-assertion checker re-run → `"verdict": "passed"`, exit 0); `evidence/tui/docs/20260915T060010Z/verify.json` |
| **AC-17** the docs are honest (ledger + NOT-CLAIMED, no evidence-free sentences) | **passed** | `docs/tui.md` §8/§10/§11 and the zh twins; t27/t29/t30 reviews; the renderer item is item 10 in both languages with the host-side cause |
| **AC-18** repo regression green on the final revision | **passed** | typecheck 0; `bun test packages` 547/0; rows parity 0 (24 ids); preset-conformance PASS; mount boot PASS; R6 `bundle-lifecycle` PASS; **`bun run test:qa` all self-tests passed, exit 0** after the wave's single `VENDOR_LOCK` re-pin (`skills` 307 / `ba0c3922…`) cleared the case that was red before it (`agent-teams-messaging.mjs`, `lock=301/0dd4a6ee68e0 tree=307/ba0c39228896`) — before/after logs in `evidence/tui/delivery/20260915T072355Z/raw/` |
| **AC-19** the delivery itself (ledger + report + evidence index) | **passed** | this file + `.mpd/plans/dsh-tui-edition-report.md` + `evidence/tui/EVIDENCE-INDEX.md` |
| **AC-20** the host's own `verify:plugin-*` gates run, or BLOCKED with the blocker named | **not-claimed (blocked)** | t9: `npm run verify:plugin-spec` in a workspace-local copy dies `ERR_MODULE_NOT_FOUND` for `tsx` (the copy has no `node_modules`/`lib`/vendor build); the exact reason is recorded and the gates are never presented as a verdict on this bundle |

## How to read the two non-green rows

- **AC-4** is a **host-side** limitation: our renderer registration is accepted, our log-only event is
  persisted, and the host projects no transcript row for a type it has already seen (ORDER mechanism,
  `dsh-adapter/renderers.ts:63` snapshot + `:148-149` refusal). Six of seven surfaces render; the
  seventh is disclosed in `docs/tui.md` §10 item 10 and NOT-CLAIMED here. **This `failed` row is t23's
  honest record of one criterion that is unsatisfiable as written, and no repair is owed**: six boots
  produced no transcript row while the session log carried the event, the cause is host-side, and the
  surface is discharged as NOT-CLAIMED, verified by t28 and t30 — so the team status line's
  `t23 failed without a follow-up repair` must not be read as unfinished work.
- **AC-20** is **blocked by environment**, not by a product defect, and the blocker is the recorded
  one (`tsx` unresolvable in the unbuilt host copy).

Everything else is backed by a run on the pinned revision, with the digest recorded per result
(`REVISION.json` beside each lane result) — no ledger row rests on a stale artifact digest.

## Third amendment — the settings-bridge wave (t50, 2026-09-15)

The bridge capability was built and verified by t35–t49; t50 is its documentation and record half. **No
AC row above changes status** — this amendment records what the docs and the records now say, and two
checker observations that a later reader must not mistake for regressions.

1. **AC-16 (bilingual docs exist and stay wired) — re-witnessed on the t50 text.** The shipped checker
   `evidence/tui/docs/20260915T070743Z/doc-assertion.mjs` was re-run on the amended pair and returns
   `"verdict": "passed"`, **28/28 items, exit 0** (raw:
   `evidence/mpd-bridge/integration/raw/doc-assertion-t27-t50.log`), on `docs/tui.md` sha256
   `ee99c11ea97332f8…` and `docs/tui.zh-CN.md` sha256 `63f282fa12a63d94…`. The new sections exist in
   both languages: §3.1 (Web card), §6.2 (bridged behaviour), §6.5 (duplicate keys), §11.1
   (superseding table).
2. **AC-17 (the docs are honest) — extended, same standard.** The bridge is documented with its measured
   evidence level (`Observed`, two real boots), its two disclosed skip cases (`no-live-session`,
   `ambiguous-multi-root` — no file written, value never lost), its restart caveat, and the Web card's
   **not witnessed** browser render. NOT-CLAIMED #9 no longer leads with the bridge; the §11 statements
   the wave moved are superseded in §11.1 rather than rewritten.
3. **A stale checker pin, named — not a regression.** t29's frozen checker
   (`evidence/tui/composition/20260915T071619Z-docs-mpd-command/doc-assertion-t29.mjs`) now reports
   **two** failures instead of one: the already-recorded predicate residual (`item3.docs/tui.zh-CN.md`)
   plus `entry-unmoved`, because that script pins the TUI-edition entry digest `5dce2563…` while the
   bridge wave legitimately rebuilt the package to `cf4b3813…`. The script was **left untouched** (it is
   another task's evidence) and its pin is superseded by the t27 checker above, which is green on the
   current revision. Neither failure is caused by this pass's text.
4. **A phantom-reference class closed.** The captain's independent checker
   `evidence/tui/delivery/20260915T072355Z/cited-paths-exist.mjs`, re-run across all nine amended files,
   now reports **0 missing** (it previously flagged 11: 14 bare .mpd/mpd.jsonc tokens that are
   workspace-relative rather than repo-relative, the package-local skills/mpd-tui/SKILL.md, and one
   protocol-checkout command path). Each was made precise (`<workspace>/.mpd/mpd.jsonc`,
   `packages/mpd-tui-plugin/skills/mpd-tui/SKILL.md`, `<protocol-repo>/packages/conformance/lib/cli.js`)
   — no citation was deleted and no path was invented. Raw:
   `evidence/mpd-bridge/integration/raw/cited-paths-t50.log`.
5. **Pins moved by the wave, re-measured at write time.** `packages/mpd-tui-plugin/dist/index.js`
   `5dce2563fd0e3b20…` (98883 bytes) → `cf4b3813a344c9d5…` (**105305 bytes**);
   `packages/mpd-config-plugin/dist/index.js` `15733c1e0791aee1…` (99868 bytes);
   `packages/mpd-bundle-plugin/client.js` `dd9c88933a316277…` (282453 bytes, unchanged);
   `dsh-plugin.json` `84ed4a5d5aac3fb0…` (8088 bytes, unchanged). `VENDOR_LOCK.json` carries the wave's
   single re-pin (`assets/skills`: 307 files / treeSha `ba0c3922889614225dfd…`) and was not touched here.
6. **What is still NOT claimed after this pass** — unchanged from the rows above and from t49: the Web
   card's real browser render, a specific front door's rendering, the decision-event seam, the seventh
   activation-gated surface (NOT-CLAIMED #10), and the spec-suite/host-gate blockers (AC-20).
7. **Merge blocker found by this pass (not caused by it; outside t50's scope).** On the working tree the
   vendor pairing is **red**: `node scripts/verify-vendor.mjs` exits 1 (`FAIL - asset skills count
   drifted: 310 vs 307` + treeSha mismatch) and `bun run test:qa` exits 1 at `agent-teams-messaging`
   (`VENDOR_LOCK skills asset is stale: lock=307/ba0c39228896 tree=310/8ec53287296e`). Cause: the bridge
   wave added three files under `skills/` (`skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs`,
   `skills/dsh-qa/scripts/tui-settings-bridge.mjs`, `skills/dsh-qa/scripts/web-settings-bridge.mjs`) and
   modified three tracked ones (`skills/dsh-qa/SKILL.md`, `skills/dsh-qa/scripts/tui-panels.mjs`,
   `skills/dsh-qa/scripts/extension-isolation.mjs`) **after** the wave's single re-pin (307 /
   `ba0c3922…`); the three new files are still untracked, so the re-pin for this second invalidation has
   not landed. **AC-18's `passed` row rests on the earlier green sweep and stays as the record of that
   revision** — the required action is the captain's single re-pin of `assets/skills` in the same commit
   as those `skills/**` changes (§9/§11), which t50 may not perform (`VENDOR_LOCK.json` and `skills/**`
   are outside its scope). Raw: `evidence/mpd-bridge/integration/raw/{verify-vendor-t50.log,test-qa-t50.log}`.

## Fourth amendment — the documentation closure (t51, 2026-09-15)

Three documentation deltas that t50 could not carry (it was terminal when their dispatch arrived) are
closed additively. **No AC row changes status.**

1. **AC-17 (the docs are honest) — extended.** `docs/tui.md` §6.2 (+ zh twin) now carries the namespace
   base's **cardinality rule** exactly as the shipped `baseForNamespace()`
   (`packages/mpd-config-plugin/src/index.ts:511`) behaves: one live root ⇒ that workspace's
   `<workspace>/.mpd/mpd.jsonc`; zero roots ⇒ the mount-time (exec-less) root, an absent file there
   giving an empty base (schema defaults) — the normal boot path; more than one root ⇒ **no file base
   invented** (`base: undefined`, reason `ambiguous-multi-root`, every candidate warned and surfaced by
   `states()`), with the per-workspace read-in still resolving each session's own file. It also carries
   the honest timing disclosure: the base is **fixed for the process lifetime** because the host exposes
   **no disposal handle** for a live registration — the reason the shipped sentence says "after a
   restart" — while the **resolved value** plus the config layer's **per-call file reads** are what the
   plugins use.
2. **New `docs/tui.md` §6.6 (+ zh twin) — the scopes and the cross-home boundary (t38's D1).** One DSH
   home ⇒ the settings document (`$DSH_HOME/settings.yaml`) is shared; **separate DSH homes ⇒ two
   settings documents, so an edit in one front door is invisible as a settings VALUE to the other —
   while `<workspace>/.mpd/mpd.jsonc` still converges because both doors write that same file.** The
   other scopes are stated by mechanism (workspace `<workspace>/.mpd/**`; HOME `~/.mpd/workmate`;
   DSH-HOME `settings.yaml` + user `mpd.jsonc`; bundle presets + skill corpus).
3. **§3.1's Web-card evidence level completed.** Witnessed: the registration contract in the built and
   served `client.js` (`dd9c8893…`, 282453 bytes), the registration shape and field parity in the
   card's own suite, the module's render/write/refuse/read-only behaviour in the **offline hook
   harness**, and the write path end to end through the host's authenticated settings API
   (`web-settings-bridge.mjs` W1–W13). **NOT witnessed:** a real browser render and a click-driven save
   (`cardClaim.W3.witnessed === false`), with the human repro steps retained.
4. **Sync + integrity.** The two package README pairs carry the same base/timing facts; the report pair
   carries Amendment 4 / §10; this ledger and `evidence/tui/EVIDENCE-INDEX.md` §7.1 are updated in the
   same pass. The shipped bilingual checker and the captain's cited-path checker were re-run over the
   edited files, verdicts below (raw: `evidence/mpd-bridge/integration/t51/raw/`).
5. **The re-pin LANDED while t51 was in progress — the third amendment's item 7 is superseded.** The
   captain re-pinned `VENDOR_LOCK.json`: `assets/skills` is now **310 files / treeSha
   `8ec53287296edb43b1f622046ff932a8e339f081184622854db4a2c0445a3268`**, `node scripts/verify-vendor.mjs`
   exits **0** (`asset OK: skills 310 files`, `PASS`) and `bun run test:qa` exits **0** (`all self-tests
   passed`) — `evidence/mpd-bridge/integration/t51/raw/{verify-vendor-t51.log,test-qa-t51.log}`. Item 7 of the third
   amendment stays as the record of the moment it measured; nothing is owed on that count.
