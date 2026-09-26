# Review calibration for t10 — captain rulings + Reviewer's own re-measurement

Status: PRE-GATE NOTE. t10 is still `pending` (blocked by t4, t6, t7, t8, t9); this file is written
before the gate opens so the exchange bytes survive (AGENTS.md T-90: the artifact is the anchor, the
mailbox id is not). The gate verdict itself lands in `evidence/docs-overhaul/review-round1.md`.

## 1. What the captain ruled (bytes copied from the captain's two calibration messages)

### 1a. First calibration message (facts for t10)

- ROWS: "`packages/mpd-bundle/cordis.patch.yml` inserts exactly 25 rows and `node
  scripts/verify-rows-parity.mjs` asserts that list. The install section's 'every plugin' claim is
  judged against THAT list. Note: `mpd-tui` IS one of the 25 and is inserted unconditionally — it
  degrades (warn-once) in compositions that provide no TUI seams, so a README stating that the TUI
  row ships in every install is accurate, not a defect."
- KNOBS: "6 single-key sections + 7 `watchdog.*` fields + 12 `teamModels` leaves = 25, and
  `SETTINGS_KNOBS` has 13 metadata entries. A document saying '25 knobs' is CORRECT; the loose part
  is calling all 13 'mpd knobs' when 7 are watchdog sub-fields — low-severity wording, not a
  factual error."
- AUTHORS: "the repo records handles, not real names — `code-yeongyu` (oh-my-openagent;
  VENDOR_LOCK.json) and `程序员阿江 / Relakkes` (dsh-agent-teams; the MIT text in
  LICENSE-NOTICES.md). Naming a handle + URL is correct; that is not grounds for a finding. A credit
  with no traceable source IS a finding."
- RENAME: "the ONLY valid link target from README/user-guide is `docs/design.md`; a document still
  pointing at `docs/architecture.md` is a real finding (t12 repoints the index/AGENTS/patch-comment
  set outside the three doc lanes)."

### 1b. Second calibration message (ruling on the slot-count question)

- (1) "AUTHORITATIVE SLOT COUNT IS **FOUR**. `packages/mpd-config-plugin/src/settings-schema.ts`
  declares `TEAM_MODEL_SLOTS = ["slot1","slot2","slot3","slot4"]` with 12 leaves, and slot 4's
  default is the vision route (`deepseek-v4-flash-vision-exp` at `high`). The string
  'teamModels.slot1|slot2|slot3…' that appears in the `mpd_config_get` tool description in
  `packages/mpd-config-plugin/src/index.ts` — and its adjacent 'the three teamModels slots' comment —
  are KNOWN STALE TEXT. Do NOT raise a mismatch when a document correctly says four slots; the stale
  string is now being repaired under a new task, so do not treat it as the source of truth in either
  direction."
- (2) "a document should say 'the rows this bundle INSERTs' versus the two id-TARGET (replace) rows
  `agent-presets` and `dsh-tui-agent-presets` — never 'the rows the profile mounts', because the
  replace targets are host rows the bundle overrides, on two different planes."
- "New task to be aware of when you reach the gate: kind=work, assignee Senior Engineer, inScope
  `packages/mpd-config-plugin/src/index.ts` + `packages/mpd-config-plugin/dist/index.js`, verify
  `bun test packages/mpd-config-plugin` and `node scripts/verify-dist-fresh.mjs`. It is NOT a
  documentation lane and NOT part of t3/t4/t5, so it must not be judged as one. If it is still in
  flight when you run t10, judge the three documents on their own contracts and note the code task's
  status separately rather than blocking on it."
- "Keep the rename finding: until t3 lands, `docs/design.md` missing + a surviving pointer to
  `architecture.md` is a real finding."

## 2. Reviewer's independent re-measurement (not taken from prose)

| Claim | Measured | How |
|---|---|---|
| 25 inserted rows | 4 MCP (`mcp-astgrep`, `mcp-gitbash`, `mcp-lsp`, `mcp-codegraph`) + 18 mpd rows + 1 adopted (`agent-teams`) + 2 remote MCP (`mcp-context7`, `mcp-grepapp`) = 25 | parsed the four `insert:` lists of `packages/mpd-bundle/cordis.patch.yml` |
| id-TARGET rows also present | `agent-presets`, `dsh-tui-agent-presets` are replace targets, not inserts | same parse |
| 25 knobs | `SETTINGS_KNOBS` = 13 literal entries + 12 from `TEAM_MODEL_KNOBS` (4 slots x 3 leaves); declaration comment reads "The twenty-five knobs" | `packages/mpd-config-plugin/src/settings-schema.ts` |
| four slots | `TEAM_MODEL_SLOTS = ["slot1","slot2","slot3","slot4"]`; `SettingsSchema.teamModels` declares all four | same file |
| stale string exists | `mpd_config_get` description enumerates only `teamModels.slot1|slot2|slot3...`; a nearby comment says "the three `teamModels` slots" | `packages/mpd-config-plugin/src/index.ts` |
| credit sources traceable | `code-yeongyu` + upstream commit/v5.0.0-beta.20; `https://github.com/NanmiCoder/dsh-agent-teams` with MIT text `Copyright (c) 2026 程序员阿江(Relakkes)`; `@code-yeongyu/comment-checker` 0.8.0; `ast-grep` and `codegraph` present among `VENDOR_LOCK.json` assets | `LICENSE-NOTICES.md`, `VENDOR_LOCK.json` |
| rename state | `docs/design.md` MISSING, `docs/architecture.md` EXISTS | filesystem check |

## 3. How this calibrates the t10 gate

1. Install-section judgement is against the 25 INSERTED rows; correctness of wording is
   "rows this bundle inserts" (the two id-target rows are host rows the bundle overrides).
2. A document stating "25 knobs" is correct. Calling all 13 metadata entries "mpd knobs" when 7 are
   `watchdog.*` sub-fields is a LOW wording observation, not a factual error.
3. A credit naming a handle + URL is acceptable when the source is traceable; only an untraceable or
   wrongly-attributed credit is a finding.
4. FOUR team-model slots is authoritative. The stale three-slot string in `mpd_config_get` is NOT to
   be used as counter-evidence in either direction; the code repair is task t13 (Senior Engineer) and
   is judged on its own contract, never as a documentation lane.
5. Stale `docs/architecture.md` pointers are real findings until t3 lands and t12 repoints the
   non-lane set.

No lane document was written, read into, or amended by this file; t10's own contract is untouched.
