# t49 — dispositions, duplicate-key judgement, and what the PASS does NOT cover

Addendum to `REREVIEW-t49.md`, recorded because t49's task slot is already terminal (attempt 1,
verdict `pass`) and the captain asked for these four things to land as a record rather than a message.

Judged revision (pin): `packages/mpd-config-plugin/src/index.ts` `e8917933…`,
`packages/mpd-config-plugin/dist/index.js` `15733c1e…`,
`skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs` `4474be1e…`,
`packages/mpd-tui-plugin/src/settings.ts` `70e1d475…`. The decisive write-path run was frame-hash
checked **before and after** (`write-arm.hashes-{before,after}.txt` → identical → SETTLED).

## 1. Finding dispositions (as the captain requested)

| id | disposition | evidence |
|---|---|---|
| **B1** file-derived base | **SUPERSEDED** | the falsifying observation the captain named is captured: the namespace descriptor's `base` carries the workspace FILE value — `base.hashline.maxDiffChars = 35000` (mine) and `base: 30` with `value`/`user` = 31415 (t42, different sandbox), plus lane check **W13** green and `baseForNamespace()` implementing the cardinality rule |
| **B2** disagreeing surfaces | **SUPERSEDED — and the LANE needed the fix, not the product.** This is my own finding and I say it plainly: the RPC envelope is `{type, rpcId, result:{ok, value:<descriptor>}}`, and `mutateOutcome()` read it one level too shallow, so `resolved`/`user` came back `undefined` while the same run's raw payload carried `{"value":{"hashline":{"maxDiffChars":31415}},"user":{"hashline":{"maxDiffChars":31415}}}`. The extractor now unwraps `response.result.value` and W11/W12 pass. The product was never divergent | `skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs` `mutateOutcome()`; RESOLUTION-w11w12.md; the failing runs' own logged payloads |
| **B4** card removal / tree under review | **CORRECTED** — the card was a deliberate, user-directed scope decision (recorded in the lane header: "the user cut the card"), so it is not a product finding. The process lesson stands as a note only: a review target must be pinned by hash and must not be re-written underneath the reviewer | `skills/dsh-qa/scripts/tui-settings-bridge.mjs:14` |
| **B3** stale "not bridged" prose | **OPEN and ROUTED, not blocking.** English `README.md:23` + the NOT-CLAIMED section are repaired; `README.zh-CN.md:22` still reads 「… —— **未与文件打通**」 ("not bridged to the file") with a stale cross-reference, so the bilingual pair is out of sync on that row. Owner: **t50** (with `docs/tui.md` §6.2 + its zh twin) | `packages/mpd-tui-plugin/README.zh-CN.md:22` vs `README.md:23` |
| **B5** skills corpus re-pin | **the captain's** — the single `VENDOR_LOCK.json` re-pin at commit; explicitly NOT a t49 blocker. Recorded for the wave only: the corpus `treeSha` moved again (`310/8ec53287296e`; lock `307/ba0c39228896`) | `agent-teams-messaging.mjs --self-test` |

## 2. Duplicate-key semantics vs the FINAL ruling — the tree MATCHES

Judged against `evidence/mpd-bridge/captain/RULING-duplicate-unset-FINAL.md`, driven directly against the
shipped code (not via the tests) on `{"ulw":{"maxRounds":3,"maxRounds":7}}`:

| rule | measured |
|---|---|
| SET edits the **LAST** occurrence, succeeds, warns with every occurrence line | `ok:true`; `"maxRounds": 9` applied to the last, the first preserved; warning `{reason:"duplicate-key", lines:[3,4], detail:"key \"ulw.maxRounds\" appears 2 times at lines 3, 4; the last occurrence is the effective value and was updated"}` |
| UNSET removes **EVERY** occurrence in one descending-span pass | `ok:true`; `occurrencesRemaining: 0` (`surgicalDelete` → `locateAllLeaves`, "CAPTAIN'S DELTA vs the design") |
| Refusal only for unprovable spans, duplicated **INTERMEDIATE** keys, unparsable, read-only | `ambiguous-intermediate` at `jsonc-edit.ts:355` (names the count and lines); `unparsable`; read-only → `denied`/`EACCES` with bytes unchanged (my degradation probe) |

`bun test packages/mpd-config-plugin` → **67 pass / 0 fail** (the captain's number, reproduced).
**Statement: the tree matches the ruling table, in both directions.**

## 3. What the PASS does NOT cover

1. **No model-driven tool call was exercised — it cannot be, in this environment.** There are no model
   credentials, so a tool call driven by a model inside a booted host is not witnessable at all here.
   Every product behaviour I assert rests instead on the host's own authenticated `settings/mutate` RPC,
   the lane's raw output, and t42's real tool behaviour (which was driven through the host's API, not by
   a model). A reader must not infer that a model-driven path was exercised.
2. **No TUI keystroke save was driven** — no TTY in this environment. The write path was exercised through
   the same RPC the TUI section emits; `tui-panels` owns the keystroke surface.
3. **No rendered web card** — the card was cut by the user and no browser exists here. Registration/byte
   evidence would be the ceiling; the card is NOT-CLAIMED.
4. **The namespace base is not live-refreshed** — it is fixed at registration (the host exposes no
   disposal handle), so a file changed AFTER boot reaches the namespace on the next start. That is the
   shipped, disclosed semantics (`applies: 'restart'`), not a gap; the pass does not claim otherwise.
5. **B3 (the zh-CN seam-table row) remains open** until t50 lands, and **B5 (the re-pin)** is the
   captain's commit-time action. Neither is a product defect at the judged revision.
