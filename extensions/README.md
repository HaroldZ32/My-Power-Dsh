# Extensions — the bundle-shipped discovery root

[中文](./README.zh-CN.md)

`extensions/` is the **bundle-shipped discovery root** of the MPD extension
interface (loader row `mpd-ext`, cordis service `mpdExtensions`). Every immediate
subdirectory that carries an `mpd-ext.json` manifest is discovered at **apply
time** and loaded through the same validation path as a code-plane
`register(descriptor, { root })` call. Nothing here needs an install step, a
profile patch row or a rebuild: dropping a directory in is the whole recipe.

This directory ships **one** extension: [`mpd-ext-example/`](./mpd-ext-example),
disabled on purpose.

## The three discovery roots

| Root | Lifecycle | May contribute |
|---|---|---|
| `<session workspace>/.mpd/extensions/*/mpd-ext.json` | **per call** — resolved from the calling session's workspace | `skills` + `flows` only |
| `~/.mpd/extensions/*/mpd-ext.json` | host-wide, discovered at apply | `skills`, `flows`, `mcp`, `roles` |
| `<bundle>/extensions/*/mpd-ext.json` (this directory) | host-wide, discovered at apply | `skills`, `flows`, `mcp`, `roles` |

The split is not cosmetic. Tool and skill-provider registration is
**process-global** and there is no session-scoped seam for it, so a project-level
extension may only contribute the kinds that are re-read per call. A project
manifest that declares `mcp` or `roles` is **rejected per item with a stated
reason** — it never half-loads.

For equal ids the precedence is **project → user → bundle** (first wins); the
shadowed entry is recorded and reported by `mpd_ext_list`, never fatal and never
silent.

## The shipped example

`mpd-ext-example` declares all four contribution kinds and ships a working,
dependency-free stdio MCP server ([`server.mjs`](./mpd-ext-example/server.mjs)).
It is shipped with `"enabled": false`, so a fresh install starts nothing.

To watch the whole path end to end, copy it somewhere writable, flip
`"enabled"` to `true`, and restart `dsh`:

```bash
cp -r extensions/mpd-ext-example ~/.mpd/extensions/
# edit ~/.mpd/extensions/mpd-ext-example/mpd-ext.json  ->  "enabled": true
```

Then confirm from a session:

- `mpd_ext_list` — the extension, its plane (`user`) and its load state;
- `mpd_ext_show` — its resolved roots, its skill/flow/role names and the exact
  state of each MCP server (`connected`, `unavailable`, `failed`, `disabled`);
- `mpd_flow_list` / `mpd_flow_show` — the contributed flow;
- the MCP tool `mcp__lint-mcp__describe_extension` — a live call into the example
  server.

## Validating and scaffolding

The developer CLI shares **one** validator with the runtime, so a manifest that
`validate` accepts is a manifest the loader accepts:

```bash
bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example   # exits 0, per-item errors otherwise
bun scripts/mpd-ext.mjs scaffold my-extension --dir /tmp/ext  # manifest + skill + flow + role
bun scripts/mpd-ext.mjs list                                  # what this host would discover
bun scripts/mpd-ext.mjs --self-test                           # the CLI's own checks
```

`validate` exits `1` and prints one line per item when anything is wrong, so it is
safe to use in CI.

## What you should know before shipping an extension here

- **Unknown keys are rejected, not ignored.** A typo'd descriptor key is a loud
  per-item error, because a silently accepted key that does nothing is the failure
  mode this interface was built to avoid.
- **A stdio MCP server is a child process.** It inherits only a small, safe
  environment (the SDK's inherit list) and never a credential-shaped variable from
  the host; declare what it needs in the manifest's `env`. It is reaped when the
  plugin is disposed.
- **A third-party schema is never rewritten silently.** The server's `inputSchema`
  is projected onto the schema subset the harness accepts, and a root that is not an
  object is normalized onto one (every tool call carries an arguments object, so the
  payload moves under a single `value` property and the downgrade is recorded); an
  `outputSchema` outside that subset costs that tool its **schema**, never the tool —
  it is registered without `structuredContent`, and the reason is recorded.
- **Honest scope of that sanitizing.** This harness release asserts `outputSchema`
  at registration and passes `inputSchema` through raw (the harness's own MCP bridge
  does exactly the same), so projecting `inputSchema` is **defense-in-depth against a
  future harness**, not a fix for a live abort. The load-bearing half today is the
  keep-or-drop rule for `outputSchema`, and it follows the harness's own posture
  (`supportedOutputSchema`): a schema the harness rejects drops the **schema** and
  keeps the tool, because that rejection would otherwise throw out of tool
  registration and take the whole plugin tree down. Only a tool whose **arguments**
  cannot be described at all is skipped.
- Vendoring an extension means copying its whole directory: the manifest's asset
  references are resolved relative to the extension root, and absolute paths or
  `..` escapes are rejected.

The full authoring contract is in
[`packages/mpd-ext-plugin/README.md`](../packages/mpd-ext-plugin/README.md) and the
developer guide in [`docs/extensions.md`](../docs/extensions.md).
