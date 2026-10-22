# T5 / finding F-2 — one-shot refusal paraphrase in the `mpd-roles-plugin` README pair

Task: `T5` (`F-2 repair: clarify the one-shot refusal paraphrase in mpd-roles-plugin README pair`).
Reviewer finding F-2 (Low): both READMEs paraphrased `delegationRefusal` as naming "Agent Teams and
`send_message`" WITHOUT the qualifier, which reads as if `send_message` were a consult route. The
shipped refusal is correct; only the two README sentences were misleading.

## Change (docs only — no source, no tests, no config)

- `packages/mpd-roles-plugin/README.md` — the delegation-gate paragraph now states the qualifier:
  "`send_message` continues only an EXISTING TEAM child, never a finished consult (consults are
  one-shot)".
- `packages/mpd-roles-plugin/README.zh-CN.md` — the same sentence, 简体中文: "`send_message` 只能继续
  **已存在的 TEAM 子会话**，绝不用于已结束的咨询（consult 是一次性的）".

The wording mirrors the shipped `delegationRefusal` text exactly in meaning ("a consult is one-shot —
`send_message` continues only an existing TEAM child, never a finished consult"), so the README and
the refusal cannot drift apart.

## Gate

$ bun run verify:docs
  [verify-docs-parity] links=440 checked=408 resolved=408 dead=0 exemptProvenance=0 absentSite=0
    ignoredExternal=26 ignoredAnchorOnly=6 files=119
  [verify-docs-parity] root=… pairs=49 failed=0 violations=0 exempt=24 derived=3 links=440 dead=0 — PASS

## Scope

`git diff` for the pair contains exactly the two sentences above; nothing else was touched. The
task's write scopes (both READMEs + this evidence directory) were respected.
