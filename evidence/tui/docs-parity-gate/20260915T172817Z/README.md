# t76 evidence — the doc-pair gate hardened (repair round 2)

Task `t76` closes the findings of `t75`'s adversarial review of the gate I wrote in `t60`: the
gate was enforcing, but its DISCOVERY had false negatives, one output line contradicted its exit
code, and the exemption count read as more than it was. No git writes.

| File | What it shows |
|---|---|
| `output.log` | All four gates verbatim: the 14/14 self-test, the census (`pairs=34 failed=0 violations=0 exempt=15 — PASS`), `bun run typecheck` exit 0 and `tui-spec-conformance --self-test` exit 0. |
| `result.json` | The five changes, the new self-test cases, the T75 finding → fix map and the gate exits. |

## What changed

1. **Recursive discovery (T75-DISCOVER-1).** `docs/` is walked at ANY depth for `*.md`, and
   `extensions/` at any depth for `README.md`; a nested pair can no longer hide. Non-README `.md`
   files under `extensions/` (extension skills, personas) are ASSETS and are deliberately not asked
   for a twin — the header says so, and a self-test case pins it.
2. **Inverse scan (T75-DISCOVER-2).** Every `*.zh-CN.md` discovered must have its non-zh twin;
   otherwise `zh-CN file has no EN twin (<en> is missing)` is a violation. An inverse orphan whose
   EN path is an exempt record stays a printed exemption (subject to the same map).
3. **An undocumented package is a FAILURE.** A non-exempt `packages/<dir>/` with no README now
   produces `package-no-readme:<dir>`, so `ok` is false and the exit is 1; `mpd-mcp-shared` keeps its
   recorded exemption. The note text is therefore true.
4. **Exemption bookkeeping.** The header and each reason state that **13 of the 15** `EXEMPT_LONE_FILES`
   entries are live on this tree while **`docs/adder4.md` and `docs/cnt8.md` are anticipatory** (named
   by AGENTS.md §3, absent here) — so the count is not read as "15 evaluated paths".
5. **Scoped pointer wording.** AGENTS.md's Language-policy sentence now says the gate enforces its
   four rules *for every pair it discovers* (recursive `docs/`, `extensions/**/README.md`,
   `packages/*/README.md`, the root README) and that a zh-only document or an undocumented package is
   a violation; the §4 row carries the same scope note.

## Self-test (14/14, was 7)

New cases: recursive discovery of nested `docs/`/`extensions/` pairs · an extensions ASSET is not
demanded a twin · a nested pair's mis-pointed switch link fails · a zh-CN file with no EN twin is a
violation · an inverse orphan on an exempt path is an exemption · a non-exempt package without a
README fails · the exempt package stays a note. The original seven (clean tree, every exemption
asserted with its reason, three mutants, both exempt-gains-a-twin cases) are retained.

## Census on the current tree

`[verify-docs-parity] root=/root/dshProj/my-power-dsh pairs=34 failed=0 violations=0 exempt=15 — PASS`
(exit 0). The recursion found **no new pairs** today — it is preventive: a nested pair would now be
discovered instead of silently skipped.
