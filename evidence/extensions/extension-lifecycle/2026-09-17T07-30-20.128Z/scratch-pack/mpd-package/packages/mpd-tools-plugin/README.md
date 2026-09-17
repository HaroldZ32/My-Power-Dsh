# mpd-tools-plugin

**English** | [中文](./README.zh-CN.md)

Agent-safety hooks for the row tools (B1): three defenses layered onto tool
execution, configured via the `mpd-tools` row.

## What it does

1. **Write-existing-file guard** (pre-execute guard, `writeGuard`): `write` to an
   existing file with different content is denied with a recovery hint (identical
   content passes; use `edit` otherwise).
2. **Tool-output truncation** (post-execute waterfall): oversized outputs are replaced
   by one text block capped at `truncateMaxBytes` — protects the token budget from
   giant tool dumps.
3. **Edit-error recovery guidance** (post-execute waterfall): when an edit fails, the
   waterfall appends a deterministic recovery hint (re-read the file, re-check exact
   old/new strings, retry).

## Config

| Key | Type | Default |
|---|---|---|
| `writeGuard` | boolean | `true` |
| `truncateMaxBytes` | number | `16384` |
| `recoveryHint` | string | built-in guidance |

## Usage

No model tools; effects are applied to every tool call in the session. The bundle row:

```yaml
- id: mpd-tools
  name: '@mpd-dsh/mpd/packages/mpd-tools-plugin/dist/index.js'
  config: { writeGuard: true, truncateMaxBytes: 8192 }
```
