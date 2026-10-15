# fix: address all 15 CodeRabbit findings on PR #42

Follow-up to the v0.13.0 wave (`tui-015-adaptation`). CodeRabbit reviewed PR #42 with **15 inline
findings**; this branch repairs them, each with a control, and records the triage at
`evidence/tui/dsh-tui-015/coderabbit/` (raw payload: `pr42-review-comments.json`).

## English

**Security / authorization (packages/mpd-team-core-plugin — 4 Major, CWE-862/CWE-863 + two integrity
defects).**
- The LIVE append arms (`add_member`/`create_task` on an approved record) now require **Lead
  authorization**: a roster member's append is refused with a reason and the record is byte-unchanged.
  The review's literal `recordNamesLead` patch would have stayed bypassable by the lineage shape — the
  narrowed-ancestry arm proves that shape is refused.
- **Lineage is no longer part of a roster member's caller spellings**, so a member whose
  `parentSession` is the Lead cannot take the Lead close override; a forked captain still heals.
- The mailbox summary is scoped by **team identity** (`teamId` stamped at send) instead of member
  ids/names that repeat across teams (every team mints `M1`, `M2`, …); unstamped legacy rows are
  excluded from `scope:"team"` and counted.
- The archive/reap rule is keyed by the record's own **`planId`** (stamped at approval) instead of
  Lead+name, so a discarded retry plan can no longer reap a LIVE team; records without `planId` are
  never archive-reaped (stated migration rule).

**Docker.** `BROWSER_INSTALL` is reset before the mirror retry (a successful retry no longer reports
`unavailable`); failure judgement subtracts the pre-send capture so a **stale** failure panel cannot
bind a credential verdict; the 01b tarball probe falls back to the mirror's metadata+tarball before
settling. The 16c step comment now carries the shipped numbers (warm-cache 70.8–113.1 s over three
green runs, the 1800 s case budget, the runner's 2400 s ceiling).

**QA (skills/dsh-qa, single writer).** The staged pack install is NON-LINKED (`--install-links`
+ `--legacy-peer-deps`, the peer semantics a real profile has) because a linked `file:` dependency
never materialized the pack's own closure — **measured**: the linked launcher resolved NEITHER
`@ast-grep/cli` NOR `cclsp`. The real lane now passes in 70.8–113.1 s with ONE shared warm npm cache;
the collision the non-linked install first exposed was diagnosed to npm's peer auto-install pulling a
**second harness copy** whose module-local scope Symbol breaks agent scoping (falsifying the
double-mount hypothesis with `dump-config`: 130 rows, zero duplicate ids). Six further skills findings
(stale headers, an unrestored negative control, a stale pane width, session preference, dependency
version gating) are fixed.

**Product finding (reported, not fixed here).** Any profile whose `node_modules` carries a second copy
of the harness core is boot-fatal through a duplicate `send_message`, because `@deepseek-ai/dsh-scope`
keys scopes by a module-local `Symbol` — repro + stack at
`evidence/tui/dsh-tui-015/coderabbit/skills3/collision/`.

**Gates (observed):** `verify:vendor` PASS (single re-pin on the settled tree) · `test:qa` all
self-tests passed · `typecheck` exit 0 · `verify:comments` PASS · `verify:docs` PASS (47 pairs / 0 dead
links) · `verify:rows` 35 ids · `verify:manifest` PASS · `verify-dist-fresh` 31/31 fresh ·
`verify:gates` 8/8.

---

## 简体中文

**安全/授权（packages/mpd-team-core-plugin，4 条 Major，CWE-862/CWE-863 + 两项完整性缺陷）。**
- 活记录的追加臂（`add_member`/`create_task`）现在要求 **Lead 授权**：名册成员的追加被拒并给出原因，
  记录逐字节不变。评审给出的字面 `recordNamesLead` 补丁仍可被 lineage 形状绕过——收窄祖先的臂证明了
  该形状被拒。
- **lineage 不再进入名册成员的调用者拼写**，因此 `parentSession` 为 Lead 的成员无法取得 Lead 关闭
  覆盖权；分叉的队长仍然自愈。
- 邮箱摘要按**团队身份**收敛（发送时盖 `teamId`），不再用跨队重复的成员 id/名字（每队都从 `M1` 起）；
  无戳的旧记录被排除出 `scope:"team"` 并计数。
- 归档/回收规则改按记录自身的 **`planId`**（批准时盖章），不再按 Lead+名字，被丢弃的重试计划再也
  不会回收活队；无 `planId` 的记录永不被归档回收（迁移规则已写明）。

**Docker。** 镜像重试前重置 `BROWSER_INSTALL`（成功的重试不再被报为不可用）；失败判定减去发送前
画面，**陈旧**失败面板不能绑定凭据裁决；01b 的 tarball 探测在落定前回退探测镜像的元数据+tarball。
16c 步骤注释已带上实发数字（热缓存三次绿跑 70.8–113.1 s、案例 1800 s 预算、运行器 2400 s 上限）。

**QA（skills/dsh-qa，单写者）。** 暂存包改为**非链接**安装（`--install-links` + `--legacy-peer-deps`，
即真实 profile 的 peer 语义）——软链的 `file:` 依赖从不物化包自身的闭包，**实测**：软链下启动器
既解析不到 `@ast-grep/cli` 也解析不到 `cclsp`。真实车道在共享一份热 npm 缓存后以 70.8–113.1 s 通过；
非链接安装首次暴露的碰撞已定位为 npm 的 peer 自动安装拉入**第二份 harness 拷贝**、其模块局部
Symbol 使 agent 作用域失效（用 `dump-config` 否证了双挂载假设：130 行、零重复 id）。另有六条 QA
意见（陈旧表头、未还原的负控、陈旧画幅宽度、会话选择、依赖版本门）已修。

**产品级发现（已报告、不在本 PR 修）。** 任何 `node_modules` 里带第二份 harness 核心的 profile 都会
因重复 `send_message` 启动即死，因为 `@deepseek-ai/dsh-scope` 用模块局部 `Symbol` 记作用域——复现与
栈见 `evidence/tui/dsh-tui-015/coderabbit/skills3/collision/`。

**门（实测）：** `verify:vendor` PASS（稳定树上单次 re-pin）· `test:qa` 全自测通过 · `typecheck`
退出 0 · `verify:comments` PASS · `verify:docs` PASS（47 对 / 0 死链）· `verify:rows` 35 行 id ·
`verify:manifest` PASS · `verify-dist-fresh` 31/31 · `verify:gates` 8/8。
