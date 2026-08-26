# mpd-memory-plugin

Plan C / C6 — git/svn-backed memory engine with a reflection state machine.

Focused port of upstream oh-my-openagent `memory-core` semantics (base 8c57e46,
SUL-1.0 fork terms): markdown memory files with frontmatter
(`description`/`kind`/`aliases`/`read_only`), journal + facts queues,
reflection reducer (step-count / manual / dream triggers, reservation state),
and a VCS abstraction with git AND svn backends.

## VCS backends (`memory.vcs`: git | svn | both)

- `git`: `repo/.git` working copy; each memory write commits.
- `svn`: `root/svn-repo` created with `svnadmin create` (file:// URL), checked
  out into `repo/`; each write `svn add --force` + `svn commit`.
- `both`: commits to git AND svn (svn primaries under the svn-repo).
- svn lives off the `svn` CLI (install: `apt install subversion` on Debian/Ubuntu,
  `brew install subversion` on macOS, or the TortoiseSVN CLI on Windows).

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
bun build src/index.ts --outdir dist --target node --format esm
bun test    # git backend (real commits) + svn backend (fake CLI wiring)
```
