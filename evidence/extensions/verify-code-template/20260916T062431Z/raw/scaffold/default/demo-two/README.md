# MPD extension template — the copy-me skeleton

[中文](./README.zh-CN.md)

This directory is the **single source of truth** for a new MPD external extension
(loader row `mpd-ext`). It is a complete, valid skeleton that declares all four
contribution kinds, and `scripts/mpd-ext.mjs scaffold` **copies it** — the CLI emits
no code of its own, it rewrites names and nothing else.

## 1. Copy it

```bash
bun scripts/mpd-ext.mjs scaffold <name> --dir <where>              # skill + flow + role
bun scripts/mpd-ext.mjs scaffold <name> --dir <where> --with-mcp   # + the stdio MCP server
bun scripts/mpd-ext.mjs validate <where>/<name>
```

The flag is the whole difference between the two copies, and it is deliberate:

| Arm | `contributes` in the copy | Files |
|---|---|---|
| default (no flag) | `skills`, `flows`, `roles` — **three kinds** | the `mcp` block and `server.mjs` are **dropped** |
| `--with-mcp` | `skills`, `flows`, `roles`, `mcp` — **four kinds** | `server.mjs` is kept |

Both arms are loadable, and the CLI's `--self-test` asserts exactly that: it
validates this template, scaffolds both arms into a temp directory, **re-validates
each copy**, compares every copied file against this template byte for byte (modulo
the name rewrite and the documented `mcp` drop), and then corrupts a copy to prove
`validate` fails loudly per item.

`scaffold` refuses an id that violates `^[a-z0-9][a-z0-9-]{0,63}$`, a name whose
derived skill/flow name violates the skill-name grammar, and an existing target
directory. It never overwrites.

## 2. What the copy rewrites

The placeholder is this template's **own manifest `id`** (see `mpd-ext.json`; it is
purpose-built and distinct from the shipped example `mpd-ext-example`). On copy, every
occurrence of that placeholder is replaced by the new extension name — in the contents
of every text file (`.json`, `.md`, `.mjs`) **and in every file and directory name**.
Nothing else changes, so the derived names are:

| Where | Derived value |
|---|---|
| `mpd-ext.json` → `id` | `<name>` |
| `mpd-ext.json` → `mcp[0].serverName` | `<name>` capped at 32 characters (the contract pattern allows at most 32) |
| `skills/<…>/SKILL.md` + its directory | `<name>-skill` |
| `flows/<…>.json` → file name, `id`, `title` | `<name>-flow` |
| `personas/<…>.md` + `roles[0].persona` | `<name>-reviewer.md` |
| `roles[0].name` | `<name> reviewer` |
| `mpd-ext.json` → `description`, role description, skill/flow prose | the placeholder replaced by `<name>` |

This README pair contains no placeholder, so it is copied verbatim: it stays accurate
for the copy, which is why nothing here needs rewriting after a scaffold.

## 3. The four contribution kinds

| Kind | Lives at | What it is |
|---|---|---|
| `skills` | `skills/<name>-skill/SKILL.md` | a procedure the model can load; `name`/`description` frontmatter is required, and the directory name must match the frontmatter name |
| `flows` | `flows/<name>-flow.json` | a **declarative** procedure rendered into a skill candidate; the flow `id` must satisfy the skill-name grammar |
| `roles` | `personas/<name>-reviewer.md` | a roster-shaped specialist resolved per call; `readonly: true` denies it write tools, which is why the template ships a read-only reviewer |
| `mcp` | `server.mjs` | a **dependency-free** stdio MCP server (node stdlib only); its tools are published as `mcp__<serverName>__<tool>` |

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
bun scripts/mpd-ext.mjs validate <dir>   # exit 0 = this host would load it; exit 1 = one line per item
bun scripts/mpd-ext.mjs list             # what this host would discover, plane by plane
```

Validation is not a formality: the manifest sets `"enabled": false`, so a discovered
copy stays inert until you flip it to `true`. Unknown keys anywhere (descriptor,
`contributes`, or any item) are rejected instead of silently ignored — a renamed key
must never be accepted and then do nothing.

## 6. Why this directory is neither discovered nor shipped

`templates/` is not one of the three discovery roots above, so nothing here is mounted
— a boot of the unmodified tree discovers exactly the extensions it discovered before
this directory existed. And the release packer `scripts/pack-mpd.mjs` copies by an
explicit allowlist that carries no `templates/` entry, so the template is not in
`dist/mpd-package` either: a checkout install and a packed install behave identically.

## 7. The stdio MCP server

`server.mjs` is the `--with-mcp` arm's payload. It speaks newline-delimited JSON-RPC
2.0 on stdin/stdout (`initialize` → `notifications/initialized` → `tools/list` →
`tools/call`), keeps stdout for protocol data only, and reads its own `mpd-ext.json`
for `serverInfo.name` and for the `describe_extension` tool's answer. Smoke it without
any host:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node server.mjs
```
