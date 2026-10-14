# mpd-memory-plugin
**English** | [中文](./README.zh-CN.md)

Plan C / C6 — git/svn-backed memory engine with a reflection state machine.

**mpd-owned code.** The engine's semantics — markdown memory files with frontmatter
(`description`/`kind`/`aliases`/`read_only`), a journal plus a facts queue (part of the
documented store layout; no tool writes it yet), and a step-count reflection reducer — are
RE-EXPRESSED here from the DOCUMENTED BEHAVIOUR of the upstream package `memory-core`
(base 8c57e46, SUL-1.0). No upstream source is translated and no upstream prompt or text is copied.

**The VCS abstraction and the svn backend are OURS, not upstream's.** Upstream `memory-core` is
**Git-only** (`GitMemoryRepo`; there is no `SvnMemoryRepo`), so the `git | svn | both` mode and
everything behind the svn half of it are this package's own work — never present that framing as
upstream-attributable.

*History.* An earlier draft of the reducer mirrored upstream's state-machine vocabulary
(`reflected_completed_steps`, `steps_since_last_successful_reflection`, `reservation`, and the
`completeTransition` name in a tool description). **de-omo wave F replaced that vocabulary** with
this package's own: `reflectionsCompleted`, `stepsSinceReflection`, `pendingReflection`.

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

`<workspace>/.mpd/memory/agents/<slug>/{repo, runtime/{reflection.json, journal.jsonl}}`
(slug = `config.agentSlug` or derived from the workspace basename).

## Tools

- `mpd_memory_write({title, content, kind?, tags?, readOnly?})` — persist + commit;
  increments the reflection step counter (due hint when `reflectionEvery` crossed).
- `mpd_memory_read({query?, kind?, limit?})` — substring/alias search over entries.
- `mpd_memory_reflect` / `mpd_memory_reflect_complete` — reflection state machine.
- `mpd_memory_status` — vcs mode, paths, entry counts, reflection counters.

## Build / test

```sh
bun build packages/mpd-memory-plugin/src/index.ts --target node --format esm --outfile packages/mpd-memory-plugin/dist/index.js
bun test    # git backend (real commits) + svn backend (fake CLI wiring)
```
