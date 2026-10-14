# mpd-mcp-gitbash

**English** | [中文](./README.zh-CN.md)

One launcher, **two** declared npm dependencies, started by the bundle's two rows `mcp-git` and
`mcp-shell` (`@deepseek-ai/dsh-mcp-client`, serverNames `git` and `shell`, stdio, both
`disabled: true`).

## What it does

- `dist/launch.js` is our own file (built by this package's `build` script). It takes this process's
  terminal writers away from the terminal (`<root>/.mpd/logs/mpd-mcp-gitbash.log`), resolves the
  selected dependency from the installed profile's `node_modules`, and imports its `bin` entry
  in-process.
- `argv[2]` selects the server: `git` (the default) starts `@cyanheads/git-mcp-server` (Apache-2.0,
  28 `git_*` tools, needs `git` on `PATH`); `shell` starts `mcp-server-commands` (`run_process`).
- Nothing is vendored any more: the SUL-1.0 `git-bash-mcp` build, the retired `scripts/build-mcp.ts`
  and the `vendor/mcp-src/**` snapshot it read are gone (de-omo wave B2).

## Licensing evidence

`mcp-server-commands` 0.8.2 ships a `LICENSE` file whose text is the MIT permission grant, but its
`package.json` carries **no `license` field at all** — the evidence this bundle rests on is the
licence FILE (sha256 `bee06c55…`), not a declared SPDX identifier. `@cyanheads/git-mcp-server` 2.15.3
declares `Apache-2.0` and ships its `LICENSE` (sha256 `7915fc5b…`).

Both packages ship a `prepare` script in their published manifests. Neither is an install script for a
registry dependency: pnpm installs them with no build-script approval and no ignored-builds error
(measured — see the wave's evidence), and both ship their entry ALREADY BUILT (`dist/index.js`,
`build/index.js`).

## Bundle rows

```yaml
- id: mcp-git
  name: '@deepseek-ai/dsh-mcp-client'
  disabled: true
  config:
    serverName: git
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-gitbash/dist/launch.js, git]
    toolCallTimeoutMs: 60000
- id: mcp-shell
  name: '@deepseek-ai/dsh-mcp-client'
  disabled: true
  config:
    serverName: shell
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-gitbash/dist/launch.js, shell]
    toolCallTimeoutMs: 60000
```

## Capability deltas (de-omo wave B2)

**ONE old row became TWO**, and the old server was not what its name suggested. The retired
`git-bash-mcp` exposed a raw shell runner — `run`, `which_bash`, `diagnose` — and the row shipped
`disabled: true` (upstream marked `run` as native-Windows-only). None of that is carried over
silently:

| Old tool | Status | Where it went |
|---|---|---|
| `run` | replaced | `mcp__shell__run_process` (`mcp-server-commands`) — the same raw-shell capability, and it is no longer Windows-only |
| `which_bash` | **DROPPED** | The bundled `bash` tool already answers it; the new row has no shell-discovery tool |
| `diagnose` | **DROPPED** | It reported the vendored server's own bash discovery; no counterpart, and its subject no longer exists |
| — | **NEW** | The whole `mcp__git__git_*` family (28 tools: `git_status`, `git_diff`, `git_log`, `git_commit`, `git_blame`, `git_worktree`, …) — a real git toolbox, which the old row never had |

Both rows keep the old row's `disabled: true` posture. Write-capable by nature (they run commands and
mutate a repository), which is why neither tool name is on the read-only deny list: a DISABLED row
registers no tools, and the harness validates the whole deny list at spawn time.

## Notes

- On Linux/macOS the built-in `bash` tool covers ordinary shell work; the `mcp-shell` row exists so
  the capability survives without a vendored server.
- If the dependency is absent from the profile, the row stays ALIVE with zero tools and records the
  reason in `<root>/.mpd/logs/mpd-mcp-gitbash.log` instead of killing the boot.
