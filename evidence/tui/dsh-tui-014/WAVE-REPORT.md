# Wave record — `tui-014-adaptation` (DSH-TUI 0.14.0, the two-page sidebar, the accumulating-legend fix)

Agent-facing record (English-only, per the bundle's Language policy). Human-facing docs for this wave
are in `docs/tui.md` + `docs/tui.zh-CN.md` (§11.6) and `CHANGELOG.md`.

- **Team**: `team-20261008015705` (plan `plan-20261008015529`, 5 members). Captain: the MPD session.
- **Contract (frozen, judge document)**: `.mpd/plans/tui-014-adaptation.md` — clauses C1–C7, plus the
  FACTS section every member was handed instead of re-deriving the 0.14.0 delta.
- **User clauses**: 「适配dsh-tui的0.14.0版本」/「请完整适配」· 「侧边栏挂掉了」 ·
  「将原先的MPD Panel和MPD DAG Panel合并，把MPD与Workmate两个panel扔到侧边栏上去」/「DAG页作为MPD面板」 ·
  the accumulating-legend defect · 「试着适配一下全屏按钮，还有全屏出来的MPD也要有这种富外观」 ·
  evidence depth: 沙箱 + 真实 PTY Docker 车道.

## 1. The measured 0.14.0 delta (this wave's FACTS)

| Fact | Measurement |
|---|---|
| The fifteen plugin-facing `ctx.tui*` seams | **byte-identical** between 0.13.0 and 0.14.0 (`lib/types/dsh-adapter/{panels,scenes,status,renderers,settings-sections,shortcuts,dialogs,command-trees,plugin-host,toast,themes,plugin-storage,message-observer,effect-ledger,workspaces}.js` + `.d.ts`). No sixteenth seam. **No adapter code change was needed for the seam surface.** |
| Harness compatibility | the `peerDependencies` range is unchanged (still ends `0.2.0-rc.2`) → `MPD_E2E_DSH_VERSION` did NOT move |
| 0.14.0's own additions | peer `@anthropic-ai/claude-agent-sdk@0.3.287` (the Claude backend), dependency `ws@^8.21.3`, an eighth builtin sidebar panel (`btw`), and a REWRITTEN `PanelBar` (a carousel: the active tab's title plus `○`/`●` dots; a declared plugin `icon` is stored and no longer painted) |
| The one measured breakage | `DEFAULT_SIDE_PANEL_IDS` moved from `todo,jobs,agents` to `todo,jobs,agents,info,trajectory,workspace,btw,companion` (7 builtins → 8). Two arms of `packages/mpd-tui-plugin/test/panel-visibility.test.ts` pinned the OLD literal → RED |
| The full-screen residual | still true on 0.14.0: a plugin definition is frozen without `capabilities`, while `SidePanelColumn`'s `canExpand` reads it → the host can never draw its own `⤢` for a plugin panel. `compact` is still stored with a `() => null` renderer |

## 2. What the wave changed

- **C2** — the two host-default arms now assert the INVARIANT (builtins only, nothing of ours; every id
  passes the host's own grammar; `normalizeSidePanelPanels` idempotent — that assertion runs inside the
  "host REWRITES the CSV" arm), never a literal list. The pre-wave TUI reds are gone.
- **C3** — the sidebar carries exactly **TWO** MPD panels: `team` / title `MPD` / icon `❖` / order 10,
  which now RENDERS the rich DAG page (`panel-dag.ts`) with the host's curated subagent rows ABOVE the
  drawing inside the same frame; and `workmate` / title `MPD workmate` / icon `⬢` / order 12. The old
  merged page's registration and the standalone `dag` registration are retired, `DAG_PANEL_SLUG`
  deleted (zero readers), `/mpd dag` re-aims onto the MPD panel with `scene.openTeam()` as its
  fallback, and the `/mpd dag` picker description was corrected (user-visible text).
- **C4** — the user's defect was REAL and in our code: legend rows were keyed
  `legend-${line.slice(0, 24)}`, and the drawing's own state line and the legend's first wrapped line
  both begin `✓ completed · ◐ running`, so two children shared ONE React key — React then rendered the
  collided row once more on EVERY re-render. Mounted-instance measurement (the host's own React/ink,
  click/pin driven): pre-fix `[4,5,5,5,6,6,6,7,7]` legend rows, post-fix `[4,4,4,4,4,4,4,4,4]`. Fix:
  position keys (legend, pin body, workmate rows). Arms: a stability arm over the whole sequence, a
  sibling-key arm, and an in-file NEGATIVE CONTROL asserting the pre-fix key shape still accumulates.
- **C5** — the page's own `⤢` and `/mpd dag` now open the RICH full-screen team scene (frame, legend,
  keys, pin) instead of the subagents scene; `openMergedScene` keeps the subagents scene as the route
  fallback; no `capabilities` field is declared (the host drops it — a measured bound).
- **C7(a)** — the discovered panel-id record is version 2 with
  `provenance {hostRoot, hostVersion, readBack, activation}`, and BOTH sides refuse an unprovable one:
  the adapter refuses to WRITE one, and `scripts/mpd-tui-panels.ts` refuses to READ one (measured
  sentence on the stale record: `REFUSED: … it carries no \`provenance\` block (a version-1 record,
  whose ids cannot be traced to a boot) … or pass --ids <a,b,c>`). Measured cause: a unit-test run had
  written `act0:*` (impossible — the host's fallback counter pre-increments, so the first is `act1`).
- **C7(b)** — the enable-list keeper follows the host's OWN change feed
  (`subscribeSidePanelPanels`), so an MPD panel survives the config mirror's rewrite seconds after boot
  — the measured cause of 「侧边栏挂掉了」. The stand-down rule is unchanged (a list naming ANY of our
  ids ends the keeper for good) and loop-freedom comes from an echo guard; a host without the feed
  keeps the bounded ladder. **Declared residual**: a user who deletes ALL of our ids is
  indistinguishable from a fresh profile, so one more rewrite is repaired.
- **C1** — every DSH-TUI release carrier names `0.14.0`: `docker/entrypoint.sh`,
  `docker/docker-compose.yml` (both defaults + comment), `docker/tui-lane.sh`, `docker/ui/entrypoint.sh`
  (both), `docker/ui/docker-compose.yml`, the QA lanes' `TUI_HOST_SPEC`/prereqs/remedies (7 files under
  `skills/dsh-qa/scripts/`), `dsh-distribution.json`'s `host-tui` ref, and the prose in
  `docker/README{,.zh-CN}.md`. Deliberately UNMOVED: `MPD_E2E_DSH_VERSION` (peer range unchanged) and
  `dsh-plugin.json`'s `compat.hosts = @deepseek-harness-tui/dsh-tui@0.10.1` (it records the 0.10.1
  extension-admission MEASUREMENT, not the edition this bundle targets — the docs say so).
- **C6** — bilingual docs amended (`docs/tui.md` + `docs/tui.zh-CN.md` §11.6, the README pairs,
  `agent-references/seam-adapters.md`) and ONE `CHANGELOG.md` entry; 0.13.0/0.12.0 statements kept
  readable as history.

## 3. Verification (independent seats, recorded verdicts — never the writers')

- **Code loop** `loop-20261008T015701-2161e0` (task `tui-014-code`, scope `packages/mpd-tui-*`):
  - `rec-20261008T030715-f1a2ad` — PASS (seat 1, blind basis, 8 gates).
  - `rec-20261008T032957-8ebe48` — PASS at the FINAL code revision (digest `f1952c2903661d0f3e00d062`,
    2026-10-08T03:24:26Z), seat 2, blind basis, 11 evidence ids, all five clauses armed.
  - An EARLIER seat's FAIL (`rec-20261008T020051-606e36`) was measured against an UNFINISHED revision;
    the captain ruled it the record of the C2 reds, satisfied by the wave's own landing.
- **Pins loop** `loop-20261008T015701-a55424` (task `tui-014-pins`): `rec-20261008T041623-38aa3e` FAIL
  (the Docker row pointed at an empty annex in this very report; a pack stamp was quoted that its own
  anchor did not carry) → repairs → **`rec-20261008T042507-073ddd` PASS**, blind basis, with the Docker
  revision residual restated as a DECLARED residual. Three seats in total judged this loop; the last
  one re-derived every repair from the artifacts.
- **Gate evidence at the final revision** (re-derived by the seats): `tests` 1632 pass / 3 skip / 2 fail
  — both reds are DECLARED environment defects outside the TUI band (`mpd-mcp-shared` POSIX fd
  inheritance; `mpd-roles-plugin`'s workspace boulder ledger ENOENT) — plus `typecheck`, `docs`,
  `comments`, `manifest`, `rows`, `vendor`, `dist` (30/30 fresh on the pinned `bun@1.4.0`), `pack`
  and `gates` all exit 0.
- **Unit band**: `bun test packages/mpd-tui-plugin packages/mpd-tui-adapter-plugin` = **469 pass / 0
  fail** (pre-wave 454 = 452 pass + the 2 C2 reds). The delta is accounted for test by test: +15 new
  arms, and the restored 44-test file after a disclosed writer-side truncation (see §5).
- **Real-host lanes (installed 0.14.0)**: `tui-mount` PASS · `tui-deps-ctrla` PASS (Ctrl+A stayed
  INERT, R4 holds) · `tui-panels` / `tui-team-surface` down to the declared pre-existing reds · one SKIP
  (`tui-distribution`, `absent-fixture`, proven unrunnable from the pinned checkout) · one environment
  RED (`tui-spec-conformance`, falsified green by `DSH_TUI_ROOT=/root/dshProj/tui/dsh-TUI`).
- **Real-PTY Docker lane**: see §6 (final row appended below).

## 4. The clause positively demonstrated on a real host

The adapter's discovered record, read back through the host's own `tuiPanels.list`, is

```
{"version":2,"panelIds":["act1:team","act1:workmate"],"slugs":["team","workmate"],
 "provenance":{"hostVersion":"0.14.0","readBack":"tuiPanels.list","activation":"act1"}}
```

and the captured carousel line carries 9 dots + 1 active title = **10 tabs = the 8 host builtins +
exactly TWO MPD pages, no third MPD page**. The active panel renders the rich frame / header with `⤢` /
the curated subagent rows ABOVE the drawing / both legend lines / the edge legend / the key-hint
footer (`evidence/tui/lanes/2026-10-08T03-10-38.473Z/pane-evidence/sidebar-MPD-panel.txt`).

## 5. Honest bounds and incidents (stated, not hidden)

1. **A writer truncated `packages/mpd-tui-plugin/test/plugin.test.ts` to 0 bytes** (a `sed -n … d`
   redirection mistake) and reported a green suite while 44 tests were missing. The captain caught it on
   the tree, bounced it back, and the file was restored byte-identically from HEAD before three
   justified edits (7 hunks, +53/−28). No other tracked file was emptied.
2. **A unit-test run had written the panel-id record** with fixture ids (`act0:*`) — fixed by C7(a);
   the stale on-disk record is STILL the polluted version-1 one until a real boot rewrites it, which is
   why the remedy now refuses it and why `--ids` exists.
3. **A watchdog replay modal polluted the SHARED sandbox root** and held the keyboard, producing three
   lane reds that were NOT product defects; `lib/tui-lane.ts` now clears the replay state before every
   boot (live holds and the heartbeat store survive).
4. **Environment deviations declared**: the sandbox lanes export
   `pnpm_config_registry=<this host's mirror>` (pnpm 11 ignores `npm_config_registry`; npmjs.org is
   unreachable here), and the Docker lane's `node:24-bookworm` was sourced by retagging
   `docker.m.daocloud.io/library/node:24-bookworm` (digest `sha256:3d27e5c1…`) because
   `registry-1.docker.io` times out. Neither knob weakens isolation.
5. **Pre-existing reds NOT repaired**: `tuiRenderers` (red in every run since 2026-09-15),
   `H4-real-mutation-via-the-adopted-runtime` (red 2026-09-30), the `tui-distribution` SKIP, and the
   `tui-spec-conformance` environment red.
6. **No lane drives the panel's own `⤢`**, so C5's full-screen surface is covered by UNIT arms and the
   Docker lane's scene rows, not by a lane that presses the control.
7. **Git**: this session may not run git write commands (one-git-writer rule), so the branch, commit
   and PR are handed over as an exact command list in `GIT-HANDOFF.md` beside this file, with the
   bilingual PR body in `PR-BODY.md`.

## 6. Final lane set (closing revision)

Appended by the captain AFTER the closing runs. Closing revision: the wave's single final vendor re-pin
(`skills.treeSha` `73a7311adfe2240cb742a21f5d3a53400210a03a9672f106bf273953198d356d`) and the packed
artifact rebuilt immediately afterwards (`dist/mpd-package`, `pack stamp 2026-10-08T04:21:44.935Z`, re-packed by the captain AFTER the last write and immediately followed by the closure run whose log is the anchor below).

### 6.1 Sandbox lanes on the installed 0.14.0 host — closing rows

| Lane | Result | The red that remains | Evidence |
|---|---|---|---|
| `tui-mount` | **PASS** | — (bundles ordered `[dsh-base, dsh-tui, @mpd-dsh/mpd]`, row composed, keyed status line + counters rendered, zero apply-crash signatures, preset `mpd`, `isolationOffenders=0`) | `evidence/tui/lanes/2026-10-08T04-04-38.297Z/` |
| `tui-deps-ctrla` | **PASS** | — (Ctrl+A stayed INERT: the HOST's own dashboard opened, so R4 holds; the store arm reads `id=act1:team`) | `evidence/tui/lanes/2026-10-08T04-03-50.072Z/` |
| `tui-panels` | ok=false | **`tuiRenderers` ONLY** — PRE-EXISTING, red in every run since 2026-09-15; 7 of 8 surfaces rendered (`tuiStatus`, `tuiCommandTrees`, `commands`, `tuiPanels` `id=act1:team`, `tuiScenes`, `tuiSettingsSections`, `tuiDialogs`) | `evidence/tui/lanes/2026-10-08T04-01-59.682Z/` |
| `tui-team-surface` | ok=false | **`H4-real-mutation-via-the-adopted-runtime` ONLY** — PRE-EXISTING, red 2026-09-30; 19 of 20 arms green, including `H1-host-renders-surface` (the real host rendered `│ ✓ MPD plan approval — Fixture Team · 216x48`) and `H3-host-confirm-step` | `evidence/tui/team-surface-verify/2026-10-08T04-03-10.020Z/` (this case writes its own hardcoded path — no `--out`) |

Earlier rows of the same wave, kept because they carry the diagnosis:
`evidence/tui/lanes/2026-10-08T03-02-56.630Z/` (mount, Phase B),
`…/2026-10-08T03-10-38.473Z/` (the two-page sidebar + rich panel capture + id provenance),
`…/2026-10-08T03-49-25.481Z/` (the Phase C consolidated record),
and the two attempts kept as diagnostics rather than verdicts:
`…/2026-10-08T02-46-35.178Z/` (mount attempt 1, registry) and
`evidence/docker/client-install/2026-10-08T03-10-30Z/` + `…/2026-10-08T03-14-56Z/` (Docker attempts 1–2).

### 6.2 The Docker real-PTY lane — the closing run ABORTED, reported as itself

**The lane's closing run did NOT complete, and this section says so in the contract's own words: an
ABORT with its measured cause, not a pass and not a pointer to an empty annex.**

| Row | Result | Cause |
|---|---|---|
| `evidence/docker/client-install/2026-10-08T03-18-21Z/` | **ok=true, 64 passed / 0 failed / 30 null** — the LAST COMPLETE row | rootful daemon opted in; it ran the full install + mount + real-PTY path (bundle as the third patch layer, the team scene opened, the DAG drawn, the host's Ctrl+A key intact, the seam gate, `preset=mpd`). **Declared gap: it predates the closing pack rebuild (`2026-10-08T04:21:44.935Z`)**, so it does not cover the closing artifact; its source revision is also unresolved (the captain's three source edits at 03:18:59Z fall inside that build's copy window, and `--mode source` rebuilds `dist/` inside the container, so its hashes cannot arbitrate). |
| `evidence/docker/client-install/2026-10-08T04-05-33Z/` | ok=false, 4 passed / 1 failed / **78 null** | `toolchain.pnpm` — `npm ETIMEDOUT` against `registry.npmjs.org` from inside the container |
| `evidence/docker/client-install/2026-10-08T04-10-21Z/` | ok=false, 3 passed / 1 failed / **79 null** | `toolchain.bun` — `curl: (28) Failed to connect to github.com port 443 after 134797 ms`, so `bun-linux-x64.zip` never downloaded; the npm fallback ran and still left `harness.bun` empty |
| `…/2026-10-08T04-14-48Z/`, `…/2026-10-08T04-20-37Z/`, `…/2026-10-08T04-28-36Z/` | ok=false, exit 3 each | the same two causes alternating: a github.com connect failure and `npm ETIMEDOUT` against `registry.npmjs.org` |

**Five attempts on the closing revision, every one of them exit 3, and not one of them ever reached
the installer, the mount or the PTY** — the lane needs several fetches to land in sequence (the bun
binary, pnpm, node, the host, then the bundle), so on this network its success is a product of flaky
events: it passed 1 of 3 attempts that got past the image build (the 03:18:21Z row above). The
stability of the closing window is measured and would have made a success unambiguous had one landed:
the runner's own fingerprint `d79a9b11300fefc7` and repo tree digest
`e1e56acdceff12d9a8d435eba067bd42` are CONSTANT at T_start 04:05:06Z and T_end 04:36:20Z, with the
newest watched write at 04:01:26Z (`VENDOR_LOCK.json`). Non-attempts kept apart:
`…/2026-10-08T03-10-30Z/` (image build, `registry-1.docker.io` timeout) and `…/2026-10-08T03-14-56Z/`
(pnpm ETIMEDOUT before the container could install anything).

**Why the closing run cannot be forced on this machine as it stands**: three hosts are unreachable
from the container (`registry-1.docker.io`, `github.com`/`bun.sh`, `registry.npmjs.org`), the
compose/driver surface forwards no registry knob, and the one workaround that DID work earlier — a
mirror retag of `node:24-bookworm` from `docker.m.daocloud.io` (digest `sha256:3d27e5c1…`) — fixes the
base image but neither the bun download nor the npm/pnpm registry. The sandbox lanes reach the registry
only because they export `pnpm_config_registry` (pnpm 11 ignores `npm_config_registry`), a knob the
Docker driver does not forward. Making that lane run from a cold build context is a change to
`docker/**` + the driver's env forwarding, i.e. a NEW wave, not a repair of this one.

### 6.3 Bounds this section declares rather than inherits

1. **The pack-closure reading is re-derivable from an artifact, not from a gate id**: the whole log is
   persisted beside this report at `evidence/tui/dsh-tui-014/pack-closure.log`
   (`553 file(s) compared, 553 identical, 0 drift, 0 expected-after-pack`, pack stamp
   `2026-10-08T04:21:44.935Z`). The verifier's finding stands that `verify-pack-closure` is neither a
   whitelisted gate id nor a member of the `gates` aggregate — that is a QA-surface improvement for a
   later wave, and until then the log is the anchor.
2. **The C1 carrier literals have no gate.** `verify:rows` / `verify:manifest` / `verify:docs` do not
   read the version strings in `docker/**`, `skills/dsh-qa/scripts/**` or `dsh-distribution.json`, so a
   blind seat cannot re-derive them; the wave's own completeness check was a grep whose remaining
   `0.13.0` hits are each enumerated (dated measurements, "the pin before it was" sentences, and
   release-provenance labels).
3. **`CHANGELOG.md` and `docker/README{,.zh-CN}.md` sit outside the docs gate's discovery** (113 files /
   47 pairs), so C6's CHANGELOG clause cannot be judged from the gate output alone; both files were
   reviewed by their writer and by the captain, and this bound is stated, not smoothed over.
4. **No lane drives the panel's own `⤢`** (§5.6 above) — C5's full-screen surface rests on unit arms
   plus the Docker row's scene assertions.
5. **The privileged-environment deviations** the lanes needed (`pnpm_config_registry`, the
   `node:24-bookworm` mirror retag) are declared with their measured proofs in §5.4.

## 7. Post-verification note on the pack stamp (why §6 quotes one instant)

The `pack` GATE is a WRITER: `mpd_verify_evidence {kind:"gate", gate:"pack"}` runs `scripts/pack-mpd.ts`
and re-stages `dist/mpd-package`, which moves the inferred stamp the closure gate prints (it reads the
newest mtime in the artifact). A verification pass that calls the `pack` gate therefore moves the very
instant a report may want to cite — measured twice on 2026-10-08: the 04:01:32.720Z stamp was re-staged
to 04:14:14.302Z by a verification pass, and a second verification seat correctly FAILED the loop for
quoting the superseded instant.

The rule this section records, so no later reader has to rediscover it: **the closure LOG is the anchor,
and the stamp it carries is the one a report may quote.** The captain re-packed and re-ran the closure
as the last write of the wave, persisted the log beside this report, and §6/§6.3 quote that stamp —
`2026-10-08T04:21:44.935Z` at the instant this section was written. A later `pack`-gate call will move the
artifact's inferred stamp again; that is a property of the gate, not a drift in this report, and any
reader re-deriving the closure should quote the log they just produced rather than this prose.
