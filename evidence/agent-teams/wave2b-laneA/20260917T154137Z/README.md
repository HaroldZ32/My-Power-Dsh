# t48 (impl-A/4d) — P1d: the hard pre-send gate. DELIVERED

**Task:** `t48`, attempt 1, attempt_id `d5dde44e-8cc9-4f45-8f31-8a53bd937cfd`.
**Verify:** `bun test ./packages/mpd-agent-teams-plugin` → **278 pass / 0 fail / 2453 expect() calls / 43 files, exit 0**.

## What landed

- **The READ tool** — `agent_teams_mailbox_check(recipient, content)` (`mpd-delta mailbox-check-tool`,
  `lib/tools.js`): READ-ONLY, process-local, registered per call; it reports EVERY same-identity /
  same-recipient match **at ANY age** with `id`, `ts`, `age_ms`, `dup_count` and `within_fold_window`,
  plus the resolved `window_ms` and the `checked_at` moment. It never claims, acknowledges, folds or
  writes. Registered in BOTH tool-name lists (`lib/tool-names.js`) so every seat that can send can check.
- **The HARD GATE** — `mpd-delta mailbox-send-gate` (`lib/tools.js`): a send that would REPEAT an
  existing `(from,to,content)` record is REFUSED unless `confirm_duplicate: true`, and the refusal NAMES
  the record — `id (ts …, age … ms, dupCount …)` — then says how to proceed (check, then confirm). The
  check record is consumed per call and expires; the FOLD stays the safety net and never the gate.
- **The ANY-AGE reader** — `mailboxDuplicatesFor()` inside `lib/state.js`'s existing
  `message-channel-r1` region, sharing `messageDedupKey` with the fold so gate and fold can never
  disagree about what a duplicate is. The window decides FOLDABILITY, never VISIBILITY.

## Arms, both sides

| reading | result |
|---|---|
| `self-fix-tests/t48-mailbox-gate.test.mjs` | **3 pass / 0 fail / 22 expect()** — an unchecked identical send is REFUSED and the refusal names the record with its age and dupCount (and the refusal writes NOTHING); the read tool reports id/ts/age/dupCount/window/moment and a no-match check writes nothing; checked-and-confirmed is ALLOWED and FOLDS (`dupCount: 2`, same `message_id`); different content is NEVER blocked; the escape has no default |
| NEGATIVE CONTROL — the gate removed from a scratch copy | **exit 1**, the refusal arm reddens (the send now succeeds) |

## Declared moved pins (before the edit, as the acceptance demanded)

`test/task-contract-tool.test.mjs` — `tools.size` 20 → **21** and the exact sorted list gained
`agent_teams_mailbox_check`; `test/t52-interjection-tools.test.mjs` — the send tool's declared
parameters are now `["confirm_duplicate", "content", "from", "to"]`; `test/t49-send-dedup-wiring.test.mjs`
— **5 deliberate-repeat call sites** in the R1 WIRING family now carry `confirm_duplicate: true`,
because their subject IS the fold (a deliberate repeat) and the gate is exactly what now asks them to
say so.

## The instrument and the marker rules

`edit → --write-registry → --check` green at **99 regions / 10 adopted files** (`--check` exit 0), AND
the FULL suite green, AND the heal suite **21/0**; `verify:docs` PASS with its derived arm true (the
count sentence moved in this same change, 96 → 99). Three SIBLING regions were added — no marker was
nested and no function was split; `mailboxDuplicatesFor` lives inside the existing
`message-channel-r1` block with no marker of its own.

## Bounds

No repo-wide aggregate; every path-qualified command `./`-formed with its discovered count reported
(278/43; 3/1; 21/1; 139/13). `packages/*/dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json`,
`.mpd/plans/**` and `skills/**` untouched. Cross-lane reading taken after the edit:
`bun test ./packages/mpd-team-watchdog-plugin` → **139 pass / 0 fail / 684 expect() / 13 files**, no break.

## Files

`lib/state.js` (the any-age reader), `lib/tools.js` (the tool, the gate, the import region),
`lib/tool-names.js` (both lists), `lib/mpd-deltas.js` (regenerated, 99 regions),
`self-fix-tests/t48-mailbox-gate.test.mjs` (NEW), the three moved-pin test files,
`agent-references/agent-teams-deltas.md` (count sentence, same change), and this directory
(`README.md`, `arms-after.out.txt`, `arms-negative-control.out.txt`, `suite.log`, `heal.log`,
`registry-check.log`, `verify-docs.log`, `cross-lane.log`).
