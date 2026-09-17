# Extension authoring guide — when, where and how

[中文](./extension-authoring-guide.zh-CN.md)

This is the task-oriented guide for a **person** who wants to add a capability to this bundle
without patching it. It answers why, when and where. The field-by-field contract stays in
[`extensions.md`](./extensions.md), the plugin package reference in
[`../packages/mpd-ext-plugin/README.md`](../packages/mpd-ext-plugin/README.md), and an
agent-facing machine contract in [`../EXTENSIONS-FOR-AGENTS.md`](../EXTENSIONS-FOR-AGENTS.md).
This guide deliberately carries **no schema tables**: duplicating them is how two documents start
disagreeing.

## 1. Why an extension, and when it is the wrong tool

An extension is a **directory with an `mpd-ext.json` manifest**. The host discovers it from the
filesystem, so there is no install step, no publish step, no profile patch and no rebuild: you write
files, validate them, restart `dsh`, and the capability exists. It is the cheapest way to make a
capability exist, and it is deliberately narrow.

An extension speaks **declarative data** — a skill, a flow, a stdio MCP server, a read-only roster
role. If what you need is not one of those four, an extension is the wrong instrument:

| You need | Use instead |
|---|---|
| a new profile row, a pinned dependency, code that runs at install time, or a versioned package for many users | the **install plane**: a plugin bundle ([`extensions.md`](./extensions.md) §1) |
| one instruction an agent should follow once | nothing new — write it into the task, or into a skill of the corpus |
| a graphical panel, a marketplace, remote download or version solving | none of these exist in v1 ([§7](#7-distribution)) |

This section chooses an **instrument**; it never chooses a root. §2 is the only place in this guide
that answers "which root", exactly once.

Two more questions decide the rest, and both are answered in the section that follows: **which root
the directory goes in** (§2) and **when the host re-reads it** (§4).

## 2. The one plane-selection rule

**There is exactly one rule for choosing the root, and this is it:**

> Put the extension in `<session workspace>/.mpd/extensions/<id>/` when every kind it declares is a
> **skill or a flow** and it should travel with that workspace. Put it in `~/.mpd/extensions/<id>/`
> when it declares an **MCP server or a role** — those two kinds are illegal in the project plane —
> or when it must be visible to **every** session on this machine. `<bundle>/extensions/<id>/` is the
> same decision with a different owner: it is for an extension that ships inside a bundle rather than
> living in a home directory.

The restriction is not cosmetic. Registering a tool or a skill provider is **process-global** in this
harness, so a per-session MCP server or roster role cannot be represented honestly. A project-plane
manifest that declares `mcp` or `roles` is refused **per item** with a stated reason
(`refuseHostKind`, `packages/mpd-ext-plugin/src/registry.ts:678-685`) — the refusal is loud, it names the item, and the
skills and flows in the same manifest still load.

Read the rule before writing the manifest rather than after the first refusal: it is the single most
common wrong-plane mistake, and the refusal only arrives at discovery time.

## 3. The isolation posture, and the residuals we accept

A declared MCP server is a **child process**, and it receives a deliberately small environment. Only
the SDK's measured safe inherit list crosses into it — `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`,
`USER` on POSIX (a win32 list of `APPDATA`, `HOMEDRIVE`, `HOMEPATH`, `LOCALAPPDATA`, `PATH`,
`PROCESSOR_ARCHITECTURE`, `SYSTEMDRIVE`, `SYSTEMROOT`, `TEMP`, `USERNAME`, `USERPROFILE`,
`PROGRAMFILES`), as declared at (`INHERITED_ENV_VARS`, `packages/mpd-ext-plugin/src/mcp-client.ts:69-85`). On top of that,
any name that looks credential-shaped is dropped even if it is on the list
(`isCredentialShapedEnvName`, `packages/mpd-ext-plugin/src/mcp-client.ts:87-97`), so the harness's own provider keys are never
inherited by accident. What the extension declares in its manifest `env` **is** passed — that is
authored, visible configuration, not inheritance (`childEnv`, `packages/mpd-ext-plugin/src/mcp-client.ts:99-117`).

The posture is real, and so are its accepted residuals. They are stated here because an accept
decision nobody wrote down is indistinguishable from an oversight:

1. **Same-OS-user disk access.** The child runs as you, with your filesystem rights. It can read any
   file your user can read, including credential files, if something tells it a path. The allowlist
   stops accidental *environment* leakage; it is not a sandbox.
2. **Author-declared secrets are real secrets.** Anything you write into a manifest `env` block is
   readable in the manifest on disk. `mpd_ext_show` redacts the **values** (keys stay visible,
   `redactedDescriptor`, `packages/mpd-ext-plugin/src/index.ts:659`) so a tool result in a session log cannot leak
   them — but the file itself is not encrypted, and a value you wrote down is a value you own.
3. **Filesystem trust.** Installing an extension means executing a stdio server that you or someone
   else provided. There is no signature, no sandbox namespace, no seccomp profile and no capability
   drop.
4. **Native code is outside the posture.** A server may itself spawn anything; the environment it
   passes on is its own business.

A third-party tool schema is handled with the same "keep the tool, drop what cannot be honoured"
principle: an `inputSchema` outside the harness subset is projected and the payload root normalized
onto an object, and an `outputSchema` outside the subset costs that tool its **schema**, never the
tool.

One precision about provenance: the four residuals above are posture assessments from reading the
spawn and registration paths — they are an explicit accept decision, not the result of executed
exploits. [`extension-adaptation-report.md`](./extension-adaptation-report.md) §9 records the same
caveat for the audit that first stated them.

## 4. Lifecycle and restart matrix

There is no reload tool in v1: **a restart is the reload** (`"No reload"`, `docs/extensions.md:524`). The matrix
below is the part people get wrong, because the same directory behaves differently per kind and per
plane.

| Kind | Plane | Read when | Restart needed after an edit? |
|---|---|---|---|
| `skills` | project | **per call**, from the calling session's workspace | no |
| `flows` | project | **per call** | no |
| `skills`, `flows` | user, bundle | discovered at **apply** | yes |
| `mcp` | user, bundle | the extension is discovered at apply, and servers are **connected at apply** — in parallel, time-boxed by `connectTimeoutMs`, never lazily (`connectExtensionMcpServers`, `packages/mpd-ext-plugin/src/index.ts:1062`) | yes |
| `roles` | user, bundle | the declaration is discovered at apply; the role itself is resolved **per call** by the roster plane, which re-reads the persona text (`extensionRoles`, `packages/mpd-roles-plugin/src/index.ts:225-292`) | yes for adding or renaming a role; editing only the persona body does not need one |

Three consequences worth carrying in your head:

- A per-call kind in the project plane is the only combination that behaves like a live file: edit
  the skill or flow, use it in the next call, no restart.
- An MCP server that fails does not fail the boot. It lands in `unavailable` or `failed` with a
  bounded child-stderr tail (`stderrTail`, `packages/mpd-ext-plugin/src/mcp.ts:42`), and every other extension
  still activates. The next boot retries it.
- `extensions.enable` / `extensions.disable` in `.mpd/mpd.jsonc` are **process-level**, not a
  per-session switch, and they only filter what is served — they never gate registration, so a
  disabled extension cannot break anything else.

## 5. From the template to a running extension

The copy-me skeleton is [`../templates/mpd-extension/`](../templates/mpd-extension) — all four kinds,
with a placeholder id that the scaffold rewrites. Two ways in, same result:

```bash
# A. scaffold: copies the template and rewrites the id and every derived name
bun scripts/mpd-ext.mjs scaffold my-extension --dir ~/.mpd/extensions
# ... add --with-mcp to keep the four-kind copy (skill + flow + role + stdio MCP server);
#     without it the copy is a three-kind extension.

# B. or copy it yourself — it is an ordinary directory
cp -r templates/mpd-extension ~/.mpd/extensions/my-extension
```

Both commands assume a checkout. From an installed (packed) bundle the same CLI lives inside the
package — `bun node_modules/@mpd-dsh/mpd/scripts/mpd-ext.mjs <command>` from the profile directory —
and §7 says exactly what such an artifact carries and which bound still applies.

Then walk the same five steps every extension goes through:

```bash
# 1. validate — the SAME validator the runtime uses, so exit 0 means "this host would load it"
bun scripts/mpd-ext.mjs validate ~/.mpd/extensions/my-extension

# 2. see what this host would discover, plane by plane (the bundle plane included)
bun scripts/mpd-ext.mjs list

# 3. edit the manifest: write your real id, description and content, then set "enabled": true
#    (the copy starts disabled because the TEMPLATE ships "enabled": false — the runtime default is
#     the opposite, so an extension that simply omits the key is live)

# 4. restart dsh — section 4 says why there is no other way to pick up a user-plane change

# 5. use it from a session: mpd_ext_list shows it with its plane and load state, mpd_ext_show
#    shows its resolved roots, skill/flow/role names and each MCP server's state, and
#    mpd_flow_list / mpd_flow_show read the contributed flows.
#    A kept stdio server publishes its tools as mcp__<serverName>__<tool>.
```

The published name is usually exactly `mcp__<serverName>__<tool>`, but not always: when that string
contains a character outside `[A-Za-z0-9_-]`, or is longer than 64 characters, the illegal characters
become `_`, the name is truncated, and a `_<12-hex sha256(serverName NUL tool)>` suffix is appended so
two distinct tools can never collapse into one public name (`publicToolName`,
`packages/mpd-ext-plugin/src/mcp-client.ts:129-135`). Read the real name from the session's tool list
rather than assuming it.

Two details that save a debugging round: the manifest's `skills.root` and `flows.dir` are relative to
the extension root and may not escape it, and the stdio server's `command` is `node` with
`args: ["server.mjs"]` and `cwd: "."` — the working directory is the extension root, so the server
finds its own manifest. You can smoke the server with no host at all:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node ~/.mpd/extensions/my-extension/server.mjs
```

If you are writing a **project-plane** extension instead, the same walkthrough applies with two
differences: the root is `<session workspace>/.mpd/extensions/my-extension/`, and `mcp`/`roles` are
refused there (§2) — so a project copy is the three-kind one.

## 6. Verifying before you ship

Validation answers "would this load?"; the QA lanes answer "does it behave?". Both are runnable from
a checkout:

```bash
# the interface's own tests
bun test packages/mpd-ext-plugin

# the developer CLI, including its offline self-test (temp directories only)
bun scripts/mpd-ext.mjs --self-test

# the real lanes: a mounted dsh in a sandboxed DSH_HOME + HOME + session cwd
bun skills/dsh-qa/scripts/extension-lifecycle.mjs --no-skip
bun skills/dsh-qa/scripts/extension-mcp-bridge.mjs --no-skip
bun skills/dsh-qa/scripts/extension-template.mjs
```

The middle two drive the shipped example end to end — discovery, the per-call project plane, the
bridge, the isolation assertions — and the third scaffolds the template and verifies a real mount of
the copy. `skills/dsh-qa/scripts/extension-isolation.mjs` is the shared proof helper those lanes
import; it is **not** a case lane, and its only offline proof is its own `--self-test`.

One rule about evidence: `dsh --profile <p> --dump-config` composes rows and executes nothing, so it
**never** proves that a plugin or an extension loaded. Use a mounted boot, or a real tool call.

## 7. Distribution

An extension distributes as a **directory**, and the whole directory is the unit: asset paths in the
manifest resolve against the extension root, so a partial copy is a broken copy. Where it goes is the
decision from §2 — this section only says how the bytes get there:

- **For yourself, one machine:** put the directory in `~/.mpd/extensions/<id>/`. Copy it, restart,
  done.
- **As part of a bundle:** put it in `<bundle>/extensions/<id>/`. It is then discovered at apply like
  any other shipped extension, and it needs no install step for the user.
- **For someone else, outside a bundle:** hand over the directory (an archive is fine). There is no
  registry, no version resolution and no dependency graph: the recipient drops it in, validates it,
  and restarts.

A packed artifact is **author-facing** since the 2026-09-17 packaging change, so these commands run
there too. The packer ships the scaffold template (`templates/mpd-extension`, T-35), the `docs/` set
with its EN + `*.zh-CN.md` pairs (T-36/T-45), the on-demand `agent-references/`
(`troubleshooting.md` — the symptom → cause/fix table — plus the adopted-plugin delta registry and
its index), and a **compiled validator entry**
(`packages/mpd-ext-plugin/dist/validator.js`, generated at pack time from the shipped bundle) that
`scripts/mpd-ext.mjs` falls back to when the TypeScript sources are absent (T-51). Measured from
inside a freshly packed `dist/mpd-package/`:

```bash
bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example   # exit 0
bun scripts/mpd-ext.mjs scaffold my-extension --dir /tmp/demo # exit 0 — copies the packed template
node scripts/mpd-ext.mjs --self-test                          # exit 0 — the compiled entry needs no TS loader
bun scripts/mpd-ext.mjs --validator                           # which validator this run loaded, from where
```

An installed bundle carries the same CLI: from the profile directory,
`bun node_modules/@mpd-dsh/mpd/scripts/mpd-ext.mjs validate <dir>`. The honest bound: a checkout run
validates from `src` (live rules, no build step), so a **source** edit is not visible inside an
artifact until the next `npm run pack` — re-pack before judging a packed CLI.

What does **not** exist in v1, so that you do not plan around it: `mpd_ext_reload`, YAML flows, MCP
resources or prompts, a GUI panel, a marketplace or remote download, extension-contributed agent
presets, and extension roles becoming agent-teams teammates.

## 8. Troubleshooting

| What you see | Most likely cause | What to do |
|---|---|---|
| `mpd_ext_list` shows the extension, but a kind is missing and there is a per-item error | the manifest declares a kind whose asset is absent, or an unknown key anywhere | run `bun scripts/mpd-ext.mjs validate <dir>`: it prints one line per item with the reason |
| your project-plane extension is refused with a plane message | it declares `mcp` or `roles`, which are host-wide kinds | move it to `~/.mpd/extensions/`, or drop that kind (§2) |
| the skill does not appear in the catalog although the extension loads | the name lost to a higher-ranked provider, or the frontmatter `name` does not match the directory | `mpd_ext_list` reports `served` / `notServed` per claimed name, checked against the harness catalog |
| an MCP tool is missing | the server is `unavailable` or `failed` | `mpd_ext_show` prints the state and a bounded stderr tail; check `command`, `args`, `cwd` and the declared `env` |
| a change to a user-plane extension has no effect | it is discovered at apply | restart `dsh` (§4) |
| a change to a project-plane skill or flow has no effect | the session's workspace is not the directory you edited | the project plane is resolved from the **calling session's** workspace |
| two extensions with the same id | first wins: project → user → bundle | the shadowed entry is reported, never silently dropped — rename one |
| `enabled` is `true` but nothing happens | the config layer force-disabled it, and `disable` wins over `enable` | check `.mpd/mpd.jsonc` `extensions.enable` / `extensions.disable` |

## 9. Where the field-level reference lives

- [`extensions.md`](./extensions.md) — the descriptor reference (top level, `contributes`, grammars
  and asset-path rules), the worked snippets per kind, the failure and collision policy, the
  model-facing tools, the install-plane comparison and the v1 limits. **This is where the tables
  live.**
- [`../packages/mpd-ext-plugin/README.md`](../packages/mpd-ext-plugin/README.md) — the plugin's own
  reference: configuration, the four inspection tools, the failure policy, the schema posture, and
  the documented limits.
- [`../extensions/README.md`](../extensions/README.md) — the shipped discovery root and the
  `mpd-ext-example` reference extension, in its disabled-by-default form.
- [`../templates/mpd-extension/README.md`](../templates/mpd-extension/README.md) — the template you
  copy, its `--with-mcp` semantics and its own verification commands.
- [`../EXTENSIONS-FOR-AGENTS.md`](../EXTENSIONS-FOR-AGENTS.md) — the machine contract: kind-by-kind
  requirements, a validated manifest skeleton, error signatures and the refusal list.
