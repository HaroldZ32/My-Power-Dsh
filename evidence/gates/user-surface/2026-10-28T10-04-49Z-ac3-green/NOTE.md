# AC-3 — the exemption is retired; `/mpd-codegraph` gates like every other command

Subject files (all under `skills/`, the wave's single-writer band):

- `skills/dsh-qa/scripts/lib/user-surface-eval.ts` — `NON_GATING_COMMANDS` is now **EMPTY**
  (it carried exactly `["mpd-codegraph"]`), and `commandGates`' contract states that a failure now gates
  on ANY composition.
- `skills/dsh-qa/scripts/user-surface-mount.ts` — header rule 2, the gating comment, and the 5b arms.
- `skills/dsh-qa/SKILL.md` — the `user-surface-mount` case row.

## What this (green) run proves

The D-1-fixed bundle still reads GREEN with the exemption gone. `result.json`: `ok: true`,
`assertions=119 passed=86 failed=0 findings_or_bounds=33`, exit 0. The 33 bounds are the unchanged
preset/harness rows; the findings count is ZERO.

| assertion | verdict | raw |
|---|---|---|
| `userSurface.command.mpd-codegraph` | PASS (`gating: true`) | `registry=true paletteCount=1 paletteRows=mpd-codegraph plane=shared plane` |
| `userSurface.row.mpd-codegraph` | PASS | `sink=<ws>/.mpd/logs/mpd-codegraph.log bytes>0 state=2` |
| `userSurface.findings` | PASS | `no non-gating finding on this run` |
| `userSurface.bundleResolution` | PASS | `source=profile … version=0.16.1 profileVersion=0.16.1 sameCopyDigests=true` |

`probe phase=tick-14 loaderEntries=155 commands=34`.

## How the subject was built

    S=.qa-ac3/green/profiles/dsh-tui           # cp -a ~/.dsh/profiles/dsh-tui
    rm -rf "$S/node_modules/@mpd-dsh/mpd"
    cp -a dist/mpd-package "$S/node_modules/@mpd-dsh/mpd"   # the repo's own fresh pack

    node skills/dsh-qa/scripts/user-surface-mount.ts --profile "$S" \
         --evidence evidence/gates/user-surface/2026-10-28T10-04-49Z-ac3-green

The packed plugin build is `sha256 9da754c45b39c63952e6fa5aa2ff73a4e0a2363f06e9ca4aac46040b7bb43237`,
byte-identical to the checkout `packages/mpd-codegraph-plugin/dist/index.js`. The live profile is only
READ (the case copies it into `<repo>/.qa-user-surface/…` and removes that sandbox); no real `~/.dsh`
and no repo `.mpd/` state is written.

## The red half

`evidence/gates/user-surface/2026-10-28T10-06-34Z-ac3-broken/` — the SAME pack with only the pre-fix
codegraph plugin build (`var inject = []`) swapped in — exits **1** with
`FAILED=[userSurface.command.mpd-codegraph]` (`ok: false`, `gating: true`) and `commands=33`.

The pre-change baseline for that same composition is `evidence/gates/user-surface/2026-10-28T09-42-52Z/`:
`ok: true` with the row recorded as `ok: null`, `gating: false`, finding
`documented-command-unreachable:mpd-codegraph`. That false green is the defect AC-3 closes.

## Offline arms (`--self-test`, 68 arms, exit 0)

- `command.whitelistIsEmpty` — the exemption list is EMPTY (it was exactly `mpd-codegraph`).
- `command.codegraphUnreachableGates` — `evaluateCommand("mpd-codegraph", [], emptyPane).ok === false`
  AND `commandGates("mpd-codegraph", false, true)`: the broken composition FAILS and GATES.
- `command.everyContributedCommandGates` / `command.anyFailureGatesOnBrokenComposition` — all seven
  commands gate, on both a complete and an incomplete composition.
- `command.passGates`, `command.failureGates`, `command.unknownNameGates` — unchanged behaviour.

## Gates run for this change

- `node skills/dsh-qa/scripts/user-surface-mount.ts --self-test` → `arms=68 failed=0`, exit 0.
- `bun run verify:comments` → `VERDICT: PASS` (479 files, 43586 declarations), exit 0.
- `bun run typecheck` (`tsgo --noEmit`) → exit 0.

## Bounds

- One boot, one machine, one architecture; the palette witness is a TUI capture, not a pixel diff.
- The WEB plane is not measured (the case's own `doesNotProve`).
- The `gating: false` finding shape is retained in the record types and the branch that produced it is
  unreachable while the list is empty; the mechanism is kept so the pin (`command.whitelistIsEmpty`) can
  catch a re-opened exemption.
