# t15 — Review round 3: the row-aware foreign-mount predicate (repair F1)

**Task:** `t15` (team `mpd-install-deps`, member **Reviewer**), attempt 1, `attempt_id`
`d049f40e-54cc-41f2-86f7-36a8cce1af8b`. **Kind:** review round 3, scoped to the repair `t14`
(F1: recognise a real foreign MOUNT instead of any textual mention) and to a regression check of the
properties rounds 1–2 established.
**Verdict: `pass`** — the refinement closes the false-positive class without opening the fatal
duplicate-mount direction; parse misses are conservative; the invariants, the counts and both
languages' docs hold. Three LOW residuals (T1–T3) are recorded for integration; none blocks.
**No fix was applied by this lane**; every write is inside `evidence/install-deps/review/**`.

## 0. The revision actually reviewed (sha256 + the UTC instant read)

| path | sha256 | read at (UTC) |
|---|---|---|
| `packages/mpd-bundle/cordis.patch.yml` | `1b316b68850fbe3958b16088ac723abcd50faabd178668de7ed6044811107e8f` | 2026-09-20T04:28:38Z → 04:31:30Z |
| `scripts/install-profile.mjs` | `2809ccfc23b37fd9f8eff73d0feb689397fc92c7c958aec93d39045049affc67` | same |
| `README.md` / `README.zh-CN.md` | `3d1f9d1db5c5735759b29041afb6b18c95bd3c077fc4e2813d84a5951692709a` / `fd4b4695b962303123f2f6289ca2ddf7343bea244d1a57582047d70c225bc1e9` | same |
| `docs/design.md` / `docs/design.zh-CN.md` | `8489a7e2f9dd74333de3b004ad191125d683954b3f99f0511acde3b14b7b0e98` / `cd7c3981cedc2d453f001b6326d3d28b09b495d2eb115f45703fc53fe95d775a` | same |
| `package.json` / `scripts/pack-mpd.mjs` | unchanged from t11 (`64e97977…` / `52b4245d…`) | 04:28:38Z |

**Hash sandwich:** every file present in BOTH reads is identical between `04:28:38Z` and `04:31:30Z`
(`r3-hashes.start.txt` / `r3-hashes.end.txt`); the diff between the two listings is only which files
were listed (two unchanged files were added to the first read and one repair artifact to the second).
The repair's own recorded revision hashes (`RESULT.md` §0) match mine, and
`repair-f1/guard.source.txt` (`6df4c609…`) is the shipped guard body plus a trailing newline.

**Guard body:** 5915 bytes, sha256 `5859cb4e571ff1d97d6dcc6a68aa78e4522b323223fb62301d00802f3ca077cb`
(`r3-guard.raw.txt`). Its three other derivations all resolve to the same text, so the hash labels in
the repair's ledger are not a mismatch: body `5859cb4e…` / body+newline `6df4c609…` /
`JSON.stringify(body)` = `75497450…` (the value the ledger prints as `guardTextSha256`).

## 1. The stated rule vs the shipped code (exact match)

The row comment prints **THE ROW RULE (repair F1, stated verbatim — this IS the contract a reviewer
tests)**: strip YAML comments; find rows naming `dsh-better-sidebar`; a candidate is a MOUNT unless it
carries a LITERAL `disabled: true`; unknown/`!!js` `disabled` counts as a MOUNT; any parsing doubt
falls back to "treat as a mount". The code implements exactly that:

* `stripComments` walks characters per line, ends the line at a `#` outside quotes, and tracks `'`/`"`
  (so a `#` inside a quoted value survives and an apostrophe in a comment cannot desynchronise it).
* Rows are the `- ` list items; continuation lines are gathered while the indent is deeper than the
  item's. The row's own `name:` is the SHALLOWEST `name:` in the chunk.
* `literallyDisabled = disabledValue !== null && disabledIndent <= nameIndent &&
  unquote(disabledValue).toLowerCase() === 'true'` — a `disabled:` nested deeper than `name:` (e.g.
  inside `config`) is NOT the row's own key and falls to the conservative side; `disabled: 'true'`
  (a YAML string) is treated as literally disabled, which matches the loader
  (`Entry#disabledOf` does `Boolean(options.disabled)` for non-`!!js` values) and the YAML boolean
  `True` (lower-cased comparison).
* The doubt fallback is explicit: `if (!named) return true` — mention present, no row attributed the
  name → DISABLE.

## 2. Direction A — false positives (the class this repair exists to close)

I evaluated the SHIPPED guard text verbatim against real-filesystem compositions
(`checks-r3.mjs`, 28 probes, all matching their expectation: `checks-r3.out.txt`). Decoys must ENABLE:

| decoy | guard outcome |
|---|---|
| comment-only mention | ENABLE |
| a comment containing apostrophes (`# don't mount dsh-better-sidebar here`) | ENABLE |
| literal `disabled: true` foreign row (bare name) | ENABLE |
| the same with a double-quoted name / `disabled: 'true'` / YAML `True` | ENABLE |
| `disabled: true` row plus a trailing `# keep off` comment | ENABLE |
| a row that is literally disabled and mentions the package a second time in another key | ENABLE |
| the same decoy in the PROFILE layer | ENABLE |
| a comment-only mention in the HOME layer | ENABLE |
| a comment-only `--patch` overlay | ENABLE |

The repair's own real boots agree: the `after` ledger
(`repair-f1/runs/2026-09-20T04-20-09.180Z-after/result.json`, `ok: true`, guard text
`JSON.stringify`-sha `75497450…` = the shipped body) shows **`decoy-comment-layer` ENABLED** and
**`decoy-disabled-row` ENABLED**, each `servedSidebarClient: true`, `/sidebar/api` 405 with the
plugin's own envelope, `fatalSignatures: []`; the later `…04-27-07.047Z-after-decoys` run re-boots
exactly those two arms with the same result. The BEFORE run
(`…04-17-56.753Z-before/result.json`, guard-text sha `e8eaf55a…` = the t11 scalar) shows both decoys
DISABLED and **not served** — the silent sidebar loss the refinement removes; the verifier's own raw
logs for those two decoys are banked byte-for-byte in `repair-f1/decoy-verification-logs/` with the
same `DISABLED - bundle layer t5-decoy-… already mounts it in its own patch` lines.

## 3. Direction B — false negatives (the fatal direction, checked first)

| genuine mount shape | guard outcome | evidence |
|---|---|---|
| aggregate row, both install orders | DISABLE | my probes M1/M2 + the ledger's `aggregate-first` / `aggregate-after` (DISABLED, served, 0 fatals) |
| `disabled: false` on the foreign row | DISABLE | probe M3 |
| `disabled: !!js "false"` (unknown value) | DISABLE | probe M4 |
| `disabled: true` nested inside the row's `config` | DISABLE | probe M5 |
| a foreign mount in `<profileDir>/cordis.patch.yml` | DISABLE | probe M6 + ledger `profile-layer-mount` |
| a foreign mount in `$DSH_HOME/cordis.patch.yml` | DISABLE | probe M7 + ledger `home-layer-mount` |
| `--patch X` / `--patch=X` overlay mounting it | DISABLE | probes M8/M9 + ledger `overlay-mount` / `overlay-equals-mount` |
| the package itself as a declared bundle layer | DISABLE | clause 2 (unchanged, round-1/2 evidence) |

Every ledger arm carries `guardDecision`, the served client, `/sidebar/api` 405 and 0 fatal
signatures — the duplicate-route signature is the one that would appear if both rows mounted, and it
is absent in all eleven arms.

## 4. Parse misses are conservative (re-derived, not taken on trust)

| shape the scanner cannot attribute a `name:` to | outcome |
|---|---|
| flow-style row `- {id: x, name: dsh-better-sidebar}` | **DISABLE** (probe P1) |
| name as a multi-line scalar (`name:` then an indented value) | **DISABLE** (P2) |
| YAML anchor + alias (`name: *ref`) | **DISABLE** (P3) |
| the package mentioned only inside a `config:` value | **DISABLE** (P4) |
| tab-indented row | **DISABLE** (P5) |
| block-scalar name value (`name: |`) | **DISABLE** (P6) |

All six reach the `if (!named) return true` fallback, so a parse miss can only cost the sidebar, never
open a duplicate mount.

## 5. Invariants, docs, counts

* **Byte parity:** patch ≡ `scripts/install-profile.mjs#SIDEBAR_GUARD` (5915 B, `5859cb4e…`) ≡ the
  repair's packed output `repair-f1/pack-verified/cordis.patch.yml` (byte-identical to the source
  patch). See T1 for the canonical ignored artifact.
* **Raw reads only:** two `e.options.disabled` reads (both in the web-plane clause); no evaluated
  `.disabled` getter anywhere; `interpolate()` in the loader is applied only to an entry's `config`,
  never to `name`, so the recursion hazard stays closed.
* **Throw path:** the single outer `catch` still logs once and `return true` (tail of the body
  verified). One log line per distinct decision via the `globalThis.__mpdSidebarGuardSeen` dedup.
* **Docs (EN + zh-CN):** the README rows and the design §4 rows now state the row rule, the decoy
  semantics (comment mention / literal `disabled: true` mounts nothing) and the conservative
  fallback; I found no sentence that outruns the shipped predicate. `bun run verify:docs` → PASS
  (`pairs=38 failed=0 violations=0 links=234 dead=0`).
* **Counts:** 26 insert ids + 2 id-targets = 28 `- id:` entries, unchanged;
  `node scripts/verify-rows-parity.mjs` exit 0; the READMEs still claim 28/26.

## 6. Evidence quality — and what is inherited rather than re-measured here

* The repair's ledger is a real-boot matrix with the guard decision line per arm, an HTTP witness
  (`/sidebar/api` 405 with the plugin's envelope) and a fatal-signature scan; COMPOSITION claims are
  kept separate from LOAD claims. The decoy fixtures and the F1 finding itself come from the
  VERIFICATION lane (`verification/20260920T034521Z/fixtures/t5-decoy-*`, provenance recorded per
  arm as `links[]`), and the repair banked the verifier's pre-refinement boot logs byte-for-byte.
* **Inherited, not re-measured by me:** every real BOOT in this review (the repair's eleven-arm
  `after` ledger, its `after-decoys` re-run, and the banked t5 logs). No post-refinement run exists in
  the verification lane's directory at the reviewed instant (its newest run dir is
  `20260920T034521Z`, pre-refinement), so the independent boot re-measurement of the F1 delta is still
  owed by a verification task.
* **Re-measured by me:** the shipped predicate text itself, against real filesystem compositions, in
  both directions and through the parse-miss shapes (28 probes); the byte parity across the three
  carriers; the invariants; both languages' doc claims; the counted claims and the gates.

## 7. Residuals (all LOW; none blocks this round)

| id | severity | file + symbol | problem | required fix |
|---|---|---|---|---|
| **T1** | low | `dist/mpd-package/cordis.patch.yml` (ignored build artifact, `.gitignore`); `scripts/verify-pack-closure.mjs` (the packed patch is a "dev-flavor rewrite" OUTSIDE the content sweep) | The canonical on-disk packed artifact still carries the ROUND-2 guard scalar (3367 B, `e0429ff5…`), while the source and the repair's `pack-verified` copy carry the reviewed 5915 B body. The integration lane re-packed at 04:13Z (closing my round-2 R7) and the F1 repair landed after that, so the same chore is due again: nobody regenerated the canonical tree, and the closure gate cannot see it. Any measurement or ship of `dist/mpd-package` as it stands carries the round-2 predicate. | Re-pack (or delete) the canonical artifact as the LAST step after all writers in the integration task; the packed guard scalar deserves its own byte check if this class is to be gated. |
| **T2** | low | `evidence/install-deps/implementation/README.md` §6 bound 3 | Still says the scan is "OVER-APPROXIMATING toward DISABLED (a layer that merely mentions the package in a comment disables the row)" — true for the t11 revision, false after F1. The repair disclosed it as out of its inScope (its `RESULT.md` §7). | One-line correction by the owner/integration so the evidence record matches the shipped predicate. |
| **T3** | low (bound) | guard early return `if (stripped.indexOf('dsh-better-sidebar') < 0) return false` | A foreign layer whose patch never contains the literal (e.g. a row whose `name` resolves to the package through a shim path) is not seen, so our row stays ENABLED. Unreachable for a real mount via the loader's own path: `Entry` imports `options.name` verbatim (`this.parent.tree.import(this.options.name, …)`; `interpolate()` is applied only to `config`), so any spec that actually mounts the package — the package specifier itself, a subpath, or a file path — contains the literal. A deliberately obfuscated re-export shim falls under the already-documented "mounted from CODE rather than a patch" bound, where the loader still fails loudly with `duplicate prefix route`. | None required; keep it named next to the code-mount bound (already the case in the repair's §6). |
| — | observation | `repair-f1/runs/*/result.json` | The ledger's `guardTextSha256` is the `JSON.stringify` form (`75497450…`), not the body hash (`5859cb4e…`); three derivations of the same text, so provenance is sound — just label the derivation if the field is cited elsewhere. | Cosmetic. |

## 8. Round-3 artifacts

| file | what it is |
|---|---|
| `RESULT3.md` | this review |
| `r3-guard.raw.txt` | the 5915-byte row-aware guard body, byte-exact |
| `checks-r3.mjs` | the 28 read-only probes over the shipped predicate (decoys, genuine mounts, parse misses, all four layer sources, the happy path, the non-literal bound) |
| `checks-r3.out.txt` | that run's output (`ALL PROBES OK`) |
| `r3-hashes.start.txt` / `r3-hashes.end.txt` | the sandwich (04:28:38Z / 04:31:30Z) |
| `RESULT.md` / `RESULT2.md` + their artifacts | rounds 1–2 (the t11 revision and its predecessor), kept for the chain of evidence |
