# mpd-memory-plugin
**English** | [中文](./README.zh-CN.md)

Plan C / C6 — git/svn-backed memory engine with a reflection state machine.

**mpd-owned code.** The engine's semantics — markdown memory files with frontmatter
(`description`/`kind`/`aliases`/`read_only`), a journal plus a facts queue (part of the
documented store layout; no tool writes it yet), and a step-count reflection reducer — are
RE-EXPRESSED here from the DOCUMENTED BEHAVIOUR of the upstream package `memory-core`
(base 8c57e46). No upstream source is translated and no upstream prompt or text is copied.

**The VCS abstraction and the svn backend are OURS, not upstream's.** Upstream `memory-core` is
**Git-only** (`GitMemoryRepo`; there is no `SvnMemoryRepo`), so the `git | svn | both` mode and
everything behind the svn half of it are this package's own work — never present that framing as
upstream-attributable.

*History.* An earlier draft of the reducer mirrored upstream's state-machine vocabulary
(`reflected_completed_steps`, `steps_since_last_successful_reflection`, `reservation`, and the
`completeTransition` name in a tool description). **de-omo wave F replaced that vocabulary** with
this package's own: `reflectionsCompleted`, `stepsSinceReflection`, `pendingReflection`.

## Two stores: workspace (default) and global (wave W3-D)

The engine serves TWO stores with ONE data shape:

- **workspace** — the default, and the pre-W3-D behaviour: per agent, at
  `<workspace>/<memory.dir or ".mpd">/memory/agents/<slug>/{repo,runtime}`;
- **global** — shared across every project, at
  `<HOME>/.mpd/memory/{repo/memory/*.md, runtime/{journal.jsonl, index.json}}` (`memory.globalDir`
  overrides the root).

`mpd_memory_write`, `mpd_memory_read` and `mpd_memory_status` take `scope: "workspace" | "global"`,
defaulting to `workspace`, so no existing call changes meaning. `mpd_memory_reflect` and
`mpd_memory_reflect_complete` stay workspace-scoped — a reflection is a per-agent act, not a global one —
so a GLOBAL write never advances the reflection counter (it reports the claim the caller already had).
Both stores share the same VCS semantics (`memory.vcs`: `git` default, `svn`, `both`) through the same
`ensureVcs`/`commitAll` pair, and a global write reports `committedTo`/`errors` exactly like a workspace
write. A READ never creates a store: `mpd_memory_read`/`mpd_memory_status` with `scope:"global"` answer an
empty/zero reading while `<HOME>/.mpd/memory` does not exist, because creating it would be a HOME
mutation the guard deliberately does not cover.

### The HOME guard — containment in `$HOME` (wave W0's shared predicate)

`~/.mpd/memory` is the one home-scoped state root this package writes, so every GLOBAL mutation goes
through the adapter's shared T-43 guard (`assertHomeMutationSandboxed`, label `mpd_memory`, override
variable `MPD_DSH_MEMORY_ALLOW_REAL_HOME=1`). **The rule it enforces is CONTAINMENT IN `$HOME`, not merely
"is this the real home"** (forward note F1 of the autoproject refactor plan): while `DSH_HOME` marks an
isolated QA/verification boot, a global root OUTSIDE `$HOME` is REFUSED even when it is not the user's
real home. A `memory.globalDir` must therefore live inside the sandbox `$HOME` for an isolated boot to
write it. The refusal is a `HomeGuardRefusal` (`code: "real-home-refused"`, `status: 403`) thrown BEFORE
anything is created, and the deliberate override is the variable above. Reads are never guarded.

### The project-archive hook (deterministic digests, no model call, no network)

ONE post-execute listener (`dsh.onPostToolExecute`, released by the row's `ctx.on("dispose")` cleanup)
turns a CLOSED PROJECT into a global memory entry:

| Tool event | `projectKey` |
|---|---|
| `mpd_boulder_complete` | the completed `workId` |
| `cellwork_stop` (an accepted stop only; a refused `{ok:false}` stop closes nothing) | the archived `cellId` |
| `agent_teams_plan` with `arguments.action === "delete"` AND an `approvedAt` on the archived plan (an unapproved plan never became a project) | the plan's `teamId`, else its `planId` |

The entry is a `kind:"fact"`, `scope:"global"` markdown file tagged `["project","archive",<eventKind>]`
whose body is a deterministic digest with four sections — **What was built** (the objective plus the
plan/team/cell task titles that are readable), **Proof** (the newest `.mpd/verify` loop ids, verdict
records and evidence paths, plus the `mpd-gates.json` sha256), **Where** (the declared write scopes) and
**Open** (blocked tasks, the stop reason, unresolved references). A source that cannot be read is listed
under **Unreadable**; nothing is ever invented. Keys are namespaced `<workspace>:<projectKey>` in
`runtime/index.json`, and a second event on the same key OVERWRITES its entry and appends a `superseded`
journal record — one project keeps ONE memory while the fact of the second close survives. The listener
always returns `undefined` (it can neither alter nor veto a tool result) and contains every failure as one
line in `<workspace>/.mpd/logs/mpd-memory.log`; with the `mpdTeams` service absent it degrades to a no-op
with one logged line instead of writing a team entry it cannot identify.

## Persisted state

The state file is `<runtime>/reflection.json`, and it is real user data: a record written before
wave F carries the old field names, so the reader still ACCEPTS them and maps them onto the current
ones (`adoptLegacyState`). That mapping is read-only — the next reflection update persists the
current names only, leaving no legacy key behind, so no separate migration step is needed. Nothing
else in the repository reads those fields: `skills/dsh-qa`'s memory smoke case reads the write
counter `steps` alone.

## VCS backends (`memory.vcs`: git | svn | both)

- `git`: `repo/.git` working copy; each memory write commits.
- `svn`: `root/svn-repo` created with `svnadmin create` (file:// URL), checked
  out into `repo/`; each write `svn add --force` + `svn commit`.
- `both`: commits to git AND svn (svn primaries under the svn-repo).
- svn lives off the `svn` CLI (install: `apt install subversion` on Debian/Ubuntu,
  `brew install subversion` on macOS, or the TortoiseSVN CLI on Windows).
- **Verified with real svn 1.14.5**: `svnadmin create` → checkout → write → `svn commit` →
  `svn log` shows the memory commit (evidence/plan-c/c6-memory/svn-real).

## Paths

- workspace store: `<workspace>/<memory.dir or ".mpd">/memory/agents/<slug>/{repo, runtime/{reflection.json, journal.jsonl}}`
  (slug = `config.agentSlug`, or derived from the workspace basename);
- global store: `<HOME>/.mpd/memory/{repo/memory/*.md, runtime/{journal.jsonl, index.json}}`
  (`memory.globalDir` overrides the root).

## Tools

- `mpd_memory_write({title, content, kind?, tags?, readOnly?, scope?})` — persist + commit into the
  addressed store (`workspace` is the default); only a workspace write increments the reflection step
  counter (a due hint when `reflectionEvery` is crossed).
- `mpd_memory_read({query?, kind?, limit?, offset?, scope?})` — substring/alias search over one store's
  entries, PAGINATED: `limit` is clamped to 1..50 (default 20), `offset` starts a page (default 0), and
  the answer carries `count` (the TOTAL matched), `offset`, `returned` and `next_offset` — the next
  page's offset, or `null` at the end. Entries come back in **ascending entry-file-name order**, a stable
  order that never depends on directory enumeration, so walking `next_offset` reaches every match
  exactly once; a `scope` filter paginates over that store's filtered set.
- `mpd_memory_reflect` / `mpd_memory_reflect_complete` — the reflection state machine (workspace only).
- `mpd_memory_status({scope?})` — vcs mode, store root, entry counts, reflection counters.

## Build / test

```sh
bun build packages/mpd-memory-plugin/src/index.ts --target node --format esm --outfile packages/mpd-memory-plugin/dist/index.js
bun test    # workspace + global store, the HOME guard, the archive hook, svn backend (fake CLI wiring)
```


## Pagination and the archive hook's supersede rule (wave W4)

`mpd_memory_read` is PAGINATED: pass `offset` (default 0) and `limit` (default 20, max 50); the answer
carries `count` (the TOTAL matched, not the page), `offset`, `returned` and `next_offset` (null at the
end), in a stable entry-file-name order, so successive calls walk every match exactly once.

The archive hook writes ONE `kind:"fact"`, `scope:"global"` entry per project key. A second event with
the SAME key OVERWRITES that entry and journals `superseded` (the entry's own counter records how many
later events replaced it), so a finished project never grows a second global entry. The digest is
DETERMINISTIC — what was built, the proof paths, the scope and the open items — with no model call and
no network.

## dsh-Go tool cards

`mpd_memory_read`, `mpd_memory_write` and `mpd_memory_status` also publish native **dsh-Go tool
cards** through `output.presentationMeta`: each card is a v1 tree (`stack` title → `row` of metrics →
`keyValue`/`table`) with no data bindings and no actions, measured before publication against the
app's 8 KiB / 40 nodes / depth-6 tool-card budget. A card that cannot be built returns `{}`, so the
app falls back to its generic tool row. The text `render` and the output schemas are unchanged.
