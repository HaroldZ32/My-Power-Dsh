# AC-1 proof — `/mpd-codegraph` reachable after the D-1 fix

Stamp `2026-10-28T09-57-41Z-codegraph-d1`. Task T4 (wave `fix/codegraph-reachability`).
Case: `skills/dsh-qa/scripts/user-surface-mount.ts` — `node skills/dsh-qa/scripts/user-surface-mount.ts --profile <sandbox profile> --evidence <this dir>`.

## What was booted (checkout tree, never the installed copy)

1. Rebuilt with the PINNED toolchain, from the repo root:
   `.toolchain/node_modules/.bin/bun build packages/mpd-codegraph-plugin/src/index.ts --target node --format esm --outfile packages/mpd-codegraph-plugin/dist/index.js`
2. `node scripts/pack-mpd.ts` — staged `dist/mpd-package` (exit 0). The packed plugin build is
   `sha256 9da754c45b39c63952e6fa5aa2ff73a4e0a2363f06e9ca4aac46040b7bb43237`, byte-identical to the
   rebuilt checkout dist.
3. A sandbox profile whose `node_modules/@mpd-dsh/mpd` IS that packed tree (a real directory, copied in;
   the case then copies the profile into its own `.qa-user-surface` sandbox, source untouched):
   `S=$(mktemp -d); mkdir -p "$S/profiles"; cp -a ~/.dsh/profiles/dsh-tui "$S/profiles/dsh-tui";
   rm -rf "$S/profiles/dsh-tui/node_modules/@mpd-dsh/mpd"; cp -a dist/mpd-package "$S/profiles/dsh-tui/node_modules/@mpd-dsh/mpd"`
4. The model step has no credential, so the one turn is EXPECTED to fail; the case records it and does
   not depend on it (`doesNotProve`).

## Observed result (the case's own assertions, `result.json`)

```
ok: true   complete: true   mode: profile-artifact
assertions=119 passed=86 failed=0 findings_or_bounds=33
```

| assertion | verdict | raw |
|---|---|---|
| `userSurface.command.mpd-codegraph` | **PASS (gating)** | `registry=true paletteCount=1 paletteRows=mpd-codegraph plane=shared plane` |
| `userSurface.row.mpd-codegraph` | PASS | `sink=<ws>/.mpd/logs/mpd-codegraph.log bytes>0 state=2` |
| `userSurface.bundleResolution` | PASS | `source=profile dir=…/node_modules/@mpd-dsh/mpd version=0.16.1 profileVersion=0.16.1 sameCopyDigests=true` |
| `userSurface.profileRowListWins` | PASS | `profileRows=36 bootEntries=155 missing=-` |

`userSurface.command.mpd-codegraph` is **absent from NOT_PROVEN** (the remaining NOT_PROVEN entries are
preset-plane rows and `mpd-better-sidebar`/`persona`/harness rows the case has always listed).

Registry listing at `tick-14`: `commands=34` and `mpd-codegraph` IS in the list
(`probe.json`, `probe.json.ticks.ndjson`). Palette witness: `palette/cmd-mpd-codegraph.pane.txt` shows
the palette row and the executed command; `palette/cmd-mpd.pane.txt` shows the row in the open palette.

Baseline to beat (pre-fix, packed artifact): `evidence/gates/user-surface/2026-10-28T09-42-52Z` —
`commands=33`, 85 passed, 34 findings, `userSurface.command.mpd-codegraph` in NOT_PROVEN.

## Gates run for this task (`gates/`)

| gate | result |
|---|---|
| `bun test packages/mpd-codegraph-plugin` (pinned 1.4.0) | `15 pass / 0 fail`, exit 0 |
| `bun run typecheck` | exit 0 |
| `node scripts/verify-comment-coverage.ts` | `VERDICT: PASS`, exit 0 |
| `node scripts/verify-dist-fresh.ts` | `34/34 targets fresh`, exit 0 |

### The regression arm is falsifiable — mutation evidence

`gates/mutation-inject-empty.log` is a ONE-VARIABLE mutation run: the shipped declaration was
temporarily set back to `export const inject: string[] = []` (the 0.16.1 shape), the package suite was
run, and the file was restored from `gates/mutation-backup-src-index.ts` (byte-identical afterwards —
the log's last line is `restored`). Observed under the mutation: **14 pass / 1 fail**, exit 1, the
failure being `D-1 … the shipped declaration covers the command registry, and it is the harness's own
id` (`Expected: true, Received: false`). Under the fix the same suite is 15 pass / 0 fail. So the arm
that guards this defect really does redden on the old behaviour; the NEGATIVE CONTROL arm inside the
suite keeps the predicate itself falsifiable on every ordinary run.

## Bounds (stated, not glossed)

- The WEB plane is NOT measured by this case (its own `doesNotProve` says so); only the shared command
  plane (the agent's registry) and the TUI palette are proven here.
- One boot, one architecture, one machine. The case's palette captures are a TUI witness, not a pixel
  diff.
- The pending-composition tradeoff is a DESIGN bound of the fix, not something this run can show: a
  composition that mounts `mpd-codegraph` WITHOUT a `commands` service now leaves the row pending (no
  index init), which is loud (the loader reports the non-activation) versus the old silent noop.
- The case's `mode=profile-artifact` reads the sandbox profile's copy, which this run made BYTE-EQUAL
  to the packed checkout tree; `sameCopyDigests=true` is what makes that equivalence an assertion rather
  than a claim.
