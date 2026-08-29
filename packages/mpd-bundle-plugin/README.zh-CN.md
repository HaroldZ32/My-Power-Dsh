# mpd-bundle-plugin

**中文** | [English](./README.md)

`@mpd-dsh/mpd` bundle 自身的 main 插件和 Web 客户端界面。两个职责：

1. **Web 兼容 main**——bundle 包的 `main` / `exports["."]` 指向这里。它是一个 no-op 插件（`apply() {}`），名称为 `@mpd-dsh/mpd`。bundle patch 的 `mpd-web-compat` 自引用行（`name: '@mpd-dsh/mpd'`）加载它，这使得 loader 条目名称为**恰好** `@mpd-dsh/mpd`——这是 client-modules 为 bundle 构建 boot-graph 客户端行所要求的入口（没有它，team/workmate 面板永远不会加载）。
2. **合并的 Web 客户端**——`client.js`（由 `scripts/build-mpd-client.mjs` 生成）作为 bundle 的 `./client` 导出被提供：
   - 逐字采用 agent-teams 的 `lib/client.js`（注册 `@nanmicoder/dsh-agent-teams`：团队活动浮层 + 团队卡片 + 命令视图），
   - 为 `@mpd-dsh/mpd` 提供第二个注册，其 factory 挂载 `agentTeams.apply(ctx)` **以及** workmate 库浮层（`shell.overlay`，id `mpd-workmate-library`）+ sidebar 底部 "Workmates" 开关（`sidebar.footer.action`，id `mpd-workmate-toggle`），它通过 `/plugins/mpd-workmate/{list,init}` 读取和创建 workmate。

## 配置

无。这是基础设施：自引用行在 bundle patch 中不携带任何配置。

## 重新生成客户端

```bash
node scripts/build-mpd-client.mjs   # after editing src/web-client.js or agent-teams client
node scripts/pack-mpd.mjs           # restage the bundle
```

## 文件

- `src/index.ts`——no-op main 插件。
- `src/web-client.js`——mpd 客户端 factory 主体（纯 JS，React.createElement）。
- `client.js`——生成的合并客户端（已提交，镜像 vendored agent-teams 客户端工件）。
