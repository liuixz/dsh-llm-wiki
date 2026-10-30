# Changelog

## 0.12.4 — 2026-10-30

**只保留设置页入口，并修掉两处界面缺陷。**

### 修复 1：设置页左侧导航里没有分区名称

`lib/client.js` 注册 `settings.section` 时只给了 `name` / `id` / `order` / `inject`，**没给 `label`**。设置页左侧导航靠 `label` 渲染分区名称，缺了就只剩内容、没有名字（现象是分区可点、正文正常，唯独名称位空白）。

```js
{
  name: "settings.section",
  id: "llm-wiki",
  order: 65,
  label: () => "LLM-Wiki",   // ← 补这一行
  inject: () => ({ locale: activeLocale() }),
}
```

用函数形式（而非字符串）与生态写法一致，宿主可以延迟求值。

### 修复 2：计划任务表右侧列被裁掉，且无法滚动

`.lw-card` 是 `overflow:hidden`（为了圆角裁切），而 `.lw-table` 用 `table-layout:auto`、宽度 `100%`，**没有外层滚动容器**。任务表列多（名称 / 描述 / 调度 / 时刻 / 状态 / 上次结果 / 下次运行 / 操作），撑不开就整块超出卡片、被直接裁掉；浏览器也不会给 `<table>` 自己出滚动条。

改法：`table()` 产出后包一层滚动容器。

```js
var scroller = el("div", "lw-table-wrap");
scroller.appendChild(t);
```

```css
.lw-table-wrap{width:100%;overflow-x:auto;overscroll-behavior-x:contain;}
.lw-table-wrap::-webkit-scrollbar{height:8px;}
.lw-table-wrap::-webkit-scrollbar-thumb{background:var(--lw-border);border-radius:4px;}
/* 紧凑模式每行折叠成「标签 : 值」，不需要横向滚动 */
.llmwiki-panel.is-compact .lw-table-wrap{overflow-x:visible;}
```

空表时的 `lw-empty` 提示也放进同一个容器，避免出现「空表在卡片里、提示在滚动区外」的两层结构。

### 变更：移除右栏标签，只保留设置页

删除 `lib/client.js` 里的 `SidebarPane`、`TAB_ID`、`ctx.sidebarRightTabs.register(...)` 与 `sidebar.right.pane.tab` 座位注册；`factory.inject` 从 `["slots","sidebarRightTabs","locale"]` 收敛为 `["slots","locale"]`；`package.json` 的 `dsh.client.inject` 去掉 `@deepseek-ai/dsh-client-ui-sidebar-right`。

右栏标签本来只在有会话时出现（hero 屏右侧为空），加上两个入口共用同一套 Host 路由，维护成本大于收益。降级页 `/llm-wiki-panel/` 保留，仍是座位失效时的兜底。

### 验证

临时探针（Node + vm + 极简假 DOM，跑完即删）21 项全过：

- 客户端半边：bundle id、`factory.inject` 不再含 `sidebarRightTabs`、**只注册一个座位**、座位是 `settings.section`、`label` 是函数、`label()` 返回 `"LLM-Wiki"`、没有注册 `sidebar.right.pane.tab`、没有调用 `ctx.sidebarRightTabs.register`、源码无 `TAB_ID`/`SidebarPane` 残留。
- 界面：`mount()` 返回 `destroy`，DOM 里存在 `.lw-table-wrap` 且每个容器直接含 `<table>`，**没有 `<table>` 直接挂在 `.lw-card-body` 下**。
- CSS：`.lw-table-wrap` 有 `overflow-x:auto`；紧凑模式下改为 `overflow-x:visible`。
- `package.json`：不再注入 `dsh-client-ui-sidebar-right`，仍注入 `slots` 与 `settings`。

顺带记一处探针教训：`web/panel.js` 的 `request()` 读的是 `r.text()` 而不是 `r.json()`，stub 写错会让整个界面停在骨架态（`.lw-empty`），断言表现为「表格容器不存在」而不是报错。

## 0.12.3 — 2026-10-30

**修掉第二个真 bug**：设置页第一次打开正常，关掉再开就变空白。

### 修复：卸载时清掉了「模块已加载」状态，第二次打开卡在永不触发的 load

`lib/client.js` 的 `PanelHost` 在 `useEffect` cleanup 里做了三件事：销毁实例、`scriptPromise = null`、`delete window.__LLMWikiPanel`。但插入的 `<script data-llm-wiki-panel="1">` **节点留在 `document.head` 里**。于是第二次打开时：

1. `:28 window.__LLMWikiPanel` —— 已被删，跳过；
2. `:29 scriptPromise` —— 已置 null，跳过；
3. `:31 existing` —— 找到上次那个 `<script>`，走 existing 分支；
4. `:33 existing.addEventListener("load", ...)` —— **但 load 早已发生，浏览器不会补发**。

Promise 永不 settle → `api.mount()` 永不执行 → 容器里空无一物。

改法两处：

- cleanup 只销毁本次实例，**不再清 `scriptPromise` 与 `window.__LLMWikiPanel`** —— 它们是「模块已加载」的状态，与单个面板实例的生命周期无关。
- `loadPanelScript()` 的 load 回调给节点打 `dataset.llmWikiLoaded = "1"`；existing 分支见到该标记就直接 resolve，不再挂监听。

顺带修好两个相关缺陷：

- 加载失败时把 `scriptPromise` 复位（`scriptPromise.catch(() => { scriptPromise = null; })`），否则一个 rejected promise 会永久缓存错误、重试永远失败；
- 加载失败时移除那个死 `<script>` 节点，否则后续 existing 分支会拿到一个永不 load 的节点。

### 验证

用临时探针（Node + vm + 极简假 DOM，模拟真实浏览器「已 load 的 script 不会补发 load」语义）验证，18 项断言全过，跑完即删：首次打开 mount、关掉再开仍 mount、反复开关 3 次每次都 mount、`<script>` 始终只有 1 个、两个实例可同时挂载、加载失败后能重试成功。

## 0.12.2 — 2026-10-30

**修掉一个真 bug**：桌面版启动时管理面板根本没注册上，设置页空白。

### 修复：webServer 在 apply() 时还没挂载，面板路由永不注册

日志只有一行线索：

```
[dsh-llm-wiki] apply() vault=... rules=true preview=true pipeline=true
[dsh-llm-wiki] panel skipped: webServer service unavailable
```

根因是 `plugin/dsh-llm-wiki.mjs` 的静态注入只有 `["systemPrompt"]`，所以 `apply()` 在 `webServer` 之前就跑了；而原代码在 `apply()` 里**同步取一次**，取不到就走 skipped 分支并 `return () => {}`——**永不重试**。桌面版启动顺序里 `webServer` 常晚于本插件，于是面板恒不可用。

历史日志里偶尔成功过，那是市场热挂载了第二份插件、时序恰好赶上的巧合；同一时间日志紧跟着 `client-modules: package dsh-llm-wiki resolves from multiple active Loader sources`（双来源冲突）。冲突修掉后，时序问题才暴露出来。

改法（生态同一写法，见 `@deepseek-ai/dsh-client-modules:570`、`dsh-web-app:155`、`@lemoncat7/dsh-knowledge:417`）：

- 用 `ctx.inject(["webServer"], registerPanel)` 等服务就绪后回调，而不是在 `apply()` 里取一次。
- **不**把 `"webServer"` 写进静态 `inject` 数组：该服务在非 web 平台可能根本不存在，写进去会让整个插件（含提示词注入）都不激活。`ctx.inject` 是可选依赖语义，服务永不出现时回调不执行，插件其余部分照常工作。
- 无 `ctx.inject` 的老版本 Cordis 退回同步路径；两者都没有时只打一行日志，不影响插件激活。

### 验证

`node --check` 通过。探针 `.probe-inject.mjs` 13 项全过，覆盖：apply() 不抛异常、`ctx.inject` 只调一次且依赖为 `["webServer"]`、webServer 延迟出现后仍注册成功、延迟注册后 `/api/state` 真能返回 200、启动即就绪时立即注册、无 `ctx.inject` 时走同步回退、缺 webServer 不影响插件激活、静态 inject 未含 webServer、路由注册抛错被内部吞掉（不炸整个插件）。

## 0.12.1 — 2026-10-30

管理面板的界面优化。**修掉一个真 bug**：样式在 slot 里根本没加载。

### 修复：slot 模式下界面是无样式渲染

`web/panel.css` 只被降级页 `web/panel.html` 的 `<link>` 引用；而设置页走 `lib/client.js` 动态插 `<script src="/llm-wiki-panel/panel.js">`，`panel.js` 自身不注入样式。结果是**在 DSH 里看到的其实是浏览器默认样式**，只有单独打开降级页才好看。

- 样式改为内建进 `web/panel.js`（`var STYLE` + `ensureStyle()`，首次 `mount()` 时插一个 `<style data-llm-wiki="1">`，已存在则跳过，失败静默不影响功能）。两个入口自动一致，不会再出现「一处有一处没有」。
- 删除 `web/panel.css`，`web/panel.html` 去掉 `<link>`。`/panel.css` 路由保留但返回空注释，避免旧引用 404。

### 视觉

- **跟随 DSH 主题令牌**：三级回退 `--dsw-alias-*` → 主题底层变量（`--foreground` / `--card` / `--muted` / `--border` / `--primary` / `--radius`）→ 自带兜底色值。全部声明在 `.llmwiki-panel` 作用域内，不污染宿主。
- **卡片式分组 + 组内紧凑表格**：每张表包一张卡片（图标 + 标题 + 右侧提示 + 内容），配置页拆成「配置项 / 层 / 漂移」三张卡，漂移卡带警示色。
- **内联 SVG 图标**（12 个，14px 线性，全部常量）：搜索、刷新、齿轮、日历、时钟、播放、勾、警示、锁、队列、电源、终端。
- **标签页改成分段控件**：圆角容器 + `is-active` 白底阴影，取代下划线。
- **状态胶囊改圆点 + 文字**：状态点 7px，运行中呼吸动画，三态 运行中 / 有锁 / 空闲。
- **趋势条重做**：6px 圆角条 + 进度，Δ 用等宽字体并按正负着色。
- **紧凑模式（窄宽度）表格降级为竖向键值卡**：`table/tbody/tr/td` 块化、`thead` 隐藏、`td::before { content: attr(data-label) }` 显示字段名。为此 `table()` 给每个 `td` 写了 `data-label`。
- 字号 / 间距 / 圆角统一：面板 13px、行高 1.55，标题 15px/650，表头 11.5px/600，卡片内距 10–14px，圆角由 `--radius` 派生三档。
- 无障碍：`:focus-visible` 描边、`aria-hidden` 图标、`prefers-reduced-motion` 关动画、`::selection` 配色。

### 顺带修掉

- 计划任务表缺「状态」列的表头（原来传了空字符串）→ 补 `任务 / 状态 / 计划 / 上次运行 / 结果 / 下次运行 / 操作`，`DICT` 增 `state` 中英词条。
- `log.md` 摘要过长会把表格撑坏 → 超过 150 字符截断加省略号。
- `ensureStyle` 用 `setAttribute` 而非 `dataset`，并兼容 `document.head` 缺失的宿主。

### 验证

- 渲染探针 31 项全过（假 DOM 跑 `mount()`）：样式注入与令牌存在、卡片与卡片头、分段控件三标签、五个运行按钮且都带图标、配置四键、`td[data-label]`、任务页与历史页内容、紧凑模式仍渲染表格、`destroy()` 清空。
- 真实 DSH：`/llm-wiki-panel/` 200、`/api/state` 返回真实 5 任务 / 3 条健康记录 / 40 条日志；`/panel.js` 已带新样式。
- Headless Chrome 截图三页（配置 / 任务 / 历史）+ 380px 窄栏紧凑模式，逐张核对布局无溢出、无裁切。

## 0.12.0 — 2026-10-29

新增**图形管理面板**：在 DSH 里直接打开，看配置项 / 计划任务 / 运行历史，一键跑管线，改完提示重启。

### 面板本体

- 新增客户端半边 `lib/client.js`：`window.__ModuleLoader__.load()` 注册 `settings.section`（设置页「LLM-Wiki」分区；当时另带一个 `sidebar.right.pane.tab` 座位，0.12.4 已移除）。不引入任何构建步骤，手写 bundle 即可。
- 新增两端共用的界面 `web/panel.js`（+ `web/panel.html`）：`window.__LLMWikiPanel.mount(root, {base, locale, compact})`。slot 组件与降级页用的是同一份代码，不写两遍。所有文本走 `textContent`，不拼 HTML；深浅色随 `prefers-color-scheme`。
- 新增 Host 半边 `plugin/panel/server.mjs`：`ctx.webServer.register({ kind: "prefix", path: "/llm-wiki-panel" })` 提供降级页、静态资源与 `/api/*`。不用 Typert RPC——那需要 `@Remote` 装饰器 + 代码生成，与「零依赖零构建」冲突。
- 座位组件包了 error boundary 且 render 里再 try/catch：slot 组件抛错会把整块座位打白（设置页会整页白屏），这是生态里踩过的坑。

### 三张表

- **配置项**：只改插件 config 四项（`vault` / `previewOrder` / `rulesOrder` / `mainAgentOnly`），管线调优参数只读。带类型校验（两个 order 必须整数、`vault` 不能为空），写入前留 `.bak-panel-<时间戳>` 兜底。
- **计划任务**：只读状态 + 启用/停用 + 改触发时刻（`Enable-/Disable-ScheduledTask`、`New-ScheduledTaskTrigger` + `Register-ScheduledTask -Force`，保留原 `DaysOfWeek` / Actions / Settings / Description）。非 Windows 一律只读展示，不报错。
- **运行历史**：解析 `log.md` 条目，同时读 `~/.dsh/llm-wiki/reports/health/health-YYYY-MM.csv` 做趋势——每行带 `pages` / `compiled` / `stale` / `lintIssues` / `syncPages` / `probeHit` 及与上一行的 Δ 环比。
- 顶部共用搜索框过滤三张表；五个运行按钮（全量 `--all` / 检查 `--lint` / 重建索引 `--index` / 同步记忆 `--sync` / 体检 `pipeline-health`）；有活锁时多出「排队」与「强制解锁」。

### 配置写入只认一处

- 只写 profile 的 `cordis.patch.yml`（真源），`$DSH_HOME/cordis.patch.yml` 等其它层只展示「漂移」但不动。`.cmd` 里残留的旧 vault 路径属漂移，不是 bug。写完提示「需重启 DSH 生效」。
- 决策与代价记在 `docs/adr/0001-panel-as-client-plugin.md`、`0002-config-write-target.md`；项目词汇记在 `GLOSSARY.md`。

### 管线互斥锁（`scripts/pipeline-lock.mjs`，新增）

- 后台进程 + 全局锁 `~/.dsh/llm-wiki/.pipeline.lock`（pid / 命令 / 开始时间），`writeFileSync(..., {flag:"wx"})` 独占创建，EEXIST 时重读判陈旧后重试一次。
- **锁逻辑放进 `llm-wiki-pipeline.mjs` 内部**，计划任务与面板共用同一把锁：`main()` 改名 `body()`，新 `main()` 负责抢锁、排队（`--queue`）或直接放行（`--no-lock`）；抢不到打印持锁者信息并以 `75`（EX_TEMPFAIL）退出；成功则 `finally` 释放并 `drainQueue()` 拉起排队中的下一条。
- 陈旧锁靠 `process.kill(pid, 0)` 存活检查清理（`EPERM` 也算活）。
- **面板不自己抢锁**，只做「有活锁就 409」的预检——否则父进程持锁会让子进程必然拿到 EEXIST 而以 75 退出。体检脚本（`pipeline-health.mjs`）不自己加锁，由面板代管。

### 验证

- 端口层 11 项：`GET /`、`/panel.js`、`/panel.css`（现返回空注释以兼容旧引用）、`/api/state`、五个 runCommand、四个 configKey、未知键 400、未知任务 400、未知路由 404、坏 JSON 500。
- 隔离 `DSH_HOME` + 临时 profile patch 14 项：改 vault 只动一行、新增键落在 config 块内、`mainAgentOnly: false`、非整数 order 报错、空 vault 报错、重复写同值不产生第二行、占锁时 `/api/run` 409 且 reason 含 pid 与时长、占锁时排队 position=1、真跑 `--lint` exit=0 且跑完锁已释放、`/api/unlock` 200。
- 客户端 7 项：bundle id、`inject`、座位注册形状、`slots.inject` 包裹、组件能渲染不抛。
- 渲染 15 项：用极简假 DOM 跑 `mount()`，三张表都能渲染，搜索框可过滤，`destroy()` 清空容器。
- 真实浏览器：Chrome 打开降级页，标题/状态胶囊/五个运行按钮/三张表/漂移表全部正确渲染。

## 0.11.2 — 2026-10-29

发版脚本收尾：`scripts/release.ps1` 不再把成功报成失败，也不再受中文编码与 `cmd` 元字符影响。

### `scripts/release.ps1`：假失败（成功却 exit 1）

- 根因：`git push` / `git tag` 的进度本来就走 stderr，而 Windows PowerShell 5.1 在 `$ErrorActionPreference='Stop'` 下把原生 stderr 当成终止性错误收进 ErrorRecord。于是 push 成功、Release 也建好了，脚本仍以非零码收场。
- 改法：`Invoke-Native` 改用 `System.Diagnostics.Process` 分别重定向 stdout / stderr / stdin，异步读取两条流规避缓冲区互等，只看 `ExitCode` 判成败；stderr 不再经过 PowerShell 的错误流。新增 `Invoke-NativeChecked` 统一「非零即抛」。
- 附带修掉两个只在 Windows 上出现的坑：① 旧实现把命令写进临时 `.cmd` 交给 `cmd /c`，`%` 会被当变量展开（`100% done` → `100 left`）；② 旧实现对含引号的参数直接抛错。新的 `ConvertTo-CommandLineArg` 按 Windows 命令行规则转义，`%`、内嵌双引号、CJK、尾部反斜杠均可原样传递。
- 幂等：重复执行同一版本时，`git commit` 在没有可提交内容时会以 1 退出——先用 `git diff --cached` 判断暂存区，空则跳过提交并复用 HEAD；同一 tag 的 Release 已存在时改走 `PATCH` 更新正文，不再被 422 打断。
- 脚本本身改为 **UTF-8 with BOM**：PowerShell 5.1 读无 BOM 的 `.ps1` 会按 ANSI 解码，中文注释把字节吃掉后解析器错位，报「表达式或语句中包含意外的标记」。

### 验证

- 13 项包装函数回归：stderr 与 exit 0 并存、非零码仍被识别、UTF-8 输出、stdin 透传、`%`、内嵌引号、CJK 参数、尾部反斜杠、`Invoke-NativeChecked` 抛异常。
- 端到端夹具：临时裸仓库上跑 add / commit（中文信息）/ tag / push，`push` 成功信息走 stderr 且 `ExitCode=0`，远端确实收到 `refs/heads/main` 与 `refs/tags/v9.9.9`；对不存在的分支 push 仍按 exit 1 抛错。
- `-DryRun` 全流程通过：版本一致性、`node --check`、`install.ps1` 语法、密钥/路径泄漏扫描、画像评测 13/13、检索评测 6/6。
- 幂等回归 4 例：干净树重复执行只跳过提交并成功打 tag；有改动时正常提交一次；发版提交后重跑仍跳过、提交数不增；文件内容变化仍被识别为需提交。

## 0.11.1 — 2026-10-27

本轮源于「开启自动任务后跑起来才发现」的几处损坏：计划任务真的触发后，管线在外置编辑器（Obsidian 开了 `update-time-on-edit`）与自身写日志的共同作用下把 `log.md` 和页面 frontmatter 写坏，健康快照又拿陈旧数字冒充当天状态。

### 管线：`log.md` 结构损坏

- `appendLog` 原实现把新条目插到字节 0，于是条目堆在 frontmatter 之上；Obsidian 每次回写又补一层 `---created/updated---`，两边叠加把日志写成 18 个 frontmatter 块、标题沉到第 93 行。
- 新增 `normalizeLog(text)`：合并全部 frontmatter 块（`updated` 取最大值）、剥掉重复标题、正文保持新→旧；`appendLog` 改为输出固定形状 `frontmatter → 空行 → "# LLM-Wiki 操作日志" → 空行 → 新条目 → 旧条目`，写入点显式落在标题之下。
- frontmatter 只认「`---` + 纯 `key: value` 行 + `---` 收尾」的块，避免把正文里的横线误当分隔符。
- 实测：连续两次写日志 `lines=33 sep=2 headingAt=6`，再跑 `--all` 仍为 `sep=2 headingAt=6`，结构稳定。

### 管线：frontmatter YAML 损坏

- `setFmField` 原实现只替换首行：字段原本是块式写法时会残留孤儿的缩进续行，产出 `generated: { by: ..., at: ... }` 后面再跟两行 `  by:` / `  at:` 的非法 YAML，`description` 等字段也曾被同样方式截断。改为按行定位并吃掉全部缩进续行。
- 新增 `isoAt(v)` 统一时间格式，修掉 `2026-10-27T19:52` + `T00:00:00Z` 拼出来的双 T（`2026-10-27T19:52T00:00:00Z`）。
- 新增幂等清扫 `normalizeFmArtifacts(content)`：在 `--okf` 末尾修掉历史遗留的双 T 与游离映射子行。

### 管线：`--okf` 不再假更新

- `parseFm` 原实现只匹配单行 `key: value`，块式的 `generated:` / `verified:` 一律读成空串，导致 `if (!fm.generated)` 恒真、每次 `--okf` 都全量重写。重写为「值为空时把缩进子行折成与内联同形状的对象」。
- 实测：首次 `{"aligned":17,"updated":17}`（清掉 17 页历史伤痕），第二次 `{"aligned":0,"updated":0}`，幂等成立。

### 健康快照：`lintIssues` 不再取陈旧值

- 原实现用 `matchAll` 取全文第一个 `lint:N问题` 命中。条目按新→旧排列时它恰好是最新一条，但只要最新那次运行不带 lint 段（例如只跑 `--sync`），就会把上一次的旧数字当成今天的状态。改为显式只看最新一条 `## [` 条目，取不到写 `-1`（未知）。
- 实测：最新条目为 `## [2026-10-27] pipeline | sync:0条` 时 CSV 写 `-1`；跑完 `--all` 回到 `0`。

### 安装脚本：计划任务包装 `.cmd` 编码

- `install.ps1` 生成 `~/.dsh/bin/*.cmd` 时用 `-Encoding ascii`，中文 vault 路径被写成 `?`，任务触发后用错误的 `LLM_WIKI_VAULT` 跑在不存在目录上。改为 UTF-8 无 BOM + CRLF（`[IO.File]::WriteAllText` + `UTF8Encoding($false)`），并在 `@echo off` 之后插入 `chcp 65001 >nul` 让 cmd.exe 按 UTF-8 读文件体。
- 实测机上的五个包装脚本均为无 BOM，`set LLM_WIKI_VAULT=D:/学习/AI知识库/LLM-Wiki` 中文完整。

### 发布脚本：Release 目标仓库从 origin 推导

- `scripts/release.ps1` 原先把 `api.github.com/repos/iwtown/dsh-llm-wiki` 写死，在 fork 上执行会把 Release 打到上游仓库（自己有 push 权时甚至真的建成功）。改为从 `git remote get-url origin` 解析 `owner/repo`，解析失败直接报错退出。
- 顺带在推送前打印 `==> release target <slug>`，让发版人一眼确认目标仓库。

## 0.11.0 — 2026-10-26

### 安装方式：改为本地仓库 link（破坏性变更）

- profile `package.json` 里注册 `"dsh-llm-wiki": "link:<本仓库>"` 并加入 `dsh.profile.bundles`；插件入口由本包自带的 `cordis.patch.yml` 提供，profile 的 `cordis.patch.yml` **只写配置覆盖**（`id: llm-wiki` + `config.vault`），不再写 `insert` 块。
- 收益：改仓库代码 → 重启 DSH 即生效，不必再向 `~/.dsh/profiles/<profile>/` 或 `~/.dsh/bin` 拷文件。
- 安装脚本自动清理旧版手工 `- insert:` 块（匹配 `name: ./dsh-llm-wiki.mjs` 与 `# dsh-llm-wiki` 注释），清理前备份原 patch。
- 保留旧路径：`install.sh --copy-mode` / `install.ps1 -CopyMode`。

### 插件

- 管线脚本解析改为**包内优先**：从 `import.meta.url` 解析 `<包>/scripts/llm-wiki-pipeline.mjs`，只有它不存在才回退 `$DSH_HOME/bin/llm-wiki-pipeline.mjs`。link 安装下仓库里的脚本改动立即生效。
- 默认 vault 按平台收敛；报告目录默认值不再硬编码 `D:\DB\...`。

### 脚本

- `pipeline-health.mjs`：检索脚本路径同样改为**本脚本同目录优先**，不再固定找 `~/.dsh/bin/wiki-retrieval.mjs`（link 安装下那里根本没有，导致 6 条召回探针全部落空、`probeHit` 恒为 0/6、误报返回码 2）。
- `pipeline-health.mjs`：召回探针改为**从本 vault 页面的 `title` 按固定步长抽样**（最多 6 条），用它做查询、期望命中同名页；换知识库也有意义，不再写死某个库里才存在的页面名。空 vault 退回两条内置样例。
- `stale-review.mjs` / `wiki-router.mjs`：清单与路由输出里的命令改用脚本自身所在目录拼接，去掉写死的 `C:\Users\wtown\.dsh\bin\`。

### 安装脚本

- `install.ps1` 重写：新增 `-NoInstall`（只改配置不跑 pnpm）、`-CopyMode`（旧手工部署），默认 link 模式；patch 写入统一走 .NET UTF-8（无 BOM），避免 PowerShell 5.1 的 `-Encoding utf8` 产生 BOM 与代码页乱码；中文 vault 路径实测无损坏。
- `install.sh` 重写：link 模式优先，新增 `--no-install` / `--copy-mode`；已存在 `id: llm-wiki` 时只更新 `vault` 一行，其余保持原样；vault 值经临时文件传给 node，绕开 Git-Bash/MSYS 对 `/x/y` 形式路径的自动改写。
- 两个脚本均**幂等**：重复运行不重复追加、不抖动文件；已在临时 HOME 下实测（首次清理旧块 / 二次无变更 / 第三次改 vault / 中文路径）。

### 文档

- README：组件表改为 link 安装的落点，安装章节拆为 A(link，推荐) / B(bundle) / C(手工拷贝) 三种方式，命令示例去掉 `~/.dsh/bin` 硬编码。
- `LLM_WIKI_REPORTS` 默认值更正为 `~/.dsh/llm-wiki/reports`。

## 0.10.7 — 2026-10-24

- 预算淘汰建议：候选超出 2048B 目标时，输出“需释放多少 B”+低价值条目建议（受保护规则不列入），只提案不自动删。
- 无低价值可淘汰时明确提示需人工合并/降重要性/删除。
- 修复淘汰建议误把核心规则（token/代理/模型）列为候选的问题。

## 0.10.6 — 2026-10-24

- schema 关键词补充：候选方案/对比/技术栈/优缺点（work.approach）。
- 配合“新领域先给 2 个候选方案对比”偏好。

## 0.10.5 — 2026-10-24

- schema 关键词补充：调研/已有方案/评估（work.approach）、目标/验收/瞎猜（work.plan_first）、边界/前提/适用范围（comm.answer_first）。
- 配合用户画像新增偏好：先调研评估、目标导向先验证、结论标边界。

## 0.10.4 — 2026-10-24

- 修复：候选槽位在证据多数为 unclassified 时不回退计算，导致已落槽规则显示 unclassified。
- 过滤动作叙述型噪声（否定/指出/要求/说明…），不再当作规则候选。
- 评测新增 noise-narrative 用例（13 用例）。

## 0.10.3 — 2026-10-24

- 新增 eval-retrieval.mjs：6 条 fixture 查询跑 BM25 检索，检查 top-3 命中，无网络/无 mnemon。
- GitHub Actions 增加检索评测步骤，强制 100%。
- release.ps1 改为双门禁：画像决策 12/12 + 检索 6/6。
- README 组件表补充检索评测。

## 0.10.2 — 2026-10-24

- 画像决策评测从 8 扩到 **12 用例**：更新变体、unclassified、ORPHAN、单会话阈值。
- 修复 NOOP 过宽：新增“新条件”识别（审核/之后/至少/必须…），带条件的细化不再被判覆盖。
- README 增加 CI badge。

## 0.10.1 — 2026-10-24

- 新增 GitHub Actions `eval-profile`：push/PR 自动跑语法检查 + 8 用例决策评测，强制 100%。
- `release.ps1` 增加本地门禁：eval 未 100% 直接拒绝发版。
- RELEASE.md 增加 CI 门禁检查项。

## 0.10.0 — 2026-10-24

### 新增
- 画像结构化本体 profile-schema.json（6 域 × 2 = 12 槽，含允许值/正反例/更新规则/关键词）。
- 抽取端落槽 + 引文保真校验：quote 必须是用户原话子串，否则丢弃（实测 17.5%）。
- 决策标签 ADD/UPDATE/NOOP/CONFLICT/EXPIRE/ORPHAN；冲突分 temporal/factual/contextual，支持反义词对识别。
- 决策引擎评测 eval-profile.mjs：8 个隔离用例（时间更新/冲突/覆盖/弃权/过期/槽位），当前 8/8。
- 安装脚本同步 profile-schema.json 到 bin。

### 修复
- NOOP 过宽导致真更新被误杀（同槽同对象即判覆盖）。
- 反义冲突（免费 vs 付费）被误判为 UPDATE。
- 旧正则路径候选缺 decision 字段。

## 0.9.2 — 2026-10-24

- 新增 `RELEASE.md` 发布清单与 `scripts/release.ps1`：校验版本/工作树/语法/密钥，打 tag、推送、用 CHANGELOG 段落创建 GitHub Release，并校验 latest。
- 修正此前「tag 已推、Releases 仍停在 v0.2.0」的发布缺口（v0.9.0 / v0.9.1 的 Release 已补建）。

## 0.9.1 — 2026-10-24

- 新增异常告警：健康快照判定异常写 `reports/health/ALERT.md`，任务失败/告警时弹窗；正常时自动消警。
- 新增周报：`weekly-summary.mjs`，周日 09:50 生成 `reports/weekly/weekly-<date>.md` 与 `LATEST.md`。
- 安装脚本增加第 5 个任务与告警包装；`pipeline-health.mjs` 路径全部可用环境变量覆盖（无个人路径）。

## 0.9.0 — 2026-10-24

### 新增
- 检索路由 `wiki-router.mjs`（wiki/session/live/docs/hot 五路分流）与融合检索 `wiki-retrieval.mjs`（BM25 + mnemon RRF）。
- 画像 v3：`profile-extract.mjs`（3 角度抽取 + 行为事件）→ `profile-distill.mjs`（证据复核、预算分层、候选/diff）。
- 自动化三件套：`session-compile-candidates.mjs`（编译候选）、`stale-review.mjs`（保鲜复核）、`pipeline-health.mjs`（健康 CSV + 月报 + 探针）。
- 插件：大会话结束写编译提示标记，下一轮注入一次提示。
- 同步分级：`发现` 仅排除会话复盘/批量导入，排错/验证/其他纳入；`LLM_WIKI_SYNC_DISCOVERY` 可切换。
- Windows 安装脚本新增 9 个脚本与 4 个计划任务；管线日志与健康快照纳入每日任务。

### 修复
- `--compile-patterns` 跳过 archived 页；`--prune-memory` 只清理 import 且忽略 #小节；切块上限 24。

## 0.8.0 — 2026-10-22

- DSH 桌面版适配：zstd 多帧解压、`mnemon.exe` 解析、embedding 注入、Windows 计划任务。
- 偏好蒸馏 P0（只读）与周日 09:00 任务；OKF v0.2 字段补齐。
