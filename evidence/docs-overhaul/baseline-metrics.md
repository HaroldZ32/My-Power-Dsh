# Baseline QA metrics — pre-change measurement for the docs-overhaul (doc) wave

**Task:** t2 (verification, `docs-overhaul` wave) · **Author:** Researcher (read-only seat; the
only bytes this task wrote are the two files under `evidence/docs-overhaul/`)
**Measured tree:** branch `dev`, HEAD `a9c3c3ed0d7c3d3434988fe06dd8b7621a5f4149`
("merge: team-model slot 4 (Vision Analyst) with the count sweep into dev")
**Measurement window:** `2026-09-19T10:22:52Z` → `2026-09-19T10:23:06Z` (inside
`evidence/docs-overhaul/baseline-commands.txt`, which carries a `START`/`END` stamp per command)

Raw command output: `evidence/docs-overhaul/baseline-commands.txt` (same directory). No value in
this report was copied from documentation — every count below is reproduced from the source that
declares it, with the command that reproduces it stated inline.

---

## 1. Pre-change working-tree state (the "clean before the wave" claim, stated precisely)

`git status --porcelain=v1` at `2026-09-19T10:22Z`, HEAD `a9c3c3e`:

```
?? evidence/web-card-catalog/20260918T073000Z/sandbox
```

- Exactly **one** pre-existing entry: `evidence/web-card-catalog/20260918T073000Z/sandbox`, an
  **untracked SYMLINK** (`sandbox -> ../20260918T055042Z/sandbox`, created `2026-09-18 15:09`)
  left behind by an earlier QA wave. `git check-ignore -v` on it exits 1: the `.gitignore` rule
  `evidence/**/sandbox/` (trailing slash = directory-only) covers the real directory but **cannot
  cover a symlink**, so this one path stays visible in `git status`. It is pre-existing, it is
  the same one file from before this wave, and it is **not** attributable to any doc change.
- This entry is exactly the kind of path `git add -A` would sweep in. Flagged for the captain
  (integration owns the commit): either land the symlink under an ignore rule or remove it, but do
  not let it read as "wave residue" later.
- `git status --porcelain` was the ONLY pre-existing-noise check run here; the working tree also
  carries the other lanes' in-flight edits (see §6), which is why every gate below is attributed to
  a timestamp window, not to "the current tree".

## 2. Gate baseline — five commands, five exact exit codes

Every command was run with `bun run <script>`, the same invocation the gate table names (§4 of
`AGENTS.md`). All five were run back-to-back inside one window on the tree state of §1.

| Command | Exit code | Decisive line (verbatim tail) |
|---|---|---|
| `bun run verify:docs` | **0** | `[verify-docs-parity] root=/root/dshProj/my-power-dsh pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS` |
| `bun run verify:rows` | **0** | `[verify-rows-parity] ok: 25 row ids match the bundle patch insert list (…)` |
| `bun run verify:vendor` | **0** | `[verify-vendor] commit OK: 8c57e463…` · `version OK: 5.0.0-beta.20` · `stats OK: 9131 files / 1470231 loc` · `asset OK: skills 326 files` · `asset OK: packages/mpd-agent-teams-plugin/_deps 635 files` · `asset OK: packages/mpd-mcp-{astgrep,gitbash,lsp,codegraph}/dist/… 1 file each` · `PASS` |
| `bun run test:qa` | **0** | `[mpd-ext] --self-test passed (53 checks) [validator: source]` · `[mpd-ext] validate …/extensions/mpd-ext-example … loadable` · `[test:qa] all self-tests passed` |
| `bun run typecheck` | **0** | `$ tsgo --noEmit` (no diagnostic output) |

A second, independent reproduction of the no-noise check: `git check-ignore -v --no-index evidence/web-card-catalog/20260918T073000Z/sandbox` also exits **1** (the `--no-index` disables the directory-implied match, isolating exactly the trailing-slash-vs-symlink behaviour above).

**Baseline is GREEN: 5/5 exit 0, zero reds.** Any red a later lane measures on these five commands
is attributable to that lane's change, not to a pre-existing failure — with one caveat that is a
property of the whole suite, not of this baseline: because the working tree carries concurrent
lane edits (§6), a red measured *while* another lane is mid-write reproduces the wave-2 defect
(the "half-reverted tree" false failure, `AGENTS.md` §7 "Verify on SETTLED hashes"). Re-assert the
hash before trusting a red.

Extra context for `verify:docs`: `verify-docs-parity` DERIVES three delta-region claims as it runs
(`AGENTS.md` ×2, `agent-references/index.md`, `agent-references/agent-teams-deltas.md:123/10`), and
its per-file nesting-aware check agreed on all ten adopted files (registry 123 ids / live 123 ids;
per file: `quality-gates` 18/18, `tools` 65/65, `session-start` 3/3, `state` 11/11, `scheduler`
16/16, `command` 1/1, `index` 1/1, `members` 2/2, `profiles` 4/4, `types` 1/1). The doc gate is
therefore also a live cross-check on the adopted-plugin delta registry, and the doc wave can break
it only through the claim text, never through the count.

## 3. Counts, as measured (not copied)

| Metric | Measured | How it was measured |
|---|---|---|
| Bundle patch rows ("row ids") | **25** | `bun run verify:rows` (authoritative: it compares the patch insert list against the row ids) — same number an independent raw parse of `packages/mpd-bundle/cordis.patch.yml` yields |
| — of which MCP client rows | 6 | `mcp-{astgrep,gitbash,lsp,codegraph,context7,grepapp}` in the same list (`mcp-wave-mcp` / `mcp-traceweave` are COMMENTED OUT, lines 174/185 of the patch) |
| — of which `mpd-*` plugin rows | 17 | `mpd-{bootstrap,boulder,codegraph,comment-checker,config,dsh-adapter,ext,hashline,memory,modelchain,roles,team-compact,team-watchdog,tools,tui,ulw,workmate}` |
| — of which the self-row + adopted row | 2 | `mpd-web-compat`, `agent-teams` |
| Patch id-targets (not inserts) | 2 | `agent-presets` (web/base plane), `dsh-tui-agent-presets` (dsh-tui plane) — the only two top-level `- id:` entries in the patch |
| Package directories | **26** (excluding `packages/node_modules`) / 27 entries total | `ls -d packages/*/`; `packages/node_modules` is the gitignored dependency store the TUI plan explicitly excludes |
| Skills (directories) | **18** | `ls -d skills/*/` — 16 ported upstream skills + `dsh-qa` + `svn-master` |
| Skills (tracked files, the vendor-pinned asset) | **326** | `git ls-files skills \| wc -l`, equal to `verify-vendor`'s `asset OK: skills 326 files` |
| `mpd.jsonc` knobs | **25** | derived from the schema source — see §4 |

## 4. The knob-count arithmetic: verified **25 = 13 + 12**

Ran against the real module (`bun` import of
`packages/mpd-config-plugin/src/settings-schema.ts`, a read-only import; no repo bytes touched):

```
SCHEMA_LEAF_COUNT= 25
TEAMMODELS_LEAVES= 12
SETTINGS_KNOBS_LEN= 25
SCHEMA_LEAVES= ["hashline.maxDiffChars","commentChecker.autoCheck","ulw.maxRounds","memory.vcs",
  "team.stateDir","boulder.dir",
  "teamModels.slot1.provider","teamModels.slot1.model","teamModels.slot1.reasoningEffort",
  "teamModels.slot2.provider","teamModels.slot2.model","teamModels.slot2.reasoningEffort",
  "teamModels.slot3.provider","teamModels.slot3.model","teamModels.slot3.reasoningEffort",
  "teamModels.slot4.provider","teamModels.slot4.model","teamModels.slot4.reasoningEffort",
  "watchdog.enabled","watchdog.warnSilenceMs","watchdog.tickIntervalMs",
  "watchdog.warnStreakToEscalate","watchdog.actionOnEscalate","watchdog.toolInFlightMaxMs",
  "watchdog.holdTtlMs"]
```

Two independent derivations agree, which is why the number is not volatile in the way the
amendment assumed:

1. **Schema walk** — `SettingsSchema` (a schemastery `object`) has 8 top-level blocks; the walk
   yields **25 leaves**: 6 single-leaf blocks (`hashline`, `commentChecker`, `ulw`, `memory`,
   `team`, `boulder`) + 7 watchdog leaves + 4 slots × 3 leaves (`provider`/`model`/
   `reasoningEffort`) = **6 + 7 + 12 = 25**.
2. **Declaration list** — `SETTINGS_KNOBS` has exactly **25** entries, and the last entry is the
   spread `...TEAM_MODEL_KNOBS`, which is `TEAM_MODEL_SLOTS.flatMap(...)` over the four slots with
   a 3-leaf literal → 12. So the pairs are `13 (non-teamModels) + 12 (teamModels) = 25`.

**Verdict on the documented arithmetic: it is CORRECT.** The claim "the original 13 plus the
twelve `teamModels` slot leaves" (25 in all) is exactly what the schema source declares. There is
no stale count to fix in the knob sentences.

## 5. The amendment's premise: `docs/architecture.md` carries NO knob count

The contract revision 2 objective asked for "the volatile settings-knob count in ONE sentence of
`docs/architecture.md`" to be fixed. Measured on the file **as it existed at baseline**
(HEAD `a9c3c3e`, before any lane touched it):

- `grep -n "knob" docs/architecture.md` → **no match**; `grep -n "settings"` → only the TUI
  seam passages at `:387`, `:392–394`, `:399–408` and the two table rows `:104` (`mpd-config`) and
  `:219` (`<workspace>/.mpd/mpd.jsonc`). No numeric settings-knob claim exists anywhere in the
  file. The same is true of `docs/architecture.zh-CN.md` (`grep -nE "个 (设置|配置|开关|字段|键)|设置项|配置项"`
  → no match).
- Consequently **no exact replacement sentence can be produced for that file — there is nothing to
  replace.** Per the task's own branch, the report says so explicitly instead.
- Where the count DOES live, it is already correct (13 + 12 = 25, matching §4): `README.md:87`
  (`25 mpd.jsonc knobs (13 + the twelve teamModels slot leaves)`), `docs/user-guide.md:286`,
  `docs/tui.md:79`/`:107`, `docs/tui-parity.md:87`, `packages/mpd-config-plugin/README.md:48–49`
  (`the ONE 25-row declaration (SETTINGS_KNOBS: the original 13 knobs plus these 12)`), and the
  schema module's own header comment (`settings-schema.ts`). No edits are warranted in any of them.
- **The premise was aimed at a file that has since been REPLACED.** While this measurement ran,
  the t3 lane promoted the document: `docs/architecture.md` is now `D` (deleted) and
  `docs/design.md` (`??`, written `18:23:45 +0800` = `10:23:45Z`, i.e. ~40 s after the last gate
  finished) plus a new `docs/design.zh-CN.md` are in its place. The successor was checked the same
  way: `docs/design.md` has **no** settings-knob count either (its `grep` hits are `:10` — a
  pointer sentence saying the knobs "live in README.md" — and the row counts at `:27`/`:77`).
  Note the rename is detectable in the twins' timestamps: `design.md` carries today's write time,
  `design.zh-CN.md` still carries `2026-09-18 12:35 +0800` and only its CONTENT was adapted, so the
  Chinese twin was moved rather than rewritten — the doc-pair gate will judge the pair, not the
  timestamps.

**Net: the knob count needs no fix anywhere; the only thing that was wrong is the amendment's
target.** If the captain wants the knob count *audited* rather than fixed, §4 is that audit.

## 6. The tree moved during the window — attribution boundary

To keep a later reader from reading this baseline against the wrong bytes:

- Gates ran `10:22:52Z`–`10:23:06Z`; the `verify:docs` run listed `ok docs/architecture.md`, i.e.
  the document still existed under its old name for the whole gate sweep.
- By `10:23:45Z` (this report's own `git status`) the tree carried: ` D docs/architecture.md`,
  ` D docs/architecture.zh-CN.md`, `?? docs/design.md`, `?? docs/design.zh-CN.md`, `?? evidence/docs-overhaul/`
  (this task's output), plus the §1 symlink. HEAD and branch were unchanged (`dev` @ `a9c3c3e`).
- Therefore **every exit code in §2 is a measurement of the `a9c3c3e` tree, not of the current
  tree**, and neither the deletions nor the new files above were produced by this task.
- Read in the other direction this is also useful: the doc wave has already STARTED. A baseline
  run now would no longer be a pre-change baseline, so do not "re-baseline" for the wave — use
  these numbers for pre-change attribution and treat anything after `10:23:06Z` as wave output.
- **A foreign scratch dir appeared inside this task's evidence dir while the gates ran.** At
  `10:22:52Z`–`10:22:53Z` (inside the gate window, by wall clock) `evidence/docs-overhaul/_work/`
  was created with `web-cfg.txt`, `web-cfg.err`, `tui-cfg.txt`, `tui-cfg.err` — `dump-config`
  output and two `fs.writeFileUtf8` stack traces. It is **not this task's output** (this task ran
  no `dump-config`) and its four file times straddle the `verify:docs`/`verify:rows` boundary, so
  it most likely belongs to another lane writing into the same evidence directory root (the t1
  fact-base lane also owns files under `evidence/docs-overhaul/`). Recorded here so the integration
  lane does not read it as this task's product; whoever owns `_work/` should claim or remove it
  before the commit.

## 7. Scope and discipline

- `inScope` for this task was **empty**, and the read-only seat is denied filesystem edits. The
  only bytes written were `evidence/docs-overhaul/baseline-commands.txt` (raw gate output, written
  by the running commands) and this report. `docs/architecture.md`, both READMEs, both user-guide
  files and every `packages/**` path were read only — none was modified, and §5 states the fix as
  a finding for the owning lane rather than applying it.
- Reproduce this baseline with:
  `for c in "bun run verify:docs" "bun run verify:rows" "bun run verify:vendor" "bun run test:qa" "bun run typecheck"; do bash -c "$c"; echo "EXIT=$?"; done`
  and the count derivation with a `bun` import of
  `packages/mpd-config-plugin/src/settings-schema.ts` shaking out `SettingsSchema` / `SETTINGS_KNOBS`.

## 8. Captain's follow-up brief (t2): knob-count audit, measured three ways

Added after the captain's brief asked, in order, for (2) the knob arithmetic derived from source and
(4) any doc sentence whose number disagrees — quoted verbatim with the exact replacement. Point (1)
is §2 and point (3) is §3; both were already recorded. Nothing in §1–§7 changes.

### 8.1 The claim under audit, quoted verbatim

`packages/mpd-config-plugin/src/settings-schema.ts:7` (the module header — this is the claim the
brief names):

```
// cannot drift and the twenty-five knobs (thirteen mpd knobs + twelve team-model slot leaves) stay
```

and the declaration it describes, `settings-schema.ts:304`:

```
/** The twenty-five knobs, in display order: the original thirteen, then the twelve team-model slot leaves. */
```

### 8.2 The real leaves, counted — all THREE front doors agree at 25, and 12 of them are slots

| Surface | How measured | Result |
|---|---|---|
| `SettingsSchema` (config, the schema of record) | `bun` import of `packages/mpd-config-plugin/src/settings-schema.ts`, recursive walk over `.dict` | **25 leaves** (6 single-leaf blocks + 7 `watchdog` leaves + 4 slots × 3 leaves) |
| `SETTINGS_KNOBS` (config's declaration list) | same import → `.length` | **25** entries, 12 under `teamModels.` |
| `SETTINGS_FIELDS` (TUI front door) | `bun` import of `packages/mpd-tui-plugin/src/settings.ts` → `.length`; the module builds it as `SETTINGS_KNOBS.map(declaredField)` (`:245`) so it CANNOT drift | **25** |
| `FIELDS` (Web card front door) | the browser module is a factory (`settings-card.js:38` `(require) => {`); a copy with only that header rewritten to `export const FACTORY = (require) => {` was imported from `/tmp` (nothing written under `packages/`) and `FACTORY(() => {})` called | **25** — 13 explicit rows + `...SLOT_FIELDS` (= 4 × 3, `:155`/`:189`) |

**Derived number: 25 = 13 + 12. The claim is CORRECT on every surface that carries it, including
both front doors.** The four slots × three leaves (`provider`, `model`, `reasoningEffort`) are the
12; the other 13 are `hashline.maxDiffChars`, `commentChecker.autoCheck`, `ulw.maxRounds`,
`memory.vcs`, `team.stateDir`, `boulder.dir`, and the 7 `watchdog` leaves.

### 8.3 Point (4): sentences that disagree — NONE, and this is the check that shows it

Every tracked sentence that carries the number was enumerated (`git grep` over `*.md`/`*.ts`/`*.js`/
`*.mjs`/`*.tsx` across all four prose bands **and** the agent-facing manuals, excluding `evidence/`):

| File:line | Sentence (quoted) | Verdict |
|---|---|---|
| `docs/tui.md:79` | "The same 25 knobs — the original 13 plus the twelve `teamModels` slot leaves…" | agrees |
| `docs/tui.md:107` | "`mpd` section with the 25 knobs (the twelve team-model slots offer catalog-derived selections)…" | agrees |
| `docs/tui-parity.md:87` | "`settings-section` (Settings → MPD, the 25 knobs) …" | agrees |
| `docs/user-guide.md:286` | "`/settings` edits the real `mpd.jsonc` knobs — 25 in all (the original 13 plus the twelve `teamModels` slot leaves…" | agrees |
| `README.md:87` (tracked revision) | "…a `/settings` section for the 25 `mpd.jsonc` knobs (13 + the twelve `teamModels` slot leaves…" | agrees |
| `packages/mpd-config-plugin/README.md:48-49` | "the twelve leaves are `select` knobs of the ONE 25-row declaration (`SETTINGS_KNOBS`: the original 13 knobs plus these 12)" | agrees |
| `packages/mpd-bundle-plugin/README.md:53` | "(the original 13 knobs plus the twelve `teamModels` slot leaves)" | agrees |
| `settings-schema.ts:7` / `:304` | the claim itself (quoted in §8.1) | agrees |
| `AGENTS.md` | — | carries NO knob count (checked; its only `25` is the zstd frame count at `:450`) |

**So there is no replacement sentence to route for the number: zero sentences disagree with the
derived value.** The Chinese twins (`docs/tui-parity.zh-CN.md:69`, `docs/user-guide.zh-CN.md:261`,
`README.zh-CN.md:79`, `packages/*/README.zh-CN.md`) were read too and agree as well; they are
outside this task's scope, listed only to show the audit covered them.

### 8.4 The one REAL doc-vs-doc disagreement found (not about the number) — for the repointing lane

The rename renamed the linker, not the links. Verified against the live tree at `2026-09-19T10:2xZ`:

1. **`docs/design.md:556-558` makes a FALSE claim about its own siblings.** Quoted verbatim:
   "The former `docs/architecture.md` filename is gone from the documentation set (the hub
   `docs/index.md`, the README, the user guide and this document all point at `docs/design.md`)".
   **Measured: false** — `docs/index.md:20` and `docs/user-guide.md:7` still link `architecture.md`,
   and their Chinese twins still link `architecture.zh-CN.md`. Only `design.md` itself points at the
   new name; the READMEs carry no such link at all (checked in both the tracked revision and the
   working tree).
   Suggested replacement for `docs/design.md:556-558` (owner: the design-doc lane, t3/t7):
   > **Residual documentation gap after this rename.** The former `docs/architecture.md` filename is
   > gone from the documentation set; this document is its successor. `docs/index.md`,
   > `docs/user-guide.md` and (outside the docs set) `AGENTS.md` §3 still spell the old filename and
   > are repointed by the lane that owns them (t12) rather than here.
2. **Stale old-name references still live in five tracked files** (all need the same repointing that
   `t12` was created for; quoted lines are the exact text to replace):
   - `docs/index.md:20` — replace the link target+label pair `[`architecture.md`](architecture.md)` with `[`design.md`](design.md)` (the row's description text can stay).
   - `docs/index.zh-CN.md:19` — replace `[`architecture.zh-CN.md`](architecture.zh-CN.md)` with `[`design.zh-CN.md`](design.zh-CN.md)`.
   - `docs/user-guide.md:7` — replace `[architecture.md](architecture.md)` with `[design.md](design.md)`.
   - `docs/user-guide.zh-CN.md:6` — replace `[architecture.zh-CN.md](architecture.zh-CN.md)` with `[design.zh-CN.md](design.zh-CN.md)`.
   - `AGENTS.md:209` — in the repository-layout tree, replace `user-guide.md / architecture.md / development.md` with `user-guide.md / design.md / development.md`.
   - `packages/mpd-bundle/cordis.patch.yml:255` (comment, inside a worker-owned package — route to a
     worker lane, not to a read-only seat): "(docs/architecture.md: a sibling-provided service is
     read" → "(docs/design.md: a sibling-provided service is read".
   These are not style: each is a link to a file that no longer exists, so the doc gate cannot see
   them (it checks pairs, not link targets) while a reader following the hub lands on nothing.

### 8.5 Live-tree warning for whoever consumes this audit

While §8 was measured, other lanes were mid-write: `git status` showed ` D README.md`,
` D README.zh-CN.md`, ` D docs/architecture.md`, ` D docs/architecture.zh-CN.md`,
`?? docs/design.md`, `?? docs/design.zh-CN.md`, plus ` M packages/mpd-config-plugin/{src/index.ts,dist/index.js}`
(that package edit is NOT this task's — t2 touched no `packages/**` bytes). Re-read a file's bytes
immediately before applying any replacement line above; the READMEs are currently ABSENT from the
working tree and will return from the README lane.

### 8.6 Closure: the captain's derivation confirmed, with ONE count corrected

The captain's fact (contained in the t2 follow-up brief) was reproduced from source and is **confirmed in substance**,
with a single numeric correction that matters only if the number is quoted:

- **13 = 6 single-key sections + 7 `watchdog` fields — CONFIRMED.** `SettingsSchema` walk:
  `hashline.maxDiffChars`, `commentChecker.autoCheck`, `ulw.maxRounds`, `memory.vcs`,
  `team.stateDir`, `boulder.dir` = 6; `watchdog.{enabled, warnSilenceMs, tickIntervalMs,
  warnStreakToEscalate, actionOnEscalate, toolInFlightMaxMs, holdTtlMs}` = 7; `+ teamModels` 4 × 3
  = 12; **total 25 leaves**.
- **"`SETTINGS_KNOBS` metadata array has exactly 13 entries" — CORRECTED to 25.** Measured on the
  runtime value: `SETTINGS_KNOBS.length === 25` (7 `watchdog` + 12 `teamModels` + 6 others = 25).
  The 13 is the count of **statically written `{ path: … }` objects in the array literal**; the
  literal then ends with the spread `...TEAM_MODEL_KNOBS` (`settings-schema.ts:319`, defined `:261`
  as `TEAM_MODEL_SLOTS.flatMap(...)` over 4 slots × 3 leaves = 12). So a `grep -c` over the
  literal legitimately prints 13 — and the array it is part of holds 25. Both numbers are true of
  different things; the one to print in any doc is the array length, **25**.
- **The documented total "25" is CORRECT and no numeric correction is needed anywhere** — that
  part of the verdict stands, per §8.3 (nine carriers checked, zero disagreements).
- **The wording "the original 13 (mpd knobs)" is only loosely worded** — agreement, with the
  precise form: the 13 are 6 sections + 7 `watchdog` sub-fields, so "13 mpd knobs" reads better as
  "13 non-slot leaves (6 sections + 7 watchdog fields)". No repo edit required for this: it is a
  phrasing observation, not a numeric error.

Verified live tree after the README lane restored its files (`README.md` and `README.zh-CN.md` are
back as ` M`, `docs/architecture.md` still ` D`, `docs/design.md` still `??`); the §8.4 stale
references to the deleted filename are unchanged in `docs/index.md`, `docs/index.zh-CN.md`,
`docs/user-guide.md`, `docs/user-guide.zh-CN.md` and `AGENTS.md:209`.

### 8.7 Completeness: every count the docs assert, measured against source

| Documented assertion | Measured | Verdict |
|---|---|---|
| `docs/design.md:27` / `:77` — "**25 plugin rows** (6 MCP client rows, 17 `mpd-*` plugin rows, the `mpd-web-compat` self-row and the adopted `agent-teams` row)" tasks + "**25 inserted rows**" | 25 insert row ids (`bun run verify:rows`, authoritative) = 6 MCP + 17 `mpd-*` + 2 | **correct** (the patch's 2 extra top-level `- id:` entries are id-**targets**, not inserts, and the text says so) |
| `docs/design.md:88` / `:192` — "the specialist roster's **11 specialists**" | `ROLES.length = 11`, `ROLE_BY_ID` = 11 keys; names Architect, Researcher, Planner, Deep Worker, Senior Engineer, Lead, Explorer, Reviewer, Plan Reviewer, Vision Analyst, Junior Engineer | **correct** |
| `README.md:441` — "**Six of the eleven** (Architect, Researcher, Planner, Explorer, Plan Reviewer, Vision Analyst)" are read-only | `ROLES.filter(r => r.readonly)` = **6**, and the names are exactly Architect, Researcher, Planner, Explorer, Plan Reviewer, Vision Analyst (the other 5 — Deep Worker, Senior Engineer, Lead, Reviewer, Junior Engineer — are writable) | **correct** (name-level, not just count-level) |
| `docs/design.md:27`'s package/dir claims | `packages/` holds **26** package dirs excluding the gitignored `packages/node_modules` (27 entries incl. it) | measured; design.md states no total here, so nothing to contradict — recorded for the t7 count-check |
| skills corpus | **18** dirs under `skills/` = **326** tracked files (matches `verify-vendor`'s `asset OK: skills 326 files`) | measured |
| knob surface | **25** = 13 (6 sections + 7 `watchdog`) + 12 `teamModels` leaves, confirmed on 4 surfaces (§8.2) | **correct** |

No live QA case was run for any of the above; every number is a source-level measurement plus the
already-recorded gate outputs of §2.
