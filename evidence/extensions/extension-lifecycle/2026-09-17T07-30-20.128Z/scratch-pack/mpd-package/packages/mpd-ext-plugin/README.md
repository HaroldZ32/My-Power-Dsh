# mpd-ext-plugin — the MPD extension interface

[中文](./README.zh-CN.md)

`mpd-ext-plugin` is the extension interface of the `@mpd-dsh/mpd` bundle: one frozen contract
through which a plugin package — or a plain directory — contributes **skills**, **flows**, **MCP
servers** and **roles** without touching the core bundle. Loader row id: `mpd-ext`. Cordis service:
`mpdExtensions`.

## What this adds, and what already works

A package can **already** contribute to this bundle with zero core changes: any package carrying its
own `dsh.bundle.patch` joins the loader as a second bundle layer (`dsh plugin add <pkg>`), and a
package that ships its own `dsh-mcp-client` row gets MCP naming, reconnection, pagination, schema
rollback and disposal for free. That is the **install-plane path** and it stays first-class — this
plugin does not replace it.

This plugin adds four things on top:

1. a **frozen contract** (`src/sdk.ts`) so every contributor declares capabilities the same way,
   with the same validation, namespacing and failure policy;
2. the **data plane**: a directory holding `mpd-ext.json` plus its assets — no packaging, no
   `dsh plugin add`, no profile change;
3. **flows**: a declarative procedure (JSON) rendered into an in-memory skill document, because the
   harness has no flow seam of its own;
4. the **runtime stdio MCP bridge** for servers that must not become a profile patch row: declared
   servers connect at apply — in parallel and time-boxed by `connectTimeoutMs`, never lazily
   (`connectExtensionMcpServers`, awaited in `apply`; `src/index.ts`, `src/mcp.ts`) — and a server's
   live state is reported by `mpd_ext_show`.

## The contract

Both authoring forms produce the same registry entry:

```jsonc
// code plane: ctx.get("mpdExtensions")?.register(descriptor, { root })
// data plane: <root>/mpd-ext.json — the directory IS the root
{
  "apiVersion": 1,                       // required, must equal 1
  "id": "authoring-flows",                   // required, ^[a-z0-9][a-z0-9-]{0,63}$
  "description": "Authoring flows for code changes",
  "enabled": true,                       // default true
  "contributes": {
    "skills": [{ "root": "skills", "rank": 300 }],
    "flows":  [{ "dir": "flows",  "rank": 300 }],
    "mcp":    [{ "serverName": "lint-mcp", "transport": "stdio", "command": "node",
                 "args": ["server.js"], "env": { "K": "V" }, "cwd": ".",
                 "toolCallTimeoutMs": 60000, "connectTimeoutMs": 10000 }],
    "roles":  [{ "name": "Code Reviewer", "description": "…", "readonly": true,
                 "persona": "personas/code-reviewer.md",
                 "provider": "deepseek-official", "model": "deepseek-v4-flash" }]
  }
}
```

Rules that are enforced, not documented-only:

- **Unknown keys anywhere are rejected per item and recorded** on that extension. This repository has
  measured the opposite failure mode (a schema that silently keeps unknown keys, so a renamed key is
  accepted and does nothing); this validator does not repeat it.
- `origin`, `plane` and load results are **registry metadata, never author input** — supplying
  `origin` or `plane` in a descriptor is rejected as an unknown key.
- Every asset reference is relative to the extension root; absolute paths and `..` escapes are
  rejected. No extension reaches outside its own root.
- `rank` is explicit (default **300**, the `custom` tier). Full ladder, lower wins inside a layer:
  `100` project-dsh < `200` project-agents < `250` runtime < `300` custom < `400` user-dsh <
  `500` user-agents < `600` bundled.
- A flow id must satisfy the **skill-name grammar** (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) — the descriptor
  id grammar is looser, so an id such as `a--b` is rejected loudly per file.
- **Roles defaults**: `description` defaults to `""`, `readonly` to `false`, and `provider`/`model`
  must be supplied **together** — a partial route is rejected per item. An MCP item defaults to
  `args: []`, `env: {}`, `cwd: "."`, `toolCallTimeoutMs: 60000`, `connectTimeoutMs: 10000`.

## Three roots, two lifecycles

| Root | Lifecycle | May contribute |
|---|---|---|
| `<session workspace>/.mpd/extensions/*/mpd-ext.json` | **per call** — from `dsh.workspaceRoot(exec)` for the tools, and from the harness's own `provider.list({ cwd })` for the skills plane | **skills + flows only** |
| `~/.mpd/extensions/*/mpd-ext.json` | host-wide, discovered at apply | skills, flows, mcp, roles |
| `<bundle>/extensions/*/mpd-ext.json` | host-wide, discovered at apply | skills, flows, mcp, roles |

The split is forced by the harness: tool and provider registration is process-global and has no
session scope, so a per-session contribution cannot be represented by it. A **project-level manifest
declaring `mcp` or `roles` is rejected loudly for that item** with the reason:

> project-level extensions may contribute skills and flows only: tool and provider registration is
> process-global and cannot be scoped to a session

Discovery precedence for equal ids is **project → user → bundle** (first wins). The shadowed entry is
reported by `mpd_ext_list` — never fatal, never silent.

## The tools

| Tool | Purpose |
|---|---|
| `mpd_ext_list` | every extension: id, origin, plane, root, effective enabled state, contribution counts, which claimed skill names the harness catalog really **serves**, per-item errors, pending kinds, shadowed duplicates and rejected manifests |
| `mpd_ext_show` | one extension in full: descriptor (**`env` values redacted**), resolved roots, skill/flow/role names with the serving check of each, MCP servers + state, error list |
| `mpd_flow_list` | every contributed flow: id, title, whenToUse, step count, owning extension, loadability |
| `mpd_flow_show` | one flow's full procedure (steps, tool hints, expected outputs) |

**There is no `mpd_ext_reload` in v1.** Disposing and re-registering providers, tools and child
processes is a state machine with its own failure class, and a plugin-module change is not
hot-reloaded anyway — **the honest reload is a restart**.

## Configuration (`.mpd/mpd.jsonc`)

```jsonc
{
  "extensions": {
    "enable": ["authoring-flows"],           // force-enable ids
    "disable": ["noisy-experiment"],     // force-disable ids (wins over enable)
    "mcp": { "enabled": true, "connectTimeoutMs": 10000, "toolCallTimeoutMs": 60000 }
  }
}
```

Config is read **lazily per use** from the `mpdConfig` service — never captured at apply time.

**Declared v1 limit: `extensions.*` is PROCESS-LEVEL.** `mpdConfig` resolves it from
`<process workspace>/.mpd/mpd.jsonc` plus `$DSH_HOME/mpd.jsonc`, so it is **not session-scoped** and a
project-level `enable`/`disable` is not a per-session switch. We deliberately do not paper over that
by calling `mpdConfig.reload(exec)` on every skill snapshot: mutating the shared config cache once per
snapshot would make the skill provider's view and the tools' view disagree, which is worse than a
plainly documented limit. `enable`/`disable` only ever filter what is **served** — they never gate a
registration, so a disabled extension never breaks anything else. A missing or failing `mpdConfig`
degrades to the defaults above, and there is deliberately no config-declared discovery root list.

## Extension developers

- Import the SDK from the installed bundle:
  `import { defineExtension } from "@mpd-dsh/mpd/packages/mpd-ext-plugin/dist/sdk.js"`.
  The same machine-readable contract (`MPD_EXT_CONTRACT`) backs the runtime validator, the tools and
  the developer CLI — there is never a second source of truth.
- A **skills** root holds immediate subdirectories containing `SKILL.md` with YAML frontmatter
  (`name` satisfying the skill-name grammar, a non-empty `description`, plus the optional
  `whenToUse`, `user-invocable` and `disable-model-invocation` keys).
- A **flows** directory holds `*.json` documents:
  `{ "id", "title", "description", "whenToUse?", "steps": [{ "title", "detail?", "tool?", "output?" }] }`.
  A flow is served as a skill candidate, so `mpd_flow_list` and the skill catalog see the same thing.

## Failure policy (binding)

An extension, one of its items, a flow file, an MCP server or a role can fail **without** affecting
anything else: the failure is recorded with a one-line reason and surfaced by `mpd_ext_list` /
`mpd_ext_show`. Nothing in this plugin throws out of `apply`, and no failure aborts another
extension's activation. Three seams need explicit guards and have them: the skills provider (a
malformed candidate would break every session's pre-step, so every candidate is pre-validated and a
violating one is **skipped and warned** per item — deliberately **stricter than the harness**, which
treats `invocation` as optional and then dereferences it unguarded in the pre-step: here `invocation`
with both booleans is REQUIRED and always emitted), skills-provider registration (a duplicate name
throws, so names are unique by construction and registration is wrapped), and the MCP tool-generation
swap (a partial generation is rolled back by the two-phase fetch/swap in `src/mcp.ts`) — all three
guards are live in v1.

Third-party schemas follow two different rules, and neither rewrites the author's schema (an MCP
tool's `inputSchema` is projected onto the harness subset and its **root normalized onto an object**,
because a tool call always carries an arguments object; an `outputSchema` outside the subset costs
the tool its **schema** and never the tool — it registers without `structuredContent` and the reason
is recorded, which is the harness's own `supportedOutputSchema` posture). Only a tool whose
**arguments** cannot be described at all is skipped.

## Status and documented limits (v1)

- **A skill name that collides with a lower-ranked provider is shadowed by it.** The harness warns
  and drops the losing candidate by rank. Correct precedence (project-dsh 100, project-agents 200
  and runtime 250 all outrank our default 300), not an error — and no longer invisible: a collision
  between two **extensions** is annotated on the loser (`skill surface:` in its load errors, naming
  the winner and both ranks), and both tools verify every claim against the harness's own catalog
  (`ctx.skills.list`) and report it as `served` / `notServed`. That read is the only way to see a
  shadow cast by a NON-extension provider (the corpus, a user skills root); when it fails, the
  report says `checked: false` with the reason instead of asserting anything.
- Both host-wide kinds are **live in v1**. A declared `mcp` server is connected at apply
  (`connectExtensionMcpServers`, `src/mcp.ts`), and `mpd_ext_show` reports its state
  (`connecting` / `connected` / `unavailable` / `failed` / `disabled`) plus a bounded child-stderr
  tail on failure — a `pending` line survives only while the server is not `connected`. A declared
  role is resolved **per call** by `mpd-roles-plugin` (`extensionRoles`), so `mpd_roles_list` lists
  it under the namespaced id `ext-<extension-id>-<slug>` and `mpd_role_spawn` can start it. A
  project-plane `mcp` or `roles` item is still rejected per item.
- stdio MCP only; JSON flow files only (YAML is a follow-up); no MCP resources/prompts; no GUI panel;
  no marketplace/registry/remote download/version solving; no extension-contributed agent presets;
  extension roles never become agent-teams teammates (that member list is static patch config).

## Tests

```sh
bun test packages/mpd-ext-plugin
bun run typecheck
bun build packages/mpd-ext-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ext-plugin/dist/index.js
```
