# T4 — last stale current-pin claim in the better-sidebar-host README pair

UTC stamp: 2026-10-25T15:51Z. Branch `release/v0.15.5` (uncommitted wave tree).

## 1. The change (one literal, two languages)

| Path | Sentence | Before → After |
|---|---|---|
| `packages/mpd-better-sidebar-host/README.md` (§ "The seam: `connection`, not `webRuntime`") | "…this repository pins `<PIN>`, so the row mounts on every supported composition." | `0.2.1-rc.2` → `0.2.1-rc.3` |
| `packages/mpd-better-sidebar-host/README.zh-CN.md` (§「接缝：`connection`，不是 `webRuntime`」) | 「…本仓库固定的是 `<PIN>`，因此在所有受支持的组合里该行都会挂载。」 | `0.2.1-rc.2` → `0.2.1-rc.3` |

Nothing else in either file changed (`git diff packages/mpd-better-sidebar-host/` in `fix.diff`). The
flanking claim is untouched: the **floor** stays `harness 0.2.1-rc.1+` (a range, not a target), and the
mount/disable behaviour described after it is unchanged prose.

Why rc.3 is the true current pin — read, not assumed:
`package.json` declares `@deepseek-ai/dsh-experimental-agent-team`,
`…-client-ui-agent-team` and `…-tool-agent-team` at `0.2.1-rc.3`; `bun.lock` carries **7** occurrences
of `0.2.1-rc.3` and **0** of `0.2.1-rc.2` (`cross-checks.log`).

## 2. Gate — command and OBSERVED result

`bun run verify:docs` → **exit 0**, run at 23:51:07 (+08:00), i.e. AFTER the 23:51:04 edits:
`pairs=50 failed=0 violations=0 exempt=24 derived=3 links=453 dead=0 — PASS` (`verify-docs.log`).

## 3. Survivor sweep — every remaining `0.2.1-rc.2` in the tracked doc band, classified

Command: `git ls-files '*.md' | grep -v -E '^(evidence|dist|\.mpd)/' | xargs grep -n "0\.2\.1-rc\.2"`
(`pin-survivors.log`). No survivor is a current-pin claim; each is history or a version attribution:

| Survivor | Kind | Judgement |
|---|---|---|
| `README.md` / `README.zh-CN.md` correspondence-table rows (0.15.4, 0.15.2, 0.15.1, 0.15.0, 0.14.0) | per-release record | LEGITIMATE — each row is the pin OF THAT RELEASE; the 0.15.5 row reads `0.2.1-rc.3 / 0.17.0`, and the paragraph above the table states a newer host is not claimed until a release row names it |
| `CHANGELOG.md` v0.14.0 entry | release history | LEGITIMATE |
| `docs/tui.md` / `docs/tui.zh-CN.md` preamble | explicitly framed history | LEGITIMATE — "**The pin before it was 0.16.1, and that statement stays readable as history**: 0.16.1 is the first dsh-tui release whose declared peer bands included harness `0.2.1-rc.2`" |
| `docs/tui.md` §11.8 rows / `docs/tui.zh-CN.md` twin | that wave's amendment record | LEGITIMATE — §11.8 is the 0.16.1 wave; §11.10 (present in both languages) records the 0.17.0 / `0.2.1-rc.3` move |
| `docker/README.md` / `.zh-CN.md` | bearer history | LEGITIMATE — states what `0.16.1`'s declared bands admitted |
| `agent-references/troubleshooting.md` | dated measurement | LEGITIMATE — names the 2026-10-23 probes of the then-mounted official `0.2.1-rc.2` builds |
| `packages/mpd-dsh-adapter-plugin/README{,.zh-CN}.md` | "Honest bound on harness 0.2.1-rc.2" | LEGITIMATE (T4 names it): a measurement attributed to that harness release |
| `packages/mpd-bundle/README{,.zh-CN}.md` | "harness 0.2.1-rc.2's schema no longer declares it" | LEGITIMATE (T4 names it): a schema attribution for the field's removal |

`0.16.1` survivors were swept the same way: every hit is a RANGE or a gate threshold
(`>= 0.16.1` in `docs/user-guide{,.zh-CN}.md` and `packages/mpd-tui-adapter-plugin/README{,.zh-CN}.md`,
`PANEL_CSV_HOST_OWNED_SINCE = "0.16.1"`), plus `docs/tui.md` §11.10's own row saying those range
statements stay unchanged — none is a current-pin claim.

Current-pin phrasing sweep (`pin-current-claims.log`: `pins 0.2.1-rc*`, `本仓库固定`, `targets
@deepseek-harness-tui`, `current pin`, `当前钉`) now returns ONLY `0.2.1-rc.3` / `0.17.0` claims — in
`docs/development{,.zh-CN}.md`, `docs/user-guide{,.zh-CN}.md`, `docs/tui.md` and this package pair.

## 4. Bounds

- Only the two READMEs were edited; no source, no `dist/**`, no `VENDOR_LOCK.json`, no `.mpd/**`, no
  `evidence/**` history.
- `verify:docs` is the only gate run for T4 — the change is prose plus one literal, so no typecheck or
  test can observe it. `verify:rows`, `verify:manifest`, `verify-no-host-override`, the Docker lanes and
  `bun test` were NOT run here.
- `dist/mpd-package/packages/mpd-better-sidebar-host/README{,.zh-CN}.md` still carry `0.2.1-rc.2`; that
  tree is a packed artifact the captain re-packs, and T4 forbids touching `dist/**` — it is NOT fixed
  by this task.
- Whether `0.2.1-rc.3`'s agent-team schema still omits `maxPendingMessagesPerMember` (the sentence left
  alone in `packages/mpd-bundle/README{,.zh-CN}.md`) was NOT re-verified — that needs the rc.3 package's
  own schema, not a README edit; reported, not fixed.
