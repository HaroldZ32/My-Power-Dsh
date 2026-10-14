# Adapt to dsh-tui 0.15.0 — carriers, keeper stand-down, decision-events grants, DAG + team-plane guards

Wave `tui-015-adaptation`. Frozen contract: `.mpd/plans/tui-015-adaptation.md`. Branch
`feature/tui-015-adaptation` → `dev`.

## English

**What changed.** The bundle moves its dsh-tui target from 0.14.0 to 0.15.0 and lands the wave's
user-agreed clauses:

- **C1 carriers** — every release carrier now names `0.15.0`: `docker/entrypoint.sh`,
  `docker/docker-compose.yml` (both defaults + the peer-coverage comment), `docker/tui-lane.sh`,
  `docker/ui/entrypoint.sh` (×2), `docker/ui/docker-compose.yml`, `dsh-distribution.json`'s `host-tui`
  ref, the seven `skills/dsh-qa/scripts/` carriers, `scripts/mpd-tui-panels.ts`'s header prose and the
  `docker/README{,.zh-CN}.md` pair. Deliberate NON-moves restated: `MPD_E2E_DSH_VERSION` stays
  `0.2.0-rc.2` (the harness peer range is unchanged), `dsh-plugin.json`'s `compat.hosts` stays
  `@deepseek-harness-tui/dsh-tui@0.10.1` (it records the 0.10.1 admission MEASUREMENT), the registry's
  `0.15` ecosystem-spec string never moves, and dated-measurement sentences stay readable as history.
- **C2 keeper re-spec** — the sidebar enable-list keeper now JOINS the host's native self-heal: on a
  host whose CSV self-heals (`hostVersion >= 0.15.0`, via the already-proven `readHostPackageVersion`
  probe — no new host contact) it stands down and writes nothing; on older hosts the 0.14 behaviour is
  byte-preserved. An explicit `/settings` removal of both MPD panels stays removed session-wide.
- **C3' decision-events grants** — the `extension-grants.json` flow is documented user-facing, the
  seam's observability is fixed (file-sink mirroring, an apply-time line, the bound seam scope as the
  host identity), and the ledger-attribution arm is recorded RED with a NAMED host-side gate (see
  bounds).
- **C6 the 0-task DAG defect** (reported live by the user) — `dagPageOf` no longer discards a resolved
  team's identity when the board has zero tasks; a member-only team now renders its header facts and a
  roster row instead of a bare empty state.
- **C7 team-plane guards** — cross-team dispatch pairing refused (both ids named), write-task ×
  read-only-member refused with the reason, terminal/archived-team resolution skipped with a reaper
  pass; **C7-4** the mid-run surface: `create_task`/`add_member` append to a live APPROVED record,
  members close their own rows, the mailbox summary is team-scoped, team/plan ids are ms+suffix with
  collision refusals, and a forked/resumed captain keeps captaincy via lead history. Everything ships
  with a STANDING hard gate: the `team-dispatch-guard` QA case (17 self-test arms + a 21-arm real lane)
  inside `bun run test:qa`.
- **Docs** — `docs/tui.md` + `docs/tui.zh-CN.md` §11.7, the `tuiChannel` clarification in
  `agent-references/seam-adapters.md`, the `packages/mpd-tui-plugin` README pair (including the
  re-measure that 0.15.0's `PanelBar` PAINTS plugin icons again — the 0.14 reading is superseded), and
  ONE `CHANGELOG.md` v0.13.0 entry covering the full 0.12.0 delta.

**Measured evidence** (all under `evidence/tui/dsh-tui-015/`):

| Record | Path |
|---|---|
| Host delta (frozen judge document) | `host-diff/FACTS.md` (payloads reproducible per its header) |
| 8-lane table vs the frozen expectation | `lane-repair2/step3-lanes.md` + per-lane logs |
| C2 real-PTY arm (remove both panels, no repair) | `lane-Q/c2-real-pty/` |
| C7/C7-4 guard + the hard-gate case | `guard/` (incl. the landed `--self-test` log) |
| Decision-seam fix + the named host gate | `decision-fix/REPORT.md`, `triage-reds/REPORT.md` |
| dist rebuild + zero-write attribution | `dist-rebuild/` |

**Gates run (observed at the committed revision)**: `bun run typecheck` exit 0 · `bun run verify:docs`
PASS (47 pairs / 0 violations / 0 dead links) · `bun run verify:rows` ok (35 row ids) ·
`bun run verify:comments` PASS (401 files / 35524 declarations) · `bun run verify:manifest` PASS (981
packed files, 0 required absent) · `node scripts/verify-dist-fresh.ts` 31/31 fresh (pinned bun 1.4.0) ·
`bun run verify:vendor` PASS (after the wave's SINGLE re-pin in this commit) · `bun run test:qa` all
self-tests passed · `bun test packages` 1939 tests / 3 skip / 0 fail · pack closure 605/605 identical,
0 drift at pack stamp `2026-10-14T11:38:16.076Z` · the 8 sandbox TUI lanes: **8 of 8 match the frozen
expected-status table** (tui-mount PASS, tui-deps-ctrla PASS, tui-panels red with tuiRenderers ONLY,
tui-settings-bridge PASS, tui-team-surface red with H4 ONLY, tui-admission red on arm3 ONLY,
tui-distribution + tui-spec-conformance SKIP absent-fixture).

**Honest bounds.** (1) **C3' ledger attribution stays RED, host-side and named**: `subscribeDecision`
reaches `requireComponentIdentity`, a WeakMap only `bindComponentIdentity` populates, so a patch row's
activation cannot satisfy it — our identity fix is provably load-bearing (it moved the refusal from the
caller-activation assertion to the admission gate) but not sufficient; the seam remains built ready,
NOT activated, and the readable disclosure line now says so. (2) The Docker real-machine lane runs
after this PR's branch is available to the driver; its stamps will be cited in the wave report and the
release sweep. (3) `tui-distribution` and `tui-spec-conformance` SKIP for a declared environment
reason (absent fixture / no `dsh-ecosystem-spec` checkout on this box). (4) `tui-panels`' `tuiRenderers`
red and `tui-team-surface`'s `H4` red are PRE-EXISTING, declared in the frozen table, and not repaired
by this wave. (5) The `tests` gate ran under the PATH bun 1.4.2 while the BUILD pin is proven at 1.4.0;
no frozen clause constrains the test runner.

---

## 简体中文

**改了什么。** 本包对 dsh-tui 的目标版本从 0.14.0 迁到 0.15.0，并落地本波与用户议定的条款：

- **C1 载波** — 全部发布载波改名为 `0.15.0`（docker 四件套与 compose 双默认值、`docker/tui-lane.sh`、
  `docker/ui/**`、`dsh-distribution.json` 的 `host-tui` 引用、`skills/dsh-qa/scripts/` 七处载波、
  `scripts/mpd-tui-panels.ts` 头部与 docker 双语 README）。**刻意的非移动项**照旧重申：
  `MPD_E2E_DSH_VERSION` 保持 `0.2.0-rc.2`（harness peer 范围未变）、`compat.hosts` 保持 0.10.1
  准入实测记录、生态规范号 `0.15` 永不移动、带日期的历史语句保持可读。
- **C2 面板保持器改道** — 侧边栏启用列表保持器**并入宿主原生自愈**：宿主自愈（`hostVersion >=
  0.15.0`，复用既有探针，不新增宿主触点）时保持器退位、零写入；旧宿主上 0.14 行为逐字节保留。
  用户在 /settings 里显式移除两个 MPD 面板后，本会话内保持移除、保持器不修复。
- **C3' 决策事件授权** — `extension-grants.json` 授权流程已有面向用户的文档；缝的可观察性已修
  （文件镜像、apply 行、以绑定作用域作为宿主身份）；账本归属臂以**具名的宿主侧闸门**如实记录为红。
- **C6 DAG 零任务缺陷**（用户现场报告）— 零任务时不再丢弃已解析的团队身份，改为渲染表头事实 +
  花名册行，另有 workspace 空态臂与负控钉住。
- **C7 团队面守卫** — 跨队配对拒绝（双方具名）、写任务×只读成员拒绝并给出理由、终态/归档队解析
  跳过并带清理遍历；**C7-4** 运行中任务面：`create_task`/`add_member` 可追加到已批准的活记录、
  成员可自关己行、邮箱摘要按队收敛、队/计划 id 毫秒+后缀并有冲突拒绝、分叉/续接的队长凭 lead 历史
  保任。以上全部配**常驻硬闸门** `team-dispatch-guard` 案例（17 自测臂 + 21 臂真实车道）进入
  `bun run test:qa`。
- **文档** — `docs/tui.md` 与中文版新增 §11.7、`agent-references/seam-adapters.md` 的 `tuiChannel`
  澄清句、`packages/mpd-tui-plugin` 双语 README（含重测结论：0.15.0 的 PanelBar **重新绘制插件图标**，
  0.14 的测量被取代）、`CHANGELOG.md` 一条覆盖 0.12.0 全量增量的 v0.13.0 条目。

**实测证据**（均在 `evidence/tui/dsh-tui-015/`）：宿主差异冻结基准 `host-diff/FACTS.md`；8 车道
对照表 `lane-repair2/step3-lanes.md`；C2 真 PTY 臂 `lane-Q/c2-real-pty/`；C7 守卫与硬闸门 `guard/`；
决策缝修复与具名宿主闸门 `decision-fix/REPORT.md` + `triage-reds/REPORT.md`；dist 重建与零写入归属
`dist-rebuild/`。

**跑过的门（提交修订上实测）**：typecheck 退出 0 · docs PASS（47 对 / 0 违规 / 0 死链）· rows ok（35
行 id）· comments PASS（401 文件 / 35524 声明）· manifest PASS（981 打包文件、必需路径 0 缺失）·
verify-dist-fresh 31/31 新鲜（钉版 bun 1.4.0）· vendor PASS（本提交内含全波唯一一次 re-pin）·
test:qa 全自测通过 · `bun test packages` 1939 通过 / 3 跳过 / 0 失败 · 打包闭包 605/605 一致、0 漂移
（pack stamp `2026-10-14T11:38:16.076Z`）· 8 条沙箱 TUI 车道**8/8 对齐冻结预期表**。

**诚实边界**：(1) C3' 账本归属仍红，且**已具名到宿主侧**——补丁行激活拿不到
`bindComponentIdentity` 写入的 Component 身份，我们的身份修复承重但不足，缝保持"备好未激活"，新增的
可读披露行如实说明；(2) Docker 实机车道在本分支可用后运行，其时间戳将记入波报告与发版清扫；
(3) `tui-distribution` 与 `tui-spec-conformance` 因声明的环境原因跳过（夹具缺失 / 本机无
`dsh-ecosystem-spec` 检出）；(4) `tui-panels` 的 `tuiRenderers` 红与 `tui-team-surface` 的 `H4` 红
是冻结表中声明的既有红，本波不修；(5) `tests` 门跑在 PATH 的 bun 1.4.2 上，构建钉版 1.4.0 另有证明，
冻结条款未约束测试运行器版本。
