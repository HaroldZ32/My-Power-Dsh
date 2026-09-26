# Windows portability wave (host: win32-x64, node v24.21.0, bun 1.4.2)

Date: 2026-09-22 (UTC stamp in the directory name). Branch: `dev` (uncommitted work of the
Windows wave; the captain owns the commit).

Every item below is a MEASURED finding with the fix and its re-measurement. The raw logs live in
`raw/`; the two reproducible probes are `raw/probe-astgrep-mcp.mjs` and the self-tests themselves.

## 1. SHIPPED RUNTIME: the ast_grep MCP had no binary on win32 (silent, total break)

- **Symptom** (measured before the fix): `mcp__ast_grep__search` answered
  `{"ok":false,"error":{"code":"BINARY_NOT_FOUND"}}` for every call, while `tools/list` answered
  normally (the adopted server reports the failure only when a tool is CALLED - which is why a
  tools/list probe cannot witness it).
- **Root cause**: `packages/mpd-mcp-shared/bin-resolve.mjs` looked for the POSIX name only
  (`<pkgDir>/ast-grep`, `.toolchain/node_modules/.bin/ast-grep`) and the bundle-root `.bin` was not
  a tier at all. On win32 the linker writes `node_modules/.bin/ast-grep.exe` (measured: 8192 B PE stub,
  `--version` -> `ast-grep 0.45.2`) and leaves the package's own `ast-grep` a `#!/usr/bin/env node`
  shim that a shell-less spawn cannot start. The resolver therefore answered `null`, the launcher left
  `MPD_AST_GREP_SG_PATH` unset, and the adopted chain failed every candidate.
- **Fix**: `candidateSpellings`/`executableSuffixes` expand each candidate name into the spellings the
  host can EXECUTE (win32: `.exe`/`.com`, never `.cmd`/`.bat`: the adopted runner spawns with
  `shell: false` and Node refuses a command script without a shell - measured EINVAL), a new tier
  `<bundle>/node_modules/.bin` resolves the bundle-root install, and codegraph uses PATH-style
  spellings because ITS consumer (`resolveServeProcessInvocation` in
  `packages/mpd-mcp-codegraph/dist/serve.js`) wraps a `.cmd` in cmd.exe.
- **Re-measured** (`raw/astgrep-mcp-tools-call.json`): `ok: true, isError: false, returnedMatches: 50`.
  Unit: `raw/bin-resolve-unit.log` -> 16/16, including 6 new win32 arms (PATHEXT order, `.exe`
  spelling, `.cmd` refusal, POSIX single spelling, bundle-root tier, `.toolchain` precedence).
- No dist rebuild is involved: `raw/bun-test-packages.log` lists both MCP dists under
  `[verify-dist-fresh] NOT COVERED` (built offline by `scripts/build-mcp.mjs`).

## 2. `scripts/mpd-doctor.mjs`: false alarms on win32 + 4 of 7 self-test arms red

Measured before: `node scripts/mpd-doctor.mjs` reported
`no node on PATH: the rows' command: node would not resolve` on a host whose PATH node is
`C:/Program Files/nodejs/node.exe`, reported a WORKING codegraph as `MISSING`
(`npm-shim.js --version cannot run the tool: EFTYPE`), and `--self-test` failed 4 of 7 arms.

- `pathLookup` now applies the platform PATH semantics (`%PATHEXT%`).
- `probe` runs a candidate the way its consumer does: `.cmd`/`.bat` through the interpreter
  (`commandInterpreter()`, absolute - a minimal env has no ComSpec and no System32 on PATH),
  `.js`/`.mjs`/`.cjs` through the runtime.
- ast-grep acceptance stays shell-less-honest: the PATH fallback REFUSES a `.cmd`/`.bat` BY NAME with
  the EINVAL reason instead of advertising a candidate that dies on the first tool call.
- The self-test fixture is now platform-native (`.cmd` stubs + a same-process `goto` hang stub) and
  the four POSIX-shaped arm expectations are declared per platform: git-bash is host-dependent, an
  ast-grep stub cannot be made a native executable, and the literal-name comment-checker stub is
  unprobeable on win32.
- Re-measured (`raw/mpd-doctor-selftest.log`): **7/7 PASS**; live run on this host: node ok via PATH,
  ast-grep ok via `MPD resolver source=bundle-bin`, codegraph ok, only the genuinely absent
  comment-checker degrades (exit 2 = DEGRADED, by design).

## 3. `scripts/install-mcp.mjs`: the toolchain check could never pass on win32

- The toolchain tier was probed by bare POSIX names (`sg`, `codegraph`) while win32 holds
  `sg.cmd`/`sg.exe`; npm was spawned bare (a `.cmd`); pipx was found with
  `sh -c "command -v pipx"`; the pipx venv python was `<venv>/bin/python`; the generated pins and
  wave rows named extensionless binaries.
- Fix: `binIn`/`onPath` (platform spellings), `runNpm` (interpreter when needed),
  `exeName` for generated env/overlay paths (`wave-mcp.exe`), `Scripts/python.exe` on win32, and
  `envLines` now pins the file that EXISTS on this platform - a wrong non-empty pin is worse than an
  unset one because it disables the MCP chain.
- Re-measured: `--self-test` ok, `raw/install-mcp-dry-run.log` shows
  `MPD_AST_GREP_SG_PATH=".../.bin/sg.exe"` and `MPD_DSH_WAVE_MCP_BIN=".../wave-mcp.exe"`.

## 4. QA lanes: shell probes replaced by PATH lookups

- `skills/dsh-qa/scripts/lib/tui-lane.mjs` resolved `dsh-tui`/`tmux` through
  `spawnSync("bash", ["-lc", "command -v ..."])`, which reports a tool ABSENT on a stock win32 host
  (no bash) and, where Git Bash answers, resolves a DIFFERENT PATH than the host.
  New exported `onPath()` (platform spellings) is used by `resolveHostRoot`, `tuiBinaryPresent`,
  `tmuxPresent`, and by `tui-distribution.mjs` for `pnpm`.
- `skills/dsh-qa/scripts/extension-isolation.mjs` guarded against installing into the real home with
  `process.env.HOME ?? ""`: on win32 that degenerates to `startsWith(".dsh")`, which no absolute temp
  path matches, so the guard silently PASSED. It now uses `HOME || USERPROFILE || homedir()`.
- Re-measured: the five TUI lanes and extension-isolation are green in `raw/qa-selftests.log`.

## 5. `scripts/install-git-hooks.mjs`: 4 of 6 self-test arms red on win32

- The arms executed the fixture hook file directly: a Git hook is a POSIX shell script BY CONTRACT,
  Git for Windows runs it with its own `sh.exe`, and a direct spawn answers ENOENT.
- Fix: `hookShell()` (Git for Windows locations, then PATH) runs the hook the way Git does, and a
  host without any sh fails with an actionable message instead of a bare ENOENT.
- Re-measured (`raw/install-git-hooks-selftest.log`): **6/6 PASS**.

## Declared reds that are NOT defects (unchanged by this wave)

- `skills/dsh-qa/scripts/agent-teams-messaging.mjs` (the only red of the 50-case sweep): the
  `VENDOR_LOCK.skills.treeSha` re-pin signal, which is the captain step
  (`node scripts/repin-vendor.mjs --i-know-this-is-the-captain's-step`) and belongs to the commit that
  invalidated it (AGENTS.md section 9/11).
- `packages/mpd-{ext,roles}-plugin/test/adapter-identity.test.ts` F1 arms: the committed dists differ
  from a fresh `bun build` under bun 1.4.2 (164163 B vs 164093 B - minifier variable naming). The
  corpus was built by a different bun minor and no `packageManager` pin exists: a user decision
  (pin bun, or rebuild the corpus and record the version), not a Windows defect.
- `packages/mpd-ext-plugin/test/mcp.test.ts` `tools/call maps content...`: a known timing flake
  (passes alone and under an instrumented copy), unrelated to this wave.
- `node scripts/verify-vendor.mjs` without `MPD_UPSTREAM_ROOT` answers
  `upstream checkout not found at C:/` - the documented default for a normal clone, not a defect.

## Gate sweep after the wave (this host)

| gate | result |
|---|---|
| node scripts/mpd-doctor.mjs --self-test | 7/7 PASS (raw/final-gates.log) |
| node scripts/install-git-hooks.mjs --self-test | 6/6 PASS (raw/final-gates.log) |
| node scripts/dump-config.mjs --self-test | 6/6 PASS (raw/final-gates.log) |
| node scripts/run-qa-selftests.mjs | 49/50 PASS, only the declared vendor re-pin signal red (raw/qa-selftests.log) |
| bun test packages | 1151 pass / 4 skip / 3 fail, all three pre-existing and unrelated (raw/bun-test-packages.log) |
| bun run verify:docs | PASS (pairs 38, failed 0, dead links 0) after the design-doc pair update |
| raw/probe-astgrep-mcp.mjs | ok: true, 50 matches (raw/astgrep-mcp-tools-call.json) |

## Files changed by this wave

- `packages/mpd-mcp-shared/bin-resolve.mjs` (+ its `bin-resolve.test.mjs`)
- `scripts/mpd-doctor.mjs`
- `scripts/install-mcp.mjs`
- `scripts/install-git-hooks.mjs`
- `skills/dsh-qa/scripts/lib/tui-lane.mjs`
- `skills/dsh-qa/scripts/tui-distribution.mjs`
- `skills/dsh-qa/scripts/extension-isolation.mjs`- docs/design.md + docs/design.zh-CN.md (the resolver tier list, kept in pair)
- evidence/windows/portability/20260922T090554Z/** (this bundle)
