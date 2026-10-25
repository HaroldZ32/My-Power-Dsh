# Lane report — `pkg-readmes-b` (P-11 … P-17)

Branch: `fix/audit-20261025`
Contract: `.mpd/plans/audit-20261025-fixes.md` §7 "PACKAGE READMEs — GROUP B" (items P-11 … P-17).
Scope edited (12 files, EN + zh twin each): `packages/mpd-tui-plugin`, `packages/mpd-bundle-plugin`,
`packages/mpd-mcp-lsp`, `packages/mpd-team-compact-plugin`, `packages/mpd-team-core-plugin`,
`packages/mpd-verify-plugin` — `README.md` + `README.zh-CN.md` only. No `src/**`, no `dist/**`,
no `VENDOR_LOCK.json`, no git write command.

Every new sentence below is derived from a symbol opened in this session; the zh twin says the same
thing (not a translation of the stale claim). Symbols are cited by name, never by line number (T-55).

---

## P-11 (MEDIUM) — the settings bridge needs no restart

**Claim before** (`packages/mpd-tui-plugin/README.md`, three sites in EN, three in the zh twin):

1. settings table row: "**bridged** to `<workspace>/.mpd/mpd.jsonc` (a save writes the file; the plugin
   behaviour needs a restart); every field hint says so on screen";
2. NOT CLAIMED #2 heading: "**The `/settings` section IS bridged to `<workspace>/.mpd/mpd.jsonc`, and
   the behaviour change needs a restart.**";
3. the on-screen quote: "…carries `a save writes <workspace>/.mpd/mpd.jsonc for the live session
   workspace(s) and takes effect for the mpd plugins after a restart (this knob is read at plugin
   mount)`, followed by the clause that a settings-only save is never a lost save";
   zh twin (stronger and more wrong): "保存会写入文件；插件行为需重启后生效".

**New text (EN)** — the table cell now says "a save writes the file and takes effect in the RUNNING
process — no restart: the config service re-resolves on every settings save and on a watched edit of
the project file, and the model routes are read per use"; NOT CLAIMED #2 is retitled "…and a save
takes effect in the RUNNING process" and now states: the config row arms a file watcher at mount
(`watchRoot`) and subscribes to the entry-config document, so its `state` re-resolves on every
settings save and on a watched edit of the project file; the model routes (`teamModels`,
`modelchain`) are read PER USE; what still waits for a boot is exactly ONE class — a knob some plugin
CAPTURED at its own mount (`BRIDGE_RESTART_LIMIT`).

**Code evidence**

- `BRIDGE_DISCLOSURE` (`packages/mpd-config-plugin/src/settings-schema.ts`) — verbatim: "…takes effect
  in the RUNNING process — no restart: the config service re-resolves on every settings save and on a
  watched edit of the project file, and the model routes (teamModels, modelchain) are read per use, so
  the next spawn or resolve carries them".
- `BRIDGE_RESTART_LIMIT` (same file) — narrows the residual class to "a knob some plugin captured at
  its own mount instead of reading the live config service per use — the model routes above are not
  such knobs".
- `packages/mpd-tui-plugin/src/settings.ts` header — "the old 'a RUNNING session's plugin behaviour
  changes only after a restart' claim is DELETED, not softened — the config row now arms a file
  watcher at mount AND subscribes to the entry-config document, so its `state` re-resolves on every
  settings save and on a watched edit of the project file."
- `watchRoot` (`packages/mpd-config-plugin/src/index.ts`) — the mount-armed per-file watcher; the row's
  own warning text repeats the same truth ("the settings value still applies in the RUNNING process
  (no restart …) … only a knob some plugin captured at its own mount keeps its captured value until
  the next dsh boot").
- `packages/mpd-tui-plugin/test/plugin.test.ts` asserts `BRIDGE_DISCLOSURE` contains both "takes
  effect in the RUNNING process — no restart" and "read per use", so the shipped sentence is pinned.

**Also corrected in the same paragraph (P-13's per-row rule, same helper):** "only then state the key
and that disclosure" → "only then state the key", because the disclosure is not per row (see P-13).

**Removed, deliberately:** "The base is **fixed for the process lifetime** (the host exposes no
disposal handle for a live registration) — the honest reason the sentence below says 'after a
restart'". No reader in the current source states that any more, and `settings.ts` says the restart
claim is deleted. The new text therefore makes **no claim at all** about the `base`'s lifetime (its
cardinality rule is kept and unchanged) — the lane rule is "if you cannot settle it, write less".

---

## P-12 (LOW) — the seam count, and the page count

**Claim before:** "Supporting surfaces (not one of the seven seams): the `/mpd` command on the harness
command registry, the `mpd` settings namespace registration, and the log-only
`mpd-tui/board-opened` session record." zh: "支撑面（不属于上述七个接缝）…".
Plus the zh `workmate` knob row: "因此 MPD 的两个页可以分别开关 … 两个开关都需要重启生效".

**New text** — "Seam count and what sits outside it: the adapter's `TUI_SEAMS` table declares EIGHTEEN
entries — fifteen real `tui*` services, one **phantom** id (`tuiPrompt`, in `PHANTOM_SEAM_KEYS`: no
dsh-tui build declares it) and the two harness services `commands` and `settings`. The `/mpd` command
on the harness command registry and the `mpd` settings namespace registration are those last two,
while the log-only `mpd-tui/board-opened` session record is not a seam at all — it is appended only
after the event type is verified known to a reachable `dsh-session` copy."

**Code evidence**

- `TUI_SEAMS` (`packages/mpd-tui-adapter-plugin/src/index.ts`) — 18 keys: `scenes`, `status`,
  `renderers`, `settingsSections`, `shortcuts`, `dialogs`, `commandTrees`, `pluginHost`, `toast`,
  `themes`, `pluginStorage`, `messageObserver`, `effectLedger`, `workspaces`, `panels`, `prompt`,
  `commands`, `settings`. Sixteen carry a `tui*` id; `PHANTOM_SEAM_KEYS = ["prompt"]` marks
  `tuiPrompt` as the one no measured host declares, leaving **fifteen real `tui*` seams** + 1 phantom
  + the 2 harness services = 18.
- `packages/mpd-tui-plugin/src/i18n.ts` states the same fifteen ("`TUI_SEAMS` names fifteen `tui*`
  services").
- The old sentence was also self-contradictory: `commands` and `settings` are *in* the table, so they
  were never "supporting surfaces".
- The `mpd-tui/board-opened` record: the `sessionEvents` knob description — "append the log-only
  `mpd-tui/board-opened` record, and only after the event type is verified known to a reachable
  `dsh-session` copy".
- Three pages: the table's sidebar-pages row says **THREE** pages (`team`, `workmate`, `watchdog`) and
  three page knobs exist in the same README's knob table — `panel`, `workmate`, `watchdog`.

**Contract-premise correction (recorded, not silently absorbed):** the contract says to fix the zh
`workmate` row "that says 'MPD 的两个页' where EN says three". In fact the **EN** row said "the two MPD
pages toggle apart" and "both knobs are restart-scoped" as well — the stale count was in BOTH twins,
not just zh. Both now say three, and the row now names independence from `panel` **and** `watchdog`
(symmetry with the `watchdog` row, which already said "INDEPENDENT of `panel` and `workmate`").

---

## P-13 (MEDIUM) — the Web card's restart claim and the per-row disclosure

**Claim before** (`packages/mpd-bundle-plugin/README.md`):
(a) "both state the same bridge disclosure — a save writes `<workspace>/.mpd/mpd.jsonc` for the live
session workspace(s) **and the mpd plugins act on it after a restart**" (zh: "mpd 插件在重启后按其生效");
(b) "the human sentence renders at full readability **with the mandatory disclosure line dimmer
beneath it**. Both doors … carry the disclosure plus the not-lost clause AFTER that human sentence:
the TUI builds `<human sentence> mpd.jsonc <key> — <disclosure> <not-lost>`, and the card mirrors the
same declaration in the same order."

**New text** — (a) "…and takes effect in the RUNNING process, with no restart (`BRIDGE_DISCLOSURE`:
the same string in `settings-schema.ts` and in `settings-card.ts`)"; (b) "Both doors name the dotted
`mpd.jsonc` key through ONE helper — the hint is `<human sentence> (mpd.jsonc <key>)`, and a knob with
no human sentence keeps the pointer alone (`knobHint` in the TUI, `hintOf` on the card) — while the
bridge disclosure and the not-lost clause are stated ONCE per SECTION, never per row: the TUI carries
`SECTION_NOTICE` = `BRIDGE_DISCLOSURE` + `BRIDGE_NOT_LOST` in the section's own description, and the
card renders its disclosure block once at the top (`data-mpd-disclosure`)."

**Code evidence**

- `BRIDGE_DISCLOSURE` in `packages/mpd-bundle-plugin/src/settings-card.ts` — byte-identical to
  `settings-schema.ts`'s string (the card's own comment says so: "byte-identical to the TUI's
  BRIDGE_DISCLOSURE").
- `knobHint(key, semantics)` (`packages/mpd-config-plugin/src/settings-schema.ts`) — returns
  `` `${semantics} (${pointer})` `` where `pointer = \`mpd.jsonc ${key}\``, and the pointer alone when
  there is no human sentence.
- `hintOf(field, lang)` (`settings-card.ts`) — the same shape on the card: `${sentence} (${pointer})`.
- `SECTION_NOTICE` (`packages/mpd-tui-plugin/src/settings.ts`) — `= ${BRIDGE_DISCLOSURE} ${BRIDGE_NOT_LOST}`,
  carried in the section's `descriptions` (asserted by `test/plugin.test.ts`, which also asserts a
  per-row `field.hint` does **not** contain `BRIDGE_DISCLOSURE`).
- `BRIDGE_NOT_LOST` (`settings-schema.ts`) — "the value is never lost: it is stored in the host settings
  document and the config layer applies it to every workspace immediately — only the file write waits
  for exactly one live session".
- The card's disclosure block: one `<div>` with the four paragraphs tagged `data-mpd-disclosure`
  (`bridge`, `restart`, `not-lost`, `workspace`), commented "THE DISCLOSURE, ONCE, in its own `.help`
  block"; the not-lost paragraph's comment says it "used to ride every row's hint".

---

## P-14 (LOW) — the catalog split was off by one

**Claim before:** "…README/install page). **45 rows**." / "…checked one. **16 rows**." (zh: 共 45 行 / 共 16 行),
under a **59 rows** total.

**New text:** **44 rows** / **15 rows** (zh 共 44 行 / 共 15 行). The 59-row total was already correct.

**Code evidence — measured by importing the catalog, not by counting text**

```
$ bun -e 'const m = await import("./packages/mpd-mcp-lsp/src/server-catalog.ts"); …'
TOTAL 59
counts {"primary":44,"unverified":15}
uniqueIds 59
violations 0
```

`LANGUAGE_SERVERS` (`packages/mpd-mcp-lsp/src/server-catalog.ts`) holds 59 entries, 44 marked
`verification: "primary"` and 15 marked `"unverified"`; `validateServerCatalog` reports 0 violations.

**Why the old numbers were wrong, and how to reproduce the trap:** `grep -c 'verification: "primary"'`
prints 45 and `grep -c 'verification: "unverified"'` prints 16, because the interface field
`readonly verification: "primary" | "unverified"` on ONE line matches **both** patterns. The old
45/16 pair is exactly that off-by-one on each side (and sums to 61, not the 59 the same paragraph
states). A grep cannot settle this count; the import can.

---

## P-15 (LOW) — the terminal set

**Claim before:** "The terminal vocabulary is mirrored in `src/index.ts` (`TERMINAL_TASK_STATUSES`,
official `TeamTaskStatus = pending | in_progress | completed | deleted`) because the official package is
not resolvable…". The parenthesised union is the **full** status union, not the terminal set, so the
sentence never states what the pass actually treats as terminal.

**New text:** the set is `TERMINAL_TASK_STATUSES`: **completed, deleted, failed, cancelled**; the
harness union's terminal half is `completed` + `deleted`; `deleted` is in the set because `listTasks`
hides deleted rows; `failed`/`cancelled` are NOT in the union and are tolerated so a harness release
adding a terminal status can never make the module's destructive pass fire on unfinished work.

**Code evidence**

- `TERMINAL_TASK_STATUSES` (`packages/mpd-team-compact-plugin/src/index.ts`) =
  `["completed", "deleted", "failed", "cancelled"]`.
- Its doc comment supplies every clause above verbatim in substance: the official
  `TeamTaskStatus = "pending" | "in_progress" | "completed" | "deleted"`, "its terminal half is
  `completed` + `deleted`", "`deleted` is included because `listTasks` hides deleted rows, so a board
  the service reports as all-`completed` is terminal with or without it", and "`failed`/`cancelled` are
  NOT in the official union; they are tolerated so a harness release that adds a terminal status cannot
  make this module's destructive pass fire on unfinished work".
- `terminalTaskStatuses()` returns that constant, and the pass uses it (`apply`'s local
  `terminalStatuses`).

---

## P-16 (LOW) — two stale team-core statements

### (a) "The mailbox has no unread count"

**Claim before:** "The mailbox has no unread count: the official inbox exposes no read state, and
inventing one would misreport it." (zh: "信箱没有未读数：官方收件箱不暴露已读状态，硬造一个只会报错数。")
This contradicted the SAME README's Semantics section ("**THE MAILBOX IS OURS** … `agent_teams_mail`
owns `sent → delivered → read`") — it conflated the official plane's limit with this row's own store.

**New text:** the **OFFICIAL** inbox has no unread count (its durable state is `messages` +
`delivered`, a read state is not observable anywhere in it); that is a limit of that plane only — the
mpd mailbox counts unread (`unreadOf`, `summarise` → `MailSummary.unread`, computed oldest-first) and
`agent_teams_mail {action:"unread"|"summary"}` reports it.

**Code evidence** (`packages/mpd-team-core-plugin/src/mailbox-store.ts`): `MailMessage.readAt`,
`MailboxRecord` carrying `t: "read"`, `unreadOf` (`filter(readAt === undefined)`), `summarise` →
`MailSummary { total, unread, undelivered, oldestUnread }`, `markDelivered`/`markRead`; the file header
states the official mailbox keeps `state.messages` + `state.delivered` "and NOTHING ELSE", while "WHAT
IS OURS: `sent → delivered → read`". The tool row in the same README already advertised
`send`/`unread`/`read`/`summary`.

### (b) "native backend over `ctx.subagents.startContinuable` is the DEFAULT"

**Claim before:** "…the native backend over `ctx.subagents.startContinuable` is the DEFAULT and the
official `dsh.team*` calls are the FALLBACK" (zh: "原生后端 `ctx.subagents.startContinuable` 是**默认**").

**New text:** the native backend raises a durable child through `ctx.subagents.startActivation` on the
pinned host (harness 0.2.1+) and keeps the retired `ctx.subagents.startContinuable` only as the
older-host fallback (`CONTINUABLE_START_MEMBERS`, probed newest-first by `continuableStartMember`),
while the official `dsh.team*` calls are the FALLBACK.

**Code evidence** (`packages/mpd-dsh-adapter-plugin/src/index.ts`):
`CONTINUABLE_START_MEMBERS = ["startActivation", "startContinuable"]` ("the members that can raise a
durable child, NEWEST generation first"); `continuableStartMember` probes that order and returns the
first callable one; `startContinuableChild` calls the member and adds `delivery: "parent"` only on the
`startActivation` arm; the header states "Harness 0.2.1-rc.2 REMOVED `SubagentRuntime.startContinuable()`
and `.start()`". The `startContinuable`/`.start` arm therefore cannot be the default on the pinned host.

---

## P-17 (LOW) — the guard claim

**Claim before:** bound 7 — "…both were refused before… The band still refuses `packages/*/src/**`,
`packages/*/test/**` and any `..`-carrying spelling." (zh: "该可读带**仍然**拒绝 …"), while the SAME
README's bound 1 and its tool table say the guard is **withdrawn** (`installVerifyGuard` not installed).

**New text:** "That readable band is PROSE, not a fence: no shipped row installs `installVerifyGuard`,
so nothing refuses `packages/*/src/**`, `packages/*/test/**` or a `..`-carrying spelling — a seat keeps
to the band because the discipline says so, which is bound 1's point."

**Code evidence:** `installVerifyGuard` is **defined** in
`packages/mpd-roles-plugin/src/verify-guard.ts` and referenced elsewhere only by
`packages/mpd-verify-plugin/test/row.test.ts` (imports + 4 calls) and one comment in
`packages/mpd-roles-plugin/src/ask-user-guard.ts`. `grep -rl installVerifyGuard packages/*/src/`
returns `verify-guard.ts` (the definition) and `ask-user-guard.ts` (a comment) — **no `apply()` calls
it**, so no shipped composition installs it. The README's own table row already said the `mpd-roles`
row "NO LONGER INSTALLS it", and bound 1 says the row is "bookkeeping only". The two halves now agree.

---

## Checks run (quoted, with exit codes)

`bun run verify:docs` — **exit 0**, log: `evidence/audit-20261025/pkg-readmes-b/verify-docs.log`

```
[verify-docs-parity] root=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh pairs=50 failed=0 violations=0 exempt=24 derived=3 links=447 dead=0 — PASS
```

`bun run verify:manifest` — **exit 0**, log: `evidence/audit-20261025/pkg-readmes-b/verify-manifest.log`

```
ok    cordis-dependency: 9 declared dependency name(s) across dependencies/peerDependencies/optionalDependencies, none of them cordis
ok    lifecycle-script: 20 script name(s), none carrying preinstall/install/postinstall/prepare
ok    version:dsh-plugin.json: version = 0.15.4
ok    version:dsh-distribution.json: distribution.version = 0.15.4
ok    bundle-patch-files: 2 patch file(s) declared, 0 missing
ok    row-module-paths: 28 module path(s) named by the patch files, 0 missing, 0 patch file(s) unreadable
ok    files-allowlist: 25 pattern(s); 0 required path(s) not admitted
ok    evidence-excluded: the frozen evidence/ tree stays out of the published package
ok    packed-content: npm pack --dry-run lists 1042 file(s); 0 required path(s) absent

VERDICT: PASS — the install-time rules and the packaging contract hold.
```

`git diff --stat` for the 12 files: **84 insertions, 60 deletions**; `git status` shows **no** file of
mine outside the declared scope (the other modified paths belong to the other lanes — `docs/**`,
`packages/mpd-bundle/README*`, `mpd-config`/`mpd-modelchain`/`mpd-ulw`/`mpd-codegraph`/
`mpd-comment-checker` READMEs, and `src/**`).

## Honest bounds — what I did not prove

1. **No `dist/**` rebuild, by contract.** Docs-only change, so no `dist` or vendor re-pin was needed; I
   did not run `verify-dist-fresh` or `verify-vendor`.
2. **I ran the two gates this lane requires, not the full sweep** (`verify:gates`, tests, typecheck,
   pack closure, Docker). Those belong to the captain's sweep.
3. **The tree is shared.** Between my two `verify:manifest` runs another lane added
   `packages/mpd-team-core-plugin/test/adapter-identity.test.ts` (untracked, visible in `git status`),
   which moved the pack file count 1041 → 1042. Both runs exited 0; the delta is not mine.
4. **The `/settings` editor `base` lifetime is left unclaimed.** I removed the "fixed for the process
   lifetime" sentence rather than re-derive it: no current reader states it, and I could not settle
   whether the host registration re-derives a base after mount. The new text therefore claims only what
   `BRIDGE_DISCLOSURE` / `BRIDGE_RESTART_LIMIT` / `settings.ts` state. If the base turns out to be
   mount-fixed, only the DISPLAYED base could lag — the plugin behaviour is read per use, which is what
   the README now says.
5. **Untouched claims I did not audit** (outside P-11…P-17): the "26 in all / original 13 / twelve
   `teamModels` slot leaves" knob arithmetic, the sidebar `minColumns`/order/icon values, the `pollMs`
   interval, and the workmate-tab ids. They were not in my item list and I made no assertion about them.
6. **Contract-premise corrections** (recorded above, not silently absorbed): P-14's true split (44+15)
   was confirmed by import, and the README's 45/16 was the type-declaration grep trap; P-12's stale
   "two pages" count existed in the EN twin too, not only in zh.
7. **Verification law:** this report is the WRITER's evidence. A DIFFERENT agent must record the verdict
   against `.mpd/plans/audit-20261025-fixes.md`; nothing here is a PASS claim from a verifier.

---

# REPAIR (task T7) — the blanket "no restart" claim was FALSE

**Defect.** My first pass on P-11 / P-13 replaced a false "needs a restart" claim with an equally false
BLANKET "takes effect in the RUNNING process — no restart". I had trusted the shipped constant
(`BRIDGE_DISCLOSURE`) instead of reading the CONSUMERS. The captain's independent consumer read
established the correct shape and this lane repaired it. The old claim was wrong in the dangerous
direction: it promised immediacy for knobs a plugin captures at `apply()`.

**The truth (now stated in all four files).** The config service re-resolves immediately — the
READ-BACK is live (`mpd_config_get` reports a new value at once) — but a consumer reads its
configuration through the config service when it **mounts** (`apply()`). So the EFFECT is per knob:

- **live in the running process:** the model routes (`teamModels.slot*`, `modelchain.*`),
  `watchdog.*`, `team.gate` / `team.sensitivity`, the `team.stateDir` reader, and the two guards
  `captain.investigation` / `delegation.gate`. `tui.dashboardKey` is live ONE-WAY (read per keypress,
  but the take-over arms only after the host hands the session its live input kit).
- **captured at `apply()`, so they need the next `dsh` boot:** `hashline.*` (`maxDiffChars`,
  `guardEditTools`, `registryFile`), `commentChecker.*`, `ulw.*`, `memory.*`, `boulder.dir`, `goal.*`.
- The per-knob authority is **`docs/user-guide.md` §9.1** ("When a saved knob takes effect"), cited in
  both READMEs; the READMEs claim no more than that table.
- The not-lost clause is KEPT: a settings-only save is never lost — the host settings document keeps the
  value and the config layer applies it to every workspace immediately; only the FILE WRITE waits for a
  live session.
- The disclosure is described by its SHAPE (scoped, both halves rendered), never by quoting the old
  constants verbatim — the code lane is simultaneously scoping `BRIDGE_DISCLOSURE` /
  `BRIDGE_RESTART_LIMIT` and the card mirror.

**Code evidence for the per-knob split (opened this session)**

| Knob group | Proof in the tree |
|---|---|
| `hashline.*` mount-captured | `packages/mpd-hashline-plugin/src/index.ts`: `apply(ctx, config)` and `const maxDiffChars = cfg.maxDiffChars ?? 4000` inside it — the value is frozen at mount |
| `ulw.*` mount-captured | `packages/mpd-ulw-plugin/src/index.ts`: `apply(ctx, config)` and `const maxRounds = cfg.maxRounds ?? 6` inside it |
| `delegation.gate` live | `packages/mpd-roles-plugin/src/delegation-gate.ts` — the options doc says the reader is the row's `configValue`, "so a `.mpd/mpd.jsonc` edit is therefore picked up LIVE, T-18" |
| `captain.investigation` live | `packages/mpd-roles-plugin/src/captain-investigation.ts`: `installCaptainInvestigationGuard` calls `options.configValue(INVESTIGATION_CONFIG_KEY)` both at install (boot line) and inside the per-decision answer |
| `team.sensitivity` live | `packages/mpd-roles-plugin/src/session-gate.ts`: `resolveSensitivity(configValue(SENSITIVITY_CONFIG_KEY))` runs per gate invocation |
| `team.gate` live | `packages/mpd-roles-plugin/src/complexity-gate.ts`: "What a TRIGGER does is resolved per call by the wiring" |
| the whole table | `docs/user-guide.md` §9.1 rows: `hashline.*`/`commentChecker.*`/`ulw.*`/`goal.*`/`memory.*`/`boulder.dir` "at mount → after a restart"; `modelchain.*`/`teamModels.slot*`/`watchdog.*`/`team.stateDir` live |

**Files changed by the repair (4, EN + zh)**

- `packages/mpd-tui-plugin/README.md` + `README.zh-CN.md` — settings table cell, the NOT CLAIMED #2
  heading, and the two-group body (read-back vs effect, per-knob list, one-way `dashboardKey`, §9.1
  citation, not-lost clause kept).
- `packages/mpd-bundle-plugin/README.md` + `README.zh-CN.md` — the "TUI counterpart" disclosure sentence
  (scoped, not blanket) and the disclosure-shape paragraph, which now states that the card/section
  renders **BOTH halves** — the live half AND the mount-captured exception — not just the promising one.

**Checks re-run after the repair (quoted, with exit codes)**

`bun run verify:docs` — **exit 0**, log: `evidence/audit-20261025/pkg-readmes-b/verify-docs-repair.log`

```
[verify-docs-parity] root=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh pairs=50 failed=0 violations=0 exempt=24 derived=3 links=449 dead=0 — PASS
```

`bun run verify:manifest` — **exit 0**, log: `evidence/audit-20261025/pkg-readmes-b/verify-manifest-repair.log`

```
ok    evidence-excluded: the frozen evidence/ tree stays out of the published package
ok    packed-content: npm pack --dry-run lists 1043 file(s); 0 required path(s) absent

VERDICT: PASS — the install-time rules and the packaging contract hold.
```

**Bounds of the repair**

1. The `link`/`pack` counters moved between runs (447 → 449 links, 1042 → 1043 packed files) because the
   tree is shared with the other lanes (`docs/user-guide.md`, `settings-schema.ts`, a new test file);
   both gates still exited 0 and `dead=0`.
2. Bound 4 above is now RESOLVED in the direction the repair implies: I no longer imply the editor base
   is live or fixed — the README claims nothing about the base's lifetime, only the per-knob EFFECT.
3. `goal.*` is stated as mount-captured per §9.1's row; I did not open `mpd-goal-plugin`'s own `apply()`
   in this repair pass — the §9.1 table is the cited authority for that row, and the captain's consumer
   read agrees with it.
4. I still ran ONLY the two gates this lane requires; the full sweep remains the captain's.

---

# T18 (finding T16-F1 / CodeRabbit #4 · F2) — the entry save is HOST-persisted, NOT a workspace file

**Defect.** My earlier text (P-11 → T7) said a save **writes `<workspace>/.mpd/mpd.jsonc`** "for the live
session workspace(s)" and treated the write-back as the mechanism behind the section. That is false for
the DEFAULT front door: the entry save is persisted by the HOST and writes NO workspace file. Only the
RETIRED legacy `mpd`-namespace write-back ever writes the file, and the pinned harness refuses to
register that namespace. I had inherited the claim from the shipped constant instead of reading the save
path.

**Truth, verified in code this session**

- The card mounts through `configForms.get(CONFIG_ENTRY)` with `CONFIG_ENTRY = "mpd-config"`
  (`packages/mpd-bundle-plugin/src/settings-card.ts`), and the TUI section saves through the same
  `mpd-config` ENTRY document (`ENTRY_CONFIG_ID = "mpd-config"`,
  `packages/mpd-config-plugin/src/index.ts`).
- The HOST owns that store. The row's listener `onSettingsDocumentUpdated(ENTRY_CONFIG_ID, …)` re-loads
  its `state` from the document and deliberately writes NO file.
- The `<workspace>/.mpd/mpd.jsonc` write-back exists only for the LEGACY `mpd` namespace (`SETTINGS_NS`);
  the pinned harness REFUSES its registration — `settingsModelRetired`, with the boot warning "the
  namespace-registry model is RETIRED in this harness … The legacy file write-back and override
  clearing are dormant." — so that path never runs here.
- A hand edit of `<workspace>/.mpd/mpd.jsonc` is still read on every resolution.
- The rewritten constants agree: `BRIDGE_DISCLOSURE` opens with the host-persisted entry save and names
  the legacy write-back as the only file writer; `BRIDGE_NOT_LOST` adds "because this path writes no
  file, it never waits for a live session".

**New text (EN + zh, 4 files, both twins saying the same thing)**

- `packages/mpd-tui-plugin/README.md` + `.zh-CN.md`
  - settings table cell: the save is persisted by the HOST as the `mpd-config` ENTRY document and writes
    NO workspace file; the legacy `mpd`-namespace write-back is named as the only writer and as refused;
    a hand edit is read on every resolution — with the per-knob live/captured split retained;
  - NOT CLAIMED #2 heading: "**The `/settings` section's save is persisted by the HOST — NOT as a
    workspace `.mpd/mpd.jsonc` — and WHEN the new value takes effect is PER KNOB.**";
  - new "**Where the save goes**" paragraph citing `ENTRY_CONFIG_ID`,
    `onSettingsDocumentUpdated(ENTRY_CONFIG_ID, …)` and `settingsModelRetired`;
  - the fields clause now says they are edited as fields of the `mpd-config` ENTRY document (the legacy
    namespace is retired), and the `base` cardinality rule is labelled as the legacy fallback's;
  - not-lost: "because this path writes no file, it never waits for a live session";
  - the ambiguity-refusal paragraph is labelled "**On a legacy host** that still serves that namespace"
    and cites `BRIDGE_NO_WORKSPACE_NOTICE`.
- `packages/mpd-bundle-plugin/README.md` + `.zh-CN.md`
  - the card is the browser half of the same `mpd-config` ENTRY document (`configForms.get(CONFIG_ENTRY)`,
    `CONFIG_ENTRY = "mpd-config"`), not of the retired `mpd` namespace;
  - the disclosure paragraph states the host-persisted save, NO workspace write, the legacy-only writer
    (dormant) and the per-knob split; "the PERSISTENCE belongs to the host and the entry-document re-read
    to `packages/mpd-config-plugin` (the legacy write-back lives there too, dormant)".

**Checks re-run (quoted, with exit codes)**

`bun run verify:docs` — **exit 0**, log `evidence/audit-20261025/pkg-readmes-b/verify-docs-t18.log`

```
[verify-docs-parity] root=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh pairs=50 failed=0 violations=0 exempt=24 derived=3 links=447 dead=0 — PASS
```

`bun run verify:manifest` — **exit 0**, log `evidence/audit-20261025/pkg-readmes-b/verify-manifest-t18.log`

```
ok    packed-content: npm pack --dry-run lists 1044 file(s); 0 required path(s) absent

VERDICT: PASS — the install-time rules and the packaging contract hold.
```

Diff for the four repaired files: **50 insertions, 39 deletions**.

**Bounds**

1. `BRIDGE_NO_WORKSPACE_NOTICE` still reads "not yet written to any .mpd/mpd.jsonc (no live session)" —
   that is the LEGACY path's runtime notice; I cite it inside the labelled legacy paragraph and do not
   claim it fires on the entry path.
2. `docs/user-guide.md` §9.1 was NOT edited (per the docs lane's instruction); it stays the per-knob
   authority both READMEs point at.
3. I did not edit the constants or the card mirror (code lane's scope); the READMEs describe their shape
   and cite the symbols.
4. Only the two gates this lane requires were run; the counters (links=447, packed=1044) reflect the
   shared tree, not a change of mine.
5. A self-inflicted zh breakage was caught and repaired in the same pass (a sentence half lost while
   re-anchoring the `base` cardinality rule); the final text was re-read after the fix.

---

# T22 (finding T20-F2) — the watchdog README called the refused `mpd` namespace the live authority

**Defect.** `packages/mpd-team-watchdog-plugin/README.md` + `.zh-CN.md` opened "The knobs" with: "The
`mpd` settings namespace is the live authority; the row config is the defaults layer … The per-tick
re-read is deliberate: the `mpd` namespace is registered *deferred* (mpd-config parks its registration
on the settings service) …". On the pinned harness nothing registers that namespace, so the sentence
named a refused registration as the authority.

**What the code does (opened this session)**

- `readNamespaceValue` (`packages/mpd-team-watchdog-plugin/src/engine.ts`) reads through the adapter:
  `dsh.settingsReader("mpd").get()`, i.e. `settings.get("mpd")` (`packages/mpd-dsh-adapter-plugin/src/index.ts`,
  `settingsReader(namespace)` → `settings.get(namespace)`).
- `SETTINGS_NS = "mpd"` (`packages/mpd-config-plugin/src/settings-schema.ts`) and
  `registerNamespace` (`packages/mpd-config-plugin/src/index.ts`) calls
  `settingsRegister(SETTINGS_NS, …)`, and on `ok !== true` sets `settingsModelRetired = true`, warns
  "…the mpd knobs are served as this row's config (entry `mpd-config`)… The legacy file write-back and
  override clearing are dormant." and RETURNS — **nothing registers the namespace on the pinned host**.
  The served surface is the row's config under the entry `mpd-config` (`ENTRY_CONFIG_ID`).
- The live path that does move is the FILE layer: `refreshKnobs()` reads the settings value AND
  `observeFile()`, tracks `layerDigests.namespace` / `layerDigests.file`, sets
  `liveLayer = "file" | "namespace"` and overlays via `overlayWatchdogSection(namespaceValue,
  file.section)`; `readKnobs(base, env, this.knobDefaults())` then resolves.
- The conclusion the old premise justified is unchanged and still true: the knobs are re-read on every
  tick and on a settings-document update (`onSettingsDocumentUpdated`), and `knobReadings`
  (`machine.ts`) prints live vs file with `restartRequired`.

**New text (EN + zh, same meaning)**

- EN: "The knobs resolve from three layers: this row's own config (the DEFAULTS layer), the live
  settings read through the adapter — `settingsReader("mpd")`, which on the pinned harness is
  **unserved**: `settingsRegister("mpd", …)` is REFUSED (`settingsModelRetired`), and the knobs are
  served as this row's config under the entry `mpd-config` (`ENTRY_CONFIG_ID`) instead, so nothing
  registers a namespace — and the workspace `.mpd/mpd.jsonc` FILE layer, observed live and overlaid
  when it is the layer that moved. …re-read **on every tick** and on `settings/document-updated` … a
  cadence change replaces the single tick interval. The per-tick re-read is deliberate: the settings
  value is not a mount-time snapshot and nothing guarantees it arrives before this row applies…"
- zh: the same three layers, same refusal, same conclusion, in 简体中文.
- The claim "the `mpd` namespace is registered *deferred* (mpd-config parks its registration on the
  settings service)" is GONE from both languages.

**CODE CONTRADICTION — recorded, not absorbed (report to the Lead)**

The finding says "the authority is the `mpd-config` entry-config document / live config service". The
code does **not** read that document: the watchdog asks for `settings.get("mpd")`, which on the pinned
harness is unserved (`settingsModelRetired`), so its settings half yields nothing and it falls back to
its own row config plus the FILE overlay. Combined with T18 (an entry save writes NO workspace file),
the practical consequence is that **a settings-form save does not reach this row on the pinned host**;
only a hand-edited `.mpd/mpd.jsonc` (the file layer) does. I therefore did NOT write "the entry document
is the authority" as the finding worded it — that would be a new false claim — and instead wrote the
three-layer read path that the code supports. Either the row should read
`settingsReader(ENTRY_CONFIG_ID)`/the live config service, or the README must keep admitting the gap;
that is a CODE change, outside this lane.

**Adjacent sentences deliberately NOT changed** (the finding said "do not change any other claim"):
EN "the knobs are read through the `mpd` namespace and … a knob is readable and settable from the
namespace" (the schemastery/declaration paragraph) and EN "`.mpd/mpd.jsonc` reaches a process's `mpd`
namespace once, at mount" (§7.2/§7.3). Both still describe the namespace as a read surface and are
worth the Lead's judgement as follow-ups; touching them would have exceeded the assigned item.

**Checks re-run (quoted, with exit codes)**

`bun run verify:docs` — **exit 0**, log `evidence/audit-20261025/pkg-readmes-b/verify-docs-t22.log`

```
[verify-docs-parity] root=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh pairs=50 failed=0 violations=0 exempt=24 derived=3 links=447 dead=0 — PASS
```

`bun run verify:manifest` — **exit 0**, log `evidence/audit-20261025/pkg-readmes-b/verify-manifest-t22.log`

```
ok    packed-content: npm pack --dry-run lists 1044 file(s); 0 required path(s) absent

VERDICT: PASS — the install-time rules and the packaging contract hold.
```

Diff: 2 files, **18 insertions, 11 deletions**.

**Bounds**

1. The finding's suggested wording was not adopted verbatim, for the code reason above; the README now
   states the read path the code implements.
2. I did not touch `src/**`; the underlying gap (a settings-form save not reaching this row) remains and
   is reported, not fixed.
3. Only the two gates this lane requires were run.
4. The zh twin was re-read after the edit and says the same three layers with the same refusal.

---

# T23 — the two remaining namespace-as-read-surface sentences (plus a third found by grep)

**Defect.** The T22 report listed two sentences that still presented the `mpd` namespace as a READ
surface: (1) the knob-declaration paragraph ("the knobs are read through the `mpd` namespace and …
readable and settable from the namespace"), and (2) the §7.2/§7.3 paragraph ("`.mpd/mpd.jsonc` reaches
a process's `mpd` namespace **once, at mount**: a file edit is invisible until the next `dsh` boot").

**Truth, from code opened in the T22/T23 passes**

- Pre-declaration surfaces: the row config (the defaults layer) and the workspace `.mpd/mpd.jsonc` file
  layer, which `config-file.ts` parses on **every** re-read. The legacy `mpd` namespace is a surface
  only on a host that still serves it (its schemastery schema keeps unknown keys); on the pinned host
  nothing registers it (`settingsModelRetired`).
- The §7.2/§7.3 sentence was the pre-T-18 state. `refreshKnobs` (`engine.ts`) keeps `layerDigests` for
  the namespace section and the file section and lets **the layer that MOVED win**: a file edit with no
  settings write in the same window is applied **live, in this process, no restart** ("the measured
  T-18 case" in the method's own doc comment); a settings write outranks a file that did not move; with
  neither or both moving, the last winner stays (first call: namespace wins).
- `noteKnobDivergence` is the residue, not the normal path: it reports the knobs whose FILE value the
  running process is NOT using (a file edit in the same observation window as a settings write, or
  values that arrived before the process observed them), `restartRequired = divergent.length > 0`, and
  the one KNOBS DIVERGE line distinguishes `fileApplied` ("these could not be applied and wait for the
  next dsh boot") from "a .mpd/mpd.jsonc edit applies live once this process has observed the file".

**New text (EN + zh)**

- Declaration paragraph: the front-door declaration "is about the FRONT DOORS, not about whether this
  row can see a value" — a knob is readable/settable before it lands through the row config and the
  file layer, and (legacy hosts only) the namespace; on the pinned harness the row config and the file
  "are the pre-declaration surfaces that actually exist".
- §7.2/§7.3: "The SETTINGS value a process reads is a snapshot taken at mount, but `.mpd/mpd.jsonc` is
  not…" — layer-that-moved-wins, the measured live file case, the settings-write precedence, then the
  residue + `restartRequired` + the KNOBS DIVERGE line's own two cases.
- **Third instance (not named in the task, fixed anyway):** the "Known limits" bullet
  "**`toolInFlightMaxMs` is not in the front-door declaration yet.** It is read through the `mpd`
  namespace and the row config…" carried the identical claim. Now reads "through the row config (the
  defaults layer) and the `.mpd/mpd.jsonc` file layer like the other knobs — and, on a host that still
  serves it, the legacy `mpd` namespace". Flagged to the Lead as one bullet beyond the two assigned.

**Checks re-run (quoted, with exit codes)**

`bun run verify:docs` — **exit 0**, log `evidence/audit-20261025/pkg-readmes-b/verify-docs-t23.log`

```
[verify-docs-parity] root=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh pairs=50 failed=0 violations=0 exempt=24 derived=3 links=447 dead=0 — PASS
```

`bun run verify:manifest` — **exit 0**, log `evidence/audit-20261025/pkg-readmes-b/verify-manifest-t23.log`

```
ok    packed-content: npm pack --dry-run lists 1044 file(s); 0 required path(s) absent

VERDICT: PASS — the install-time rules and the packaging contract hold.
```

Diff: 2 files, **55 insertions, 28 deletions** (T22 + T23 together on this README pair).

**Bounds**

1. The third bullet was outside the literal "two sentences" assignment; it is the same claim in the same
   file and I am its only writer, so I fixed it and report it explicitly rather than leave a known-false
   sentence for the reviewer.
2. `The /watchdog/ namespace is the only thing this package writes` is the HTTP ROUTE namespace, not the
   settings namespace — deliberately untouched.
3. Nothing outside the watchdog README pair was edited; `src/**` untouched; only the two gates this lane
   requires were run.

---

# T27 (finding T24-F2) — state the form-save consequence, stop conflating two row configs

**Defect (two problems in my T22/T23 text).**

1. It stated the MECHANISM but not the CONSEQUENCE: a settings-FORM save (TUI `/settings` section or the
   Web card) does **not** reach these knobs on the pinned harness.
2. The sentence "the knobs are served as this row's config under the entry `mpd-config`
   (`ENTRY_CONFIG_ID`) instead" conflated the WATCHDOG row's own config with the CONFIG row's entry
   document.

**Code evidence (re-checked this pass; unchanged since T22)**

- `readNamespaceValue` still reads `dsh.settingsReader("mpd")` and nothing else; `grep` over
  `packages/mpd-team-watchdog-plugin/src/*.ts` finds **no** `ENTRY_CONFIG_ID` and no `mpdConfig` read.
- The adapter's `settingsReader(namespace)` → `settings.get(namespace)`; `mpd-config` serves the knobs as
  its ROW config under the entry `mpd-config` (`registerNamespace` in `mpd-config-plugin/src/index.ts`
  warns exactly that when `settingsRegister(SETTINGS_NS, …)` is refused and sets
  `settingsModelRetired`).
- `docs/user-guide.md` §9.1 has since been corrected by the docs lane to the same truth ("**`watchdog.*`
  is re-read live from the FILE — a FORM save does not reach it.**" and the table row "live for a FILE
  edit — no restart; a FORM save (`/settings`, Web card) does NOT reach these knobs on this harness (the
  row does not read the `mpd-config` entry)"). The README now agrees with it.

**New text (EN + zh)**

- Three layers, now explicitly disambiguated: "**this row's own config** in the bundle patch (the
  DEFAULTS layer — the WATCHDOG row, not the config row)", the settings read `settingsReader("mpd")`
  (unserved: `settingsRegister("mpd", …)` REFUSED, `settingsModelRetired`, nothing registers a
  namespace), and the `.mpd/mpd.jsonc` FILE layer (layer-that-moved-wins).
- Re-read cadence sharpened so the event key cannot be misread: "**on every tick**, and on a
  `settings/document-updated` for the legacy `mpd` NAMESPACE (retired here, so that event never fires)".
- New paragraph stating the consequence: "**On the pinned harness a settings-FORM save does not reach
  these knobs.** The two front doors write the CONFIG row's own config — the `mpd-config` entry document
  (`ENTRY_CONFIG_ID`), persisted by the host — while THIS row reads neither that document nor a served
  namespace… what actually changes them is this row's own patch config, or a hand-edited
  `<workspace>/.mpd/mpd.jsonc` (the FILE layer, live). That is a recorded CODE gap, not a claim that the
  settings half is live."
- zh twin: the same three layers with the WATCHDOG/config-row distinction, the same retired-event
  clause, and the same consequence paragraph.

Kept unchanged as instructed: the three-layer description, the layer-that-moved-wins behaviour and the
residue semantics (`noteKnobDivergence` / `restartRequired`).

**Checks re-run (quoted, with exit codes)**

`bun run verify:docs` — **exit 0**, log `evidence/audit-20261025/pkg-readmes-b/verify-docs-t27.log`

```
[verify-docs-parity] root=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh pairs=50 failed=0 violations=0 exempt=24 derived=3 links=447 dead=0 — PASS
```

`bun run verify:manifest` — **exit 0**, log `evidence/audit-20261025/pkg-readmes-b/verify-manifest-t27.log`

```
ok    packed-content: npm pack --dry-run lists 1044 file(s); 0 required path(s) absent

VERDICT: PASS — the install-time rules and the packaging contract hold.
```

Diff for the watchdog pair (T22 + T23 + T27 together): see `git diff --stat`; this pass alone added 28
insertions / 14 deletions before the final alignment edit.

**Bounds**

1. The consequence paragraph is a DOC statement of a recorded CODE gap; the gap itself remains (the row
   reads neither the `mpd-config` entry nor a served namespace), and I did not touch `src/**`.
2. The README now matches `docs/user-guide.md` §9.1's corrected watchdog text; I did not edit that file.
3. Only the two gates this lane requires were run.

---

# T30 — remove `watchdog.*` from the live series (tui + bundle-plugin READMEs, EN+zh)

**Defect (the last residual of the watchdog truth).** My P-11/P-13 (then T7) work listed `watchdog.*`
inside the LIVE "takes effect in the running process" series in four places across two README pairs.
AMENDMENT 6/7 established the opposite: a front-door `/settings` save does NOT reach `watchdog.*` — the
watchdog reads `settingsReader("mpd")` (refused on the pinned host, `settingsModelRetired`) and its own
parse of `<workspace>/.mpd/mpd.jsonc`; its knobs are live from the FILE layer and its row config, never
from a form save.

**Sites fixed (EN + zh)**

1. `packages/mpd-tui-plugin/README.md` + `.zh-CN.md` — settings-section table cell: `watchdog.*` removed
   from the live series, with the exception added in the same sentence — "`watchdog.*` is NEITHER: live
   from a hand-edited `<workspace>/.mpd/mpd.jsonc`, but a `/settings` save never reaches those knobs".
2. Same pair — the NOT CLAIMED #2 bullet list: `watchdog.*` removed from "live in the running process",
   and a THIRD bullet added — "**NEITHER half: `watchdog.*`** — the watchdog row reads
   `settingsReader("mpd")` (refused on the pinned harness, `settingsModelRetired`) and parses
   `<workspace>/.mpd/mpd.jsonc` ITSELF, so a hand edit of that FILE applies with no restart while a
   `/settings` save never reaches these knobs."
3. `packages/mpd-bundle-plugin/README.md` + `.zh-CN.md` — the disclosure paragraph: `watchdog.*` removed
   from the RUNNING-process series, with the same exception inline ("`watchdog.*` is NEITHER half: its own
   row reads `settingsReader("mpd")` (refused here) and parses `<workspace>/.mpd/mpd.jsonc` itself, so a
   hand edit of that file is live while a form save never reaches those knobs").

Unchanged as instructed: the model routes, the team-gate knobs, the `team.stateDir` reader and the two
guards stay in the live series; the mount-captured group (`hashline.*`, `commentChecker.*`, `ulw.*`,
`memory.*`, `boulder.dir`, `goal.*`) is untouched.

**Verification that no live-series claim remains:**

```
$ grep -n "watchdog\.\*" packages/mpd-tui-plugin/README.md packages/mpd-tui-plugin/README.zh-CN.md \
      packages/mpd-bundle-plugin/README.md packages/mpd-bundle-plugin/README.zh-CN.md
```

Five hits, ALL of them the new "neither half" exception (2 tui EN/zh bullets + 1 tui EN cell + 1 tui zh
cell + 1 bundle EN paragraph + 1 bundle zh sentence) — none in a "takes effect in the running process"
list.

**Checks re-run (quoted, with exit codes)**

`bun run verify:docs` — **exit 0**, log `evidence/audit-20261025/pkg-readmes-b/verify-docs-t30.log`

```
[verify-docs-parity] root=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh pairs=50 failed=0 violations=0 exempt=24 derived=3 links=447 dead=0 — PASS
```

`bun run verify:manifest` — **exit 0**, log `evidence/audit-20261025/pkg-readmes-b/verify-manifest-t30.log`

```
ok    packed-content: npm pack --dry-run lists 1044 file(s); 0 required path(s) absent

VERDICT: PASS — the install-time rules and the packaging contract hold.
```

Diff for the four files in this pass: **17 insertions, 10 deletions** (measured after the earlier work
had been committed).

**Bounds**

1. Text only; `src/**` untouched, and the recorded code gap (the watchdog reads neither the `mpd-config`
   entry nor a served namespace) remains.
2. This makes the two README pairs agree with `docs/user-guide.md` §9.1 ("`watchdog.*` is re-read live
   from the FILE — a FORM save does not reach it"), which I did not edit.
3. Only the two gates this lane requires were run.






