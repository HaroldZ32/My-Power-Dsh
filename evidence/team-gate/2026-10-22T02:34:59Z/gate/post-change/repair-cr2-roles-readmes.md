# T18 / CR round 2 — qualify the README dispose claim (EN + zh)

Task: `T18` (repair). Scope: `packages/mpd-roles-plugin/README.md` + `README.zh-CN.md` only.

## The finding

Both READMEs said “the adapter disposes the activation once the report settles” without the
host-generation qualifier. That is true only on a host exposing the `startActivation` seam; the
retired `start` fallback returns a report with NO activation object, so there is nothing to dispose.
Read unqualified, the sentence over-claims dispose coverage on older hosts.

## The change (both languages, same meaning)

- README.md: “On a host that exposes `startActivation` the adapter disposes the activation once the
  report settles — the retired `start` fallback has NO activation to dispose — so either way the
  consult is **not reused**: ask a NEW question with a NEW spawn.”
- README.zh-CN.md: “在提供 `startActivation` 的 host 上，报告落定后 adapter 会 dispose 该
  activation —— 已退役的 `start` 回退路径**没有 activation 可 dispose** —— 因此无论走哪条路径，
  该次咨询都**不可复用**：新问题请发起**新的** spawn。”

The one-shot CONTRACT therefore stays unconditional in both languages (only the dispose MECHANISM is
host-dependent), and the existing append-only-catalog bound is preserved unchanged.

## Gates (quoted)

$ bun run verify:docs
  [verify-docs-parity] root=… pairs=49 failed=0 violations=0 exempt=24 derived=3 links=440 dead=0 — PASS

$ bun run verify:comments
  VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.

## Scope

`git diff --stat` for the pair: README.md 9 lines (5 changed lines), README.zh-CN.md 1 line — exactly
the two sentences. No source, tests, config or dist touched.
