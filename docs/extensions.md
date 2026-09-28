# MPD extensions — the developer guide

**English** | [中文](./extensions.zh-CN.md)

The extension interface of the `@mpd-dsh/mpd` bundle: one frozen contract through which a plugin
package — or a plain directory on disk — contributes **skills**, **flows**, **MCP servers** and
**roles** without touching the core bundle. Loader row id `mpd-ext`, cordis service
`mpdExtensions`.

This guide is written for the plugin author who wants to add an authoring flow, a HarmonyOS
porting procedure, a skill pack or an MCP server. Every sample below was taken from the shipped
code (`packages/mpd-ext-plugin`, `extensions/mpd-ext-example`, `scripts/mpd-ext.ts`) and every
command was run as printed — see [§12](#12-how-the-samples-in-this-guide-are-verified).

---

## 1. What already works — and what this interface adds

A plugin package can **already** contribute to this bundle with zero core changes: any package that
carries its own `dsh.bundle.patch` joins the loader as a second bundle layer (`dsh plugin add
<package>` appends it), and a package that ships its own `dsh-mcp-client` row gets MCP naming,
reconnection, pagination, schema rollback and disposal for free.

That is the **install-plane path**, it is first-class, and this interface does **not** replace it.

| | Install plane (a package with its own `dsh.bundle.patch`) | Extension interface (this guide) |
|---|---|---|
| What you ship | an npm-shaped package with a patch layer | a directory with `mpd-ext.json`, or a plugin row that calls `register()` |
| Who installs it | the user, with `dsh plugin --profile <p> add <package>` | nobody — the manifest file is discovered from a known root |
| Can contribute | anything a patch row can compose (rows, MCP servers, tools, presets) | skills, flows, MCP servers (stdio), roles |
| Validation | the loader's own row/schema rules | the frozen contract of §3, per item |
| Update a running host | reinstall + restart | edit the manifest; the project plane is re-read per call |

What this interface adds on top of the install plane:

1. a **frozen contract** (`packages/mpd-ext-plugin/src/sdk.ts`) so every contributor declares
   capabilities the same way, with the same validation, namespacing and failure policy;
2. the **data plane** — a directory holding `mpd-ext.json` plus its assets: no packaging, no
   `dsh plugin add`, no profile change;
3. **flows** — a declarative procedure (JSON) rendered into a skill document, because the harness
   has no flow seam of its own;
4. a **runtime stdio MCP bridge** for servers that must not become a profile patch row (per-project
   or per-user servers, profiles that cannot be re-installed).

Rule of thumb: reach for the **install plane** when what you ship is a first-class package with its
own rows, presets or custom tools; reach for an **extension** when what you ship is capability
content (skills, flows, a helper MCP server, a specialist role) that a user should be able to drop
in per project or per home directory.

## 2. Two authoring forms, one contract

Both forms produce the same registry entry; only the `origin` metadata differs (`"plugin"` |
`"directory"`), and `origin`/`plane` are never author input.

**Code plane** — any plugin row registers at its own apply time:

```ts
import { defineExtension } from "@mpd-dsh/mpd/packages/mpd-ext-plugin/dist/sdk.js"

// at your plugin's apply time; `root` is the directory your assets live under
const ext = ctx.get("mpdExtensions")
ext?.register(
  defineExtension({
    apiVersion: 1,
    id: "authoring-flows",
    description: "Authoring flows for code changes, shipped by the authoring package",
    contributes: { skills: [{ root: "skills" }], flows: [{ dir: "flows" }] },
  }),
  { root: pkgRoot }, // the directory your assets live under — resolve it from your own
                     // package location, e.g. dirname(fileURLToPath(import.meta.url))
)
```

`defineExtension()` is an identity helper for authors (types plus zero runtime behaviour); the real
call is `register(descriptor, { root })`. Resolve the service **lazily** (`ctx.get`) and never
declare it in `inject`: a declared-but-unregistered service is a fatal `pending` loader entry in
this harness, and the extension row may legitimately be absent.

**Data plane** — a directory whose name is the root, with one manifest file:

```text
~/.mpd/extensions/authoring-flows/
├── mpd-ext.json          # the descriptor (this file defines the root)
├── skills/               # { "root": "skills" }
│   └── change-triage/SKILL.md
├── flows/                # { "dir": "flows" }
│   └── change-triage-flow.json
├── personas/             # { "roles": [{ "persona": "personas/…" }] }
│   └── code-reviewer.md
└── server.ts            # { "mcp": [{ "command": "node", "args": ["server.ts"] }] }
```

The manifest file name is `mpd-ext.json` (`MPD_EXT_CONTRACT.manifestFile`), and the JSON must parse
strictly — JSONC comments are not accepted in the manifest (unlike `.mpd/mpd.jsonc`).

## 3. The descriptor reference

Every key below is read from the machine-readable contract
(`packages/mpd-ext-plugin/src/sdk.ts`, `MPD_EXT_CONTRACT`), which the runtime validator **and** the
developer CLI share. The validator does not re-state a rule — a key that is not listed here is an
unknown key and is rejected.

### 3.1 Top level

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `apiVersion` | number | **yes** | — | must equal exactly `1`; any other value rejects the whole extension |
| `id` | string | **yes** | — | grammar `^[a-z0-9][a-z0-9-]{0,63}$` (1–64 chars, lower-case ASCII, digits, dashes) |
| `description` | string | no | `""` | shown by `mpd_ext_list` / `mpd_ext_show` |
| `enabled` | boolean | no | `true` | a config `disable` still wins over this (§4.3) |
| `contributes` | object | no | `{}` | only the four keys below; any other key is rejected |

**Unknown keys anywhere — top level, inside `contributes`, inside any item — are rejected per item
and recorded on that extension.** That is deliberate: this repository has measured the opposite
failure mode (a schema that silently keeps unknown keys, so a renamed option is accepted and does
nothing). Here a typo is loud.

### 3.2 `contributes`

| Key | Item type | Required item fields | Optional item fields (defaults) |
|---|---|---|---|
| `skills` | array | `root` | `rank` (`300`) |
| `flows` | array | `dir` | `rank` (`300`) |
| `mcp` | array | `serverName`, `transport`, `command` | `args` (`[]`), `env` (`{}`), `cwd` (`"."`), `toolCallTimeoutMs` (`60000`), `connectTimeoutMs` (`10000`) |
| `roles` | array | `name`, `persona` | `description` (`""`), `readonly` (`false`), `provider` + `model` (must be supplied together) |

`skills` item — a directory whose **immediate subdirectories** each hold a `SKILL.md`:

```json
{ "root": "skills", "rank": 300 }
```

`flows` item — a directory holding `*.json` flow documents (one flow per file):

```json
{ "dir": "flows", "rank": 300 }
```

`mcp` item — one stdio MCP server (v1 has no HTTP/SSE transport):

```json
{
  "serverName": "lint-mcp",
  "transport": "stdio",
  "command": "node",
  "args": ["server.js"],
  "env": { "PROJECT_ROOT": "." },
  "cwd": ".",
  "toolCallTimeoutMs": 60000,
  "connectTimeoutMs": 10000
}
```

`roles` item — one specialist for the roster:

```json
{
  "name": "Code Reviewer",
  "description": "Reviews a code change read-only before review.",
  "readonly": true,
  "persona": "personas/code-reviewer.md",
  "provider": "deepseek-official",
  "model": "deepseek-v4-flash"
}
```

### 3.3 Grammars and asset-path rules

| Value | Rule | Where it comes from |
|---|---|---|
| extension `id` | `^[a-z0-9][a-z0-9-]{0,63}$` | `MPD_EXT_CONTRACT.idPattern` |
| skill name (frontmatter `name`) and **flow id** | `^[a-z0-9]+(?:-[a-z0-9]+)*$` | `skillNamePattern` — a flow id must satisfy this **stricter** grammar, so `a--b` is rejected |
| MCP `serverName` | `^[A-Za-z0-9_-]{1,32}$` | `serverNamePattern` (identical to the harness `dsh-mcp-client` constant) |
| asset references (`skills.root`, `flows.dir`, `roles.persona`) | extension-root-relative only | absolute paths and `..` escapes are rejected per item — no extension reaches outside its own root |

`rank` is explicit and only meaningful for `skills` and `flows`. The full ladder, **lower wins inside
a layer**: `100` project-dsh < `200` project-agents < `250` runtime < `300` custom (the default) <
`400` user-dsh < `500` user-agents < `600` bundled.

`origin`, `plane` and everything under "load results" are **registry metadata, never author input**:
a descriptor that supplies `origin` or `plane` is rejected as an unknown key.

### 3.4 Flow documents

A flow file is a JSON object with these keys (validated in
`packages/mpd-ext-plugin/src/flows.ts`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | **yes** | must satisfy the skill-name grammar, because the flow is served as a skill candidate under this name |
| `title` | string | **yes** | non-empty; becomes the rendered procedure's `#` heading |
| `description` | string | **yes** | non-empty; becomes the skill description the model reads |
| `whenToUse` | string | no | rendered in the `## When to use` section |
| `steps` | array | **yes** | non-empty |
| `steps[].title` | string | **yes** | non-empty |
| `steps[].detail` | string | no | the action to take |
| `steps[].tool` | string | no | a tool hint (`read`, `bash`, `mcp__server__tool`, …) |
| `steps[].output` | string | no | what the step is expected to produce |

Unknown keys are rejected per file. A flow is **declarative**: the renderer emits a
`SKILL.md`-shaped document (`name` = flow id, `content` = the rendered procedure) into the skills
catalogue. Nothing executes a flow for you; the model follows the steps with its own tools.

## 4. Discovery: three roots, two lifecycles

### 4.1 The roots

| Root | Lifecycle | May contribute |
|---|---|---|
| `<session workspace>/.mpd/extensions/*/mpd-ext.json` | **per call** — resolved from the calling session's workspace for the tools, and from the harness's own `provider.list({ cwd })` for the skills plane | **skills + flows only** |
| `~/.mpd/extensions/*/mpd-ext.json` | host-wide, discovered at apply | skills, flows, mcp, roles |
| `<bundle>/extensions/*/mpd-ext.json` | host-wide, discovered at apply from the bundle path | skills, flows, mcp, roles |

### 4.2 Why the project plane is restricted

Tool and provider registration in this harness is **process-global** — there is no session scope for
it. A per-session MCP server or roster role therefore cannot be represented honestly, so a
project-level manifest that declares one is **rejected for that item**, loudly, with this reason:

> project-level extensions may contribute skills and flows only: tool and provider registration is
> process-global and cannot be scoped to a session

The rejection is per item: the rest of that extension still loads. Nothing half-loads silently.

### 4.3 Precedence, shadowing and the config keys

For equal ids the discovery precedence is **project → user → bundle** (first wins). The shadowed
entry is recorded and reported by `mpd_ext_list` (`shadowed`) — never fatal, never silent.

Config lives in `.mpd/mpd.jsonc` (project layer) merged over `$DSH_HOME/mpd.jsonc` (user layer,
project wins):

| Key | Type | Default | Meaning |
|---|---|---|---|
| `extensions.enable` | string[] | `[]` | force these extension ids enabled |
| `extensions.disable` | string[] | `[]` | force these extension ids disabled |
| `extensions.mcp.enabled` | boolean | `true` | disconnect every declared MCP server when `false` (reported by `mpd_ext_list` / `mpd_ext_show`) |
| `extensions.mcp.connectTimeoutMs` | number > 0 | `10000` | default connect budget for servers that do not declare their own |
| `extensions.mcp.toolCallTimeoutMs` | number > 0 | `60000` | default per-tool-call budget |

The effective enabled state is `disable[]` → `enable[]` → the descriptor's `enabled` flag, in that
order. Two honest limits are worth knowing before you rely on these keys:

- **`extensions.*` is process-level, not session-scoped.** `mpdConfig` resolves it from the
  process layer stack, so a project's `enable`/`disable` is not a per-session switch. The extension
  interface deliberately does not call `reload(exec)` per skill snapshot: that would make the skills
  provider's view and the tools' view disagree, which is worse than a documented limit. The
  `extensions.roots[]` key does **not** exist — a declared root list would add path-escape and
  precedence questions for no v1 value.
- **enable/disable only filter what is served**; they never gate a registration.

## 5. Worked examples

All four kinds, taken verbatim from the shipped reference extension
`extensions/mpd-ext-example/` (disabled by default — enable it to watch the interface end to end).

### 5.1 A skill (`skills`)

Manifest line: `"skills": [{ "root": "skills", "rank": 300 }]`, and
`extensions/mpd-ext-example/skills/change-triage/SKILL.md`:

```markdown
---
name: change-triage
description: "Reference extension skill: triage a code change before review (what changed, what it touches, which risks deserve a reader). Use when a code diff needs a first pass before a human or reviewer looks at it."
---

# change-triage

…the procedure…
```

The frontmatter needs a non-empty `name` (skill-name grammar) and a non-empty `description`. The
frontmatter parser is a deliberately small YAML subset: top-level scalars, `name`, `description`,
`user-invocable` and `disable-model-invocation` (booleans). `userInvocable`/`modelInvocable` are the
legacy spellings and are rejected with the name to use instead.

### 5.2 A flow (`flows`)

Manifest line: `"flows": [{ "dir": "flows", "rank": 300 }]`, and
`extensions/mpd-ext-example/flows/change-triage-flow.json` (abridged to its first two steps):

```json
{
  "id": "change-triage-flow",
  "title": "Change triage before review",
  "description": "Walk a code change through the reference extension's triage skill, then hand the result to a reviewer. Use before a code change is reviewed.",
  "whenToUse": "Use when a code change needs a first pass before review.",
  "steps": [
    {
      "title": "Collect the change",
      "detail": "Read the diff and list the touched files.",
      "tool": "bash",
      "output": "The list of touched files with a one-line purpose each."
    },
    {
      "title": "Apply the triage skill",
      "detail": "Follow the `change-triage` skill: classify functional vs editorial, then name the contract each functional change can break.",
      "tool": "read",
      "output": "A ranked list of risks with file and line."
    }
  ]
}
```

### 5.3 An MCP server (`mcp`)

Manifest item (`extensions/mpd-ext-example/mpd-ext.json`):

```json
{
  "mcp": [
    {
      "serverName": "lint-mcp",
      "transport": "stdio",
      "command": "node",
      "args": ["server.ts"],
      "cwd": ".",
      "env": {},
      "connectTimeoutMs": 10000,
      "toolCallTimeoutMs": 60000
    }
  ]
}
```

The server must speak newline-delimited JSON-RPC 2.0 on stdio (`initialize`, `tools/list`,
`tools/call`; `notifications/tools/list_changed` is honoured). The shipped
`extensions/mpd-ext-example/server.ts` is a complete, dependency-free example, and
`scripts/mpd-ext.ts scaffold <name> --with-mcp` writes an equivalent one.

Two details authors get wrong:

- **`cwd` is extension-root-relative.** `"cwd": "."` means the extension's own directory, not the
  dsh process's working directory; `command` and `args` are used as authored.
- **Tool names are derived, not chosen.** A discovered raw tool name `foo` on server `lint-mcp`
  becomes `mcp__lint-mcp__foo`. Characters outside `[A-Za-z0-9_-]` become `_`, the whole name is
  capped at 64 characters, and **any lossy transformation (sanitising or truncation) appends
  `_<12-hex sha256(serverName + NUL + rawName)>`** so two distinct raw names can never collide.
  Steps in a flow can then reference `mcp__lint-mcp__foo` as a tool hint.

### 5.4 A role (`roles`)

Manifest item plus its persona file (`extensions/mpd-ext-example/personas/code-reviewer.md`):

```json
{
  "roles": [
    {
      "name": "Code Reviewer",
      "description": "Reference extension role: reviews a change read-only against the extension contract and reports findings without editing files.",
      "readonly": true,
      "persona": "personas/code-reviewer.md"
    }
  ]
}
```

A contributed role is resolved **per call** by `mpd-roles-plugin`, which reads the registry lazily at
tool-execute time (never an apply-time merge — that would silently lose every role whose extension
row applied after the roster). It then behaves like a base specialist:

- `mpd_roles_list` lists it with its owning extension (`extension: <extension-id>`), and its stable
  id is namespaced `ext-<extension-id>-<slug of the name>`;
- `mpd_role_spawn` addresses it by the declared `name` in any case/space/hyphen spelling, labels the
  subagent with that name, and gives a `readonly: true` role the same write-deny tool filter as the
  read-only base roles;
- `mpd_role_persona` returns the persona text, and `mpd_workmate_init base="<role name>"` uses it as
  a workmate BASE template;
- `provider` + `model` (supplied together) become its route; both absent means the roster's default.

**A role never becomes a teammate on its own.** The teammate roster is what the Lead creates by name
with the official `spawn_teammate` tool, which is a model-facing tool call rather than a registration
surface, so an extension cannot add a member to it from a plugin. Spawn an extension role
one-shot or as a workmate base.

## 6. Failure and collision policy

An extension, one of its items, a flow file, an MCP server or a role can fail **without** affecting
anything else. Every failure is recorded in that extension's load result with a one-line reason and
surfaced by `mpd_ext_list` / `mpd_ext_show`. Nothing in the extension interface throws out of
`apply`, and no failure aborts another extension's activation.

| Situation | What happens |
|---|---|
| unknown key in the descriptor, `contributes` or any item | per-item rejection, recorded; the extension keeps its other valid items |
| `apiVersion` ≠ 1, or a malformed `id` | the whole extension is **rejected** (nothing about it can be interpreted safely) |
| asset path absolute or escaping with `..` | that item is rejected |
| a project manifest declaring `mcp` or `roles` | rejected per item, with the reason quoted in §4.2 |
| a `SKILL.md` with a missing/invalid `name` or `description` | that candidate is **skipped and warned** — deliberately stricter than the harness, which treats `invocation` as optional and then dereferences it unguarded in every session's pre-step |
| two skills with the same name **inside one extension** | skip + warn + load-error entry |
| a skill name colliding with a lower-ranked provider | the rank ladder decides; the losing candidate is dropped by the harness. Both surfaces are now reported: a collision between two EXTENSIONS is annotated on the loser (`skill surface:` in its error list, naming the winner and both ranks), and every claimed name is checked against the harness's own catalog by `mpd_ext_list` / `mpd_ext_show` (`skillServing.served` / `.notServed`) |
| an MCP tool name colliding with a live tool | that tool is skipped and recorded; the number of tools that survive from a failed swap is **zero**, never a half-mounted server |
| an MCP server that is unreachable, hangs or dies | per-server state `connecting`/`connected`/`unavailable`/`failed`/`disabled` plus a stderr tail in `mpd_ext_show`; the boot is neither blocked nor failed |
| a role name already taken by a base role or by another extension | refused per role and reported on **both** surfaces (a `refused: …` line in the extension's `errors`, and an entry in `mpd_roles_list`'s `refused` list), logged once; the roster and the boot keep working |
| a role persona file that cannot be read | refused per role, with the path in the reason |
| two extensions with the same id | first plane wins, the shadowed one is recorded (`shadowed`) |

## 7. The model-facing tools

v1 ships **four** tools — an earlier plan counted a fifth, `mpd_ext_reload`, which was **cut**: a
reload is a state machine with its own failure class, and this repository's measured rule is that a
plugin-module change needs a process restart anyway. **The honest reload is a restart.**

| Tool | What it answers |
|---|---|
| `mpd_ext_list` | every extension known to this host: id, origin (`plugin`/`directory`), plane (`project`/`user`/`bundle`), root, **effective** enabled state, contribution counts, per-item errors, pending kinds, shadowed ids, rejected manifests, and per extension which of its claimed skill names the harness catalog really **serves** |
| `mpd_ext_show` | one extension in full: descriptor (**`env` values redacted**), resolved asset roots, contributed skill/flow/role names, the serving check of every claimed name, each MCP server's state + discovered tool names + stderr tail, and its error list (an unknown id reports the known ids) |
| `mpd_flow_list` | every flow from an enabled extension: id, title, `whenToUse`, step count, owning extension |
| `mpd_flow_show` | one flow in full: description, `whenToUse` and every step with its tool hint and expected output |

The developer CLI (§8) adds `validate`, `scaffold` and `list`; those are shell commands, not model
tools.

## 8. Developer workflow

From zero to a working extension, exactly as printed (run from the bundle repository root; `bun` is
required because the CLI imports the TypeScript contract sources directly):

```sh
# 1. scaffold a minimal, loadable extension straight into a discovery root.
#    The user plane is the right root for all four kinds; the project plane
#    (<workspace>/.mpd/extensions) accepts skills + flows only.
bun scripts/mpd-ext.ts scaffold demo-ext --dir ~/.mpd/extensions
# [mpd-ext] scaffolded "demo-ext" at /home/<you>/.mpd/extensions/demo-ext
#   contributes: 1 skill(s), 1 flow(s), 1 role(s), 0 mcp server(s)
#   next: bun scripts/mpd-ext.ts validate /home/<you>/.mpd/extensions/demo-ext

# 2. validate it with the SAME validator the runtime uses (exit 0 = loadable).
bun scripts/mpd-ext.ts validate ~/.mpd/extensions/demo-ext
# [mpd-ext] validate /home/<you>/.mpd/extensions/demo-ext (plane=user)
#   extension "demo-ext": loadable
# [mpd-ext] ok

# 3. see what this host would discover, plane by plane (bundle plane included).
bun scripts/mpd-ext.ts list

# 4. edit the manifest: write your real content and set "enabled": true
#    (a scaffolded extension starts disabled on purpose).
$EDITOR ~/.mpd/extensions/demo-ext/mpd-ext.json

# 5. restart dsh — there is no reload tool in v1; the restart IS the reload.

# 6. use it in a session: ask the model what it sees, then use the content.
#    mpd_ext_list      -> demo-ext [user/directory] enabled skills=1 flows=1 ...
#    mpd_flow_list     -> demo-ext-flow ...
#    mpd_roles_list    -> <role name> [..., extension:demo-ext]
```

Two ways to enable something without editing its manifest: `"enabled": true` in the descriptor, or
`extensions.enable: ["demo-ext"]` in `.mpd/mpd.jsonc` (§4.3). A **disabled** extension contributes
nothing anywhere — not skills, not flows, not MCP, not roles — and the CLI's `list` shows the
manifest's own flag while `mpd_ext_list` shows the *effective* state (so the two can differ when a
config list overrides the manifest).

The CLI validates its own behaviour too:

```sh
bun scripts/mpd-ext.ts --self-test   # scaffold -> validate -> list, temp dirs only
```

One note about `validate`'s output: it prints a `pending` line for every declared MCP server,
because the CLI is an **offline checker** — it validates the contract and never connects to
anything. At runtime the bridge connects the server at apply time, and `mpd_ext_show` /
`mpd_ext_list` replace that line with the server's live state (`connecting` / `connected` /
`unavailable` / `failed` / `disabled`). Treat a `pending` line as "declared, state not yet
observed".

## 9. MCP: install-plane row vs runtime bridge

Both paths are first-class; they answer different questions.

| | Install-plane `dsh-mcp-client` row | Runtime bridge (this interface) |
|---|---|---|
| Where the server is declared | a patch row in a package or the profile | `mpd-ext.json` (`mcp` items) |
| Who can add one | whoever owns the patch | the user, per home directory or bundle |
| Scope | wherever the row is composed | user / bundle planes (not per session, §4.2) |
| Lifetimes | the loader owns the child | the extension row owns the child |
| Naming, schema handling, rollback, disposal | the harness's own battle-tested path | this plugin replicates the naming constant and the keep-or-drop schema posture |
| Cost of a change | reinstall/restart | edit the manifest + restart |

Choose the **install plane** when the server is part of what your package *is* (and you want the
harness's own client semantics, transports and reconnect behaviour). Choose the **runtime bridge**
when the server is content a user should be able to add or drop without touching a profile, and
stdio is enough.

The bridge replicates the harness's public naming (`mcp__<server>__<tool>`, 64-char cap, `_<hash>`
on lossy transformation) so a tool call written against one path keeps working on the other. It
also treats a **foreign `output.schema`** the way the harness does: keep it if it satisfies the
supported subset, otherwise **drop the SCHEMA and keep the tool** — it is registered without
`structuredContent` and the reason is recorded, because a third party's schema is never rewritten
(a rewritten schema would no longer describe what the server returns) and because the harness's own
`supportedOutputSchema` does exactly this. An `inputSchema` is projected onto the subset and its
**root normalized onto an object** (a tool call always carries an arguments object, so a scalar or
array root moves its payload under a single `value` property, recorded as a note); only a tool whose
arguments cannot be described at all is skipped. The parameter sanitiser is defence-in-depth against
a future harness (this release does not validate `parameters` at registration).

## 10. Trust model

- A **code-plane** extension is a plugin row: `register()` is called inside the host process by code
  the operator already installed. It runs **in-process with full trust** — it can do anything the
  host can. There is no sandbox, and no attempt to build one.
- A **data-plane** extension is content, not code: skills and flows are text served to the model,
  and its assets stay inside its own root (paths are validated, §3.3). It is only as trusted as the
  directory it lives in — anything that can write `~/.mpd/extensions/` can change what your model
  reads.
- An **MCP server** is a **child process** started from the manifest: the command you author is
  executed. Its environment is built from a safe inherit list with credential-shaped names removed
  (`*_TOKEN`, `*_KEY`, `*_SECRET`, `*PASSWORD*`, `*_CREDENTIAL*`), its stderr is captured as a
  bounded tail for `mpd_ext_show`, and the child is reaped when the plugin is disposed. The child is
  not otherwise confined: a manifest is a trust decision, exactly like a patch row.

## 11. v1 limits and follow-ups

Stated plainly, so nobody discovers them from a failure:

- **stdio MCP only** — no HTTP/SSE transports, no MCP resources or prompts (tools only).
- **JSON flow files only** — YAML flows are a follow-up; a flow is declarative, with no execution
  state machine.
- **No extension-contributed agent presets** — the preset plane is deliberately out of scope (no
  clean runtime seam).
- **Extension roles never become teammates by themselves** — a teammate exists only when the Lead
  spawns it by name with the official `spawn_teammate` tool.
- **No reload** — restart dsh; a failed MCP server is retried on the next boot.
- **`extensions.*` config is process-level, not per session** (§4.3), because `mpdConfig` is an
  apply-time process-level snapshot.
- **A cross-provider skill shadow needs a catalog read to be visible** — our own registry can only
  compare extensions, so `mpd_ext_list` / `mpd_ext_show` ask the harness's catalog
  (`ctx.skills.list`) and report each claim as `served` or `notServed`. If that read fails, the
  report says `checked: false` with the reason instead of guessing.
- **A role the roster refuses is reported by both surfaces.** `mpd_ext_list` re-derives the same
  refusals (`refused: …` lines in the extension's `errors`, produced by `annotateRoleSurfaces` in
  `src/registry.ts`) and lists only the usable names, so its view matches `mpd_roles_list.refused` —
  the former follow-up is closed.
- **No GUI panel, no marketplace, no remote download, no version solving.**
- Language- and domain-specific capability surfaces are **not** built here: this release ships the
  interface that lets them arrive as separate extensions or packages.

## 12. How the samples in this guide are verified

Every manifest, asset and command above is taken from, and checked against, the shipped sources:

```sh
# the shipped reference extension validates, exit 0 (all four kinds)
bun scripts/mpd-ext.ts validate extensions/mpd-ext-example

# the workflow of §8, end to end (scaffold -> validate -> enable -> list)
SB=$(mktemp -d); HOME=$SB bun scripts/mpd-ext.ts scaffold demo-ext --dir $SB/.mpd/extensions
HOME=$SB bun scripts/mpd-ext.ts validate $SB/.mpd/extensions/demo-ext

# the CLI's own checks (temp dirs only)
bun scripts/mpd-ext.ts --self-test

# the contract constants this guide quotes
grep -n "defaultRank\|idPattern\|skillNamePattern\|serverNamePattern" packages/mpd-ext-plugin/src/sdk.ts
```

If a sample in this document and the shipped code ever disagree, the code wins — the contract
constants live in `packages/mpd-ext-plugin/src/sdk.ts` and a manifest the CLI accepts is a manifest
the loader accepts, because both call the same validator.

## 13. FAQ

**Do I need to package or publish anything?** No. A directory with `mpd-ext.json` in a discovery
root is enough; nothing is installed and nothing is versioned for you.

**Where should my extension live?** Per project: `<workspace>/.mpd/extensions/` (skills + flows).
For everything, including roles and MCP servers: `~/.mpd/extensions/` (or `<bundle>/extensions/`
if it ships with the bundle).

**I wrote a role/MCP item in a project extension and it was rejected.** That is by design (§4.2):
those kinds are process-global and cannot be scoped to a session. Move the extension to
`~/.mpd/extensions/`.

**I renamed a key and nothing happened.** It cannot happen here: an unknown key is rejected per
item and recorded, which is exactly why the validator does not rely on a silently-permissive schema.

**Why is my extension listed but its skill missing?** Check the effective enabled state first
(`enabled: false` in the manifest, or a config `disable`), then the `skillServing` block
`mpd_ext_show` prints: `notServed` names every claim the catalog resolves elsewhere (with the
provider that won), and `checked: false` means the catalog could not be read at all.

**Why does `validate` print `pending` for an MCP server?** Because the CLI never connects: it is an
offline contract checker. The runtime bridge connects the server at apply time and
`mpd_ext_show` shows the live state.

**How do I reload a changed extension?** Restart dsh. The project plane is re-read per call, so a
project manifest edit is picked up for later calls; a manifest in the user/bundle planes is read at
apply.

**Does a flow run anything?** No. It is a procedure rendered into a skill document; the model
follows it step by step with its own tools.

**Can I keep declaring a helper MCP server as a patch row instead?** Yes — that is the install
plane, and §9 shows when it is the better choice.
