# t13 evidence — `mpd_config_get` advertises FOUR team-model slots, not three

Task: t13 (work, attempt 1, attempt_id 4dc36720-e222-44fd-ad4b-8d36b8f53673), assignee Senior Engineer.
Workspace: /root/dshProj/my-power-dsh · branch dev · base revision at start: dev@a9c3c3e.

## 1. What was wrong

`packages/mpd-config-plugin/src/index.ts` advertised THREE team-model slots while
`packages/mpd-config-plugin/src/settings-schema.ts` declares FOUR
(`export const TEAM_MODEL_SLOTS = ["slot1", "slot2", "slot3", "slot4"] as const`, line 15, with
`TEAM_MODEL_SLOT_DEFAULTS.slot4` = the vision route). Four stale spots, all text-only:

| # | Line (before) | Stale text | Corrected text |
|---|---|---|---|
| 1 | 150 | "the raw merged file config with the **three** `teamModels` slots" | "… with all **four** `teamModels` slots" |
| 2 | 167-168 | "leaves **slot1/slot3** wholly at their defaults" | "leaves **every other slot** wholly at its defaults" |
| 3 | 629 | `teamModels.slot1\|slot2\|slot3.provider/model/reasoningEffort.` | `teamModels.slot1\|slot2\|slot3\|slot4.provider/model/reasoningEffort.` |
| 4 | 637 | "still shows the **three** complete slots this tool reports" | "still shows the **four** complete slots this tool reports" |

No behavior, tool name or `mpd.jsonc` contract changed: the diff is description/comment text only.

## 2. Diff summary

- `packages/mpd-config-plugin/src/index.ts` — 4 text edits as tabled above.
  sha256 e43e6a8483c8dd732633d8c20e30af6444cf1a7acee73d9b12a014556b7db87e
- `packages/mpd-config-plugin/dist/index.js` — rebuilt with the canonical repo-root command.
  sha256 566af9ee75394327be0b527b5dfb77acb45c5b865af72fc14abe2047e65866e6

## 3. Commands run and their exit codes

| Command | Exit | Evidence |
|---|---|---|
| `grep -nF 'slot1\|slot2\|slot3.' packages/mpd-config-plugin/src/index.ts` (literal, pre-edit) | 0 (match) → post-edit **1 (no match)** | the stale spelling is gone from the source |
| `bun build packages/mpd-config-plugin/src/index.ts --target node --format esm --outfile packages/mpd-config-plugin/dist/index.js` | **0** | "Bundled 7 modules in 29ms … index.js 116.96 KB (entry point)" |
| `grep -c 'slot1\|slot2\|slot3\|slot4' packages/mpd-config-plugin/dist/index.js` | **0 (1 match)** | the BUILT artifact carries the corrected string |
| `grep -cF 'slot1\|slot2\|slot3.' packages/mpd-config-plugin/dist/index.js` | **1 (0 matches)** | the stale spelling is absent from the BUILT artifact |
| `bun test packages/mpd-config-plugin` | **0** | 84 pass / 0 fail, 585 expect() calls |
| `node scripts/verify-dist-fresh.mjs` | **0** | `ok: 20/20 targets fresh (each rebuilt twice, byte-identical)` — 7 NOT COVERED build-metadata/prebuilt files listed by the gate itself |

The matching line quoted from the BUILT artifact
(`packages/mpd-config-plugin/dist/index.js`, produced by the build above):

```
n/commentChecker.timeoutMs/commentChecker.maxMessageChars, modelchain.<chainKey>, boulder.dir, ulw.maxRounds/ulw.planDir/ulw.stateDir/ulw.provider/ulw.model/ulw.reviewerModel/ulw.maxReReviews, teamModels.slot1|slot2|slot3|slot4.provider/model/reasoningEffort.
```

No `three` occurrence remains anywhere in `packages/mpd-config-plugin/src/index.ts`
(`grep -n three …` → exit 1, no match).

## 4. Acceptance mapping

- "no longer claims three team-model slots anywhere" — PASS: table above; literal greps in §3.
- "using the slots the source itself declares … slot1..slot4" — PASS: the corrected string names
  slot1..slot4, the exact tuple of `TEAM_MODEL_SLOTS`.
- "Slot 4's default route stays the vision model already declared in `TEAM_MODEL_SLOT_DEFAULTS`" —
  PASS: `settings-schema.ts` is untouched (out of scope, unchanged bytes).
- "No other behavior changes" — PASS: `bun test packages/mpd-config-plugin` exit 0; the edits are
  comment/description text.
- "dist rebuilt with the canonical command and `verify-dist-fresh` exits 0" — PASS: table above.
- "the corrected string is proven present in the BUILT artifact" — PASS: quoted line above.
