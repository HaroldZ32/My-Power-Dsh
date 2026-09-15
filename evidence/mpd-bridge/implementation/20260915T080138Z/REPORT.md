# t35 — settings bridge implementation report (final state)

Task t35 (Senior Engineer), attempt `11a4deeb-260f-4152-9b1f-e14ec51bff90`, plus the captain's
scope change (the web card is OUT) and the three additions of 2026-09-15.

## 0. Which design text this work follows (and the hash discrepancy)

Two stale digests are in circulation and neither is the file on disk: the captain quoted 505 lines /
`391b85b3…`, and the Architect's later message quoted 651 lines / `2e990f1b…` — which the CURRENT file
itself records as its **pre-erratum** digest (`DESIGN.md:54`), i.e. the Architect's message predates the
design author's own erratum.
**The file on disk, and the one this work follows, is: 694 lines, sha256
`002beaca748c97219ff7c3fc97bf2583f9230402685db4d5f7b51b1ee29792c9`.**
The extra 189 lines are the design author's own **`ERRATUM — t40 (2026-09-15)`**, which strikes the stale
§7 item 3 "fan-out is real" sentence, records that the governing rule is the `ambiguous-multi-root`
REFUSAL (D-5/§A.1/§3/§10.3/U14/F5 — what this task implements), and explains that a file cannot contain
its own digest, so it records a *verifiable payload digest* instead. Nothing else in the design changed:
§B (E1-E11) and §D are as before. **I implemented against the 694-line file (sha256 `002beaca…`) and
verified the erratum is what reconciles the two texts.** §C's card half is moot per the captain.

## 1. What was built

| Area | File | What it does |
|---|---|---|
| Refuse-first JSONC rewriter (pure) | `packages/mpd-config-plugin/src/jsonc-edit.ts` (named as §10.2 specifies) | span-proven edits; comments, key order, trailing commas and line endings preserved; refusals named with the **design's own vocabulary**: `unparsable`, `ambiguous-intermediate`, `span-not-proven`, `unsupported-shape`, `duplicate-key`. **Duplicated LEAF key ⇒ the LAST occurrence is edited** (the member `JSON.parse` reads — E5/D-11/U6/§10.3); only a duplicated **intermediate** refuses `ambiguous-intermediate` |
| Write-back bridge | `packages/mpd-config-plugin/src/bridge.ts` (named as §10.2 specifies) | `resolveTargets` (1 root ⇒ write; 0 ⇒ `no-live-session`; N ⇒ `ambiguous-multi-root` + candidates), `changedLeaves`, `writeBackLeaves` (per-root CAS + sibling temp + rename), `createdFileHeader`, `isWritableFile`; E11's status `denied` carries the §10.3 REASON `read-only` |
| Wiring | `packages/mpd-config-plugin/src/index.ts` | L0<L1<L2<L3 read-in; trigger on the raw-section change filtered to `source==='update'`; `settingsBridge.writeBack` switch (default ON) + `MPD_DSH_TUI_SETTINGS_BRIDGE=off`; per-root loud reports (stdout **and** `ctx.logger`, because the logger has no sink in a headless/web boot); boot migration with the in-namespace marker; the §1.2 file-edit override clearing; extended `states()` with a version-skew `degraded` field |
| Adapter settings seam | `packages/mpd-dsh-adapter-plugin/src/index.ts` | `settingsReader`, `onSettingsDocumentUpdated` (coalesced per tick — the host emits `document-updated` **before** the source-carrying `settings/updated`), `settingsMutate` |
| TUI disclosure + **§D.2 runtime notice** | `packages/mpd-config-plugin/src/settings-schema.ts` (the ONE source for the schema, the six knobs and both disclosures) ·
`packages/mpd-tui-plugin/src/{settings,state,status,index,types}.ts` (+`dist`) | the "not bridged" sentence is DELETED and replaced by the bridge+restart statement; the exact `no-live-session` notice is a single exported constant and is **published on the keyed status line** whenever the config layer's last write-back was skipped for that reason (reached through `ctx.inject(['mpdConfig'])`; the status cadence is the polling floor). Zero filesystem writes |
| Two QA lanes | `skills/dsh-qa/scripts/web-settings-bridge.mjs`, `skills/dsh-qa/scripts/tui-settings-bridge.mjs`, shared engine `skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs`, two `SKILL.md` rows | see §3 |

## 1a. THE WEB CARD (back in scope after the captain's reversal — and it was my earlier reversal that had removed it)

The user asked for exactly this ("这套配置想办法以选项卡的形式做到 web 的『设置』里"), so the card is a
required deliverable again. It is rebuilt to the pattern MEASURED from the host's own shipped client
(`@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js`):

| Element | Measured host shape | Ours |
|---|---|---|
| registration | `ctx.slots.inject("settings.plugin.item", function* () { yield ctx.slots.register({ name, key, locale, inject: () => c.inject() }, Card) })` (`:1785-1810`) | identical shape, `key: "mpd"`, `locale: "mpdSettings"` |
| dispatch | the Plugins tab renders the slot keyed by namespace (`renderSlot("settings.plugin.item", {}, { entryKey: ns })`) | our namespace `mpd` is served, so the card is dispatched; without a card a served namespace renders nothing — which is why the six knobs were invisible before |
| props | `{ t, edit, resetField, save, discard, use<X>Card }` (`BashCard` `:329-367`) | our controller injects `{ hooks: { mpdCard: store }, edit, resetField, save, discard }` |
| write | `ctx.settingsScope.bind({namespace})` → `set`/`unset`/`mutate(ops, revision)` | `scope.mutate([{op:'set',path,value}], revision)` — nested paths, which `set(field,…)` cannot express |
| private components | `PluginCard`/`ValueField` are package-private | NOT imported; the card is self-contained markup |
| mount | the card's service is plugin-provided | `ctx.inject(["settingsScope"], …)` — deferred, never a declared dependency; one warning on absence |

The six fields/labels/zh descriptions are INDENTICAL to the TUI section's and a test asserts that
(`settings-card.test.mjs`: every field's path/label/zh/disclosure is checked against
`packages/mpd-tui-plugin/src/settings.ts`), so the two front doors cannot drift. `writable === false`
renders read-only with the reason and the card does not even attempt a write — a non-loopback page
keeps its snapshot in memory, and saying so is the honest behaviour.

Two real bugs the card's own test caught before shipping: a `const { section } = section()`
shadowing TDZ and a `let saving` declared below the first projection — both would have made the card
throw on mount in a browser, i.e. exactly the class of failure no static check would have found.

**Artifact**: `packages/mpd-bundle-plugin/client.js` — **282106 bytes, sha256
`3594df6d82e0cf0605dd583ed7251f60296615fba3c21fd0da7c9eeadb2be66e`** (rebuilt with
`node scripts/build-mpd-client.mjs`; the lane records the same numbers from the file it judged).

**Evidence level, plainly**: **W1** (a write into the namespace through the host's own authenticated
API reaches the bridge and the file, with the resolved value changing) and **W2** (the registration is
present in the BUILT and SERVED client — bytes re-hashed in the lane result) are **witnessed**.
**W3 — that a browser renders the card and a click produces the mutate — is NOT witnessed: no browser
binary exists in this environment.** It is recorded as NOT-CLAIMED in both the lane result and here,
and is the user's own GUI check.

## 2. Acceptance evidence

**WEB ARM** — `web-settings-bridge.mjs`, real boot, `ok:true` (includes the W2 card assertions); evidence `lane-web/`
(`result.json`, `output.log`, `raw/boot-main.log`, `raw/boot-disabled.log`):

| Group | Checks | Result |
|---|---|---|
| one live root | W1 front door accepted · W2 file changed · W3 value read back · W4 comment survived · W5 key order intact · W6 old value gone · W7 report names `writtenTo` · W8 `source:"update"` · W9 `applies:"restart"` · W10 names a `.mpd/mpd.jsonc` path · **W11 the RESOLVED value the config layer merges changed** · **W12 the settings user section (L3) carries it** | 12/12 |
| two live roots | A1 accepted · A2 NO file changed anywhere · A3 `skipped:"ambiguous-multi-root"` · A4 structured candidates name every root · A5 the human-readable line names them too | 5/5 |
| switch off (A6 control) | D1 the settings write still succeeded · D2 the file BYTE-IDENTICAL · D3 `skipped:"disabled"` · D4 no surface claims "unbridged" | 4/4 |
| static | S1-S3 (also asserted independently by the TUI arm) | 3/3 |
| **card (W2)** | W2a the built client registers `settings.plugin.item` with `key:'mpd'` + locale · W2b slot/namespace named · W2c the mount is deferred through `ctx.inject(["settingsScope"])` · W2d the client still declares only `["slots","locale"]` · W2e the card's copy is the TUI's disclosure | 5/5 |
| W3 | a real browser render + click | **NOT-CLAIMED** (no browser binary) |
| recorded negative control | an injected fan-out fault turns the engine red | red as required |
| isolation | no session-store key escaped the sandbox | true |

**TUI ARM** — `tui-settings-bridge.mjs` against the built bytes; evidence `lane-tui/`:
T1/T2 the bridge+restart disclosure is in the dist · T3 the old claim is GONE · T4 the §D.2
`no-live-session` notice is in the dist · T5 the notice is **wired into `statusLine(`**, not merely
defined · T6 the source has the single exported constant · T7 the TUI dist performs ZERO filesystem
writes — **7/7**.

Both arms ship `--self-test` and both self-tests falsify **both** evaluators: 15 injected faults in the
web engine + 6 in the TUI-surface evaluator, each required to flip its own check.

Not witnessed anywhere, and stated in every artifact: a consumer PLUGIN's post-restart runtime
behaviour (design F3) needs a live session plus a restart with a consumer probe; a TUI keystroke edit
(needs a real TTY — `tui-panels` owns that surface); a rendered card (cut, and no browser exists).

## 3. The lane structure: TWO lane files over ONE shared engine

The captain allowed either two lanes or one lane with two arms. **Chosen: two lane files sharing one
engine** (`lib/settings-bridge-lane.mjs`), because the two arms have different runtimes and different
failure modes:
* `web-settings-bridge.mjs` — the authenticated host-API arm (boot, 303 + launch-token cookie,
  `settings/mutate`, file + resolved value, two negative controls). Real run, ~47 s.
* `tui-settings-bridge.mjs` — the built-bytes arm (disclosure, §D.2 notice + its wiring, zero-write).
  Real run, instantaneous, and never a vacuous skip.
Each has its own evidence dir, its own `--self-test` and its own `SKILL.md` row, so neither can hide
behind the other.

Gate sweep (post-change, `gates.log`): `bun run typecheck` 0 · the four package suites **199 pass /
0 fail / 24 files** · both lane self-tests ok · `tui-panels --self-test` ok · `extension-isolation
--self-test` 0 · TUI zero-write grep 0 · `git status` for `packages/mpd-bundle-plugin/` + `scripts/`
= 0 entries · `bun run test:qa` exits 1 ONLY on the VENDOR_LOCK skills-pairing case
(`lock=307/ba0c39228896 tree=310/f02831226271` — the captain's single re-pin for this wave's
`skills/**` edits, counted 310 because two lane files and one shared engine were added).

## 3a. §10.2 API conformance and the A6 switch (this round)

* **Module paths now match §10.2**: `src/jsonc-edit.ts` and `src/bridge.ts` (tests renamed with them:
  `test/jsonc-edit.test.ts`, `test/bridge.test.ts`). The mounting is unchanged — no new row; both are
  imported by the existing `mpd-config` row.
* **The design's exported names exist**: `EditRefusal` and `EditResult` are exported aliases,
  `surgicalEdit` is the entry point, `DELETE` is the deletion sentinel (`surgicalEdit(raw, path, DELETE)`
  is handled BEFORE serialisation and is byte-equal to `surgicalDelete`), and **`locateValueSpan(raw, path)`
  is public**, returning `{start,end,hasTrailingComma,eol}` or a named refusal, built on the SAME scanner
  as the editor so the two can never disagree.
* **A6 switch: BOTH spellings work.** The design's flat `config.writeBack: false` (§10.2) and the
  captain's nested `config.settingsBridge.writeBack: false` (his ruling 2) each disable the write-back;
  default ON; `MPD_DSH_TUI_SETTINGS_BRIDGE=off` stays the secondary lever; `states().settings.writeBackEnabled`
  reports the effective switch so a lane can assert it. The lane's patch layer now composes the DESIGN's
  flat key, so a reviewer checking either text sees the negative control exercised.

### The design's two [UNVERIFIED] items, measured

* **`workspaceRootsAll()`**: duplicates collapse (`/ws/one`, `/ws/one`, `/ws/one/../one` ⇒ ONE candidate),
  relative cwds resolve, a cwd-less agent is skipped, no registry ⇒ `[]`, a throwing/odd registry ⇒ `[]`.
  A **deleted cwd still yields its path** — the adapter never touches the filesystem, so the writer
  reports that root per E11 instead of silently dropping it or guessing. Pinned by
  `packages/mpd-dsh-adapter-plugin/test/adapter.test.ts`.
* **Duplicate registration fails loud** — measured at source (not inferred): the host's own guard is
  `@deepseek-ai/dsh-settings/lib/index.js:283` → `throw new Error('settings namespace "<ns>" is already registered')`.
  That is exactly the hazard §10.1 warns about, which is why the captain's split (ONE registrant: the TUI)
  is the safe composition; the re-registration base-refresh path the design lists as its alternative
  would have to dispose before re-registering.
* **Row order (the Architect's explicit question): CONFIRMED by measurement** —
  `packages/mpd-bundle/cordis.patch.yml` mounts `mpd-config` at line 216 and `mpd-tui` at line 300, so
  `mpd-config` applies first and the namespace is not yet served when it reads. Consequence: a consumer's
  apply-time snapshot carries L1+L2; L3 is visible immediately through `mpd_config_get`/`mpd_config_reload`
  and is durable through the file.

## 3b. Captain's two rulings on the corrected design, implemented

### Ruling 2 — §10.1 ownership (supersedes the earlier one)

* **`packages/mpd-config-plugin` now owns the registration** (`settingsRegister` through the adapter,
  `applies: "restart"`) with the **file-derived `base`** = the L1+L2 file layers (never the resolved
  value, so a front door can mark an override and reset back to the file's). The TUI package is a
  **pure consumer with a guarded fallback**.
* **The guard is provable and tested in three compositions** (`packages/mpd-tui-plugin/test/two-plugin-ownership.test.ts`,
  whose settings double models the host's own duplicate guard, which throws — `dsh-settings/lib/index.js:283`):
  (a) config plugin present ⇒ exactly **1** registration, the TUI logs the skipped fallback and warns nothing;
  (b) config plugin absent ⇒ exactly **1** registration, by the TUI fallback;
  (c) both in one composition, EITHER order ⇒ still exactly **1** registration, with the loser's reason reported.
  A fourth case covers the deterministic owner check below.
* **TWO real boot-order defects were found and fixed while doing this, both measured in the lane's log:**
  1. at `mpd-config`'s row position the settings provider is not always mounted yet (a loader applies
     rows concurrently), so a direct `register` failed with `settings service is unavailable` and the
     TUI fallback owned the namespace **without a base** → registration is now **deferred** through a new
     adapter seam (`whenSettingsAvailable`, an `ctx.inject(["settings"], …)` inside the adapter, which
     is the only place allowed to reach the harness directly);
  2. with both plugins parked on that same dependency the **fallback still won the race** → the TUI now
     also checks, **deterministically**, whether the config plugin is in the composition (its `mpdConfig`
     service is visible once its fiber is active, and this row mounts after it) and yields to the owner.
* **The result is witnessed end-to-end**: lane check **W13** asserts the namespace's served `base` is the
  **file** value — the fixture's file value is deliberately `12345` while the schema default is `20000`,
  so a base of `12345` can only have come from the file. The boot log carries
  `[mpd-config] settings bridge: registered the "mpd" namespace with the file-derived base (applies:'restart', design §10.1)`.
* **The base is FIXED for the process lifetime, by measurement, not by choice**: the host exposes no
  disposal handle for a live registration — `register()` returns only `{get, watch, update, replace}`
  and removes the namespace from an internal `ctx.effect`, and the host's own `installSection` keeps its
  base fixed the same way (`dsh-settings/lib/index.js:283-302, 327-350`). The design's §1.3 fallback
  therefore governs: the RESOLVED value is the authority and the config layer re-reads the files on every
  resolution. The card's copy says "inherited (read at mount)" so the marker is not overclaimed.

### Ruling 1 — multi-root refusal, and "not a lost edit"

* The refusal itself was already implemented and is unchanged: 1 root ⇒ write; 0 ⇒ `no-live-session`;
  **N ⇒ `ambiguous-multi-root`, every candidate named, no file written, one warning** (§A.1, D-5, D-12,
  §10.3).
* The **"never lost"** claim is now evidenced, not asserted: a unit test drives N roots to a refusal and
  then resolves the config for **each** workspace, asserting the new value comes back from the host-global
  settings layer in both (`packages/mpd-config-plugin/test/settings-wiring.test.ts`, "A3 'not a lost edit'").
* The wording carries it on both surfaces: the TUI hint ends with the shared
  `BRIDGE_NOT_LOST` clause ("the value is never lost: it is stored in the host settings document and the
  config layer applies it to every workspace immediately — only the file write waits for exactly one live
  session"), the status line surfaces a distinct sentence for **each** skip reason
  (`no-live-session`, `ambiguous-multi-root`), and the Web card mirrors the same clause. TUI-arm check
  **T8** asserts the clause is in the built bytes; `tui-panels` requires it in the rendered pane.
* **Docs are outside this task's `inScope`** (`docs/**`, `README*.md`): the docs task must state the same
  three cases plus "the edit did not reach any file ≠ the edit was lost". Exact wording is in §5 item 4.

## 3d. t39 — the two ruling-driven corrections, with the falsifiers

**Correction 1 — duplicate-key semantics (`src/jsonc-edit.ts`, settled ruling `5df9d06b`):**
* **SET updates the LAST occurrence and SUCCEEDS**, byte-splicing only that span; the first occurrence stays byte-identical. The result carries a LOUD note — `key "ulw.maxRounds" appears 2 times at lines 3, 4; the last occurrence is the effective value and was updated` — which the bridge forwards per root (`RootResult.notes`) and `mpd-config` warns with the occurrence lines, so nothing is silent. Pinned by `jsonc-edit.test.ts` (bytes + note + lines) and `bridge.test.ts` (a real write through the per-root writer, then the parsed document is `{ulw:{maxRounds:11}}`).
* **UNSET removes EVERY occurrence** of that exact path (the captain's delta vs the design; recorded here), because removing only the last would leave the first effective — the UI would show the key unset while the runtime still read it. The spans are spliced in descending order in one pass; if ANY occurrence's span cannot be proven the whole edit refuses and the file stays byte-untouched. Pinned for both the direct call and the `DELETE` sentinel.
* **Refusal is unchanged where it belongs**: duplicated **intermediate** objects (`ambiguous-intermediate`, both set and unset), unparsable documents, unprovable/absent spans (`span-not-proven`), unsupported shapes, read-only targets — byte-untouched plus a named reason. The reason union and the comments were updated, so the code and the settled ruling cannot disagree.

**Correction 2 — the file-derived base (design §10.1/§1.1/§1.3/D-9):** implemented as described in §3b, with the captain's cardinality rule for the base recorded and proven:
| Live roots at registration | base | Evidence |
|---|---|---|
| 1 | that workspace's `.mpd/mpd.jsonc` | unit test: a file with `hashline.maxDiffChars: 35000` ⇒ `base == {hashline:{maxDiffChars:35000}}`, `states().settings.baseReason == "one-live-root"`, and the resolved value 35000 (not 20000) |
| 0 | the mount-time (exec-less) root; an absent file there ⇒ an EMPTY base, i.e. the schema defaults | unit test: `baseReason == "mount-time-root"`, `base == {}` |
| N | **no base invented**: the ambiguity is surfaced (warn naming every candidate + `states().settings.baseReason == "ambiguous-multi-root"`, `baseCandidates`) and the namespace falls back to the schema defaults, while the config layer's READ-IN stays per-workspace (each session resolves its own file: 35000 vs 12345 in the unit test) | unit test + the warn line |
**The falsifying observation the task names — a boot whose file carries `hashline.maxDiffChars: 35000` with NO settings leaf — is lane check W13**: the served namespace's `base` is `35000`, not the schema default `20000`, captured from the running host (`settings/mutate` response descriptor, whose `base` comes from `settings.describe`). The boot log carries `registered the "mpd" namespace with the file-derived base`.

**Still NOT in scope (named follow-up, unchanged):** moving the `mpd-config` row in `packages/mpd-bundle/cordis.patch.yml` (line 216, before the settings provider and the TUI at line 300). The row order is worked around in code by the deferred registration + the deterministic owner check; the patch change stays the captain's.

## 3c. Rule-by-rule citations for the reviewer

| Rule (design) | Where it is proven |
|---|---|
| §A.1 cardinality 1 / 0 / N, no `process.cwd()` fallback | lane W1-W10 (1 root writes) · W-checks + U13 (0 roots) · lane A1-A5 + U14 (N roots refuse; the lane's injected-fault control re-runs the engine on a fan-out fault and must go red) |
| §10.3 reason names (`no-live-session`, `ambiguous-multi-root`, `disabled`, `unparsable`, `span-not-proven`, `ambiguous-intermediate`, `read-only`, `conflict`) | `bridge.test.ts` U9/U10/U13/U14 + `jsonc-edit.test.ts` (each reason asserted by NAME) |
| §B.2 E1-E11 (escapes, comments, order, trailing commas, duplicate keys, CRLF, insert-as-last, CAS, unparsable, missing target, read-only) | `jsonc-edit.test.ts` U1-U9 + `bridge.test.ts` byte-fidelity and CAS tests |
| §B.2/E5, D-11, U6, §10.3, §10.6 — duplicated LEAF ⇒ LAST occurrence; duplicated INTERMEDIATE ⇒ refuse | `jsonc-edit.test.ts` (rewritten this wave to the design's rule; the earlier refusal is recorded as superseded) |
| §10.4 both directions (L0<L1<L2<L3 read; write lands in L3 **and** L2; a file edit clears the override; L1 is never "fixed up") | `settings-wiring.test.ts` (L3 wins; reset; the clearing rule; L2-only writes) |
| §10.2 module/API names + the A6 switch (`config.writeBack`, plus the nested spelling) | module paths `src/jsonc-edit.ts` + `src/bridge.ts`; exported `locateValueSpan`/`DELETE`/`EditResult`/`EditRefusal`; both switch spellings tested; the lane composes the design's flat key |
| §10.1 ownership, fallback guard, file-derived base | §3b above: the three-composition ownership test, the deferred registration, the deterministic owner check, and lane **W13** |
| §D.2 hint + runtime notice; §D.1 `applies:'restart'` honesty | built TUI bytes T1-T6, T8; the status line publishes a notice per skip reason; every report carries `applies:'restart'` |
| §9.3 F1/F2/F4/F5 | lane W2-W6 (F1/F2), A1-A5 (F5), U13 (F4) |
| §C de-scoped: W1 witnessed, W2 witnessed, W3 NOT-CLAIMED | lane `cardClaim` block + the card test file |

## 4. Design conformance changes made in this final round

1. **Duplicate keys — the design's rule now implemented (a behaviour CHANGE away from my earlier
   refusal).** The design states it in five places (E5, D-11, U6, §10.3, §10.6): a duplicated LEAF is
   edited at its **LAST** occurrence (the member `JSON.parse` reads), and only a duplicated
   **intermediate** refuses (`ambiguous-intermediate`). My first implementation refused both, on the
   strength of an earlier captain ruling. Since the captain's latest message names the canonical design
   and makes §B binding, the code now follows the design, the tests were rewritten to the design's U6
   fixture, and the previous behaviour is recorded here rather than silently dropped.
2. **Refusal vocabulary aligned to the design**: `ambiguous-intermediate` (was
   `duplicate-intermediate`), `span-not-proven` (was `not-found`), `unsupported-shape` (was
   `path-shape` and `value-not-serialisable`); E11 keeps the status `denied` and now carries the
   §10.3 reason `read-only`.
3. **§D.2's runtime notice is now real, not just text**: the exact sentence is published on the TUI
   status line while the last write-back was skipped for `no-live-session` (and it disappears again
   after a successful one).

## 5. Open items (for t36 / the captain)

1. **Ownership** follows captain ruling 1 (`mpd-tui-plugin` registers the namespace; `mpd-config` only
   reads/writes through the adapter seam), so design §10.1/§5/D-9's file-derived namespace `base`
   (§1.1/§1.3) is **not** implemented. The L3-over-file precedence is.
2. **Row order** (`mpd-config` line 216, `mpd-tui` line 300 in `packages/mpd-bundle/cordis.patch.yml`)
   keeps L3 out of a consumer's apply-time snapshot; `mpd_config_get`/`mpd_config_reload` see it
   immediately and the file is the durable home. Making L3 visible at mount needs a patch change
   outside this task's `inScope`.
3. **§7 item 3** is now fixed by the design's own erratum (t40) — no action for me.
4. **Out of scope, needs routing (docs)**: stale "not bridged" prose in `docs/tui.md` §6.2 + §191,
   `docs/tui.zh-CN.md:170`, `packages/mpd-tui-plugin/README.md` #2 + :119 (and the README pairs) — plus
   the captain's ruling 1 asks the docs to carry the three target cases and the sentence
   **"the edit did not reach any file ≠ the edit was lost: the value lives in the host settings document
   and applies to every workspace immediately"**. Also `package.json` `test:qa:all` should gain
   `web-settings-bridge` + `tui-settings-bridge` (the default `test:qa` sweep already runs both
   self-tests).
5. **Record**: t35 is terminal (`completed`), so this round could not be posted as a new attempt;
   the amended deliverable lives in this evidence directory.

## 6. Files changed by t35 (final)

`packages/mpd-config-plugin/src/{jsonc-edit,bridge,index}.ts` + `dist/index.js` + 4 test files ·
`packages/mpd-dsh-adapter-plugin/src/index.ts` + `dist/index.js` + `test/adapter.test.ts` ·
`packages/mpd-tui-plugin/test/two-plugin-ownership.test.ts` (the §10.1 guard proof) ·
`packages/mpd-config-plugin/src/settings-schema.ts` (the ONE source for the schema, the six knobs and both disclosures) ·
`packages/mpd-tui-plugin/src/{settings,state,status,index,types}.ts` + `dist/index.js` + `test/plugin.test.ts` + `skills/mpd-tui/SKILL.md` ·
`skills/dsh-qa/scripts/{web-settings-bridge.mjs,tui-settings-bridge.mjs,lib/settings-bridge-lane.mjs,tui-panels.mjs,extension-isolation.mjs}` + `skills/dsh-qa/SKILL.md` ·
`evidence/mpd-bridge/implementation/20260915T080138Z/**`.
`packages/mpd-bundle-plugin/src/settings-card.js` + `src/web-client.js` + `client.js` + `test/settings-card.test.mjs` + the two updated test files · `scripts/build-mpd-client.mjs` (the one embedded-module line for the card).
**Nothing** in `docs/`, `README*.md`, `VENDOR_LOCK.json`.
