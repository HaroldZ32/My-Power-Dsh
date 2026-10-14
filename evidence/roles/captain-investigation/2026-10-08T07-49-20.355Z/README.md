# Captain investigation guard — mount evidence (2026-10-08T07:49:20.355Z)

Contract: `.mpd/plans/lane-l-captain-investigation.md` (lane L). Verification loop: `loop-20261008T073559-e89f04`. Reproduce with ONE command from the repository root:

```
bun packages/mpd-roles-plugin/test/captain-investigation-evidence.ts
```

It runs the clauses L1..L6 in order: the package's pure arms, the two preset-text checks plus the manual-budget measurement, then three REAL headless boots in an isolated `DSH_HOME` (deny mode on a source path, deny mode on a documentation path, allow mode on the same source path), and finally every gate of clause L4. `--dump-config` is deliberately NOT used: it composes rows and never executes plugin code.

| row | ok | reason |
|---|---|---|
| L1-pure-arms | true | bun test packages/mpd-roles-plugin/test/captain-investigation.test.ts -> exit 0 |
| L5-preset-no-self-verify | true | no sentence tells the captain to verify subagent results itself |
| L5-preset-delegation-clause | true | the delegation clause is present |
| L5-preset-mechanical-denial | true | the preset states the mechanical denial and the open documentation band |
| L6-manual-budget | true | AGENTS.md measures 64831 B (within the 65024 B target of the 65536 B cap) |
| L6-move-first | true | the pointer is in place and the moved long form is at its agent-references/ home |
| L2-mount-deny | true | refused: every recorded result is an ERROR carrying the denial sentence, and no source content reached the log |
| L2-doc-band-open | true | the read succeeded and the content reached the session log |
| L3-knob-allow | true | the read succeeded and the content reached the session log |
| L2-isolation | true | ok: 3 session-store key(s), all under the sandbox |
| L2-real-checkout-untouched | true | the real checkout's .mpd/logs/mpd-roles.log is byte-identical across the runs |
| L4-package-tests | true | bun test packages/mpd-roles-plugin -> exit 0 |
| L4-typecheck | true | bun run typecheck -> exit 0 |
| L4-comments | false | bun run verify:comments -> exit 1 |
| L4-manifest | true | bun run verify:manifest -> exit 0 |
| L4-manual-paths | true | /home/haroldzhao/.bun/bin/bun scripts/verify-manual-paths.ts -> exit 0 |
| L4-dist-fresh | false | /home/haroldzhao/.bun/bin/bun scripts/verify-dist-fresh.ts -> exit 1 |
| L4-dist-fresh-roles-only | true | /home/haroldzhao/.bun/bin/bun scripts/verify-dist-fresh.ts --only mpd-roles-plugin -> exit 0 |
| L4-rows | true | bun run verify:rows -> exit 0 |
| L4-preset-conformance | true | /home/haroldzhao/.bun/bin/bun skills/dsh-qa/scripts/preset-conformance.ts --self-test -> exit 0 |

Artifacts: `result.json` (the rows above, machine-readable), `logs/` (one file per gate, the child's whole output), and this README. The boot rows read the ROW LOG the roles plugin writes (`<workspace>/.mpd/logs/mpd-roles.log`, never stdout: R5) and the HARNESS's own session log — a recorded `tool/call` plus the error/allow verdict on its `tool/result` — never the model's prose.

Honest bound: the guard reads a TOOL CALL's arguments, so reaching a source path through `bash` (`cat`, `rg`) is NOT blocked by this rule; and a path is judged by its SPELLING, so a symlink is never resolved.
