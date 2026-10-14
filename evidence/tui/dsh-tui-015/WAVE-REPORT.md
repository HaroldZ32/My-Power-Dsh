# Wave record — `tui-015-adaptation` (DSH-TUI 0.15.0, keeper stand-down, decision-events grants, DAG + team-plane guards, v0.13.0)

Agent-facing record (English-only, per the bundle's Language policy). Human-facing docs for this wave
are `docs/tui.md` + `docs/tui.zh-CN.md` §11.7, the README pairs and `CHANGELOG.md` (v0.13.0).

- **Branch**: `feature/tui-015-adaptation` (2 commits: `feat(bundle): adapt to dsh-tui 0.15.0 …` and
  `fix(docker): repair the lane's session-binding drive, browser transport and registry probe honesty`).
- **Contract**: `.mpd/plans/tui-015-adaptation.md` — clauses C1, C2, C3', C4, C5, C6 + amendment C7
  (team-plane guards + hard gate) + amendment C7-4 (mid-run task surface + session binding).
- **FACTS (frozen judge document)**: `evidence/tui/dsh-tui-015/host-diff/FACTS.md`.
- **User clauses**: 「适配 dsh-TUI v0.15.0…并在 docker 上做完整实机验证」· adoptions declined ·
  keeper joins the native self-heal · decision-events grants pursued · release v0.13.0 with the full
  delta in the CHANGELOG · 「直接设为BUG修掉，设为硬性闸门，别回来再出问题」 (C7/C7-4).

## 1. The measured 0.14.0 → 0.15.0 delta (the wave's FACTS)

| Fact | Measurement |
|---|---|
| Plugin-facing seams | **15 mounted `ctx.tui*` services, IDENTICAL** between the two versions; no 16th seam (`tuiChannel` is a kernel-channel protocol id, excluded in one sentence). |
| Seam declarations | ADDITIVE ONLY: `panels.d.ts` +2 host-internal CSV-merge helpers; `plugin-host.d.ts` +`probeBackendAdmission()`. |
| Harness peers | unchanged (every `dsh-*` peer still ends `0.2.0-rc.2`) → `MPD_E2E_DSH_VERSION` did NOT move. |
| Sidebar defaults | `DEFAULT_SIDE_PANEL_IDS` unchanged (the invariant tests stay green). |
| Panel freeze | `capabilities` still absent → the host-drawn `⤢` residual holds. |
| Counted contacts | `lib/types/ui.js#useStdin` intact; `subscribeSidePanelPanels` intact. |
| **Icon painting (post-freeze re-measure)** | 0.15.0's `PanelBar` PAINTS plugin icons again (`tabLabel()`); the 0.14 reading is superseded, our `❖`/`⬢` are back with zero bundle changes. |
| Adoption candidates | ALL DECLINED with per-item reasons (every new capability is host-internal or diagnostic-only; the Backend family's install chain is not wired upstream). |

## 2. What the wave changed

- **C1** — every release carrier moved to 0.15.0 (5 docker files, 7 QA carriers, the distribution
  `host-tui` ref, `mpd-tui-panels.ts` prose, the docker README pair); four deliberate non-moves
  restated; the residual `0.14.0` survivors enumerated by class (STAY fixtures included).
- **C2** — the keeper now JOINS the host's native self-heal: a `hostVersion >= 0.15.0` semver gate on
  the ALREADY-PROVEN `readHostPackageVersion` (no new host contact) stands it down (writes nothing, one
  log line, an observe-only belt), while `< 0.15.0` keeps the 0.14 behaviour byte-for-byte. Proven by
  unit arms + version-aware splits + a real-PTY arm (both panels removed via `/settings` stay removed;
  the negative control reddens).
- **C3'** — the `extension-grants.json` flow documented user-facing; the seam's observability fixed
  (file-sink mirroring, an apply-time line, the bound seam scope as the host identity). The ledger
  attribution arm stays RED with a NAMED host-side gate (see §4).
- **C6** — the 0-task DAG defect the user reported live: `dagPageOf` no longer discards a resolved
  team's identity at `tasks: []`; the page draws header facts + a roster row + the `agent_teams_plan`
  hint, with the missing workspace-scope 0-task arm added and member-only arms pinning it.
- **C7 / C7-4** — the team plane: cross-team pairing refused (both ids named), write-task ×
  read-only-member refused with the reason, terminal/archived-team resolution skipped with a reaper
  pass; mid-run `create_task`/`add_member` append to a live APPROVED record, members close their own
  rows, the mailbox summary is team-scoped, ids are ms+suffix with collision refusals, and a
  forked/resumed captain keeps captaincy via lead history. **Hard gate**: `team-dispatch-guard` (17
  self-test arms + a 21-arm real lane) inside `bun run test:qa`.
- **C4/C5** — §11.7 bilingual, the `tuiChannel` sentence, the README pair refresh, ONE CHANGELOG
  v0.13.0 entry covering the full 0.12.0 delta; `VENDOR_LOCK` re-pins as recorded in §5.9 (a
  declared deviation from the one-re-pin shape).

## 3. Gates and real-machine evidence

| Evidence | Result |
|---|---|
| Static gates at the committed revision | typecheck exit 0 · docs PASS (47 pairs / 0 violations / 0 dead links) · rows 35 ids · comments PASS (401 files / 35524 declarations) · manifest PASS (981 packed files, 0 required absent) · dist 31/31 fresh (pinned bun 1.4.0) · vendor — see §5.9: STALE at the wave's own commits (the second-seat verifier found it red at HEAD, B-1) and PASS only after the follow-up re-pin on the settled tree (381 files, treeSha 6605124694cd…) · verify:gates 8/8 after that repair · test:qa all self-tests passed · `bun test packages` 1939 / 3 skip / 0 fail |
| Pack closure | 605 files compared, 605 identical, 0 drift, 0 expected-after-pack; pack stamp `2026-10-14T11:38:16.076Z` (the log is the anchor) |
| Sandbox TUI lanes (installed 0.15.0) | **8 of 8 match the frozen expected-status table**: tui-mount PASS · tui-deps-ctrla PASS · tui-panels red with `tuiRenderers` ONLY · tui-settings-bridge PASS · tui-team-surface red with `H4` ONLY · tui-admission red on arm3 ONLY (declared host gate) · tui-distribution SKIP absent-fixture · tui-spec-conformance SKIP absent-fixture |
| Docker source lane (real machine, `--require-docker`) | `evidence/docker/client-install/2026-10-14T13-51-46Z`: 118 assertions, **85 pass / 0 FAIL / 33 NULL**, driver exit 0, container exit 0 — all 22 `tui.*` records true (install → mount → real PTY: merged panel, team scene, graph edges/content, Ctrl+A intact), browser lane green |
| Docker source lane, LIVE (`--require-live`, real credential, real model turns) | `evidence/docker/client-install/2026-10-14T14-31-41Z`: **110 pass / 3 fail / 5 NULL** — every TUI arm green, every web/TUI live arm green (real turns, real `mpd_*` tool calls parsed, assistant replies). The 3 reds are headless-plane arms whose live prompt was a one-word text that CANNOT drive a tool call (`turns=1 tools=0`) — a prompt defect of the invocation, re-run with a tool-driving prompt; see §6. |
| Docker oneclick lane | see §6 (run after the live re-run) |

## 4. The clause positively demonstrated on a real host

The C2 keeper stand-down was demonstrated on the installed 0.15.0 host with real keystrokes: both MPD
panels unticked through the host's own `/settings` picker, the removal stayed through 5 polls and two
re-apply hops, the negative control reddened and restored — and the keeper wrote NOTHING (the host's
own union is the writer). Evidence: `evidence/tui/dsh-tui-015/lane-Q/c2-real-pty/`.

## 5. Honest bounds and incidents (stated, not hidden)

1. **C3' ledger attribution stays RED — HOST-SIDE and named.** `subscribeDecision` reaches
   `requireComponentIdentity`, a WeakMap only `bindComponentIdentity` populates; a patch row's
   activation cannot satisfy it. Our identity fix is provably load-bearing (it moved the refusal from
   the caller-activation assertion to the admission gate) but not sufficient. The seam remains built
   ready, NOT activated, and the newly readable disclosure line says so. The clause's acceptance
   explicitly allows a measured blocker recorded honestly.
2. **Two lanes SKIP for declared environment reasons** (`tui-distribution` absent fixture,
   `tui-spec-conformance` no `dsh-ecosystem-spec` checkout on this box) and two PRE-EXISTING reds stay
   declared (`tuiRenderers`, `H4`).
3. **The first Docker source run (11:58) shipped a FALSE PASS** in `tui.teamFixtureBound` (a TSV field
   shift bound the fixture to a garbage key) — found and fixed by the repair lane, which is why the
   13:51 run's `tui.*` records are the trustworthy ones. The same class was fixed in the sandbox
   lanes' drive.
4. **A one-word live prompt cannot prove the headless arms** — the live re-run uses a tool-driving
   prompt; the first live run's 3 reds are that prompt's defect, not a product one.
5. **The `compile-all` flake**: the repair worker observed one flake on an ast-grep engine staging path
   it did not touch; it passed in the baseline and the final run.
6. **`tests` ran under the PATH bun 1.4.2** while the BUILD pin is proven at 1.4.0; no frozen clause
   constrains the test runner.
7. **Session-id churn (C7-4 F5's origin)**: the captain's session id changed twice on resume/fork
   (`f1cd0104 → 400cd1d4 → 49f5d46e`), which broke the board/lead binding until rebound by hand; the
   fix (lead history + lineage resolution) ships with unit arms and a negative control.
8. **Three docker-lane findings were repaired in-wave** (F1 `ui.replyRendered` false-green, F2 two
   backtick command substitutions, F3 a metadata-only registry probe that a tarball-blackholed registry
   could pass); the browser prerequisite was a Playwright CDN transport issue fixed by pin + mirror.

7. **`VENDOR_LOCK.json` needed THREE writes, not one.** The first two re-pins each UNDERCOUNTED their
   own commit's `skills/` tree (378 locked vs 380 tracked at `4401234a`; 380 locked vs 381 at
   `e2938953`), so `verify:vendor` was RED at HEAD; the second-seat verifier caught it (record
   `rec-20261014T162338-8813c6`, finding B-1) and the follow-up re-pin on the settled tree (381
   files, `treeSha 6605124694cd…`) turned `verify:vendor` PASS and `verify:gates` 8/8. The
   one-re-pin-per-wave shape broke because a post-integration oneclick repair added `skills/**`
   bytes; this is a declared deviation, and §3's earlier claim was corrected rather than smoothed.
8. **A second-seat Loop B FAIL was recorded and its findings acted on**: B-1 (the stale lock, above),
   B-2 (documents asserting a green the revision did not carry — corrected here and in the PR body),
   B-3 (the packed-manifest fix's runtime proof — satisfied by the oneclick run below), B-4 (loop
   independence — a fresh sealed seat records Loop A's PASS and re-verifies Loop B).

## 6. Docker closing rows (the real machine, both modes, `--require-docker`)

| Row | Run | Result |
|---|---|---|
| source, credential-free | `evidence/docker/client-install/2026-10-14T13-51-46Z` | 118 assertions, 85 pass / 0 FAIL / 33 NULL, exit 0 |
| source, LIVE (real credential, real turns, real team creation) | `evidence/docker/client-install/2026-10-14T14-47-47Z` | 118 assertions, **114 pass / 0 FAIL / 4 NULL**, exit 0 |
| oneclick, LIVE (`--spec github:HaroldZ32/My-Power-Dsh#feature/tui-015-adaptation`) | `evidence/docker/client-install-oneclick/2026-10-14T16-10-19Z` | 118 assertions, **113 pass / 0 FAIL / 5 NULL**, exit 0 — the packed install's mcp-lsp row is back to its full surface after the packed-manifest fix |
| oneclick, pre-fix (the run that EXPOSED the two reds) | `evidence/docker/client-install-oneclick/2026-10-14T14-56-53Z` | 111 pass / 2 FAIL / 5 NULL, exit 1 — kept as the defect's own record |
