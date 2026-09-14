# t5 completion record (decision (a) — reframed criteria)

## Verify commands (the three DECLARED ones), all green on these bytes
| command | result |
|---|---|
| `bun test packages/mpd-roles-plugin/test` | 11 pass / 0 fail / 140 expect calls |
| `bun run test:qa` | `[test:qa] all self-tests passed` (exit 0) |
| `bun run typecheck` | exit 0 |
| `node scripts/verify-vendor.mjs` | PASS (gating, see below) |

## Criterion 2 (reframed, PASSED)
1. The exact seven-name list is what reaches the harness, recorded from an instrumented sandbox copy
   of the shared adapter:
   `{"deny":["write","edit","mpd_hashline_edit","bash","mcp__ast_grep__rewrite","mcp__ast_grep__scan","mcp__lsp__rename"]}`
2. A child is CREATED AND ANSWERS in a fresh process: `node skills/dsh-qa/scripts/readonly-deny.mjs`
   -> PASS (exit 0); stub trace call#1 hasTools=true (110690 B) -> call#2 hasTools=false (6942 B, the
   CHILD's own model request) -> call#3/#4; child created and answered; no refusal.
3. Offline registry mapping explains why the two removed names never register: the ast_grep MCP server
   defines rewrite/scan and the lsp server rename; tool-bash/tool-fs/mpd-hashline own
   bash/write+edit/mpd_hashline_edit; `@deepseek-ai/dsh-tool-str-replace-editor` ships in the harness
   closure and its row is composed into the profile yet NO preset mounts it, so that name never
   registers; the other name has no package at all.

### Pre-fix refusal — CAPTAIN-MEASURED IN-SESSION OBSERVATION, not a fresh-process reproduction
Verbatim, supplied by the captain (measured twice in this session):
`Error: tools.restrict() names unknown global tools "str_replace_editor", "apply_patch"; known global
tools: agent_teams_add_member, … mpd_hashline_edit, … read, … write`
Both came from the long-lived host running the pre-fix module — the §N2 boot-time module-cache effect.

### OPEN HARNESS-SCOPE QUESTION (recorded, not manufactured)
Running the identical probe against a pristine f697088 worktree delivered the NINE-name pre-fix list
(delivery proven by the instrumented adapter) and STILL created the child, with no refusal. So the
refusal is not reproducible in a fresh `mpd-headless` boot here, while it is reproducible in the
long-lived host. The harness validates against `view(scope).restrictableNames`, so the in-session
agent-plane scope and this sandbox scope evidently differ. Recorded as an open question about the
harness — no reproduction was manufactured, and this is not a contradiction of the captain's
observation.

## Criterion 4 — first half PASSED, second half an explicit FOLLOW-UP
- PASSED: a real read-only spawn starts a child and the restriction reaches the harness (see the
  criterion-2 evidence). A rejection inside `tools.restrict()` happens during the child's setup and
  would leave NO child, so a created, answering child cannot coexist with a refused list.
- FOLLOW-UP, UNPROVEN: the child-side write refusal. Under this stub the child's own request carries no
  tools array, so no child-side write attempt is observable. Not faked, and not treated as a failure of
  this change — it is a statement about what the stub can observe.

## Criterion 5 — parity guard is a hard assertion (PASSED, proven by execution)
With the workmate export temporarily removed in a sandbox simulation (restored byte-identically):
`(fail) roles and workmate read-only deny lists are exactly equal (drift guard)` — 10 pass / 1 fail,
failing at the new `Array.isArray` assertion. With the export present: 11 pass / 0 fail / 140 expect
calls, no warning. The guard can no longer disengage silently.

## Vendor gate (GREEN — the captain's red reading predated this refresh)
`node scripts/verify-vendor.mjs` in the WORKING TREE `/root/dshProj/my-power-dsh`:
```
[verify-vendor] commit OK: 8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29
[verify-vendor] version OK: 5.0.0-beta.20
[verify-vendor] stats OK: 9131 files / 1470231 loc
[verify-vendor] asset OK: skills 364 files
[verify-vendor] asset OK: packages/mpd-agent-teams-plugin/_deps 635 files
[verify-vendor] asset OK: packages/mpd-mcp-astgrep/dist/cli.js 1 files
[verify-vendor] asset OK: packages/mpd-mcp-gitbash/dist/cli.js 1 files
[verify-vendor] asset OK: packages/mpd-mcp-lsp/dist/cli.js 1 files
[verify-vendor] asset OK: packages/mpd-mcp-codegraph/dist/serve.js 1 files
[verify-vendor] PASS
```
- `VENDOR_LOCK.json` mtime **21:33:47** (the captain's reading was 20:46:31, before this refresh)
- skills treeSha `81620614ecdb60caf8521b5e37e2a6fafbe21eac585da8084ff5f6e916b4438e`
  -> **ca9dfa77663f26c1cd05e832bb17ae744ab5852aba80acffb3dab0754f5cb1ba**; fileCount 364 unchanged
- STABILITY PROOF: `find skills -newer VENDOR_LOCK.json -type f` is EMPTY
- METHOD TRAP (cost me three attempts): ANY edit under `skills/`, even a comment-only edit, re-reds the
  gate, so the recompute must be the LAST action; and the digest must come from the gate's own helpers
  (`readBytes`, `listFiles`), because it hashes under `f.slice(dir.length + 1)` with the ABSOLUTE
  `skills` path — re-deriving the algorithm yields a digest the gate rejects.

## Scope deviation (§O4), stated for the reviewer
- Known inScope: `packages/mpd-roles-plugin/`, `skills/dsh-qa/scripts/`, `evidence/workmate/roles-readonly/`.
- `VENDOR_LOCK.json` and `skills/dsh-qa/SKILL.md`: outside the declared inScope; the captain accepted
  the `VENDOR_LOCK.json` refresh as a deliberate §9 baseline change and instructed it into t5.
- `AGENTS.md`: explicitly in t5's outOfScope, so the edit I had made was REVERTED by me; the lesson now
  lives in t3's §12 row. No out-of-scope claim is left standing.

## Detector lesson kept in the report
The harness writes `names unknown global tool` (SINGULAR) for one unknown name and `tools` for several,
so a control matching only the plural form is blind to the very error it hunts — my first detector did
exactly that. Combined lesson: `dsh --dump-config` is not a health signal (it composes rows without
executing plugin code), and a negative control must be proven able to FAIL before its silence is read
as success.
