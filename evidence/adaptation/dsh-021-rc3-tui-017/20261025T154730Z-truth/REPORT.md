# T3 — mechanical truth fixes for the dsh-tui 0.17.0 pin: verification record

UTC stamp of this record: 2026-10-25T15:48Z. Measured on `release/v0.15.5` (uncommitted wave tree).

## 0. Attribution — read this first

The three edits T3 asks for were ALREADY PRESENT in the working tree when this worker's first read
executed (file mtimes `2026-10-25 23:46:58 +08:00`; this worker was spawned `23:46:12 +08:00` and its
own two `edit` attempts were refused with "file changed since it was read"). A concurrent writer landed
them, and left its own evidence under `evidence/adaptation/dsh-021-rc3-tui-017/2026-10-25T15-47-02Z-truth/`.

This worker therefore **authored none of the three edits**; what it contributes is an independent
re-verification of the landed content plus the gate evidence below. T3 was never created as a board
task, so two workers held the same write scope — that is the "two writers on one file" defect the wave
contract forbids, and the captain should close one of them before the wave is committed.

## 1. What the tree now says (settled, hashes read twice)

| Path | Symbol / cell | State | md5 (15:48:16Z) |
|---|---|---|---|
| `packages/mpd-tui-adapter-plugin/src/index.ts` | docblock above `PANEL_CSV_HOST_OWNED_SINCE` | reworded: 0.16.1 is the release that INTRODUCED host ownership and is a PERMANENT gate floor; the ADMITTED host is a separate fact in `dsh-plugin.json` `compat.hosts` (0.17.0 since v0.15.5) | `a6d398e12e715fd671aa103d1b9bb3a8` |
| `packages/mpd-tui-plugin/README.md` | "Sidebar pages (dsh-tui 0.13.0+, adapted to 0.17.0)" | target statement updated; no historical measurement line touched | `aa0e3cde0e3bc982a773a844e4fbbc79` |
| `packages/mpd-tui-plugin/README.zh-CN.md` | 「侧栏页面（dsh-tui 0.13.0+，已适配 0.17.0）」 | same statement, same language switch/heading tree | `b6194492b27d8a40d6c225f39263c795` |

Hashes identical at 15:47:30Z and 15:48:16Z (settle window observed), so the content was stable while
the gates ran.

Invariants re-checked by reading the diff, not by trusting the writer:
`PANEL_CSV_HOST_OWNED_SINCE = "0.16.1"` and `PANEL_CSV_SELF_HEAL_SINCE = "0.15.0"` are unchanged; the
src diff is comment-only (no code hunk); `git status --porcelain packages/` lists exactly these three
files (no `packages/*/dist` modification). `grep -rn "admitted on 0.16.1|is the release this bundle is
admitted on" packages/ README.md docs/` returns nothing.

## 2. Gates — commands and OBSERVED results

| Command | Exit | Observed |
|---|---|---|
| `node scripts/verify-dist-fresh.ts` | 0 | `ok: 33/33 targets fresh (each rebuilt twice, byte-identical) — 1 NOT COVERED` (`packages/mpd-mcp-codegraph/dist/serve.js`, sha-pinned prebuilt) |
| `bun run verify:comments` | 0 | `scanned 444 TypeScript file(s) … inspected 39790 declaration(s)` · `VERDICT: PASS` |
| `bun run verify:docs` | 0 | `pairs=50 failed=0 violations=0 … links=453 dead=0 — PASS` |
| `bun run typecheck` | 0 | `tsgo --noEmit`, no diagnostics |
| `bun test packages/mpd-tui-plugin packages/mpd-tui-adapter-plugin` | 0 | `668 pass / 1 skip / 0 fail`, 669 tests across 26 files (14.54 s) |

Logs: `01-comments.log`, `02-docs.log`, `03-dist-fresh.log`, `04-typecheck.log`,
`05-tests-tui-packages.log` in this directory.

## 3. Dist fan-out

No rebuild was needed: a comment-only src edit left the emitted bytes identical, and
`verify-dist-fresh` proves that by rebuilding the adapter (and all 32 other targets) twice and
comparing byte-for-byte. No `packages/*/dist` file is modified in the tree.

## 4. Bounds — what this record does NOT establish

- The full `bun test packages` suite was NOT run (scoped to the two touched packages, as T3 permits);
  other lanes' edits were not judged.
- `verify:rows`, `verify:manifest`, `verify-no-host-override`, `install-profile --dry-run` and the
  Docker lanes were NOT run by this worker (T1/T2 own those; `verify:vendor` is expected red until the
  captain re-pins).
- No plugin behaviour was exercised: every claim above is about static content and static gates.
- Zero new source code was written by this worker, so no unit test proves the reworded comment (it is
  documentation) — the comment gate is the applicable check and it passed.
