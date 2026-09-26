# DEFERRED — the "no file base" notice (TUI) and the W14 two-surface lane check

Status: **NOT LANDED — deferred by the captain**, work preserved verbatim in
`DEFERRED-residual-notice-and-W14.patch` (author: Senior Engineer, 2026-09-15 ~23:41 local,
found in the working tree by the captain during the watchdog wave; it belonged to no open task).

## Why it was not landed

1. **It regresses a documented disclosure.** The patch short-circuits the status line:
   `if (settings?.baseFromFiles === false) return NO_FILE_BASE_NOTICE` is evaluated BEFORE the
   write-back skip notices. Measured semantics
   (`packages/mpd-config-plugin/src/index.ts:591`):
   `baseFromFiles = baseReason === "one-live-root" || baseReason === "mount-base-root"`, so
   `false` holds **exactly** in the `ambiguous-multi-root` case — the same case that sets
   `writeback.skipped === "ambiguous-multi-root"`. Consequence: after a save that was NOT written,
   the user would see the base sentence instead of
   `AMBIGUOUS_MULTI_ROOT_NOTICE` ("saved to settings — not written to any file: several live
   workspaces…"), i.e. the refusal is hidden. `docs/user-guide` §7.2 and `docs/tui.md` §6.2 name
   that refusal as one of the two documented skip cases.
   **Required correction before landing:** the base notice must be the FALLBACK — evaluated only
   when no write-skip notice applies (or composed after it, never pre-empting it) — and the test's
   two cases must cover the both-hold state.
2. **`skills/**` is the wave's single writer (w9) and the re-pin must ride the same commit.**
   With the lane change present, `node scripts/verify-vendor.mjs` FAILS with
   `asset skills treeSha mismatch`; a skills edit now would cost the wave its one-re-pin invariant.
3. **Evidence is append-only.** The run that produced the patch also OVERWROTE committed evidence
   (`evidence/mpd-bridge/implementation/20260915T080138Z/lane-web/{raw/boot-main.log,raw/boot-disabled.log,output.log,result.json}`).
   Those bytes were restored; a re-run must write a new `<timestamp>/` directory instead.

## What is correct in it (keep when re-working)

- The residual hazard is real and was named by the bridge ruling itself: with N live roots the
  screen falls back to schema defaults while the file may hold other values; the hazard cannot
  reach disk (a save is refused) but the screen is misleading until it is disclosed.
- `NO_FILE_BASE_NOTICE`'s sentence is accurate and pairs with `NO_LIVE_SESSION_NOTICE` /
  `AMBIGUOUS_MULTI_ROOT_NOTICE` in tone.
- The test's shape is right (wired into the status line, absent when a file base exists) and the
  W14 check ("the settings namespace's resolved value EQUALS the value the file on disk carries",
  read independently through a minimal JSONC reader) is a genuine two-surface assertion.
- `skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs` is w9's to edit **with** the corpus re-pin.
