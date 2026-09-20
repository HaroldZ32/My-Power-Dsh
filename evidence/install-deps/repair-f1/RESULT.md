# t14 — repair F1: the other-layer scan recognises a real MOUNT (row-aware, comment-stripped)

**Author:** Deep Worker (team `mpd-install-deps`, task `t14`, attempt 1, `attempt_id`
`2e06ebb9-f6c4-45ce-9b23-0b2f3483cecf`). **Kind:** repair (verification finding F1, MEDIUM,
degradation-only). **Verdict:** F1 CLOSED — the two measured decoys FLIP to ENABLED + served once,
every real-mount arm stays DISABLED + served once, the rest of the matrix is unchanged, and the
fatal direction stays closed (fail-closed bias preserved by the stated doubt fallback).

## 0. The revision (sha256 + UTC instants, hash sandwich)

| path | sha256 | read at (UTC) |
|---|---|---|
| `packages/mpd-bundle/cordis.patch.yml` | `1b316b68850fbe3958b16088ac723abcd50faabd178668de7ed6044811107e8f` | 04:23:27Z → 04:27:0xZ |
| `scripts/install-profile.mjs` | `2809ccfc23b37fd9f8eff73d0feb689397fc92c7c958aec93d39045049affc67` | same |
| `scripts/pack-mpd.mjs` | `52b4245dc46e8f3f1de87b7f16ac0adda11370fb5606a420d9ea97b7836cdb07` (unchanged) | same |
| `package.json` | `64e9797767e086db02428946fa9c4764786695f493fe9c14352b065a099a634f` (unchanged) | same |
| `README.md` / `README.zh-CN.md` | `3d1f9d1db5c5735759b29041afb6b18c95bd3c077fc4e2813d84a5951692709a` / `fd4b4695b962303123f2f6289ca2ddf7343bea244d1a57582047d70c225bc1e9` | same |
| `docs/design.md` / `docs/design.zh-CN.md` | `8489a7e2f9dd74333de3b004ad191125d683954b3f99f0511acde3b14b7b0e98` / `cd7c3981cedc2d453f001b6326d3d28b09b495d2eb115f45703fc53fe95d775a` | same |
| `evidence/install-deps/repair-f1/guard.source.txt` | `6df4c609ee4a5ba2fbfe53e307137bbb4e06f163df24f6d9be54aa4300e11239` (guard body 5915 B, `5859cb4e…`) | same |

`hashes.start.txt` (04:23:27Z) → all work below → `hashes.end.txt` after a 50 s settle window:
byte-identical (`SANDWICH OK: start == end`).

## 1. The finding, measured BEFORE the refinement

The verifier's own fixtures (`evidence/install-deps/verification/20260920T034521Z/fixtures/t5-decoy-*`)
were copied into the sandbox profiles (provenance recorded per arm in `compositions[].links`) and
booted with the pre-refinement guard (t11 revision, guard-text sha `e8eaf55a…`):

| decoy | what it does | guard BEFORE | sidebar BEFORE |
|---|---|---|---|
| `decoy-comment-layer` | foreign bundle layer whose patch only MENTIONS the package in a COMMENT; its one row is a disabled timer | `DISABLED - bundle layer t5-decoy-comment already mounts it in its own patch` | **not served** (route 404, client absent), 0 fatal signatures |
| `decoy-disabled-row` | foreign bundle layer that INSERTS `name: 'dsh-better-sidebar'` with a LITERAL `disabled: true` | `DISABLED - bundle layer t5-decoy-disabled already mounts it in its own patch` | **not served**, 0 fatal signatures |

Raw: `runs/2026-09-20T04-17-56.753Z-before/result.json`. That is the SILENT loss of exactly the
capability the wave exists to deliver — a healthy boot with no sidebar. The verifier's own raw boot
logs for the same two decoys are banked byte-for-byte at `decoy-verification-logs/`
(`F3-decoy-comment-layer.boot.log`, `F4-decoy-disabled-row.boot.log`, plus the two fixture patches;
sha256 in `decoy-verification-logs-sha256.txt`) and carry the identical
`DISABLED - bundle layer t5-decoy-… already mounts it in its own patch` lines.

## 2. The rule implemented (stated verbatim in the row comment)

The `mpd-better-sidebar` row comment now carries the contract under the heading
`THE ROW RULE (repair F1, stated verbatim — this IS the contract a reviewer tests)`:

1. Strip YAML comments before matching (a `#` that is not inside quotes ends the line's content).
2. Find candidate ROWS that name `dsh-better-sidebar` (the `name:` value, quoted or bare).
3. A candidate counts as a MOUNT unless it carries a LITERAL `disabled: true`.
4. Unknown / `!!js`-valued `disabled` counts as a MOUNT (conservative: we back off rather than risk
   a duplicate).
5. Any parsing doubt falls back to the CURRENT behaviour (treat as a mount -> DISABLED).

Implementation notes (all inside the one guard body, no YAML library, no regex, no double quote and
no backslash — so the JSON-stringified literal stays a valid YAML double-quoted scalar):
`stripComments` walks characters and tracks `'`/`"` (via `String.fromCharCode`, keeping the bytes
quote-free); rows are split at list items (`- `) with continuation lines gathered by indentation; the
row's own `name:` is the shallowest `name:` in the chunk, and only a `disabled:` at the SAME OR
SHALLOWER indentation than that `name:` may disqualify the row (a `config`-nested `disabled: true`
does NOT — conservative). The doubt fallback fires when the stripped text still mentions the package
but no row could be attributed the `name:`.

## 3. AFTER the refinement — eleven real boots

`runs/2026-09-20T04-20-09.180Z-after/result.json` (`ok: true`, guard-text sha `75497450…`), each arm
an isolated sandbox (`DSH_HOME`+`HOME`+cwd inside a mktemp root) with a real mounting boot:

| arm | guard | sidebar | fatal sigs |
|---|---|---|---|
| **decoy-comment-layer** | **ENABLED** | **served exactly once** | 0 |
| **decoy-disabled-row** | **ENABLED** | **served exactly once** | 0 |
| bundle-only-web | ENABLED | served exactly once | 0 |
| aggregate-first | DISABLED (bundle layer) | served exactly once (the aggregate's row) | 0 |
| aggregate-after | DISABLED (bundle layer) | served exactly once | 0 |
| profile-layer-mount | DISABLED (patch layer) | served exactly once (the user's row) | 0 |
| home-layer-mount | DISABLED (patch layer) | served exactly once | 0 |
| overlay-mount (`--patch X`) | DISABLED (patch layer) | served exactly once | 0 |
| overlay-equals-mount (`--patch=X`) | DISABLED (patch layer) | served exactly once | 0 |
| dsh-tui | DISABLED (no enabled webserver entry) | no sidebar | 0 |
| package-absent | DISABLED (not resolvable) | no sidebar (route 404) | 0 |

**Offline scanner unit** (`scanner-unit.mjs`, 11 cases, `scanner-unit.result.json`): comment-only
mention → no mount; literal `disabled: true` / `TRUE` / `true # comment` → no mount; enabled row,
`disabled: false`, `!!js` value, unattributable mention, mixed disowned+enabled rows, config-nested
`disabled: true` → MOUNT (conservative). All 11 pass.

The decoy arm was re-run alone to bank its raw boot logs after the refinement:
`runs/2026-09-20T04-27-07.047Z-after-decoys/{result.json,decoy-comment-layer.boot.log,decoy-disabled-row.boot.log}`
— both logs carry `[mpd-better-sidebar] mount guard: ENABLED - web plane present and no other layer
mounts dsh-better-sidebar` and the `dsh web:` line of a really serving boot.

The verifier's closing test names two arms this QA case does not carry (`--only F3-decoy-comment-layer,
F4-decoy-disabled-row`; the case ships `bundle-only`/`aggregate-*`/`tui-plane`/`package-absent` only —
`skills/**` is out of this task's scope and was NOT edited). The acceptance's "or the equivalent arms"
branch is therefore the one exercised: the decoys are reproduced from the verifier's own fixtures in
this ledger, BEFORE and AFTER. The permanent case was additionally re-run in full (§5).

## 4. Guard properties, parity and gates

* One body (5915 B, `5859cb4e…`) carried byte-identically into `packages/mpd-bundle/cordis.patch.yml`,
  `scripts/install-profile.mjs#SIDEBAR_GUARD` and the PACKED patch: `install-profile --self-test` exit
  0; re-pack (`--out`, canonical `dist/mpd-package/` untouched) with `packed carries the exact scalar:
  true` and the packed patch byte-identical to the source (`1b316b68…`; kept at
  `pack-verified/cordis.patch.yml`, sha list in `pack-verified-sha256.txt`).
* Raw `options.disabled` reads only (the evaluated getter still recurses); one outer try/catch
  returning TRUE on any throw; one log line per distinct decision via `__mpdSidebarGuardSeen`.
* Gates on the settled revision: `node scripts/verify-rows-parity.mjs` 0 · `bun run verify:rows` 0 ·
  `node scripts/verify-dist-fresh.mjs` 0 (`20/20 targets fresh`) · `node scripts/install-profile.mjs
  --self-test` 0 · `bun run verify:docs` 0 (`pairs=38 failed=0 violations=0 PASS`).
* Docs (R2 follow-through): README EN/zh-CN and docs/design EN/zh-CN now say a foreign layer
  suppresses the row only when its patch carries a ROW that mounts the package (a row naming
  `dsh-better-sidebar` whose `disabled` is not literally `true`); a comment mention or a literally
  disabled row does not suppress it; unparseable forms fall back conservatively.

## 5. The permanent QA case on the refined revision

`node skills/dsh-qa/scripts/install-dependencies.mjs` → `ok=true arms=5 skipped=0` (TUI arm reads the
fail-closed decision line). Evidence relocated into this task's scope:
`qa-case-rerun/2026-09-20T04-23-33.669Z/` (+ `qa-case-rerun-sha256.txt`, 13 files).

## 6. Forms the row-aware rule does NOT cover (no silent gap)

Every one of these is caught by the DOUBT fallback (rule 5) and therefore DISABLES conservatively —
none can silently suppress or duplicate a mount:

| form | behaviour |
|---|---|
| flow-style row `- {id: x, name: dsh-better-sidebar}` | no row attributed the `name:` → doubt → DISABLED (conservative) |
| the package name injected through a YAML anchor/alias (`name: *ref`) | the anchor's scalar still mentions the package outside a `name:` → doubt → DISABLED |
| a multi-document patch (`---` separators) | `---` is ignored by the line scan; rows after it are still attributed |
| CRLF / tabs | line trim + tab-aware indent count handle both |
| `disabled: !!js "true"` (an expression, not a literal) | rule 4 → counts as a MOUNT → DISABLED |
| a `config`-nested `disabled: true` | not the row's own key → counts as a MOUNT → DISABLED |
| a layer that mounts the package from CODE rather than a patch | outside any declaration scan; the loader still fails loudly (`duplicate prefix route`) — unchanged pre-existing bound |

## 7. Scope

Changed source: `packages/mpd-bundle/cordis.patch.yml`, `scripts/install-profile.mjs`, `README.md`,
`README.zh-CN.md`, `docs/design.md`, `docs/design.zh-CN.md`; everything else under
`evidence/install-deps/repair-f1/**`. `scripts/pack-mpd.mjs`, `package.json` and `bun.lock` are
unchanged from the t11 revision.

**Out-of-scope stale sentence (reported, not edited):**
`evidence/install-deps/implementation/README.md` §6 bound 3 still says the scan is
"OVER-APPROXIMATING toward DISABLED (a layer that merely mentions the package in a comment disables
the row)" — true for the t11 revision, no longer true after F1. That path is not in this task's
inScope, so the owner (or the captain) should update that one sentence.
