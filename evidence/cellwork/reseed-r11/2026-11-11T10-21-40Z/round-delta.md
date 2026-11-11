# PR #109 — final repair round (R11-1 … R11-4, NIT-5 … NIT-7)

Branch `fix/cellwork-reseed`. Prior blind verdict `rec-20261111T100546-25c83d` FAILED on evidence and
observability only (its two Majors were confirmed correct: the board hand-over is one CAS with the TEAM
write; the orphan evidence is narrow). This round changes ONE production file (`protocol.ts`), one test
file, four bilingual docs and the committed `dist/`.

## Landing points

| Item | What changed | Where |
|---|---|---|
| R11-2 render | A landed `rebind` line now appends — only when each has something to say — `; board: N row(s) handed over`, `; M row(s) still need release: <ids> — run agent_teams_task {action:"release", task_id} first` and `; handle adopted from the orphan evidence row` | `packages/mpd-cellwork-plugin/src/protocol.ts:1647` (`boardClausesOf`), appended at `:1660` |
| R11-2 docs | One sentence per doc naming the three rendered clauses | `docs/cellwork.md:714-718`, `docs/cellwork.zh-CN.md:562-565`, `packages/mpd-cellwork-plugin/README.md:444-447`, `README.zh-CN.md:348-351` |
| R11-2 arm | `A34` drives A32's seed (incl. `in_progress` T2) and asserts the RENDER; `A34b` is the paired control (a no-op re-point renders no clause); `A33` now also asserts the adoption sentence | `test/reseed-binding.test.ts:1986` (A34), `:2017` (A34b), `:2105-2111` (A33 render) |
| R11-1 | `A33b`: the surviving record carries `updatedAt: 2027-01-01T00:00:00.000Z`, provably later than the orphan row's own `at` → the SAME request A33 accepts is refused `handle-unevidenced`, `handleOrphanAdopted` appears on neither the outcome nor the `member-rebind-failed` row, the refusal detail says `the record's own write postdates that row`, and TEAM + CELL records are byte-identical after the call | `test/reseed-binding.test.ts:2114` |
| R11-3 | `A19` (the CAS-refused path) now also asserts both served documents' `[id, owner, revision]` triples are unchanged, plus the literal seed board; `A32b` adds the on-disk board check on a per-entry refusal | `test/reseed-binding.test.ts:2231-2293` (A19), `:1948` (A32b) |
| R11-4 | This directory: `result.json` bounds name `AGENTS.md` and `agent-references/verification-flow.md`, both outside `change.diff` | `result.json` |
| NIT-5 | `recordWriteInstantOf(snapshot, path)` accepts the record's `updatedAt` only when it PARSES (`Date.parse`), else falls back to the file mtime — an empty string or non-ISO value is treated as ABSENT instead of being compared as a stamp | `src/protocol.ts:552`, used at `:1312` |
| NIT-7 | The contradictory sentence is replaced in all four docs: **the journal can EVIDENCE a handle no current record names, but it never VETOES a handle a current record does name** | `docs/cellwork.md:676-679`, `docs/cellwork.zh-CN.md:530-533`, `README.md:433-436`, `README.zh-CN.md:340-343` |
| NIT-6 | Documented bound only, no behaviour change: when the TEAM row names NO handle, no board row is handed over (a name-owned row still routes) | `docs/cellwork.md:718-720`, `docs/cellwork.zh-CN.md:565-566`, both READMEs |

## Fail-before

`fail-before.log` is the same test file run with only `+ boardClausesOf(row)` removed from the success
render: **49 pass / 2 fail**, and the two failures are exactly the claws this round adds:

- `A34` — `Expected to contain: "board: 2 row(s) handed over"`.
- `A33` (its new render assertion) — `Expected to contain: "handle adopted from the orphan evidence row"`.

`A33b`, `A32b`, `A19` and `A34b` pass on BOTH sides: they are evidence/regression arms for behaviour the
implementation already has (R11-1 / R11-3), not for a behaviour change — stated so nobody mistakes them
for a fail-before proof.

## Gates (observed)

| Gate | Command | Exit | Observed |
|---|---|---|---|
| typecheck | `bun run typecheck` | 0 | `$ tsgo --noEmit`, no diagnostics |
| comments | `bun run verify:comments` | 0 | `VERDICT: PASS`, 633 files / 58408 declarations |
| docs | `bun run verify:docs` | 0 | `pairs=59 failed=0 violations=0 ... dead=0 — PASS` |
| plugin tests | `bun test packages/mpd-cellwork-plugin` | 0 | `420 pass / 0 fail`, 4179 expect() calls |
| all packages | `bun test packages` | 0 | `4052 pass / 6 skip / 0 fail`, 4058 tests across 261 files |
| dist freshness | `node scripts/verify-dist-fresh.ts` | 0 | `34/34 targets fresh (each rebuilt twice, byte-identical)`, 1 prebuilt NOT COVERED |
| dist rebuild | `.toolchain/node_modules/.bin/bun build packages/mpd-cellwork-plugin/src/index.ts --target node --format esm --outfile packages/mpd-cellwork-plugin/dist/index.js` | 0 | bun 1.4.0 (the repo's `buildToolchain`), 31 modules, 0.58 MB |

The 6 skips are pre-existing environment bounds: 2 Subversion-CLI arms (no `svn`/`svnadmin`), 1 official
live-team readout, 3 `mpd_comment_check` arms (no `@code-yeongyu/comment-checker` binary). None is touched
by this round.
