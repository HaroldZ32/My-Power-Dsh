# Independent review — audit wave 2026-10-25

Reviewer (findings only; no fixes applied). Team `audit-20261025`, shared task **T5**, lane
`audit-reviewer`. Branch `fix/audit-20261025`. Contract: `.mpd/plans/audit-20261025-fixes.md`
(items A-01…A-13, P-01…P-17, D-01…D-19 — including AMENDMENT 1 and AMENDMENT 2, which narrow A-05,
re-specify P-11/P-13 as D-18, and add D-18/D-19/A-11/A-12/A-13). Reports judged: the four lane
reports under `evidence/audit-20261025/{docs-core,pkg-readmes-a,pkg-readmes-b,code}/report.md`.
Verified against the implementation on the SETTLED tree (all lanes completed: T1–T4, T6–T8; code
report `evidence/audit-20261025/code/report.md` written 2026-10-25T12:44Z), with the captain's
integration writes observed: `packages/*/dist/**` rebuilt 2026-10-25T12:46:50Z,
`VENDOR_LOCK.json` re-pinned for the skills corpus (client.js sha still pending at review time).

## Assessment

The wave is **substantively sound and unusually well evidenced**. I re-derived every claim I checked
from the implementation rather than from the lane's narrative: all 19 code items, all 17 package
README items and A-01…A-07, A-09…A-13 hold against their cited symbols, in both languages where a
twin exists; the two blockers I raised mid-wave (the stale Web-card `memory.vcs` mirror after D-09;
the frozen cross-package coupling literal after D-18) were repaired and the suite is green
(2463 tests / 6 declared skips / 0 fail). Six static gates re-ran green on the settled tree
(docs, comments, rows, typecheck, tests, manifest) plus `verify-no-host-override`, and `verify:dist`
is 33/33 fresh after the rebuild. Two items still stand between this tree and acceptance: **A-08(b)**
is an explicit contract item whose sentence was deliberately NOT touched, so the tree now carries a
false "CONTAINED, NOT FIXED / `Math.max(...)` spread" bound that D-07's bounded loop disproves; and
**three `skills/**` files outside the contract's one-file exception were edited without an amendment**
(the QA-lane repair of the retired disclosure sentence, which F3 below shows was necessary).
Risk level: **LOW on the implementation, MEDIUM on the record** — both open items are record-level
and closable with one doc sentence pair plus one amendment line.

## Findings (ranked)

### F-4 (MEDIUM — acceptance-blocking; record) — A-08(b) is still open, and the page now contradicts the code
`docs/tui-parity.md` §5 and its zh twin still state: *"Named limit … **CONTAINED, NOT FIXED, and
deliberately out of this wave:** an unbounded `dependencies` array can still make the projection
throw deep in the depth walk (the `Math.max(...)` spread) … it is **not** described as fixed anywhere
on this page."* The code says otherwise: `taskDepths` → `depthOf` in
`packages/mpd-tui-plugin/src/team-state.ts` now accumulates `deepest` in a loop and no longer spreads
(D-07 is on disk, and the lane added a 1 000 000-edge arm). The frozen contract assigns this sentence
to the docs-core lane (`D-07`: "the docs-core lane owns that sentence; leave it to them"; `A-08(b)`:
"re-label it RESOLVED with the symbol that now bounds it"). The docs-core report records it as
`NOT TOUCHED` and says the captain closes it at integration — but no amendment in the contract
records that transfer (AMENDMENT 1 covers A-05/A-03; AMENDMENT 2 covers D-18/D-19/A-11/A-12/A-13).
**Why it matters:** the wave's own mission class is documentation/implementation contradiction; this
is one, introduced by this wave, in a page the wave edited. **Direction (described, not applied):**
re-label §5's bound `RESOLVED` in EN + zh with the bounding symbol (`taskDepths`'s `deepest` loop),
keep the history sentence and the "why it was contained" paragraph, and state the measurement date.

### F-5 (MEDIUM — process/record) — `skills/**` edited beyond the contract's stated exception
The contract's do-not-touch list allows exactly one skills file (`skills/dsh-qa/scripts/memory-smoke.ts`,
code-fixer). The final tree also carries edits to `skills/dsh-qa/scripts/lib/settings-bridge-lane.ts`,
`skills/dsh-qa/scripts/tui-panels.ts` and `skills/dsh-qa/scripts/tui-settings-bridge.ts` (code report
§5). No AMENDMENT 3 records the widening. **Substance is correct and was necessary** — F3 below shows
those arms pinned the retired blanket sentence and would have reddened the next real-case run after
the dist rebuild; the edits add the both-halves arms (S2b/S3b/T2b/T3b) and negative controls, keep ONE
skills writer for the wave, and the single `VENDOR_LOCK.json` corpus re-pin covers them. **Why it
matters:** the do-not-touch rule and the single-writer rule are contract-level; a widened scope must be
on the record, not inferred. **Direction:** add AMENDMENT 3 recording the four skills files, the reason
(F3), the one-writer statement and the single re-pin — or bounce the three edits and record a
follow-up. If the widening is recorded, this finding closes with no code change.

### F-3 (HIGH — repaired during the wave, recorded for the trail) — the QA real-case corpus pinned the retired disclosure sentence
Before repair, `skills/dsh-qa/scripts/lib/settings-bridge-lane.ts` (`evaluateBridge` static S2,
`evaluateTuiSurface` T2) asserted `dist.includes("takes effect in the RUNNING process")`, and
`skills/dsh-qa/scripts/tui-panels.ts` carried the same phrase as a positive pane pattern plus in its
settings fixture. After D-18 that phrase no longer exists in `BRIDGE_DISCLOSURE`, so the case would
have passed only against the STALE dist and reddened on the first post-rebuild run — a latent red gate.
The code lane's repair is verified in the source: the lane constants now carry a LIVE half, a CAPTURED
half and a RETIRED sentence, the `selfTest()` re-reads `settings-schema.ts` so drift fails, and the
new arms/mutants are listed in the code report §5. `tui-settings-bridge` and `tui-panels` still need a
**real run after the rebuild** (declined to judge below) — their self-tests pass, the real cases were
not executed by me.

### F-1 (BLOCKER at review time → REPAIRED) — Web-card `memory.vcs` mirror drifted from the shared declaration
After D-09, `SETTINGS_KNOBS` offered `["git","svn","both"]` while
`packages/mpd-bundle-plugin/src/settings-card.ts` still mirrored `["git","svn"]`; the rendered-card
parity pin and its negative control failed at `expect(clean.every(...)).toBe(true)` (2452/6/2). The
final card carries `["git","svn","both"]` and the byte-identical disclosure mirrors
(`BRIDGE_DISCLOSURE`, `BRIDGE_RESTART_LIMIT` — I compared the two source constants byte for byte), and
the rebuilt `client.js` carries the new text. Verified green.

### F-2 (BLOCKER at review time → REPAIRED) — the frozen cross-package coupling literal no longer matched reality
D-18 adds `BRIDGE_RESTART_LIMIT` to `packages/mpd-tui-plugin/src/settings.ts`'s import of
`mpd-config-plugin/src/settings-schema`, so `FROZEN_COUPLINGS` (same test file
`packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts`) reported the entry as
BOTH stale and unfrozen. The final tree re-freezes the same entry (count unchanged, same file, same
module) with a dated D-18 comment, and the full suite is 0 fail.

### F-6 (NIT) — D-03 leaves one residual sentence in the memory README
`packages/mpd-memory-plugin/README.md` (and zh) still says the store carries "a journal plus a facts
queue (part of the documented store layout; no tool writes it yet)". After `factsPath` was deleted no
code names that slot. The lane's branch-A reasoning is defensible (the README promises no COUNT, and it
explicitly says no tool writes it), so this is a nit, not a contradiction: either keep it as a
provenance note (add the word "upstream" to make the slot's owner explicit) or drop the clause.

## Checks I ran on the settled tree (quoted, with exits)

| Check | Observed | Exit |
|---|---|---|
| `mpd_verify_evidence docs` | `pairs=50 failed=0 violations=0 links=449 dead=0 — PASS` | 0 |
| `mpd_verify_evidence comments` | `VERDICT: PASS — every declaration …` (444 files) | 0 |
| `mpd_verify_evidence rows` | `ok: 36 row ids match the 2-file bundle patch layer` | 0 |
| `mpd_verify_evidence typecheck` | `tsgo --noEmit`, no diagnostics | 0 |
| `mpd_verify_evidence tests` | 2463 tests, 2457 pass / 6 skip / **0 fail** | 0 |
| `mpd_verify_evidence manifest` | `VERDICT: PASS`, incl. the two new `component-ref-*` checks | 0 |
| `node scripts/verify-no-host-override.ts` | `PASS: … 0 of 0 collide with the 213 host-declared row ids` | 0 |
| `bun run verify:dist` | `ok: 33/33 targets fresh — 1 NOT COVERED listed` (after the rebuild) | 0 |
| `bun run verify:vendor` | **FAIL — 2 assets**: `skills` treeSha (re-pinned during the wave) and `client.js` sha256 (**still pending the captain's re-pin**) | 1 |

Evidence log ids: `ev-20261025T124755-ed667a` (docs), `ev-20261025T124756-054b9d` (comments),
`ev-20261025T124758-2d9925` (rows), `ev-20261025T124759-9a1862` (typecheck),
`ev-20261025T124803-bc1f0c` (tests), `ev-20261025T124837-82e3fa` (manifest) — under
`.mpd/verify/evidence/`.

## Item-by-item verification (what I re-derived myself)

- **A-01** ✓ host-declared default rows (`agent-preset-registry` by `dsh-web-app`,
  `dsh-tui-agent-preset-registry` by dsh-tui), the two REMOVED id-target blocks recorded in
  `cordis.patch.yml`, the four user channels (each verified against `scripts/set-default-preset.ts`,
  `docs/preset-default.md`), 35 + 1 = 36 rows with `verify:rows` reproducing 36; EN+zh agree.
- **A-02** ✓ `scripts/build-mcp.ts` / `vendor/mcp-src` are ENOENT; the launchers exist; the
  `resolveDependencyEntry` packages are the declared optional dependencies; the five-tier
  `resolveAstGrepBinary` claim matches `bin-resolve.ts` + the launcher's untouched-pin guard;
  adopted ast-grep/codegraph artifacts sit beside `launch.js`; EN+zh agree; no stale `build-mcp`
  claim remains.
- **A-03** ✓ `send_message`/`interrupt_agent` now `agent_id` in every literal and in the prose
  (zero team-messaging `target` left), `wait_agent { timeout_ms }` left alone (host schema states it);
  six bundle commands with `/mpd-model` and its table row; four runtime dependencies including
  `@dsh-std/sdk`; ast-grep is NOT a declared dependency and the resolution chain is the real one.
  The lane's declared tension (the official tool row registers its own `send_message` with `target`)
  is real and honestly bounded (see declined list).
- **A-04** ✓ 35 inserted rows = 7 MCP + 24 `mpd-*` + 3 official + 1 sidebar; 5 top-level `insert:`
  lists and 35 ids at 4-space depth; `ok: 36 row ids match`; four `dependencies`; EN+zh agree.
- **A-05** ✓ (as narrowed by AMENDMENT 1) badge + "current release" → 0.15.4 in EN+zh; the registry
  spec stays primary. I independently confirmed the registry state in the amendment's favour:
  `curl https://registry.npmjs.org/@mpd-dsh%2Fmpd` → HTTP 200, `dist-tags.latest = 0.15.4` (read
  2026-10-25T12:19Z). `AGENTS.md` §8's "LIVE on the registry at 0.15.4" is true.
- **A-06** ✓ 34 package dirs / 31 manifests / 3 without (`mpd-codegraph-plugin`,
  `mpd-mcp-codegraph`, `mpd-mcp-shared`) — my own `ls`/loop reproduces it; 0 cross-package
  `@mpd-dsh/*` dependency declarations across 31 manifests; EN+zh agree.
- **A-07** ✓ 58 JS files = 34 tracked `packages/*/dist/*.js` + 2 browser bundles + 22 skill-corpus
  (20 `.mjs` + 2 `.js`) — my `git ls-files` reproduces both numbers; `AGENTS.md` 63902 B ≤ 65024.
- **A-08(a)** ✓ D2 re-labelled CLOSED-BY-DE-VENDOR in EN+zh, history kept. **A-08(b) NOT DONE** →
  F-4.
- **A-09** ✓ all four items closed with artifacts I opened: the `test:qa` repair record's `gates[]`
  entry (exit 0, "51 runner entries … all self-tests passed"); the oneclick result (`ok:true`,
  108/0/14, **22/22 `tui.*` arms true**); 54 oneclick stamps, 29 green, first green 16-32-12Z, last
  09-51-46Z; `dist/mpd-package/package.json` = 0.15.4.
- **A-10** ✓ JSON-only by design in EN+zh, reason kept, matches `flows.ts`'s header (D-13).
- **A-11** ✓ `docs/tui.md` + zh now state the scoped split (live list + one-way `tui.dashboardKey` +
  mount-captured list) and point at `user-guide.md` §9.1; my sweep of `docs/*.md` finds no remaining
  unconditional no-restart claim about these knobs outside §9.1's per-knob table.
- **A-12** ✓ the ledger row now records the id-target as REMOVED/2026-10-02 "superseded by §2"; the
  "24 rows" and "mpd preset default" phrases are gone; EN+zh agree.
- **A-13** ✓ 24 `name:`-value row targets and 28 every-`dist/`-path hits — both quoted commands
  reproduce exactly; the four extras are the MCP launchers' `dist/launch.js` in `args:`.
- **P-01…P-04** ✓ gate default `mechanical` (absent/unknown/`true` → mechanical; only `"off"`/`false`
  disarm), no preset id-target + the duplicate-`provide` rationale (corroborated by
  `docs/preset-default.md`), only the WRITE guard withdrawn with `captainInvestigation=`/
  `delegationGate=` boot tokens, and the `easy`/`normal`/`strict` threshold rows with signal F
  (`readWorkspaceScale`: manifest ≥1 AND project dir ≥1 AND visible ≥8, dotfiles excluded).
- **P-05** ✓ `hashline.enabled` gone; `memory.vcs` now `git | svn | both` and "selectable in Settings"
  is true in the final tree (union + knob + card mirror all carry `both`).
- **P-06** ✓ `config.binary` first, then the env var, then the package-relative `createRequire` +
  `vendor/<platform>/comment-checker`, then `.toolchain`; the tool errors and the hook is a no-op
  when none exists.
- **P-07** ✓ slot first, configured/unusable answers empty provider/model with status
  `"unconfigured"` and a `teamModels.slotN` reason (the tool maps `invalid` to that same status —
  the README says `"unconfigured"`, not `<invalid>`, so it does not over-claim), only `unrouted`
  falls through to overlay → roster chain → merged table.
- **P-08** ✓ `Config = { memoryFile?, chains? }`, default `<ws>/.mpd/memory.json`, chains override
  key by key and the live `modelchain.<key>` overlay outranks both, per call.
- **P-09** ✓ ULW resolves `team.gate` per call and returns BEFORE the predicate on `off`; same
  `resolveSensitivity` row (absent → easy); D is `readBoulderGate(workspace).active`; F only on the
  `easy` row; `mechanical` stages, `advisory` stages nothing.
- **P-10** ✓ `cooldownMs ?? 15 * 60_000` and the cooldown-stamp semantics.
- **P-11 / P-13 (REPAIR)** ✓ both README pairs now state the scoped truth, EN+zh, describe the
  corrected disclosure shape (both halves) and never quote the old constant; the tui row names the
  live groups, the mount-captured groups and §9.1.
- **P-12** ✓ EIGHTEEN `TUI_SEAMS` entries = 15 real `tui*` + 1 phantom (`tuiPrompt`) + `commands` +
  `settings`; the "three MPD pages" count fixed in EN+zh.
- **P-14** ✓ 44 primary + 15 unverified = 59, measured by import (the old 45/16 was the interface
  declaration's own line matching both greps); EN+zh agree.
- **P-15** ✓ `TERMINAL_TASK_STATUSES` = completed/deleted/failed/cancelled, mirroring the source
  comment's official union and rationale.
- **P-16** ✓ official inbox limit vs the mpd mailbox's `unreadOf`/`summarise` → `MailSummary.unread`;
  native backend = `startActivation` (0.2.1+), `startContinuable` only as the retired fallback
  (`CONTINUABLE_START_MEMBERS` probed newest-first). EN+zh agree.
- **P-17** ✓ no shipped `apply()` installs `installVerifyGuard`; the band is now stated as prose.
- **D-01** ✓ probes computed once, both arms `test.skipIf(!probe)` with the reason in the title; the
  suite reports SKIP with the documented reason (observed in my own run).
- **D-02** ✓ the one early-return test body converted to `test.skipIf(!existsSync(SESSION_TEAM_RECORD))`;
  the arm SKIPs in this clone.
- **D-03** ✓ description no longer advertises facts; `factsPath` deleted; branch A justified (nit F-6).
- **D-04** ✓ `readPlans`/`readWorkmates` now push one bounded `problemNote` (errno preferred,
  120-char cap) on non-ENOENT failures, ENOENT stays "empty", and the new arm asserts the note, the
  cap and the rendered board line (`note       plans: `).
- **D-05** ✓ one `warn` naming the directory and the error; non-fatal behaviour kept.
- **D-06** ✓ `createLazyDshAdapter(ctx, { label: "mpd-team-core" })` at apply; the new
  `adapter-identity.test.ts` asserts exactly one labelled fallback line and the mounted path.
- **D-07** ✓ loop with explicit `deepest`; empty case 0; new 1 000 000-edge arm.
- **D-08 / D-09** ✓ schema default `false` (matches the shipped row and the opt-in posture); `both`
  in the union AND the knob options; `settings-defaults.test.ts` pins all three declarations and
  (D-18) the disclosure halves.
- **D-10** ✓ `dsh-plugin.json` source.repository = github.
- **D-11** ✓ the parse failure is a named problem in `result.json` and printed on its own stderr line.
- **D-12** ✓ the three detector arms are legible skips (reason in the title) and three binary-free
  arms pin the payload contract, the `config.binary` precedence and the exit-code → verdict mapping
  (0 clean/empty message, 2 comments + stderr, other → "unexpected exit N"), with a declared win32
  bound. Observed green in my run.
- **D-13** ✓ flows header: JSON only by design, YAML not planned, reason kept.
- **D-14** ✓ `evidence/extensions/SUPERSEDED.md` names the nine stamps / eight directories, says none
  supports a current-state claim, names the two superseding artifacts with their bounds and states the
  re-run rule; no historical `result.json`/`output.log` touched (my `git status evidence/` shows only
  the allowed `verify-debranding.ts` edit).
- **D-15** ✓ the printed claim is narrowed to the probed fields with a stated bound and an emitted
  `bounds` field; not re-run, per the contract.
- **D-16** ✓ recorded follow-up with the reason (`PLUGIN_PKGS` is NOT exported — a module-local const
  in `scripts/pack-mpd.ts` — so a `packages/*/test/**` arm would have to scrape source; the required
  export is outside every lane's scope). The contract explicitly permits this.
- **D-17** ✓ `checkComponentRefs` (self-URN version + `dependsOn` ids) wired into the scan and the
  7th self-test arm (mutant trips both predicates, clean control = the real document).
- **D-18** ✓ `BRIDGE_DISCLOSURE` scoped (live groups + one-way `tui.dashboardKey`),
  `BRIDGE_RESTART_LIMIT` names every mount-captured group, `BRIDGE_SECTION_NOTICE` renders both
  halves + not-lost, byte-identical mirror in `settings-card.ts` (I compared), TUI `SECTION_NOTICE`
  three-part and asserted in both locales, `states().applies = "restart"` with the per-namespace
  reason stated, and the "exception cannot silently vanish" arm added. The class split matches the
  consumers: `hashline` (`maxDiffChars`/`guardEditTools` at apply), `commentChecker` (hook at apply),
  `ulw` (`maxRounds` at apply), `memory`/`boulder`/`goal` (`mergedConfig` at apply) vs the per-use
  readers.
- **D-19** ✓ all SIX self-urn refs `@0.15.4`; ids/`dependsOn` untouched; the new predicate prints
  `6 self-urn ref(s) … 0 stale` / `8 declared component id(s) … 0 dangling`; the comment's count
  says SIX (the earlier "seven" was corrected).

## Declined to judge (with the reason on the same line)

- The LIVE TUI pane behaviour of `tui-panels` / `tui-settings-bridge` after the rebuild — no PTY lane
  in this review; their self-tests pass and the code report states they must be run post-rebuild (captain's step).
- The Docker real-machine lanes (`source` / `oneclick`) — out of this review's scope; require a
  rootless daemon and a real image build.
- `dist/mpd-package/**` freshness (the pack) — the release step, not the wave; the contract puts it in
  the captain's integration.
- Windows-only behaviour (the shell-stub arms' win32 skips) — not run here.
- Which duplicate-name registration a live session receives for `send_message`/`interrupt_agent`
  (`agent_id` base control vs the official team row's `target`) — needs a mounting boot; the docs'
  `agent_id` claim matches the base control package and this session's own tool pack, and the lane
  declared the tension.
- Whether `tui.dashboardKey`'s live `true` can arm a takeover disabled by row config on every host
  build — the claim is the code's own one-way statement; I did not boot a pre-0.13.0 host.
- Bilingual quality beyond meaning: I compared EN/zh twins for the same claims on every edited item,
  but I did not line-edit the prose.

## Verdict

**FAIL (request changes) — two record-level items, no implementation rework required.**
Justification: every code and README item I checked is true against the implementation and the six
static gates are green on the settled tree, but A-08(b) is an explicit contract item still open in the
tree (a false "CONTAINED, NOT FIXED / `Math.max(...)` spread" claim that D-07 disproves) and three
`skills/**` files were edited outside the contract's stated exception with no amendment recording the
widening; closing them is one doc sentence pair (EN+zh) plus one amendment line (and the captain's
pending `client.js` re-pin), after which this wave is a PASS.

**Bounds of this review:** I did not run the Docker lanes, a real TTY/PTY case, a live-LLM case, or
the pack; I did not rebuild anything. The six gate ids above were produced on the tree after the
captain's dist rebuild (2026-10-25T12:47Z) and before the `client.js` vendor re-pin, which is why
`verify:vendor` is red on that one asset at review time. The loop record is the durable link
(`loop-20261025T122755-3bad66`); this written report is the verdict's body.

---

# RE-VERIFICATION (task T10) — 2026-10-25T12:58Z — **PASS**

The Lead's T10 asked for the two FAIL findings to be closed with a recorded PASS. Both are closed,
verified against the implementation and the artifacts, not against the repair narrative.

**F-4 (A-08(b)) — CLOSED.** `docs/tui-parity.md` §5 and `docs/tui-parity.zh-CN.md` now read
**RESOLVED 2026-10-25 (was "CONTAINED, NOT FIXED", and the history is kept deliberately)**, describe
the old unbounded spread in the past tense, cite `taskDepths`
(`packages/mpd-tui-plugin/src/team-state.ts`) and the 1,000,000-edge arm as the bounding evidence, and
state that the frozen §5.5 cap list and the failure line are unchanged (implementation, not interface).
The only surviving occurrences of the old label and of `Math.max` are those deliberate history
parentheticals; no page still claims the spread is current. AMENDMENT 3's closing paragraph records the
same closure. **F-4 no longer blocks.**

**F-5 (skills widening) — CLOSED by AMENDMENT 3.** The contract now carries `AMENDMENT 3
(2026-10-25, captain) — the skills/** exception widened, counted`, which lists all four edited files
(`memory-smoke.ts` = the planned D-11; `lib/settings-bridge-lane.ts`, `tui-settings-bridge.ts`,
`tui-panels.ts`), states the one-writer (code-fixer) and one-corpus-re-pin controls, and records the
reason (F-3: the QA pins of the retired blanket sentence would have reddened the next real-case run
after the dist rebuild). I verified the substance independently rather than taking the amendment's
word: the lane carries byte-copied `TUI_DISCLOSURE_LIVE` / `TUI_DISCLOSURE_CAPTURED` /
`TUI_BLANKET_RETIRED` constants with arms `S2`/`S2b`/`S3b` and `T2`/`T2b`/`T3b` plus per-arm mutants;
`tui-panels` asserts `/take the new value in the RUNNING process/` **and** `/captured by their plugins
at mount/` and declares the retired sentence in `absentPatterns` with its own falsifier; both
`--self-test`s pass; and the REAL case stamp
`evidence/mpd-bridge/tui-settings-bridge/20261025T124833Z/result.json` is `ok: true` with **10/10
checks true**, written at 12:48:33Z — **after** the 12:46:50Z dist rebuild it judges. `verify:vendor`
is PASS on the re-pinned corpus. **F-5 no longer blocks.**

**Gates on the final tree (all exit 0, fresh ids):** `docs` `ev-20261025T125721-682937` (pairs 50,
links 449, dead 0), `comments` `ev-20261025T125721-a71be4`, `rows` `ev-20261025T125724-6f0f01` (36),
`typecheck` `ev-20261025T125724-c1c004`, `tests` `ev-20261025T125727-26d0f2` (2463 tests / 6 declared
skips / **0 fail**), `manifest` `ev-20261025T125800-16dd20` (PASS incl. the component-ref checks);
plus `verify:vendor` PASS (7 assets), `verify:dist` **33/33 fresh** and `verify-no-host-override`
PASS. Record **rec-20261025T125819-2bb056 PASS** on `loop-20261025T122755-3bad66`.

**Nits carried (record-level, non-blocking):** (1) AMENDMENT 3 says the real case passed with "11
arms"; the run's `result.json` carries **10** checks (all true — the self-test's injected-fault arms are
21 + 10 + 4), so the count word is off by one; (2) `docs/development.md`'s `tui-settings-bridge` row
quotes the live half as "`takes effect in the RUNNING process`", a phrase the new `BRIDGE_DISCLOSURE`
no longer contains (it says "`take the new value in the RUNNING process`"), so the row reads as a
literal quote a checker would not find. Neither affects the acceptance criteria.

**Bounds of the re-verification:** the same as above — no Docker lane, no real TTY/PTY keystroke run
(`tui-panels`' real pane was not driven; its self-test and the `tui-settings-bridge` real case were),
no live-LLM run, no pack. This lane reads the implementation by mandate, so no blindness basis is
claimed.

**Final verdict: PASS.**

---

# T16 — FINAL VERIFICATION OF THE CODERABBIT REPAIR COMMIT `c421e157` — 2026-10-25T13:50Z — **FAIL (one finding)**

Commit `c421e157` (PR #66) is the repair commit after `cb348954`; it claims to answer CodeRabbit's
review as recorded in **AMENDMENT 4** of `.mpd/plans/audit-20261025-fixes.md` (nine inline findings,
plus the T15 stale-pin follow-up). I verified each finding against the implementation, not against the
repair report. **Eight of the nine are answered correctly. #4 is only half-answered: the truthful-save
-path repair stops at the code constants and leaves the same false claim shipped in the human-facing
band and in the notice's second half.**

## Finding (HIGH — the repair is incomplete, same class as CodeRabbit #4)

CodeRabbit #4 proved (and the repair now states in `BRIDGE_DISCLOSURE`) that a save from the default
**entry-config** front door persists in the HOST's settings document and **writes NO
`.mpd/mpd.jsonc`**; only the RETIRED legacy `mpd` namespace had a write-back, and the pinned harness
refuses that registration (`settingsModelRetired = true`, one boot warning). I confirmed that code
truth myself: `onSettingsDocumentUpdated(ENTRY_CONFIG_ID, …)` re-loads state and deliberately writes no
file, the only `writeBack(…)` caller is behind the `SETTINGS_NS` listener, and the namespace
registration is refused.

The same claim is still shipped as CURRENT in these places (all read on the final tree):

| Site | Surviving claim | Why it is false |
|---|---|---|
| `packages/mpd-tui-plugin/README.md` settings row + `README.zh-CN.md` twin | "a save writes the file at once" / "保存会立刻写文件" | the default save writes no file |
| `packages/mpd-bundle-plugin/README.md` + `README.zh-CN.md` (TUI counterpart paragraph) | "a save writes `<workspace>/.mpd/mpd.jsonc` for the live session workspace(s)" / "保存会写入 …" | same |
| `docs/user-guide.md` §7.2 + zh | "a save **writes `<workspace>/.mpd/mpd.jsonc`** … the same write-back the Web GUI card triggers" (and "under the harness settings namespace `mpd`") | same; the section is keyed by the ENTRY `mpd-config`, not the namespace, on this host |
| `docs/tui.md` §7.2 Write-back bullet + zh | "It triggers on … `settings/document-updated` … and writes the live session workspace's `<workspace>/.mpd/mpd.jsonc` under a lock …" | describes the dormant legacy path as the live mechanism, with no qualifier |
| `docs/design.md` §7b seam-providers paragraph + zh | "it registers the `mpd` namespace … and it owns the **write-back**, triggered by …" | same; the retirement is a host fact the paragraph omits |
| `BRIDGE_RESTART_LIMIT` (rendered in `BRIDGE_SECTION_NOTICE`, mirrored byte-identically in `settings-card.ts`, copied in `skills/dsh-qa/scripts/lib/settings-bridge-lane.ts` as `TUI_DISCLOSURE_CAPTURED`) | "(the file and the settings document still receive it at once, and each row names the key it writes)" | contradicts the sentence immediately before it ("a `<workspace>/.mpd/mpd.jsonc` write happens only on a host that still serves the RETIRED legacy `mpd` namespace") |

**Why it matters:** this is exactly the class CodeRabbit rated major — a reader who follows §7.2 or a
README save expects the file to be written; on the shipped host it never is. The repair commit's own
`settings.ts` header now says the truth, so the tree contradicts itself. **Direction (described, not
applied):** state the host-persisted/no-file truth in those six sites (EN + zh), scope the restart
half's parenthetical ("the settings document receives it at once; on a host that still serves the
legacy namespace so does the file"), mirror it in `settings-card.ts` + `TUI_DISCLOSURE_CAPTURED`, and
retarget the pins (`settings-card.test.ts`, `plugin.test.ts`, the QA `S1`/`T1`/`T2b` fixtures) so the
claim cannot return. `BRIDGE_NO_WORKSPACE_NOTICE` / `BRIDGE_AMBIGUOUS_NOTICE` are dead on this host and
are already recorded by AMENDMENT 4 — not part of this finding.

## Verified answered (the other eight + T15)

- **#1** design §2 now says "36 inserted rows across the TWO additive patch layers … host layer carries
  35 … the second layer the single `preset-mpd` row — 36 in total, the number `verify:rows` prints"
  (EN+zh, and no stray "35 = both layers" survives). **#2** the MCP inventory names the `mcp-git` +
  `mcp-shell` pair as separately disabled, consistent with seven rows. **#3** `docs/tui.md` + zh now
  scope `tui.dashboardKey` correctly (live in both directions while the row config permits the takeover,
  one-way only when the ROW config disabled it) — matching `takeoverArmed(seamBound, savedKnob, floor)`.
- **#5** the four adjacent literals are one (AS I read the diff: three strays deleted; the value is
  unchanged) and the new `settings-defaults.test.ts` arm scans the source for two consecutive
  comma-less literal lines, with a negative control. **#6** the ULW README (EN+zh) now describes C's
  three sub-signals and E's conjunct, and the runtime `ULW_ACTIVATION_DIRECTIVE` was updated in the
  same commit; the numbers match `SENSITIVITY_THRESHOLDS` (easy 2/2/2, C 2-of-3, E 24+2; normal
  3/3/3, 60+2; strict 4/4/4, C 3-of-3, 80+3) and E's verb count is C2's.
- **#7** `checkComponentRefs` now refuses all three vacuous shapes by name (unreadable document, no
  `distribution.version`, `compared === 0`), `component-ref-version` is green only when something was
  really compared, and `--self-test` proves each shape one at a time (observed PASS, 7 arms).
- **#8** the `/settings` pane row pins the material clauses (persistence half, each live group, the
  one-way toggle, the ordered captured groups, the boot wait, never-lost) instead of a prefix.
  **#9** the reference pane is built from the shipped constants through `paneClip()` at a DERIVED width
  (`max(560, SECTION_LINE.length + 40)`), and the self-test proves both directions (560 clips, the lane
  width does not). The declared bound stands: this is not a claim that the ~1.4k-char notice is fully
  readable on a real terminal.
- **T15** the stale lowercase pin now carries the shipped spelling ("The config service re-resolves …")
  with the reason; the committed `t15-test-packages.log` reports 2459 pass / 6 skip / 0 fail.
- **Record/evidence integrity:** the commit modifies only two evidence files (the docs-core and
  pkg-readmes-a reports); every other evidence path is an addition; no historical
  `result.json`/`output.log` was rewritten. `VENDOR_LOCK.json` re-pins both the skills `treeSha` and the
  rebuilt `client.js` sha256. AMENDMENT 3's count was corrected to "PASS, 10 checks", and
  `docs/development.md`'s QA row now quotes the truthful save path and the
  "take the new value in the RUNNING process" half.

## Gates I ran on the committed tree (all exit 0)

`docs` `ev-20261025T134820-555497` (pairs 50, links 449, dead 0) · `comments`
`ev-20261025T134820-bc4f7d` · `rows` `ev-20261025T134823-81a62b` (36) · `typecheck`
`ev-20261025T134823-03e7b1` · `tests` `ev-20261025T134826-b760ee` (**2465 tests / 6 declared skips /
0 fail** / 40 682 expects) · `manifest` `ev-20261025T134900-818fe9`; plus `verify:vendor` PASS (7
assets), `verify-dist-fresh` **33/33 fresh**, `verify-no-host-override` PASS, `verify-plugin-manifest
--self-test` PASS (7 arms incl. the vacuity arm), and `bun run test:qa` → `[test:qa] all self-tests
passed` (exit 0). The post-rebuild real case `evidence/mpd-bridge/tui-settings-bridge/20261025T133615Z/
result.json` is `ok: true`, 10/10 checks.

## Nits / bounds

- The commit message says "ten findings"; AMENDMENT 4 records NINE inline findings, and all nine are
  addressed or dispositioned — the tenth is not identified anywhere (cosmetic).
- `tui-panels`' real TTY drive was not re-executed after #8/#9 (last lane stamp 12:48Z, before the
  repair); its self-test and the static/pane model are green, and the readability bound is declared.
- I did not run the Docker lane, a live-LLM case, or a real TTY/PTY drive of my own; the review lane
  reads implementation by mandate, so no blindness basis is claimed.

**Verdict on `c421e157`: FAIL — one HIGH finding (the #4 truth-sweep is incomplete across the
human-facing band and the notice's restart half); the other eight findings and T15 verify clean and
every gate is green.**

---

# T20 — RE-VERIFICATION OF THE SAVE-PATH SWEEP `d2bd08b6` — 2026-10-25T14:10Z — **FAIL (residual: the owning package's README was missed)**

Commit `d2bd08b6` ("sweep the truthful save path through every live site") fixes every one of the six
sites T16-F1 named, correctly, and adds the guards I asked for. I re-derived each fix from the files:

- `BRIDGE_RESTART_LIMIT` is now scoped — "(the settings document receives it at once, and the file does
  too only on a host that still serves the legacy `mpd` namespace; each row names the key it writes)" —
  byte-identical in the schema and the browser mirror (`BRIDGE_DISCLOSURE` 842 chars,
  `BRIDGE_RESTART_LIMIT` 442 chars, both identical), copied into the QA lane's `TUI_DISCLOSURE_CAPTURED`,
  with new absence arms `S3c`/`T3c` over `TUI_FILE_PARENTHETICAL_RETIRED` and three pin sites asserting
  the scoped wording AND the retracted one's ABSENCE.
- The five human-facing passages now state the truth in EN **and** zh: `mpd-tui-plugin/README` (host
  entry document, "no workspace file is written on this path", legacy writer retired/refused),
  `mpd-bundle-plugin/README` (same, plus the hand-edit clause), `docs/user-guide.md` §7.2 (host
  persistence, no `<workspace>/.mpd/mpd.jsonc` write, legacy path "dormant"), `docs/tui.md` §7.2
  (Write-back and Workspace-target bullets relabelled "legacy namespace path — DORMANT on this
  harness"; "None of this runs for an entry-config save"), `docs/design.md` §7b (namespace model
  RETIRED, dormant path, entry persistence explained). A band-wide grep finds no remaining current-tense
  "a save writes the file" claim in those files or their twins.

## Finding (HIGH — the same class survives in the package that OWNS the bridge)

`packages/mpd-config-plugin/README.md` **and** `packages/mpd-config-plugin/README.zh-CN.md` were not
swept. They still present the retired namespace model as the live mechanism, with no retirement note
anywhere in the file:

1. "## The `/settings` bridge (write-back)": "the TUI `/settings` section and the Web GUI card edit the
   `mpd` settings namespace, and a saved edit is projected into the workspace's
   `<workspace>/.mpd/mpd.jsonc`." (zh: "…编辑 `mpd` 设置命名空间，保存的编辑会被投影到工作区的
   `<workspace>/.mpd/mpd.jsonc`") — false on the pinned host: the front doors edit the `mpd-config`
   ENTRY document, and no file is written.
2. "the base is **fixed for the process lifetime** … which is why the shipped hint says 'after a
   restart'" (zh: "这就是界面提示写作'重启后生效'的原因") — the shipped hint no longer says that; D-18/A-11
   replaced it with the scoped disclosure.
3. "**Timing:** consumers read the config at plugin `apply()`, so a saved edit takes effect for the mpd
   plugins **after a restart**" — the blanket restart claim D-18 corrected everywhere else; `§9.1` is
   per knob (model routes, watchdog, gate knobs live; the captured groups not).
4. The base/read-in/write-back/workspace-target bullets and the closing boundary sentence ("plus the
   write-back projection above") all describe the dormant path as current.

**Why it matters:** `packages/*/README.md` IS the package's contract (AGENTS.md §3), and this is the
package the other documents point at for the bridge — so the sweep's own goal ("through every live
site") is not met, and a developer reading the owning README learns the retired model and a blanket
restart. **Direction:** state the entry-path truth + the retired legacy path in that README pair
(EN+zh) and scope the timing line to `docs/user-guide.md` §9.1, mirroring the wording the five swept
sites now use.

## Secondary residual (MEDIUM — same stale premise, adjacent package)

`packages/mpd-team-watchdog-plugin/README.md` (and the zh twin): "The `mpd` settings namespace is the
live authority … the `mpd` namespace is registered *deferred* (mpd-config parks its registration on the
settings service)" — on the pinned harness `settingsRegister` is refused (`settingsModelRetired`), so
the authority is the entry-config document / live config service, not the retired namespace. The live
re-read behaviour the paragraph justifies is true; the premise wording is stale and teaches the retired
model. Worth fixing in the same docs pass.

## Verified on the committed tree (my own runs, all exit 0)

`docs` `ev-20261025T140856-771278` (pairs 50, links 447, dead 0) · `comments`
`ev-20261025T140856-13281c` · `rows` `ev-20261025T140859-58ec5f` (36) · `typecheck`
`ev-20261025T140859-99ffa1` · `tests` `ev-20261025T140902-db9540` (**2465 tests / 6 declared skips /
0 fail** / 40 690 expects) · `manifest` `ev-20261025T140935-c88fb2`; plus `verify:vendor` PASS (7
assets), `verify-dist-fresh` **33/33 fresh**, `verify-no-host-override` PASS. The post-sweep real case
`evidence/mpd-bridge/tui-settings-bridge/20261025T140013Z/result.json` is `ok: true` with **11/11**
checks (it now runs the new guards); the captain's credential-free oneclick lane
(`evidence/docker/client-install/2026-10-25T14-00-21Z/`) is `ok: true`, 77 passed / 0 failed / 45 null
(the `live.*`/`ui.*` nulls are its declared credential-free bounds). The commit's modification of MY
report is my own T16 append being committed verbatim (I checked the diff — no edit by the author).
`tui-panels`' real TTY lane still has no post-repair stamp (last 12:48Z); its self-test/static model are
green and the notice-readability bound stays declared.

**Verdict on `d2bd08b6`: FAIL — the six named sites and the constants are correctly swept with real
pins, but the owning package's README pair (plus the watchdog README pair's namespace premise) still
teaches the retired model and a blanket restart; two README pairs close it.**



