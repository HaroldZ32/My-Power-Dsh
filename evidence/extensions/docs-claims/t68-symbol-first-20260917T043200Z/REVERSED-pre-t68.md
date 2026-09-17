# EXTENSIONS-FOR-AGENTS

Machine contract for writing a valid MPD extension (`mpd-ext`, `MPD_EXT_CONTRACT` v1). Every rule
below is enforced by the same validator the runtime uses, so a manifest accepted here is a manifest
the loader accepts. No rationale, no tutorial: for prose, read
[`docs/extension-authoring-guide.md`](./docs/extension-authoring-guide.md).

## 1. Contract surface

| Artifact | Path |
|---|---|
| The frozen constants (grammars, defaults, key sets) | `MPD_EXT_CONTRACT`, `packages/mpd-ext-plugin/src/sdk.ts:113-146` |
| Descriptor + per-item validation, role/persona and plane refusals | `packages/mpd-ext-plugin/src/registry.ts` |
| Manifest discovery (`mpd-ext.json` per directory, per plane) | `packages/mpd-ext-plugin/src/manifest.ts` |
| Flow document parsing and rendering | `packages/mpd-ext-plugin/src/flows.ts` |
| Skill document reading (frontmatter subset) | `packages/mpd-ext-plugin/src/skills.ts` |
| stdio MCP client, child environment policy, stderr tail | `packages/mpd-ext-plugin/src/mcp-client.ts` |
| The CLI that shares this validator (`validate`, `scaffold`, `list`, `--self-test`) | `scripts/mpd-ext.mjs` |
| The copy-me template this contract's skeleton is drawn from | `templates/mpd-extension/mpd-ext.json` |

Inspection tools available in a session: `mpd_ext_list`, `mpd_ext_show`, `mpd_flow_list`,
`mpd_flow_show` — the four `safeRegisterTool({ name: … })` registrations in
`packages/mpd-ext-plugin/src/index.ts`: the wrapper `safeRegisterTool`, `packages/mpd-ext-plugin/src/index.ts:521`;
the four registrations `mpd_ext_list`, `packages/mpd-ext-plugin/src/index.ts:699`; `mpd_ext_show`,
`packages/mpd-ext-plugin/src/index.ts:791`; `mpd_flow_list`, `packages/mpd-ext-plugin/src/index.ts:914`;
`mpd_flow_show`, `packages/mpd-ext-plugin/src/index.ts:968`.
The same four strings are the gated list (`EXPECTED_TOOLS`, `packages/mpd-ext-plugin/src/index.ts:532`)
that the apply summary is checked against.

## 2. Kind-by-kind requirements

| Kind | Manifest entry | Asset requirement |
|---|---|---|
| `skills` | `{ "root": <relative dir>, "rank"?: number }` | `<root>/<name>/SKILL.md` per skill; frontmatter requires a non-empty `name` satisfying `^[a-z0-9]+(?:-[a-z0-9]+)*$` and a non-empty `description`; the directory name is not the identity, the frontmatter `name` is |
| `flows` | `{ "dir": <relative dir>, "rank"?: number }` | every `*.json` in `<dir>` is one flow document: `{ id, title, description, whenToUse?, steps[] }`, `steps[].title` required, optional `detail`/`tool`/`output`; unknown keys are refused; `id` must satisfy the skill-name grammar |
| `mcp` | `{ serverName, transport, command, args?, env?, cwd?, connectTimeoutMs?, toolCallTimeoutMs? }` | `transport` is exactly `"stdio"`; `serverName` matches `^[A-Za-z0-9_-]{1,32}$`; `command` is a non-empty string; `cwd` defaults to `"."` and is extension-root-relative; the declared server is spawned at apply with only the SDK's safe inherit list plus the manifest `env` (`childEnv`, `packages/mpd-ext-plugin/src/mcp-client.ts:99-117`); its raw tool `t` is published as `mcp__<serverName>__<t>` when that name is already legal (`[A-Za-z0-9_-]` only) and at most 64 characters — otherwise the illegal characters become `_`, the name is truncated, and a `_<12-hex sha256(serverName NUL rawName)>` suffix is appended so two distinct identities can never collapse into one public name (`publicToolName`, `packages/mpd-ext-plugin/src/mcp-client.ts:129-135`) |
| `roles` | `{ name, description?, readonly?, persona, provider?, model? }` | `name` is a non-empty string and must not collide with the base roster or another extension; `persona` is an extension-root-relative file that exists and is non-empty; `provider` and `model` must appear together or not at all; `readonly` defaults to `false` |

Descriptor top level: `{ apiVersion, id, description?, enabled?, contributes? }`. `apiVersion` must
equal `1`. `id` matches `^[a-z0-9][a-z0-9-]{0,63}$`. `enabled` defaults to **`true`**; set it to `false` — as the
template does — to keep the extension dark, because an OMITTED key means a LIVE extension (`enabled`,
`packages/mpd-ext-plugin/src/registry.ts:583` — the runtime reads `enabled: input.enabled !== false`, so an omitted key is TRUE; a config `disable` still wins over it). The shipped
template is the one thing that ships `false`. Unknown keys are
refused at every level — descriptor, `contributes`, and each item.

## 3. Manifest skeleton (validates as written)

The skeleton below is extracted from this file by
`evidence/extensions/docs-claims/check-citations.mjs`, materialized next to the template's four
assets, and validated with the CLI; the run must exit 0.

<!-- citation-check: illustrative: the skeleton's own extension-root-relative asset paths -->
```json
{
  "apiVersion": 1,
  "id": "for-agents-skeleton",
  "description": "Skeleton extension used by EXTENSIONS-FOR-AGENTS.md; every asset it declares exists next to this manifest.",
  "enabled": true,
  "contributes": {
    "skills": [{ "root": "skills", "rank": 300 }],
    "flows": [{ "dir": "flows", "rank": 300 }],
    "roles": [
      {
        "name": "for-agents-skeleton reviewer",
        "description": "Read-only role contributed by this extension.",
        "readonly": true,
        "persona": "personas/for-agents-skeleton-reviewer.md"
      }
    ],
    "mcp": [
      {
        "serverName": "for-agents-skeleton",
        "transport": "stdio",
        "command": "node",
        "args": ["server.mjs"],
        "cwd": ".",
        "env": {},
        "connectTimeoutMs": 10000,
        "toolCallTimeoutMs": 60000
      }
    ]
  }
}
```

Directory layout a scaffolded copy carries — every path below is **inside the extension root**, not a
path in this repository:

<!-- citation-check: illustrative: paths inside the extension root, not repo paths -->
```
mpd-ext.json
skills/for-agents-skeleton-skill/SKILL.md
flows/for-agents-skeleton-flow.json
personas/for-agents-skeleton-reviewer.md
server.mjs
```

That tree is `templates/mpd-extension/` with the placeholder id rewritten, which is exactly what
`bun scripts/mpd-ext.mjs scaffold for-agents-skeleton --dir ~/.mpd/extensions --with-mcp` produces.

Drop a kind from the manifest and delete its assets; keep an asset nobody declares and it is simply
never read.

## 4. Plane legality

| Root | Lifecycle | Legal kinds |
|---|---|---|
| `<session workspace>/.mpd/extensions/<id>/` | per call, from the calling session's workspace | `skills`, `flows` |
| `~/.mpd/extensions/<id>/` | discovered at apply | `skills`, `flows`, `mcp`, `roles` |
| `<bundle>/extensions/<id>/` | discovered at apply | `skills`, `flows`, `mcp`, `roles` |

Equal ids resolve project → user → bundle (first wins); the shadowed entry is reported, never
dropped silently. A project-plane manifest declaring `mcp` or `roles` is refused per item with
`contributes.<kind>[<i>]` and the reason `project-level extensions may contribute skills and flows
only: tool and provider registration is process-global and cannot be scoped to a session`
(`projectRejectionReason`, `packages/mpd-ext-plugin/src/sdk.ts:144-145`; refusal at
`refuseHostKind`, `packages/mpd-ext-plugin/src/registry.ts:678-685`).

## 5. Error signatures → cause → action

| Validator output (`validate` prints one line per item) | Cause | Action |
|---|---|---|
| `apiVersion must equal 1 (got <X>)` | wrong or missing `apiVersion` | set `1`; this rejects the whole descriptor, so nothing else about it is interpreted |
| `id is required and must match ^[a-z0-9][a-z0-9-]{0,63}$` | id absent, uppercase, or too long | use lower-case ASCII, digits, dashes, ≤ 64 chars |
| `unknown key "<k>"` (on the descriptor, `contributes`, or an item) | a typo or a retired key | delete it or correct the spelling; keys are never ignored |
| `skills item must be an object { root, rank? }` / `flows item must be an object { dir, rank? }` | the item is not an object | write `{ "root": "skills" }` / `{ "dir": "flows" }` |
| `root must be a non-empty extension-root-relative directory (absolute paths and .. escapes are rejected)` | absolute path, `..`, or empty | make it relative to the extension root |
| `frontmatter requires a non-empty name in <path>` | `SKILL.md` has no `name` frontmatter key | add `name:`; a skill directory without `SKILL.md` is skipped without an error |
| `frontmatter name "<n>" violates the skill-name grammar in <path>` | the frontmatter name is not `^[a-z0-9]+(?:-[a-z0-9]+)*$` | rename it; the directory may keep any name |
| `flow id "<id>" must satisfy the skill-name grammar …` | the flow id uses the looser descriptor grammar | pick a kebab-case id with no trailing or doubled dash |
| `flow steps is required and must be a non-empty array` | empty or missing `steps` | add at least one step with a `title` |
| `unknown flow key "<k>"` / `unknown step key "<k>"` | extra keys in the flow document | remove them; only `id`, `title`, `description`, `whenToUse`, `steps` are read |
| `serverName is required and must match ^[A-Za-z0-9_-]{1,32}$` | bad or over-long server name | shorten to ≤ 32 chars |
| `transport is required and must be "stdio"` | `http`/`sse` | stdio is the only transport in v1 |
| `command is required and must be a non-empty string` / `args must be an array of strings when present` / `env must be an object of string values when present` | malformed spawn fields | fix the types |
| `cwd must be extension-root-relative (absolute paths and .. escapes are rejected)` | absolute `cwd` | use `"."` or a relative subdirectory |
| `persona is required and must be an extension-root-relative file (absolute paths and .. escapes are rejected)` | missing or escaping persona path | point it at a file inside the extension root |
| `persona file does not exist: <path>` / `persona file is empty: <path>` | the persona file is absent or zero-byte | create it with content; the role is refused, the extension still loads |
| `provider and model must be supplied together (a partial route is rejected)` | only one of the two | supply both or neither |
| `contributes.mcp[0]` / `contributes.roles[0]` + the project-plane reason | host-wide kind in the project plane | move the extension to `~/.mpd/extensions/` |
| `pending contributes.mcp[0]: … not connected yet` | **not an error** — the server is declared and connect happens at apply | ignore in `validate`; read the live state from `mpd_ext_show` (`connecting`/`connected`/`unavailable`/`failed`/`disabled`, `McpServerState`, `packages/mpd-ext-plugin/src/mcp.ts:34`) |
| `no mpd-ext.json found at or under "<dir>"` (CLI) | the path is not an extension root | pass the directory that holds the manifest |

## 6. Worked copy, end to end

```bash
# 0. a host plane that legally carries all four kinds
mkdir -p ~/.mpd/extensions

# 1. copy the template through the CLI (rewrites id + every derived name)
bun scripts/mpd-ext.mjs scaffold for-agents-skeleton --dir ~/.mpd/extensions --with-mcp

# 2. validate with the runtime's own validator: exit 0, "loadable", four kinds
bun scripts/mpd-ext.mjs validate ~/.mpd/extensions/for-agents-skeleton

# 3. enable it in the manifest ("enabled": true) and restart dsh — discovery is at apply

# 4. confirm from a session, not from prose
#    mpd_ext_list            -> for-agents-skeleton [user/directory] enabled skills=1 flows=1 ...
#    mpd_ext_show            -> resolved roots, role/skill/flow names and each MCP server state
#    mpd_flow_list           -> for-agents-skeleton-flow
#    mcp__for-agents-skeleton__describe_extension -> the server's own answer

# 5. project-plane variant: skills + flows only, read per call, no restart needed
mkdir -p .mpd/extensions
bun scripts/mpd-ext.mjs scaffold for-agents-proj --dir .mpd/extensions
bun scripts/mpd-ext.mjs validate .mpd/extensions/for-agents-proj
```

A `--with-mcp` copy keeps the manifest `mcp` block and `server.mjs`; without the flag both are
dropped and the copy contributes three kinds.

## 7. Gate commands

```bash
bun scripts/mpd-ext.mjs validate <dir>        # exit 0 = loadable; exit 1 = one line per item
bun scripts/mpd-ext.mjs validate templates/mpd-extension
bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example
bun scripts/mpd-ext.mjs --self-test           # both scaffold arms, per-file equivalence, negative control
bun scripts/mpd-ext.mjs list                  # what this host would discover, plane by plane
bun test packages/mpd-ext-plugin              # the interface's own suite
bun skills/dsh-qa/scripts/extension-lifecycle.mjs --no-skip
bun skills/dsh-qa/scripts/extension-mcp-bridge.mjs --no-skip
bun skills/dsh-qa/scripts/extension-template.mjs
```

`dsh --profile <p> --dump-config` is **not** a gate for extension code: it composes rows and executes
nothing, so it proves nothing about a load. Use a mounted boot or a real tool call.

## 8. Refusals, and why

Refused, per item (the rest of the extension still loads):

- an unknown key at any level — so a renamed descriptor key can never be accepted and then silently
  do nothing;
- an asset path that is absolute, empty, or escapes the extension root with `..`;
- a `mcp` or `roles` item in a project-plane manifest — tool and provider registration is
  process-global;
- an MCP item whose `transport` is not `stdio`, or whose `serverName` exceeds 32 characters;
- a `roles` item with a partial `provider`/`model` route, a missing or empty persona file, or a name
  that collides with the base roster or another extension;
- a flow document with an unknown key, a missing `title`/`description`, an `id` outside the
  skill-name grammar, or empty `steps`;
- a `SKILL.md` without a non-empty `name`/`description` frontmatter pair, or a name outside the
  skill-name grammar.

Refused, wholesale (`rejected`, nothing about the descriptor is interpreted):

- a descriptor whose `apiVersion` is not `1`;
- a descriptor whose `id` is absent or outside `^[a-z0-9][a-z0-9-]{0,63}$`;
- a manifest that is not valid JSON.

Refused by the CLI, before anything is written:

- `scaffold` with an id outside the id grammar, or with a derived skill/flow name outside the
  skill-name grammar;
- `scaffold` into an existing target directory — scaffolding never overwrites;
- `scaffold` when `templates/mpd-extension` is missing or carries no placeholder id.

Never refused: a failing MCP server. It is recorded on its extension with a state and a bounded
stderr tail, and the remaining extensions and servers still activate.

## 9. v1 hard limits

The developer CLI (`validate` / `scaffold` / `--self-test` / `--validator`) works from a CHECKOUT (it imports
the TypeScript validator sources) AND from a PACKED artifact: the packer ships `templates/`, the `docs/` pairs,
`agent-references/` and `scripts/`, and emits the compiled `validator.js` entry — the one
the CLI falls back to when the package's TypeScript sources are absent. Measured on a fresh `dist/mpd-package/`: every command exits 0
under bun and under plain node, and `--validator` prints which entry a run loaded
(`evidence/pack-closure/impl/20260917T011849Z/`). A SOURCE edit reaches the artifact only after a re-pack: the
packed tree ships `packages/*/dist/` and no `packages/*/src/` (it does carry other `.ts` files, e.g. the adopted
plugin's `lib/types/` declarations).
No reload (a restart is the reload: `"No reload"`, `docs/extensions.md:524`); stdio MCP only; JSON flows only; no
MCP resources or prompts; no extension-contributed agent presets; extension roles never become
agent-teams teammates; no GUI panel, marketplace, remote download or version solving; `extensions.*`
config is process-level, not per session.
