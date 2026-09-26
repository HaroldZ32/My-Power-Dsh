# Captain's t25 ADDENDUM — quoted, with the measured compliance

The addendum arrived AFTER t25 reached `completed`; the completion contract could not carry it (the
captain's amend was refused by the ownership guard). This page beside `result.json` (never editing
it) quotes the four constraints and records the compliance check re-run at 2026-09-17T07:47:13Z
(raw: `addendum-recheck.log`).

## The addendum, verbatim (four constraints)

> 1. **SURGICAL ONE-TOKEN EDIT.** `EXTENSIONS-FOR-AGENTS.md` is the checker's `AI_DOC` in
>    `scripts/check-citations.mjs` (beside `SKELETON_ID = "for-agents-skeleton"`, listed as a SUBJECT
>    labelled "agent contract") and it SUPPLIES three arms: `skeletonFromDoc()` materializes the
>    ```json block and validates it with the CLI, and `split-headings` / `split-prose` read the whole
>    file. Replace the ONE backticked path token in the line-49 sentence; touch nothing else.
>    **PROOF = `node scripts/check-citations.mjs --self-test` 21/21** plus the repo-wide run — the
>    citation list alone is NOT the proof.
> 2. **NO BILINGUAL OBLIGATION, AND NO PAIR DRIFT.** No `EXTENSIONS-FOR-AGENTS.zh-CN.md` exists on
>    disk and the file is not in `verify:docs`'s discovery roots, so there is no paired edit and the
>    37 pairs cannot move. `bun run verify:docs` must stay exactly `pairs=37 failed=0`.
> 3. **THE ORDERING CONSTRAINT (new, and it is why this task exists BEFORE my re-pack).** The file is
>    `REQUIRED_ROOT_FILES[0]` in `scripts/verify-pack-closure.mjs`, and the packed rule BYTE-COMPARES
>    it against the source. So the moment you re-point the repo file, the artifact's copy differs and
>    `node scripts/verify-pack-closure.mjs` exits 1 on a `ROOT-FILE` finding **until my single
>    integration re-pack lands**. That is the EXPECTED, PROVENANCE-NAMED drift lane B's rule covers
>    (writer + stamp + anchor) — **report it as such, do not try to fix the artifact**.
> 4. **THE FROZEN COPY STAYS BYTE-UNTOUCHED**, and the SECOND consumer
>    (`skills/dsh-qa/scripts/lib/immutable-output.mjs:14-15`) is lane D's: it is being fixed INSIDE
>    `t11` because it must land before the single re-pin. Record it as ROUTED; do NOT touch `skills/**`.

## Compliance, measured

| # | constraint | what was done | evidence (re-checked 07:47:13Z) |
|---|---|---|---|
| 1 | surgical one-token edit; proof is the self-test 21/21 + repo-wide, not the citation list | ONE backticked token on line 49; `git diff --numstat` = `1 1`; 236 lines before/after; heading `## 3.` still line 46; skeleton block + illustrative annotation untouched | `--self-test` exit 0, **21/21**, listing all 8 negative-control arms AND the three arms that read the file — `ok skeleton-validates` (validate exit 0; 1 skill/1 flow/1 role/1 mcp server), `ok split-headings`, `ok split-prose`; repo-wide exit 0, 13/13, 249 citations, 19 symbol-first / 30 line-dependent / 0 rot-flagged (`addendum-selftest.stdout`, `addendum-run.stdout`) |
| 2 | no bilingual obligation, `pairs=37 failed=0` | no paired edit made; the file has no zh-CN twin and is outside the discovery roots | `bun run verify:docs` exit 0 — `pairs=37 failed=0 violations=0 exempt=17 derived=3 — PASS` (`addendum-verify-docs.log`) |
| 3 | ordering re-point → re-pack; report the ROOT-FILE drift as expected, never fix the artifact | re-point landed 07:43:53Z; measured the drift and reported it as EXPECTED/PROVENANCE-NAMED (stamp 05:19:48Z, before/after sha256, one-token delta); `dist/mpd-package/**` NOT touched | `node scripts/verify-pack-closure.mjs` exit 1, exactly ONE violation: `ROOT-FILE … differs byte-wise …` (`pack-closure-after-repoint.log`, analysed in `PACK-CLOSURE-DRIFT.md`) |
| 4 | frozen copy byte-untouched; second consumer recorded as ROUTED; no `skills/**` | frozen copy never opened for writing; second consumer recorded (previously ACCURATE-BUT-INCOMPLETE + "ride-or-freeze with the captain" → now **ROUTED to `t11`**, which must land before the single re-pin); no write to any `skills/**` path | `evidence/extensions/docs-claims/check-citations.mjs` = `dfe26090…` and `scripts/check-citations.mjs` = `d64dfeb5…` unchanged; `EXTENSIONS-FOR-AGENTS.md` = `a7e57dec…` |

## ROUTING UPDATE (constraint 4)

The second consumer is no longer an open decision: it is **ROUTED to `t11`** (lane D's in-flight
`skills/**` change), because it must land INSIDE the single re-pin window. Lane B2 takes no action
there — the earlier "ride or freeze" wording is superseded by this routing.
