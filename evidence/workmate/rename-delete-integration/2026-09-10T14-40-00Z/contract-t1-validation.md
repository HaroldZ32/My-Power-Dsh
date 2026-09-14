# CONTRACT v1 — workmate rename + delete (binding)

Preserved by the captain from the first team's t1 (Planner, verdict=pass) plus live corrections measured
by the captain. This file is the interface document for every implementation, verification and review task
of the rebuilt team. Where a task description and this file disagree, this file wins (with the captain's
live-verified corrections already folded in below).

Repo: `/root/dshProj/my-power-dsh`. Feature owner surface: `packages/mpd-workmate-plugin/src/index.ts`
(the whole feature, 439 lines), GUI in `packages/mpd-bundle-plugin/src/web-client.js`, member binding in
`packages/mpd-agent-teams-plugin/lib/members.js`.

---

## A. User decisions (already agreed — do not reopen)

- **D1 delete = archive-first.** Default moves the instance to `~/.mpd/workmate/.archive/<key>-<compactUtcStamp>/`
  (hidden from list/match, restorable). Real removal only with an explicit purge switch, which additionally
  requires `confirm === <name>`. The GUI uses an explicit confirmation step.
- **D2 in-use gate + full cascade.** Rename and delete are REFUSED while the workmate is in use; once a mutation
  is allowed, every library-owned name reference is updated. Archived team records are historical and are NOT
  rewritten.
- **D3 the read-only deny-list defect is in scope** for this change.
- **D4 surface = agent tools + web routes + the Workmates sidebar tab (zh/en).**
- **D5 ASCII-only key scheme.** Names are limited to `[a-z0-9_-]`; invalid/empty/CJK names are rejected with a
  clear error BEFORE any filesystem call. Unicode/CJK names are explicitly deferred to a follow-up.

## B. Identity + name rules

- The **instance key IS the directory name** (`~/.mpd/workmate/<key>/`). `meta.name` is a display mirror:
  repaired on the next write, never used for path resolution. This is what makes an interrupted rename harmless.
- Name validation applies to **both** arguments of rename and to delete's name:
  accept iff `raw === sanitizeName(raw) && raw !== ""` (and length <= 255). This is a superset of every existing
  key, so no instance becomes un-addressable, while `"Alice"`, CJK, `"a/b"`, `".."`, `".archive"` are all
  rejected before any fs call.
- **`wmDir("")` currently resolves to the LIBRARY ROOT** — the implementation must guard it so the root can never
  be moved, renamed or removed.
- Collisions: renaming onto an existing directory/file/workmate is refused. Renaming to the same key is a defined
  outcome (rejected, no side effect). Case-only rename is rejected (it sanitizes to the same key).

## C. Agent tools (exact surface)

- `mpd_workmate_rename { name, new_name }`
- `mpd_workmate_delete { name, purge?, confirm? }` — `purge: true` requires `confirm === name`, otherwise refused.
- `mpdWorkmate` service gains exactly `rename(...)` and `delete(...)`; `list` / `get` / `read` must reflect the
  mutation on the very next call (no caching): `get(oldKey)` -> null, `get(newKey)` -> full detail.

## D. HTTP wire protocol (exact)

`POST /plugins/mpd-workmate/rename` and `POST /plugins/mpd-workmate/delete`, JSON bodies, plus the existing
`GET /list`, `GET /roster`, `GET /get?name=` and `POST /init` unchanged. Every response:
`content-type: application/json; charset=utf-8`, `cache-control: no-store`.

| Condition | Status | Body |
|---|---|---|
| success (rename) | 200 | `{ ok: true, name: <newKey>, from: <oldKey>, ... }` |
| success (delete, archive) | 200 | `{ ok: true, name, archived: "<path>", purged: false }` |
| success (delete, purge) | 200 | `{ ok: true, name, archived: null, purged: true }` |
| wrong verb | 405 | `allow: POST` header, empty body |
| invalid JSON body | 400 | `{ error }` |
| invalid / non-ASCII / empty name | 400 | `{ error, reason: "invalid-name" }` |
| unknown workmate (also a repeat delete) | 404 | `{ error, reason: "unknown" }` |
| rename target already exists | 409 | `{ error, reason: "collision" }` |
| refused because the workmate is in use | 409 | `{ error, reason: "in-use", blocking: [{ teamId, member }] }` |
| purge without `confirm === name` | 400 | `{ error, reason: "confirm-required" }` |

Repeat delete is deliberately 404 (not idempotent-200). The GUI branches on `reason`.
Route registration stays lazy behind the existing `webRegistered` guard, so a headless profile works tool-only.
Do NOT leak absolute `$HOME` paths in error bodies (the existing `init` returning `path` is a deliberate
exception, not a precedent).

## E. In-use gate (D2) — implementable with no cross-plugin service

- (a) an in-process `Map<key, count>` incremented/decremented around `dsh.spawnAgent` in `mpd_workmate_spawn`;
- (b) a read-only scan of **direct children** of `<workspace>/.mpd/team/<teamId>/team.json`
  (archived teams live under `.mpd/team/archive/**`, excluded by construction), matching
  `workmateKey(member.name)`.
- **Reading that state is permitted; WRITING to `.mpd/team` is forbidden.** Fail-open on any read error.
- The gate and the filesystem mutation happen in **one synchronous block** (no `await` between them), which makes
  it race-free in-process — no lock file needed.
- The refusal message MUST name the blocking team id and member, because this repo currently holds **seven** stale
  non-archived team records under `.mpd/team/` (not six — corrected by the t1 validation), each carrying all 11
  roster member names; without the names the refusal is not actionable. See §L A6 for the exact blocked keys and for
  the deterministic test recipe.
- Known operational consequence to document: a workmate whose key equals a roster member name (e.g. renaming
  `oracle-1` to `architect`) is refused while such a team record exists. Archiving those teams (AgentTeams panel)
  removes the block.

## F. Rename cascade (complete) and delete semantics

Rename updates: directory key, `meta.name`, the `index.json` key, the `note.md` self-reference
(`autoNote` writes `<baseName>-based workmate "<name>".`), and a continuity field (`renamedFrom` / previous names).
It does **not** re-copy the base, does not reset memory, does not bump `uses`; it does update `updatedAt`.
Persona/memory/note content, caps, `uses`, `lastTask` and `createdAt` are preserved byte-for-byte.
Explicitly NOT rewritten: archived team records (historical).

Delete: archive path `~/.mpd/workmate/.archive/<key>-<compactUtcStamp>/` (colons stripped for Windows
portability); the instance disappears from `list`/`match`/service immediately; the index key is dropped in both
the archive and purge paths; no other workmate's bytes change; a failed delete never leaves a partially removed
instance.

## G. Read-only deny list (CAPTAIN-CORRECTED — overrides the original t1 finding)

The original t1 claimed `apply_patch` was the only dead name and that `str_replace_editor` must be kept.
That is **wrong**, verified live twice by the captain with `mpd_role_spawn`:

```
Error: tools.restrict() names unknown global tools "str_replace_editor", "apply_patch";
known global tools: … bash … edit … mpd_hashline_edit … read … write
```

- The harness validates the whole list and reports BOTH names as unknown.
- The `known global tools` enumeration IS the live registry of this profile: it contains `write`, `edit`,
  `mpd_hashline_edit` and **neither** `str_replace_editor` nor `apply_patch`.
- An installed `@deepseek-ai/dsh-tool-str-replace-editor` package and a `dsh-base` patch row exist, but that row is
  not composed into this profile — a patch row is not proof of runtime registration.

Therefore **both** names must be removed — and ONLY those two. Every other entry in each list is deliberately
kept, because those entries ARE the read-only guarantee:

| File | Ships as | Removed |
|---|---|---|
| `packages/mpd-roles-plugin/src/index.ts:23-33` | `write, edit, mpd_hashline_edit, bash, mcp__ast_grep__rewrite, mcp__ast_grep__scan, mcp__lsp__rename` | `str_replace_editor`, `apply_patch` |
| `packages/mpd-workmate-plugin/src/index.ts:30` | `write, edit, mpd_hashline_edit` | `str_replace_editor`, `apply_patch` |

**`bash` stays denied in the roles list.** It is not a read tool — a shell can write files, and
`packages/mpd-roles-plugin/test/roles.test.ts:106` exists precisely to keep the "no shell/AST/LSP write bypass"
property. Any claim that read-only children "still need bash" is wrong: `read`, `glob`, `grep` are not denied and
remain available. Likewise `mcp__ast_grep__rewrite`, `mcp__ast_grep__scan` and `mcp__lsp__rename` are
write-capable and stay denied — and unlike the two dead names, all three are live-registered.

Both `dist/index.js` copies must be rebuilt in the same change (the repo reads dist, not src), and
`packages/mpd-roles-plugin/test/roles.test.ts:106-107` currently PINS the two dead names and must be re-pointed in
the same change, gaining a guard that they cannot come back. Keeping either dead name leaves every read-only spawn
failing with the identical error.

**Forbidden fix:** do NOT filter the list with `dsh.hasTool` — it reads the GLOBAL tool view only, so
`write`/`edit`/`bash` (registered on the agent plane by the mpd preset) answer false and filtering would silently
drop them, leaving read-only children un-guarded. Only the genuinely optional MCP names
(`mcp__ast_grep__rewrite|scan`, `mcp__lsp__rename`) may be resolved that way.

## H. Edge-case matrix (each row needs a decided outcome; all must be covered by tests)

empty/invalid/CJK/punctuation-only name · unknown name · repeat delete (404) · half-created instance without
`meta.json` · case-only rename · sanitization collision ("Alice Cooper" vs "alice-cooper") · symlinked instance
dir (refused, not resolved) · partial failure between directory move and metadata write · spawn/reflect racing a
rename (old-dir resurrection) · reflect after delete · `list`/`get`/`read` immediacy · readonly instance as the
target of a mutation · headless profile with no `webServer` · GUI stale selection after a mutation · the six
stale team records of section E.

## I. Evidence + baseline rules (repo gates)

- Gates: `bun test packages`, `bun run typecheck`, `bun run test:qa`, `node scripts/verify-vendor.mjs`, and a
  `dsh --profile headless --dump-config` boot in an isolated `DSH_HOME`.
- Every lifecycle exercise runs with `HOME=<sandbox>` (the workmate library lives under HOME) and the sandbox path
  is asserted in the evidence. The real `~/.dsh` and the real HOME are never touched.
- Evidence on disk: `evidence/<domain>/<slug>/<timestamp>/{result.json,output.log}`.
- **BASELINE:** the tree is dirty by design — HEAD `f697088` plus 33 uncommitted entries from a previous session's
  work. Never commit, stash, revert or "tidy" them; record HEAD + `git status --porcelain` before and after, and
  report only your own delta.
- Docs are BILINGUAL: every human-facing doc needs both `*.md` and `*.zh-CN.md` updated in the same change, each
  with the language switch link under its title. `AGENTS.md` is English-only.

## J. Verified implementation hazards (member recon, file:line — absorb before coding)

- Linux `fs.renameSync` **silently overwrites an existing empty target directory**, so `existsSync(target)` alone is
  not a sufficient collision guard. Use `lstatSync` and keep the collision check + `renameSync` in the SAME
  synchronous block as the in-use gate (§E) — the one-block rule applies to rename, not only to delete.
- Refuse a **symlinked** instance dir or symlinked target with `lstatSync` instead of resolving it (§H row).
- `writeIndexEntry` (`packages/mpd-workmate-plugin/src/index.ts:104-108`) only ever SETS the new key: rename and
  delete must delete the OLD key and write once, or the stale key lingers in `index.json` forever.
- Guard `wmDir("")` (`src/index.ts:55`) at the top of both tools: require `raw === sanitizeName(raw) && raw !== ""`
  before any filesystem call.
- `mpd_workmate_spawn` must decrement its in-process in-use counter in a `finally` (throw path included); one failed
  spawn otherwise leaks a permanent in-use block on that workmate.
- `mpdWorkmate.delete` must be an object-literal property (`delete: (…) => …`); a bare `delete(...)` member is a
  parse error.
- GUI: `request()` in `packages/mpd-bundle-plugin/src/web-client.js:205-217` collapses every non-OK response into
  `new Error(body.error)` and **discards `status`, `reason` and `blocking[]`**. Contract §D requires the GUI to
  branch on `reason` and D2 requires the in-use refusal to name the blocking team + member, so the error path must
  carry them. Also: clear or reselect the detail view after a mutation (no stale selection), and keep the zh/en key
  sets identical with assertions in the offline harness.
- Every `dist/index.js` that embeds a deny list must be rebuilt in the same change — the repo runs dist, not src.

## K. Deliberate deferral (captain decision, ask no further)

The sidebar **tab-strip label** (`SIDEBAR_TAB_TITLE = "Workmates"`, resolved at tab-registration time) stays a
hardcoded English constant in this change. The page body is fully localized zh/en; the strip label is not, because
it is resolved at registration where no localized `t` is in scope, and the sibling AgentTeams tab has the same
property. This is a documented deferral, not an oversight: record it in the docs (t10) and in the delivery report
(t11), and do NOT raise it as a review finding.

---

## L. Amendments from the t1 validation (binding — these override any earlier wording)

The t1 validator re-ran every claim against the tree AND the live harness (`mpd_role_spawn {role:"oracle"}`),
and confirmed the harness validates the WHOLE deny list (`dsh-tools/lib/index.js:2802-2804`), so one dead name
aborts every read-only spawn before a child is created. Baseline at validation time: all four offline gates GREEN
(215 pass / 0 fail), HEAD `f697088` + 33 porcelain entries unchanged.

**A1 — per-file deny arrays (already folded into §G).** Remove ONLY `str_replace_editor` and `apply_patch`.
`test/roles.test.ts:105-112` asserts the 9 names today and MUST be rewritten in the same change or the
`bun test packages` gate goes red; every `dist/index.js` embedding a list must be rebuilt.

**A2 — DENY-LIST PARITY. Captain decision: ALIGN.** Both arrays ship the same seven names:
`write, edit, mpd_hashline_edit, bash, mcp__ast_grep__rewrite, mcp__ast_grep__scan, mcp__lsp__rename`.
Rationale: the workmate array lacked `bash` and the three MCP write tools, so a readonly workmate could still write
through a shell — a hole that is merely MASKED today because every readonly spawn throws, and that the §G fix would
un-mask. Concretely: the workmate plugin EXPORTS its array, and the roles test adds an assertion that the two
exported arrays are equal, killing the drift class permanently.

**A3 — filesystem paths key on the DIRECTORY, never `meta.name`.** `ensureInstance` returns `{meta, dir, key}` with
`key = sanitizeName(name)`; every write uses `key`; `listInstances` returns the DIRECTORY name; list/get/read
normalize the name to the key; `writeIndexEntry` takes the key. Otherwise a later reflect can resurrect the OLD
directory after a rename, and `list` can show a name that no longer resolves. Test: a dir `alice` whose `meta.json`
says `stale` → list shows `alice`, reflect writes `alice/`, the index key is `alice`.

**A4 — `renamedFrom` must be added to `readMeta`'s whitelist** or it is silently dropped on the next reflect. Add
`renamedFrom?: string[]` to `Meta` and to `readMeta` (default `[]`), append the previous key on rename (dedupe,
cap 10), and carry it through the init/reflect/rename writes. Test: rename → reflect → `renamedFrom` survives and
`get()` exposes it.

**A5 — note self-reference rule (resolves §F's tension).** Rewrite ONLY a LEADING
`<baseName>-based workmate "<oldKey>".` prefix to the new key. If the note does not start with that prefix (a custom
note passed at init) leave the bytes untouched — this also keeps `autoNote`'s `prev.startsWith(prefix)` dedupe
correct. Test both branches.

**A6 — SEVEN non-archived team records (not six), each carrying all 11 roster member names.** Blocked keys:
`architect, researcher, planner, explorer, reviewer, plan-reviewer, vision-analyst, lead, deep-worker,
senior-engineer, junior-engineer`. Therefore (i) happy-path renames must avoid those keys — use `oracle-1` →
`oracle-2`; (ii) the 409 in-use path is deterministic and free HERE by renaming to `architect`, so use that instead
of fabricating team state. Archive exclusion holds by construction (`archive/` contains no `team.json`;
`retired-members.json` is a file and is skipped by the directory filter).

**A7 — artifact and i18n gates.** `packages/mpd-bundle-plugin/test/sidebar-tab.test.mjs:17` loads the COMMITTED
`client.js`, so `node scripts/build-mpd-client.mjs` must run in the same change or the suite exercises stale bytes.
Bundle rows point at `dist/index.js` (patch rows 149/174), so t3 and t5 must rebuild dist. No zh/en key-parity test
exists → add `Object.keys(zh).sort()` vs `Object.keys(en).sort()`. `request()` (web-client.js:205-217) drops
`reason`/`blocking`, so §D's "the GUI branches on reason" is unimplementable until it is extended.

**Ownership / serialization (decided).** t3 owns ALL of `packages/mpd-workmate-plugin/**` (including the line-30
array, its test and the dist rebuild); t5 owns `packages/mpd-roles-plugin/**` (including `roles.test.ts` and the
parity guard); t4 owns `packages/mpd-bundle-plugin/**`. Zero file overlap, so t3/t4/t5 stay fully parallel and no
extra dependency is needed. Do NOT let t5 touch the workmate plugin.

**Residuals to DOCUMENT (t10/t11), not to fix:** the §E(b) scan sees only teams of the CURRENT workspace while the
library is cross-project; a second dsh process on the same HOME can still race a mutation (the in-process gate
cannot see it); the `wmDir("")` guard is belt-and-braces given the D5 name predicate already rejects `""`.

---

## M. Decisions on the gaps the traversal dossier surfaced (captain — binding)

**M1 — a READONLY instance IS a valid mutation target: ALLOW.** Rename and delete are library-administration
operations performed by the calling agent, not the workmate editing itself. The readonly discipline governs what a
readonly workmate's own spawn may do, not whether the user may manage it. No extra restriction, no extra reason code.

**M2 — same-key rename: 400 + `reason: "invalid-name"`**, with an error text stating that the new name equals the
current key. Zero filesystem side effects.

**M3 — a directory without `meta.json` (orphan): 404 + `reason: "unknown"`, zero filesystem mutation.** Never touch a
directory the library cannot address; document that orphan directories are removed by hand.

**M4 — a reflect arriving with a LEGACY (pre-rename) key does NOT resolve through `renamedFrom`.** It fails with
"no workmate named X" and zero side effects — never resurrect a directory. `renamedFrom` stays informative, exposed
by `list`/`get`/`read`. The realistic cases are already covered: the in-process gate closes same-session spawns and
the team-record scan closes team members; the cross-process case is a documented residual (§E).

**M5 — collision guard = `lstat` the target and map ANY hit to 409 `collision`.** Measured behaviour to defend
against: `renameSync` onto an EXISTING EMPTY directory succeeds silently (data-integrity hazard); non-empty →
ENOTEMPTY; file target → ENOTDIR; a DANGLING symlink is invisible to `existsSync` but visible to `lstatSync`, after
which rename throws ENOTDIR. No raw fs error may escape as a non-§D body.

**M6 — where the gate reads team state: `<cwd>/.mpd/team`, hardcoded.** `mpd_config_get team.stateDir` returns null
in this deployment, so do NOT add a config lookup. Note that QA boots `HOME=<sandbox>` but `cwd=repo`, so the gate
still reads the REAL team records — sandbox test cases must avoid roster keys exactly like production ones.

**M7 — never edit stale mirrors.** Greps will hit `.qa-reloc/**`, `dist/mpd-package/**` and the tracked
`evidence/scan/**` copies; those are not the live files. Live files are only the touched package's `src/**` +
`dist/**`, plus `src/web-client.js` + `client.js`. `VENDOR_LOCK` covers only upstream assets, so plugin dist
rebuilds do not affect `verify-vendor`.

**M8 — the GUI test harness must grow.** `client-harness.mjs`'s `fetchImpl` (L327-332) can express only a 200 body
or a 404 `{error}`, and `ctx.locale.register` (L294) discards the `{zh,en}` dictionaries — so the 409/400 reason
bodies and the zh/en key-parity assertion are impossible until the stub is extended and the dictionaries are
captured or exported. Extending that test infrastructure is IN SCOPE for t4.

---

## N. Measured environment rules (captain — binding, do not rediscover)

**N1 — this harness REJECTS JSON-schema type arrays in tool schemas.** A property declared as
`{ type: ["string","null"] }` makes the loader throw
`unsupported JSON schema: schema.properties.<p>.type must be a single type string (type arrays are not supported)`,
which surfaces as `JsonSchemaError` and takes the WHOLE plugin tree down (`dsh: plugin tree failed to load`).
Measured at `packages/mpd-workmate-plugin/src/index.ts:664` (`archived: { type: ["string","null"] }`) — that single
line currently prevents the full `mpd` profile from booting, which blocks t6 and t4 until it is fixed. Use a single
type string, and do NOT assume a `nullable:` keyword is honoured without proving it by booting.
**CORRECTED BY MEASUREMENT — this supersedes the first wording of this paragraph, which named the wrong command:** a
`dsh --profile … --dump-config` run COMPOSES rows without MOUNTING them (instrumented: a mounting boot logs 94
`ToolRuntime.register` calls, the dump run logs none), so a schema abort that takes the whole plugin tree down is
INVISIBLE to a `--dump-config` row check. That is exactly how t3's evidence stayed green while the tree could not
load, and why my own earlier instruction ("use a full-profile boot check") was insufficient as written. The required
proof for any tool-schema change is a boot that really MOUNTS the rows (a real profile boot with registration
instrumentation) in an isolated `DSH_HOME`; `--dump-config` may never be cited as evidence of a successful plugin
load.
**Two low-severity items the t7 review proved, for t10/t11 to carry:** (i) the delete TOOL returns `archived: ""` on
purge while the §D HTTP body and the service return `null` — one field, two shapes; the schema may legitimately be
`archived: { oneOf: [{type:"string"},{type:"null"}] }` (the harness validator ACCEPTS that form; only the
`type: […]` array form is rejected), so normalizing on `null` cannot reintroduce the abort; (ii) archive-first delete
is ONE-WAY in product — no tool, route or GUI restores an archived instance, so the docs must describe the manual
`mv ~/.mpd/workmate/.archive/<key>-<stamp> <key>` recovery and must never claim an in-product restore.
The same construct exists, pre-existing and nested, at `packages/mpd-hashline-plugin/src/index.ts:110`
(`lines: { type: ["string","array"] }`): it is OUT of this change's scope, but if a full-profile boot ever fails on
it, that is a real pre-existing defect to report — never "fix" it blind.

**N2 — plugin code is loaded into the host at BOOT, so a fix on disk does not affect an already-running session.**
Measured: after `packages/mpd-roles-plugin/{src,dist}` were fixed (zero occurrences of the dead names), the captain's
own `mpd_role_spawn` in the running session STILL returns the pre-fix
`tools.restrict() names unknown global tools …`. Therefore: **live proof requires a FRESH dsh process** — the dsh-qa
cases already boot their own child process, which is why they can prove it while an in-session call cannot. Any claim
of "live-proofed" that rests on an in-session tool call is invalid evidence.
Corollary that makes a credential-free proof possible: `tools.restrict()` is evaluated at child COMPOSITION, before
model authentication. So a fresh process that now fails with `MISSING_CREDENTIAL` instead of
"names unknown global tools" is POSITIVE evidence that the restriction list was accepted — the fix is proven even
without a usable provider key.

**N3 — no provider credential is reachable in this environment.** `~/.dsh/.credentials.yaml` carries only a
browser-session grant (`payload.secret`), `settings.yaml` configures the `llm-deepseek` models and contains no key
field, and no provider key exists in the environment. LLM-dependent acceptance criteria (a spawned child actually
EXECUTING a turn) are therefore recorded as an explicit environment residual with the blocked-run evidence — never
claimed as passed, and never worked around by weakening the criterion.

---

## O. Deployment + governance decisions (captain — binding)

**O1 — the plugin fix is live only after a dsh RESTART in this deployment.** Measured independently by the captain
and the Reviewer: `mpd_role_spawn` inside the running host still throws the pre-fix
`tools.restrict() names unknown global tools …` although both packages' `src` and `dist` are clean, because the host
process booted before the dist rebuilds (roles `dist` 20:40:53, workmate `dist` 20:47:50) and holds the old module in
memory. The live profile is `link:/root/dshProj/my-power-dsh`, so no stale mirror is involved. Consequences:
(i) an in-session spawn probe is INVALID evidence in BOTH directions — a pass proves nothing and a failure is
expected; (ii) the read-only proof must come from a FRESH sandbox boot (which is what the dsh-qa case does);
(iii) t11's delivery report MUST state that a dsh restart is required for the fix to take effect on a running
install, exactly as §8 of AGENTS.md requires after any code change.

**O2 — who owns the final documentation text: t10.** t5 legitimately pre-edited `AGENTS.md` (a §12 troubleshooting row
for this exact defect) and `skills/dsh-qa/SKILL.md` (the QA case-table row) because they are part of the fix's
definition of done. Those edits are ACCEPTED; t10 owns the FINAL text from here on — it must build on them, must not
revert or duplicate them, and must fold them into the bilingual/doc-sync pass.

**O3 — baseline acknowledgement (§9).** The change to `VENDOR_LOCK.json`'s vendored-skills fingerprint
(363 → 364 files + new `treeSha`) is a DELIBERATE, captain-acknowledged baseline update: adding our own QA case
under `skills/dsh-qa/` necessarily changes that tree, and it was recomputed with the gate's own LF-normalising
algorithm. `node scripts/verify-vendor.mjs` PASS confirms the lock matches the tree.

**O4 — accepted scope deviation.** t5's writes to `AGENTS.md`, `skills/dsh-qa/SKILL.md`, `VENDOR_LOCK.json` and
`evidence/fix/readonly-deny/**` fall outside the path set declared for it; the captain accepts them as part of this
fix's definition of done. They are NOT a scope breach and must not be reported as one.

**O5 — the parity guard must be a HARD assertion.** `packages/mpd-roles-plugin/test/roles.test.ts:146-149` still has a
`console.warn(...) + return` branch when the workmate export is missing; while it passes today, that branch would
turn a future regression into a green pass with zero assertions — the exact failure mode that let this defect hide
behind a green suite in the first place. Once the export exists, the guard must FAIL on a missing import.

---

## P. Correction to §N2's proof method (captain — binding, supersedes the weak reading)

The Reviewer challenged the §N2 corollary and is RIGHT; the captain reproduced the false positive it warned about.

**P1 — "no restrict error" is NOT proof on its own.** In a credential-less fresh process driven by a prompt, the
parent model never runs a turn, so `mpd_role_spawn` is never CALLED, and `MISSING_CREDENTIAL` appears whether the
deny list is valid or broken. Measured by the captain: a fresh run of `bun skills/dsh-qa/scripts/readonly-deny.mjs`
reported `noDeadNameError.sawUnknownGlobalTools = false` — i.e. "no restrict error" — while the plugin tree was in
fact CRASHING during apply, so no spawn path was ever reached. Read as §N2 originally read, that signature would
have "passed" a list that could not be tested at all. Any evidence of the form "we saw no restrict error, therefore
the list is accepted" is VOID.

**P2 — the sound credential-free proof is an A/B with a forced, model-free spawn.** The Reviewer's design, approved
by the captain: a probe plugin mounted through `dsh --profile mpd-headless --patch <overlay.yml>` that calls the
adapter's `spawnAgent` directly at boot (no model in the loop), twice:
  (a) CONTROL — the same exported `READONLY_DENY` array with ONE deliberately dead name appended. It MUST reproduce
      `tools.restrict() names unknown global tools …`, which proves the probe is sensitive and that child
      composition is genuinely reached;
  (b) REAL — the plugin's own exported array. It must produce NO restrict error (a downstream credential/provider
      error is the expected outcome, since restriction is evaluated before model auth).
Control reproduces the defect and the real list does not ⇒ the fix is proven credential-free and cannot be a false
positive. The probe and its overlay live under the verifier's inScope evidence directory.
The residual of §N3 is unchanged: "the spawned child actually EXECUTES a turn" stays environment-blocked and is
recorded as such, never claimed as passed.

**P3 — corollary for every member.** In-session probes remain invalid evidence in both directions (§O1), and the
falsifiable form above is the ONLY accepted credential-free proof of the deny-list fix.

---

## Q. Integration items carried forward (captain — for t10/t11)

**Q1 — the packed release mirror is STALE and refreshing it is a RELEASE decision, not part of this change.**
Verified by the captain: `dist/mpd-package/packages/mpd-bundle-plugin/client.js` is 246,267 bytes dated 18:21 while the
live `packages/mpd-bundle-plugin/client.js` is 261,792 bytes dated 20:57 — they differ, so the packed artifact no
longer matches the shipped sources. Refreshing it is `node scripts/pack-mpd.mjs` (alias `npm run pack`), which
AGENTS.md §8 defines as the release step. Nobody on this team may run it as part of the change: t11 must report it
as an explicit open item for the user to decide (a checkout install reads the live tree and is unaffected; only a
packed/tarball artifact needs the re-pack).

**Q2 — a pre-existing boot-log warning in a fresh `w` profile, not ours.** A fresh `w` profile lacks the
`agent-presets` row, so its boot log carries `patch: entry "agent-presets" not found`. This predates this change (we
touched neither the bundle patch nor `presets/`), t4 recorded it in its evidence and deliberately excluded it from
its gate assertions. t11 records it as a known, non-blocking observation — it must NOT be presented as a regression
introduced here.

**Q3 — mirror discipline confirmed.** t4 rebuilt only the live `client.js` and left `.qa-reloc/**`,
`dist/mpd-package/**` and the tracked `evidence/scan/**` copies untouched, as §M7 requires.

---

## R. Live proof: use the stub, not an inference (captain — supersedes §N2's corollary and narrows §P)

**R1 — the accepted live proof of the deny-list fix is a REAL, ANSWERING CHILD driven by a local stub.**
`skills/dsh-qa/scripts/readonly-deny.mjs` (rebuilt 21:09) starts a FRESH dsh process whose provider is a local
OpenAI-shaped stub reached with a throwaway key, and drives one `mpd_role_spawn`. No real provider credential is
needed, and the pass condition is a **created child that answers** — not the absence of an error class. This is the
strongest evidence this environment admits and it replaces every weaker reading below.

**R2 — a credential error proves NOTHING about the deny list (supersedes §N2's corollary).** §N2 (captain) reasoned
that `tools.restrict()` runs at child composition, before model authentication, so a `MISSING_CREDENTIAL` outcome
would prove the list was accepted. The Reviewer challenged it, the captain reproduced the resulting false positive
(a probe reported "no restrict error" while the plugin tree was in fact crashing), and the updated AGENTS.md §12 row
states the opposite ordering — authentication before child composition. Neither ordering was measured by this team,
so DO NOT reason from an error class at all: either the child runs and answers (R1), or the criterion is recorded as
unproven with the raw output. §P's A/B forced probe remains a valid way to show sensitivity, but it is no longer the
preferred method and must not be presented as equivalent to R1.

**R3 — `verify-vendor` must be green before delivery, and `skills/**` editors own its fingerprint.** Measured RED by
the captain: `[verify-vendor] FAIL - asset skills treeSha mismatch`, caused by `skills/dsh-qa/scripts/readonly-deny.mjs`
(21:09:52) and `skills/dsh-qa/SKILL.md` (21:10:47) being edited after `VENDOR_LOCK.json` was last written (20:46:31).
The remedy is NOT a revert (§O3 already acknowledges the baseline change): recompute the `skills` `treeSha` with the
gate's own LF-normalising algorithm in the same change, then show the gate green. Whoever next edits anything under
`skills/**` must refresh that fingerprint in the same unit of work — this must never be left red across tasks.

---

## S. Landmark result and the negative-control caveat (captain — binding for t6/t9/t11)

**S1 — the deny-list fix now has a PASSING live proof on the real harness.** `bun skills/dsh-qa/scripts/readonly-deny.mjs`
exits 0 with a REAL, ANSWERING CHILD driven from a FRESH process (recorded: `spawnDriven: true`, `stubCalls: 4`,
`positiveOk: "the seven-name list reached tools.restrict() and the harness accepted it: the child was created and
answered, with no unknown-tool refusal"`, `isolation.realWorkmateUntouched: true`). Because `tools.restrict()` runs
inside the child's setup, a rejected list means NO child — so a created, answering child is proof, and the same run
independently confirms the boot repair (a tree whose apply aborts cannot create a child at all). This satisfies §R1.

**S2 — the NEGATIVE CONTROL IS NOT REPRODUCIBLE HERE, and no review may require it.** The probe's own
`reinjectionDiagnostic` reports `refusalSeen = false` when the two dead names are re-injected: in this deployment the
`tools.restrict()` refusal does not reproduce even with the pre-fix list, which matches the §L/§R finding that the
harness validates against `view(scope).restrictableNames` and that this scope differs between a long-lived session
and a fresh sandbox boot. Consequences:
  - The captain's ORIGINAL in-session measurements remain the only reproduction of the refusal on record (two raw
    `tools.restrict() names unknown global tools "str_replace_editor", "apply_patch"` errors) and are cited as such,
    clearly labelled as a long-lived-host/scope observation, not as something a fresh process reproduces.
  - **CORRECTED, and this correction is important: the criterion is NOT unsatisfiable.** The captain wrote
    "unsatisfiable" here and was wrong — t9 measured it. Falsifiability holds through the case's load-bearing
    assertion, which is EXACT EQUALITY of the filter actually sent against the seven-name expectation
    (`JSON.stringify(filterSent.deny) === JSON.stringify(EXPECTED_DENY)`), and the pre-fix baseline (HEAD) ships NINE
    names including both dead ones. So with pre-fix code the comparison is 9 vs 7 and the case FAILS, and the negative
    lane proves the lane really REACHES that assertion (child created, filter sent). What is non-reproducible is only
    the REFUSAL route (§S2's actual observation) — not the case's ability to detect the defect. Nobody may cite §S2 to
    claim the case cannot detect the defect it does detect.
  - The refusal mechanism itself (whole-list validation, fail-fast before the child exists) is established from the
    harness source — `dsh-tools/lib/index.js:2802-2804` validating the entire list, and `:2863-2881` deriving the
    restrictable set from the view scope — which is where the root cause belongs in the report.

**S3 — the P1 boot repair is closed and independently corroborated.** t12 recorded a fresh-process APPLY proof
(`evidence/workmate/rename-delete-core/20260910T131805Z-t12/apply-boot.log`): 0 occurrences of `unsupported JSON
schema` / `JsonSchemaError` / `plugin tree failed to load` / `failed to apply loader entry`, with the rows' own
apply-time lines present. s1's answering child corroborates it. No `--dump-config` result is cited as load evidence
anywhere in the delivery (§N1 correction).

---

## T. Ownership of the last two files, and a correction on the vendor gate (captain)

**T1 — `skills/dsh-qa/SKILL.md` and `VENDOR_LOCK.json` belong to t10 (the Lead), with explicit captain
authorization.** t5 completed correctly by refusing to widen its own inScope, which leaves both files unowned:
`SKILL.md` carries the `readonly-deny` case-table row and `VENDOR_LOCK.json` carries the `skills` fingerprint that
adding a case necessarily changes. t10 already owns `skills/dsh-qa/SKILL.md`, and it is the LAST writer of `skills/`
in this delivery, so it must refresh the `skills` `treeSha` with the gate's own LF-normalising algorithm **in the same
unit of work as its skills edits** (§R3). `VENDOR_LOCK.json` is outside t10's declared inScope: that deviation is
PRE-AUTHORIZED here (same class as §O3/§O4) and must not be reported as a scope breach. Note the case-table row was
rewritten for the stub method at 21:10 and the case file itself at 21:21, so any earlier description of the old live
method is stale — the row must describe the CURRENT method.

**T2 — CORRECTION: `verify-vendor` IS STILL RED.** Measured by the captain in the working tree after t5 was marked
complete: `node scripts/verify-vendor.mjs` → exit 1, `[verify-vendor] FAIL - asset skills treeSha mismatch`
(`skills` 364 files), with `VENDOR_LOCK.json` mtime 20:46:31 against `skills/dsh-qa/scripts/readonly-deny.mjs`
21:21:52 and `skills/dsh-qa/SKILL.md` 21:10:47. t5's completion record cites the gate as PASS; that is not true in
the working tree, and this is the third time a member's gate result has come from a sandbox/worktree copy rather than
the delivery tree. Treat any "verify-vendor PASS" claim as unverified until it is reproduced in
`/root/dshProj/my-power-dsh` with the lock's mtime shown. The gate is NOT red because the fix is wrong — it is red
because the fingerprint lagged the corpus, and §T1 assigns the repair.

**T3 — the AGENTS.md §12 row was reverted by its author and that is ACCEPTED.** t5 had added a defect-class
troubleshooting row to `AGENTS.md`; because `AGENTS.md` is in t5's declared outOfScope and another actor is editing
that file concurrently, its author reverted the row rather than rely on a verbal acceptance. Honouring the written
contract over a verbal override is the correct call, so the revert stands. Consequence to record: the defect-class
knowledge lives in the QA case header, in this contract (§G, §N, §R, §S) and in the delivery report — not in the
manual. Note also that `AGENTS.md` was rewritten by another actor twice during this session (its adopted-plugin
version note and the sidebar-fallback policy both changed under us), so nobody on this team should treat a cached
copy of it as current.

**T4 — t5's completion is accepted with its residual.** The live lane is proven by §S1 (fresh process, stub-driven,
created answering child, instrumented adapter recording the seven-name list). The two unprovable halves are recorded,
not hidden: the pre-fix refusal is not reproducible in this deployment (§S2) and the child-side write refusal remains
a FOLLOW-UP ITEM (under the stub the child's request carries no tools array). Recorded residual: "a spawned child
executes a turn against a REAL provider" needs `DEEPSEEK_API_KEY`; the case itself needs no change.

---

## U. Closure decisions on the t5 follow-ups (captain — final for these items)

**U1 — the parity-guard hardening is CLOSED WITHOUT record churn (option (b)).** `t5` is `completed`, and
`completed: []` is terminal by design, so reopening it would buy bookkeeping only. The hardening is inside t5's
declared inScope and landed during its attempt 3, so it is part of that task's work. The captain VERIFIED the shape in
the tree: `packages/mpd-roles-plugin/test/roles.test.ts` asserts `Array.isArray(workmateDeny)` BEFORE the equality
comparison, and a missing or renamed export now FAILS the test (the remaining `console.warn` is a diagnostic printed on
the way to failing, never a disengage). Execution proof supplied by the author: with the export removed
10 pass / 1 fail at the new assertion; with it present 11 pass / 0 fail / 140 expect calls. The stale docstring that
still described the old skip behaviour was rewritten in the same change — a comment documenting a disengage path that
no longer exists is exactly the drift trap this guard exists to prevent. t9, t10 and t11 cite this instead of waiting
for a new t5 attempt.

**U2 — `skills/dsh-qa/SKILL.md` is CURRENT, not stale.** Correcting the author's own note: the captain read the
`readonly-deny` row in `skills/dsh-qa/SKILL.md` and it already describes the CURRENT method — a local OpenAI-shaped
stub answering the PARENT model step with one `mpd_role_spawn` call in a FRESH dsh process with a throwaway key, with
the pass condition being a created, answering CHILD plus the absence of the harness refusal, and with the two traps
(`--dump-config` is not a health signal; an in-session call cannot prove this fix) stated inline. t10 must NOT
"correct" it as stale; only extend it if t10's own edits change the method. The only genuine outstanding item in that
file's neighbourhood is the `skills` fingerprint refresh (§T1).

**U3 — the withdrawn recipe is formally void.** Nothing in the delivery may repeat
"MISSING_CREDENTIAL instead of the restrict error proves the list was accepted" (§R2, §P2). "Restrict error absent"
alone proves nothing; the accepted proof is the stub lane (§S1) where the parent really reaches the spawn, the
instrumented adapter records the shipped seven-name list being handed to `tools.restrict()`, and the CHILD's own model
request follows it — a rejection there would mean no child at all.

---

## V. Corrections that supersede earlier sections (captain — read before citing §N1(i) or §O4)

**V1 — L1 IS CLOSED: one shape everywhere, and `oneOf` is now MEASURED-accepted. §N1's item (i) is SUPERSEDED.**
§N1(i) told t10/t11 to document a wart: the delete TOOL returning `archived: ""` on purge while the §D HTTP body and
the service returned `null`. That split no longer exists. Current bytes (captain-verified): the schema is
`archived: { oneOf: [{ type: "string" }, { type: "null" }] }`, the tool returns the service's `null` VERBATIM, and
tool + service + §D body share one shape; 0 `type: ["…"]` arrays in src or dist; package suite 26 pass / 0 fail /
315 assertions. Two consequences: (a) t10/t11 must NOT document a shape split that is gone — §N1(i) is withdrawn as a
documentation item; (b) the `oneOf` form was proven by BOOTING (the mount boot carried that schema with 0
apply-crash signatures), which closes §N1's "prove it by booting, do not assume" requirement with a measurement
rather than an inference. Only the `type: […]` ARRAY form is rejected by this harness; `oneOf` is accepted.

**V2 — additions that landed after a task went terminal are CLOSED WITHOUT RECORD CHURN.** Both instances were inside
the task's declared inScope, on current bytes, with evidence on disk: t5's parity-guard hardening (§U1) and t12's L1
normalization plus mount proof (this section). Terminal records (`completed: []`) are not reopened for bookkeeping,
and no follow-up task is created for them. Reviewers cite the evidence paths, not a phantom new attempt.
**COROLLARY, now proven by the tool itself (§9 effect):** a COMPLETED task is IMMUTABLE —
`agent_teams_reassign_task` answers `Error: completed task <id> is immutable and cannot be reassigned`. A FAILED task
CAN be reopened by the captain (that is how t5 reached attempt 3), but a completed one cannot be reopened by anyone.
Consequence for any future session: never spend turns asking for a completed task to be reopened; record the
correction in the deliverable's evidence + this document instead, which is what t5's `completion.md` does.

**V3 — `VENDOR_LOCK.json` provenance, corrected and non-revertible.** The pre-existing baseline did not merely hold a
MODIFIED lock — it held a STALE COUNT: HEAD recorded `skills` fileCount 361 while the tree already held 364 files
(two new QA cases had grown the corpus), which is why the gate first went red on
`asset skills count drifted: 364 vs 363` and then on `treeSha mismatch`. The refresh to count 364 plus a matching
`treeSha` is therefore PART OF THIS DELIVERY and must NOT be reverted — reverting it turns the gate red again. It is
outside t5's declared inScope, so it is not in t5's changedPaths; it is assigned to t10 (§T1) and acknowledged here
under §9. **Standing rule:** any "verify-vendor PASS" claim is only valid if the lock's mtime is NEWER than the newest
file under `skills/**`; a PASS measured before a later `skills/` edit is stale by construction. Measured state at the
time of writing: lock 20:46:31 vs `readonly-deny.mjs` 21:21:52 and `SKILL.md` 21:10:47 → the gate is RED until t10
refreshes it.

**V4 — §O4 is narrowed: the out-of-scope path list belongs to a REJECTED DRAFT, not to t5's landed attempt.**
t5's first submission was refused by the validator with `7 changed path(s) not covered by inScope` (`AGENTS.md`,
`skills/dsh-qa/SKILL.md`, `VENDOR_LOCK.json`, four `evidence/fix/readonly-deny/**` artifacts). Its author then
reverted the `AGENTS.md` edit (that file is explicitly in t5's outOfScope) and relocated the evidence to the declared
`evidence/workmate/roles-readonly/`, and the LANDED attempt carries none of those paths. Reviewers must not attribute
them to t5's completed record. The genuinely unowned files after all of this are exactly two — `skills/dsh-qa/SKILL.md`
and `VENDOR_LOCK.json` — and both belong to t10 (§T1). Nothing else in §O4 changes: honouring the written contract
over a verbal acceptance was the correct call, and the revert stands.

---

## W. §P's control is dead; the accepted proof and one open question (captain — binding)

**W1 — §P's A/B CONTROL REQUIREMENT IS SUPERSEDED; it does not reproduce in this deployment.** §P required a control
that appends one deliberately dead name to the real list and MUST reproduce
`tools.restrict() names unknown global tools …`, to prove the probe is sensitive. Measured twice by the area owner and
never once reproduced: (a) the two unregistered names re-injected into a sandbox copy of the built plugin — delivery
proven, `filterSent` recorded them — still produced a CREATED child and a silent harness; (b) the identical probe
against a pristine `f697088` worktree, whose list contains BOTH dead names, likewise produced a created child with no
refusal. Consequences, all binding:
  - No member may require the control to reproduce the refusal, and no reviewer may score that absence as a failure.
  - A SILENT CONTROL MUST NEVER BE READ AS A PASS. That is precisely the false positive the captain reproduced (§P1):
    a probe reporting "no restrict error" while the tree was crashing and nothing had registered.
  - If anyone still builds an A/B for other purposes, the control must FIRST be shown to fail on its own, using a name
    provably absent from `view(scope).restrictableNames` AT THAT MOMENT in that profile. Otherwise do not build it.

**W2 — the accepted proof is unchanged and stands alone: §S1.** A fresh process where a local OpenAI-shaped stub
drives one `mpd_role_spawn` with a throwaway key, the instrumented adapter records the shipped seven-name list really
being handed to `tools.restrict()` (`filterSent`), and the CHILD is created and ANSWERS — with exit code 0 AND
`filterSent` BOTH required. That conjunction is what excludes the false positive, because a tree that fails to apply
yields neither; the mere absence of an error is not evidence in either direction (§U3).

**W3 — OPEN QUESTION (record it; do not turn it into a task).** The evidence points at a mechanism worth naming:
`restrict()` appears NOT to throw when the scope's tool registry is empty or the tools service is absent. That single
hypothesis explains all three observations — the captain's false positive (crashing tree, no tools registered, no
restrict error), and both silent controls. If any member can settle it cheaply against
`dsh-tools/lib/index.js:2802-2804` / `:2863-2881` (already cited in §S2), record the answer here for the next
maintainer. It is optional and must not delay any verdict.
**ANSWER (measured, twice refined — this is the final version):** two facts settle it, and the second one kills §P
as a design rather than merely showing it failed here.
  (a) `restrict()` is NOT silent on an empty registry: `dsh-tools/lib/index.js:2802` computes
      `known = this.view(scope).restrictableNames`, filters the WHOLE list into `unknown`, and throws listing
      `known global tools: … || "(none)"`. So silence means `restrict()` was never reached at all — it is not a
      tolerant guard, and emptiness is not tolerated.
  (b) The sandbox/headless profile GENUINELY REGISTERS `str_replace_editor`: its own composed tree contains
      `- id: tool-str-replace-editor` (evidence: `dump-config.txt:556-557`), and a fresh sandbox boot reported
      `hasTool("str_replace_editor") === true`, while the real session's `restrict()` view does not know that name.
  ⇒ A §P-style control is UNSOUND BY CONSTRUCTION in any profile that mounts that row: the "dead" name is alive
  there, `restrict()` legitimately accepts it, the child is composed and the harness stays silent — which is exactly
  the §S2 observation. This is PROFILE DEPENDENCE, not a guard. Therefore: §P stays superseded, §S1 (fresh process,
  created answering child, `filterSent` recording the shipped list, exit 0) is the only accepted live proof, and the
  silence must never be read as either a pass or a failure. Corollary for reviewers: `dsh.hasTool` is not a proxy for
  the `restrict()` view either — it answered `true` for a name the deployment's restrict view does not know.

**W4 — the profile BOOTS; no member may say otherwise.** `packages/mpd-workmate-plugin/src/index.ts` and its dist
carry 0 `type: ["…"]` arrays (captain-verified three times, over three separate turns), and t12 is complete with a
MOUNT proof: 7/7 workmate tools register by name, `WORKMATE_LIST_CALL=ok`, and a live `mpd_workmate_delete` refusal
returns the exact §D text with 0 apply-crash signatures. Any sandbox patch that still neutralises that row is stale
scaffolding, and any report describing the profile as unable to apply is describing a state that no longer exists.

---

## X. Fresh-boot proof on the REAL profile, and one latent landmine to document (captain)

**X1 — the fresh-boot half is now PROVEN on the real, UNMODIFIED profile, and the workaround that could have hidden
this defect class has been removed.** The case previously deleted the `mpd-workmate` row from its sandbox profile
(because that package's schema aborted apply), which meant the probe could have kept "passing" while the tree died.
That workaround is gone and the case now FAILS if the row is absent. Measured on the real profile: 0 loader-apply
errors (no JsonSchemaError, no `plugin tree failed to load`), the run stopping only at the credential gate
(`MISSING_CREDENTIAL`), and the case PASSING with the stub-driven child answering — `filterSent` recording the seven
shipped names and the stub trace showing the CHILD's own request (`call#2 hasTools=false`) between the parent calls.
INDEPENDENT CORROBORATION that this is not a stripped-down profile: the parent's first request grew from ~105.7 KB to
~110.7 KB, which is exactly the extra tool surface the now-applying `mpd-workmate` row registers. Removing a
workaround is the opposite of moving a goalpost — it is what makes the passing result trustworthy.

**X2 — this is CLOSED WITHOUT RECORD CHURN, by the §V2 rule.** The workaround removal and the fresh-boot run sit inside
t5's declared inScope (`skills/dsh-qa/scripts/`, `evidence/workmate/roles-readonly/`), with evidence on disk at
`evidence/workmate/roles-readonly/2026-09-10T13-28-17.170Z/`. No re-open, no follow-up task; t9/t10/t11 cite the
evidence path. The only residual left on t5 is credential-bound and stated: "a spawned child executes a turn against a
REAL provider" needs `DEEPSEEK_API_KEY`; the case needs no change. Note the refinement: that residual is now purely
the missing key, NOT a broken tree (the apply failure is gone).

**X3 — LATENT LANDMINE to RECORD, not to fix here.** `packages/mpd-hashline-plugin/src/index.ts:110` declares
`lines: { type: ["string","array"] }` in tool PARAMETERS, and that ships in its dist. Measured: a real boot composes
that row with 0 loader-apply errors, so this harness evidently does not validate parameter schemas the way it validates
output schemas (consistent with the validator error text naming only output-schema paths). It is therefore harmless
TODAY and out of this change's scope — but it is one harness release away from aborting the whole tree the same way, so
t10/t11 must record it as a known latent issue with the measurement, and it must NOT be silently "cleaned up" inside
this delivery. If the user wants it fixed, it belongs in its own scoped change with its own boot proof.

**X4 — the delete shape is settled; do not cite the sentinel variant.** §V1 stands: the schema is
`archived: { oneOf: [{type:"string"},{type:"null"}] }`, the tool returns `null` verbatim, and tool/service/§D body share
one shape. Any description of an `""` sentinel at the harness boundary describes an intermediate state that no longer
exists.

---

## Y. Captain-verified live proof, and the exact vendor-gate repair (binding, final)

**Y1 — the captain re-ran the live proof and it PASSES on the delivered bytes.** Executed by the captain (not reported
by a member): `bun skills/dsh-qa/scripts/readonly-deny.mjs` → **PASS**, evidence
`evidence/workmate/roles-readonly/2026-09-10T13-29-40.990Z/`, with `spawnDriven: true`, `stubCalls: 4`, `exit 0`,
`restrictError: false`, and the stub trace showing the parent's first request (`hasTools: true`), the CHILD's own
request (`hasTools: false`), then the parent again — i.e. the child really ran a turn against the stub. `positiveOk`:
"the seven-name list reached tools.restrict() and the harness accepted it: the child was created and answered, with no
unknown-tool refusal"; `isolation.realWorkmateUntouched: true`; and the re-injection lane reports
`refusalSeen = false` with the unregistered names recorded in `filterSent`, confirming §S2/§W1 (the refusal is not
reproducible here, so the positive lane carries the proof). t9/t10/t11 may cite THIS run as captain-verified.

**Y2 — the vendor-gate repair is a ONE-LINE change owned by t10; reviewers must not misattribute the red.** Exact
measured values (supplied with provenance, no recomputation needed):
  - **DO NOT APPLY EITHER HASH — BOTH ARE SUPERSEDED, and this warning was earned.** The owner recomputed the lock
    again (twice: once after a comment-only edit re-red the gate), so the value quoted above and the `e51fb02a…`
    replacement are both historical. A hash pasted from a message must NEVER be written into `VENDOR_LOCK.json`:
    two hand-derived digests were already rejected by the gate, and a stale one would simply re-red it. t10 must
    RECOMPUTE with the gate's own `readBytes`/`listFiles` helpers and then confirm with the two authoritative checks —
    `node scripts/verify-vendor.mjs` exiting PASS and `find skills -newer VENDOR_LOCK.json -type f` printing NOTHING
    (§Z5). If the gate is already PASS at that moment and nothing under `skills/` has moved since, NO refresh is needed
    at all; the correct action is none.
  - `fileCount` stays **364** in both — this is content drift, not a file addition or removal, so a refresh touches
    only the `treeSha` (and only when the gate actually reports a mismatch).
  Provenance, stated honestly by the owner: `VENDOR_LOCK.json` was dirty in the 33-entry pre-existing baseline AND its
  content was stale (HEAD recorded 361 files against a tree of 364); the owner refreshed it early (the gate went green
  at ~12:54) and then edited two tracked skills files — the `readonly-deny.mjs` case header and the `SKILL.md`
  case-table row — without re-fingerprinting. So the drift is the owner's own follow-up edit, not a pre-existing
  condition and not t3's.
  DECISION: option (b) — the refresh stays with t10/t11 (§T1), which already own the §9 baseline acknowledgement.
  t5 is NOT reopened for a one-line out-of-scope edit; that is exactly the audit noise this contract has been removing.
  **t10 must land it before t11's final sweep**, and t6/t9 must treat a red `verify-vendor` as this known fingerprint
  lag rather than as a finding against the deny-list fix (that is why §T2 exists).

---

## Z. t9's verdict, the ANSWER to §W3, and the case gap it exposed (captain — final)

**Z1 — t9 PASSED, and read-only ENFORCEMENT is now measured, not assumed.** The reviewer traced the mechanism in the
harness source (the filter reaches `childCtx.tools.restrict(composition.toolFilter)` at `dsh-subagent/lib/index.js:711`;
`dsh-tools/lib/index.js:2804` throws for names outside the scope's restrictable set) and then MEASURED the guarantee
with its own instrumented copy of the QA case, recording each model request's tool NAME SET: the spawned read-only
CHILD's request carries 81 tools with **none** of the seven write-capable names, while the PARENT's carries all seven
of 87. So the property the fix exists for — a read-only child cannot see the write-capable tools — is ENFORCED on the
shipped bytes. Verdict: 0 blocker, 0 high, 1 medium (F1), 2 low (F2, F3).

**Z2 — §W3's open question is ANSWERED, and the answer changes how the defect class must be described.** The measured
pre-fix failure mode in a FRESH process is **SILENT UN-GUARDING**, not the loud `unknown global tool` refusal the
earlier text described: with the unregistered names present, the child is composed with the FULL tool set and no
refusal is emitted. That single fact explains all three earlier mysteries — the captain's in-session loud error (a
populated scope registry rejecting an unknown name), the two silent controls, and the false positive reproduced while
the plugin tree was crashing (nothing had registered, so nothing was restricted and nothing threw). Consequences:
  - The contract's earlier framing (§G/§R/§S) is correct about the FIX but incomplete about the PRE-FIX SYMPTOM.
    t10/t11 must describe BOTH modes, citing `dsh-subagent/lib/index.js:711` and `dsh-tools/lib/index.js:2804`.
  - The loud refusal remains the mode the captain measured in-session; it is not the only one, and it is not the one a
    fresh process exhibits.

**Z3 — F1 is being closed by t13, not waved through.** The shipped case asserted that the seven-name list was SENT,
not that the CHILD was restricted; with the pre-fix names re-injected the reviewer measured the child receiving the
full 87-tool set while the case stayed GREEN — the silent-degradation route that acceptance 4 is supposed to exclude.
t13 (assigned to Deep Worker, the case's owner) makes the case assert the child's visible tool set using the reviewer's
already-proven recipe, requires the assertion to be falsifiable, and aligns the case's wording and evidence path.
`evidence/workmate/rename-delete-core/probe-enforce.mjs` is the reference implementation — READ it, never modify it
(it is another member's evidence).

**Z4 — the canonical evidence path is `evidence/workmate/roles-readonly/<timestamp>/`.** §R1's earlier reference to
`evidence/fix/readonly-deny/` is SUPERSEDED (that slug was a rejected draft's path; t5 relocated its evidence to the
declared path). t10/t11 must cite the declared path only, and the older `evidence/fix/**` directory is not part of the
delivery.

**Z5 — fingerprint-refresh TRAP, and the freeze rule (for t10).** The gate hashes each file under the path
`f.slice(dir.length + 1)` where `dir` is the ABSOLUTE skills path; re-deriving the algorithm by slicing on the literal
length of `"skills"` produces a DIFFERENT digest that the gate rejects — the owner produced two rejected values
(`81620614…`, `e51fb02a…`) before extracting `readBytes`/`listFiles` VERBATIM from `scripts/verify-vendor.mjs` and
getting `ded0b340f2d898b862a5447cdb7edae22fe0d1acfbb975180279c20ec4367aab` accepted (fileCount 364). Anyone refreshing a
fingerprint must use the gate's own helpers, never a re-implementation. Current state: `verify-vendor` PASSES on the
present content of `skills/`, which carries 5 modified and 3 untracked files — so **any further edit under `skills/`
re-reds the gate**, and t10 must re-run the refresh with the gate's helpers as the LAST skills edit before t11's sweep.
**FOLLOW-UP (measured, supersedes any hash value quoted in this document):** the lock was recomputed again after a
comment-only edit re-red it, so the accepted `skills` treeSha is now `ca9dfa77663f26c1cd05e832bb17ae744ab5852aba80acffb3dab0754f5cb1ba`
(with the earlier `81620614…`/`e51fb02a…`/`ded0b340…` all superseded), `fileCount` 364. Do not treat any hash printed
here as authoritative: the authoritative checks are (1) `node scripts/verify-vendor.mjs` exiting PASS and (2)
`find skills -newer VENDOR_LOCK.json -type f` printing NOTHING — the latter is the stability proof the owner supplied
and the captain verified (empty). Any edit under `skills/`, even a comment-only one, invalidates both.

---

## AA. Final items for t10/t11 (captain — from t9's review and two retractions)

**AA1 — `verify-vendor` IS GREEN; the earlier "still red" line is RETRACTED and must not appear in the report.** Its
owner refreshed the `skills` fingerprint and the gate now exits PASS (commit OK, stats OK, all eight assets OK;
`fileCount` 364; treeSha `ded0b340f2d898b862a5447cdb7edae22fe0d1acfbb975180279c20ec4367aab`). The honest audit line,
retracted independently by the member who filed the red twice: `VENDOR_LOCK.json` was dirty in the pre-existing
baseline AND its content was stale (HEAD recorded 361 files against a tree of 364, grown by two new QA cases), so
refreshing it is PART OF THIS DELIVERY and is not a revert candidate. §V3's standing rule still applies: a PASS is only
valid while the lock is newer than the newest file under `skills/**`.

**AA2 — AGENTS.md ACTIVELY RECOMMENDS THE CHECK THIS DELIVERY DISPROVED. t10 must fix it.** Reverting t5's row was
scope-correct, but it restored the manual to HEAD, so the two places that matter now teach the wrong thing:
  - `AGENTS.md:150` — the §4 gate table lists `Boot check | dsh --profile headless --dump-config` (isolated DSH_HOME);
  - `AGENTS.md:247` — §7 says "Provability: assert `--dump-config` rows, or assert real tool results".
Measured contradiction, in this delivery's own record: a full `mpd` profile with the schema union temporarily back in
`dist` returned **exit 0 with the row present** from `--dump-config`, while the REAL boot on the same profile exited 1
with `JsonSchemaError … plugin tree failed to load` — because `--dump-config` composes rows without MOUNTING them
(§N1 correction, §R2, §T2, §Z5). Required fix for t10 (it owns `AGENTS.md` in its inScope): make the boot gate a real
MOUNT/boot check (or point it at the dsh-qa cases that boot), and state that `--dump-config` proves COMPOSITION ONLY —
never a plugin load. This is a documentation defect with real cost: the manual is what the next agent reads cold, and
as written it would re-create exactly the blind spot that hid the P1 here.

**AA3 — residual wording for t11's report, with the nuance measured by t9.** "A spawned child executes a turn" is not
fully unmet: the stub lane DOES drive the child's own model request (its request carried 81 tools with none of the
seven write-capable names) and answers it, which is why `spawnDriven: true` and why the case passes. What remains
genuinely outside this environment is a turn against a REAL provider — impossible for any member here (no credential
reachable, §N3). Report it in exactly those two parts; do not write "the child never ran".

**AA4 — F1 remains the only open proof-strength item, and t13 owns it.** t9 measured the gap (with the pre-fix names
re-injected the child receives the full 87-tool set with no refusal while the case stays green) and proved the fix
recipe (child's request = 81 tools, none of the seven write-capable; parent = 87 with all seven). t13 makes the case
assert enforcement, requires the assertion to be falsifiable, corrects the F2 wording (the fresh-process pre-fix mode
is SILENT UN-GUARDING, not a loud refusal — §Z2, which also answers §W3) and aligns the F3 evidence path (§Z4).

---

## AB. Two final corrections for the record (captain — binding)

**AB1 — §S2's falsifiability MECHANISM was stated wrongly by the captain; the effect is right.** §S2 now says the
pre-fix criterion is falsifiable "because HEAD ships NINE names". That conclusion happens to hold but the reason is
wrong: the case boots the WORKING TREE's built dist, not HEAD, so HEAD's file content is not the trigger. The real
mechanism, measured on t13's own run data, is the case's **exact-equality assertion on the list the adapter hands over**:
the positive lane's `filterSent.deny` is exactly the seven names (passes the check), while the **re-injection lane's
`filterSent.deny` is the NINE-name list**, which would fail that same check. So the case is falsifiable on the LIST,
and — since t13 — independently falsifiable on ENFORCEMENT (the child-side tool set, 81 tools with none of the seven,
versus the full 87 in the control lane). **Two guards, each demonstrated with data.** Nobody may cite "HEAD has nine
names" as the mechanism.

**AB2 — `skills/dsh-qa/SKILL.md`'s `readonly-deny` row is STALE and t10 must correct it.** The row still describes the
method t13 replaced (a completed child whose answer carries a sentinel / the old live method). The current method is:
a per-request **tool-name-set** assertion — the positive lane must show the child's own request excluding all seven
write-capable names while the parent's includes them, and the control lane must show the assertion FAILING when the
pre-fix names are re-injected — with the measured failure mode stated as **silent un-guarding**, not a loud refusal.
t10 owns that file (§T1), so this is its item; the owner deliberately left `skills/**` untouched.

**AB3 — the fingerprint constant has gone stale THREE times in this delivery; stop naming constants.** `81620614…` →
`e51fb02a…` → `ca9dfa77…` → t13's `2c11c7a9233182c9f22e74e013aef2a66b31fe1650852ac45f6c8c19c5fef280` (fileCount 364).
Any value printed anywhere in this document is illustrative history. The ONLY authoritative procedure is: recompute
with the gate's own `readBytes`/`listFiles` as the LAST action after the last `skills/**` edit, then confirm
`node scripts/verify-vendor.mjs` exits PASS and `find skills -newer VENDOR_LOCK.json -type f` prints nothing. t16
performs exactly this refresh (the gate is RED as of the captain's last measurement, because t13's case edit changed
the corpus while `VENDOR_LOCK.json` was outside t13's declared inScope).
