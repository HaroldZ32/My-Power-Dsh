# Workmate README — in-use gate description repair

Lane: integration docs repair, branch `fix/team-board-settlement`, **2026-10-22**.
Task: the "Refused while in use" paragraphs of `packages/mpd-workmate-plugin/README.md` and
`README.zh-CN.md` still described the in-use scan as reading ONLY the retired
`<workspace>/.mpd/team/<teamId>/team.json` record.

## Intent

Describe what the shipped gate actually reads and when a team stops blocking, in both
language files, without changing any other claim.

Source of truth read (symbol citation, not a line number): `busyTeams` in
`packages/mpd-workmate-plugin/src/index.ts` — it scans BOTH layouts
(`.mpd/team/teams/<teamId>.json`, the mpd-owned authoritative record, and
`.mpd/team/<teamId>/team.json`, the retired legacy record), skips an mpd-owned record carrying
`endedAt`, and skips mpd-owned members whose status is `inactive` or `failed`.

## Changed

| File | Section | Change |
|---|---|---|
| `packages/mpd-workmate-plugin/README.md` | "Refused while in use" | now names both record layouts, the end-of-team release (`endedAt`, or no `team.json` for an archived legacy team) and the settled-member release (`inactive` / `failed`) |
| `packages/mpd-workmate-plugin/README.zh-CN.md` | "正在被使用时拒绝" | the same claims in 简体中文, in lockstep with the English text |

No other claim was edited. No git write command was run.

## Gate

Command: `bun run verify:docs` (from the repo root). Observed exit code: `0`.

Observed tail of the output:

```
[verify-docs-parity] links=440 checked=408 resolved=408 dead=0 exemptProvenance=0 absentSite=0 ignoredExternal=26 ignoredAnchorOnly=6 files=119

[verify-docs-parity] root=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh pairs=49 failed=0 violations=0 exempt=24 derived=3 links=440 dead=0 — PASS
```

Both `packages/mpd-workmate-plugin/README.md` and its zh-CN twin print `ok` in the same run; the
run reports `pairs=49 failed=0 violations=0`.

## Bounds

- Docs-only change; no typecheck, test, dist or mount lane was run (none covers a README edit).
- The gate proves the bilingual pair, switch link, heading tree, CJK content and link resolution.
  It does not prove the prose is accurate — accuracy here rests on the `busyTeams` implementation
  read above.
