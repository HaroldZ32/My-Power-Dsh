# v0.13.0 — dsh-tui 0.15.0 adaptation, the keeper that stands down, the 0-task DAG fix, and the team-plane guards

Adaptation release: the bundle targets **`@deepseek-harness-tui/dsh-tui` 0.15.0** and lands four
functional clauses plus an unconditional release. This entry covers the FULL delta since v0.12.0 — see
[`CHANGELOG.md`](../../blob/v0.13.0/CHANGELOG.md) for the complete list (two host adaptations, the
de-vendor/re-source chapter, the live team surfaces, the win32 band, the model-route repairs).

## English

**Adapted to dsh-tui 0.15.0.** The fifteen plugin-facing `ctx.tui*` seams are identical between 0.14.0
and 0.15.0 (declarations additive-only), so this is a carrier move plus verification: every release
carrier names 0.15.0, and the four deliberate non-moves stay (`MPD_E2E_DSH_VERSION` 0.2.0-rc.2, the
`compat.hosts` 0.10.1 admission measurement, the registry-`0.15` ecosystem-spec string, dated-history
sentences). The measured delta is frozen at
[`evidence/tui/dsh-tui-015/host-diff/FACTS.md`](../../blob/v0.13.0/evidence/tui/dsh-tui-015/host-diff/FACTS.md).

**The keeper stands down onto the host's native self-heal.** On hosts whose sidebar CSV self-heals
(`hostVersion >= 0.15.0`, read through the already-proven probe — no new host contact) the enable-list
keeper writes nothing; on older hosts the 0.14 behaviour is preserved byte-for-byte. An explicit
`/settings` removal of both MPD panels stays removed session-wide; proven on a real PTY.

**The 0-task DAG defect is fixed** (reported live by the user): the MPD panel no longer discards a
resolved team's identity when the board is empty — it draws the header facts and a roster row instead of
a bare empty state.

**Team-plane dispatch guards, with a standing hard gate.** Cross-team pairing refused (both ids named),
write-task × read-only-member refused, terminal/archived-team resolution skipped; mid-run
`create_task`/`add_member` append to a live approved record, members close their own rows, the mailbox
summary is team-scoped, ids are ms+suffix with collision refusals, and a forked/resumed captain keeps
captaincy. The `team-dispatch-guard` QA case (17 self-test arms + a 21-arm real lane) runs inside
`bun run test:qa`.

**Decision-events grants.** The `extension-grants.json` flow is documented user-facing and the seam's
observability is fixed; the ledger-attribution arm is recorded RED with a NAMED host-side gate
(`requireComponentIdentity`'s WeakMap) — the seam is built ready, NOT activated, and says so.

**Verified.** Loops A/B blind-verified PASS (`rec-20261014T164146-027c3b`,
`rec-20261014T170113-33f5e1`); 8/8 sandbox TUI lanes match the frozen expected-status table; Docker
real-machine lanes green at the release candidate: source LIVE 114 pass / 0 fail / 4 NULL
(`2026-10-14T17-06-22Z`) and oneclick LIVE 113 pass / 0 fail / 5 NULL (`2026-10-14T17-12-46Z`), both
`--require-docker`.

**Known bounds (declared, not smoothed):** two QA lanes SKIP for a declared environment reason
(absent fixture / no `dsh-ecosystem-spec` checkout); `tuiRenderers` and `H4` remain the pre-existing
declared reds; `VENDOR_LOCK.json` needed three writes because a post-integration skills repair landed
after the first re-pin (recorded in the wave report).

## 简体中文

**适配 dsh-tui 0.15.0。** 十五条面向插件的 `ctx.tui*` 缝在 0.14.0 与 0.15.0 间完全一致（声明仅增量），
因此本波是载波迁移 + 验证：所有发布载波改名 0.15.0，四项刻意的非移动项保持不变（`MPD_E2E_DSH_VERSION`
0.2.0-rc.2、`compat.hosts` 的 0.10.1 准入实测、生态规范号 `0.15`、带日期的历史语句）。实测差异冻结于
`evidence/tui/dsh-tui-015/host-diff/FACTS.md`。

**保持器并入宿主原生自愈。** 侧边栏 CS V 会自愈的宿主（`hostVersion >= 0.15.0`，经既有探针读取、不新增
宿主触点）上，启用列表保持器零写入；旧宿主逐字节保留 0.14 行为。用户在 `/settings` 显式移除两个 MPD
面板后本会话保持移除——已在真实 PTY 上验证。

**DAG 零任务缺陷已修**（用户现场报告）：看板为空时不再丢弃已解析的团队身份，改为渲染表头事实 + 一行
花名册。

**团队面调度守卫 + 常驻硬闸门。** 跨队配对拒绝（双方具名）、写任务 × 只读成员拒绝、终态/归档队解析
跳过；运行中 `create_task`/`add_member` 可追加到已批准活记录、成员可自关己行、邮箱摘要按队收敛、id
毫秒+后缀且有冲突拒绝、分叉/续接的队长保任。`team-dispatch-guard` 案例（17 自测臂 + 21 臂真实车道）
在 `bun run test:qa` 内运行。

**决策事件授权。** `extension-grants.json` 流程已有面向用户文档，缝的可观察性已修；账本归属臂以**具名的
宿主侧闸门**（`requireComponentIdentity` 的 WeakMap）如实记为红——缝"备好未激活"，并明确说明。

**已验证。** Loop A/B 盲审 PASS；8/8 沙箱 TUI 车道对齐冻结预期表；发版候选上 Docker 实机双模式全绿：
source LIVE 114/0/4（`17-06-22Z`）、oneclick LIVE 113/0/5（`17-12-46Z`），均 `--require-docker`。

**已知边界（声明而非抹平）：** 两条 QA 车道因声明的环境原因跳过；`tuiRenderers` 与 `H4` 为既有声明红；
`VENDOR_LOCK.json` 共三次写入（集成后仍有 skills 修复落地，波报告已记录）。
