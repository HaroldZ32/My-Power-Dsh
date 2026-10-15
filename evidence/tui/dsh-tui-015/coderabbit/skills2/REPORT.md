# skills2 — wave fix/coderabbit-pr42, items (1) and (2) (single skills writer)

Author: Deep Worker (single skills writer for this wave). Scope: `skills/dsh-qa/**` ONLY.
No git writes. No `packages/**` or `docker/**` bytes. VENDOR_LOCK.json deliberately NOT re-pinned.

Touched paths (sha256 at 2026-10-15T04:17:28Z):

| Path | sha256 |
|---|---|
| `skills/dsh-qa/scripts/team-dispatch-guard.ts` | `400e2a5ec566bd21e9dfb4cdff463de2909d0e13e80d038a13715bfb89b6f407` |
| `skills/dsh-qa/scripts/mcp-call.ts` | `b242f6645062ee926c602fddb32116537eef999a3971e90f19ccda04e55676d3` |

Note: `skills/dsh-qa/scripts/mcp-call.ts` already carried another writer's pre-existing changes
(`--install-links`, the staging version gate) when this task began; the edit below is ADDITIVE.

---

## Item (1) — team-dispatch-guard archive fixture keyed by planId

**Cause (reproduced).** `isLiveTeam` / `readArchivedPlanIndex`
(`packages/mpd-team-core-plugin/src/team-lifecycle.ts`) now key the archive index by the record's own
`planId`. The arm's fixture constructed the LEGACY `lead\0name` key
(`"lead-1\u0000wave"`) against a record carrying no `planId`, so `isLiveTeam` took its migration
branch (`planId === ""` → live) and returned `true`, reddening arm (c)'s `unapproved === false`.

**Baseline (before edit), pinned command + observed output:**

```
$ ./.toolchain/node_modules/.bin/bun skills/dsh-qa/scripts/team-dispatch-guard.ts --self-test
ok   (a) ...
ok   (b) ...
FAIL (c) terminal/archived team SKIPPED, live team resolves, none when only a ghost — resolved=team-live onlyGhost=(none)
ok   (d) ...
...
SELF-TEST: FAIL
EXIT=1
```

**Change (symbols).** `arms()` in `skills/dsh-qa/scripts/team-dispatch-guard.ts`:
removed `unapproved` (legacy-keyed) and added `archiveGhost`, `archiveLive`, `archiveIndex`,
`archiveReaped`, `archiveLiveKept`, `legacyKeyIgnored`; the `(c)` arm now asserts three directions:
the record whose OWN plan was archived WITHOUT approval is NOT live; the record whose OWN plan was
archived WITH approval STAYS live; a legacy `lead\0name` index is IGNORED for a record carrying a
plan id. The file-header `(c)` description now says "keyed by the record's `planId`".

**After edit — arm (c) observed:**

```
ok   (c) terminal/archived team SKIPPED, live team resolves, none when only a ghost, and the archive arm keys by the record's OWN plan id — resolved=team-live onlyGhost=(none) archiveReaped=false archiveLiveKept=true legacyKeyIgnored=true
SELF-TEST: PASS (17 arms: 4 C7-1..C7-3 seam assertions + 13 C7-4 arms incl. their negative controls)
GUARD_SELFTEST_EXIT=0
```

Raw logs: `self-test-team-dispatch-guard.log`, `team-dispatch-guard-real2/output.log`.

**Arm (c)'s REAL-LANE behaviour (lane runs fully offline — in-process over the bundle's own source,
no dsh spawn, no network):**

```
$ ./.toolchain/node_modules/.bin/bun skills/dsh-qa/scripts/team-dispatch-guard.ts \
    --out evidence/tui/dsh-tui-015/coderabbit/skills2/team-dispatch-guard-real2/lane
ok   (c-real) REAL store: the bound phantom resolves NOTHING and is marked terminal with a reason — resolved=(none) reaped=["team-phantom"] phase=ended
ok   (registry-real) REAL store: the terminal team's OWN bound lead no longer resolves it — bound=team-phantom resolved=(none)
...
evidence -> evidence/tui/dsh-tui-015/coderabbit/skills2/team-dispatch-guard-real2/lane
EXIT=0
```

All 21 arms green (4 seam + 4 real-store + 13 C7-4). Raw log: `team-dispatch-guard-real2/output.log`,
machine result: `team-dispatch-guard-real2/lane/result.json`.

---

## Item (2) — mcp-call staged-install budget disposition

**Disposition chosen:** RAISE the budget, measured-justified.

**Change (symbols).** `skills/dsh-qa/scripts/mcp-call.ts`:
added the module constant `INSTALL_TIMEOUT_MS = 1800000`, used it as the `timeout` of the staged
`npm install … --install-links` call in `realRun()`, and added two offline self-test rot guards
(the install call must still pass `timeout: INSTALL_TIMEOUT_MS`, and the constant must be ≥ 1037000 ms).

**Measurement recorded in the file's comment (verbatim from the constant's JSDoc):**
the non-linked closure install measured **1037 s** on this box against the previous **600000 ms**
budget; 1800000 ms is ~1.74x that measurement.

**Declared BOUND (verbatim from the comment):** "this is a ceiling for a cold cache over a slow
registry link, never a correctness claim — an install that genuinely hangs still fails, and a machine
that needs longer still reddens rather than passing."

**Self-test stays green:**

```
$ node skills/dsh-qa/scripts/mcp-call.ts --self-test
[mcp-call self-test] ok: tool-name detection + composed ast_grep server name + fixture content + the declared LSP dependency (0.7.0) verified on fixtures
MCP_SELFTEST_EXIT=0
```

Raw log: `self-test-mcp-call.log`.

**Real-lane run — RAN, observed duration, and it is RED for a cause that is NOT the budget.**

```
$ /usr/bin/time -v node skills/dsh-qa/scripts/mcp-call.ts   # started 2026-10-15T04:16:48Z
START 2026-10-15T04:16:48Z
[mcp-call] ok=false (enum recorded tools=0, mcp__ast_grep__=false, mcp__lsp__=false,
  ast_grep call MISSING: the harness recorded no tool/call for mcp__ast_grep__search,
  call result has the fixture line=false, lsp dependency staged from checkout-store)
  -> .../evidence/dsh-qa/mcp-call/2026-10-15T05-00-55.745Z
Elapsed (wall clock) time (h:mm:ss or m:ss): 44:07.09
EXIT=1
END 2026-10-15T05:00:55Z
```

`result.json` `durationMs` = **2647033 ms (44:07)**. **The budget was NOT the blocker any more:**
both arms' `npm install` completed inside `INSTALL_TIMEOUT_MS` (neither arm printed the case's
`FAIL: staged install`), so the lane advanced to the dsh boots. Each boot then died immediately on a
composition collision, and the case is RED on that — NOT on throughput:

```
$ cat evidence/dsh-qa/mcp-call/2026-10-15T05-00-55.745Z/enum.log
dsh: tool "send_message" is already registered (for a per-agent variant, register through that agent's `ctx`)
```

Both arms: `exit: 1`, `recordedToolCount: 0`. Copied to `mcp-call-real-evidence/`.

**This is a discovery OUTSIDE this task's scope — reported, not edited.** For contrast, the prior
`evidence/dsh-qa/mcp-call/2026-10-14T15-50-28.570Z/result.json` was `ok=true`, `durationMs=23646`
(23.6 s), 107 tools — i.e. the OLD, linked install was fast precisely because npm symlinked the pack
and never installed its own closure (the self-manufactured pass `--install-links` fixes). The
non-linked install is what changed the boot environment; a labeled LEAD (not a conclusion) is that the
profile bundle's own `dsh.bundle.patch` and the case's explicit `--patch <repoRoot>/cordis.patch.yml`
are now DIFFERENT paths (real copy vs symlink), so a loader-side dedupe by path may no longer collapse
them and a row may mount twice, double-registering `send_message`. Owned by whoever owns the
`--install-links` change / the boot composition, not by this task.

---

## Full QA sweep (observed)

| Gate | Command | Observed |
|---|---|---|
| QA self-tests | `bun run test:qa` | `[test:qa] all self-tests passed`, `EXIT=0`; 0 lines starting `FAIL `, 0 `self-test] FAIL`, 0 `SELF-TEST: FAIL`; 2 `[mpd-qa] SKIP` (tui-distribution, tui-spec-conformance — both `absent-fixture`, unrelated) |
| Typecheck | `bun run typecheck` | `$ tsgo --noEmit`, `TYPECHECK_EXIT=0` (no output) |
| Declaration comments | `bun run verify:comments` | `scanned 404 TypeScript file(s) … VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.`, `COMMENTS_EXIT=0` |
| Touched case self-test | `team-dispatch-guard.ts --self-test` | `SELF-TEST: PASS (17 arms …)`, `EXIT=0` |
| Touched case self-test | `mcp-call.ts --self-test` | `[mcp-call self-test] ok: …`, `EXIT=0` |
| guard real lane (offline) | `team-dispatch-guard.ts --out …/team-dispatch-guard-real2/lane` | all 21 arms ok, `EXIT=0` |

Raw logs: `test-qa.log`, `typecheck.log`, `verify-comments.log`.

## Honest bounds

- `VENDOR_LOCK.json` is intentionally left un-re-pinned (task instruction; the captain owns the wave's
  single re-pin). A `verify:vendor` run before that re-pin is expected to redden on the `skills/**`
  corpus `treeSha` — that is NOT a regression from this task.
- The `1037 s` figure is the wave context's measurement, cited in the comment as such; this seat did not
  independently re-measure an install at the OLD budget. The real-lane run here measured the lane at the
  NEW budget: **44:07 wall for two arms** (two cold, non-linked installs + two boots), and BOTH installs
  completed — which is the throughput evidence. The lane is nevertheless **RED** (`ok=false`, exit 1) on
  a separate composition collision (`tool "send_message" is already registered`); that is reported as a
  finding above and is NOT fixed here (out of scope).
- `mcp-call.ts` also carries another writer's pre-existing edits; the diffstat for that file is mixed.
  This task's contribution is limited to `INSTALL_TIMEOUT_MS` + its use + the two rot guards.
- The guard real lane is in-process and offline; it does not mount the real dsh, so it is seam/store
  evidence, not a boot-mount proof.
