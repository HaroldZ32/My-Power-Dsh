# t6 — Independent verification of workmate rename + delete (and the read-only deny fix)

Timestamp: `2026-09-10T13-24-03.000Z` · Verifier: Reviewer · Attempt `5c9d56a8-cf24-402f-969d-0e50c2caa5f7`

## Verdict: FAILED — two blocking findings (F1, F2)

Everything below was reproduced from the real artifacts: a real `dsh` web boot and real `dsh`
headless boots in sandboxes (`DSH_HOME` and `HOME` both `mktemp`), the built `dist/` bytes, the
binding gates, and the sandbox filesystem. The implementers' summaries were not trusted.

Baseline (unchanged by this task): HEAD `f69708809ed63a57461aa6730d297afc09e772a3`,
`git status --porcelain` = 65 entries before and after; my only delta is this untracked directory.

## F1 (blocker) — both NEW agent tools are rejected by the harness output validator

`mpd_workmate_rename` and `mpd_workmate_delete` return `{ ok: true, ... }`, but their declared
`output.schema` sets `additionalProperties: false` and does not declare `ok`. The harness therefore
rejects the tool call:

```
tool "mpd_workmate_rename" returned invalid output: "value.ok" is not a declared property (additionalProperties: false)
tool "mpd_workmate_delete" returned invalid output: "value.ok" is not a declared property (additionalProperties: false)
```

**The mutation still happens** — that is the hazard: the caller is told the call failed while the
workmate has already been renamed/archived/purged, so a retry hits an unknown key or a collision.

| call | harness result | filesystem effect |
|---|---|---|
| `mpd_workmate_rename probe-a → probe-b` | rejected | renamed (`service.get("probe-a") === null`, `renamedFrom=["probe-a"]`) |
| `mpd_workmate_delete probe-b` (archive) | rejected | archived to `.archive/probe-b-<stamp>/` |
| `mpd_workmate_delete probe-c --purge` | rejected | purged (directory gone) |
| `mpd_workmate_init` (control) | accepted | created |
| `mpd_workmate_reflect` (control) | accepted | memory written, `uses` bumped |

The HTTP routes are **not** affected (they bypass the tool-output validator), which is why the
route matrix passes 59/59 while the agent surface is unusable. Owner: t3.

Evidence: `result-focused.json` (`FINDING.*`, `hazard.*`, `control.*`).

## F2 (blocker) — `node scripts/verify-vendor.mjs` is RED on the integrated tree

```
[verify-vendor] FAIL - asset skills treeSha mismatch
```

`VENDOR_LOCK.json` was refreshed at 20:46:31, then `skills/dsh-qa/SKILL.md` (21:10:47) and
`skills/dsh-qa/scripts/readonly-deny.mjs` (21:21:52) changed. File count matches (364 both);
content drifted. Locked `81620614…`, current aggregate `75ae0f79b0a66170ecd6f74463ebfa63e573fa0715022e1059dd1d883647f5f5`.
Owner: whoever holds the skills corpus (t5). Evidence: `gate-vendor-final.log`, `gate-vendor.log`.

## F3 (medium, method limit) — the credential-free deny proof was NOT independently reproduced here

A boot-time probe cannot create children: `dsh.spawnAgent` without an agent context dies with
`Cannot read properties of undefined (reading 'aborted')` for every variant, so the A/B control
never reached `tools.restrict()` and the probe is recorded as **inconclusive, never a pass**.

A second would-be substitute also proved unsound: `dsh.hasTool` is **not** a faithful proxy for the
`restrict()` view. In the hand-built sandbox profile it reported `str_replace_editor` as registered
while the deployment's `restrict()` view does not know that name — exactly the G-warning that
`hasTool` reads the GLOBAL view only. Recorded so nobody reuses `hasTool` as evidence for this fix.

What the deny fix therefore rests on: the static artifact checks verified here (both arrays are the
identical seven live names in `src` **and** built `dist`; neither dead name appears anywhere in a
live path; `read`/`glob`/`grep` remain undenied) plus t5's end-to-end stub evidence (fresh process,
child created and answered), which this task did not independently re-run.

## What VERIFIED CLEAN

- **Routes + lifecycle (59/59, `result.json`)** — real sandboxed web boot driven over HTTP:
  - `§D` matrix: 200 success, `405 + allow: POST` on the wrong verb, 400 invalid JSON,
    400 `invalid-name`, 404 `unknown`, 409 `collision`, 409 `in-use`, 400 `confirm-required`;
    JSON + `cache-control: no-store` on every response; no `$HOME` path in any error body.
  - `oracle-1 → oracle-2`: old key freed, new key resolves, persona/memory bytes preserved,
    `uses`/`createdAt` preserved, `meta.name` mirrors the directory key, `renamedFrom` recorded,
    note self-reference rewritten, `list`/`index.json`/filesystem agree immediately.
  - delete: archives by default into `$HOME/.mpd/workmate/.archive/<key>-<stamp>/` (restorable
    instance with meta/persona/memory/note), repeat delete 404, purge needs the exact `confirm`,
    purge removes the instance and leaves no archive copy.
  - negatives: empty / `Alice` / CJK / `a/b` / `..` / `.archive` / punctuation-only / 300-char
    names all 400 `invalid-name` with the library root untouched; unknown names 404 with zero side
    effects; orphan directory (no `meta.json`) 404 untouched; symlinked instance refused;
    in-use refusal names the blocking team **and** member (17 stale records enumerated).
  - isolation: the real `~/.mpd/workmate` library is byte-identical before and after
    (`sha ce635a4d…`, 5 files) and the real `~/.dsh` was never written.
- **Tool/service path positives (`result-focused.json`)** — rename preserves `uses`/`createdAt`,
  `renamedFrom` survives a reflect and is exposed by `service.get`, the stale key stays dead after
  reflect, `confirm-required` is enforced at the tool level.
- **Gates**: `bun test packages` exit 0 (291 tests, 0 fail), `bun run typecheck` exit 0,
  `bun run test:qa` exit 0 (all self-tests), `dsh --profile mpd-headless --dump-config` in an
  isolated `DSH_HOME` exit 0 with `mpd-roles` / `mpd-workmate` / `mpd-hashline` rows present.

## Residuals (documented, not product failures)

- No provider credential exists anywhere in this deployment, so "a spawned read-only child
  EXECUTES a turn" is not exercisable here (contract §N3). Nothing in this report claims it passed.
- `§E(b)`'s in-use scan sees only the current workspace's teams while the library is cross-project,
  and a second dsh process on the same HOME can still race a mutation (§L/§M residuals).
- The tab-strip label `Workmates` stays hardcoded English by decision (§K).

## Reproduce

```bash
cd /root/dshProj/my-power-dsh
node evidence/workmate/rename-delete-verify/2026-09-10T13-24-03.000Z/verify-routes.mjs   # 59/59
node evidence/workmate/rename-delete-verify/2026-09-10T13-24-03.000Z/verify-tools.mjs    # 15/19
node evidence/workmate/rename-delete-verify/2026-09-10T13-24-03.000Z/verify-focused.mjs  # 18/19
bash evidence/workmate/rename-delete-verify/2026-09-10T13-24-03.000Z/boot-check.sh        # isolated boot
bun test packages && bun run typecheck && bun run test:qa && node scripts/verify-vendor.mjs
```

---

## Addendum (re-verification at 13:46, after the `oneOf` shape fix) — F1 STILL REPRODUCES

`verify-focused.mjs` re-run on the current tree: **F1 is unchanged**. All three SUCCESS paths still
fail the harness output validator while still applying the mutation:

```
tool "mpd_workmate_rename"     returned invalid output: "value.ok" is not a declared property (additionalProperties: false)
tool "mpd_workmate_delete"     returned invalid output: "value.ok" is not a declared property (additionalProperties: false)   # archive path
tool "mpd_workmate_delete"     returned invalid output: "value.ok" is not a declared property (additionalProperties: false)   # purge path
```

Current source confirms the premise is untouched by the `oneOf` fix: `renameWorkmate` returns
`{ok:true,…}` (`src:437`), `deleteWorkmate` returns `{ok:true,…}` (`src:467`, `src:472`), the routes
pass those objects straight to JSON (`src:778`, `src:792`), and both tool `output.schema`s set
`additionalProperties:false` with no `ok` property (`src:656`, `src:669`).

**Not contradicted by a "live delete refusal in §D text":** a REFUSAL is an error result, and the
harness validates the output schema of SUCCESS values only. Tools register (7/7) and execute — the
mutation lands every time; it is the returned value on the success path that is rejected. A t12-style
check must exercise a SUCCESSFUL rename/delete (not the confirm-required refusal) to see this.

## Addendum — why a §P-style control comes back SILENT (settled, two hard facts)

1. **`restrict()` is NOT silent on an empty/absent registry.** `dsh-tools/lib/index.js:2802`:
   `const known = this.view(scope).restrictableNames; const unknown = […].filter((n) => !known.has(n));
   if (unknown.length > 0) throw … "known global tools: " + ([...known].sort().join(", ") || "(none)")`.
   An empty registry makes EVERY entry unknown, so it throws and prints `(none)`. Silence therefore
   means the `restrict()` call was never reached — not that an empty registry is tolerated.
2. **The sandbox/headless profile really does register `str_replace_editor`.** Its own composed tree
   contains `- id: tool-str-replace-editor` / `name: '@deepseek-ai/dsh-tool-str-replace-editor'`
   (`dump-config.txt:556-557`), and my fresh sandbox boot reported `hasTool("str_replace_editor") === true`
   while `restrict()` in the real session does not know the name.

So the control is unsound **by construction in any profile that mounts that row**: the "dead" name is
live there, `restrict()` legitimately accepts it, the child is created, and the harness stays silent —
exactly the observation in §S2. This is profile dependence, not a harness guard. Consequence for the
team: no sandbox reproduction of the pre-fix refusal is representative, and a silent control must never
be read as a pass (it was not, here).

---

## Addendum — F2 WITHDRAWN (transient fingerprint lag, not a finding)

Measured at 21:52-21:54 (during t13's unit of work): `node scripts/verify-vendor.mjs` → **PASS, exit 0**
(twice in a row). Per the captain's ruling and §R3 (whoever edits `skills/` refreshes the fingerprint
in the same unit of work), the red recorded earlier in this file is a **transient fingerprint lag** and
is hereby withdrawn: it must not be filed against the deny-list fix or against this delivery.

For the record, the tree was actively being written while this was measured — the aggregate skills
hash moved between two consecutive reads seconds apart (`90783860…` → `c2ee698d…`), so any single
observation during t13's window describes only that instant. The authoritative final state is whatever
t13's completing run leaves behind.

F1 is UNAFFECTED by this: it is in `packages/`, not `skills/`, and its premise is unchanged
(4 × `return { ok: true … }` still present; the rename output schema still does not declare `ok`).
The repair target for the scheduler is therefore F1 alone.
