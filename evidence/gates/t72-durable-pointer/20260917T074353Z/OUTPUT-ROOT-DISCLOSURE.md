# Captain's t25 ADDENDUM #2 — quoted, with compliance AND a disclosure about my own runs

Addendum #2 also arrived after `t25` reached terminal. `result.json` stays untouched; this note sits
beside it. Raw: `t74-mitigation-rerun.log`, `out-pinned-run.stdout`, `out-pinned-selftest.stdout`,
`run-out-pinned-20260917T075003Z/`, `run-out-pinned-selftest-20260917T075003Z/`.

## The addendum, verbatim in substance

> **(1) THE DRIVER'S DEFAULT OUTPUT ROOT BELONGS TO NO TASK.** The previous owner's mandatory
> pre-flight run of `node scripts/check-citations.mjs` wrote
> `evidence/extensions/docs-claims/runs/run-2026-09-17T07-42-23.320Z` — the checker's DESIGNED default
> (`resolveOutputDir(OUT_EXPLICIT, HERE, "run")`), and a path that is in NO task's `inScope`. Treat
> that directory as a **BEFORE reading, not as your artifact**.
> **(2) SO RUN IT WITH `--out` INTO YOUR OWN EVIDENCE DIR** (e.g.
> `--out evidence/gates/t72-carryforward-<stamp>/run`) … the reason T-74 is a wave-2 row at all:
> without the flag the DEFAULT is the footgun. Your evidence dir lives under `evidence/gates/**`
> (your inScope), so a run pinned there keeps the driver's tree untouched AND keeps every path you
> touched inside your scope.
> **(3) Use the STORED acceptance ARRAY (never the printed rendering)** — the array is the authority;
> the rendering's item boundaries are not (6 items stored vs 5 rendered).

## (1) Compliance, and the peer's run attribution

`evidence/extensions/docs-claims/runs/run-2026-09-17T07-42-23.320Z` is the PREVIOUS OWNER's pre-flight
side effect, treated as a BEFORE reading throughout: it is recorded as theirs in
`HANDOVER-CORROBORATION.md` and it is absent from this task's `changedPaths`. Verified on disk: the
directory exists and its `result.json` carries `13/13`, 249 citations, 19 symbol-first / 30
line-dependent / 0 rot.

## (2) DISCLOSURE FIRST, THEN THE MITIGATION

**Disclosure: my own `t25` runs BEFORE this addendum did NOT use `--out`**, so they wrote into the
same default root — a path inside NO task's `inScope` (t25's inScope is `EXTENSIONS-FOR-AGENTS.md` +
`evidence/gates/**`). Four directories, all of them mine, all green readings:

| default-root directory written by t25 | reading |
|---|---|
| `evidence/extensions/docs-claims/runs/run-2026-09-17T07-43-53.198Z` | 13/13 |
| `evidence/extensions/docs-claims/runs/run-2026-09-17T07-43-53.373Z` | 21/21 (self-test) |
| `evidence/extensions/docs-claims/runs/run-2026-09-17T07-47-13.534Z` | 21/21 (addendum re-check) |
| `evidence/extensions/docs-claims/runs/run-2026-09-17T07-47-14.479Z` | 13/13 (addendum re-check) |

They are left IN PLACE deliberately: they are legitimate readings in the driver's designed history
(50 runs), and deleting evidence would be the worse act. They are disclosed, attributed and never
claimed as `t25` artifacts.

**Mitigation applied (both verify commands re-run pinned):** `node scripts/check-citations.mjs --out
evidence/gates/t72-durable-pointer/20260917T074353Z/run-out-pinned-20260917T075003Z` and the same with
`--self-test` into `run-out-pinned-selftest-20260917T075003Z`. Both exit 0; the artifacts are in-scope.

**T-74's own claim reproduced on this task:** the driver's default tree is byte-identical across the
pinned runs — listing md5 `4da30133ba242550188210f4e3c75f13`, 50 directories, BEFORE and AFTER.

**Baseline vs AFTER, quoted (they must match, and they do exactly):**

| reading | baseline (disclosed, 07:42:23Z) | AFTER (pinned, 07:50:03Z) |
|---|---|---|
| overall | `13/13 checks passed, 0 failed, 249 citation(s) resolved, 19 symbol-first, 30 line-dependent, 0 rot-flagged, 0 pending, 12 illustrative` | identical |
| `citations:EXTENSIONS-FOR-AGENTS.md` | `59 citation(s) (checked 55: path 38, dir 5, command 12; pending 0, illustrative 4), 0 unresolved` | identical |
| machine compare of both `result.json` counter sets | — | `equal: true` |
| `--self-test` | — | `21/21 checks passed, 0 failed` |

## (3) The stored acceptance array (the 6-vs-5 trap)

Already applied, twice: before completing, the STORED acceptance array was read from the contract (the
read-only team-state inspection, not the printed rendering) — **8 items for `t16` and 6 items for
`t25`** — and one result was submitted per stored item with the exact stored criterion strings. Both
completions were accepted on the first terminal call; neither was sized off the rendering.
