# t4 — standing gates + RTL-named guards after the RTL extraction

Measured tree: `32ae54dd10db7ea46e1c1263143d56f266fd1f78` (`dev`, `chore(lsp-setup): retire the orphan HDL pages … (t17)`),
tracked tree clean at the first observation. Comparison baseline for "before the extraction":
`3d99718047c696cde45e053cbc66b66c6d7ab9cc` (`merge(fix): waves 1-3 closeout …`), the parent of
`12291a7 feat(rtl-extraction): remove the RTL surface from the mpd repo`. All raw logs are in `raw/`
next to this file; every command below was executed in this task, verbatim, with its own log.

## Command inventory (commands 1–9)

| # | Command | Exit | Raw log | Verdict |
|---|---|---|---|---|
| 1 | `node scripts/verify-vendor.mjs` | 0 | `raw/verify-vendor.log` | PASS — vendor baseline coherent |
| 2 | `node scripts/verify-rtl-references.mjs --json` | 0 | `raw/verify-rtl-references.json` (+ `.err` empty) | PASS — 48 considered, 0 unresolved |
| 3 | `node scripts/verify-rtl-references.mjs --self-test` | 0 | `raw/verify-rtl-references-self-test.log` | PASS — falsifiable controls + live audit |
| 4 | `node scripts/verify-rows-parity.mjs` | 0 | `raw/verify-rows-parity.log` | PASS — 21 row ids match the patch insert list |
| 5 | `bun test packages` | **1** | `raw/bun-test-packages.log` | **RED — 295 pass / 3 fail**, pre-existing (see F2) |
| 6 | `bun run typecheck` (`tsgo --noEmit`) | 0 | `raw/typecheck.log`, `raw/typecheck-falsifiability.log` | PASS, falsifiable (deliberate error → exit 1) |
| 7 | `bun run test:qa` (every `--self-test`) | 0 | `raw/test-qa.log` | PASS — all self-tests, `[test:qa] all self-tests passed` |
| 8 | `node scripts/install-profile.mjs --dry-run` | 0 | `raw/installer-dry-run.log` | PASS — "DRY-RUN done (nothing written)" |
| 8b | `node scripts/install-profile.mjs --yes --dsh-home .mpd/tmp-installer-verify` | 0 | `raw/installer-isolated-yes.log` | PASS in an isolated home ("wrote profile/ home patch/ presets(1)"), sandbox deleted after |
| 9 | `bun skills/dsh-qa/scripts/preset-conformance.mjs` (mounting boot, isolated `DSH_HOME`+`HOME`) | 0 | `raw/preset-conformance.log` | PASS — 31/31 preset rows, real `session/create` 200 (`agentPreset: mpd`), negative control red, 0 apply-crash signatures |
| 10 | `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` (full install → mount boot → uninstall) | **1** | `raw/bundle-lifecycle.log` | **RED at the boot step** (see F1) |
| 10b | `node scripts/bootstrap.mjs` (preflight + vendor) | 0 | `raw/bootstrap.log` | PASS |

### Commands 1–4, 6–8, 10b — verbatim results

```
# 1 verify-vendor (tail)
[verify-vendor] commit OK: 8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29
[verify-vendor] version OK: 5.0.0-beta.20
[verify-vendor] stats OK: 9131 files / 1470231 loc
[verify-vendor] asset OK: skills 329 files
...
[verify-vendor] PASS

# 2 verify-rtl-references --json (tail)
  "unresolved": []        # exit 0; considered: 48

# 4 verify-rows-parity
[verify-rows-parity] ok: 21 row ids match the bundle patch insert list (agent-teams, mcp-astgrep,
  mcp-codegraph, mcp-context7, mcp-gitbash, mcp-grepapp, mcp-lsp, mpd-bootstrap, mpd-boulder,
  mpd-codegraph, mpd-comment-checker, mpd-config, mpd-dsh-adapter, mpd-hashline, mpd-memory,
  mpd-modelchain, mpd-roles, mpd-tools, mpd-ulw, mpd-web-compat, mpd-workmate)

# 6 typecheck
$ tsgo --noEmit          # exit 0, empty output
# falsifiability: packages/mpd-config-plugin/src/__tsgo_probe.ts with `const x: number = "…"` →
#   packages/mpd-config-plugin/src/__tsgo_probe.ts(1,14): error TS2322 → exit 1 (probe file removed)

# 7 test:qa (tail)
[test:qa] all self-tests passed

# 8 installer
[install-profile] DRY-RUN done (nothing written); add --yes to actually install …
# 8b isolated --yes
[install-profile] wrote profile/ home patch/ presets(1) + web-compat shim @mpd-dsh/mpd
```

### Command 5 — `bun test packages`: 3 failures, pre-existing (not caused by the extraction)

```
(fail) F3: healing a RE-MATERIALIZED upstream file refuses instead of emitting a broken module
(fail) t9: a re-materialized tools.js is REFUSED, byte-untouched, with key counts unchanged
(fail) t9: the targeted re-materialize shape (upstream twins restored at the literal) is REFUSED too
 295 pass
 3 fail
Ran 298 tests across 64 files. [13.72s]
```

Cause: `packages/mpd-agent-teams-plugin/self-fix-tests/{registry-context-heal,scope-glob-and-contract}.test.mjs`
build their "pristine upstream" fixture with `git show HEAD:packages/mpd-agent-teams-plugin/lib/tools.js`
(resp. `…/quality-gates.js`) and assert it carries **zero** `mpd-delta` markers. `d510a16` committed the
delta bodies INTO that file, so HEAD now carries 10 markers and the fixture premise is false:

```
$ git show HEAD:packages/mpd-agent-teams-plugin/lib/tools.js | grep -c mpd-delta
10
```

Both sides of that comparison are byte-identical to the pre-extraction commit:

```
$ git diff --stat 3d99718 HEAD -- packages/mpd-agent-teams-plugin/          # (empty)
$ git diff --stat 3d99718 HEAD -- packages/mpd-agent-teams-plugin/self-fix-tests/  # (empty)
```

and the same two test files fail on a detached worktree of `3d99718` itself
(`raw/bun-test-baseline-3d99718.log`, 68 pass / 6 fail — the failing assertions appear twice because both
test files run their `re-materialize` case), so the red gate predates `12291a7` and is not a product
regression of the extraction. It still leaves gate 5 red on the current tree (finding F2).

### Command 10 — `bundle-lifecycle`: the boot gate is RED, and the extraction is its cause (F1)

```
[bundle-lifecycle] ok=false
  install:      {"ok":true,… "bundles":["…dsh-base","…dsh-web-app","@mpd-dsh/mpd"]}
  composed:     {"ok":true,"exit":0}
  boot:         {"ok":false,"http":true,"corpus":"<repo>/skills","trust":"system",
                 "adapterSeams":"tools,…,skills,skillsProvider"}
  noHomeCopy:   {"ok":true,"skills":[],"presets":[]}
  uninstall:    {"ok":true,…}
```

The boot log shows the probe's own verdict lines (from `boot.log` in
`evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-37-13.539Z/`, copied into `raw/bundle-lifecycle.log`):

```
[roles-probe] PRESET_MPD=ok
[roles-probe] ADAPTER_TOOL_CALL=ok
[roles-probe] ROSTER=oracle,librarian,prometheus,hephaestus,sisyphus,atlas,explore,metis,momus,multimodal-looker,sisyphus-junior
[roles-probe] SKILLS=19 BUNDLED=19
[roles-probe] SKILL_FIXTURE=ok name=svn-master bytes=5210
[roles-probe] FAIL
```

The only unsatisfied conjunct is `bundled.length >= 20`
(`packages/mpd-qa-roles-probe/src/index.ts:53,282`; the built `dist/index.js` carries the same `>= 20`).
The extraction deleted the three RTL skill trees, so the bundled corpus moved 22 → 19:

```
$ git ls-tree --name-only 3d99718 skills/ | wc -l     # 22  (incl. rtl-codestyle, rtl-ip-flow, rtl-verif)
$ ls -d skills/*/ | wc -l                              # 19  (the three rtl-* trees gone)
```

Baseline proof on a detached worktree of `3d99718` (created under `.mpd/`, removed again after the
run so the worktree list and `git status` stay clean), same case, exit 0
(`raw/bundle-lifecycle-baseline-3d99718.log` — its summary lines were preserved there, since the
worktree carried the case's own evidence dir away with it):

```
[roles-probe] SKILLS=22 BUNDLED=22
[roles-probe] PASS
[bundle-lifecycle] ok=true
```

So the boot gate was green before the extraction and is red after it, with the probe threshold as the
only failing assertion: the extraction left a repo-level QA guard whose expected corpus size no longer
matches the shipped corpus. Remedy (repair stage): re-baseline the probe's corpus expectation to the
shipped corpus (e.g. `>= 19`, or derive it from the served bundle listing, or explicitly name the
fixtures) — outside this task's `inScope` (`evidence/**` only).

## RTL-named guards / cases / table rows — live-subject verdicts

Every row below quotes the source line that defines its subject, and records whether that subject
still exists after the extraction (hash of the guard/case itself in `raw/subject-hashes.txt`).

| RTL-named item | Live subject? | Quoted source line / evidence |
|---|---|---|
| `scripts/verify-rtl-references.mjs` (repo-level guard) | **LIVE** — the subject moved to the silicon bundle | header L4-6: *"resolve every path reference that survives in the RTL material after the extraction … Scope: the six ported RTL documents (silicon `docs/`) and the two repointed RTL QA cases"* (`raw/quoted-source-lines.txt`); real run: 48 references, 0 unresolved; `--self-test` controls (resolved / pending / unresolved negative control) all fire |
| `skills/dsh-qa/scripts/rtl-verif.mjs` (QA case) | **LIVE** — silicon owns the plugin/corpus/profile it probes | L2-6: *"now against the @mpd-dsh/silicon bundle, which owns the mpd_verif_* plugin, the RTL corpus and the rtl-ip profile data. Repointed in t19"*; L33-36 root/asset constants (`SILICON`, `VERIF_DIST = <silicon>/packages/mpd-verif-plugin/dist/index.js`, `SKILLS`, `PRESET`); on-disk: silicon `dist/index.js` present, `skills/{rtl-codestyle,rtl-ip-flow,rtl-verif}` present. Offline `--self-test` PASS (`raw/rtl-verif-self-test.log`); real pass **blocked by F3** |
| `skills/dsh-qa/scripts/rtl-ip-profile.mjs` (QA case) | **LIVE** — the profile definition is silicon data | L4-9: *"Owner after the RTL extraction: the definition lives in the @mpd-dsh/silicon bundle as DATA (presets/rtl-ip.profile.json), while mpd keeps the single agent-teams row that injects it (the t15 carrier). … Repointed in t19"*; offline `--self-test` PASS (`raw/rtl-ip-profile-self-test.log`); manual substitute run proves the subject really composes: `dsh plugin add <silicon>` `--store-dir` fixed → exit 0, `dsh --profile rtl-ip-qa --dump-config` composes `silicon-dsh-adapter`, `silicon-bootstrap`, `silicon-verif`, `silicon-mcp-lsp` (`raw/rtl-ip-profile-manual-add2.log`, `raw/rtl-ip-profile-manual-dump2.log`); the case's own real pass is **blocked by F3** |
| `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` | **LIVE** — in-repo LSP template with in-repo consumers | `packages/mpd-mcp-lsp/README.md:52`: *"A ready template lives at `templates/rtl-lsp-client.json` — merge its `"lsp"`"* (zh twin at `README.zh-CN.md:51`); the silicon docs still reference the same path (`docs/rtl-verif-guide.md:132`), which the guard's `resolved` bucket confirms |
| `skills/dsh-qa/SKILL.md:62` row `rtl-ip-profile` | **LIVE, but now probes silicon** | the row's assertion text: *"bundle patch ships the rtl-ip roster profile (7 members, four-stage flow markers) + rtl-ip-flow skill + 4 document templates + bilingual guide; composed boot shows the profile in the agent-teams row config"* — stale for the mpd side (the rtl-ip data now lives in the silicon bundle and is injected by the t15 carrier); the case file itself is repointed (see above) |
| `packages/mpd-qa-roles-probe/src/index.ts` (RTL-coupled expectation) | subject live, expectation stale | L13 `const ROSTER_IDS = [...11 roles]`; L15 `const FIXTURE_SKILL = "svn-master"`; L58 `catalogOk = fixture !== undefined && bytes > 100 && bundled.length >= 20`; L62 `const ok = … && catalogOk` — the `>= 20` at L58 is the live mechanism behind F1 (built twin: `dist/index.js:282`) |
| `.gitignore:23-25` | n/a (comment/pattern, not a case) | `# RTL phase-1 scratch: research clones (.research/) and the workspace-local cocotb venv (.venv-rtl/, .venv*)` / `.venv-rtl/` — still accurate for the leftover `<repo>/.venv-rtl` (44 MB, untracked) |

Untracked RTL-named environment leftovers observed while checking liveness (reported, not resolved —
they are inside `t1`'s sweep scope, and outside this task's `inScope`): `<repo>/.venv-rtl` (44 MB) and
`<repo>/.toolchain/bin/verible-verilog-ls` (6 MB, Aug 31). Neither is tracked, so neither changes
`git status`.

## Artifacts written by this task

- `evidence/rtl-extraction-residual/gates/gates.md` (this file)
- `evidence/rtl-extraction-residual/gates/findings.md`
- `evidence/rtl-extraction-residual/gates/raw/` (27 files: every command log above, the baseline
  comparison logs, `subject-hashes.txt`, `quoted-source-lines.txt`, `git-status.txt`)
- Two gate runs wrote their own evidence dirs as part of their contract (they always do):
  `evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-37-13.539Z/` and
  `evidence/dsh-qa/preset-conformance/2026-09-13T07-36-29.035Z/`. Both are gate-generated byproducts
  (directory-untracked only, same as every historical case run); **no tracked file was modified by this
  task** — `raw/git-status.txt` shows the tracked tree clean before and after, with only `??` entries.
