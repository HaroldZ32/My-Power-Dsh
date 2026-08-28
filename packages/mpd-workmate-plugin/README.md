# mpd-workmate-plugin

Durable, evolving agent library under the user's HOME (`~/.mpd/workmate`).

The OMO roster specialists (`mpd-roles-plugin`) are **BASE templates only**. A
*workmate* is an instantiated copy with an independent name that:

- **initializes** from a base specialist (`mpd_workmate_init`), copying the base
  persona into `~/.mpd/workmate/<name>/` (base stays pristine);
- **self-summarizes after each work session** (`mpd_workmate_reflect`): appends a
  bounded memory entry (oldest evicted past the cap), merges an optional persona
  revision, and regenerates a short note card — all files are **size-capped**
  (persona ≤ 8 KiB, memory ≤ 8 KiB, note ≤ 1.5 KiB) to keep spawned context bounded;
- is **reused via note matching** (`mpd_workmate_match`): if the best note score is
  below the threshold it reports `matched: false` and you should initialize a NEW
  workmate instead of forcing a weak match.

## Library layout

```
~/.mpd/workmate/
  index.json                    # fast library index
  <name>/
    meta.json                   # name, base, provider/model, readonly, uses, lastTask
    persona.md                  # evolving persona (seeded from base)
    memory.md                   # independent memory (append + evict)
    note.md                     # short searchable note card
```

The library root is deliberately the user's HOME (cross-project), a user-approved
exception to the workspace-scoped state rule (AGENTS.md §6). QA boots with
`HOME=<sandbox>` so tests never touch the real home.

## Tools

| Tool | Purpose |
|---|---|
| `mpd_workmate_list` | list instances (name, base, uses, updatedAt, note summary) |
| `mpd_workmate_init` | instantiate a base specialist into an independently-named workmate |
| `mpd_workmate_spawn` | one-shot reuse: subagent with the workmate's persona+memory+note on its own model route (readonly bases deny write tools) |
| `mpd_workmate_reflect` | self-evolve after work: memory append/evict, persona revision merge, note regen |
| `mpd_workmate_match` | rank notes against a task; below threshold → suggest a new init |

Also provides the `mpdWorkmate` service (`list` / `get` / `read`).

## Team integration (dsh-agent-teams)

`packages/mpd-agent-teams-plugin`'s `memberPersona()` is patched (this plugin is
first-class main code) so that a member whose name matches a workmate instance gets
that workmate's persona + memory injected into its system prompt, plus a
`mpd_workmate_reflect` instruction at the end of each task — "captain checks the
note, delegates to the workmate-named member". The captain guidance in the `mpd`
preset and roster profile instructs: consult `mpd_workmate_match` before delegating;
weak match → initialize a new workmate.

## Build / test

```bash
bun build src/index.ts --target node --format esm --outfile dist/index.js
bun test packages/mpd-workmate-plugin   # offline lifecycle tests (sandbox HOME)
```
