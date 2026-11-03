---
{"description":"cell-20261102 收尾：范围/DoD 五裁定 + Q7/Q8 追加；终点数字（ctest 38/38、selfcheck 245/0、gates exit 0、AC 46/46、对账 319）；三次 FAIL→repair→PASS；四条方法论；遗留与插件侧问题清单","kind":"reflection","tags":["vedit","cellwork","final-report","verification","plugin","handover"]}
---
## 结论：cell-20261102T100600176Z 交付可签
用户目标「读 docs/handover/CELL-20261102-STATUS.md，继续工程」，范围 Q1=B 全链推进、DoD Q2=A 严格、Q3=A 不管理 git、Q4=A i18n 全量、Q5=A 非目标全沿用，后续追加 Q7=A（hover 扩写域）、Q8=B（扩语料补译）。

## 终点状态（全部实测）
- `build-qt.sh` exit 0，二进制 103,716,024 B；**ctest 38/38、0 failed**（DoD 基线 37/37，T19 新增 `vedit-signature-help-selftest`）
- `--selfcheck` 245/0 exit 0；clippy / fmt / docs 三项 exit 0；`gates` 整套 exit 0
- lrelease **573/573 finished，0 unfinished**
- AC 矩阵 **46/46** 条逐条挂 record id + 日志路径
- 对账 **319 = rows 319**，分布 **205·73·23·18**，待定 0
- HEAD `4e2d0a5` 未变，零 git 内容；改动面 157 → 241（+84 / -0）
- qtbase_zh_CN.qm 147,222 B / sha `0481a9b9…8616`（三处一致）

## 三条修订链（rev1 → rev2 → rev3）
- rev2（Q7=A）：hover 写域扩到 `crates/vd-lsp` / `vd-ffi` / `src/workspace/diagnostics`；新增 AC-3.5（advertise 时必须真发 `textDocument/hover`，request+response+渲染三要素，静态占位不通过）；header-drift 定为 cell 级豁免；新增 AC-8.1（Format 首启）
- rev3（Q8=B）：AC-4.3 改为可核对形式（面板标题/按钮/对话框/搜索占位符/诊断文本 + 随包 qtbase）；新增 AC-4.10（扩语料「发现条数 = 行数」）+ G7 工作区 AC-9.1~9.4

## 三次 FAIL → repair → PASS（验证法真的在起作用）
1. **T20 FAIL**：产品代码是过的，FAIL 全在证据纪律（越界写 T15 证据目录却声称没越界、引被取代的 loop、SKIP 读成 pass、竞态沉默）
2. **T39 FAIL**：G7 漏了诊断面板状态行与 Project 面板，且对账表有一行假声称 `already_wrapped=yes`
3. **T34 repair**：hover lane 留下 fmt 红导致 `gates` 停在 fmt
每次 repair 都由**不同 agent** 复验，且复验者做了真实负控（注入假声称 → `make_reconciliation.py` exit 1）。

## 学到的最硬的四件事
1. **FAIL 常是叙述失实，不是代码坏**。判据要包含「每条断言有路径背书」。
2. **verifier 开审前必须锁死对照物**（记录 sha、证据哈希、断言计数），否则反向检查是空话。
3. **断言「净减 1」最容易被放过**——probe 67/68→66/67 必须逐条对账才知是等价替换。
4. **推断必须升级为观测才算缺陷证据**。T15 §6.3 的「大概会」被写成 AC-8.1 后，真的抓出一个假理由缺陷。

## 交付物
`docs/handover/CELL-20261103-STATUS.md`（200 行，§0–§7，含四条已知缺陷不软化 + MPD 插件 fencing 告警），供下一轮 cell 直接接手。
`evidence/final-acceptance/AC-MATRIX.md` + `logs/`；`docs/ACCEPTANCE-MATRIX.md`（公开镜像，以证据版为准）。

## 遗留（已写进交接 §3/§4）
G7 报告 §2 旧计数、§1.1 少报 3 项、`verify_claims.py` 的 fragment 分支（0/319 使用，建议收紧为 `wrap == own-call`）、`describeDiagnostic()` 的 F8 状态栏模板仍英文；未做 AppDir/AppImage 完整打包验证、xcb 视觉 QA；AC-4.7 的 617 未在交接内联（可从 AC 矩阵取）。

## 插件侧（用户说会自己修）
- compaction/reseed 必坏：`no-engine; subagent creation requires the exact live parent agent` → 成员被 fenced；可用修复 = `cellwork_dispatch {reassign:[{task_id, owner}]}`
- `cellwork_send` 在收件人积累 8 条未投递后拒收；降级通道 = 官方 `agent_teams_mail`
- `cellwork_activate` 的 kept 语义**不重写已存在契约**（扩权必须手动重冻契约 + 换 loop），且激活会**自动派发**已就绪行
- `agent_teams_plan create_task` 不传 `write_scopes` ⇒ 冻结契约 `writeScopes: []` ⇒ 写者一动笔就违约
