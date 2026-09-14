# t14 addendum — captain pre-flight brief items (Reviewer, 2026-09-11T04:27Z)

The brief arrived after t14 was already completed (verdict **pass**). Nothing in it changes the
verdict: the round-2 record was built from my own runs on the repaired revision, with no green
inherited from round 1. This addendum closes the two items the brief adds.

## 1. R1 (low, open follow-up, NOT blocking) — reproduced with my own raw output

**Ordering defect in `packages/mpd-verif-plugin/src/regress.ts`:** the regress work dir is created
BEFORE the cocotb iron gate —
```
:100  const stamp = runStamp()
:101  const regressDir = join(workDir(exec), "regress", stamp)
:102  mkdirSync(regressDir, { recursive: true })
:135  const gate = requireCocotbVenv(undefined, exec)
```
`sim.ts` has the correct order (gate at `:200`, case dir created at `:209`), so this is regress-only.

**My reproduction** (`repro-r1.ts` / `repro-r1.log`; no session, `process.chdir("/root/dshProj")`):
```
[t14-r1] no-session verifRegress code=EROFS
[t14-r1] message=EROFS: read-only file system, mkdir '/root/dshProj/.mpd/verif'
[t14-r1] is_VERIF_E_NO_VENV=false
[t14-r1] mentions_host_workdir=true
```
In t13's live run the same call surfaced through the tool boundary as `VERIF_E_RUN` with
`ENOENT mkdir '/root/dshProj/.mpd/verif/regress/…'`. Both are the same defect: a no-session
`mpd_verif_regress` reports an opaque filesystem failure at the HOST root instead of the actionable
`VERIF_E_NO_VENV` the iron rule is supposed to emit first.

**Scope/severity:** a calling SESSION is unaffected — with `exec` the gate passes and the lane
proceeds (my round-2 `A4_verifRegress_exec` proof). Only agentless / unit-test callers see it. Low.

**Recommended follow-up (not applied — the brief deliberately froze the tree):** move the gate above
the stamp/mkdir pair in `regress.ts` (or compute `regressDir` only after the gate), so the refusal is
structured for every caller; one-line reorder with the existing negative-control pattern as its test.

**Why it is not blocking:** it is a diagnostics-ordering issue on a path that no session-scoped tool
call takes, it changes no state, and every session-scoped acceptance criterion of the reviewed
revision is met with raw evidence.

## 2. Contract-generation defect (tooling), recorded as the brief asks

The repair task's auto-generated contract lists `AGENTS.md` in BOTH its inScope and its out-of-scope
list (the update gate therefore rejected the edit as `out_of_scope` even though the same contract's
acceptance text requires it), and `sim.ts`, `regress.ts` plus the two rebuilt package dists are
required by the acceptance text while absent from inScope. The member declared every one of them as
DECLARED-BUT-UNMATCHED in its task output. I treat them as **legitimate in-scope changes**, not
unauthorized edits, and record the mismatch as a **contract-generation / matcher defect on the
tooling** — the same family as the matcher's refusal to expand `**` that affected t3, t4 and t7.
No reviewer action follows from it; it needs no repair inside this change set.

## 3. Confirmation: the round-2 verdict was re-derived, not inherited

Every item in the t14 verdict came from output I produced on the repaired revision after the brief's
changes landed: `gates-post-t13.log` (typecheck 0; bun test packages 309 pass / 0 fail; test:qa all
26 self-tests; vendor gate PASS), `repro-f1-fixed.{ts,log}` (F1 fixed + no-exec control),
`repro-f6-agentless.{ts,log}` (agentless union path), the F1/F2 negative controls run in isolated
copies, `f4-f6-f5-f7-checks.txt` (pack/counts/hygiene), `cumulative-rules-hygiene.txt`,
`final-exec-less-scan.txt`, `preset-conformance-t14.log` (PASS + negative control), and
`mount/` (my own fresh boot on this tree: 0 apply-crash signatures, probe `DONE=ok`, 4/4 tools
registered). The three spot-checks the brief names were re-derived the same way:
`bun test packages` 309/0, `verify-vendor` PASS, `find evidence -type d -empty` → nothing.

Verdict stands: **pass**.
