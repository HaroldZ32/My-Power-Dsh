# Evidence hygiene — prune record for `evidence/install-deps/verification/**`

Captain's pre-flight finding: this lane's directory was the wave's largest and carried sandbox
working trees that must not enter the commit. This record documents what was deleted, what was
kept, and the checks that the remaining evidence is self-consistent and secret-free.

## Before → after

| | before | after |
|---|---|---|
| files | 3286 | ~120 |
| bytes | 50.2 MB (97 MB on disk; sandboxes are symlink-heavy) | 1.6 MB |
| sandbox-shaped dirs | 6 roots | **0** |

Recorded: `.prune-before.json` (the pre-prune walk), `prune-check.json` (the post-prune checks,
`ok: true`), and this file.

## Deleted (sandbox working trees only)

```
<run>/sandboxes/**                      # per-arm materialized DSH homes + node_modules mirrors
<run>/real-web/**                       # the first E2E sandbox tree (+ pnpm cache)
<run>/real-web-final/**                 # the settled E2E sandbox tree (+ pnpm cache)
<run>/r1-f3-recheck/sandboxes/**        # staged bundle copies (37 MB; the largest single tree)
<pass1>/sandboxes/**, <pass1>/real-install/{dsh,home,ws,cache}/**
```

Inside them: `.credentials.yaml` / `settings.yaml` copies, `.modules.yaml`, pnpm stores and a 1.8 MB
registry metadata blob, `node_modules` mirrors, session stores. None of that is evidence for any
claim in `REPORT.md`.

## Kept (durable artifacts only)

* root: `REPORT.md`, `verification-summary.json`, `pin.json`, `result-final.json`,
  `result-final-f5.json`, `result.json`, `recheck.json`, `red-green.json`, `prune-check.json`,
  `prune-before.json`, the run logs (`harness-final.log`, `red-green-final.log`, `e2e-final.log`,
  `r1-f3-recheck.log`, `client-module*.log`, `f5.log`, `recheck.log`, `harness.log`);
* `arms-final/**` (the settled-revision matrix + E2E + RED/GREEN pair), `arms/**` and
  `arms-recheck/**` (audit of the superseded revision), `gates/**` (six gate logs);
* `logs/**` (per-arm boot logs, composed-config dumps, the TUI pane + 213 KB raw log) — including
  `E2E-real-web-profile.boot.log` and `client-module-probe.boot.log`, extracted from the E2E sandbox
  before it was deleted;
* `r1-f3-recheck/{ADDENDUM.md, summary.json, arms/**, logs/**}`;
* `fixtures/**` (three tiny synthetic bundle layers) and the verifier harnesses `t5-*.mjs`.

## Checks (all green — `prune-check.json`)

1. **No surviving citation into a pruned root:** `citationsIntoPrunedRootsRemaining: []`. Any dead
   absolute path that remained in a kept JSON field or log was either re-pointed at its durable copy
   (`logs/<arm>.boot.log`) or rewritten to the marker `<pruned:sandbox>` / `<sandbox>`.
2. **Every cited durable path exists:** `missingCitedDurablePaths: []`.
3. **One loss, disclosed rather than repaired:** the `F5-web-layer-after` arm ran before the harness
   persisted logs, so its boot log is gone. Its arm JSON keeps the measured facts (`logTail`,
   `guardLines`, `signatures`) and its citation is `null` with the original preserved in
   `bootLogMissing`.
4. **No credential material remains** (verified by `find` over the lane dir after the prune): no
   `.credentials.yaml`, no `settings.yaml` copy, no `.modules.yaml`, no session store, no `*.zstd`.
5. **No token remains:** every ephemeral web-session token in a kept log/JSON is `token=<redacted>`;
   a final grep for `token=<value>` over the kept files returns nothing. (`token=` inside the
   harness `*.mjs` sources is a regex/URL template — code, not a captured value.)

## Scope note

The prune touched only paths under this lane's own `evidence/install-deps/verification/**`. The
arm records' measurements, verdicts and hash anchors are unchanged — the same-run `logs/` copies are
the durable anchors those records now cite.
