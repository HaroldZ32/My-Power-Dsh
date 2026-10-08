<!-- docs-parity: exempt verification record (process record, AGENTS.md §3) -->
# Independent verification verdict — T7 (documentation + roster workstreams)

**VERDICT: FAIL.** One BLOCKER finding, and it is a WAVE-level gate, not the docs or roster content:
`bun run verify:gates` exits **1** on the settled revision because its `vendor` member gate FAILS.

**Read this precisely:** the docs subject and the roster subject both PASS the checks this card asked
for (§3, §4). Nothing below says a docs correction is false or that a roster README advertises an id.
What fails is the wave's own criterion "land every gate green" — and a PASS here would be the exact
"a gate is claimed green while its evidence says otherwise" failure this card exists to prevent.

- **Card / loop:** board `T7` (session `4ee18be6-5798-4395-8b9b-8bbd53e1c873`); loop
  `loop-20261008T120019-9f5e26`, contract `.mpd/plans/roster-id-gate-scope.md`.
- **SEPARATE subject, not re-verified here:** the skills corpus migration
  (`loop-20261008T115413-cc1637`, record `rec-20261008T115744-eba194`).
- **Settled revision (measured, quoted with its moments):** `HEAD = 20f312636b1f6fcdb43441d785494d98c3b8df08`;
  working-tree digest `status_digest = 29e3408c…de478e` and the subject-file digest
  `bc0c359e1926230fce7226aba26201382b19a24275f4c662b2474dad4ed77b24`
  read at **T0 = 2026-10-08T12:00:18Z** and re-read at **T1 = 2026-10-08T12:02:30Z**,
  **byte-identical** across a 132-second window that CONTAINS all nine gate runs below.

---

## 1. The gates, run by this seat on the settled revision

| Gate | Command | Evidence id | Exit | Measurement |
|---|---|---|---|---|
| aggregate | `bun run verify:gates` | `ev-20261008T120019-a44429` | **1** | `1/8 member gate(s) failed: vendor (exit=1)` |
| tests | `bun test` | `ev-20261008T120024-eeb219` | 0 | — |
| typecheck | `bun run typecheck` | `ev-20261008T120050-8806a4` | 0 | — |
| docs | `bun run verify:docs` | `ev-20261008T120051-728ff0` | 0 | `pairs=47 failed=0 violations=0 exempt=23 links=424 dead=0` |
| manifest | `bun run verify:manifest` | `ev-20261008T120051-25074c` | 0 | `VERDICT: PASS` |
| comments | `bun run verify:comments` | `ev-20261008T120100-2a3ba0` | 0 | `367 file(s)`, `32419 declaration(s)` |
| rows | `bun run verify:rows` | `ev-20261008T120102-231525` | 0 | — |
| dist | `node scripts/verify-dist-fresh.ts` | `ev-20261008T120103-ad0283` | 0 | `30/30 targets fresh` |
| vendor (direct) | `node scripts/verify-vendor.ts` | `ev-20261008T120115-b7b239` | **1** | reproduces the aggregate's failure |

**7 of 8 are green. The aggregate is red for one reason, and the same gate is red when run directly.**

## 2. FINDING V1 — BLOCKER (wave-level): the `vendor` gate is RED on the settled revision

- **Symptom.** `node scripts/verify-vendor.ts` exits 1:
  `FAIL - asset vendor/mcp-src count drifted: 460 vs 459` and `FAIL - asset vendor/mcp-src treeSha mismatch`,
  both emitted by the `verify:gates` aggregate (`ev-20261008T120019-a44429`, lines 9–10) and reproduced
  by a direct run at 12:01:15Z (`ev-20261008T120115-b7b239`).
- **The single extra path.** `vendor/mcp-src/lsp-daemon/dist/package.json` (98 B, contents
  `{"name":"@code-yeongyu/lsp-daemon","version":"0.1.0","type":"module","private":true}`), the ONLY file
  in that `dist/` directory. It is **untracked and IGNORED** (`git check-ignore` →
  `vendor/mcp-src/lsp-daemon/.gitignore:2:dist/`), which is why `git status` shows nothing — the gate
  counts files ON DISK against the pinned `fileCount: 459`.
- **Moment.** The file's mtime is `2026-10-08T12:00:15Z`. My first gate call began at 12:00:19Z, so **I did
  not create it**; no `bun`/`node` build was running when I measured (`ps` empty), and it is a build
  OUTPUT of the vendored lsp-daemon (its own `build` script writes into `dist/`;
  `scripts/build-mcp.ts:48` builds `lsp-daemon`). **I cannot name the session that wrote it from disk
  alone** — that is a declared bound, not an accusation.
- **Expected.** On the settled revision the vendored snapshot's on-disk file set must match the lock's
  `fileCount`/`treeSha`; the fingerprint half of `VENDOR_LOCK.json` is BLOCKING (AGENTS.md §4 Vendor row:
  "a corrupted fingerprint still FAILS"; §9: "The FINGERPRINTS are blocking"; `bun run verify:gates`
  "expects a CLEAN tree").
- **Change needed (exact).** Remove the stray build output — `vendor/mcp-src/lsp-daemon/dist/` — and
  re-run `bun run verify:gates`. This is **NOT a re-pin**: the artifact is gitignored local build
  output, the committed tree is unchanged, and §9 forbids chasing a change that the repo does not ship;
  the wave's single `VENDOR_LOCK.json` re-pin is the `skills.treeSha` one already recorded
  (`rec-20261008T115744-eba194`). A second lock write would break the one-re-pin-per-wave invariant.
- **Doc source.** `AGENTS.md` §4 (Vendor gate row; "No evidence on disk for a gate = the change is not
  complete") and §9 (fingerprints blocking; one re-pin per wave).

## 3. DOCS subject — the checks PASS; one LOW finding

**The docs gate is a pairing/link/heading verdict, not a truth verdict — the writer said so themselves
(`bounds[0]`), and that bound is correct.** My own sampling of the REPLACEMENTS on disk:

| Claimed replacement | On-disk check (this seat) |
|---|---|
| the dead `scripts/vendor-agent-teams.ts` → `scripts/repin-vendor.ts` | `scripts/repin-vendor.ts` EXISTS; `scripts/vendor-agent-teams.ts` ABSENT |
| `bun@1.4.2` → `bun@1.4.0` (both languages) | `package.json:5` `"buildToolchain": "bun@1.4.0"`; `.github/workflows/gates.yml:73` `bun-version: "1.4.0"` |
| three named reference files → two | `scripts/verify-pack-closure.ts:398` `REQUIRED_REFERENCE_FILES: readonly string[] = ["index.md", "troubleshooting.md"]` — no `agent-teams-deltas.md`; that file is ABSENT |
| the `agent-teams-adopt` QA row DELETED | `skills/dsh-qa/scripts/agent-teams-adopt.ts` ABSENT |
| `packages/mpd-agent-teams-plugin/**` claims re-framed as deleted | the package is ABSENT; `agent-references/troubleshooting.md:1-12` carries the de-vendor banner, and row `:28` now opens with `RETIRED SURFACE (see the banner)` |

All five sampled replacements name things that EXIST (or correctly name things that are gone). The
writer's ledger (`evidence/docs/stale-citations-fix/2026-10-08T11-57-57Z/result.json`) records 23 changes
across 6 files, and its `gate` field quotes the docs gate's own line — which I re-ran independently:
`pairs=47 failed=0 violations=0 exempt=23 links=424 dead=0 - PASS`.

### FINDING V2 — LOW (docs, not a false claim): `agent-references/troubleshooting.md:50` keeps a dead pin command

- **Symptom.** The row's remedy ends `Pins: \`bun test packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts\``
  — that file is ABSENT, so a reader who runs the pin gets "no such file", and the row's neighbours
  (`:28`, `:51`, `:52`, `:106`, `:107`, `:109`, `:110`, `:114`) all carry a `RETIRED SURFACE` marker for
  exactly this class of dead citation.
- **Was reporting it the right call? YES — and it was the harder, honest one.** The file really existed in
  wave 2 (`evidence/terminal-silence/test-repairs/20261002T155522Z/REPORT.md:51` records its sha256
  `e3d6596852ae18ca…`), was deleted since, and **no live file pins that exact T-18 assertion** (the
  package's test dir carries 14 files, none of them that one). Inventing a replacement pin — or pointing
  at a neighbouring test that asserts something else — would have been a false claim, which is worse than
  a flagged gap.
- **Expected / change needed.** Give the row the SAME treatment its neighbours got: a marker stating the
  named test file no longer exists (or drop the `Pins:` clause and keep the `Reading:` clause, which
  still resolves). Do NOT invent a replacement pin.
- **Doc source.** `AGENTS.md` §2 ("Evidence without evidence is incomplete"), and the file's own banner
  (`agent-references/troubleshooting.md:1-12`), which declares the class and is currently applied
  file-wide except for this row's pin.

## 4. ROSTER subject — the contract documents PASS

Judged from the CONTRACT DOCUMENTS, not the runtime: do they advertise an upstream id **as tool input**?

- `packages/mpd-roles-plugin/README.md:42` — *"No surface advertises an upstream alias: a role is
  described by what it does."* Then `:43-52`: *"Internal keys (never tool input): … they are **refused as
  tool input**: `mpd_role_spawn`, `mpd_role_persona` and `mpd_modelchain_resolve` accept a NAME spelling
  only and answer a loud error that lists the roster names — it never repeats the rejected key, and an id
  is never returned, listed or required."* The zh twin (`README.zh-CN.md:29`) says the same.
- `packages/mpd-modelchain-plugin/README.md:12` — an internal key *"is REFUSED with a loud error listing
  the roster names"*; its example call is `mpd_modelchain_resolve { role: "Senior Engineer" }`.

**Judgement: PASS.** The ids appear ONLY inside the passage that declares them internal and refused —
i.e. as *counter-examples*, never as an accepted spelling. That is the opposite of advertising, and it is
the most useful form for a reader. **Explicit note so nobody "fixes" it later:** the ids at
`README.md:44-45` (`oracle`, `sisyphus-junior`, `sisyphus`) are the documented refusal list; deleting them
would remove the contract statement that they are refused.

## 5. What I could NOT verify (stated, not smoothed over)

1. **Who wrote the stray vendor artifact.** Facts only: mtime 12:00:15Z, ignored build output, no build
   running at measurement, not mine. From disk alone the session is not determinable.
2. **The docs corrections are true beyond my sample.** I independently re-derived the five entries in §3
   (the three the captain named, plus the dead-path class). The remaining entries of the 23 were read as
   the writer's ledger against the passing docs gate; I did not re-derive each line-level edit.
3. **Runtime refusal behaviour of the roster tools.** My subject was the contract documents; `bun test`
   (which covers `roles.test.ts`) is green, but I did not exercise a live refusal call.
4. **The Docker lane (T4)** — a different subject and verifier, not touched here.
5. **`dist/mpd-package/docs/**` staleness** — the writer declared it as a bound for the integration card;
   I confirm the bound is declared and did NOT verify the packed copy.
6. **`.mpd/verify/**` gates the wave ran before me** — I ran my own; the writer's logs were not needed.

## 6. The one thing to do first

**Remove `vendor/mcp-src/lsp-daemon/dist/` and re-run `bun run verify:gates` — before T8's integration
commit.** One gitignored build artifact is the ONLY thing standing between this wave and a green
aggregate gate; every other member gate already passes on the settled revision, and no re-pin is
involved.
