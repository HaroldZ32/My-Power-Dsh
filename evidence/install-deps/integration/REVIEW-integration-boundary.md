# t16 — adversarial read-only pass at the integration boundary (Architect)

**Scope:** the wave's frozen change set judged AS AN INTEGRATION (parity, counted claims, QA falsifiability,
evidence hygiene, carried bounds). **Not** a guard-predicate pass — review round 3 (t15) owns the predicate's
false-positive/false-negative behaviour and I did not re-run those probes.
**Measured** 2026-09-20T04:28:31Z–04:31:05Z UTC. **Read-only:** the only writes are this file and a dated
correction appended to my own `INTEGRATION-READINESS.md`; no re-pack, no redaction, no gate sweep, no git.

**Verdict: `needs_revision`** — two acceptance criteria of this pass fail *at this instant* (I-1 packed-leg
parity, I-2 evidence tokens). **No defect was found in the source change set itself**; every required remediation
below is one command or three text fixes, and all of them belong to t7's own pending sequence.

---

## 1. Triple parity (re-derived from the bytes)

| Leg | Artifact | sha256 | Sidebar guard scalar |
|---|---|---|---|
| source | `packages/mpd-bundle/cordis.patch.yml` | `1b316b68850fbe3958b16088ac723abcd50faabd178668de7ed6044811107e8f` | 5922 chars |
| installer | `scripts/install-profile.mjs#SIDEBAR_GUARD` | `2809ccfc23b37fd9f8eff73d0feb689397fc92c7c958aec93d39045049affc67` | 5922 chars — **byte-identical to the patch** |
| packed | `dist/mpd-package/cordis.patch.yml` | `e70a179e1ed13c5e4fa9926fb89fda9de4e17c1935aac1d517b37fa0b7b4b28e` | **3384 chars** → pre-repair guard |

* **installer ↔ patch: PASS.** I round-tripped the installer's literal (`JSON.parse` of the `const SIDEBAR_GUARD = "…"`
  string, then re-serialised as `!!js "…"`) and compared it with the patch's `disabled:` scalar: equal at 5922
  characters. The installer's own self-test arm (`renderRow`'s `disabledYaml` branch) asserts the same pair.
* **packed manifest ↔ root manifest: PASS.** Both declare `dependencies = {"dsh-better-sidebar":"0.19.0-alpha.1"}`,
  identical `optionalDependencies`, and the packed manifest keeps `dsh.client {inject:[],platform:"web"}` and
  `dsh.bundle.patch "./cordis.patch.yml"`.
* **packed patch ↔ source patch: FAIL → finding I-1.** The packed copy is the pre-repair guard. Repair F1 (t14)
  grew the source guard from 3384 to 5922 chars and the derived artifact was not regenerated.
* The last packed-leg check on record is `evidence/install-deps/repair-r2/pack-verified-sha256.txt`, pinned to
  `e70a179e…` — i.e. it covered the round-2 body and no longer covers the shipped one. `dist/**` is gitignored,
  so the COMMIT's tree is unaffected, but any tarball built from `dist/mpd-package` ships the pre-F1 guard and
  t7's own acceptance item R7 is unsatisfied at this revision.

## 2. Counted claims (re-derived from the shipped files)

Live rows in `packages/mpd-bundle/cordis.patch.yml`: **26 inserts + 2 id-targets = 28 `- id:` entries**
(`- id: agent-presets`, `- id: dsh-tui-agent-presets` are the id-targets; `mpd-better-sidebar` is insert #1 of
the first insert block). Every counted sentence agrees:

| Claim source | Sentence | Shipped reality |
|---|---|---|
| `README.md` | "**26 rows this bundle INSERTS** … **2 host rows it id-TARGETS**" + "verify-rows-parity asserts the 26 insert ids" | 26 / 2 |
| `README.md` | group breakdown 18 bundle plugins + 4 in-repo MCP + 1 adopted + 1 sidebar host + 2 remote MCP | 18+4+1+1+2 = 26 |
| `README.zh-CN.md` | 26 insert / 2 id-target | 26 / 2 |
| `docs/design.md` | "**26 inserted rows** … **2 id-targets**" | 26 / 2 |
| `docs/design.zh-CN.md` | 26 ids / 2 id-targets | 26 / 2 |
| `node scripts/verify-rows-parity.mjs` | exit 0, names all 26 insert ids incl. `mpd-better-sidebar` | 26 |

**Trap recorded (I-5, informational):** a naive `grep -c "- id: "` returns **30**, because two rows are COMMENTED
out (`# - id: mcp-wave-mcp`, `# - id: mcp-traceweave`). No shipped sentence uses 30; do not "fix" the docs toward it.

## 3. The QA lane's falsifiability — PASS

* **RED anchor exists after the prune** and no prune pattern matches it:
  `evidence/install-deps/red-baseline/20260920T030832Z/composed-config.txt` (sha256
  `686af33a7730433ff9fa84a7832dd80ca8ed5634ca48a666082ec7e23945db05`), with `result.json` recording
  `better_sidebar_rows: 0`, `mpd_rows: 18`, `measured_at_utc 2026-09-20T03:08:32+00:00`, the pre-fix source hashes,
  and the honest label "composition only … proves the row is ABSENT, never a plugin load".
* **Independently re-derived:** I counted the artifact myself — **0** occurrences of `dsh-better-sidebar` and
  **18** `- id: mpd-` rows. The anchor is real, not asserted.
* **The arm that would redden:** `bundle-only`'s `rows >= 1` plus its served-client assertion — if the row left the
  patch, the same composition predicate parses 0 rows (exactly what the RED artifact records). Negative controls
  exist in the other direction (aggregate arms; arm 5's `404`/not-served half) and the self-test pins both
  `servedClientCarriesSidebar(...) === true/false`.
* **Wiring:** `skills/dsh-qa/cases.json` → lane 12 `{case: install-dependencies, script: …install-dependencies.mjs,
  suites: ["all"], prereq: [absent-dsh-binary, absent-fixture]}`; `skills/dsh-qa/SKILL.md` carries the case row.
  `node scripts/run-qa-lanes.mjs --check-drift` → exit 0, "manifest and disk agree (54 entries, 48 lane script(s)
  discovered, 0 unlisted)".
* Bound: the RED anchor is a STORED pre-fix composition dump, so the falsifiability rests on the same parser being
  used for both; the lane's `--self-test` re-asserts that parse offline. Acceptable, stated.

## 4. Evidence hygiene for the commit — FAIL on tokens (I-2), citations nearly clean (I-3)

* **Prune: DONE and coherent.** `evidence/install-deps` is now **373 files / 5.7 MB**, all of them outside the
  declared prune patterns; **0** `.credentials.yaml`/`settings.yaml` copies survive anywhere in it; **0** symlinks
  exist outside the prune dirs (so the redactor's `statSync` recursion cannot loop here).
* **Tokens: 107 files / 53 distinct values** still carry `token=<43-char DSH web token>` at 2026-09-20T04:31:05Z
  (subtree counts: verification 48, qa-case 18, repair-f1 10, repair-r2 10, implementation 9, verification-final 5,
  guard-probes 3, captain-cross-check 2, integration 2). **The redaction has not been run.** Required by AGENTS.md
  §10 and by t7's acceptance item 3 → I-2.
* **The instrument is sound** (`evidence/install-deps/integration/redact-tokens.mjs`, judged not run): in-place,
  replaces only the secret with `token=<redacted:Nch>`, preserves line count and structure (so a citation keeps
  resolving), skips the pruned sandbox trees, defaults to a dry run, walks only `evidence/install-deps`. Two notes
  rather than defects: it does not touch `.credentials.yaml` (moot — 0 on disk, and `.gitignore` line 18 covers
  that name), and `statSync` follows symlinks (use `lstatSync` if a future wave ever symlinks inside the evidence
  tree).
* **Citation sweep: 376 files scanned, 216 distinct cited `evidence/install-deps/…` strings, 39 unresolved strings
  → 3 genuine dangling anchors (I-3)** and four non-defect classes:
  * **Genuine:** (a)+(b) `repair-f1/qa-case-rerun/2026-09-20T04-23-33.669Z/result.json` and
    `repair-r2/qa-case-rerun/2026-09-20T03-59-54.395Z/result.json` record `arms.3.load.paneFile` and
    `arms.3.load.logFile` under the CANONICAL `evidence/install-deps/qa-case/<ts>/tui-tui-plane/`, a directory that
    does not exist; the files DO exist beside them (`repair-*/qa-case-rerun/<ts>/tui-tui-plane/`).
    (c) `captain-cross-check/20260920T034916Z-f3-repro/result.json` cites
    `captain-cross-check/20260920T033505Z/result.json`; the directory on disk is `20260920T033545Z`.
  * **Not defects:** `verification/…/verification-summary.json`'s `bootLogMissing` field (an honest marker that
    `logs/F5-web-layer-after.boot.log` is absent); `repair-r2/RESULT.md`'s `--out …/repair-r2/pack` (a command line
    whose staging tree was deliberately removed, with the two kept artifacts explained at `pack-verified/`);
    `verification/prune-check.json` (the prune's own manifest of what it removed); boot logs and
    `implementation/scratch/*` printing their now-pruned sandbox cwds (historical log text, not anchors).

## 5. The four carried bounds — PASS (all present, with citations)

| Bound | Where it is named |
|---|---|
| R6 legacy installer row-id mirroring (pre-existing) | `evidence/install-deps/review/RESULT.md` (R6 row), `repair-r2/RESULT.md` §5.4, `review/RESULT2.md` |
| R8 round-1 fiber witness unavailable by construction | `review/RESULT2.md` (R8 row, with the named substitutes) |
| A sidebar mounted from CODE is invisible to a declaration scan | `repair-r2/RESULT.md` §5.1, `implementation/README.md` §6.3(a) |
| Legacy installer writes the row without installing the package (degrades, boot green) | `implementation/README.md` §6.2 |

## 6. Other findings from the read

* **I-4 (low, no block).** `AGENTS.md` §1's adopted-plugin bullet still carries only the pre-wave half of the
  mechanism ("pnpm never links a bundle's transitive deps into the profile root — see §12"). It is literally true
  for the ADOPTED plugin (main code, not a dependency) and `agent-references/troubleshooting.md` now carries the
  modern picture ("the sidebar host is a DECLARED dependency of the bundle mounted by the `mpd-better-sidebar`
  patch row"), so this is omission, not error. Fix if convenient: add the `healProfileModuleFallback` half, the way
  `scripts/pack-mpd.mjs#writeManifest` and `docs/design.md` already do. AGENTS.md is outside my scope.
* **I-6 (informational).** My own `evidence/install-deps/integration/INTEGRATION-READINESS.md` §3.3 said R7 was
  already closed (packed ≡ source). Repair F1 re-opened exactly that. I appended a dated correction to that file.
* **Positive:** `bun.lock` carries `dsh-better-sidebar@0.19.0-alpha.1` with its resolved tarball + `sha512`, exactly
  matching `package.json`; the sidebar row's own comment block in the patch states the R1/R3/R4 hardening and the
  five-step ROW RULE verbatim, so a reviewer can test the contract without reading the JS.

## 7. Findings

| id | severity | problem | requiredFix | would block the commit |
|---|---|---|---|---|
| I-1 | high | `dist/mpd-package/cordis.patch.yml` still carries the pre-repair guard (3384 chars, sha `e70a179e…`) while the source carries the shipped F1 guard (5922 chars, sha `1b316b68…`); the packed manifest's dependency arm is fine | `node scripts/pack-mpd.mjs` (or delete `dist/mpd-package/`) in t7, then re-run the packed-leg parity check; note `repair-r2/pack-verified-sha256.txt` is pinned to the old hash | **yes** |
| I-2 | high | 107 kept evidence files carry 111+ DSH web-server access tokens (53 distinct) at 04:31:05Z — AGENTS.md §10 forbids tokens in committed evidence, and t7's acceptance names this item | `node evidence/install-deps/integration/redact-tokens.mjs --write`, then re-scan (`grep -rl 'token='`) for 0; optionally harden the walker with `lstatSync` | **yes** |
| I-3 | medium | 3 dangling anchors: the two `qa-case-rerun/*/result.json` `arms.3.load.{paneFile,logFile}` point at canonical `qa-case/<ts>/tui-tui-plane/…` (absent) and `captain-cross-check/20260920T034916Z-f3-repro/result.json` cites `…/20260920T033505Z/result.json` (disk: `20260920T033545Z`) | rewrite those 5 path strings to the real locations (or copy the two pane files to the canonical dirs), then re-run the citation sweep | **yes** (letter of the acceptance; three text fixes) |
| I-4 | low | `AGENTS.md` §1 states only the pre-wave half of the dependency mechanism | add the `healProfileModuleFallback` half (pattern already shipped in `scripts/pack-mpd.mjs#writeManifest`, `docs/design.md`) | no |
| I-5 | info | `grep -c "- id: "` returns 30 vs the shipped 28 because two rows are commented out | none — recorded so no doc is "corrected" toward 30 | no |
| I-6 | info | my readiness artifact's R7 paragraph was superseded by repair F1 | corrected in place with a dated note (done in this pass) | no |

## 8. What this pass could NOT check

1. **The guard predicate's behaviour** (decoy/parse-miss directions) — owned by review round 3 (t15); I consumed the
   round-2 verdict instead.
2. **The gate sweep** (`verify:vendor` post-re-pin, `verify:dist-fresh`, `verify:docs`, `verify-pack-closure`, `test:qa`)
   — t7 owns it; I ran only the two cheap read-only checks that my own acceptance names (`verify-rows-parity`, the
   lane drift check).
3. **Any live boot.** Every claim here is read from artifacts; no composition or boot was re-run.
4. **`dist/**` after a re-pack** — the packed leg must be re-judged once I-1 is fixed.
5. **The docs' bilingual parity gate** for the newly edited doc pairs — `bun run verify:docs` is part of t7's sweep.
6. **`.mpd/team/**` state** — read-only by policy; not inspected.
