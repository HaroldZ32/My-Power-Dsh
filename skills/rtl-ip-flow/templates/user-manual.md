# <IP名称>

> 用户手册模板 —— 章节结构与格式必须严格遵循（来自用户样例 /root/docTemp/userManual.md）。
> [Spec Designer] 按此模板产出；每节完成后自查与模板章节点一一对应。

## 简介

简要说明模块的功能与用途，100~300 字为佳。

## 主要特征

按条说明模块的功能点，清晰的列出模块具体支持的所有功能与参数。

## 功能描述

分章节描述。

第一章节画一个框图，描述模块的整体设计，不用详细描述接口等设计，表意即可，使用drawio/plantuml绘制，若表意不明，可使用字符串绘制。

其余章节详细描述模块的功能实现，主要基于每个功能是怎么实现的，对于具体设计不用过多描述，主要说明软硬件是如何协同工作跑通功能的，要求覆盖到模块的所有功能点。

## 软件配置流程

设置几个典型的用户场景，覆盖到所有的功能，分章节详细描述这几个场景软件的配置流程，**不要在里面直接写任何的代码**，但要求用户能根据流程写出代码，详细说明每一步在做什么，做的时候需要用户配寄存器的哪几位，应该在不同的情况下配什么数字。若可能，绘制状态机图（可使用plantuml）配合描述软件场景。

## 寄存器

### 寄存器总览

下表为格式示例。RESERVED表示预留，每个寄存器位往后若为空格表示该位为左侧最近寄存器的扩展位（RESERVED同理），例如下表的FIELD0，其位域即为[5:4]。初始值位除RESERVED允许右侧空格，否则必须按位写初值。

|Offset|Register|31|30|29|28|27|26|25|24|23|22|21|20|19|18|17|16|15|14|13|12|11|10| 9| 8| 7| 6| 5| 4| 3| 2| 1| 0|
|------|--------|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|
|  000h| IP_REG0|RESERVED| | | | | | | | | | |FIELD3|RESERVED| | | | | | |FIELD2|RESERVED| | | | | FIELD1| FIELD0| |RESERVED| | | |
|      |Reset Value|RESERVED| | | | | | | | | | |0|RESERVED| | | | | | |1|RESERVED| | | | | 0| 1| 0|RESERVED| | | |

### 寄存器1（IP_REG0）

偏移地址与复位值必须与总览对齐。

偏移地址：0x00

复位值：0x0000 1020

> 位图表 + 位域表：|位域|名称|读写属性|描述|（access 语义见下表，参考 UVM）
> 位域描述格式：`0: 功能某行为 | 1: 功能某行为`；RESERVED 一律 "保留，必须保持复位值"。

| 31 | 30 | 29 | 28 | 27 | 26 | 25 | 24 | 23 | 22 | 21 | 20 | 19 | 18 | 17 | 16 |
|----|----|----|----|----|----|----|----|----|----|----|----|----| ----|----|----|
|RESERVED| | | | | | | | | | |FIELD3|RESERVED| | | |
| | | | | | | | | | | |rw| | | | |

| 15 | 14 | 13 | 12 | 11 | 10 |  9 |  8 |  7 |  6 |  5 |  4 |  3 |  2 |  1 |  0 |
|----|----|----|----|----|----|----|----|----|----|----|----|----| ----|----|----|
| | | |FIELD2|RESERVED| | | | | FIELD1| FIELD0| |RESERVED| | | |
| | | |rw|RESERVED| | | | | w1c| rw|rw|RESERVED| | | |

|位域|名称|读写属性|描述|
|--|--|--|----------|
|31:21|RESERVED|  |保留，必须保持复位值|
|20|FIELD3|rw|示例寄存器3，它是用来干功能3的<br>0:功能3那样这样<br>1:功能3那样这样|
|19:13|RESERVED|  |保留，必须保持复位值|
|12|FIELD2|rw|示例寄存器2，它是用来干功能2的<br>0:功能2那样这样<br>1:功能2那样这样|
|11:7|RESERVED|  |保留，必须保持复位值|
|6|FIELD1|rw|示例寄存器1，它是用来干功能1的<br>0:功能2那样这样<br>1:功能2那样这样，写1清0|
|5:4|FIELD0|rw|示例寄存器0，它是用来干功能0的，这几位有这样那样的功能|
|3:0|RESERVED|  |保留，必须保持复位值|

读写属性 access 语义（参考 UVM，表内使用左侧缩写）：

```
rw  read/write
ro  read-only
wo  write-only
w1  write-once
w1c write a 1 to bitwise-clear
rc  clear on read
rs  Read Sets All
wrc Write Read Clears All
wrs Write, Read Sets All
wc  Write Clears All
ws  Write Sets All
wsrc Write Sets All, Read Clears All
wcrs Write Clears All, Read Sets All
w1s Write 1 to Set
w1t Write 1 to Toggle
w0c Write 0 to Clear
w0s Write 0 to Set
w0t Write 0 to Toggle
w1src Write 1 to Set, Read Clears All
w1crs Write 1 to Clear, Read Sets All
w0src Write 0 to Set, Read Clears All
w0crs Write 0 to Clear, Read Sets All
woc Write Only Clears All
wos Write Only Sets All
wo1 Write Only, Once
```

> 每个寄存器一节，格式与上完全一致；寄存器数量与总览表严格一致，offset/复位值/位域一致。
