# 面板以 DSH 客户端插件的形式实现，而不是外挂一个本地网页

当前插件是纯 Host 插件（只有 `package.json.main`），没有任何界面。要加管理面板，生态里有两条路：给包增加 `dsh.client` + `exports["./client"]` 走 DSH 的 slot 机制，或者让 Host 半边起一个 `127.0.0.1` 的本地 HTTP 服务、把页面塞进右栏 Browser 标签。

选前者。理由是用户明确要「能在 DSH 里直接打开的面板」，而 slot 方案拿到的是宿主主题 token、明暗切换和 `ctx.locale`，外挂页面三样全丢。代价是脆：slot 名和 keyed 占用关系没有版本协商机制，`dsh.client` 声明里也没有任何版本字段，升级 DSH 后面板可能整个挂掉——这正是必须有降级路径的原因。

## Consequences

- 面板不能直接 `fetch` 宿主数据，也不能 `require` 任何 Harness Client 包（官方指南明确警告这些会无预告变化）。Host 与 Client 之间必须有一条自建的通信通道。
- 组件拿不到 `ctx`，所有服务必须在 `apply` 闭包里投影成 props 传进去。
- 每个 slot 单元格只能被一个 entry 占用；复用 shipped id 等于替换别人的呈现，必须用未占用的 id。
- 升级 DSH 后运行 `cordis_inspect what:"client"` 是唯一的兼容性探针。
