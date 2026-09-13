# X4-repair (t25) — the brand guard must name the full identifier; plus the git-bash dist repair

Task: `t25` (repair r1) · assignee Senior Engineer · dependencies `t20, t21, t23, t24`.
Status at writing: **the claim is still refused** (`blocked by unfinished dependencies: t21, t23, t24`)
and `t21` is in_progress on `scripts/build-mcp.mjs`, so this file records (a) the **git-bash dist half,
which the captain assigned to this lane and which is DONE**, and (b) the **matcher half, validated
read-only and deliberately not yet applied**. Nothing is staged or committed.

## 1. Which check catches what (the sequencing the captain asked for)

| layer | subject | what it catches | where |
|---|---|---|---|
| PRIMARY — byte comparison | scrubbed artifact vs the **committed dist bytes** | any observable difference, including `Usage: omo-git-bash`, the prose `Start an OMO session`, a reverted key, and future drift nobody enumerated; the failure names artifact + char offset + both sizes + both differing lines | `assertRebuildMatchesCommitted()` (build loop + exported) |
| SECONDARY — token scan (layered) | brand-shaped tokens, allowlist per artifact | a NON-allowlisted brand token in the scrubbed text, with the full identifier named; zero-identifier input fails (anti-vacuity) | `brandTokens()` / `assertBrandClean()` |
| THIS REPAIR — matcher narrowing | the secondary scan's token capture | the camelCase (`omoRuntimeCandidates`) and slash (`omo/ping`) forms that collapsed to the bare `"omo"`, which any allowlisted `omo` entry would have satisfied | `BRAND_TOKEN_RE` |

With the byte layer in place the matcher hole is a **secondary** subject — which is why it is sequenced
after the dist repair.

## 2. git-bash dist repair (DONE)

`packages/mpd-mcp-gitbash/dist/cli.js` carried the older global-rewrite corruption 5 ×
(`platformFrmpdOptions`), which upstream never had (both the pinned checkout and the live upstream repo
carry `platformFromOptions`, 5 × each).

| record | before | after |
|---|---|---|
| `packages/mpd-mcp-gitbash/dist/cli.js` | sha256 `cb9ce8f3f1749d9445d9ce5bc45d35f6e8d7d6450227a8665a6360ad38a3257a`, 22656 B | sha256 **`0484a8ff1714c949bc52a4fc0de89c756dcab975b0691a2823706f008475f38e`**, **22651 B** |
| `packages/mpd-mcp-gitbash/dist/BUILD.lock` `artifact.{sha256,bytes}` | `cb9ce8f3…` / 22656 | **`0484a8ff…` / 22651** — and `source: "8c57e46"` (t21's landed provenance) **preserved verbatim**, not reverted to a placeholder |
| `VENDOR_LOCK.json` `assets["packages/mpd-mcp-gitbash/dist/cli.js"].sha256` | `cb9ce8f3…` | **`0484a8ff…`** (`fileCount: 1` and the `source` text unchanged) |

Diff discipline: the edit is exactly the 5 substitutions (10 changed lines, −5 bytes) — verified on a
temp copy before writing; after writing, `platformFrmpdOptions` = **0** sites and `platformFromOptions`
= **5**. The other two artifacts are byte-identical (`git diff --stat` over their `cli.js` is empty).
Ordering note: the BUILD.lock `source` rewrite attributed to t21 was already on disk at 19:02
(`"source": "the upstream project"` → `"8c57e46"`); this lane preserved it rather than reverting it.

## 3. Verification on the repaired bytes

```
$ node evidence/rtl-extraction-residual/followup/raw/x4-brand-guard-probe.mjs     # 7/7 PASS, exit 0
$ node scripts/verify-vendor.mjs                                                  # PASS, exit 0 (moved pin matches the file)
brand census: ast-grep 8702 identifiers / 0 brand · git-bash 2195 / 3 allowlisted OMO_CODEX_* · lsp 22364 / _omo
```

## 4. Matcher narrowing (APPLIED)

Applied one-line change to `BRAND_TOKEN_RE` (matcher fix; t21's edits preserved — only this regex line changed):

```js
/(?<![A-Za-z0-9])(_{0,2}omo(?:[A-Z][A-Za-z0-9]*|[-_][A-Za-z0-9]*|\/[A-Za-z0-9._-]*)*[-_\/]?)/gi
```

Chosen construction: **full-identifier capture with boundary + case handling**, not "make the scrub's
residual lists authoritative" — the lists only name already-enumerated keys (the very hole t20 closed),
and the token scan is what feeds the allowlist layer, so it must yield the true identifier. No allowlist
entry was added and none is needed.

Before → after (measured on the current working tree):

| vector | before | after |
|---|---|---|
| `omoRuntimeCandidates` | `["omo"]` | `["omoRuntimeCandidates"]` |
| `omo/ping` | `["omo"]` | `["omo/ping"]` |
| `omo-git-bash-run-` | `["omo-git-bash-run"]` | `["omo-git-bash-run-"]` |
| `omo-ast-grep` / `omo-runtime` / `OMO_PROVISION_HINT` / `OMO_LSP_DAEMON_CLI` | full already | full (unchanged) |
| `platformFromOpenCodeConfigPath`, `platformFromOptions`, `from`, `promo`, `protocol`, `homo_sapiens` | `[]` | `[]` (unchanged) |

So of the original six vectors, **four were already closed** by the earlier hyphen revision
(`omo-ast-grep`, `omo-runtime`, `omo-git-bash-run-`, `Usage: omo-git-bash`) and the narrowed defect was
exactly the **camelCase + slash** forms. After applying: all seven must-report vectors return the FULL
identifier, all six clean vectors stay `[]`, `_.omo` → `["omo"]`, `_omo` → `["_omo"]`, and the
seven-lane probe is 7/7 PASS (exit 0).

**Pin label for this file:** `scripts/build-mcp.mjs` is a moving file (t21's lane + this repair); the
revision carrying the matcher fix was measured at **2026-09-13T11:10:24Z**, **19327 B**, sha256 `c05dbdf83a364dbc203fab9bba0c3dbdda3f6a5ee7f763a4b98c8a595aaf5c88` — a working-tree
measurement, NOT a freeze value. The binding pin is taken once at freeze in the ledger, with the
revision named; no mid-wave hash here is cited as final.

## 5. Open items / conflicts to resolve

- **Contract vs instruction conflict (flagged, not silently resolved):** this task's declared
  `Out of scope` list includes `packages/mpd-mcp-*/dist/**` and `VENDOR_LOCK.json`, while the captain's
  later messages explicitly assign the git-bash dist repair and both fingerprint records to this lane.
  The instruction was followed (the records match the file on disk); the contract text should be
  amended so the verifier judges against the same scope.
- **Matcher half DONE** on the post-t21 bytes (t21 had landed when this was applied); re-proved with
  both directions and the seven-lane probe.
- **Nothing staged, nothing committed** in this lane.
