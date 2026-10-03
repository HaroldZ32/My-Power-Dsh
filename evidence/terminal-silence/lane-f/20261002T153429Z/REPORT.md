# Lane F — R5 terminal silence (MCP plane)

Requirement, verbatim: *"MPD 的各种 Terminal 的回报的东西（类似于 Codegraph MCP）会把 TUI 窗口搞得一团糟，
这些东西落到 log 里别直接 print 给用户."* — MPD's terminal output goes to a LOG FILE, never to the user's
terminal while a TUI session is live.

Measured 2026-10-02, UTC. All commands were run from the repository root.

## 1. The root cause, confirmed in the installed harness

**The harness gives an MCP child the dsh process's own fd 2.** Two quotes, one from each layer:

`@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js`, `createTransport` — no `stderr`
option is ever passed:

```js
case "stdio": return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd
});
```

`@deepseek-ai/dsh/node_modules/@modelcontextprotocol/client/dist/stdio.mjs`,
`StdioClientTransport.start()` — the SDK default is `"inherit"`:

```js
this._process = spawn(this._serverParams.command, this._serverParams.args ?? [], {
        env: { ...getDefaultEnvironment(), ...this._serverParams.env },
        stdio: [ "pipe", "pipe", this._serverParams.stderr ?? "inherit" ],
        ...
```

and its own type declaration (`stdio.d.mts`) states the consequence:

> The default is `"inherit"`, meaning messages to stderr will be printed to the parent process's stderr.

So an MCP server that writes to stderr writes into the Ink alternate screen of a live TUI session. The
child cannot rely on the parent to route it — it has to take its own writers away, which is what
`installTerminalSilence()` does.

## 2. Changed files (one line of intent each)

| File | Intent |
|---|---|
| `packages/mpd-mcp-shared/log-sink.ts` (**new**) | THE shared sink: root resolution (`MPD_MCP_LOG_DIR` → `DSH_WORKSPACE_ROOT` → cwd → `tmpdir()`), lazy `<root>/.mpd/logs/<name>.log`, 1 MiB cap + single `.1` rotation, per-line cap, bounded ring instead of a terminal fallback; `installTerminalSilence()` replaces `process.stderr.write` + `console.{error,warn,log,info,debug}`, never `process.stdout`; `openLogSink()` is the non-capturing half for in-process plugins; `fd()` hands a child the same log. |
| `packages/mpd-mcp-astgrep/launch.ts` | `installTerminalSilence("mpd-mcp-astgrep")` as the first statement body, before the adopted `dist/cli.js` dynamic import. |
| `packages/mpd-mcp-codegraph/launch.ts` | Same for `mpd-mcp-codegraph`, plus the declared residual (below) and the exact reason the daemon-policy notice and the skip hint now land in the log instead of stderr. |
| `packages/mpd-mcp-gitbash/launch.ts` (**new**) | Wrapper launcher: the adopted `dist/cli.js` is a sha-pinned prebuilt, so the sink installs here. **Row repoint pending — see §6.** |
| `packages/mpd-mcp-lsp/launch.ts` (**new**) | Same; this adopted entry carries five `stderr.write` diagnostics of its own. **Row repoint pending — see §6.** |
| `packages/mpd-codegraph-plugin/src/index.ts` | The apply-time status line left `console.log` (it printed on EVERY boot, into the TUI) and now goes through the shared sink into `<workspace>/.mpd/logs/mpd-codegraph.log`; root resolved per call, anchor-verified. |
| `packages/mpd-codegraph-plugin/src/index.test.ts` | The four arms that read that status line now read it out of the log file instead of capturing `console.log`. |
| `packages/mpd-codegraph-plugin/dist/index.js` | Rebuilt with the PINNED `bun@1.4.0` (`.toolchain/node_modules/.bin/bun`), canonical repo-root form. |
| `packages/mpd-dsh-adapter-plugin/test/no-terminal-writes.test.ts` (**new**) | The R5 static gate (D6 idiom): fails on a NEW `console.*` / `process.stdout.write` / `process.stderr.write` in an MPD runtime path, with a loudly printed exempt set, a shrink-only per-file inventory, stale-entry detection and a 10-arm `--self-test`. |
| `packages/mpd-mcp-shared/log-sink.test.ts` (**new**) | Runtime half of R5: 8 arms locking the root chain (env precedence, blank/duplicate drop, first-writable wins, fall-through past an unusable root), the ring when NO root is writable, the 1 MiB cap + single `.1` rotation, the per-line cap, and capture/restore (stderr + the five console methods replaced, stdout untouched, restore idempotent). |
| `packages/mpd-mcp-codegraph/README.md` + `.zh-CN.md` | The R5 contract and the declared residual, in the human-facing doc pair. |
| `packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` | **CROSS-LANE EDIT (flagged):** +2 frozen entries for the codegraph plugin's new `mpd-mcp-shared/log-sink` imports. The independence gate otherwise reddens on any new cross-package import. |

## 3. The gate — green, red on a seeded violation, 10/10 self-test arms

`bun packages/mpd-dsh-adapter-plugin/test/no-terminal-writes.test.ts` → `gate/green.txt`:

```
band: 30 package root(s), 122 TypeScript file(s) read; 20 non-TypeScript file(s) NOT COVERED
DECLARED EXEMPT — 10 file(s), out of band by declaration, never silently:
  - packages/mpd-mcp-shared/log-sink.ts — THE sink … [requires "process.stderr.write"]
  - packages/mpd-mcp-astgrep/launch.ts | mpd-mcp-codegraph/launch.ts (7 hit(s)) | mpd-mcp-gitbash/launch.ts | mpd-mcp-lsp/launch.ts
    — silenced MCP launchers … [requires "installTerminalSilence(...)"]
  - packages/mpd-bundle-plugin/src/{web-client,settings-card,team-page,team-view}.ts — browser client factories
    bundled by scripts/build-mpd-client.ts into the WEB client
  - packages/mpd-qa-roles-probe/src/index.ts (20 hit(s)) — QA-ONLY probe row; stdout IS its contract
SWEEP INVENTORY — 11 file(s) with frozen debt (may only shrink; phase 2 removes them)
VERDICT: PASS — every terminal write in the band is exempt, inventoried, or absent.        exit 0
```

Seeded violation (a file created in the band, run, removed — `gate/red-seeded.txt`):

```
UNFROZEN TERMINAL WRITES — 2 new write(s) that must go through the log sink:
  packages/mpd-codegraph-plugin/src/zz-seeded-violation.ts:2 [console.log]
    console.log("seeded violation")
  packages/mpd-codegraph-plugin/src/zz-seeded-violation.ts:3 [process.stdout.write]
VERDICT: FAIL                                                                             exit 1
```

then green again (`exit 0`) with the seeded file removed. `--self-test` (`gate/selftest.txt`) —
`VERDICT: PASS (10/10 checks)`, exit 0 — seeds comments (must not match), an MCP package-root launcher
(second band), a test file (out of band), a non-`.ts` file (NOT COVERED, never failing), an exempt file
WITH and WITHOUT its `requires` anchor (the second loses its exemption and turns its own hits unfrozen),
and the inventory's two failure directions (over ceiling; stale entry).

## 4. A captured MCP launch — bytes land in the log, zero on stderr

`mcp-launch/raw/` holds every capture. Five arms, each with the host's stdout/stderr captured to its own
file and `MPD_MCP_LOG_DIR` pinned:

| arm | stdout | stderr | log file |
|---|---|---|---|
| lsp launcher, real `initialize` handshake | 3772 B (MCP frames) | **0 B** | `…/l1/.mpd/logs/mpd-mcp-lsp.log` (0 B) |
| lsp launcher `bogus` | 0 B | **0 B** | 64 B = `Usage: mpd-lsp-daemon [mcp \| daemon]` |
| gitbash launcher `bogus` | 0 B | **0 B** | 53 B = `Usage: mpd-git-bash [mcp]` |
| codegraph launcher, binary pinned to a nonexistent sentinel | 213 B | **0 B** | 536 B = daemon notice + `CodeGraph MCP skipped: codegraph binary not found.` |
| codegraph launcher, real binary | 4881 B | **0 B** | 414 B = daemon notice |

The adopted servers write those diagnostics to `process.stderr` **through a `node:process` named import**
(`import { argv, stderr } from "node:process"`), i.e. a property lookup on the stream OBJECT at call time
— which is why the instance-level replacement catches them. `process.stdout` was never touched, and the
redirected runs answer the MCP protocol normally.

## 5. Sandbox boot — captured stdout/stderr, and what is NOT ours

`run-sandbox-boot.ts` builds `./.qa-terminal-silence/` (the declared `/.qa-*` scratch shape),
a `DSH_HOME`, a sandbox `HOME` and a sandbox WORKSPACE cwd; rewrites both declared bundle patches with
the QA case's own `devFlavor()`; boots
`dsh --profile headless --patch … --patch … ok` (exit 0) with stdout and stderr captured to SEPARATE
FILES; and asserts `assertSessionsSandboxed` (1 session key, the sandbox workspace — the real repo's key
does not exist). Raw: `host.stdout` (… B), `host.stderr` (… B), `result.json`, `mcp-logs/`.

Verdict, honestly (measured `2026-10-02T15:36:01Z`; raw: `host.stdout` 2482 B, `host.stderr` 774 B,
`result.json`, `mcp-logs/`):

* **host stdout carries ZERO MCP-child bytes** — 15 lines are present, and ALL of them are in-process
  plugin rows (`[mpd-dsh-adapter]`, `[mpd-bootstrap]`, `[mpd-team-watchdog]`, `[mpd-team-core]`,
  `[mpd-config]`, `[mpd-ext]`, `[mpd-roles]`, `[mpd-roster]`). They are the frozen sweep inventory (§7),
  not MCP children: those rows mount INSIDE the dsh process, so no sink can take their writers away
  without silencing the host itself.
* **host stderr carries ONE MCP-child line — the residual of §6.** Everything else on stderr is harness
  output (`dsh: warning: 1 entry did not activate`, the `preset-mpd` pending line, the model's own
  answer), plus one `[mpd-better-sidebar] mount guard: DISABLED …` line that is the `cordis.patch.yml`
  `!!js` guard's `console.warn` (Lane B's file, its own planned R5 fix).
* **MCP children DID write their logs into the pinned root**: `mcp-logs/mpd-mcp-astgrep.log` (0 B) and
  `mcp-logs/mpd-mcp-codegraph.log` (828 B, the daemon-policy notice twice). `mpd-mcp-lsp.log` is ABSENT —
  because the `mcp-lsp` row still names `dist/cli.js`, not the new launcher (§6). That absence is itself
  evidence that the hookup is not yet in effect.

## 6. The one measured residual (NOT fixed), and why

`packages/mpd-mcp-codegraph/dist/serve.js` — a sha-pinned prebuilt behind the blocking vendor gate —
spawns the real codegraph CLI with a HARDCODED stdio in `runBridgedCodegraphProcess`:

```js
const child = spawn(invocation.command, invocation.args, {
  cwd: options.cwd, env: options.env,
  stdio: ["pipe", "pipe", "inherit"],   // <- the grandchild's stderr is our fd 2
  windowsHide: true
});
```

and the grandchild emits, from
`node_modules/.bun/@colbymchenry+codegraph-linux-x64@1.5.0/…/lib/dist/mcp/engine.js`:

```js
process.stderr.write(`[CodeGraph MCP] File watcher active — graph will auto-sync on changes\n`);
```

Direct reproduction (`mcp-launch/raw/cg-long.{out,err,log}`), a 12-second session:

```
stdout=6692  stderr=164
[CodeGraph MCP] File watcher active — graph will auto-sync on changes
[CodeGraph MCP] Auto-synced 1 file(s) in 743ms
[CodeGraph MCP] Auto-synced 1 file(s) in 3ms
```

**This is the line the user is complaining about**, and it recurs for the whole life of a session (the
`Auto-synced …` lines are periodic). It bypasses a JS-level replacement entirely: the bytes never go
through this process's `process.stderr`. Two remedies, neither taken here:

1. **Row/harness level (preferred):** pass `stderr: "pipe"` in `dsh-mcp-client`'s `createTransport`
   `StdioClientTransport` options — one line in the harness, and it fixes the whole class for EVERY MCP
   row, including third-party ones. Out of this bundle's reach.
2. **fd level (ours):** re-exec the codegraph launcher with `stdio: ["inherit", "inherit", <log fd>]` and
   forward signals/exit — the bridge's `inherit` then gives the grandchild the log file. Costs a second
   process in a long-lived MCP path and an orphan risk if the intermediate dies; deliberately NOT taken
   without the captain's decision (the brief says "keep the existing behaviour identical otherwise").

## 7. Phase-2 sweep list (NOT edited — these files belong to lanes A/D/E)

The gate's frozen inventory, measured 2026-10-02 (comment-stripped hits per file; the ceiling may only
shrink and each entry is deleted here when it reaches zero):

| File | hits | note |
|---|---|---|
| `packages/mpd-team-core-plugin/src/index.ts` | 7 | Lane E's file |
| `packages/mpd-roles-plugin/src/index.ts` | 6 | `log:` option callbacks + 3 boot lines |
| `packages/mpd-bootstrap-plugin/src/index.ts` | 5 | boot lines + one `fs/observed` warn |
| `packages/mpd-dsh-adapter-plugin/src/index.ts` | 5 | Lane D's file; includes the DEFAULT `warn` sink |
| `packages/mpd-team-watchdog-plugin/src/engine.ts` | 4 | Lane E's file |
| `packages/mpd-ext-plugin/src/index.ts` | 3 | |
| `packages/mpd-roster-provider-plugin/src/index.ts` | 3 | |
| `packages/mpd-team-watchdog-plugin/src/index.ts` | 2 | Lane E's file |
| `packages/mpd-bundle-plugin/src/index.ts` | 1 | |
| `packages/mpd-config-plugin/src/index.ts` | 1 | |
| `packages/mpd-roles-plugin/src/session-gate.ts` | 1 | `MPD_ROLES_GATE_TRACE` only |

Already swept by their owners while this lane ran: `packages/mpd-tui-plugin/src/log.ts` (Lane A — its
stderr fallback is gone) and `packages/mpd-tui-adapter-plugin/src/**` (never carried a write).
Additional NON-band sites the boot measured: the `cordis.patch.yml` `!!js` guard `console.warn`
(`[mpd-better-sidebar] mount guard`) — **Lane B already owns that fix in the plan**.

## 8. Gate runs (exact commands, observed output)

| Command | Result |
|---|---|
| `bun test ./packages/mpd-codegraph-plugin ./packages/mpd-mcp-shared ./packages/mpd-mcp-codegraph` | `42 pass / 0 fail` (`tests/bun-test-3-pkgs.txt`) — includes the 8 new `log-sink.test.ts` arms |
| `bun test ./packages/mpd-dsh-adapter-plugin` | `170 pass / 0 fail` (`tests/bun-test-adapter.txt`) — includes the new gate's two `bun test` arms |
| `bun run typecheck` (`tsgo --noEmit`) | exit 1, **5 errors, 0 in any file this lane touched**: `packages/mpd-tui-plugin/src/scenes.ts(1132,52) TS2304 TUI_SEAMS` (Lane C in flight) and 4 in `skills/programming/scripts/typescript/check-no-excuse-rules.ts` (`TS2307 typescript/unstable/{ast,async}` + `TS7006`) — `node_modules/typescript/unstable` does not exist on this host, so that arm is environmental and pre-existing. `tests/typecheck.txt` |
| `bunx tsgo --noEmit --ignoreConfig … --types bun-types <the 7 package-root files>` | exit 0, 0 bytes — `log-sink.ts`, the four launchers and their pre-existing siblings are clean OUTSIDE the tsconfig program (they are not in it, exactly like `bin-resolve.ts`). `tests/typecheck-out-of-program.txt` |
| `node scripts/verify-comment-coverage.ts` | **exit 0, VERDICT: PASS** — 373 files, 29,395 declarations, 0 violations (`tests/verify-comments.txt`). The `log-sink.ts` violations the captain relayed are fixed (7 object-literal methods documented). |
| `node scripts/verify-dist-fresh.ts` | exit 1, `18 of 24 targets not fresh` — **`packages/mpd-codegraph-plugin/dist/index.js` is FRESH** (`sha 1290eb6d548a…`) under the PINNED `bun@1.4.0`; the 18 are other lanes' dists, rebuilt mid-flight (the count moved 20 → 18 between two runs minutes apart). `tests/verify-dist-fresh.txt` |
| `bun run verify:docs` | **exit 0, PASS** — 44 pairs, 0 violations; the new codegraph README pair is listed `ok`. `tests/verify-docs.txt` |
| `bun test ./packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` | `2 pass / 0 fail` — the two frozen entries this lane added satisfy Lane D's independence gate |

## 9. What I could NOT verify

* **The `mcp-lsp` / `mcp-gitbash` rows do not use the new launchers yet** — `cordis.patch.yml` is Lane B's
  write scope. The launchers are proven working standalone (arm 1/3 above) and the sandbox boot confirms
  the row still starts `dist/cli.js` (no `mpd-mcp-lsp.log` exists). **One-line repoint needed** (§10 Q1).
* **The codegraph grandchild leak is unfixed** (§6). The sandbox boot's "zero MCP bytes on stderr" claim
  therefore does NOT hold yet: exactly one such line appears, and it is reproduced standalone.
* **The boot-level "zero MPD bytes" claim (plan F6) is not reachable in phase 1** — 14 in-process row
  lines still print. They are the shrink-only inventory of §7; the claim becomes true when phase 2 lands.
* **The dist-fresh red is a moving target** — 18 other-lane dists were stale at 15:47Z with `bun@1.4.0`;
  I did not re-run after the lanes stop writing, so I cannot certify a settled tree.
* **No full `bun test packages` run** — deliberately scoped to the touched packages; a repo-wide run
  would sample other lanes' in-flight edits.
* **`verify:gates`, `verify:rows`, the Docker lane and the mount gates were NOT run** — outside this
  lane's brief and owned by the wave's verification stage.
