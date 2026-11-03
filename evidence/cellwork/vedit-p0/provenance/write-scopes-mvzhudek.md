---
{"description":"agent_teams_plan create_task 未传 write_scopes 会让 cellwork 契约 writeScopes=[]，写者一动笔就违约；修法是建行时给清单，已冻结则书面授权+兜底问话+同步复审者；根因文件常在原 scope 外","kind":"fact","tags":["cellwork","contract","write-scope","repair","lesson","plugin"]}
---
## 现象
用 `agent_teams_plan {action:"create_task"}` 手工建 repair 行时，如果**只给 subject/description/owner/kind**，生成的 cellwork 冻结契约里 **`writeScopes` 是空数组**，而契约的验收条款写着「每个改动路径都必须在允许写域内」——于是写者一旦动手就违约，它只能在派单后停下来问 captain。

本次（T40，G7 repair）就是这样：se-config 认领后**未写一字节**，先只读定位到五条 finding 的确切文件与行号，然后上报阻塞。它的判断是对的。

## 修法（按顺序）
1. **最好的做法**：建任务时就传 `write_scopes`（`task.write_scopes`）。
2. 已经建歪了、契约冻结了：captain **书面授权**一份最小写域清单（消息即授权），并要求写者：
   - 严格按清单执行；
   - 过程中若发现还需要别的文件，**先问再动**；
   - 交付报告里列出「写域外文件（应为空）」；
   再同步告知复审者「这是 captain 授予的 scope 例外」，让它审「登记是否准确」而不是「是否越界」。
3. 这是我第二次踩同类坑（第一次是 T20 的 F1：合法但有意义的越界写入被复审判成 Blocker）。

## 一般化教训
**范围（scope）是契约里最容易出洞的一栏，而它对写者的伤害是「做了活却违规」。**
- 手工创建的任何写任务，`write_scopes` 必须是显式清单，尤其是 repair 行；
- 修 bug 的 repair 往往要动「原任务没碰过的文件」（本次是 `tools/make_reconciliation.py` 这个生成器），**根因文件常常不在原 scope 里**——必须在授权清单里主动把它包含进去，否则写者只能修表面、下一轮还会生成同样的假数据；
- 授权要写成「清单 + 兜底问话」：清单给出确定性，兜底问话防止清单不全时写者自行扩权。

## 配套观察
se-config 在被判阻塞后的处理方式值得记住：**先只读定位到确切行号，再上报，而不是边猜边写**。它给出的定位（`diagnostics_panel.cpp:306`、`project_model.cpp:352`、`project_integration.cpp:57`、`tools/make_reconciliation.py:65-66`）让 captain 的授权可以精确到行，而不是笼统「随便改」。
