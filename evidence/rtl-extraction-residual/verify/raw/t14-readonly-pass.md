# t14 read-only pass — evidence for the t13 manifest blocker

Task: t14 (Researcher, read-only role). Date: 2026-09-13.
Target artifact: `evidence/rtl-extraction-residual/verify/addendum-manifest.md` (t13-owned).
**No file was edited by this task.** The findings and the ready-to-apply patch text are in the
task's completion payload / captain mail; this log holds the measurements they cite.

Raw logs for this pass: `raw/t14-*.log` (this directory).

## 1. The target file is a MOVING TARGET (measured, not inferred)

Three successive reads of the same path, all within this task's window:

| Read | Size (B) | Lines | sha256 |
|---|---|---|---|
| first read (≈16:00:5x) | 38582 | 336 | `99bce33d45ee7b82207658a3432a84b84fcd8957286ae97fc1533a6a6bdd9d3e` |
| second read (16:01:15) | 38623 | 336 | `2d6bb047d44a2355d017f2448196c6fdd2646a2ef637ae4c2a310df0515f1f98` |
| third read (16:02:44, stable over 3 probes) | 38847 | 336 | `357585a7cd9ec5e1c2cd1199f7b406b4178b2920112f4ffe1a093d31ca68c788` |

Line count stayed 336 while size grew 265 B — a **line-level edit by another writer**, not a
whitespace-only touch. The task statement itself pins the r3-era manifest at **336 lines / 38582 B**,
which matches my first read, so the file moved *during* this task. Raw: `raw/t14-stability.log`.

## 2. Concurrent writer: the repair task (t8) is mid-flight on the same surface

`git status --short` (non-evidence entries), pasted at the third read:

```text
 M README.md
 M README.zh-CN.md
 M docs/adder4.md
 M docs/cnt8.md
 M docs/development.md
 M docs/index.md
 M docs/index.zh-CN.md
D  docs/rtl-gap-assessment.md
D  docs/rtl-gap-assessment.zh-CN.md
D  docs/rtl-ip-flow-guide.md
D  docs/rtl-ip-flow-guide.zh-CN.md
D  docs/rtl-verif-guide.md
D  docs/rtl-verif-guide.zh-CN.md
 M packages/mpd-agent-teams-plugin/lib/index.js
 M packages/mpd-agent-teams-plugin/lib/mpd-deltas.js
 M packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs
 M packages/mpd-agent-teams-plugin/self-fix-tests/scope-glob-and-contract.test.mjs
 M packages/mpd-bundle/README.md
 M packages/mpd-bundle/README.zh-CN.md
 M packages/mpd-mcp-lsp/README.md
 M packages/mpd-mcp-lsp/README.zh-CN.md
 M packages/mpd-mcp-lsp/dist/BUILD.lock
 M packages/mpd-mcp-lsp/dist/cli.js
 M packages/mpd-mcp-lsp/overlay/lsp/language-mappings.ts
 M packages/mpd-mcp-lsp/overlay/lsp/server-definitions.ts
D  packages/mpd-mcp-lsp/templates/rtl-lsp-client.json
 M packages/mpd-qa-roles-probe/dist/index.js
 M packages/mpd-qa-roles-probe/src/index.ts
 M scripts/build-mcp.mjs
 M scripts/patch-agent-teams-fixes.mjs
 M skills/dsh-qa/SKILL.md
 M skills/dsh-qa/scripts/dual-track-smoke.mjs
D  skills/dsh-qa/scripts/rtl-ip-profile.mjs
D  skills/dsh-qa/scripts/rtl-verif.mjs
D  tests/golden/fixtures/verilog/README.md
D  tests/golden/fixtures/verilog/modules/adder4.v
D  tests/golden/fixtures/verilog/modules/cnt8.v
D  tests/golden/fixtures/verilog/tb/tb_adder4.v
?? packages/mpd-agent-teams-plugin/self-fix-tests/fixtures/
?? skills/dsh-qa/scripts/software-smoke.mjs
```

This is repair-task activity (F1 probe fix in `packages/mpd-qa-roles-probe/`, F2 fixture fix in
`packages/mpd-agent-teams-plugin/self-fix-tests/`, F3+R1 doc/template removal, R3 case retirement).
It is the source of the manifest churn in §1.

## 3. The verification sites in the current revision (line numbers are of the third read)

| Site | Current text | Status |
|---|---|---|
| manifest `:40` | "the file's lineage is **225 → 326 → 333 → 338 lines** (see §4)" | **stale** — chain omits `395` and carries no FROZEN mark |
| manifest `:138` | addendum table row, `fada192f…` pinned, no snapshot label | **stale pin** (r1) |
| manifest `:147-150` | falsification check = "`sha256sum -c`-style comparison against the table above" | **unsafe** — table contains the superseded r1 row |
| manifest `:155` | "**225 → 326 → 333 → 338 → 395 lines**; `captain-attestation.md` §2.2" | correct chain, but no `review/CHANGELOG.md` citation |
| manifest `:184-185` | r1 row labelled "as indexed (r1)" + r3 row labelled "current (r3)" | live pin correctly superseded; **r1 row still unpinned from history semantics** |
| manifest `:186-188` | review.md rows 333 / 338 / 395(attested-derived) | lacks FROZEN + md5 `f3c69a63…` identity |
| manifest §4 | — | **no "hash discipline" note** |

## 4. Authority checks (all re-measured today)

| Fact | Measured | Authority |
|---|---|---|
| addendum current revision | r3, 181 lines, 14897 B, sha256 `596c26b07fae5faeae38843e672e3de2772f2f6cc79b50954390d8b6ebcb6ac2` | `verify/raw/addendum-revision-log.txt`; `captain-attestation.md` §1 |
| addendum r1 predecessor | 144 lines, sha256 `fada192f…e1cb3` | revision log line 3 |
| `verify/verdict.md` | sha256 `b527d1103ce3ee36d51366c9ad004770c78746a70453401200c0ab2f90a71a63` (matches the manifest pin) | — |
| `verify/false-negative-probes.md` | sha256 `24aa5ee0ef4e213e887da044be6d37595c12e1b1f5197226f690ef5ac83bf67d` (matches) | — |
| review.md frozen identity | 395 lines, 42475 B, md5 `f3c69a63cf6f5275484a94867f73b533`, sha256 prefix `826f9c5b83df766ba5c7a50d` | `captain-attestation.md` §1 (FROZEN) |
| review.md lineage | 225 → 326 → 333 → 338 → 395 (frozen) | `captain-attestation.md` §1/§2; `review/CHANGELOG.md` |
| `review/CHANGELOG.md` | present, 5261 B, 16:02:02, sha256 `702a2181053cec5eff7dd1ade80bdfddf253274bae295cca0ea7e40607020c7a` | readable companion |
| hash-discipline rule text | `captain-attestation.md` §0 (3 bullets) + §2.3 | captain-owned |

## 5. Outcome

The **content** plan for t14 is fully determined (see the findings in the completion payload for the
exact replacement text). The **edit** was not performed, for two independent reasons, both measured:

1. **Role scope** — this member's profile is read-only ("never edit files"; the roster deny list
   removes `write`/`edit`/`hashline_edit`). The contract asks for an edit, so a writer must apply it.
2. **Unstable target** — the file moved twice during the task window (§1) while the repair task was
   writing (§2); editing it now risks either clobbering the live writer or publishing yet another pin
   that goes stale — the exact class this audit exists to close.
