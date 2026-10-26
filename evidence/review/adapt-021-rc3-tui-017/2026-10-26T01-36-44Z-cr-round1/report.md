# Blessing — CodeRabbit reconciliation delta (commit `ae8aa123`)

**BLESS**

Reviewer: reviewer (team M2, task T9). Subject: `ae8aa123` ("reconcile the three CodeRabbit findings")
on top of the release commit `dd5c4e2a`. Findings only — no file edited.

**Delta scope, proven:** `git diff --stat dd5c4e2a..HEAD` is exactly four files — `CHANGELOG.md`,
`docs/tui.md`, `docs/tui.zh-CN.md`, `dsh-plugin.json` — plus five files in one new evidence directory
(`evidence/adaptation/dsh-021-rc3-tui-017/20261026T013156Z-cr-round1/`). Working tree clean; no
non-evidence untracked path. Nothing else moved.

## 1. CHANGELOG table provenance — exact

The new split is precisely what the artifacts support. The five historical rows really are
tag-readable — `v0.14.0`, `v0.15.0`, `v0.15.1`, `v0.15.2`, `v0.15.4` all exist — and `v0.15.5` really is
absent, so the replaced sentence ("every cell read from its release tag") was false for the 0.15.5 row
and its withdrawal is correct. The replacement claim ("the 0.15.5 row is read from THIS release's own
files in the release commit") is exactly true: `dd5c4e2a`'s `package.json` carries `version` 0.15.5 and
the three `@deepseek-ai/dsh-experimental-*` dependencies at 0.2.1-rc.3, its `dsh-plugin.json`
`compat.hosts` names `…dsh-tui@0.17.0`, and its `dsh-distribution.json` `host-tui` ref names 0.17.0 —
the row's three cells, cell for cell. (I had independently re-derived all five historical rows from
their tags at review T2; they still agree.)

## 2. Docker bounds — every number verified against the two committed `result.json` files

Both files are tracked (`evidence/docker/client-install/<stamp>/result.json`), both carry `ok: true`,
`complete: false`, and 122 assertions.

**Stamp `2026-10-25T16-02-51Z`** — `total 122, passed 77, failed 0, null 45`. The null families are
`qa` 1, `oneclick` 4, `live` 30, `boot` 1, `ui` 9 — **exactly** the paragraph's breakdown (4 by mode +
30 credential-gated live + `boot.llmTurn` + 9 opt-in browser + `qa.mcpCall`). Each family's stated
reason is the artifact's own reason: `oneclick.*` "not applicable in mode=source"; `boot.llmTurn` "not
attempted: a live LLM turn needs provider credentials"; `ui.loads` "not attempted: the browser lane is
opt-in (`MPD_E2E_BROWSER=1`)"; `qa.mcpCall` "[mcp-call] missing credentials" — so "which needs a key" is
accurate, not inferred. All **22** `tui.*` assertions are true, and the named ones say exactly what the
paragraph says: `tui.boot` raw `tmux=new-session-ok ready=chat-screen noLaunchpad=1` with the reason
"the REAL TUI booted on a real PTY and reached its CHAT screen"; `tui.hostInstall` raw `version=0.17.0`;
`tui.sessionPreset` raw `agentPreset=mpd`; `boot.presetMount` true; `harness.version` raw `0.2.1-rc.3`.

**Stamp `2026-10-25T16-13-29Z`** — `117 passed, 0 failed, 5 null (oneclick.scratchRepo,
oneclick.requiredPaths, oneclick.filesAllowlist, oneclick.distByteIdentical, ui.teamBoard)` — the
paragraph's list exactly. `live.web`/`live.tui`/`live.headless` `mpdToolCalled` and `assistantReplied`
are all true, `boot.llmTurn` is true ("a live headless turn ran to turn/end reason=completed, read from
the harness's own session store"), and 8 of the 9 `ui.*` rows are true with `ui.teamBoard` null.

**The surviving bound is true.** The one-click lane was NOT run in this wave: both wave stamps are case
`docker-client-install` ("… from a copy of this checkout"), and the newest
`client-install-oneclick` stamp is `2026-10-25T09-51-46Z`, hours earlier. So "the one-click lane against
the published package was NOT run … what these stamps measured is the checkout install, never the packed
artifact" is correct.

**Provenance — stronger than the claim it supports.** Each `result.json` carries 30 file hashes taken
inside the container. I recomputed all 30 against `dd5c4e2a`: **30/30 identical, 0 differing, 0 absent**
— including `package.json` at `53704a4a…`, the exact hash I anchored the T7 blessing to. The lanes
therefore ran on the very bytes that became the release commit, so "on this wave's final tree" is
proven, not asserted.

**Languages in step.** EN and zh-CN cite the same two stamps, the same counts, the same null families
and the same single surviving bound.

## 3. Manifest disclosure note — one literal, nothing else

The `dsh-plugin.json` diff is exactly one `-`/`+` pair on `x-mpd-tui-surfaces.note`: the bundle literal
`0.15.1` → `0.15.5`, with the separate TUI package literal `0.1.0` preserved. `version` (0.15.5),
`manifestVersion` (0.15), `$schema`, `compat.hosts` and every other key are untouched, and the file now
contains no `0.15.1`. The pre-fix state was real: the release commit `dd5c4e2a` did carry the stale
`0.15.1`.

## Gates I re-ran myself (logs in `evidence/review/…/2026-10-26T01-36-44Z-cr-round1/`)

| Gate | Exit | Observed |
|---|---|---|
| `verify:docs` | 0 | `pairs=50 failed=0 violations=0 exempt=24 derived=3 links=453 dead=0 — PASS` |
| `verify:manifest` | 0 | `6 self-urn ref(s) compared against distribution.version 0.15.5, 0 stale`; `VERDICT: PASS` |
| `verify-pack-closure` | 0 | `content bytes: 614 file(s) compared, 614 identical, 0 drift, 0 expected-after-pack`; `completeness: 513 declared source file(s) compared, 512 present, 1 declared exemption(s), 0 absent`; pack stamp `2026-10-26T01:34:43.355Z` |

I also confirmed the re-cut pack **carries** the reconciliation: `dist/mpd-package/CHANGELOG.md` has the
new provenance sentence and `dist/mpd-package/docs/tui.md` has the new Docker-bounds paragraph; the pack
stamp (`01:34:43.355Z`) is after T8's evidence stamp (`01:31:56Z`) and matches the commit second.

## Findings

### 1. Nit (non-blocking) — one shorthand row too wide in the second Docker sentence

`docs/tui.md` §11.10 / `docs/tui.zh-CN.md` twin: the sentence says "… 5 null (the four `oneclick.*` rows
plus `ui.teamBoard`, not asked) … and the `ui.*` rows true" (zh: "`ui.*` 各行为真"). `ui.teamBoard` *is*
a `ui.*` row and the same sentence says it is null, so the shorthand contradicts its own parenthetical by
one row. The explicit null list is correct, so nothing false is asserted; a tighter wording would be
"the `ui.*` rows that were asked" / "其余 `ui.*` 行". Fix or leave; it does not block the reconciliation.

## Declined to judge

- The literal `complete: false` is not quoted in the paragraph: every cause of incompleteness IS disclosed (mode-gated `oneclick.*`, credential-gated `live.*`/`boot.llmTurn`, opt-in browser `ui.*`, key-gated `qa.mcpCall`) plus the surviving one-click bound, so no reader can mistake the run for a full matrix.
- Calling the whole 30-row `live.*` family "credential-gated": a family-level shorthand; the artifact's own `doesNotProve` says "no credentials are staged", and three of the rows are literally credential probes.
- The manifest note's version literal can rot at the next bump. Declined: it is the note's established style (it also names the TUI package's `0.1.0`), the adjacent `version` field is authoritative, and T8's brief fixed exactly this literal.
- The pack's root carries only `package.json` (the packer's declared root set is 1/1): so FIX 3 lands in the repo/npm manifest, not in `dist/mpd-package`. That is the packer's declared shape, not a regression of this delta.
- The README table content and the older CHANGELOG entries: cleared in T2/T7, untouched by this delta.
- The Docker lanes themselves were not re-run by me (I verified their committed results and hashes, which is stronger for provenance but does not re-execute them).

## Bounds

- I judged the three edits against the tree and the committed evidence, not against CodeRabbit's original
  wording (I read the task's summary of the three findings, not the review text).
- Docker was not re-executed; the registry is unreachable from this sandbox. The pack was not rebuilt —
  it is the captain's artifact, cut at `01:34:43.355Z`, and I verified its contents rather than re-cutting.
- No host boot; the `live.*` evidence is the committed lane output, not a fresh run.

## Verdict

**BLESS the reconciliation.** All three findings are correctly and truthfully fixed, the numbers match
the committed artifacts exactly, the Docker provenance is proven by the lanes' own hashes against the
release commit, and the only residual is a one-row wording shorthand that asserts nothing false.
