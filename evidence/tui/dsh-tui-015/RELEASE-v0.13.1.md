# v0.13.1 — the review pass: team-plane authorization, docker lane honesty, the QA install path

Patch release answering **all fifteen CodeRabbit findings** on the v0.13.0 PR (#42). Verified by a
blind seat (`rec-20261015T071509-834da8`, PASS) and by the Docker real-machine lanes in **both modes**
at this revision.

## English

**Security / authorization (four Major, CWE-862 / CWE-863 + two integrity defects).**
- `agent_teams_plan`'s LIVE append verbs (`add_member` / `create_task`) now require **Lead
  authorization**; a roster member's attempt is refused with a reason and leaves the record
  byte-unchanged. (The review's literal patch would have stayed bypassable through the lineage shape —
  the shipped guard narrows the ancestry and an arm proves it.)
- **Lineage no longer identifies a roster member**, so a member whose `parentSession` is the Lead
  cannot take the Lead's close override; a forked/resumed captain still heals.
- The mailbox summary is scoped by **team identity** (`teamId` stamped at send) instead of member
  ids/names that repeat across teams; unstamped legacy rows are excluded from `scope:"team"` and
  counted.
- The archive/reap rule is keyed by the record's own **`planId`** (stamped at approval) instead of
  Lead + name, so a discarded retry plan can no longer reap a LIVE team; records without the field are
  never archive-reaped (stated migration rule).

**Docker.** `BROWSER_INSTALL` resets before the mirror retry (a successful retry is no longer reported
unavailable); the reply verdict subtracts the pre-send capture so a **stale** failure panel cannot bind
a credential bound; step 01b's tarball probe falls back to the mirror's metadata AND tarball before
settling.

**QA.** The `mcp-call` case installs the staged pack **non-linked** (`--install-links` +
`--legacy-peer-deps`, the peer semantics a real profile has): a linked `file:` dependency never
materialized the pack's own closure (measured: the linked launcher resolved neither `@ast-grep/cli` nor
`cclsp`). With one shared warm npm cache the lane passes in 70.8–113.1 s (from 1037 s cold). Six
smaller TUI-case findings are fixed too.

**Reported, not fixed here (host-side).** Any profile whose `node_modules` carries a second copy of the
harness core is boot-fatal through a duplicate `send_message`, because `@deepseek-ai/dsh-scope` keys
scopes by a module-local `Symbol` — repro + stack in
[`evidence/tui/dsh-tui-015/coderabbit/skills3/collision/`](../../blob/v0.13.1/evidence/tui/dsh-tui-015/coderabbit/skills3/collision/).

**Verified.** Blind verification PASS `rec-20261015T071509-834da8`; Docker source LIVE 114 pass / 0
fail / 4 NULL (`2026-10-15T07-22-55Z`) and oneclick LIVE 113 pass / 0 fail / 5 NULL
(`2026-10-15T07-47-06Z`), both `--require-docker`; static gates 8/8; unit band 1955 tests / 0 fail.
The five NITs the verifying seat recorded are follow-ups, not silent edits. Full notes:
[`CHANGELOG.md`](../../blob/v0.13.1/CHANGELOG.md).

## 简体中文

**安全/授权（4 条 Major，CWE-862 / CWE-863 + 两项完整性缺陷）。**
- `agent_teams_plan` 的活记录追加（`add_member` / `create_task`）现在要求 **Lead 授权**；名册成员的
  尝试被拒并给出原因，记录逐字节不变。（评审的字面补丁仍会被 lineage 形状绕过——实发守卫收窄了祖先，
  并有单测臂证明该形状被拒。）
- **lineage 不再等同于名册成员身份**，`parentSession` 为 Lead 的成员无法取得 Lead 的关闭覆盖权；
  分叉/续接的队长仍然自愈。
- 邮箱摘要按**团队身份**收敛（发送时盖 `teamId`），不再用跨队重复的成员 id/名字；无戳旧记录被排除出
  `scope:"team"` 并计数。
- 归档/回收规则改按记录自身的 **`planId`**（批准时盖章），被丢弃的重试计划再也不能回收活队；无该字段
  的记录永不被归档回收（迁移规则已写明）。

**Docker。** 镜像重试前重置 `BROWSER_INSTALL`（成功的重试不再被报为不可用）；裁决减去发送前画面，
**陈旧**失败面板不能绑定凭据裁决；01b 的 tarball 探测在落定前回退探测镜像的元数据与 tarball。

**QA。** `mcp-call` 案例改为**非链接**安装暂存包（`--install-links` + `--legacy-peer-deps`，即真实
profile 的 peer 语义）：软链的 `file:` 依赖从不物化包自身闭包（实测：软链下启动器既解析不到
`@ast-grep/cli` 也解析不到 `cclsp`）。共享一份热 npm 缓存后，车道以 70.8–113.1 s 通过（冷装 1037 s）。
另有六条 TUI 案例的小问题一并修复。

**已报告、不在本版修（宿主侧）。** 任何 `node_modules` 里带第二份 harness 核心的 profile 都会因重复
`send_message` 启动即死，因为 `@deepseek-ai/dsh-scope` 用模块局部 `Symbol` 记作用域——复现与栈见
`evidence/tui/dsh-tui-015/coderabbit/skills3/collision/`。

**已验证。** 盲审 PASS `rec-20261015T071509-834da8`；Docker source LIVE 114/0/4（`07:22:55Z`）与
oneclick LIVE 113/0/5（`07:47:06Z`），均 `--require-docker`；静态门 8/8；单测带 1955 项 0 失败。
验证席记录的 5 条 NIT 作为后续项而非裁定后改动。完整说明见 `CHANGELOG.md`。
