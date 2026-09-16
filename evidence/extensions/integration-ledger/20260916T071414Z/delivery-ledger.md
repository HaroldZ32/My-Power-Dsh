# Delivery ledger — external-plugin adaptation wave (task t17)

Integration record for the wave staged by `.mpd/plans/ext-template-and-guides.md` (the persisted
requirements freeze, §2 deliverables D1–D6, §5 gates). This ledger is written for the CAPTAIN to
commit and report from: it states the exact frozen state, every gate's exit code, the packed tree's
contents, the single-re-pin invariant and every deferred/waived item with its reason.

- Task: `t17` (integration), attempt 5, attempt_id `e5452a1a-b12e-434a-81fb-8fb0c5cb0dfa`
- **Captain amendment applied in attempt 5**: the gate list now uses the CLEAN-CWD unit invocation, and
  `bun test packages` (repo cwd) and `bun run test:qa:all` are recorded as **WAIVED** items with their
  evidence (§3) instead of being run. The frozen state, the deliverables and the packed-tree proof are
  unchanged from attempt 2 (re-verified: same HEAD, same 17 tracked digests, same frozen evidence trees).
- Evidence root: `evidence/extensions/integration-ledger/20260916T071414Z/`
- Integration writer: Lead. **No git write was performed by this task** (no add/commit/checkout/
  reset/merge/branch/tag/stash). No member-owned file was edited; the only paths written are this
  evidence directory plus the evidence directories the mandated QA lanes write for themselves
  (listed under "Side effects of the mandated gates").

## 0. Bottom line for the captain

- **All six wave deliverables D1–D6 are complete, digested, owned and cleared by a terminal PASS
  review** (§2), and the **amended** 15-command gate list is GREEN on the frozen tree (§3) — including
  the clean-cwd unit invocation (`bash -c 'cd "$(mktemp -d)" && bun test …/packages'` → 755 pass /
  0 fail). The packed tree is exactly as intended: the template is NOT shipped, the extension assets
  ARE (§4), and the wave carries exactly ONE `VENDOR_LOCK.json` re-pin in the same change set as the
  skills edits (§5).
- **TWO commands are WAIVED, each with its evidence recorded — never a silent omission** (§3):
  1. `bun test packages` from the REPO cwd — red only because a PRE-EXISTING, non-hermetic test
     (`packages/mpd-config-plugin/test/settings-wiring.test.ts:352` and `:419`) assumes the cwd has no
     `.mpd/mpd.jsonc`, while this workspace deliberately HAS that gitignored file (the captain's
     watchdog tuning). The plugin + tests are outside the wave's change set (unchanged since `a647d47`).
     Both readings are in the ledger: repo cwd 753/2, clean cwd 755/0. The clean-cwd invocation is
     row 1 of the amended table.
  2. `bun run test:qa:all` — NOT runnable on this host: it aborts at lane 1 of 27 (`agent-teams-adopt`)
     with `MISSING_CREDENTIAL … "deepseek-official"` (no `DEEPSEEK_API_KEY`; the credential store has no
     entry for that route). **This ledger does NOT claim the suite passed.** The aborting lane is
     untouched by this wave and its own boot log shows every wave row mounting correctly; the four wave
     lanes were run individually instead (rows 11–14, all exit 0 / `ok:true`).
- **Recommendation**: commit the frozen state in §1. The two follow-ups stay the captain's: make the two
  config assertions cwd-hermetic, and supply a `deepseek-official` key (or a resolving settings chain)
  before the full suite can be green here. Nothing here was repaired by this task, and no git verb was
  run.

## 1. Frozen state — commit exactly this

| Field | Value |
|---|---|
| Branch | `dev` |
| HEAD | `1f38e3c1b8149cecc68f54fae1979f56e1ff2b0f` |
| Frozen at (UTC) | 2026-09-16T07:14:14Z (manifest) — sweep attempt 2 ran 07:14Z–07:22Z, attempt 5 (amended list) ran 07:24Z–07:29Z; both on this same tree |
| Change set | 17 modified + 25 untracked paths (the machine-readable list is `freeze-manifest.json` → `changeSet`) |
| Freeze manifest | `freeze-manifest.json` (per-path sha256 / directory tree digests) + `raw/freeze-manifest.txt` |

The whole change set is reproduced in §2 per deliverable; `freeze-manifest.json` additionally
digests every untracked evidence directory (the digests below name the ones the acceptance requires).

## 2. Deliverables D1–D6 (path → sha256 → owning task → clearing review)

### D1 — Code: F1 adapter identity (loud once + assertable) and F5 single hazard comment; both dists rebuilt
| Path | sha256 |
|---|---|
| `packages/mpd-ext-plugin/src/index.ts` | `dd3bdd00579d8d7aa56a70cb18af6a0bfd4ce3bae400c730d0f35bc40f662ec0` |
| `packages/mpd-ext-plugin/dist/index.js` | `0ebad6573abac96a5e0599208ba1d948c5e6ff315b5f47671ebfe82939acba55` |
| `packages/mpd-ext-plugin/test/adapter-identity.test.ts` | `e631d8096f4d688ca3498d264509e0337b889fe136b4a046b187b453deedd6c4` |
| `packages/mpd-roles-plugin/src/index.ts` | `9a54bf7d6620a2d437ebafd15bda5f7592e9e1cce2d997fe2c6170a71d6ab18c` |
| `packages/mpd-roles-plugin/dist/index.js` | `22595b921903286873855185bbf05a5a06aba8d80201eadcb036d174d4778deb` |
| `packages/mpd-roles-plugin/test/adapter-identity.test.ts` | `b1bd5a94fef7737ff997e5428838ac1c5b82f010610cd68a3a85109e8e0cf25f` |
| `packages/mpd-bundle/cordis.patch.yml` | `3aef18d6c715246b77cee87bcacf98d32ec948e647201d05ac87de4583fc918b` |
| evidence `evidence/extensions/f1-adapter-identity/` | tree `8935c7549b5c411b9e4e15e996fde0375d610363575f408f141711760a39d8ab` (36 files) |
| evidence `evidence/extensions/boot-repeat/` | tree `62bde6c2c339298a34b6038c6045ce392f4b29877509f470bbc36e2859217337` (18 files) |

Owning task **t4** (Senior Engineer) → repair **t22** (round 2) → clearing review **t23** (Reviewer,
`verdict=pass`, "0 blockers, 1 low nit"). Independent verification **t10**; repeat-boot insurance
**t24** (6 real boots, ext dist `0ebad657…` / roles dist `22595b92…` loaded).

### D2 — Template + scaffold
| Path | sha256 |
|---|---|
| `templates/` (7 files) | tree `e2778e16c490057a3ddb0529679b0c542913fce07eba53160770258130bba1c3` |
| `scripts/mpd-ext.mjs` | `60d7901245381d9874094604de4b05b9d8c07b14f766b8adb8a8a40eea2618af` |
| evidence `evidence/extensions/template-scaffold/` | tree `42b4780426b8b899049330bb7953df9c99f4cab8a20c10ffb350b731eb09edea` (35 files) |

Owning task **t5** (Deep Worker) → repair **t19** (round 2) → clearing review **t20** (Architect,
`verdict=pass`). Round-1 review **t14** was `needs_revision`; t19/t20 closed all five findings.

### D3 — Packer-closure checker (F11) + its wiring
| Path | sha256 |
|---|---|
| `scripts/verify-pack-closure.mjs` | `9decb0830f327f6d220e7738aafb9237cc0cc318f2356c66433d5b10b61135df` |
| `package.json` | `ea608ea2b39b2c9494a2d741bb2bcbf669a304830b6ba75713d8f8f3f719d723` |
| evidence `evidence/extensions/pack-closure-check/` | tree `5d8457bb18215517fe171f84405fdfbf1de5a534f3c5123c930b62e4fb95003e` (30 files) |

Owning task **t6** (Junior Engineer) → clearing review **t18** (Architect, `verdict=pass`).

### D4 — Skills pass + template lane + exactly ONE re-pin
| Path | sha256 |
|---|---|
| `skills/dsh-qa/SKILL.md` | `843b7f0cba4253ee02551aa4c56d31fe686064f9a57912127664b8f850b1b1f7` |
| `skills/dsh-qa/scripts/extension-lifecycle.mjs` | `f8a4af525f4b86591b913390c2e008f9f6b32bef8e6193b6f70dca74407a0ac2` |
| `skills/dsh-qa/scripts/extension-mcp-bridge.mjs` | `42cfd27d731d14663e4cd65ba9c665241e2767700c5057bc6e1afbc408c89a87` |
| `skills/dsh-qa/scripts/extension-template.mjs` (new) | `42a46bf16b766d2d909fb1fec989b9544722a868a6af991729f6afed2467336c` |
| `VENDOR_LOCK.json` | `6b65176a935f573eaf4c9766c9a42d6ad3c48d3fc4d5e6a0797bade6992449ff` |
| evidence `evidence/extensions/verify-skills/` | tree `c22310a85337e96abe4c069448ce847c1691f695f16f1006d54b2ad1e1576af9` (36 files) |

Owning task **t8** (Senior Engineer) → clearing review **t15** (Architect, `verdict=pass`);
independent verification **t11** (Deep Worker).

### D5 — Docs
| Path | sha256 |
|---|---|
| `docs/extension-authoring-guide.md` | `f8f771e83790f17998e5ba39ba0e0070bca21e706e28a48c4df3b8bf297887ce` |
| `docs/extension-authoring-guide.zh-CN.md` | `07f7f9ff6b20739070beb9996222cf954614daa1cf2a0dd2c72fa470d457da68` |
| `EXTENSIONS-FOR-AGENTS.md` | `9a34622cc2843eddc10bcda810efbfa027f676dfa32108ff92d504e2985edf18` |
| `docs/extension-adaptation-report.md` | `ed903aaf42a39a189694f0cd14d9391040ccc528465a70c1b1c28e7d27dccb5f` |
| `docs/extension-adaptation-report.zh-CN.md` | `34daae0118897dbdbe4ae7455d8e6155863a92a8fcfc90f6ab8168e049a764e8` |
| `README.md` | `8367a10e8cb938ee8b689df2259a85c38992fb1b373f78985a32e86612fe3718` |
| `README.zh-CN.md` | `4cbda5db79aa17dfa74671604afc74878237d11870ed8517a2092d7f96807a03` |
| `docs/index.md` | `f90ea958bf11b0532ff9efd5a7eb92a2647239b460e6e8c1520f614ec081df81` |
| `docs/index.zh-CN.md` | `f8715202b4182f0e2ef8a30c3a3f29f83d036ccdb44adee9f3e91df366ea3b93` |
| evidence `evidence/extensions/docs-claims/` | tree `45f939e59b04b40d01886ab51a521431736be948ac35feb58d7601bf39d548bc` (31 files) |

Owning task **t9** (Deep Worker) → repairs **t21** (symbol re-anchoring + content-checking checker)
and **t25** (t16's round-1 findings) → clearing review **t26** (Reviewer, `verdict=pass`, round 2).
Independent verification **t12** (Lead, attempt 2, PASS 7/7; the earlier attempt was FAILED and the
repair is what re-earned the verdict).

### D6 — Evidence: F6 boundary index + the corrected F7 prober
| Path | sha256 |
|---|---|
| `evidence/extensions/boundary-index/` | tree `9644ed01e898d4f3389053b9e6cda0536d1e4ec18bcd60baa34aeef06119939f` (4 files) |
| `evidence/extensions/debranding-probe/` | tree `52653e7cf2a989a57f7f73043bbc91983843c60e78ea2a2bb0b286562a96bb24` (6 files) |

Owning task **t7** (Junior Engineer) → clearing review **t18** (Architect, `verdict=pass`);
independent verification **t11**. `evidence/mpd-ext-debranding/20260915T074904Z/` is left byte-untouched
as the record of the narrow probe (a deliberate non-change, not an omission).

## 3. Gate sweep on the frozen tree (each command, its exit code, its raw log)

Every command in the **amended** list (captain amendment, attempt 5) was run by this task on the frozen
tree (§1), with stdout+stderr captured to `raw/attempt5-<name>.txt`. Exit codes are as reported by the
shell. The two commands this host cannot run are excluded from the list and recorded as **WAIVED** below
with their evidence — never as silent omissions.

| # | Gate | Command | Exit | Result |
|---|---|---|---|---|
| 1 | Unit (clean cwd) | `bash -c 'cd "$(mktemp -d)" && bun test /root/dshProj/my-power-dsh/packages'` | **0** | PASS — 755 pass / 0 fail, 5343 expect calls |
| 2 | Vendor | `node scripts/verify-vendor.mjs` | **0** | PASS — the re-pinned skills `treeSha` matches the corpus (§5) |
| 3 | Docs parity | `node scripts/verify-docs-parity.mjs` | **0** | PASS — `pairs=36 failed=0 violations=0 exempt=16` |
| 4 | Rows parity | `node scripts/verify-rows-parity.mjs` | **0** | PASS — 25 row ids match the bundle patch insert list |
| 5 | Extension CLI | `bun scripts/mpd-ext.mjs --self-test` | **0** | PASS — 52 checks |
| 6 | Extension CLI | `bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example` | **0** | PASS — `ok`, 4 kinds |
| 7 | Extension CLI | `bun scripts/mpd-ext.mjs validate templates/mpd-extension` | **0** | PASS — `ok`, 4 kinds |
| 8 | Closure checker | `node scripts/verify-pack-closure.mjs --self-test` | **0** | PASS — 6/6 arms incl. the templates-literal negative control |
| 9 | Closure checker | `node scripts/verify-pack-closure.mjs` | **0** | PASS — 17 dist rows + 1 adopted lib row + 4 mcp rows resolve; the allowlist carries no `templates/` entry |
| 10 | Packer | `node scripts/pack-mpd.mjs` | **0** | PASS — `dist/mpd-package` staged |
| 11 | Lane | `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` | **0** | PASS — `result.json ok:true` (`evidence/dsh-qa/bundle-lifecycle/2026-09-16T07-27-41.147Z/`) |
| 12 | Lane (the wave's new lane) | `bun skills/dsh-qa/scripts/extension-template.mjs` | **0** | PASS — `ok:true` (`evidence/extensions/extension-template/2026-09-16T07-27-58.479Z/`) |
| 13 | Lane | `bun skills/dsh-qa/scripts/extension-lifecycle.mjs` | **0** | PASS — `ok:true` (`evidence/extensions/extension-lifecycle/2026-09-16T07-28-04.884Z/`) |
| 14 | Lane | `bun skills/dsh-qa/scripts/extension-mcp-bridge.mjs` | **0** | PASS — `ok:true` (`evidence/extensions/extension-mcp-bridge/2026-09-16T07-28-37.428Z/`) |
| 15 | Evidence (plan §5 D6 row) | `node evidence/extensions/debranding-probe/20260916T061807Z/verify-debranding-full.mjs --json-out <this dir>/raw/prober-positive.json` | **0** | PASS — 26 field probes on 2 targets, 15 quoted verbatim, 11 reported not-quoted, 0 findings |

Raw logs: `raw/attempt5-RESULTS.txt` (one line per command) plus `raw/attempt5-<name>.txt` for each row.
The attempt-2 copies of the credential-free gates are also kept (`raw/gate-*.txt`), so both readings of
the unit gate exist on disk.

### WAIVED commands (excluded by the captain amendment — not runnable on this host)

**(a) `bun test packages` from the REPO cwd is NOT the gate — WAIVED; the clean-cwd invocation (row 1)
replaces it.** It is red only because two PRE-EXISTING, non-hermetic assertions in
`packages/mpd-config-plugin/test/settings-wiring.test.ts` assume `process.cwd()/.mpd/mpd.jsonc` does not
exist, while this workspace deliberately HAS that gitignored file (the captain's watchdog tuning).
Both readings are recorded:
```
(fail) migration (design §6, U15) > with no live root the migration is DEFERRED and nothing is written to process.cwd() [1.76ms]
  expect(existsSync(join(process.cwd(), ".mpd", "mpd.jsonc"))).toBe(false)   Expected: false   Received: true
(fail) … ZERO live roots: the mount-time root is used, and no file there means an empty base (schema defaults)
  expect(h.registrations[0].options?.base).toEqual({})   Expected: {}   Received: { "watchdog": { … } }
```
- repo cwd: 753 pass / 2 fail (`raw/gate-bun-test-packages.txt`);
- the same FILE from a clean cwd: 23 pass / 0 fail (`raw/control-config-test-clean-cwd.txt`);
- the WHOLE suite from a clean cwd: **755 pass / 0 fail**, exit 0
  (`raw/control-bun-test-packages-clean-cwd.txt`, re-run in attempt 5 as `raw/attempt5-unit-clean-cwd.txt`);
- `git status --porcelain packages/mpd-config-plugin` is empty — the plugin and its tests are outside
  this wave's change set and last changed at `a647d47` (2026-09-15, before the wave).

**(b) `bun run test:qa:all` — WAIVED: not runnable on this host.** It aborts at lane 1 of 27
(`agent-teams-adopt`) because its live arm boots a headless dsh whose first model call dies with
`MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"`
(`raw/gate-test-qa-all.txt`):
```
[test:qa:all] agent-teams-adopt
[agent-teams-adopt] ok=false -> evidence/plan-c/c1-team/2026-09-16T07-16-22.160Z
  live: {"ok":false,"exit":1}   teamState/archive/taskTerminal: ok=false   webRoute: {"ok":false,"status":401}
dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"
[test:qa:all] FAILED: agent-teams-adopt
```
`DEEPSEEK_API_KEY` is unset and `~/.dsh/.credentials.yaml` carries no entry for that route
(captain-verified). The aborting lane is **untouched by this wave**, and the same run's boot log shows
every wave row mounting correctly (`[mpd-ext] … adapterIdentity=mounted:mpdDsh`, `[mpd-roles] …
adapterIdentity=mounted:mpdDsh`, `[mpd-team-watchdog] applied`, `[mpd-config] settings bridge
registered`, `[mpd-bootstrap] skill corpus served`). **This ledger does NOT claim the suite passed.**
Instead the four wave lanes were run individually — rows 11–14, all exit 0 / `ok:true`.

Neither waived command was repaired by this task (the integration seat records; the captain dispatches
repair). Two follow-ups remain the captain's: make the two config assertions cwd-hermetic, and supply a
`deepseek-official` key (or a resolving settings chain) before the full suite can be green here.

## 4. Packed tree inspection

Produced by the packer (`node scripts/pack-mpd.mjs`, exit 0 — row 10 of the amended list, re-run in
attempt 5) into `dist/mpd-package/`; inspected with literal path probes
(`raw/packed-tree-inspection.txt`).

Packed root listing: `cordis.patch.yml  extensions  LICENSE.md  LICENSE-NOTICES.md  package.json  packages  presets  README.md  README.zh-CN.md  scripts  skills`.

| Probe (path inside `dist/mpd-package/`) | Result |
|---|---|
| `templates/` | **ABSENT** — the template directory is NOT shipped |
| `templates/mpd-extension/` | **ABSENT** |
| `packages/` | PRESENT (24 plugin package directories) |
| `packages/mpd-ext-plugin/` | **PRESENT** |
| `packages/mpd-ext-plugin/dist/index.js` | PRESENT |
| `packages/mpd-roles-plugin/dist/index.js` | PRESENT |
| `extensions/` | **PRESENT** (3 entries) |
| `extensions/mpd-ext-example/mpd-ext.json` | PRESENT |

Other counts: 1136 files in the packed tree. A `find` for the word `template` returns only
skill-internal paths (`skills/ultimate-browsing/engine/templates/**`,
`skills/programming/scripts/go/templates/**`, `skills/data-scientist/references/execution-templates.md`)
plus the QA lane `skills/dsh-qa/scripts/extension-template.mjs` — none of them is the root-level
`templates/` deliverable, which is absent exactly as the closure checker asserts
(`the allowlist carries no templates/ entry`).

This is also the mechanical explanation of the T-51 deviation in §6.2: with no `templates/` in the
packed tree and the developer CLI importing from `src/` (which the packer also does not copy), the
packed artifact's `validate`/`scaffold`/`--self-test` cannot run. The two facts are the same
measurement seen from two sides; the deviation is disclosed, tracked and NOT fixed.

## 5. Single-re-pin invariant (asserted)

- `git diff -U0 VENDOR_LOCK.json` is **ONE hunk** (`@@ -20,3 +20,3 @@`) with **6 changed lines**
  (3 removed, 3 added): `fileCount 317 → 318`, the `source` prose (which now names the new
  `extension-template` case), and `treeSha 7a48fdad90cc30f9c1e71009be216aeb8b2a1de797eb2bb1897032c41f6b51aa
  → a8ba96b8108b2df3cce707e7b69d038f71514cea9e0c488683ba79012efc8d12`. No other asset block moved.
- The skills edits that invalidate that `treeSha` are in the SAME change set:
  `skills/dsh-qa/SKILL.md`, `skills/dsh-qa/scripts/extension-lifecycle.mjs`,
  `skills/dsh-qa/scripts/extension-mcp-bridge.mjs` (modified) and
  `skills/dsh-qa/scripts/extension-template.mjs` (new) — `git status --porcelain -- skills/ VENDOR_LOCK.json`
  shows exactly these five paths.
- `node scripts/verify-vendor.mjs` → exit 0 (PASS), i.e. the re-pinned `treeSha` matches the corpus
  as committed in this change set. One writer, one re-pin (AGENTS.md §9/§11).
- Raw: `raw/ledger-repin.txt`, `raw/gate-verify-vendor.txt`.

## 6. Deferred / waived items (why they were NOT done)

1. **F6 — the eight pre-`c239407` evidence directories were NOT re-run.** They are inventoried and
   boundary-marked by `evidence/extensions/boundary-index/INDEX.md`; none was re-run, edited or
   deleted. Reason: their verdicts are historical records of a pre-rewrite interface; re-running them
   would replace evidence rather than add it. The index's §C inventory is itself a 14:20 snapshot, so
   the six evidence directories created LATER in the wave (`boot-repeat`, `docs-claims`,
   `verify-code-template`, `verify-docs`, `verify-skills`, `extension-template`, plus the later
   sub-runs) are deliberately not listed there — the inventory is complete only up to its snapshot
   time, and this ledger is the newer census (`freeze-manifest.json` `changeSet`).
2. **The packed-tree CLI is broken BY DESIGN this wave — it is NOT fixed.** `scripts/pack-mpd.mjs` is
   read-only for the wave (sha256 `8beb91c3…` at HEAD, unchanged) and the defect is tracked as
   `.mpd/TODO.md` **T-51**: the packer copies only `packages/<pkg>/dist`, while the developer CLI
   imports its validator from `src`, so inside `dist/mpd-package/` every CLI entry point exits 1 with
   `Cannot find module '<packed>/packages/mpd-ext-plugin/src/registry.ts'`; with `src` restored,
   `validate` runs while `scaffold` and `--self-test` still need a `templates/` entry that is not
   packed. Measured by `evidence/extensions/template-scaffold/20260916T063710Z/raw/packed-tree-probe.json`
   (arms A and B). The docs disclose it (report §12 "One measured deviation", guide §7) and describe it
   as NOT fixed; no row calls it fixed.
3. **Plan §7 D-1…D-4 and the wider `.mpd/TODO.md` friction register are OUT of this wave's scope.**
   D-1 (a ready entry task of a fresh team not dispatched), D-2 (a silence hold latching before the
   first attempt), D-3 (wake noise) and D-4 are recorded for the NEXT wave, as the user directed.
4. **`skills/**` had ONE writer and the wave carries exactly ONE `VENDOR_LOCK.json` re-pin** (§5):
   `317/7a48fdad… → 318/a8ba96b8…`, in the same change set as the skills edits. No second re-pin exists.
5. **The other adapter rows stay silent (accepted residual, recorded by t22).** Only `mpd-ext` and
   `mpd-roles` warn on the fallback; the twelve other rows carrying the same
   `ctx.get("mpdDsh") ?? createDshAdapter(ctx)` expression are out of the fix's scope and unedited.
6. **T-47 (recorded by t7, deferred by the captain, NOT opened):** 11 of the template's 13 snippet
   fields are not quoted in the template's own README pair (only `mcp.transport` and `mcp.command` are),
   so a drift in those snippets would be invisible to a doc-parity check.
7. **T-52 (friction):** `t19`'s task record has an EMPTY `output` — its first completing call was
   rejected for a missing per-item `status`, the corrected call omitted the summary, and a later update
   was refused because a terminal task is immutable. **t19's summary in this ledger is therefore taken
   from its artifact, `evidence/extensions/template-scaffold/20260916T063710Z/result.json`**
   (`task: t19`, `kind: repair (round 2)`, subject "t14 round-1 findings against t5: role-name guard +
   atomic write, README copy-context/unpacked/serverName-bound/roles-pair corrections", with
   `changed_paths` and `findings_addressed`), never from the task record's prose.
8. **Honest bound from t24 (not a defect):** six real boots cannot prove the loader window is
   unreachable; t24-F1 records the loader window as a MEASUREMENT, not a guarantee.
9. **Report §6 vs §12 wording is intended, not drift:** §6 still reads `F8 (low, WAIVED this wave)` /
   `F9 (low, same waiver family)` while §12 marks them fixed; §12's preamble states the §6 register is
   left unchanged on purpose as the audit's own record of what it found.
10. **WAIVED GATE (a) — `bun test packages` from the REPO cwd is excluded from the amended list by the
    captain.** Reason: a PRE-EXISTING, non-hermetic test (`packages/mpd-config-plugin/test/settings-
    wiring.test.ts:352` and `:419`) asserts that `<cwd>/.mpd/mpd.jsonc` does not exist, while this
    workspace deliberately HAS that gitignored file (the captain's watchdog tuning). Evidence: repo cwd
    753 pass / 2 fail (`raw/gate-bun-test-packages.txt`); the same file from a clean cwd 23/0
    (`raw/control-config-test-clean-cwd.txt`); the WHOLE suite from a clean cwd 755 pass / 0 fail, exit 0
    (`raw/control-bun-test-packages-clean-cwd.txt` and the attempt-5 re-run
    `raw/attempt5-unit-clean-cwd.txt`); `git status --porcelain packages/mpd-config-plugin` empty, the
    plugin + tests unchanged since `a647d47` (before this wave). The amended list uses the clean-cwd
    invocation (row 1).
11. **WAIVED GATE (b) — `bun run test:qa:all` is excluded because it is NOT runnable on this host.**
    Reason: it aborts at lane 1 of 27 (`agent-teams-adopt`) with `MISSING_CREDENTIAL: llm-deepseek: no
    API key for provider route "deepseek-official"`; `DEEPSEEK_API_KEY` is unset and
    `~/.dsh/.credentials.yaml` carries no entry for that route (captain-verified). Evidence:
    `raw/gate-test-qa-all.txt` (the abort, lane 1's `result.json`, and the boot log that shows every
    wave row mounting correctly). The aborting lane is untouched by this wave. **The suite is NOT
    claimed as passed**; the four wave lanes were run individually instead (rows 11–14 of §3, all exit 0
    / `ok:true`).

### Two recorded readings that need a line each (found by reviews, NOT defects)

- `evidence/extensions/debranding-probe/20260916T061807Z/result.json` records the boundary `INDEX.md`
  as **"9075 bytes"**, while the frozen artifact is **9101 bytes** (sha256
  `37c1208d41b0b56513b0ba9ad516ffabb95a1fc07520faf36f1d4d79ecd6b06f`). The informational reading
  predates the final write; the DIGEST, not the byte count, is what the record pins.
- `INDEX.md` §C is a **snapshot taken at 14:20**: the six evidence directories created later in the
  wave are not listed there. Stated explicitly so the inventory is not read as the complete census
  (this ledger's `freeze-manifest.json` is the later one).

### The evidence-overwrite incident (t11, self-reported) — quoted

From `evidence/extensions/verify-skills/20260916T064350Z/result.json`:

> `probe_report_overwrite_incident`: "while starting item 2 I ran the prober WITHOUT `--json-out`;
> the prober defaults its probe-list target to its own evidence dir, so my run rewrote
> `evidence/extensions/debranding-probe/20260916T061807Z/probe-report.json` (mtime 14:43:27; t7's other
> files 14:20-14:21)" — `rule_breached`: "the wave's 'pre-existing evidence is immutable' rule";
> `residual_honestly_stated`: "t7 recorded the prober's SOURCE hash (a8d1673c…) but not the original
> probe-report.json bytes, so byte-identity with the original cannot be demonstrated; content identity
> follows from the four bounds above"; `captain_ruling`: "accepted as disclosed, no rollback, recorded
> as friction item T-53 in `.mpd/TODO.md`".

> `evidence_immutability_recheck`: `verdict: "passed"` — "re-hashing the 356 snapshot files and
> re-serializing the same order reproduces
> `441c5ba89620c937f2908c1e9543cb2a063c2a14f32ecee36372b8f3e42d4124` exactly: modified=0, missing=0"
> (archive digests: `hashes-before.txt` and `hashes-after.txt` BOTH hash to that value);
> `added_since_snapshot`: "17 new files (legitimate new sub-run directories written by the owning
> tasks)"; raw: `raw/immutability-recheck.json` + `raw/immutability-recheck.log`.

The recheck was performed by the recommender's own corrective recomputation — i.e. the integrity of
t7's 13 directories / 356 files is asserted by reopening t7's archived snapshot, not by trusting prose.

## 7. Side effects of the mandated gates (disclosed)

Running `bun run test:qa:all` (attempt 2) or the lanes individually (attempt 5) executes QA lanes, and
every lane writes its OWN evidence directory. The t17 inScope list names only some of them, so for the
record, the sweep and the individually re-run lanes created exactly these evidence directories (a
before/after census of `evidence/*/*/` was taken; `raw/freeze-recheck.txt` is the digest comparison):

| Created by | Path |
|---|---|
| gate `test:qa:all`, lane 1 (attempt 2) | `evidence/plan-c/c1-team/2026-09-16T07-16-22.160Z/` (the aborting lane's own record) |
| attempt-2 lanes (`--no-skip`) | `evidence/dsh-qa/bundle-lifecycle/2026-09-16T07-19-44.444Z/` |
| attempt-2 lanes | `evidence/dsh-qa/preset-conformance/2026-09-16T07-20-00.878Z/` |
| attempt-2 lanes | `evidence/extensions/extension-template/2026-09-16T07-20-35.928Z/` |
| attempt-2 lanes | `evidence/extensions/extension-lifecycle/2026-09-16T07-20-41.691Z/` |
| **attempt-5 lane** (amended list, row 11) | `evidence/dsh-qa/bundle-lifecycle/2026-09-16T07-27-41.147Z/` |
| **attempt-5 lane** (row 12) | `evidence/extensions/extension-template/2026-09-16T07-27-58.479Z/` |
| **attempt-5 lane** (row 13) | `evidence/extensions/extension-lifecycle/2026-09-16T07-28-04.884Z/` |
| **attempt-5 lane** (row 14) | `evidence/extensions/extension-mcp-bridge/2026-09-16T07-28-37.428Z/` |

No file inside a wave deliverable was modified by any gate. The digest recheck compared all 42
baseline change-set entries against a fresh manifest after the sweep:
**17/17 tracked modified files unchanged, 0 drift**; every frozen evidence directory
(`f1-adapter-identity`, `boundary-index`, `debranding-probe`, `pack-closure-check`, `docs-claims`,
`template-scaffold`, `verify-skills`) kept its tree digest. The only entries whose digests moved are the
lane directories above (their new sub-runs) and this ledger's own directory (self-referential) — both
expected, both listed here. Raw: `raw/freeze-recheck.txt`, `raw/freeze-manifest-after-gates.txt`,
`raw/attempt5-freeze-manifest.txt` (the attempt-5 re-verification: same HEAD, same 17 digests,
0 unexpected drift).

## 8. What this ledger does NOT claim

- It does **not** claim `bun run test:qa:all` passed: the suite is a WAIVED item (§3, §6.11) and no row
  or sentence asserts otherwise.
- It does not claim the wave is releasable while a waived gate hides a real defect: both waived commands
  are recorded with the full diagnosis, and the two follow-ups remain the captain's; nothing was
  repaired here (the integration seat does not repair).
- It does not cite `dsh --dump-config` as load evidence anywhere; the mount evidence is the real
  sandboxed boots in the lanes (AGENTS.md §4).
- It does not restate any pre-`c239407` verdict as a present-day result (F6).
