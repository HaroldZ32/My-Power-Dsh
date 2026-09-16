# CAPTAIN ADDENDUM — the external-extension wave (2026-09-16)

Written beside the integrator's ledger, never into it. Read the ledger
(`delivery-ledger.md`, sha256 `72b8c543fb49b851398487acb8c273650e26a6ce4b09fa211d19d3609190ab74`) for the
per-deliverable record; this file adds what only the captain can attest: the merge, the merged-tip
gates, and the disposition of the two waived gates.

## 1. Delivery record (unpushed)

| Item | Value |
|---|---|
| Branch | `feature/ext-template-and-guides` → merged `--no-ff` into `dev` |
| Commits | `ade2d99` feat(ext) template + scaffold copies it · `8eee79b` fix(ext) F1/F5 adapter identity · `b2af8f3` fix(qa) F11 run-alone packer-closure check · `061f67c` test(qa) F8/F9/F10 + the real-mount template lane + the ONE re-pin · `4318ac1` docs(ext) the two adaptation docs + links + report status · `fdbca48` chore(evidence) |
| Merge | `adbdc32` merge … into dev (655 files, +55 271 / −2 — almost all evidence) |
| Pushed | **NO.** `master` untouched; push/tag is the release flow and needs an explicit user decision |
| Frozen state verified | every committed blob matches the digest the verifier measured (guide pair `f8f771e8…`/`07f7f9ff…`, agent contract `9a34622c…`, report pair `ed903aaf…`/`34daae01…`, README pair `8367a10e…`/`4cbda5db…`, hub pair `f90ea958…`/`f8715202…`, anchor target `mpd-ext/src/index.ts dd3bdd00…`, `VENDOR_LOCK.json 6b65176a…`, `scripts/mpd-ext.mjs 60d79012…`, `package.json ea608ea2…`) |

## 2. Gates on the MERGED tip (`adbdc32`) — 14/14 green

Unit from a clean cwd **755 pass / 0 fail** (exit 0) · verify-vendor · verify-docs-parity (36 pairs,
failed=0 violations=0) · verify-rows-parity (25 row ids) · `mpd-ext --self-test` (52 checks) · validate
example · validate template · closure `--self-test` 6/6 · closure check · pack-mpd · and the four wave
lanes (`bundle-lifecycle`, `extension-template`, `extension-lifecycle`, `extension-mcp-bridge`) all
`ok:true`. Log: `evidence/extensions/captain-suite-run/MERGED-TIP-gates.txt` +
`MERGED-TIP-unit.txt`. The integrator's own sweep on the frozen tree is 15/15 for the same state.

## 3. Disposition of the two gates the integrator waived

**(a) `bun test packages` from the REPO cwd — WAIVED, with the cause proven and a replacement gate.**
The two failures are a PRE-EXISTING, non-hermetic assertion
(`packages/mpd-config-plugin/test/settings-wiring.test.ts:352`, `:419`) that requires
`existsSync(join(process.cwd(), ".mpd", "mpd.jsonc")) === false`; this workspace HAS that gitignored file
by captain decision (the watchdog tuning the user asked for). Captain measurements: the file alone from
a clean cwd 23 pass / 0 fail; the whole suite from a clean cwd **755 pass / 0 fail** (exit 0). The
plugin and its tests are outside this wave's change set (unchanged since `a647d47`). Replacement gate:
the clean-cwd invocation, which is what §2 records. Friction item **T-57**.

**(b) `bun run test:qa:all` — WAIVED, with the credential wall removed and the remaining failure proven
pre-existing.** The user supplied the key (`export DEEPSEEK_API_KEY=…` in `~/.bashrc`; injected by
extracting that one line — non-interactive `source ~/.bashrc` is blocked by its interactive guard — and
**no credential value was ever printed or written**). With it, the previous `MISSING_CREDENTIAL` abort is
gone: lane 1's live arm reads `live: {"ok":true,"exit":0}`. The suite still aborts at lane 1
(`agent-teams-adopt`) at its **web-route** step: `webRoute {"ok":false,"status":401}`, whose `web.log`
shows `client-modules: package @mpd-dsh/mpd resolves from multiple active Loader sources` — a
loader double-source conflict between the installed bundle and a checkout-absolute row, naming two
paths **neither of which is in this wave's change set**.

Because that design aborts the loop at the first red lane, the other 26 lanes were run INDIVIDUALLY by
the captain: **21 green / 5 red**, and every red lane was then re-run on a **PRE-WAVE `git worktree` at
`1f38e3c`** (self-verified: `HEAD=1f38e3c`, `templates` entries 0, `SKILL.md` differs) with the same
key: **all five fail there too**, with identical signatures and ZERO environment-only errors in the
pre-wave logs.

| Lane | Pre-wave `1f38e3c` | Wave `adbdc32` | Cause (measured) |
|---|---|---|---|
| `agent-teams-adopt` | exit 1 | exit 1 | loader double-source conflict in its web arm (above) |
| `session-start-team` | FAIL (`twoSided`, complex `[0,0,0]`) | FAIL (`[1,0,1]`) | the `team:`-flagged prompt provisions no team — pre-wave reading is WORSE |
| `workmate-library` | FAIL (`isolation.realWm=/root/.mpd/workmate`) | FAIL (same) | its isolation assertion against the real workmate root |
| `web-settings-bridge` | FAIL (`W2a/W2b`, W2c..E ok) | FAIL (same) | card checks; reproduced with `.mpd/mpd.jsonc` moved aside from a clean cwd |
| `vision-smoke` | — | FAIL | `missing DEEPSEEK_API_KEY in ~/.dsh/.credentials.yaml` — it reads the FILE, not the env |
| `mount-assert` | — | exit 2 | the suite calls it without the `--expect` it requires — a wiring bug that can never pass inside the loop (**T-59**) |

Conclusion: **no red lane is attributable to this wave**, and the host's QA baseline was not green
before it either — registered as **T-60** (the 27 lanes must be restored as a per-host baseline before
`test:qa:all` can serve as an acceptance criterion), with **T-58** (a single red lane hides the other 26).

## 4. Incident + integrity

- **Evidence overwrite (self-reported, corrected):** a verifier re-ran the prober without `--json-out`,
  rewriting `probe-report.json` inside t7's directory. Impact assessed as content-identical
  (deterministic function, unchanged inputs, byte-identical stdout) but byte-identity was NOT provable
  because no digest of the original had been stored. Its corrective recomputation of t7's own snapshot
  over 13 directories / 356 files reproduces `441c5ba89620c937f2908c1e9543cb2a063c2a14f32ecee36372b8f3e42d4124`
  exactly (modified=0, missing=0). Friction item **T-53**.
- **Task-record hygiene:** t19's `output` prose is empty (terminal immutability blocked the follow-up
  post) and t12's record still carries attempt 1's findings; both are explained in the ledger and in
  **T-52**. t12 attempt 2 is a FRESH verification (7/7, 0 findings) on the repaired docs, not a reuse.

## 5. Deferred / not done (authoritative list = the ledger's §6 + `.mpd/TODO.md`)

F6's eight pre-`c239407` evidence directories are NOT re-run (boundary-marked). The packed-tree CLI
remains broken BY DESIGN this wave (the packer is read-only for the wave) — disclosed in both docs and
tracked as **T-51**. The plan's §7 register (D-1…D-4) and the wider friction register (**60 items**,
`.mpd/TODO.md`) are out of scope. The next wave's top candidates: **T-48** (the watchdog redesign —
`.mpd/plans/watchdog-redesign.md`), **T-51** (packed CLI + the template distribution decision, T-35),
**T-60/T-59/T-58** (restore the QA baseline and stop one lane from hiding 26), **T-57** (hermetic
config assertions).
