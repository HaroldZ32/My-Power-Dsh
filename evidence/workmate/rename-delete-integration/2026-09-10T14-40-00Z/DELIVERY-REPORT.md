# t11 — Integration & delivery report: workmate rename/delete + read-only deny fix

Team `workmate-rename-delete` · integration task t11 attempt 1 (member: Lead) · HEAD `f697088` (unchanged).

This is the delivery record. It is written to be read cold: what changed, what was **proven**, what was
deliberately **not** done, and what remains **open**. Where a claim rests on a measurement, the evidence
path or the measuring command is cited; where something is unprovable here, it is labelled as such.

---

## 1. What this team delivered

Three units of work, integrated as one change:

1. **Workmate rename + delete** in `packages/mpd-workmate-plugin` — two new agent tools, two new service
   methods, two new HTTP routes, archive-first delete with an explicit purge, a full rename cascade, and
   an in-use refusal gate. Plus the Workmates sidebar tab controls (zh/en) in
   `packages/mpd-bundle-plugin` and its rebuilt `client.js`.
2. **The read-only deny-list defect fix** — the two tool names this profile does not register
   (`str_replace_editor`, `apply_patch`) were removed from the deny lists in `mpd-roles-plugin` and
   `mpd-workmate-plugin` (src **and** built dist), so read-only spawns are no longer aborted; the two
   exported arrays are pinned equal by a test so the drift class cannot return.
3. **Documentation + QA-assertion sync** — the bilingual docs, `AGENTS.md`, the QA case table and the
   route/reason assertions in the two workmate QA cases.

### 1.1 The five user decisions, as implemented

| # | Decision | Where it landed | Verified by |
|---|---|---|---|
| D1 | **Delete = archive-first**; real removal only with an explicit purge that requires `confirm === <name>` | `deleteWorkmate` moves the instance to `~/.mpd/workmate/.archive/<key>-<compactUtcStamp>/`; purge stashes then removes; the GUI uses an explicit two-step flow whose purge step requires the exact typed name | t6 lifecycle 59/59; t7 I3 |
| D2 | **Refuse mutations while the workmate is in use**, then update every library-owned name reference | `assertNotBusy` = in-process spawn counter (released in `finally`) + a read-only scan of `<cwd>/.mpd/team/<teamId>/team.json`; rename gates **both** the old and the target key; the refusal returns `409 in-use` with `blocking[{teamId,member}]` | t7 I4; t6 (refusal names team **and** member) |
| D3 | **The read-only deny defect is in scope** | both arrays now carry exactly the seven live-registered names; the dead pair is absent from every src/dist copy and pinned by `roles.test.ts` | t9; t14 (independent falsifiability); §S1 lane |
| D4 | **Surface = agent tools + web routes + the Workmates sidebar tab, zh/en** | 7 tools, 5 service methods, 4 GET + 3 POST routes, and the tab's rename/delete controls with 53-key zh/en dictionaries asserted identical | t6 tools 19/19; t8 (UI review); `web-client-adapt --self-test` 14 checks |
| D5 | **ASCII-only key scheme**; invalid/empty/CJK names rejected before any filesystem call | `nameKey` accepts iff `raw === sanitizeName(raw)` and non-empty; applied to both rename args and to delete before any fs call; `wmDir("")` guarded so the library root is unaddressable; Unicode/CJK names **deferred** (see §6) | t7 I1 (10 rejected inputs incl. CJK, `..`, `.archive`, `a/b`) |

### 1.2 Deliberately NOT rewritten

**Archived team records are historical and are never rewritten.** A rename updates only library-owned
references (directory key, `meta.name`, the `index.json` key, the `note.md` self-reference, `renamedFrom`);
records under `.mpd/team/archive/**` and `retired-members.json` keep their bytes. This is by design
(contract §D2/§F): the agent-teams state belongs to that plugin, and the workmate gate only ever **reads**
it (fail-open on any read error) — it never writes it.

---

## 2. Change set attributable to THIS team

The tree was already dirty when the team started (baseline `HEAD f697088` + **33** uncommitted entries
from a previous session, contract §I). Nothing was committed, stashed, reverted or tidied. The team's own
delta is the set below; everything else in `git status` is pre-existing.

**Source / artifact (implementation, t3/t4/t5/t12/t13/t15):**
`packages/mpd-workmate-plugin/src/index.ts` · `…/dist/index.js` · `…/test/rename-delete.test.ts` (new) ·
`packages/mpd-roles-plugin/src/index.ts` · `…/dist/index.js` · `…/test/roles.test.ts` ·
`packages/mpd-bundle-plugin/src/web-client.js` · `packages/mpd-bundle-plugin/client.js` ·
`packages/mpd-bundle-plugin/test/client-harness.mjs` · `…/test/sidebar-tab.test.mjs`.

**Documentation & QA (t10, plus t5's accepted pre-edits):**
`AGENTS.md` · `README.md` + `README.zh-CN.md` · `docs/user-guide.md` + `.zh-CN` · `docs/architecture.md` + `.zh-CN` ·
`docs/development.md` + `.zh-CN` · `docs/feature-audit.md` + `.zh-CN` · `packages/mpd-workmate-plugin/README.md` + `.zh-CN` ·
`packages/mpd-bundle-plugin/README.md` + `.zh-CN` · `presets/mpd/agent.cordis.yml` · `skills/dsh-qa/SKILL.md` ·
`skills/dsh-qa/scripts/workmate-library.mjs` · `skills/dsh-qa/scripts/web-client-adapt.mjs` ·
`skills/dsh-qa/scripts/readonly-deny.mjs` (new) · `VENDOR_LOCK.json` (skills fingerprint).

### 2.1 `VENDOR_LOCK.json` — the undeclared path, disclosed

`VENDOR_LOCK.json` **is modified** by this delivery, and it is disclosed here rather than left implicit: the
t10 validator REFUSED it (`implementation t10 cannot complete: 1 changed path(s) not covered by inScope —
VENDOR_LOCK.json is undeclared`), with the contract's own §T1 having pre-authorized t10 to own the refresh.
Integration's scope covers it, so it is listed in t11's changed paths with the correction that **t10 was
frozen before this file's final value existed**.

**Accurate lineage** (values below are read from `git show HEAD:` and the working tree, not from any message):

| `skills` entry | value | notes |
|---|---|---|
| committed baseline (`HEAD` `f697088`) | `fileCount 361`, `treeSha 1bdd10f0764605f7…` | the stale baseline: the tree already held more files than the lock claimed, which is why the gate was red from the start (§V3) |
| final state | `fileCount 364`, `treeSha 54e6cf4464a3ad10643717c39d539b2a9697e72af9e01b858a5d6e319e2f083f` | current; verified by the two checks in §4 |

Values quoted in messages during this delivery — `c66efeef…`, `92209d2a…` — appear in **neither** the
committed lock nor the current one; they are stale snapshots and must not be written into the file.
**Do NOT revert this entry to the baseline:** reverting re-reds the binding vendor gate (§V3). The refresh is
part of the delivery, and `fileCount` legitimately grew 361 → 364 because the corpus gained QA case scripts.

The reusable helper is `evidence/workmate/rename-delete-docs/refresh-skills-fingerprint.mjs` (**dry-run by
default**; `--write` applies), and it reimplements `verify-vendor.mjs`'s own `readBytes`/`listFiles` 1:1 — never
a re-derived digest.

**Evidence (new, untracked):** `evidence/workmate/**` (rename-delete-core, rename-delete-gui,
rename-delete-verify, roles-readonly, rename-delete-docs, rename-delete-integration) and
`evidence/fix/readonly-deny/**` (historical, see §5 F3).

---

## 3. What was PROVEN (and how)

| Claim | Status | Evidence |
|---|---|---|
| Rename + delete tools work and the harness **accepts** their output | PROVEN | t6 3-layer re-verify: harness acceptance on the exact calls that used to fail, tool layer 19/19, routes/lifecycle 59/59 |
| The lifecycle is complete and all-or-nothing | PROVEN | 59/59 real sandboxed web boot (rename frees old key, archive restorable, purge removes, repeat delete 404, collision/orphan/symlink/same-key/root-guard all refuse, in-use names team AND member, no `$HOME` leak in error bodies) |
| Delete is archive-first with a byte-preserving move | PROVEN | t7 I3: archive dir inside `.archive`, bytes intact, index key dropped, other instances untouched |
| The in-use gate closes the spawn/reflect window | PROVEN | t7 I4: one synchronous block (no `await` between gate, collision check and mutation), archived teams do not block, throwing spawn releases the counter, blocked mutation leaves zero side effects |
| **Read-only authority is ENFORCED** (not merely "a list was sent") | PROVEN | t13/t14 lane: the child's **own** requests expose none of the seven write-capable names while the parent's exposes all seven (child 81 tools / parent 87; `childLeaksWriteCapable: []`), plus exact-equality of the filter actually handed to `tools.restrict()` |
| **The live lane is MET under the stub** | PROVEN | §S1/§AA3: the child's own request plus the stub's answer **are** the child executing a turn; the parent really reaches the spawn and the child is created and answers |
| Read-only fix cannot silently un-guard again | PROVEN (falsifiable) | witness logic at case sha256 **`ba6b490813e077609ad426591c751c6f2510728903b46bcecda230d2e05f90a4`** — the live `skills/dsh-qa/scripts/readonly-deny.mjs` is **byte-identical** to `evidence/workmate/rename-delete-core/witness-case-ba6b4908.mjs` (both 31794 bytes; `cmp` confirms), so the witness is the shipped code and not a snapshot of it. That file is the newest of three witness snapshots (`witness-case.mjs`, `…-e540d0d9.mjs`, `…-ba6b4908.mjs`); an earlier revision of this report cited `e540d0d9…`, which was superseded. **Do not cite a content hash as a constant here** — cite the two authoritative checks in §4 instead (gate exit code + the empty freshness find), because the corpus fingerprint moved eight times during this delivery |
| Gates green on the final tree | PROVEN | §4 below |

### 3.1 The two t15 levels, and the one lane combination nobody ran

t15 repaired a defect whose whole character was *appearing to fail while succeeding* (the harness rejected the
tools' output values as non-conformant **after** the mutation had already landed, so a caller was told the
rename failed and a retry hit `unknown`/`collision`). Two levels were proven — cited **separately**, because one
lane does not prove both:

| Level | What it proves | Evidence |
|---|---|---|
| **Real boot** (fresh `dsh` process, isolated `DSH_HOME` + sandbox `HOME`, probe mounted via `dsh --patch`) | BEFORE (pre-repair dist `82a015d8…`): rename, delete-archive and delete-purge each answered `returned invalid output: "value.ok" is not a declared property` **while the mutation landed**, and a blind retry answered `no workmate named`. AFTER (rebuilt dist `a7b558e9…`): **16/16 PASS** — all three answer `ok` with schema-conformant values, and the state agrees with each report (probe-1→2 freed, archived bytes under `.archive/`, purged instance gone) | `evidence/workmate/rename-delete-core/2026-09-10T13-49-39.352Z/` |
| **Regression lock** (unit/package level) | two cases in `packages/mpd-workmate-plugin/test/rename-delete.test.ts` drive rename/archive/purge through the **installed** harness validator (`@deepseek-ai/dsh-tools`, resolved from the `dsh` binary location; the case THROWS rather than skips if unreachable) — one asserts zero violations against the schema the plugin actually registers, the other pins the OLD schemas as rejecting those same values. Failing-first proof on disk: `OLD-SCHEMA VIOLATIONS: ["\"value.ok\" is not a declared property (additionalProperties: false)"]`, exit 1 | package suite 28 pass / 0 fail (26 before) |

**The single un-run combination, named rather than implied:** no lane asserts both halves **inside one real
mount boot** — i.e. a live boot that simultaneously (a) asserts the harness output validator ACCEPTS the three
mutation results *and* (b) asserts the OLD shape is REJECTED, in that same process. The real boot proves (a);
the regression lock proves (b) against the installed validator but outside a boot. Together they cover the
defect, but nobody executed the conjunction, so this report does not imply that one lane proved both.

### 3.2 Why the defect survived everything else

Worth recording because it generalizes: t3's tests used a **fake ctx** whose `tools.register` never reached the
harness validator; t7 called the shipped dist **without** the runtime; t12's mount proof called delete with an
**invalid** name, refused before a value existed; the route matrix **bypasses** the tool runtime; and
`--dump-config` only **composes** config. Each lane was green, and none of them was the real path — the same
"freshness signal is not a content signal" class as §5.1.

### 3.3 What is NOT provable in this environment — stated, not hidden

A spawned read-only child **executing a turn against a REAL provider** needs `DEEPSEEK_API_KEY`, which is
not reachable here (no provider key in the environment; `.credentials.yaml` carries only a browser-session
grant). The live lane above is the strongest proof this environment admits. **The child DID run** — under
the stub — so it is wrong to write "the child never ran"; what is out of reach is only a turn against a
real provider. Remedy: export `DEEPSEEK_API_KEY` and re-run `node skills/dsh-qa/scripts/readonly-deny.mjs`;
the case needs no change.

Two further honest limits: the pre-fix **loud refusal** is not reproducible in a fresh process (§S2/§W1 —
the harness validates against the view scope, which differs between a long-lived session and a fresh boot),
and the in-session `mpd_role_spawn` remains invalid evidence in **both** directions because plugin code is
loaded at boot (§O1).

---

## 4. Gate sweep on the final tree

`bun run test:qa` exit 0 (`workmate-library` 18 checks, `web-client-adapt` 14 checks, all self-tests passed) ·
`bun test packages/mpd-bundle-plugin/test` exit 0 (52 pass / 0 fail / 452 expect) · `bun run typecheck`
exit 0 (`tsgo --noEmit` clean) · `node scripts/verify-vendor.mjs` exit 0 (`[verify-vendor] PASS`).
t6 additionally recorded `bun test packages` 293 tests / 290 pass / 3 skip / 0 fail and an
isolated-`DSH_HOME` boot. Full output: `output-t11-watchpoints.log` in this directory.

**Bundled-artifact coherence** (t11 acceptance): `packages/mpd-workmate-plugin/dist/index.js` is newer than
its source and carries both new tools and `renamedFrom` (10 occurrences); `packages/mpd-roles-plugin/dist`
contains **0** occurrences of either dead name; the live `packages/mpd-bundle-plugin/client.js` carries
`RENAME_URL`/`DELETE_URL`, `SIDEBAR_TAB_ID = "mpd-workmate"` and the purge-confirmation strings. So a later
`npm run pack` would ship what was verified.

---

## 5. Findings carried, and their disposition

No required review is left with an unresolved blocker or high finding (t7 pass 0 blocker/high; t8 pass;
t9 pass), and t6 verification passes on the repaired bytes. The low findings are carried here:

| # | Finding | Disposition |
|---|---|---|
| t7 **L1** | The delete tool returned `archived: ""` on purge while the route/service returned `null` | **CLOSED** — the tool now returns the service's `null` verbatim with the `oneOf` nullable form (t12/§V1). **Do not document the old split**: §N1(i) is withdrawn |
| t7 **L2** | Archive-first delete is one-way in-product and the restore path was undocumented | **CLOSED** — the manual `mv ~/.mpd/workmate/.archive/<key>-<stamp> ~/.mpd/workmate/<key>` recovery and the explicit "no in-product restore" statement now appear in the workmate README pair, the user-guide pair, the feature-audit pair and `AGENTS.md` |
| t8 **L1** | `mutate.reason.sameKey` is defined in both dictionaries but unreachable (the server's text is authoritative for a same-key rename) | **CLOSED (post-delivery pass, 2026-09-11)** — `submitRename` now refuses a same-key rename **locally** with `mutate.reason.sameKey` and sends nothing, so the entry is reachable in both languages; a name that merely SANITIZES to the current key still goes to the server, whose text stays authoritative (§M2). Guarded by a test that FAILS on pre-fix bytes |
| t8 **L2** | The purge button's **busy** label disagrees with its own button label (zh "彻底删除" → busy "删除中…"; en "Purge" → busy "Deleting…"), muddying the archive-vs-purge distinction mid-operation | **CLOSED** — zh `彻底删除中…`, en `Purging…`. The assertion is the general rule, not the two strings: each busy label must contain its own button label's stem, checked for archive AND purge in BOTH languages (it fails for the old `删除中…`/`Deleting…`) |
| t8 **L3** | Two Chinese wording nits: `mutate.reason.confirmRequired` reads clipped (missing 以), and `mutate.reason.inUse` has a stray half-width space before `{blocking}` after a full-width colon | **CLOSED** — `彻底删除需要输入完整名称以确认`, and the half-width space before the placeholder is gone; both asserted |
| t8 **L4** | Pre-existing: a detail GET failing for any reason other than `unknown` leaves the pane spinning beside the error banner | **CLOSED** — the pane renders the failure instead of the loading text whenever a load it started did not succeed, and a fresh load clears the previous error so a retry is not shadowed by a stale one. Only a genuinely gone key stops the pane (§H), so a transient failure keeps the selection. Asserted on the NON-`unknown` branch, which is the one that used to spin |
| t9 **F1** | The live case asserted only that the list was SENT, never that the child was RESTRICTED | **CLOSED** — t13 added the per-request tool-name-set enforcement assertion; t14 independently verified falsifiability |
| t9 **F2** | The defect's described failure mode (loud refusal) did not match the measured one | **CLOSED** — the silent un-guarding route is now documented in the case header and in the `readonly-deny` SKILL.md row (both routes named, with the two harness source anchors) |
| t9 **F3** | Evidence-path drift: contract §R1 and the gate listing referenced `evidence/fix/readonly-deny/<ts>/` while the case writes `evidence/workmate/roles-readonly/<ts>/` | **CLOSED** — §O4 now carries an inline **[PATH SUPERSEDED → §Z4]** pointer at the site where the old slug still appeared, so a reader landing there is not misled; §R1 no longer names it at all, and the gate listing (`skills/dsh-qa/SKILL.md`) had already been corrected to the current method by t17. No `skills/` edit was needed for this item, which is why it required no fingerprint refresh — verified by `find skills -newer VENDOR_LOCK.json -type f` returning NOTHING |
| ~~new (found during integration)~~ **RETRACTED** | ~~Four packages ship a `dist/` older than their own `src/`~~ — **this was a measurement artifact of my own comparison, not a property of the tree.** Corrected statement: **no package ships stale code.** | **RETRACTED — do NOT rebuild anything.** My comparison took the newest file anywhere under `src/` and the newest anywhere under `dist/` and subtracted them, which paired unrelated build families. Measured per artifact against **its own** source at sub-second resolution: `mpd-codegraph-plugin` `dist/index.js` `.986562418` vs `src/index.ts` `.987562440`; `mpd-dsh-adapter-plugin` `.280561928` vs `.281561955`; `mpd-memory-plugin` `.281561955` vs `.282561981`; `mpd-bundle-plugin` `dist/index.js` `.686438358` vs `src/index.ts` `.687438383` — in every case the pair differs by ~1 ms, i.e. a build writes `dist` immediately after reading `src` (build ordering, not staleness). The fourth case was worse: I paired `dist/index.js` (product of the long-stable `src/index.ts`) against `src/web-client.js` (product = the root `client.js`), so that "stale" pairing never existed — the real chain is `src/web-client.js 20:55:30` → `client.js 20:57:09` (NEWER) and `src/team-page.js 15:22:05` → same `client.js` (NEWER). **"A checkout install executes stale copies" was false.** Independently reproduced in this pass; the captain's measurements agree exactly |

**Attribution for the `readonly-deny` SKILL.md row — cite t17, not this report.** That row belongs to **t17**
(created precisely because contract §U2 had correctly told me not to treat the row as stale; §U2 simply
predated t13 changing the pass condition). t17 rewrote it to the current enforcement assertion and refreshed
`VENDOR_LOCK.json` in the same unit of work as a DECLARED change. My own contribution was one clarifying
clause (the explicit **falsifiable** wording tied to t14's independent witness), applied only after t17
completed, so the row on disk carries t17's repair plus that clause. **The lesson, stated because it is the
same trap three times over:** *an mtime is a freshness signal, never a content signal* — that row carried a
NEWER mtime than t13's change while still describing the OLD pass condition. The identical structure appears
in `--dump-config` (proof of composition, never of a load) and in an in-session probe (it proves nothing in
either direction because plugin code is loaded at boot).

### 5.1 The "never treat a fingerprint as a constant" rule

Six fingerprint values went stale during this delivery, three of them from **comment-only** edits; the corpus
fingerprint plus the case-content hashes moved **eight** times in total. A vendored fingerprint is a **claim
about the corpus at a moment**, not a constant to copy: after ANY edit under `skills/**`, recompute it with the
gate's own algorithm in the same unit of work. The reusable helper is
`evidence/workmate/rename-delete-docs/refresh-skills-fingerprint.mjs` (dry-run by default, `--write` applies;
it reimplements `verify-vendor.mjs`'s `readBytes`/`listFiles` 1:1).

**What to cite instead of a constant — the two authoritative checks:**

```bash
node scripts/verify-vendor.mjs                      # must exit 0 with [verify-vendor] PASS
find skills -newer VENDOR_LOCK.json -type f         # must print NOTHING
```

A PASS is only meaningful when the second check is empty: that conjunction means the lock is newer than every
file it claims to describe. **A fingerprint value pasted from a message is stale by construction** — this
report's own first revision cited a superseded witness hash (`e540d0d9…`) and a superseded corpus value
(`0fffd8fc…`), which is precisely the failure mode the rule exists to prevent. The same class of trap appears
three times in this delivery:

| Trap | Why it misleads | Correct signal |
|---|---|---|
| a fingerprint constant | it describes one moment; any byte under `skills/**` moves it | the two checks above |
| an mtime (newer than the code it describes) | the `readonly-deny` row carried a NEWER mtime while still describing the OLD pass condition (§U2 predated t13); six values went stale from comment-only edits | read the CONTENT, or re-derive the artifact |
| an mtime (compared across different lineages) | **my own retracted "stale dists" finding**: taking the newest file anywhere under `src/` and anywhere under `dist/` paired unrelated build families — and for `mpd-bundle-plugin` paired `dist/index.js` against `src/web-client.js`, whose product is a different artifact (`client.js`) entirely | compare an artifact with **its own** source/builder; the ~1 ms offsets that looked like staleness are just build ordering |
| `--dump-config` | it proves COMPOSITION, never that a plugin loaded (§4) | a mounting boot with registration instrumentation |

The unifying lesson: **a freshness signal is never a content signal** — and a freshness heuristic is only
meaningful when the two things compared are actually the same lineage. Two of the four traps above are mine,
found by measurement rather than argument, which is why every remaining claim in this report cites the command
that produced it.

---

### 5.2 The post-delivery pass that closed t8 L1–L4 and t9 F3 (captain, 2026-09-11)

The user asked for the six low findings to be FIXED rather than carried, so this pass is a real code change,
not a documentation one. Everything it touched is in `packages/mpd-bundle-plugin` (the source, the rebuilt
combined client, the page test) plus the contract text for F3.

**Change set:** `src/web-client.js` — the two zh strings and the en busy label, the local same-key refusal, and
the pane's failure branch — then `node scripts/build-mpd-client.mjs` → `client.js` **261,792 → 263,080 bytes**.
(The build prints `258868` because it reports CHARACTERS while the file is UTF-8 BYTES — CJK is 3 bytes each.
The same chars-vs-bytes gap would silently invalidate a size-based freshness claim.)

**Falsifiability, measured rather than argued.** The four new tests were run against a **control client built
from the pre-fix source** (the reversions in `control/revert.mjs`, applied to the current source, then a real
`build-mpd-client`): **22 pass / 4 fail, and the four failures are exactly the four new tests** — each assertion
detects its own defect and nothing else regressed. On the fixed bytes the same file is **26 pass / 0 fail**. The
control build came out at 261,792 bytes, byte-size-identical to the pre-change client on record.

**A trap this control lane exposed — worth more than the six fixes.** The first control run **passed all 26
tests** against a supposedly pre-fix client. Cause: `client-harness.mjs` resolved its repo root at MODULE
EVALUATION time, while the test file sets `MPD_REPO_ROOT` *after* its import (imports are hoisted), so the
override was dead code and the harness silently loaded the REAL `client.js` from `cwd`. A falsifiability lane
that cannot fail is worse than none, because it manufactures confidence. Fixed at the source:
`loadBundleClient()` now resolves the root at CALL time. Recorded here because the shape — a signal that cannot
vary, silently read as a pass — is the same class as this delivery's two earlier traps (`--dump-config` as a
load signal; an mtime as a content signal).

**Gates on the final bytes:** `bun test packages` **294 pass / 3 skip / 0 fail** (297 tests, 33 files);
`bun run typecheck` exit 0; `bun run test:qa` all self-tests passed; `node scripts/verify-vendor.mjs` exit 0
PASS; `find skills -newer VENDOR_LOCK.json -type f` → NOTHING. No `skills/` file changed, so no fingerprint
refresh was owed — that is what kept F3 a contract-text fix. Evidence:
`evidence/workmate/low-findings-fix/2026-09-11T00-43-23Z/`.

---

## 6. Open items for the user

1. **`dist/mpd-package/**` needs the release step** — the packed mirror is stale relative to the live
   tree (`pack-mpd` is AGENTS.md §8's RELEASE step, not part of this change). A checkout install reads the
   live tree and is unaffected; only a packed/tarball artifact needs `npm run pack`. **Reported, not run.**
2. **A dsh restart is required** for the read-only fix (and any other plugin change) to take effect on a
   running install — the host holds the old modules in memory (`link:` install, §O1).
3. **Unicode/CJK workmate names are deferred** (D5). Names are ASCII-only `[a-z0-9_-]` by design; a CJK
   name is refused with `400 invalid-name` before any filesystem call. This is a listed follow-up, not a bug.
4. **Latent, deliberately not fixed:** `packages/mpd-hashline-plugin/src/index.ts:110` declares
   `lines: { type: ["string","array"] }` in tool **parameters** and ships it in its dist. Measured
   harmless today (a real boot composes that row with 0 loader-apply errors — this harness validates
   output schemas but not parameter schemas, matching the validator error text naming only output-schema
   paths), but one harness release away from taking the tree down the way the output-schema array did.
   It belongs in its own scoped change with its own mount proof — do not "clean it up" opportunistically.
5. **Pre-existing, not ours:** a fresh `w` profile lacks the `agent-presets` row, so its boot log carries
   `patch: entry "agent-presets" not found`. This predates the change and is not a regression.
6. **Low findings t8 L1–L4 and t9 F3 are CLOSED** (§5.2) — fixed on the user's request, with the four new UI
   assertions proven falsifiable on a pre-fix control build. Nothing in §5 remains open.

---

## 7. Operational caveat worth knowing

A workmate whose key equals a **roster member name** is refused while a **non-archived** team record
listing that member exists: the in-use gate matches members by sanitized name, so renaming anything *to*
`architect` (or `lead`, …) is refused with `409 in-use` while such a record exists. This is a deliberate
consequence of D2, not a bug, and it is documented in `AGENTS.md` §12 and in both user-guide languages.
Clear it by archiving (or retiring) those teams in the AgentTeams tab and letting any in-flight
`mpd_workmate_spawn` finish — then repeat the mutation.

---

## 8. Evidence index

- `evidence/workmate/rename-delete-core/20260910T125201Z/` — t3 core: `result.json` all_passed, before/after git baseline, `dump-config.txt`
- `evidence/workmate/rename-delete-core/20260910T131415Z-fullboot/full-boot.result.json` — full-profile MOUNT boot (`mpd_workmate_row_present: true`, `real_boot_exit: 124`, `loader_apply_errors: 0`)
- `evidence/workmate/rename-delete-core/20260910T132303Z-mount/mount-proof.result.json` — mount probe: 7/7 workmate tools registered, 0 apply-crash signatures
- `evidence/workmate/rename-delete-verify/attempt2-2026-09-10T13-59-50.000Z/` — t6 PASS attempt 2 (`result.json`, `result-tools.json` 19/19, `results.json` 59/59, `s1/` read-only lane)
- `evidence/workmate/rename-delete-verify/2026-09-10T13-24-03.000Z/findings.md` — t6 attempt 1 (the two blockers, both since cleared/withdrawn)
- `evidence/workmate/roles-readonly/` — the read-only fix's own evidence (the §S1 lane)
- `evidence/workmate/rename-delete-gui/2026-09-10T12-50-43.482Z/result.json` — t4 GUI lane
- `evidence/workmate/rename-delete-docs/2026-09-10T14-26-06Z/` — t10 docs + QA sync (`result.json` with the 24-item claims-checked-against-source list, `output.log`)
- `evidence/workmate/rename-delete-integration/<ts>/` — this report, the persisted reasoning artifacts, and the gate logs
- Contract (binding): `.mpd/plans/workmate-rename-delete-contract.md` — also frozen here as `contract.md` with its SHA-256

## 9. Verdict

The feature is **shipped and integrated**: rename + delete with archive-first semantics and an in-use gate,
the read-only deny-list defect fixed and guarded against recurrence, both surfaces localized, every
documentation and QA surface synced to the verified behaviour, and the gate sweep green on the final tree
with the vendored fingerprint refreshed. The residuals in §3.1 and the open items in §6 are stated rather
than hidden; none of them blocks the change.
