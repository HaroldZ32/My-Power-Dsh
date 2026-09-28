# MPD extension template — the copy-me skeleton

[中文](./README.zh-CN.md)

`templates/mpd-extension/` is the **upstream template directory** and the single source of truth for
a new MPD external extension (loader row `mpd-ext`). It is a complete, valid skeleton that declares
all four contribution kinds, and `scripts/mpd-ext.ts scaffold` **copies it** — the CLI emits no code
of its own, it rewrites names and nothing else. Wherever this file says "your copy", read it as the
extension directory you put into a discovery root.

## 1. Copy it

```bash
bun scripts/mpd-ext.ts scaffold <name> --dir <where>              # skill + flow + role
bun scripts/mpd-ext.ts scaffold <name> --dir <where> --with-mcp   # + the stdio MCP server
bun scripts/mpd-ext.ts validate <where>/<name>
```

The flag is the whole difference between the two arms, and it is deliberate:

| Arm | `contributes` in the copy | Files |
|---|---|---|
| default (no flag) | `skills`, `flows`, `roles` — **three kinds** | the `mcp` block and `server.ts` are **dropped** |
| `--with-mcp` | `skills`, `flows`, `roles`, `mcp` — **four kinds** | `server.ts` is kept |

Both arms are loadable, and the CLI's `--self-test` asserts exactly that: it
validates this template, scaffolds both arms into a temp directory, **re-validates
each copy**, compares every copied file against this template byte for byte (modulo
the name rewrite and the documented `mcp` drop), and then corrupts a copy to prove
`validate` fails loudly per item.

A refusal writes **nothing at all**: the copy is built in a staging directory and moved
into place only after the runtime validator accepts it, so a refused `scaffold` never
leaves a half-written extension behind. `scaffold` refuses, with the reason and an empty
target:

- an id that violates `^[a-z0-9][a-z0-9-]{0,63}$`;
- a derived skill or flow name outside the skill-name grammar;
- a target directory that already exists — scaffolding never overwrites;
- a derived role name that collapses onto a **base-roster** name: `scaffold plan` is
  refused because `plan reviewer` is already taken by the roster's `Plan Reviewer`.

## 2. What the copy rewrites

The placeholder is this template's **own manifest `id`** (see `mpd-ext.json`; it is
purpose-built and distinct from the shipped example `mpd-ext-example`). On copy, every
occurrence of that placeholder is replaced by the new extension name — in the contents
of every text file (`.json`, `.md`, `.ts`) **and in every file and directory name**.
Nothing else changes, so the derived names are:

| Where | Derived value |
|---|---|
| `mpd-ext.json` → `id` | `<name>` |
| `mpd-ext.json` → `mcp[0].serverName` | `<name>`, capped at the contract's own bound (32 today, read out of `serverNamePattern`); a longer id is capped **with a warning on stderr**, never silently |
| `skills/<…>/SKILL.md` + its directory | `<name>-skill` |
| `flows/<…>.json` → file name, `id`, `title` | `<name>-flow` |
| `personas/<…>.md` + `roles[0].persona` | `<name>-reviewer.md` |
| `roles[0].name` | `<name> reviewer` |
| `mpd-ext.json` → `description`, role description, skill/flow prose | the placeholder replaced by `<name>` |

This README pair carries no placeholder, so it is copied verbatim — which is exactly why
it is written location-neutral: the same words describe the upstream template and your
copy.

## 3. The four contribution kinds

| Kind | Lives at | What it is |
|---|---|---|
| `skills` | `skills/<name>-skill/SKILL.md` | a procedure the model can load; the frontmatter `name`/`description` pair is required, and the skill's identity is that frontmatter `name` — the directory name is free |
| `flows` | `flows/<name>-flow.json` | a **declarative** procedure rendered into a skill candidate; the flow `id` must satisfy the skill-name grammar |
| `roles` | `personas/<name>-reviewer.md` | a roster-shaped specialist resolved per call; `readonly: true` denies it write tools, which is why the template ships a read-only reviewer. `provider`/`model` are optional and must be supplied **together or not at all** — the template keeps the default route, so it declares neither |
| `mcp` | `server.ts` | a **dependency-free** stdio MCP server (node stdlib only); its tools are published as `mcp__<serverName>__<tool>` |

Delete what you do not need — and delete the matching `contributes` entry in
`mpd-ext.json`, because a declared kind whose asset is missing is a load error, while
an asset nobody declares is simply never read.

## 4. Which plane each kind is legal in

The template itself is never discovered (see §6); a *copy* goes into one of the three
discovery roots:

| Root | Lifecycle | May contribute |
|---|---|---|
| `<session workspace>/.mpd/extensions/<id>/` | per call, from the calling session's workspace | `skills` + `flows` only |
| `~/.mpd/extensions/<id>/` | host-wide, discovered at apply | `skills`, `flows`, `mcp`, `roles` |
| `<bundle>/extensions/<id>/` | host-wide, discovered at apply | `skills`, `flows`, `mcp`, `roles` |

Tool and skill-provider registration is process-global and has no session-scoped seam,
so a project-plane manifest that declares `mcp` or `roles` is rejected **per item**,
loudly. A four-kind extension therefore belongs in `~/.mpd/extensions/` (or the bundle).

## 5. Verify the copy

```bash
bun scripts/mpd-ext.ts validate <dir>   # exit 0 = this host would load it; exit 1 = one line per item
bun scripts/mpd-ext.ts list             # what this host would discover, plane by plane
```

Validation is not a formality: the manifest sets `"enabled": false`, so a discovered
copy stays inert until you flip it to `true`. Unknown keys anywhere (descriptor,
`contributes`, or any item) are rejected instead of silently ignored — a renamed key
must never be accepted and then do nothing.

## 6. Why this directory is neither discovered nor packed

`templates/` is not one of the three discovery roots above, so nothing here is mounted — a
boot of the unmodified tree discovers exactly the extensions it discovered before this
directory existed. And the template is **not discovered by the extension loader**, but it IS
**packed**: the release packer names `templates` in its `ROOT_ASSET_DIRS` (read at
`scripts/pack-mpd.ts`), so `dist/mpd-package/templates/mpd-extension` ships in the artifact, and
a template that dropped out of the pack would be a shipped-asset loss (the T-38 class the packer
refuses loudly).

That has a consequence worth knowing before you reach for the CLI in a packed install: the
packer does ship `scripts/mpd-ext.ts`, but it ships `packages/<pkg>/dist` and never
`packages/<pkg>/src`, while this CLI imports the one validator from `src/`. So in a packed
tree the CLI cannot run at all, and with `src/` restored `validate`/`list` run while
`scaffold` (and `--self-test`'s template arm) still need this directory. **The AGENTS.md §4
Extension-CLI gate is therefore a checkout gate: in a packed tree it is red.** Measured by
the upstream repository's packed-tree probe under `evidence/extensions/template-scaffold/`.

## 7. The stdio MCP server (`--with-mcp` copies only)

`server.ts` is the `--with-mcp` arm's payload; a default copy does not carry it. It speaks
newline-delimited JSON-RPC 2.0 on stdin/stdout (`initialize` → `notifications/initialized` →
`tools/list` → `tools/call`), keeps stdout for protocol data only, and reads its own `mpd-ext.json`
for `serverInfo.name` and for the `describe_extension` tool's answer. Smoke it without any host,
from the directory that holds it:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node <extension-root>/server.ts
```

## 8. The manifest values this README quotes

The debranding prober (`verify-debranding-full.mjs`) checks that this README PAIR quotes the
template manifest snippet values VERBATIM, so a drift between `mpd-ext.json` and the docs cannot
pass silently. The values as they stand today (a scaffold rewrites the NAMES in your copy; the
prose and the `stdio`/`node` pair stay as quoted until you replace them):

| Where | Field | Value |
|---|---|---|
| `skills/mpd-extension-template-skill/SKILL.md` | `skills.name` | `mpd-extension-template-skill` |
| `skills/mpd-extension-template-skill/SKILL.md` | `skills.description` | `The mpd-extension-template extension's first skill. Replace this description with what the skill does and when an agent should use it; keep the load-bearing sentence first.` |
| `flows/mpd-extension-template-flow.json` | `flows.id` | `mpd-extension-template-flow` |
| `flows/mpd-extension-template-flow.json` | `flows.title` | `mpd-extension-template flow` |
| `flows/mpd-extension-template-flow.json` | `flows.description` | `The mpd-extension-template extension's first flow. Replace this procedure with the real one, or delete the flows directory and the flows entry in mpd-ext.json.` |
| `flows/mpd-extension-template-flow.json` | `flows.whenToUse` | `Use when a task needs the repeatable procedure this flow describes.` |
| `mpd-ext.json` | `roles.name` | `mpd-extension-template reviewer` |
| `mpd-ext.json` | `roles.description` | `Read-only reviewer contributed by the mpd-extension-template extension: checks a change against this extension's own contract and reports findings with evidence.` |
| `mpd-ext.json` | `roles.persona` | `personas/mpd-extension-template-reviewer.md` |
| `mpd-ext.json` | `mcp.serverName` | `mpd-extension-template` |
| `mpd-ext.json` | `mcp.transport` | `stdio` |
| `mpd-ext.json` | `mcp.command` | `node` |
| `mpd-ext.json` | `mcp.args` | `["server.ts"]` |
