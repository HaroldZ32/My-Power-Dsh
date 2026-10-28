# Verifier baseline — `/mpd-codegraph` defect-closure wave

Role: independent verifier seat (Reviewer). Basis: the frozen contract `.mpd/plans/fix-codegraph.md`
plus the repository documentation band (`.mpd/**`, `docs/**`, `evidence/**`, `agent-references/**`,
root `AGENTS.md`). No implementation has been read to form any verdict.

## Measurement moments (UTC) and frozen hashes

| Fact | Value | Read at (UTC) |
|---|---|---|
| Contract sha256 / bytes | `fd0fa2c700558c86c848b399cd3824c9b21972eeb54ed080118577151a82daa2` / 5977 | 2026-10-28T09:45:02Z |
| Branch HEAD | `f5beb1ae95d97ba013b4b9de65827a969ee9ed1f` (`fix/codegraph-reachability`) | 2026-10-28T09:45:02Z |
| `origin/dev` | `f5beb1ae95d97ba013b4b9de65827a969ee9ed1f` | 2026-10-28T09:45:02Z |
| Tracked tree at that moment | 1 modified file (`skills/dsh-qa/scripts/codegraph-smoke.ts`, T2 in flight) | 2026-10-28T09:45:02Z |
| Wave evidence artifacts | none yet (`evidence/codegraph-d1/` absent) | 2026-10-28T09:46Z |

The contract file lives under `.mpd/`, which `.gitignore` excludes — the frozen basis is an untracked
wave artifact by design; this is not treated as a defect.

## Baseline corroboration (contract claims vs. the documentary record)

D-1 is real and measured, `evidence/gates/user-surface/2026-10-27T16-33-27Z/green/result.json`:

- `userSurface.row.mpd-codegraph` → `ok:true`, `raw: "sink=<ws>/.mpd/logs/mpd-codegraph.log bytes>0 state=2"` — a log-sink witness ONLY.
- `userSurface.command.mpd-codegraph` → `ok:null`, `gating:false`, `finding:"documented-command-unreachable:mpd-codegraph"`,
  `raw: "registry=false paletteCount=null paletteRows=- plane=shared plane"`.
- Run shape: `mode=profile-artifact`, `startedAt 2026-10-27T16:35:08.158Z`, `finishedAt 2026-10-27T16:36:41.448Z`.

The documentary claims the contract calls out are present, in BOTH languages:

- `docs/user-guide.md` §12 table, `/mpd-codegraph` row → surface "Web + TUI"; twin `docs/user-guide.zh-CN.md` same.
- `docs/tui.md` package table, `mpd-codegraph-plugin` row → class `usable`, live witness "apply-time `[mpd-codegraph] init status=marker …`";
  twin `docs/tui.zh-CN.md` same.
- `docs/design.md` row `mpd-codegraph` → "effect (auto init) + `/mpd-codegraph` command" under `web + dsh-tui`; twin `docs/design.zh-CN.md` same.

The exemption is real: `NON_GATING_COMMANDS = ["mpd-codegraph"]` in
`skills/dsh-qa/scripts/lib/user-surface-eval.ts` (symbol; the case row in `skills/dsh-qa/SKILL.md`
documents it as the ONE documented exception).

## Environment facts that bound what can be measured here

| Tool | Observed |
|---|---|
| node | v24.21.0 |
| pinned bun (`.toolchain/node_modules/.bin/bun`) | 1.4.0 (the build toolchain) |
| PATH bun | 1.4.2 — NOT the pinned toolchain (`AGENTS.md` §6 trap confirmed live) |
| dsh | 0.2.1-rc.3 |
| dsh-tui | 0.17.0 |
| tmux | 3.6 (a real PTY is available) |
| docker | present, ROOTLESS (`name=rootless`) |

### The subject-of-measurement fact AC-1 depends on

`skills/dsh-qa/scripts/user-surface-mount.ts` defaults to `~/.dsh/profiles/dsh-tui` (symbol: the
options parser), copies that profile into the sandbox, and boots ITS bundle copy. The installed copy
at `~/.dsh/profiles/dsh-tui/node_modules/@mpd-dsh/mpd` is a real DIRECTORY COPY of the bundle,
version 0.16.1, installed 2026-10-27 09:34 local. Its
`packages/mpd-codegraph-plugin/dist/index.js` sha256 equals the checkout's committed dist byte-for-byte
(`8b13219f…`). Consequence for grading: a fixed tree is invisible to this case until the changed
package(s) are rebuilt into `dist/` with the pinned toolchain AND the dsh-tui profile is reinstalled
from this checkout (or a prepared profile is passed with `--profile`). The AC-1 evidence must show
`userSurface.bundleResolution` `source=profile` with the copy's digests matching the tree under test.

## Acceptance matrix as the board currently maps it

Board read from `.mpd/team/teams/team-20261028094217881-c6dx-003.json` at 2026-10-28T09:46Z:
T1 (D-1 diagnosis, no fix — "the implementation is T2's"), T2 (D-2 only — "Touch NO other file"),
T3 (D-3); all three `blocked_by: []`, no review task, no docs task.

| AC | Subject | Owner on the board | Evidence I will demand |
|---|---|---|---|
| AC-1 | `/mpd-codegraph` reachable: registry + palette on a real mount | **UNOWNED (no fix task)** | A real `user-surface-mount` run on the reinstalled profile: `userSurface.command.mpd-codegraph ok:true` with `registry=true` and a non-null palette count; the per-command pane artifact; `result.json` path quoted |
| AC-2 | mechanism diagnosed, fix follows | T1 (diagnosis) | `evidence/codegraph-d1/<ts>/diagnosis.md`: mechanism, deciding measurement, rejected alternatives and what each would have shown, path+symbol references |
| AC-3 | the defect gates again; whitelist re-pinned; negative control | **UNOWNED (no task)** | `NON_GATING_COMMANDS` no longer exempts the command; the case's self-test arms updated to the new truth; a REAL deliberately-broken composition that reddens the command assertion, with its artifact path |
| AC-4 | `codegraph-smoke` reads the marker from the sink, still falsifiable | T2 | `skills/dsh-qa/scripts/codegraph-smoke.ts` (symbol: the marker reader), observed exit code, key lines; the negative arm (marker absent → still fails) |
| AC-5 | D-3 settled (fix or named mechanism) | T3 | `evidence/...d3...`: the sub-assertion that flipped, the structural lane difference, the measurement that decides it; if unsettled, an explicit bound AND the PR statement |
| AC-6 | docs + zh twins tell the measured truth | **UNOWNED (no task)** | Both language files changed in the same commit; `bun run verify:docs` log; the docs' witness matches the measured surface (a log sink is not a reachability witness) |
| AC-7 | no collateral regression | no task (verification) | Full run where every declared row and every other contributed command passes; changed-file set limited to the contract's scope |
| AC-8 | gate list green with logs | no task (verification) | Logs for `verify:comments`, `verify-dist-fresh`, `typecheck`, package `bun test`, `verify:docs`, `verify:manifest`, `verify:rows`, `preset-conformance` (self-test at minimum), `user-surface-mount`; `verify:vendor` only after the single `skills/**` re-pin in the same commit |

## Grading interpretations, stated before the fact

- **AC-1 evidence standard.** The contract says "a log-sink witness is NOT acceptable as reachability
  evidence". The case's per-command assertion plus its palette pane capture and the live registry
  listing are the acceptable shape; a row-level `sink` witness alone fails the criterion.
- **AC-2 citation form.** The contract asks for "file:line"; `AGENTS.md` T-55 binds repo citations to
  symbols. I will accept path + symbol (with or without line), and will not fail a diagnosis whose
  symbol references are exact but whose line numbers are absent.
- **AC-6 scope.** Both languages must move in the same commit. The measured surface is the TUI palette
  and the shared command registry; the case's own `doesNotProve` says the Web plane and a live model
  turn are not proven. A doc that keeps asserting a "Web + TUI" reachability must either carry a
  measured Web witness or qualify the claim; a doc that still cites the apply-time log marker as its
  reachability witness fails AC-6.
- **AC-5 Docker bound.** AC-8 does not require the Docker lane, and this host is rootless; I will not
  demand a Docker run. If D-3 is settled on recorded lane artifacts, I will grade those artifacts and
  say so.
- **Single re-pin.** `skills/**` has one writer this wave. Any `skills/**` change without the matching
  `VENDOR_LOCK.json` `treeSha` re-pin in the same commit fails AC-8.

## Declined to judge (initial list)

- AC-2's "file:line" vs `AGENTS.md` T-55 "cite by symbol" — resolved as above; not a wave finding.
- Web-plane command reachability — not measured by the case and outside AC-1; only the doc wording is graded.
- Docker one-click lane — not in AC-8; rootless only here.
- Whether `/mpd-codegraph` "works" as a feature (index build) — outside AC-1's surface question; bound stated in the case's `doesNotProve`.

## Bounds of this baseline pass

- No gate was run: the tree is not frozen (T2 was editing a tracked file at 09:45Z), so a run now
  would measure a moving tree.
- No implementation was read. No source diff was inspected.
- `codegraph-smoke` (pre-wave) was not run: it is the file under edit by the wave's single skills writer.
- Docker was probed for rootless-ness only; no lane was started.
