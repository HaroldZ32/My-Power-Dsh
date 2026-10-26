# Review — v0.15.5 host adaptation (DSH 0.2.1-rc.3 + dsh-tui 0.17.0) + README version table

Reviewer: reviewer (team M2, task T2, `kind: review`). Subject: T1 by `senior-engineer`.
Basis, in order: the frozen contract `.mpd/plans/adapt-021-rc3-tui-017.md`; the shipped documentation
band; the gates' own observable behaviour. Baseline for the delta: `dev` at `faa273f5`, clean tree.
Findings only — nothing was repaired, and no file the writer touched was edited.

## Assessment

Risk level: **MEDIUM-LOW**. This is a faithful execution of a pin-and-documents contract. All 31
modified paths sit inside T1's declared write scopes; `packages/**`, `dist/**`, `VENDOR_LOCK.json` and
`evidence/**` history are untouched, so every §4 invariant (the `PANEL_CSV_*` gates, the `hostVersion`
fixtures, the `>= 0.16.1` range statements, the historical declaration reads) is preserved by
construction and by the gates. I re-derived the README table from the release tags myself and every
cell matches; the three version carriers agree at 0.15.5; `manifestVersion`/`$schema` stay 0.15; the
`@dsh-std` line is correctly left alone; the one QA red in the writer's own log is environmental and
reproduces green on identical bytes. I found **no defect attributable to the writer** and **no reason
to send work back**. What remains is one High, requirement-level claim the wave cannot yet carry (no
Docker lane has run on the new pair, while the README says the row was verified) and one Medium stale
claim the contract forbade the writer to fix.

## Findings (ranked)

### 1. High — the README asserts a verification the wave has not performed

**What.** Both languages' new section states that each row is "the host pair a release was **built and
verified against** — the Docker real-machine lanes run the install and the mount on exactly that pair",
and the 0.15.5 row is labelled "this release" / "本次发布". No Docker lane has been run on
`(0.2.1-rc.3, 0.17.0)`: T1's own report says so in its bounds, and `evidence/` contains no new Docker
stamp for this pair.

**Where.** `README.md` → `## Version compatibility` (intro paragraph and the `0.15.5` row);
`README.zh-CN.md` → `## 版本对应关系` (same two places).

**Why it matters.** The user's acceptance ask for this wave was explicitly "本机版本较老，用 docker 做
验证". The table is the public surface that certifies the pin pair, so as committed it is a verification
claim the evidence does not carry — the exact class AGENTS §2.3 and §5 forbid. It becomes true the
moment the release sweep runs the lanes; until then it is prospective.

**Direction (described, not applied).** Either run the Docker lanes on the new pair before the tag —
`node scripts/docker-e2e.ts --mode source --require-docker --no-browser` and
`--mode oneclick --require-docker` — and cite both stamps in the PR and release notes, or amend the
contract and qualify the `0.15.5` row ("pending release-lane verification") until they run. **Owner:
the captain** — the contract froze this wording, and the writer implemented it as written.

### 2. Medium — a source comment still names the superseded compat release

**What.** The doc comment above `PANEL_CSV_HOST_OWNED_SINCE` says "0.16.1 is the release this bundle is
admitted on (`dsh-plugin.json` compat)". After this wave `dsh-plugin.json` `compat.hosts` names
`@deepseek-harness-tui/dsh-tui@0.17.0`, so that parenthetical is now false — and it is the comment that
justifies a live version gate, so a maintainer reasons from a wrong current-state fact.

**Where.** `packages/mpd-tui-adapter-plugin/src/index.ts` → the comment above the exported
`PANEL_CSV_HOST_OWNED_SINCE` constant.

**Why it matters.** Contract §4 forbids `packages/*/src/**` edits (correctly — no code adaptation is
owed), so the writer could not fix it and did not. But the wave itself falsified the sentence: the
constant's *value* is right, its *justification* now points at the wrong release. A future reader
following it will conclude the bundle is admitted on 0.16.1.

**Direction.** Follow-up wave, not this one: reword the comment to a historical statement ("the 0.16.1
wave introduced enable-list ownership") rather than bumping the number, because the version bump would
be the wrong reading of the gate. Either way it is an adapter `src` edit, so it drags the measured
12-of-24 `dist` rebuild fan-out — which is precisely why it must not be folded into a pin-only wave.

### 3. Nit — two package contracts still read "adapted to 0.16.1"

**What.** The compatibility table's sidebar-pages row describes the surface as "adapted to 0.16.1" and
its zh twin as "已适配 0.16.1", which now reads as the current adaptation target.

**Where.** `packages/mpd-tui-plugin/README.md` and `packages/mpd-tui-plugin/README.zh-CN.md` → the
sidebar-pages row of the compatibility table.

**Why it matters.** Low: the statement is defensible as history (0.17.0 needed no adaptation), and both
files are outside the declared scopes. Grouped here so the same follow-up can sweep it together with
finding 2.

## Declined to judge

- `dsh-plugin.json` → `x-mpd-tui-surfaces.note` says "(version 0.15.1)": already stale at `faf…`/0.15.4, not a §1 carrier and not a self-urn; the writer flagged it for classification and correctly left it. Pre-existing debt, out of scope.
- `AGENTS.md` §8 "LIVE on the registry at **0.15.4**": records the PUBLISHED version, which is still 0.15.4 because this wave publishes nothing; bumping it would create the false claim. Correctly left.
- `scripts/verify-plugin-manifest.ts` self-test mutant keeps `dsh-tui@0.16.1`: the gate documents a `pkg:` ref as out of scope by design, and it is a mutant fixture, not a carrier.
- All other `0.16.1` / `0.2.1-rc.2` survivors (README table older rows, `docs/tui.md` §11.8, `docs/tui-dag-renderer.md` declaration reads, `docker/*` "pins before it" lists, CHANGELOG history, `packages/**` seam history, `agent-references/troubleshooting.md`): contract §4 requires them to stay; adding §11.10 instead of editing §11.8 was the right call.
- No `v0.15.3` row: that release never existed (the v0.15.4 entry records it as skipped); omitting it is correct.
- The "36 of 39 peers" numbers: the captain's §0 measurement. npm/registry is unreachable from this sandbox, so I could not re-derive them; I verified only their consistency across the carriers.
- CHANGELOG's "the skills/dsh-qa TUI carriers … now name `0.17.0` / `0.2.1-rc.3`": compound subject; the parenthetical scopes those carriers to the TUI version, so no reader is misled.
- Whether `bun.lock` is byte-identical to a clean pinned-toolchain install: I read the writer's `bun install v1.4.0` log and the 7-line lock diff instead of re-running `--frozen-lockfile` (no registry access).

## Gates I re-ran myself (evidence in this directory)

| Gate | Exit | Note |
|---|---|---|
| `verify:manifest` | 0 | version coherence + 6 self-urns + packaging contract |
| `verify:docs` | 0 | bilingual pair, heading trees, 3 new relative links |
| `verify:rows` | 0 | 36 row ids, 2-file patch layer |
| `verify-no-host-override` | 0 | no host-owned id targeted |
| `verify-manual-paths` | 0 | the `AGENTS.md` edit audits clean |
| `install-profile --dry-run` | 0 | nothing written |
| `verify:comments` | 0 | 444 files — covers the edited `skills/**/*.ts` |
| `test:qa` | 0 | 51 cases; independently reproduces the writer's passing retry |
| `preset-conformance --self-test` | 0 | 32 rows, 27/27 parity, 4/4 negative controls red |
| `verify:vendor` | 1 | **expected**: exactly one reason, `asset skills treeSha mismatch`; every other asset OK. Captain's single re-pin closes it |

## Bounds of this review

- **Not read**: `packages/**` implementation bodies (nothing there changed), the full `docs/` corpus, `evidence/**` history, and `.github/**`.
- **Not run**: the Docker real-machine lanes (that is finding 1), any real host boot or PTY, `bun test packages`, `verify:dist-fresh` (no `packages/**` change), `verify:pack-closure` (no pack), `bun install --frozen-lockfile`.
- **Not verifiable offline**: the published-artifact measurements in contract §0 (byte-identity of the harness umbrella, the 0.17.0 peer ranges) and the npm publish dates; the registry is unreachable from this session, so those remain the captain's measurement.
- The writer's `test:qa` red under a workspace `TMPDIR` is environmental, not a defect: `install-dependencies` asserts its sandbox path is not under the real `HOME`, and this workspace *is* under `HOME`. Identical file bytes (mtime 23:36:12) failed at 23:37:05 and passed at 23:37:42 with the default `TMPDIR`; my run passes too.

## Verdict

**NEEDS DISCUSSION** — T1 meets every frozen acceptance criterion (§1–§6) and is gate-green on my
independent run, so no repair is owed to the writer; but the wave must not be tagged until the Docker
lanes are run on the new pair (finding 1), and finding 2/3 belong to a follow-up the captain schedules.
