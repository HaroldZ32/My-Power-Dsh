# Tree-conformance wave (Windows + gate hygiene)

Host: win32-x64, node v24.21.0, bun 1.4.2. Branch work is uncommitted at the time of writing;
`raw/` holds every log referenced below.

This bundle covers the SECOND half of the Windows wave: making the tree itself conform (dist
freshness, the vendor corpus pin, the bundle patch, and the live QA lanes) after the first half
fixed the shipped runtime (see `evidence/windows/portability/20260922T090554Z/`).

## 1. The committed dists were built by an OLDER bun (18 of 20 targets stale)

- Measured: `node scripts/verify-dist-fresh.mjs` reported ``FAIL - 18 of 20 targets not fresh``.
  The diffs were the INJECTED HELPER PREAMBLE and minifier variable names, not logic
  (`mpd-config-plugin/dist/index.js`: committed 122963 B vs rebuilt 117361 B), and a fresh build is
  byte-stable (built twice, identical sha) - so the corpus had been produced by a different bun
  minor and nothing recorded which one.
- Fixed by rebuilding every stale target with the gate's OWN canonical command (parsed out of the
  gate's output, run from the repository root) and by recording the toolchain in
  `package.json` as `"buildToolchain": "bun@1.4.2"`.
- `scripts/verify-dist-fresh.mjs` now reports the RUNNING bun and the recorded `buildToolchain`
  side by side in its header, and carries three new self-test arms (an exact record, a drifted
  record, an absent record - each asserted to be distinguishable). Self-test: 15/15.
- Why the field is `buildToolchain` and NOT `packageManager`: the first attempt used
  `packageManager`, and `pnpm` then REFUSED to run anywhere inside the project
  (`ERR_PNPM_OTHER_PM_EXPECTED: This project is configured to use bun`) - caught by this wave's own
  `bundle-lifecycle` self-test ("pnpm is required for the official install flow"), whose install
  step is a pnpm install. `buildToolchain` is a record no package manager enforces.
- Re-measured: `ok: 20/20 targets fresh`; the two `bun test` F1 arms
  (`mpd-ext-plugin`/`mpd-roles-plugin` adapter-identity) are green.

## 2. The bundle patch converted `file://` URLs to paths the POSIX way

- Measured (bundle-lifecycle boot, 2026-09-22): every MCP row of the bundle died with
  ``Cannot find module 'C:\C:\MyDoc\...\packages/mpd-mcp-astgrep/launch.mjs'``.
- Cause: `baseUrl.replace(/^file:\/\//, "")` on `file:///C:/...` leaves `/C:/...`, which Windows
  reads as a path on the CURRENT drive. The second layer was percent-encoding: the sandbox lives
  under a Windows short name, so the URL carries `ZHAO%7E1.YIN` and the un-decoded path named a
  directory that does not exist.
- Fix (6 sites in `packages/mpd-bundle/cordis.patch.yml`, with a header note):
  `decodeURIComponent(baseUrl.replace(/^file:\/\/\/(?=[A-Za-z]:)/, "").replace(/^file:\/\//, ""))`
  - the drive-letter lookahead drops the third slash for a drive path ONLY, so the POSIX
  `/home/...` form stays byte-identical.
- The two lanes that rewrite this text for a dev boot (`dual-track-smoke.mjs`,
  `preset-register.mjs`) carry the same constant; their assertions ("the rewrite must consume the
  whole expression") are unchanged and were the gates that caught the drift.
- Re-measured: `preset-conformance` boots with `bootLog: {ok: true, signatures: []}` and
  `sessionCreate: {ok: true, agentPreset: "mpd"}`.

## 3. Every live lane spawned the launcher by its BARE name

- `spawn("dsh", ...)` answers `ENOENT` under node on win32 (npm installs `dsh.cmd`; node refuses a
  command script without a shell) while the SAME call under bun resolved the shim - so a lane's
  verdict depended on which runtime started it. Measured: `preset-conformance` died with
  `Error: spawn dsh ENOENT` (an unhandled 'error' event) before its first step.
- Fix: `skills/dsh-qa/scripts/lib/dsh-launcher.mjs` - one PATH scan with platform spellings
  (`resolveOnPath`), an interpreter for `.cmd`/`.bat` (`commandFor`), a spec for any bare name
  (`spawnSpec`, absent names keep the plain spawn so ENOENT-based fixtures still observe it), the
  `dsh` pair with a null contract (`dshCommand`) and a LONG-LIVED app spec (`dshAppSpec`) that runs
  the harness's own `lib/bin.js` with this node, so the app is a direct child.
- Wired into 24 call sites across the QA lanes (bundle-lifecycle, preset-conformance,
  dual-track-smoke, preset-register, session-start-team, relocate-smoke, tool-output-validation,
  ultrawork-smoke, skill-catalog-probe, memory-smoke, plan-c-smoke, mcp-call, codegraph-smoke,
  explicit-team-trigger, web-client-adapt, team-watchdog-boot, team-route-rewire, workmate-library,
  workmate-team-member, software-smoke, readonly-deny, extension-isolation, lib/tui-lane,
  lib/settings-bridge-lane) and into `bundle-lifecycle`'s `pnpm` probe, which had the same
  shell-less problem (`pnpm.cmd`).
- Re-measured: `node scripts/run-qa-selftests.mjs` -> ``all self-tests passed`` (50/50; it was
  1 of 50 before this wave and 6 of 50 mid-wave while the lanes were being wired).

## 4. `preset-conformance.mjs`: three defects the lane itself revealed

- **A crashed run left its web app holding the port.** The next run then died inside the harness's
  loader (`EADDRINUSE` -> `failed to apply loader entry webserver`), spent its whole budget and
  reported an unauthorized `session/create` plus a vacuous negative control. The lane now PREFLIGHTS
  the port (`assertPortFree`) and kills every child it booted, whatever happens (a `finally` in the
  CLI plus a `/T` best effort for the interpreter fallback).
- **A non-JSON answer killed the lane.** `await response.json()` on the server's plain-text
  `unauthorized` threw an unhandled SyntaxError, so a run that had just booted the whole bundle
  reported NOTHING. The body is now read as text and surfaced in the step (`raw`).
- **The app was spawned through the interpreter**, so `stop()` could not dispose of it (a `.cmd`
  spawn makes the app a child of cmd.exe). `boot()` now uses `dshAppSpec` - the harness's own
  `lib/bin.js` run by this node - and the same change carries to `bundle-lifecycle`.
- Result of the three: the lane reports five of its six steps green on this host
  (`conformance`, `auth`, `sessionCreate`, `sessionHeader`, `bootLog`) and one red.

## 5. The two remaining flakes: root causes and what each fix rests on

- **`mpd-agent-teams-plugin/self-fix-tests/terminal-dispatch.test.mjs` (T-07 arm): 4 of 6 runs red
  on this host** (measured in-session; re-runnable: `raw/repro-terminal-dispatch.mjs`, after-state log `raw/t07-repro-after.log`). The arm read the task's status at
  PROMPT time and called a terminal reading a breach - but the completion can always land between
  the delivery-boundary decision and the prompt, and the test's own write (which bypasses the team
  lock, unlike a real member's update) lands exactly there. The arm now CLASSIFIES the delivery: a
  wake that names the record's own generation is the boundary's decision standing (whatever the
  record says later), and only a ticket naming a generation the record no longer owns is the T-07
  breach. 0/8 red after the change.
  FALSIFIABILITY: mutating the guard (`if (stale !== undefined)` -> `if (false && ...)`) is caught -
  not by this arm, which now measures the invariant the product can hold, but by the DELTA-REGION
  integrity arms (18 failures: the `heal` family compares every `mpd-delta` region byte-for-byte
  against its canonical block). The mutation was reverted byte-exactly
  (`git status --porcelain -- .../scheduler.js` is empty).
- **`mpd-ext-plugin/test/mcp.test.ts` "tools/call maps content...":** measured with a bisect in
  `raw/bisect-mcp.mjs`: the THIRD back-to-back call on one bridge is never delivered - with ANY file
  layout (an arm-only file fails too) and with any earlier test present - while the same arm passes
  once anything yields (an instrumented copy with a per-step `console.log` passed 6/6). One
  macrotask boundary before the isError call makes the file deterministic (3 consecutive 22/22
  runs). The arm's budget is a runaway bound (60s) and the per-call timeout keeps its own
  deterministic arm, where the fixture's 400ms sleep makes the client timer authoritative.

## 6. Vendor corpus re-pin (the captain step)

- Measured: `node scripts/repin-vendor.mjs --check` -> RED, `skills` treeSha 220ddd2cf5c1 ->
  3a21517bf542, fileCount 327 -> 328 (the wave's own `lib/dsh-launcher.mjs`).
- Applied: `node scripts/repin-vendor.mjs --write --i-know-this-is-the-captains-step`; after the
  last lane edit the corpus moved again and the re-pin was repeated (final treeSha
  7c19709e8ef368d04cedb7c27dcd4a5db060ed09a02b51e0c24f45e3e6368ff4, 328 files).
- Re-measured: `repin-vendor --check` -> `in sync: no change` for BOTH treeSha assets, and the QA
  case that guards it (`agent-teams-messaging.mjs`) is green.

## 7. Gate table (this host, after the wave)

| gate | result |
|---|---|
| `bun test packages` | 1155 pass / 4 skip / **0 fail** (was 3 fail) - `raw/bun-test-packages-final2.log` |
| `node scripts/run-qa-selftests.mjs` | **all self-tests passed** (50/50) - `raw/qa-selftests-final.log` |
| `node scripts/verify-dist-fresh.mjs` | **20/20 fresh** + self-test 15/15 - `raw/..` + the gate's own arms |
| `bun run verify:docs` | PASS (pairs 38, dead links 0) |
| `bun run verify:gates` | 4 of 5 members PASS; the `vendor` member is ENVIRONMENT-BLOCKED (below) - `raw/verify-gates.log` |
| `node scripts/mpd-doctor.mjs --self-test` | 7/7 (first half's evidence bundle) |
| `node scripts/install-git-hooks.mjs --self-test` | 6/6 (first half) |
| `preset-conformance` (real) | 5 of 6 steps green; the negative control is red on this host (below) - `raw/preset-conformance-real-6.log` |
| `bundle-lifecycle` (real) | RED on this host: the probe boot enables every MCP row and the host's account lookup fails (below) - `raw/bundle-lifecycle-3.log` |

## 8. Declared, not fixed (each with its measurement)

- **`verify-vendor` cannot complete here**: it needs the pinned upstream checkout
  (`MPD_UPSTREAM_ROOT`, oh-my-openagent 8c57e463) and this machine has none
  (`FAIL - upstream checkout not found at C:\`). The ASSET half it verifies is green (`repin-vendor
  --check`), so the wave's own lock change is proven by that helper plus the QA case.
- **`bundle-lifecycle`**: the boot step's probe patch enables every MCP row; on this host libuv's
  account lookup fails (`uv_os_get_passwd returned ENOMEM`) and at least one row still dies on it.
  The codegraph row's share is now DEGRADED instead of fatal: `dist/serve.js` evaluates
  `userInfo().homedir` at MODULE LOAD, and the launcher (never the sha-pinned artifact - see
  `packages/mpd-mcp-codegraph/README.md`) answers the handshake itself with zero tools. The rest is
  a host/environment defect this wave cannot reach from the repository.
- **The negative control in `preset-conformance`** reports "the mutated preset mounted - the
  assertion is not falsifiable" on this host: the control mutates the persona row's `prefix:` to
  `text:` and expects `agent-preset/invalid`, and the INSTALLED `@deepseek-ai/dsh-persona@0.1.5-rc.2`
  does declare `prefix: z.string().required()` - so the expectation is right and the control's
  premise survives, but the refusal did not surface through `session/create` here. Recorded as an
  open item with the raw control log in `raw/preset-conformance-real-6.log`.

## 9. Files changed in this phase

- `package.json` (`buildToolchain`), `docs/development.md` + `docs/development.zh-CN.md` (the record
  and the rebuild rule, in pair), `docs/design.md` + `docs/design.zh-CN.md` (first half)
- `packages/*/dist/**` (18 rebuilt targets) + `VENDOR_LOCK.json` (skills re-pin)
- `packages/mpd-bundle/cordis.patch.yml`, `packages/mpd-mcp-codegraph/launch.mjs` +
  its README pair
- `scripts/verify-dist-fresh.mjs`
- `skills/dsh-qa/scripts/lib/dsh-launcher.mjs` (new) + `lib/tui-lane.mjs`,
  `lib/settings-bridge-lane.mjs` and the 21 lane scripts listed in section 3
- `skills/dsh-qa/scripts/agent-teams-messaging.mjs` (the `test:qa` arm now pins the
  cross-platform sweep instead of the retired `for f in ...` loop)
- `packages/mpd-agent-teams-plugin/self-fix-tests/terminal-dispatch.test.mjs`,
  `packages/mpd-ext-plugin/test/mcp.test.ts`