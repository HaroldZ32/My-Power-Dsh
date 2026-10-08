# Captain investigation guard — mount evidence (2026-10-08T07:57:50.935Z)

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
| L4-comments | true | bun run verify:comments -> exit 0 |
| L4-manifest | true | bun run verify:manifest -> exit 0 |
| L4-manual-paths | true | node scripts/verify-manual-paths.ts -> exit 0 |
| L4-dist-fresh | true | node scripts/verify-dist-fresh.ts -> exit 0 |
| L4-dist-fresh-roles-only | true | node scripts/verify-dist-fresh.ts --only mpd-roles-plugin -> exit 0 |
| L4-rows | true | bun run verify:rows -> exit 0 |
| L4-coupling-inventory | true | bun packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts -> exit 0 |
| L4-preset-conformance | true | node skills/dsh-qa/scripts/preset-conformance.ts --self-test -> exit 0 |
| L5-preset-conformance-real | true | node skills/dsh-qa/scripts/preset-conformance.ts -> exit 0 |

Artifacts: `result.json` (the rows above, machine-readable), `logs/` (one file per gate, the child's whole output), and this README. The boot rows read the ROW LOG the roles plugin writes (`<workspace>/.mpd/logs/mpd-roles.log`, never stdout: R5) and the HARNESS's own session log — a recorded `tool/call` plus the error/allow verdict on its `tool/result` — never the model's prose.

Honest bound: the guard reads a TOOL CALL's arguments, so reaching a source path through `bash` (`cat`, `rg`) is NOT blocked by this rule; and a path is judged by its SPELLING, so a symlink is never resolved.

## What the boot rows observed (verbatim)

`logs/records-deny-source.json` is the harness's own decoded record of the refused call: one `tool/call`
for `read` on `packages/probe/src/probe.ts`, and its paired `tool/result` whose text begins
`Error: captain investigation rule: … is refused — the workspace's TOP-LEVEL session does not run
reconnaissance …`. `logs/records-deny-docs.json` and `logs/records-allow-source.json` carry the two
positive controls (`PROBE_DOC_MARKER`, `PROBE_SOURCE_MARKER`). The boots' own row logs are copied beside
them (`logs/run-*-rowlog.log`) and carry the registration line verbatim:

- deny runs: `[mpd-roles] team plane: readOnlyGuard=installed deny=7 verifyGate=installed captainInvestigation=deny rosterSection=agent-scoped order=605 sessionGate=mechanical`
- allow run: `[mpd-roles] team plane: … captainInvestigation=allow …`

## Repo-wide suite (the coupling entry's own proof)

`logs/L5-bun-test-repo-wide.log` is `bun test packages` run on this tree AFTER the frozen inventory entry
landed: `1685 pass, 3 skip, 0 fail, 22134 expect() calls, Ran 1688 tests across 104 files` — `EXIT=0`, so
the `cross-package-coupling-inventory` arm is green in the suite as well as on its own
(`logs/L4-coupling-inventory.log`, `RESULT: PASS (the frozen inventory describes the band exactly)`).

## Earlier directories under this slug

Three earlier stamped directories are INTERIM runs of this same harness, kept rather than pruned, and
each is explained by the run that superseded it:

- `2026-10-08T07-46-35.829Z` and `2026-10-08T07-49-20.355Z` — the harness's session-log decoder still
  selected content blocks by `type:"tool-result"`, a shape the installed harness does not write (it writes
  `type:"text"`, measured against a real session log), so the three boot rows read as failures there even
  though the guard was working. The decoder now reads the text block the harness really writes and treats
  the guard's own `Error:` prefix as the error marker.
- `2026-10-08T07-54-10.634Z` — decoder fixed, boot rows green; red on two rows only. `L4-dist-fresh` was
  red with ONE stale target, `packages/mpd-team-core-plugin/dist/index.js` (another lane's `src` edited at
  15:44, its rebuild landed before the final run, which is why the final run is green). And
  `L5-preset-conformance-real` failed at startup with `bun is unable to write files to tempdir: EROFS`
  because `process.execPath` is `bun` when this harness runs under bun; node-targeted gate rows now spawn
  `node` explicitly (`NODE_BIN`).

The directory above is the run to read, and it is the run whose rows are tabulated above.
