# fix/tui-refresh — review repair: two documentation claims

Branch `fix/tui-refresh`. Scope: `docs/tui.md` + `docs/tui.zh-CN.md`, EN and 简体中文 in lockstep.
No code, test, README or troubleshooting-row change. No git write command was run (the captain commits).

## Finding 1 — `DSH_TUI_DISABLE_MOUSE=1` (§3.5, "When the screen looks wrong", third bullet)

**Was:** "turns mouse tracking off" and offered as the remedy for "a wheel the shell also consumes".

**Is (pinned host dsh-tui 0.16.1):** `lib/types/utils/fullscreen.js#isMouseClicksDisabled` feeds
`App.js#handleMouseEvent`, which returns before its click branch and leaves wheel scroll intact;
`AlternateScreen.js` enables mouse reporting unconditionally. So the flag disables the in-app
click/selection handling ONLY — mouse reporting and wheel scrolling stay explicitly ACTIVE — and it is
not a remedy for a shell-consumed wheel.

**Now:** the bullet states exactly that, names all three host symbols, states that reporting and wheel
scrolling remain active, and routes a shell-consumed wheel to the terminal / tmux / fullscreen lever
(the tmux bullet below it) instead. zh twin rewritten to the same claims.

## Finding 2 — §3.4 "surfaces update by PUSH", final sentence

**Was:** the fallback tick is 1000 ms and "the 1000 ms sidebar tick and the 2000 ms scene tick stay,
unchanged" — contradicting §3.5, both package READMEs and `DAG_PANEL_REFRESH_MS=2000`
(`packages/mpd-tui-plugin/src/panel-dag.ts`).

**Now:** the 76–85 ms figure is kept and explicitly marked a 0.14.0-era record; the 1000 ms tick is
marked the value AT THAT MEASUREMENT; the live cadence is deferred to §3.5 — one 2000 ms tick on every
MPD surface as the fallback for a composition without a feed. zh twin rewritten to the same claims.

## Untouched on purpose

- The troubleshooting row's vaguer "Mouse misbehaving" line — not false.
- `packages/*/README*`, all code and all tests.

## Gate

```
$ bun run verify:docs
[verify-docs-parity] links=440 checked=408 resolved=408 dead=0 exemptProvenance=0 absentSite=0 ignoredExternal=26 ignoredAnchorOnly=6 files=119
[verify-docs-parity] root=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh pairs=49 failed=0 violations=0 exempt=24 derived=3 links=440 dead=0 — PASS
exit 0
```
