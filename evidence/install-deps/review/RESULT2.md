# t12 — Review round 2: the repaired sidebar guard and its documentation

**Task:** `t12` (team `mpd-install-deps`, member **Reviewer**), attempt 2, `attempt_id`
`a3c5fb0e-0b9d-4594-8823-0719bdc2d600`. **Kind:** review round 2, judging the repair `t11`
(Deep Worker) against the round-1 findings in `RESULT.md` (t6).
**Verdict: `pass`** — R1, R2, R3, R4 and R5 are CLOSED with evidence I re-measured myself; R6 stays
recorded as pre-existing and out of this repair's acceptance. One new LOW residual (R7, the stale
ignored `dist/mpd-package/`) is reported for the integration task; it does not block the wave.
**No fix was applied by this lane**; every write is inside `evidence/install-deps/review/**`.

## 0. The revision actually reviewed (sha256 + the UTC instant read)

| path | sha256 | read at (UTC) |
|---|---|---|
| `packages/mpd-bundle/cordis.patch.yml` | `e70a179e1ed13c5e4fa9926fb89fda9de4e17c1935aac1d517b37fa0b7b4b28e` | 2026-09-20T04:04:10Z → 04:06:57Z |
| `scripts/install-profile.mjs` | `1820242d3a9af2a8ad5d4949bb6b61ae53229e3d4cb5b237b1ad0b6ea9ec1dd6` | same |
| `README.md` / `README.zh-CN.md` | `5a604ac4aba50dbdb4405f733cefdeee6f6a721e480f54667b7e715642859979` / `b23074346172c970242509f4b69872a06e053af80a00fd6d369dda76e700b8ba` | same |
| `docs/design.md` / `docs/design.zh-CN.md` | `d447f5509398c66dc40f0421bfd61207581059d7c95e0ea956f90eb8dbea4d5d` / `f3ac2def127f1a03f7ef7f77af12b24d56987fed7f1e43f23d26ad2c27bca8f5` | same |
| `docs/user-guide.md` | `1245a6138839ef25e17b20d8ec24bbfb7fdc1036a29c9382430f6b3cd85a8d82` | same |
| `evidence/install-deps/implementation/README.md` | `bb23090838faf5a76a45c86787a09098476117d8244b7633c2286b499d6f1fe9` | same |
| `package.json` / `scripts/pack-mpd.mjs` | `64e97977…` / `52b4245d…` (UNCHANGED from the t2 revision) | same |

**Hash sandwich:** read at `04:04:10Z` and re-read at `04:06:57Z` — identical for every file present
in both reads (`r2-hashes.start.txt` / `r2-hashes.end.txt`); the only additions are the two files
added to the second read. The repair's own ledger hashes (`docs/design.zh-CN.md` `f3ac2def…`,
`implementation/README.md` `bb230908…`) match mine, so we measured the same revision independently.

**Guard body:** 3367 bytes, sha256 `e0429ff54f8eaca1cd371e49925a32d91233850126ebd8afc66bbb601f40aeb6`
(`r2-guard.raw.txt`), byte-EQUAL to `scripts/install-profile.mjs#SIDEBAR_GUARD` (measured) and to
`evidence/install-deps/repair-r2/guard.source.txt` modulo its trailing newline (the ledger's
`guardBodySha256 c7472a32…` is the same text WITH the newline — a labelling nuance, not a mismatch;
its `patchSha256AtMeasurement e70a179e…` is the shipped patch).

## 1. The five round-1 findings — closed, each re-measured by this lane

| id | round-1 finding | closure evidence (my own, plus the repair's boots) |
|---|---|---|
| **R1** high | the duplicate-mount back-off read only `dsh.profile.bundles` layers | clause 4 now scans `<profileDir>/cordis.patch.yml`, `<profileDir>/../../cordis.patch.yml` (= `$DSH_HOME/cordis.patch.yml`), `$DSH_HOME` from the env, and every `--patch` overlay recovered from `process.argv` in both spellings. My probes P6/P7/P8a/P8b return DISABLED for a profile layer / home layer / `--patch X` / `--patch=X`, and P9 (an overlay that does NOT mention the package) still returns ENABLED. Nine real boots: `profile-layer-mount`, `home-layer-mount`, `overlay-mount`, `overlay-equals-mount` each DISABLED, sidebar served exactly once, 0 fatal signatures. **Negative control:** the same composition booted with the round-1 guard text banked by my review (`review/guard.raw.txt`) DIES with `duplicatePrefixRoute: true` + `failedToApplyLoaderEntry: true` and no token — so the fatal mode is real and the only difference between RED and GREEN is the guard body. |
| **R2** medium | README/zh-CN/design claimed more than the guard did | the EN and zh-CN README rows and the design §4 row now name every layer source (bundle layers, `<profileDir>/cordis.patch.yml`, `$DSH_HOME/cordis.patch.yml`, both `--patch` spellings), the entry-only web predicate, and the deliberate over-approximation toward DISABLED. No sentence I checked outruns the shipped text. |
| **R3** low | a `!!js`-disabled webserver row counted as the web plane, and the web-app-layer OR dominated | clause 5 is now the ENTRY test alone, fail-closed on the raw node (`e.options.disabled === undefined \|\| e.options.disabled === false`); the `@deepseek-ai/dsh-web-app` OR is gone. My probes: P3 (js marker) → DISABLED, P3b (raw `false`) → ENABLED, P2 (entry absent, layer declared) → DISABLED, P12 (custom web bundle, no layer) → ENABLED. The shipped `dsh-web-app` patch still inserts the row with no `disabled` key, and the real `bundle-only-web` boot shows ENABLED — so the fail-closed clause does not cost the shipped web composition. |
| **R4** low | self-exclusion was the whole-file substring `mpd-better-sidebar` | self-exclusion is now `other.name === '@mpd-dsh/mpd'`. Probe P4 (a FOREIGN layer that mounts the package and mentions our row id in a comment) now returns DISABLED; P5/P5b (foreign layer, order both ways) DISABLED; the happy-path probe P1 stays ENABLED, and P1b shows an unreadable own-layer package.json cannot break the scan. |
| **R5** low | "both halves measured" without a pnpm run; AC-2 unsupported | `implementation/README.md` §2 now labels each half `[STRUCTURAL, not measured here]` vs `[MEASURED]` and points at the verification lane's real install; the verification lane has since produced its own round-2 artifacts (`verification/20260920T034521Z/real-web-final/plugin-add.log`, `result-final.json` with 10/10 arms ok) on the same revision hashes. |

**R6** (legacy installer mirrors the same entry id; `cordis-plugin-include#applyEntryPatches` does not
dedupe inserts) is explicitly recorded as pre-existing and outside t11's acceptance (§5 of the repair).
It stays OPEN as a recorded risk, not as a defect of this change.

## 2. The three fatal failure modes, against the repaired text and real boots

| mode | repaired guard | evidence |
|---|---|---|
| F1 unresolvable entry (`assertEntriesLoaded`) | clause 1 unchanged | `package-absent` boot: DISABLED, 0 fatals, `/sidebar/api` 404, index 200; my probe P10 |
| F2 pending entry (`assertEntriesActivated`) | clause 5 fail-closed (no enabled webserver ENTRY → DISABLED) | `dsh-tui` boot: DISABLED (`no enabled @deepseek-ai/dsh-host-webserver entry`), 0 fatals; QA case arm `tui-plane` green; probe P2 |
| F3 two mounts (`duplicate prefix route`) | clauses 2/3/4 cover bundle layers, the profile layer, the home layer and `--patch` overlays; clause 3 excludes only our own layer, by identity | nine-arm ledger (both aggregate orders, all three overlay sources) all DISABLED with the sidebar served once and 0 fatals; the RED negative control proves the mode is reachable with the pre-repair guard; probes P4–P8b |

**Composition statement (the acceptance asks for it):** I found NO composition where the repaired
guard evaluates to `false` while a second mount exists or while the web plane is absent. The two
compositions that did so in round 1 (a non-bundle patch layer mounting the package; a foreign layer
that mounts it while mentioning our id) now DISABLE. The remaining deliberately-uncovered case is
maintained in the repair's bound §1: a layer that mounts the sidebar from CODE rather than a patch is
invisible to a declaration scan — for that case the loader's own `duplicate prefix route` still fails
loudly (pre-existing ecosystem behaviour, unchanged).

## 3. Other checked properties

* **Recursion / throw safety.** Still `e.options.disabled` (two RAW reads, both inside clause 5) and
  never the evaluated `.disabled` getter of another row (my text assertion re-run on the 3367-byte
  body). The single outer `try/catch` still returns `true`, and the three helpers remain individually
  wrapped. Measured: absent `ctx.loader` → `DISABLED - guard threw …` → `true` (probe P11).
* **Order independence.** Probe P5b puts the foreign layer FIRST in `dsh.profile.bundles` → still
  DISABLED; the two aggregate orders are booted in the ledger. The guard reads DECLARATIONS, not the
  forward-blind entry list, for every clause except the webserver entry — and a package-listed EARLIER
  than a web layer is covered by the loader's later refresh pass (the round-1 probes measured the same
  expression re-evaluating once every entry exists; an ENABLED decision is the one that sticks, since
  `Entry#refresh` returns early once a fiber exists).
* **No over-disable on the happy path.** Probe P1 (own layer + webserver entry) → ENABLED; P9
  (unrelated `--patch` overlay) → ENABLED; the ledger's `bundle-only-web` boot serves the sidebar
  client and `/sidebar/api` 405 with 0 fatals.
* **Counted claims.** Unchanged and consistent: patch insert ids = 26, `README.md` = 28 `- id:`
  (26 inserts + 2 id-targets) with 18+4+1+1+2 grouped rows, `README.zh-CN.md` = same;
  `node scripts/verify-rows-parity.mjs` exit 0, `node scripts/install-profile.mjs --self-test`
  exit 0, `bun run verify:docs` PASS (`pairs=38 failed=0 violations=0 … dead=0`) — all re-run by me on
  the repaired revision.
* **Evidence quality.** The repair is itself hash-sandwiched (`repair-r2/hashes.start.txt` /
  `hashes.end.txt`), keeps the pre-repair guard it RED-tested as a byte-banked artifact, separates
  COMPOSITION from LOAD claims per arm, and re-ran the named QA case (5/5 arms ok, guard decisions as
  designed). The packs it measured are kept (pack-verified) rather than claimed.

## 4. Residuals (none of them blocking; the first is new in round 2)

| id | severity | file + symbol | problem | required fix |
|---|---|---|---|---|
| **R7** | low | `dist/mpd-package/cordis.patch.yml` (ignored build artifact, `.gitignore`); `scripts/verify-pack-closure.mjs` (`PACK_EXEMPT`/content-sweep comment: the packed patch is a "dev-flavor rewrite" OUTSIDE the content sweep) | The canonical on-disk packed artifact still carries the PRE-repair guard scalar (2493 bytes, sha256 `7a497589…`), while the source patch carries the reviewed 3367-byte body (`e0429ff5…`). The packer itself is correct — `repair-r2/pack-verified/cordis.patch.yml` is byte-identical to the source (`e70a179e…`) — but nobody regenerated the canonical tree, and `verify-pack-closure` exits 0 because the packed patch sits outside its content comparison by construction. Any measurement or ship of `dist/mpd-package` as it stands would carry the round-1 guard. | Re-pack the canonical artifact (or delete the stale copy so nobody measures it) in the integration task; the packed guard scalar needs its own byte check if this class is to be gated. |
| **R8** | low (bound, no fix required) | `skills/dsh-qa/scripts/install-dependencies.mjs` / the round-1 instrumentation | The round-1 `fiber=true` count witness is gone from the web arms, because a `--patch` probe overlay that names the package now (correctly) disables our row — the probe would measure its own interference. The new arms' positive mount witness is the served sidebar client + `/sidebar/api` 405 (vs 404 when unmounted) + a composition dump showing exactly one enabled sidebar row. That is sufficient for "mounted", and the duplicate-route RED control covers "not twice", but the fiber count is no longer available as an independent instrument. | None required; if a future lane wants the fiber count back, build the package name inside the probe expression (e.g. `'dsh-better-' + 'sidebar'`) so the overlay text does not mention it. |
| **R6** | low, pre-existing | `scripts/install-profile.mjs#buildPlan`; `cordis-plugin-include#applyEntryPatches` | Legacy installer row-id mirroring + inserts that are not deduped by id (round-1 finding, unchanged, explicitly out of t11's acceptance). | None in this wave; retire the mirrored row set with the legacy installer. |
| — | observation | `skills/**`, `docs/**` | Other lanes wrote `skills/dsh-qa/**` and several docs after the canonical pack stamp (the closure gate lists 13 `CONTENT-DRIFT-EXPECTED` files); the single `skills/**` writer + one `VENDOR_LOCK.json` re-pin rule (§9) and the re-pack are the integration/release sweep's business, not this review's. | Handled by the integration/release task. |

## 5. Round-2 artifacts

| file | what it is |
|---|---|
| `RESULT2.md` | this review |
| `r2-guard.raw.txt` | the repaired `disabled: !!js` scalar, byte-exact (3367 bytes) |
| `checks-r2.mjs` | read-only checks: patch ≡ installer guard bytes, packed-vs-source guard, no evaluated-getter read, 16 synthetic composition probes over the shipped repaired text (all OK) |
| `checks-r2.out.txt` | that run's output |
| `r2-hashes.start.txt` / `r2-hashes.end.txt` | the sandwich (04:04:10Z / 04:06:57Z, identical) |
| `RESULT.md`, `guard.raw.txt`, `checks.*` | round-1 review + the pre-repair guard the repair's RED control re-used |
