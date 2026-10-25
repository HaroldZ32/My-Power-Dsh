# Lane record — `pkg-readmes-a` (contract `.mpd/plans/audit-20261025-fixes.md` §6, P-01 … P-10)

Owner: `pkg-readmes-a` (shared task T2), team `audit-20261025`, branch `fix/audit-20261025`.
Scope actually touched: the six `packages/<pkg>/{README.md,README.zh-CN.md}` pairs listed in §6 and
this evidence directory. No `src/**` was edited; `git diff --stat -- <the 12 README paths>` is the
check (see §4 below).

Gates (re-run AFTER the last edit of this lane; logs beside this file):

| Gate | Command | Result |
|---|---|---|
| Doc pairs | `bun run verify:docs` | **PASS** (exit 0) — `pairs=50 failed=0 violations=0 links=447 dead=0`; log `verify-docs.log` |
| Plugin manifest | `bun run verify:manifest` | **PASS** (exit 0) — `VERDICT: PASS — the install-time rules and the packaging contract hold.`; log `verify-manifest.log` |

Measurement moment of the gate logs: `measured-at.txt` (UTC). Every claim below was derived by
opening the cited source in this session; no claim is a translation of the stale sentence.

---

## 1. Item-by-item record

### P-01 (HIGH) `packages/mpd-bundle/README.md` — the complexity gate's default was INVERTED

- **Claim before.** "`off` (**the DEFAULT** — an ABSENT or unknown value reads `off` … so the
  ceremony is opt-in and a typo can never arm it)" (mode paragraph) and "`team.gate` — `off`
  (**the DEFAULT since the 2026-10-17 rollback**; the gate is opt-in)" (Configuration plane). The
  section heading also called the gate "OPT-IN", and one sentence called the preset's default
  "opt-in".
- **New text.** Both occurrences now say `mechanical` is the default since the 2026-10-20 restore;
  an ABSENT key and every UNKNOWN value (`"bogus"`, `0`, an object, the legacy `true`) read
  `mechanical`, and only `"off"` / `false` disarm. The heading reads "ON by default" and the
  persona sentence says "its `mechanical` default".
- **Proof.** `resolveGateMode` in `packages/mpd-roles-plugin/src/complexity-gate.ts`:
  `advisory → advisory`, `off | false → off`, **everything else → mechanical**, with its doc comment
  "`mechanical` is the DEFAULT again (2026-10-20 ruling) … a typo can never silently disable the
  session-start rule". `GATE_MODE_MECHANICAL` carries the same statement on the type.
- zh twin: same statements, 简体中文 (`默认值 … mechanical`, `只有 "off" 与 false 会关闭`).

### P-02 (HIGH) `packages/mpd-bundle/README.md` — "TWO preset id-targets" does not exist

- **Claim before.** "Preset selection has **TWO** id-targets, one per plane, both naming the same
  package with `config.default: mpd`", followed by a defence of the second id-target.
- **New text.** A `### Preset selection — the user's own default` subsection: there is NO preset
  id-target in the bundle (strict zero-override, user decision 2026-10-02); both registry rows are
  HOST-owned and an id-target would REPLACE a host decision, which `verify-no-host-override.ts`
  fails; an additive second registry row is not a workaround because a duplicate `provide` of
  `agentPresets` is a hard cordis boot error. The deployment default is the user's to choose:
  web/headless → the registry entry's `selectedDefault` set from Settings (the bundle writes
  nothing); dsh-tui → `/preset mpd` (persists `{ "preset": "mpd" }` to
  `~/.dsh-tui/agent-preset.json`), `DSH_TUI_PRESET=mpd` (wins over the persisted preference), or
  `node scripts/set-default-preset.ts --yes` (dry-run by default). Consequence stated: without that
  action a profile keeps the host default `standard`, and on the documented dsh-tui plane
  (0.12.0, its row id / `default: standard` config / `presets/liangshen/` re-verified against
  0.13.0) no `standard` preset row exists, so the session composes with `agent-preset/not-found`.
  The last sentence still states the `mpd` preset is declared by `presets/mpd.patch.yml`
  (row `preset-mpd`).
- **Proof.** `cordis.patch.yml` lines 39–113: the two REMOVED id-target blocks (2026-10-02), the
  measured duplicate-`provide` reason, and the three user channels. `scripts/set-default-preset.ts`
  header: mirrors dsh-tui's own `writePresetPref` byte shape, writes nothing for web/headless and
  prints the two supported paths; `--yes` required for a write. `docs/preset-default.md`
  §"Option 3 — web and headless: the Settings `selectedDefault`".
- zh twin: same subsection, same four facts.

### P-03 (HIGH) `packages/mpd-bundle/README.md` — "three mechanical guards WITHDRAWN"

- **Claim before.** "The captain's three mechanical guards (investigation, delegation, write) are
  WITHDRAWN by the same ruling; the row's boot line reports each as `absent reason=…`."
- **New text.** Only the WRITE guard is withdrawn (`verifyGate=absent reason=…`);
  `installCaptainInvestigationGuard` (`captain.investigation`, `"deny"` default | `"allow"`) and
  `installDelegationGate` (`delegation.gate`, `"deny"` default | `"captain"` | `"allow"`) ARE
  installed by the same row and the boot line reports `captainInvestigation=<mode>` /
  `delegationGate=<mode>` — `absent reason=…` only when the seam itself is missing.
- **Proof.** `packages/mpd-roles-plugin/src/index.ts` (the two `install*` calls and the
  `guardOutcome.push` lines that format `<mode>` / `absent reason=`; the comment "`verify.mode`
  (the write guard) stays withdrawn"); `captain-investigation.ts`
  `DEFAULT_INVESTIGATION_MODE`/`resolveInvestigationMode`; `delegation-gate.ts`
  `DEFAULT_DELEGATION_GATE_MODE`/`DelegationGateMode`.
- zh twin: same statements (`captainInvestigation=<mode>` / `delegationGate=<mode>`).

### P-04 (MEDIUM) `packages/mpd-bundle/README.md` — the soft-signal list quoted the wrong row

- **Claim before.** "(**B**) ≥ 4 distinct deliverable verbs, (**C**) ONE signal satisfied by 2 of
  its 3 sub-signals (≥ 3 enumerated lines, ≥ 3 distinct action verbs, ≥ 3 action clauses), and
  (**D**) an ACTIVE boulder work" — the `normal` numbers, with E and F absent.
- **New text.** The list now states the DEFAULT (`easy`) row and names the selector:
  `team.sensitivity` via `resolveSensitivity` (absent or unknown → `easy`, default since
  2026-10-22): B ≥ 2 deliverable verbs; C 2-of-3 with each sub-signal at 2; D an ACTIVE boulder
  work; E ≥ 24 Han characters AND ≥ 2 distinct action verbs; F workspace scale = ONE bounded root
  listing with ≥ 1 project manifest, ≥ 1 conventional project directory and ≥ 8 visible entries
  (dotfiles never count), evaluated on the `easy` row only. It then names `normal` (B=4, C 2-of-3
  with each sub-signal at 3, E=60, F off) and `strict` (B=6, C 3-of-3 with each sub-signal at 4,
  E=80, F off) and points at `SENSITIVITY_THRESHOLDS` for the table.
- **Proof.** `complexity-gate.ts`: `GATE_SENSITIVITY_EASY`, `resolveSensitivity` (total, `easy`
  fallback), `SENSITIVITY_THRESHOLDS` (easy/normal/strict rows exactly as restated),
  `evaluateComplexityGate` (B/C/D/E/F wiring), `readWorkspaceScale` + `WORKSPACE_MANIFESTS` /
  `WORKSPACE_PROJECT_DIRS` / `WORKSPACE_VISIBLE_ENTRIES_MIN = 8` (dotfiles excluded).
- zh twin: same row, same numbers.

### P-05 (MEDIUM) `packages/mpd-config-plugin/README.md` — a dead key and a selectable value

- **Changed (dead key).** The known-key list said `hashline.enabled/guardEditTools`; it now says
  `hashline.guardEditTools/maxDiffChars/registryFile`.
  **Proof.** `packages/mpd-hashline-plugin/src/index.ts` `type Config = { guardEditTools?;
  maxDiffChars?; registryFile? }` and the three `v("hashline.*")` reads; `grep -rn "hashline.enabled"
  packages/` returns no reader at all. `mpd_config_get`'s description also lists exactly those three
  leaves.
- **Changed (`memory.vcs`).** Kept `git | svn | both` and stated the current reachability truth:
  `both` is selectable in Settings as well, because the `SettingsSchema` union and the
  `SETTINGS_KNOBS` option list both carry it.
  **Proof.** `packages/mpd-memory-plugin/src/index.ts` `Config` and the parser accept
  `"git" | "svn" | "both"` (`ensureVcs` commits to each when `both`);
  `packages/mpd-config-plugin/src/settings-schema.ts` line 126
  `vcs: z.union([z.const("git"), z.const("svn"), z.const("both")]).default("git")` and line 434
  `options: ["git", "svn", "both"]`.
  **Sequence recorded honestly:** at this lane's first check D-09 was NOT on disk (the union and the
  knob options were `git | svn`, so the sentence was first written as "hand-edit only"). D-09 landed
  while this lane ran; re-verified on disk at **2026-10-25T12:17:32Z** (the two lines above), and the
  sentence was flipped to "selectable" at that point. So the final pair describes the post-D-09 tree,
  which is the tree the wave merges.
- zh twin: same two corrections.

### Report a source-level finding: none beyond the above

No `src/**` file was edited by this lane. D-09 is the code-fixer's edit, observed and relied on, not
written here.

### P-06 (MEDIUM) `packages/mpd-comment-checker-plugin/README.md` — wrong resolution order

- **Claim before.** "Resolution order: dependency (package-relative via createRequire) →
  `MPD_DSH_COMMENT_CHECKER_BIN` → dev-toolchain fallback", with no `config.binary`.
- **New text.** "Resolution order (`resolveBinary`): an explicit `config.binary` (the
  `commentChecker.bin` leaf) → `MPD_DSH_COMMENT_CHECKER_BIN` → the installed optional dependency
  (package-relative `createRequire`, then its `vendor/<platform>/comment-checker`) → the repo-local
  `.toolchain` copies for checkout QA. Every candidate must exist on disk; with none the tool call
  errors and the post-edit hook leaves the decision untouched." The Install paragraph's override
  hint now names `commentChecker.bin` before the env var.
- **Proof.** `packages/mpd-comment-checker-plugin/src/index.ts`: `resolveBinary(config)` checks
  `config.binary` → `process.env.MPD_DSH_COMMENT_CHECKER_BIN` → `dependencyBinary()` (a
  `createRequire(import.meta.url)` resolve of the package.json, then `vendor/<platformKey()>`) →
  the two `.toolchain` candidates; the tool throws when null; the `onPostToolExecute` hook returns
  `out` unchanged when null. `effectiveConfig` maps the `commentChecker.bin` leaf.
- zh twin: same order and same failure behaviour.

### P-07 (MEDIUM) `packages/mpd-modelchain-plugin/README.md` — the routing precedence omitted the slot

- **Claim before.** "The roster's own `chain[0]` answers; a role carrying no chain of its own falls
  back to the shipped/configured table." (No slot anywhere; the Usage example also promised a
  concrete `deepseek-v4-flash` route.)
- **New text.** Precedence is the SLOT FIRST (`slotResolutionIn`): a slot-routed member answers from
  its slot ALONE (primary + its own `fallbacks`, `status: "configured"`); a routed-but-unusable slot
  (missing or malformed leaf) answers empty `provider`/`model` with `status: "unconfigured"` and a
  reason naming the offending `teamModels.slotN`, never a shipped route; only an `unrouted` member
  falls through to the live `modelchain.<id>` overlay, then the roster's `chain[0]`, then the merged
  shipped/configured table. The Usage example now shows both outcomes instead of a promised route.
- **Proof.** `packages/mpd-modelchain-plugin/src/index.ts` `mpd_modelchain_resolve.execute`:
  `slotResolutionIn` → `slot.ok` branch returns `status: "configured"` with
  `[primary, ...fallbacks]`; `slot.status !== "unrouted"` branch returns
  `provider: "" / model: "" / status: "unconfigured"`; the fall-through is
  `overlayNow(ctx)[spec.id]` → `spec.chain` → `resolveRole(spec.id, chainsNow(...))`.
  `packages/mpd-config-plugin/src/index.ts` `SlotResolved` / `SlotUnusable` (`status:
  "unconfigured" | "invalid"`) / `SlotUnrouted`, and `slotResolutionOf` as the total read the tool
  mirrors structurally.
- zh twin: same precedence and same two example outcomes.

### P-08 (MEDIUM) `packages/mpd-modelchain-plugin/README.md` — "Config — None; stateless" is false

- **Claim before.** "## Config — None; the row is stateless."
- **New text.** Two optional keys, `Config = { memoryFile?, chains? }`: `memoryFile` resolves against
  the calling session's workspace root, absent → `<workspace>/.mpd/memory.json` (`memoryPath`);
  `chains` is a per-role table overriding the shipped `DEFAULT_CHAINS` key by key
  (`resolveRole` still answers an absent key from the shipped table, then `sisyphus`), and a live
  `modelchain.<key>` leaf read through `mpdConfig` outranks both, per call. Plus: the chain table is
  re-resolved every call (`chainsNow`, `overlayNow`), never frozen at `apply`.
- **Proof.** Same file: `type Config = { memoryFile?: string; chains?: Record<string,
  Array<{provider, model}>> }`; `memoryPath`; `chainsNow`
  (`{ ...(config?.chains ?? DEFAULT_CHAINS), ...overlayNow(ctx) }`); `overlayNow` (the
  `modelchain.<key>` leaf read, keys = the shipped chain keys); `resolveRole`'s
  `chains[key] ?? DEFAULT_CHAINS[key] ?? DEFAULT_CHAINS.sisyphus`; the roster ids ARE the chain
  keys (`packages/mpd-roles-plugin/src/roles.data.ts`, e.g. `oracle`/`sisyphus`/`prometheus`), which
  is what makes the per-id overlay and the resolver agree.
- zh twin: same two keys and the same state-file default.

### P-09 (MEDIUM) `packages/mpd-ulw-plugin/README.md` — the gate's signals were misdescribed

- **Claim before.** Item 2 of the autonomy policy: "the run evaluates the session-start predicate:
  an explicit `team:` / `!team` flag OR any matched signal (A explicit flag, B deliverable verbs,
  C enumerated steps, **D an existing `.mpd/plans` artifact**)."
- **New text.** The gate is evaluated MECHANICALLY before the directive is injected, with the SAME
  predicate (`evaluateComplexityGate`), the SAME `team.sensitivity` row (`resolveSensitivity`;
  absent/unknown → `easy`, the default) and the same inputs: A explicit flag; B distinct deliverable
  verbs; **C THREE sub-signals, each scored against the row's own threshold — enumerated lines
  (numbered / bulleted / table rows), distinct action verbs, and clauses that OPEN with an action
  verb — of which at least `cSubSignals` must hold**; **D an ACTIVE boulder work
  (`readBoulderGate`'s `active`; a `.mpd/plans` FILE is not a signal)**; **E BOTH the row's
  Han-character threshold AND its distinct action-verb threshold** (the count C2 reads); F
  large-workspace scale (`readWorkspaceScale`, `easy` row only). It names the `easy` numbers
  (C1/C2/C3 at ≥ 2 each with 2 of the 3 holding; E at ≥ 24 Han characters AND ≥ 2 distinct action
  verbs) and points at `SENSITIVITY_THRESHOLDS`. It also states that `team.gate: off` returns BEFORE
  the predicate runs, `mechanical` stages the shell on a fire, and `advisory` reports the verdict and
  stages nothing. (C's and E's sub-thresholds were added by the CodeRabbit repair — §5.)
- **Proof.** `packages/mpd-ulw-plugin/src/index.ts` `apply`/activation path:
  `resolveGateMode(...)`, the `mode === GATE_MODE_OFF` early return, `resolveSensitivity(...)`,
  `readBoulderGate(workspace, …)`, the `SENSITIVITY_THRESHOLDS[sensitivity].workspaceScale` gate
  around `readWorkspaceScale(workspace)`, and
  `evaluateComplexityGate(objective, { explicitFlag, activeBoulder: boulder.active, sensitivity,
  workspaceScale })`. The C/E wording is proven by `complexity-gate.ts` itself:
  `SensitivityThresholds` (`enumeratedLines` / `actionVerbs` / `clauseSteps` / `cSubSignals` /
  `cjkChars` / `cjkVerbs`), `SENSITIVITY_THRESHOLDS.easy` (2/2/2 with `cSubSignals: 2`; `cjkChars:
  24`, `cjkVerbs: 2`), `enumeratedLineCount` (`ENUMERATED_LINE_PATTERN`), `clauseStepCount`
  (`CLAUSE_SEPARATOR_PATTERN` + the row's clause-opener lexicon), `cjkCharCount` (`CJK_CHAR_PATTERN`
  = `\p{Script=Han}` occurrences) and the shared `distinctMatches` action-verb count that both C2 and
  E read. The package's own directive text names "signal A-F" and "D an active boulder work".
- zh twin: same correction, same list.

### P-10 (LOW) `packages/mpd-codegraph-plugin/README.md` — an undocumented default

- **Claim before.** The config table's `cooldownMs` default cell was `—`.
- **New text.** `900000` (`15 * 60_000`, i.e. 15 minutes), plus one sentence: the window after a
  failed `codegraph init` during which the next attempt is skipped — `cooldownFresh` compares the
  `.codegraph/init.cooldown` stamp's age against it, so a broken binary cannot retry on every boot.
- **Proof.** `packages/mpd-codegraph-plugin/src/index.ts`:
  `const cooldownMs = config.cooldownMs ?? 15 * 60_000`, its comment "How long a failed init
  suppresses the next attempt", `cooldownFresh` (`age < cooldownMs` against the stamp's mtime), and
  the apply ladder's `cooldownFresh(cwd, cooldownMs) → status = "cooldown"` branch.
- zh twin: same value and same semantics.

---

## 2. Items NOT fixed in this lane

None of P-01 … P-10 was skipped, and no follow-up is left open. The only conditional item was
**P-05 (`memory.vcs: both`)**: at the first check the contract's D-09 change was not on disk, so the
README said "hand-edit only"; D-09 landed while this lane ran (re-verified
**2026-10-25T12:17:32Z**), and the sentence was flipped to "selectable in Settings as well" after
reading both changed leaves. Nothing else in this lane depends on another lane's edit.

## 3. Bounds — what this lane did NOT prove

- No boot, no tool call, no runtime observation. Every sentence is derived from source symbols read
  in this session; the two required gates are static checks (doc pairs, manifest/packaging) and say
  nothing about plugin behaviour.
- No `src/**` change was made, so no source defect found while reading was fixed here. The only
  source-level fact recorded for someone else is the P-05/D-09 dependency above.
- The `packages/mpd-bundle/README.md` claims about the *host* (`@deepseek-ai/dsh-web-app` /
  `dsh-tui` rows) are restated from this repository's own `cordis.patch.yml` measurements, not
  re-measured against an installed harness in this lane.
- Pre-existing text outside the ten items was left alone (minimal diff), including the bundle's
  host-row inventory and the modelchain service-usage paragraph.

## 4. Scope check (reproducible)

```
git diff --stat -- \
  packages/mpd-bundle/README.md packages/mpd-bundle/README.zh-CN.md \
  packages/mpd-config-plugin/README.md packages/mpd-config-plugin/README.zh-CN.md \
  packages/mpd-comment-checker-plugin/README.md packages/mpd-comment-checker-plugin/README.zh-CN.md \
  packages/mpd-modelchain-plugin/README.md packages/mpd-modelchain-plugin/README.zh-CN.md \
  packages/mpd-ulw-plugin/README.md packages/mpd-ulw-plugin/README.zh-CN.md \
  packages/mpd-codegraph-plugin/README.md packages/mpd-codegraph-plugin/README.zh-CN.md
```

12 files changed; no other path in this lane's diff (`src/**` untouched, `dist/**` untouched,
`VENDOR_LOCK.json` untouched, `AGENTS.md` untouched). The T13 CodeRabbit repair below touches two of
those twelve again (`packages/mpd-ulw-plugin/README{,.zh-CN}.md`), so the count is unchanged.

## 5. CodeRabbit repair (T13, AMENDMENT 4) — `packages/mpd-ulw-plugin` gate signals C and E

- **Finding.** CodeRabbit review of PR #66, comment `id=4370975289` on
  `packages/mpd-ulw-plugin/README.md:25` (Minor · Functional Correctness · Quick win): "Document all
  sub-signals for C and E. `evaluateComplexityGate` does not define C as enumerated steps alone. C
  uses the sensitivity row's threshold across enumerated lines, action verbs, and clause steps. E
  requires both the CJK-character threshold and the action-verb threshold. Update this text and
  `README.zh-CN.md:16` so users can predict the gate result."
  Reconciliation: **STILL-VALID → FIXED** — the P-09 wording said "C enumerated steps" and "E a
  CJK-scale instruction", which is exactly the under-description the comment names.
- **New text (EN item 2).** Signal C is now "THREE sub-signals, each scored against the row's own
  threshold — enumerated lines (numbered / bulleted / table rows), distinct action verbs, and clauses
  that OPEN with an action verb — of which at least `cSubSignals` must hold"; signal E is "BOTH the
  row's Han-character threshold AND its distinct action-verb threshold (the same count C2 reads)".
  The paragraph names the `easy` numbers ("C1/C2/C3 at ≥ 2 each with 2 of the 3 holding, and E at
  ≥ 24 Han characters AND ≥ 2 distinct action verbs") and points at `SENSITIVITY_THRESHOLDS` for the
  other rows. The default row stays named (`resolveSensitivity`; absent or unknown reads `easy`).
- **zh twin.** The same statements on `README.zh-CN.md:16`: 三路子信号 + `cSubSignals`; C1/C2/C3 各需
  ≥ 2 且三路中至少 2 路成立; E 需**同时**满足汉字数与动作动词数阈值; `easy` 数字; `SENSITIVITY_THRESHOLDS`
  指针.
- **Proof symbols** (`packages/mpd-roles-plugin/src/complexity-gate.ts`, read this session):
  `evaluateComplexityGate`'s C branch — `enumeratedLineCount(...) >= thresholds.enumeratedLines`,
  `actionVerbs >= thresholds.actionVerbs`, `clauseStepCount(...) >= thresholds.clauseSteps`, then
  `cSubSignals >= thresholds.cSubSignals`; its E branch —
  `cjkCharCount(source) >= thresholds.cjkChars && actionVerbs >= thresholds.cjkVerbs`;
  `SENSITIVITY_THRESHOLDS.easy` — `enumeratedLines: 2`, `actionVerbs: 2`, `clauseSteps: 2`,
  `cSubSignals: 2`, `cjkChars: 24`, `cjkVerbs: 2`; `ENUMERATED_LINE_PATTERN` (numbered / bulleted /
  table rows); `clauseStepCount`'s `CLAUSE_SEPARATOR_PATTERN`; `cjkCharCount`'s `CJK_CHAR_PATTERN`
  (`\p{Script=Han}` occurrences); `distinctMatches` (the distinct action-verb count both C2 and E
  read).
- **Gate.** `bun run verify:docs` → **exit 0**,
  `pairs=50 failed=0 violations=0 links=449 dead=0 — PASS` (final measurement after all edits:
  **2026-10-25T13:30:21Z**; the intervening run at 13:29:07Z produced the identical line).
- **Files touched by this repair.** `packages/mpd-ulw-plugin/README.md` and
  `packages/mpd-ulw-plugin/README.zh-CN.md` only — `git diff --stat` for the pair: 13 insertions, 8
  deletions.
- **Out-of-scope observation (NOT changed).** `ULW_ACTIVATION_DIRECTIVE` in
  `packages/mpd-ulw-plugin/src/index.ts` summarizes the same two signals as "C enumerated steps" and
  "E a CJK-scale instruction" in its "2. GATE" line. That is a `src/**` file outside this repair's
  write scope; if the runtime directive should carry the same sub-threshold detail, it is a separate
  `src/**` edit with its own `dist` rebuild — flagged to the Lead rather than absorbed here.
