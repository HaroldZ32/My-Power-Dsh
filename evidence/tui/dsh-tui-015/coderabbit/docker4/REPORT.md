# docker4 — the `16c-owed-cases` budget COMMENT refreshed to the shipped numbers

Author: **Senior Engineer**, wave `fix/coderabbit-pr42`. Scope: **`docker/entrypoint.sh` only — the
comment of the `16c-owed-cases` budget block (lines 2203–2226 in the shipped file)**. No executable
line, no other file, no git writes. Verified by the two gates the task names, on settled hashes.

## 1. What changed (prose only)

| Claim in the comment | Before (STALE) | After (SHIPPED) |
|---|---|---|
| the case's measured wall clock, as the floor's rationale | `44:07 = 2647 s for its two arms, each a cold non-linked install plus a boot` (`skills2/mcp-call-real.log`) | `a 70.8–113.1 s range end to end over three green runs (70.8 s, 79.0 s, 113.1 s)` (`skills3/lane-mirror.log, lane-frozen.log, lane-final.log`) |
| the runner's per-case ceiling | `` `LIVE_CASE_TIMEOUT_MS` = 1800 s in `docker/lib/owed-cases.ts`) is unchanged `` | `` `LIVE_CASE_TIMEOUT_MS` = 2400 s in `docker/lib/owed-cases.ts` `` |

Kept verbatim in substance (required by the task): the opening "budget must exceed the budget of the
case it encloses" claim; the **non-linked-install rationale** (`npm install --install-links`; *a linked
`file:` pack never materializes its OWN dependencies*, so the pack-declared `@ast-grep/cli` stayed
unresolved and the launcher answered `BINARY_NOT_FOUND`); the **cold-link measurement 1037 s now
labelled `SLOW-LINK case`**; the **case's own install budget `` `INSTALL_TIMEOUT_MS` = 1800000 ms
(1800 s) ``**; the **ordering rule sentence** ("an OUTER budget smaller than the INNER budget it
encloses turns the inner one into decoration"); `3600 s` as a CEILING for the slow-link case;
`MPD_E2E_STEP_TIMEOUT` still wins when set LARGER; the closing bound that 16c is the last `run_step`.

## 2. Proof the diff is COMMENT-ONLY

`comment-only.diff` (`diff -u entrypoint-before.sh entrypoint-after.sh`):

```
removed=17 added=19   non-comment changed lines = 0
```

Every changed line starts with `#`; the diff's context lines include the executable block
(`OWED_CASES_TIMEOUT=3600`, the `if [ "$STEP_TIMEOUT" -lt … ]`, the `log`, the `run_step`) — i.e. they
are byte-identical. Line numbers after the edit shift by +2 (`OWED_CASES_TIMEOUT=3600` moved
2225 → 2227) because the comment grew by two lines; no executable content moved.

## 3. Gates (the two the task names)

| Gate | Command | Observed |
|---|---|---|
| Syntax | `bash -n docker/entrypoint.sh` | **exit 0**, **0 bytes** of stdout+stderr (`bash-n-entrypoint.log`) |
| Self-test | `node scripts/docker-e2e.ts --self-test` | **exit 0**, `[self-test] all arms passed (offline: no docker, no network)`, **ok=191 FAIL=0** (`docker-e2e-selftest.log`) |

Settled hashes (`gate-results.log`): `4a4bd18dd93632768c7473c33301b5c3b88eae8511979b0787a67f9dad150abc`
read at **2026-10-15T06:51:13Z** (before the gates) and **06:51:14Z** (after) — `settled_identical=true`.

## 4. Negative controls (transient mutations, byte-restored)

Both were applied to the real file inside ONE shell invocation, then restored from
`entrypoint-frozen.sh`; the restore was verified by sha256.

1. **The gate is falsifiable on this file** — removing the `set -euo pipefail` substring:
   `negative_control_exit=1`, `[self-test] FAIL entrypoint is strict bash`, `ok=190 FAIL=1`
   (`selftest-negative-control.log`). *(A first, weaker attempt mutating only the two anchored lines
   stayed green, because three `bash -c 'set -euo pipefail; …'` lines still carried the substring —
   recorded here because it is exactly the trap a reviewer should know about.)*
2. **The gate does NOT pin this comment** — mutating the comment's own number
   (`` `LIVE_CASE_TIMEOUT_MS` = 2400 s `` → `1800 s ` in the 16c comment only):
   `comment_only_control_exit=0`, `ok=191 FAIL=0` (`selftest-comment-mutant.log`).

Restore was byte-identical in BOTH controls
(`entrypoint_after_restore == entrypoint_before == 4a4bd18d…`, `restored_byte_identical=true`).

## 5. Sources re-derived, not merely copied

| Number in the new comment | Where it was read | Result |
|---|---|---|
| 70.8 s / 79.0 s / 113.1 s | `skills3/lane-mirror.log` (`1:10.81`), `lane-frozen.log` (`1:19.04`), `lane-final.log` (`1:53.09`) — all `[mcp-call] PASS`, `Exit status: 0` | confirmed |
| `docker3/lane-final.log` | sha256 `ec0d686c5b1ea24ada4eb4355215603cf1fdf9b479f4f2735370aaa09982b7d4` — **identical** to `skills3/lane-final.log` | confirmed |
| 1037 s cold link | `skills/install-links-duration.log`: `install-links duration_seconds=1037 exit=0` | confirmed |
| `INSTALL_TIMEOUT_MS = 1800000` | `skills/dsh-qa/scripts/mcp-call.ts` (declaration; also `if (INSTALL_TIMEOUT_MS < 1037000)` guard) | confirmed |
| `LIVE_CASE_TIMEOUT_MS = 2400 s` | `docker/lib/owed-cases.ts`: `const LIVE_CASE_TIMEOUT_MS: number = 2400000` | confirmed |
| step default 900 s / floor 3600 s | `docker/entrypoint.sh` (`STEP_TIMEOUT="${MPD_E2E_STEP_TIMEOUT:-900}"`, `OWED_CASES_TIMEOUT=3600`) | confirmed |

Content checklist (`content-checklist.log`): all ten required elements `PRESENT`, `stale_hits=0`
(no `2647`, no `44:07`, no "is unchanged").

Integrity: `docker/lib/owed-cases.ts` = `b614ace22c26899b6bb07670838e38e317c24a447eaf8f73d73d612944ccdfdc`
— exactly the hash the `skills3` REPORT pinned, so this seat did not touch it. Sibling docker files
carry 14:44 mtimes, before this seat started (~14:47 local); `entrypoint.sh` is the only file this seat
wrote. No git command beyond read-only `status`/`diff` was run.

## 6. Honest bounds

* **The gate pair does not protect this comment's CONTENT.** Control 2 shows that inverting the
  comment's own ceiling number (`2400` → `1800`) leaves `--self-test` green. The brief's premise — "it
  pins text, so a mismatch would redden" — holds for the entrypoint's STRUCTURAL/executable text
  (control 1), **not** for the 16c prose. What actually keeps this comment honest is the pairing with
  `docker/lib/owed-cases.ts` + `docker/README{,.zh-CN}.md` and review, not a gate. A verifier should
  check the comment against those files by reading, not by trusting a green gate.
* **No Docker lane was run** (deliberate): the change is comment-only, `docker/lib/owed-cases.ts` and
  every executable line are byte-identical, and the gates above are the ones the task names. Whether a
  real container run emits the new text is not proved here — it cannot be affected by comment bytes.
* The warm-cache numbers are the CASE's own evidence (`skills3`), read and re-derived from the raw
  logs; this seat did not re-run `mcp-call` (it is out of scope and would consume a credential + a
  registry route).
* `2647 s` still appears in `docker/lib/owed-cases.ts`, `skills/dsh-qa/scripts/mcp-call.ts` and
  `docker/README*.md` — there it is framed as HISTORY (why the old 1800 s ceiling and the old 600 s
  install budget were too small), so it is not stale; the only place where it stood as the LIVE
  rationale was this 16c comment. Out of scope here, reported as a finding for the reviewer.

## 7. Evidence path

`evidence/tui/dsh-tui-015/coderabbit/docker4/` — `REPORT.md` (this file), `entrypoint-before.sh`
(`8457a5f9…`), `entrypoint-after.sh` / `entrypoint-frozen.sh` (`4a4bd18d…`), `comment-only.diff`,
`content-checklist.log`, `gate-results.log`, `bash-n-entrypoint.log`, `docker-e2e-selftest.log`,
`negative-control.log` + `selftest-negative-control.log`, `comment-control.log` +
`selftest-comment-mutant.log`, `entrypoint-comment-mutant.sh`, `hashes-before.log`,
`hashes-after.log`.
