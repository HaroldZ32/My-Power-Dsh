# mpd-workmate-plugin

**English** | [中文](./README.zh-CN.md)

Durable, evolving agent library under the user's HOME (`~/.mpd/workmate`).

The roster specialists (`mpd-roles-plugin`) are **BASE templates only**. A
*workmate* is an instantiated copy with an independent name that:

- **initializes** from a base specialist (`mpd_workmate_init`), copying the base
  persona into `~/.mpd/workmate/<name>/` (base stays pristine);
- **self-summarizes after each work session** (`mpd_workmate_reflect`): appends a
  bounded memory entry (oldest evicted past the cap), merges an optional persona
  revision, and regenerates a short note card — all files are **size-capped**
  (persona ≤ 8 KiB, memory ≤ 8 KiB, note ≤ 1.5 KiB) to keep spawned context bounded;
- is **reused via note matching** (`mpd_workmate_match`): if the best note score is
  below the threshold it reports `matched: false` and you should initialize a NEW
  workmate instead of forcing a weak match;
- **renames** (`mpd_workmate_rename`) by MOVING its evolved identity rather than
  re-instantiating it, and is **deleted** (`mpd_workmate_delete`) **archive-first** —
  moved out of the library into `~/.mpd/workmate/.archive/`, where it is hidden from
  `list`/`match` but still restorable. Permanent removal needs an explicit `purge`.

## Library layout

```
~/.mpd/workmate/
  index.json                    # fast library index
  <name>/
    meta.json                   # name, baseId + baseName (INTERNAL provenance), provider/model, readonly, uses, lastTask, renamedFrom
    persona.md                  # evolving persona (seeded from base)
    memory.md                   # independent memory (append + evict)
    note.md                     # short searchable note card
  .archive/
    <name>-<stamp>/             # an archived (deleted) instance: out of the library, restorable
```

## Naming rule (ASCII-only)

A workmate name is accepted iff it is **already its own sanitized form** and non-empty:
ASCII, lower-case, `[a-z0-9_-]` only. `Alice`, CJK names, `a/b`, `..` and `.archive` are
rejected with a `400 invalid-name` refusal **before any filesystem call**, so the library
root can never be addressed as an instance. Unicode/CJK workmate names are deliberately
deferred (a listed follow-up, not a bug). The instance key IS the directory name;
`meta.name` is a display mirror repaired on the next write, which is what makes an
interrupted rename harmless.

The library root is deliberately the user's HOME (cross-project), a user-approved
exception to the workspace-scoped state rule (AGENTS.md §6). QA boots with
`HOME=<sandbox>` so tests never touch the real home.

## Base resolution and auto-naming (functional NAME only)

`mpd_workmate_init`'s `base` is the specialist's **functional NAME** — the name
`mpd_roles_list` / `mpd_role_persona` use, e.g. `Deep Worker`. Matching is
case/whitespace/separator-insensitive (`Deep Worker`, `deep worker`, `deep-worker` and
`DEEP WORKER` are the same base), and an unknown key is refused with a **names-only**
message that lists the valid names. A roster **id** (`hephaestus`, `sisyphus-junior`, …)
is INTERNAL provenance and is **not** a base key: it is refused like any other unknown
key, and the refusal deliberately does not echo the rejected key.

With `name` omitted the instance name is derived from the functional name: `Deep Worker`
initializes as `deep-worker-1`, and a further init of the same base takes
`deep-worker-2` (the counter skips every name already taken in the library).

**`baseId` is internal and never exposed.** It stays in `meta.json` (and the library
index) as provenance for existing instances — no migration is performed or needed — while
every public projection strips it: the `mpd_workmate_list` / `mpd_workmate_match` payloads
and their schemas, the `mpdWorkmate` service's `list` / `get` / `read`, the
`GET /plugins/mpd-workmate/{list,roster,get}` bodies (the `/roster` route also drops the
roster `id`) and the Workmates sidebar tab. A consumer can therefore only learn a base by
its functional name.

## Tools

| Tool | Purpose |
|---|---|
| `mpd_workmate_list` | list instances (name, baseName, uses, updatedAt, note summary) |
| `mpd_workmate_init` | instantiate a base specialist into an independently-named workmate |
| `mpd_workmate_spawn` | one-shot reuse: subagent with the workmate's persona+memory+note on its own model route (readonly bases deny write tools) |
| `mpd_workmate_reflect` | self-evolve after work: memory append/evict, persona revision merge, note regen |
| `mpd_workmate_match` | rank notes against a task; below threshold → suggest a new init |
| `mpd_workmate_rename { name, new_name }` | rename the instance: moves directory key + metadata + index key + note self-reference (see below) |
| `mpd_workmate_delete { name, purge?, confirm? }` | delete the instance: archive-first; `purge: true` + `confirm: <name>` removes it permanently |

Also provides the `mpdWorkmate` service (`list` / `get` / `read` / `rename` / `delete`).
`list` / `get` / `read` are derived from disk and reflect a mutation on the very next
call (no caching): after a rename `get(oldKey)` is `null` and `get(newKey)` is the full
detail. `renamedFrom` carries the previous key(s) and is **informational only** — it is
never used to resolve a name, so a later call with the OLD key fails with
`no workmate named "<oldKey>"` and zero side effects instead of silently resurrecting the
old directory.

## Rename and delete

**Rename** (`mpd_workmate_rename { name, new_name }` → `{ ok, name, from, renamedFrom }`)
moves the whole evolved identity, it never re-instantiates: directory key, `meta.name`,
the `index.json` key, the `note.md` self-reference and `renamedFrom` (previous names,
deduped, capped at 10) move together. `persona.md` and `memory.md` bytes, the size caps,
`uses`, `lastTask` and `createdAt` are preserved **byte-for-byte**, and only `updatedAt`
changes; `note.md` is rewritten ONLY for a LEADING `<baseName>-based workmate "<oldKey>".`
prefix (the exact text `autoNote` writes) — a custom note keeps its bytes untouched.
Archived team records are historical and are deliberately **not**
rewritten. Refusals: an invalid or non-ASCII `new_name` → `400 invalid-name`; renaming to
the same key (case-only rename sanitizes to the same key) → `400 invalid-name`; the target
already exists → `409 collision`; the workmate is in use → `409 in-use`.

**Delete** (`mpd_workmate_delete { name, purge?, confirm? }`) is **archive-first**: the
instance is moved to `~/.mpd/workmate/.archive/<name>-<compactUtcStamp>/` and leaves
`list` / `match` / the service immediately. The dot-prefixed archive is not an addressable
instance, so it is never listed, matched or mutated. `purge: true` removes it for real and
additionally requires `confirm` set to the exact name — without it the call is refused with
`400 confirm-required` and nothing is destroyed. Results:
`{ ok: true, name, archived: "<path>", purged: false }` for an archive and
`{ ok: true, name, archived: null, purged: true }` for a purge (one shape on the tool, the
service and the HTTP body alike). The index key is dropped on both paths, no other
workmate's bytes change, and a failed delete never leaves a partially removed instance.

**Archive-first delete is ONE-WAY in-product**: no tool, route or GUI restores an archived
instance. Recovery is a manual move back into the library:

```bash
mv ~/.mpd/workmate/.archive/<name>-<stamp> ~/.mpd/workmate/<name>
```

The instance is then listed and addressable again (the directory name is the key).

### Refused while in use

Both mutations are **refused while the workmate is in use**, and nothing is changed:
`409 in-use` with a `blocking` list naming every blocking team id + member. "In use" means
either an in-flight `mpd_workmate_spawn` of that workmate in this process, or a
non-archived team record under `<workspace>/.mpd/team/<teamId>/team.json` whose members
include it. Clear the block by letting running spawns finish **and** archiving (or
retiring) those teams — then repeat the mutation. Note the consequence: a team record
whose member is named after a roster role blocks the matching key, so renaming anything
*to* `architect` is refused while such a record exists.

### HTTP routes (web profile)

`POST /plugins/mpd-workmate/rename` (`{ name, new_name }`) and
`POST /plugins/mpd-workmate/delete` (`{ name, purge?, confirm? }`), plus the existing
`GET /list`, `GET /roster`, `GET /get?name=` and `POST /init`. Every response carries
`content-type: application/json; charset=utf-8` and `cache-control: no-store`:

| Condition | Status | Body |
|---|---|---|
| rename succeeded | 200 | `{ ok: true, name: <newKey>, from: <oldKey>, renamedFrom }` |
| deleted by archiving | 200 | `{ ok: true, name, archived: "<path>", purged: false }` |
| deleted by purging | 200 | `{ ok: true, name, archived: null, purged: true }` |
| wrong verb | 405 | `allow: POST` header, empty body |
| invalid JSON body | 400 | `{ error }` |
| invalid / non-ASCII / empty name | 400 | `{ error, reason: "invalid-name" }` |
| unknown workmate (also a repeat delete) | 404 | `{ error, reason: "unknown" }` |
| rename target already exists | 409 | `{ error, reason: "collision" }` |
| refused because the workmate is in use | 409 | `{ error, reason: "in-use", blocking: [{ teamId, member }] }` |
| purge without `confirm === name` | 400 | `{ error, reason: "confirm-required" }` |

A repeat delete is deliberately `404`, not an idempotent `200`. Route registration stays
lazy (it needs a `webServer`), so a headless profile is tool-only. Error bodies never leak
an absolute `$HOME` path.

## GUI (Workmates sidebar tab)

The Workmates tab exposes both operations: a rename field **pre-filled with the current
key**, and an explicit two-step delete — the first click only opens the confirmation, the
archive step explains that it is archive-first and restorable, and the purge step states
that it is permanent and requires typing the exact name. A successful rename reselects the
new key; a delete leaves the detail pane and never re-reads the dead key. The page body is
fully localized (zh/en) and every refusal reason is rendered from the dictionary. The
sidebar **tab-strip label** stays the hardcoded English `Workmates` — a documented
deferral (it is resolved at tab-registration time where no localized translator is in
scope, exactly like the sibling AgentTeams tab), not an oversight.

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
bun build packages/mpd-workmate-plugin/src/index.ts --target node --format esm --outfile packages/mpd-workmate-plugin/dist/index.js
bun test packages/mpd-workmate-plugin   # offline lifecycle tests (sandbox HOME), rename/delete included
```

Every `dist/index.js` that embeds the read-only deny list must be rebuilt in the same change:
the repo runs `dist`, not `src`.
