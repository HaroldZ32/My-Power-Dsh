# mpd-better-sidebar-host

[English](./README.md) | **简体中文**

本 bundle 通往它所附带的 **`dsh-better-sidebar`** 宿主的那扇门。

## 为什么需要它

`dsh-better-sidebar` 是本 bundle 声明的依赖，所以 checkout 安装下它就在 `<bundle>/node_modules` 里。但名为
`dsh-better-sidebar` 的行是按 **profile 的** `node_modules` 解析的，而在 `link:` 安装（`dsh plugin add .`）下
那里只有被 link 的 bundle —— `healProfileModuleFallback` **不会**为 `link:` 层物化声明的依赖。实测结果：
bundle 的 sidebar guard 禁用了自己那一行，**bundle 完全没有贡献任何 sidebar GUI**。

两种修法都实测过，**都失败**，这个包正是为此存在：

| 尝试 | 结果 |
|---|---|
| 用 `file://` URL 当行的 NAME | 行**能挂载**，随后被加载器禁用：`its declared peer dependencies cannot be validated: name.startsWith is not a function`——校验器拿到的是 URL，而它期待包名 |
| 走 bundle 的 `exports`（`@mpd-dsh/mpd/node_modules/…`） | 被 **Node 本身**拒绝：`Invalid "exports" target "./node_modules/*"`——exports 目标不得包含 `node_modules` |

**相对路径的动态 import** 两个问题都没有：没有 exports 目标、没有 peer 校验（行解析到的是本包，peer 为空），
而宿主自己的依赖从它的真实位置向上解析。行本身是普通的 `@mpd-dsh/mpd/packages/…` 说明符，两种安装布局都能解析。

## 唯一会腐坏的地方

cordis 从"行所命名的那个模块"（也就是本包）取**声明的** `inject` 列表。列表为空时，宿主 apply 之后抛
`cannot get property "webServer" without inject`：它被加载了，却没有拿到自己声明的服务。所以这个列表在这里**重述**而非导入
（静态 import 无法同时命名两种布局下都存在的路径，而能解决这一点的动态 import 产不出静态导出）。
对 `dsh-better-sidebar@0.28.0`，它恰好是 `["webServer","sessions","connection","tools"]`。

`test/host-contract.test.ts` 会在该包可解析时把这份列表与宿主自己的列表对比，断言已安装版本是 `0.28.0`，
不可解析时**在日志里明说**——静默跳过正是本包要消除的那类缺陷。同一个文件还钉住了这份列表所对照的情形：
已退役的 `webRuntime` 接缝、0.2.0 代探测，以及 0.28 组合提供的 `connection` 服务。

## 接缝：`connection`，不是 `webRuntime`

`dsh-better-sidebar@0.28.0` 用 `ctx.connection.requestRejection(req) === undefined` 为 `/sidebar/api` 做围栏，
并在自己的 inject 列表里声明 `connection`。该服务由 harness **0.2.1-rc.1+** 的
`@deepseek-ai/dsh-client-connection` 提供 —— 本仓库固定的是 `0.2.1-rc.3`，因此在所有受支持的组合里该行都会挂载。
适配层以服务**存在**为条件武装，把宿主挂进一个声明了该服务的注入作用域；否则用
`[mpd-better-sidebar] disabled: … [reason=absent]` 自行禁用并点出缺失的服务。它绝不会等待一个没有构建会提供的服务。

## 配置

无。挂载它的行是 bundle patch 里的 `mpd-better-sidebar`。

## 已知边界

- `inject` 列表钉在 bundle 声明的宿主版本（`dsh-better-sidebar@0.28.0`，peer 范围 `>=0.28.0 <0.29.0`）上。
  改版本导致列表变化会让契约断言失败，而不是让宿主静默挨饿。
- 宿主是按运行时计算的路径找的；装在别处的宿主找不到，此时该行会**大声失败并打印它试过的路径**。
