# Changelog

## 0.13.5 — 2026-11-08

**`/impeccable polish`：0.13.4 把面板从「说谎」救回「说实话」，这一轮修它说实话时的口音。**

0.13.4 之后跑了 impeccable 的精修流程（建立系统 → 收集证据 → 分诊 → 精修 → 验证）。真 Chrome 截图 + 逐条代码考古，抓到的都不是新功能，是**已经存在但没人管**的小毛病。

### 死代码两处，一处删一处用起来

- `fmtTime()` 在 `web/panel.js` 里**只有定义、零调用**。输出面板只说「跑了什么」「退出码」，不说「什么时候开始的」——长时间运行（全量重建、视频队列）里这条信息是刚需。改为在 `.lw-foot-head` 显示 `2026-11-08 21:30:00`，右侧紧跟退出码。
- `--lw-r-lg` 与 `--lw-shadow-2` 两个令牌**定义了但零引用**，删掉。

### 对比度：`--lw-fg-3` 实测不到 AA

这一档被 `.lw-sub` / `.lw-card-hint` / `.lw-form-desc` / `.lw-empty` / `.lw-stat-k` / `.lw-name-sub` 这些 11–12px 小字大量使用，而回退色 `#7d8590` 在白底只有 **3.73:1**（`--lw-bg-2` 上 3.45、hover 上 3.29），低于 WCAG AA 的 4.5:1。

- 浅色回退改 `#667085`：实测 **4.97:1**（白）/ **4.60:1**（`--lw-bg-2`）。
- 深色回退 `#7d8590` → `#8b949e`：`--lw-bg-2` 上 **5.26:1**（原 4.34）。
- DSH 主题变量存在时仍以 `--dsw-alias-label-tertiary` 为准，这里只修独立页面的回退值。

### 任务表里混着两种日期格式

`tasks.mjs` 的 `[string]$i.LastRunTime` 走系统区域设置，中文 Windows 上是 `10/31/2026 02:50:50`，而面板其它日期都是 `2026-11-07`。同一张表里两种格式，读的人要先猜哪一段是月。新增 `fmtLocal()` 在前端归一为 `2026-10-31 02:50`；解析失败原样返回，不吞信息。`1/1/1 0:00:00` 这类哨兵值不匹配（年份要 4 位），照旧透传。

### 三个交互 bug

- **搜索框在层表上永远搜不到东西**：`renderConfig` 的层表过滤写 `matches(r.join(" "))`，而 `r` 里有两个 DOM 节点 → `join` 出来是 `[object HTMLSpanElement]`。按状态文字（「不存在」「只读」）搜必然零命中。改成先取 `textContent` 再 join。
- **搜索无匹配时整张卡消失**：`renderEmbed` / `renderStorage` 开头 `if (!matches(...)) return;`——用户会以为卡片被删了。改为留一张「已按搜索过滤」的空态。
- **「?」展开时变成第二个蓝色主按钮**：同屏已有「全量」实心蓝，两个主按钮互相抵消。改用新增的 `.lw-btn.is-on`（品牌色描边 + 10% 淡底），表达「这个开关开着」而不抢主次。

### 反馈缺失

- **刷新毫无反馈**：点刷新按钮后页面在旧数据上静默等几秒。现在顶栏胶囊转成「加载中…」+ 蓝色脉冲，刷新按钮自身旋转（`@keyframes lw-spin`）并禁用，避免连点发多次请求。
- **搜索框 `Esc` 清空**：搜索是唯一「输入即过滤」的地方，打完字想回全量视图此前只能一个个删字符。

### 紧凑模式（<560px）

- 触控目标太薄：桌面档 `.lw-btn` 28px / `.lw-btn-sm` 24px，在窄屏（多半是触屏或半屏窗口）手指点不准。紧凑档统一抬到 32/28px，搜索框 34px，tab 32px。
- 「计划」列里「每日 08:50」与「改」按钮 gap 只有 6px、文字 span 无内边距，截图上是糊成一串。给非首位按钮补 2px 左外边距，把「值」与「动作」分开。

### 其它精度

- 趋势表条形与数字间距 8px → 10px（数字此前像条形的一部分）。
- 历史页「其它指标」列是次要信息却用正文色，改 `--lw-fg-3` 的 `.lw-note`。

### 测试

`test/panel-e2e.mjs` 从 40 项扩到 **44 项**，新增：上次运行时间已归一为 ISO 风格、「?」展开时不抢主按钮的实心蓝、搜索无匹配时卡片仍占位、输出面板显示运行开始时间。

截图验收（`node test/shot.mjs 1200 420 --tab=config|tasks|history`，另加 `--confirm`）：四档全部零横向溢出，`w420` 真容器宽度下紧凑模式正确触发。

## 0.13.4 — 2026-11-08

**面板此前在骗人：五个任务全停时顶栏还是绿灯。这次让它说真话。**

一次 `/impeccable critique` 给面板打了 **17/40**，最差三项是「系统状态可见性 1 分」「错误预防 1 分」「帮助与文档 1 分」。逐条追下去，发现不是审美问题，是三处真在骗人的地方。

### 修掉的三处「面板在骗人」

**1）顶栏绿灯与「五个任务全停」同时成立。** `applyState()` 只看 `run` 与 `lock`——没在跑、没被锁就是 `is-ok`「● 空闲」。实测五个计划任务全 `Disabled`，管线最后一次**任务触发**是 2026-10-31（距今 8 天），用户看到的是「一切正常」。

新增独立的**健康三态横幅**（`ok` / `warn` / `bad`），与顶栏胶囊并存——胶囊说的是「面板这一秒忙不忙」，横幅说的是「知识库健不健康」，两个语义不能合并。判据按硬度排序：

| 判据 | 级别 |
|---|---|
| 计划任务被停用 | `bad` |
| 计划任务未注册 | `warn` |
| 最新日志距今 ≥ 7 天 / ≥ 3 天 | `bad` / `warn` |
| 最新快照 `lintIssues > 0` | `warn` |
| 探针命中 < 100% | `warn` |
| 向量覆盖率 < 100% | `warn` |

横幅带「为什么？」展开依据。**口径写清楚**：面板无法逐条区分「任务触发」与「手工运行」，实测 11-07 有 19 条日志全是手工跑 `--compact`/`--sync` 留下的，所以这条信号偏保守，详情里明写「依据: log.md &lt;日期&gt;」。

**2）已停用任务照样显示未来的「下次运行」。** `Get-ScheduledTaskInfo` 对 `Disabled` 任务仍返回 `NextRunTime`，`tasks.mjs` 原样透出 → 面板写「下次运行 11/09」，而它永远不会跑。改为先算 `enabled` 常量，`nextRun` 只在启用时透出；任务页对停用行显示「已停用」并整行灰化（`.is-off`）。

**3）「压实记忆库」点一下就直接删。** 它删 325 条软删条目 + VACUUM，不可逆，零确认。改为卡片内联二次确认（`role="alertdialog"` + 红色填充的「确认清除」+「取消」），`Esc` 可退。**不用 `window.confirm`**：嵌入式 webview 常被宿主拦截，拦了就是静默执行。清除凭据同样改这个模式。

顺带修掉 `web/panel.js` 里引用不存在的 `run.running`（`/api/state` 的 run 快照只有 `finished`）——压实期间按钮从不进 loading 态。

### 历史页开始吃 `facts`

`history.mjs` 早就解析出了结构化的 `facts`（`lint`/`sync`/`prune`/`compact`…），UI 里却 grep **0 命中**——整条摘要当 150 字纯文本塞一格，还给了一列 60 行全是 `pipeline` 的 `kind`。

- 列改为 `[日期, 指标, 其它指标]`，`kind` 列删掉（60 行恒定值不是信息，是占位置）。
- 「指标」列按 `compact/lint/sync/okf/prune` 渲染成胶囊组，`lint` 有问题数时转 warn 色。
- 「其它指标」列取 `facts` 里剩下的键（`index`/`usage`/`okf`/`compile`/`docs`/`dsh`…）。**这一列最初写成 `e.rest`，上线前截图才发现 60 行全是「—」**：`log.md` 的摘要全是 `key:value` 形式，`parseSummary()` 的 `rest` 因此恒为空。截图验收抓到的，假 DOM 探针抓不到（结构对、内容空）。
- 新增「只看异常」开关：异常行（lint > 0 / stale > 0 / prune 非 0）加底色，开关只留这些行。当前 60 条里 5 条。

### 修掉 30 行从未生效的死代码

`lib/client.js` 与 `web/panel.html` 都把 `compact: false` 写死，`.is-compact` 那套降级样式从未生效——420px 实测工具栏 6 个按钮被裁到只剩 5 个半，vault 行的「改」按钮被切出视口。

改为三态：调用方传布尔就听它；未传则用 `ResizeObserver` 观察容器宽度，`< 560px` 自动进紧凑模式。

### 键盘与读屏

- `role="tablist"` / `role="tab"` / `aria-selected`；`th` 加 `scope="col"`；运行栏 `role="group"` + `aria-label`；搜索框补 `aria-label`。
- **焦点保持**：`renderBody()` 全量重建会把焦点打回 `<body>`。给会触发重绘的控件打稳定键 `data-fk`（如 `cfg:vault:edit`），重绘前记住、重绘后找回。取消编辑也回原行。
- **`Esc`** 退出编辑态 / 关闭二次确认。
- **命令说明**：六个命令的区别此前只在 `title`（悬停才见，触屏与键盘拿不到）。运行栏加「?」开关，展开可见说明表。

### 同屏只留一个主按钮

配置页曾同时出现三个蓝色 `is-primary`（全量 / 回填向量 / 压实记忆库），互相抵消。改为回填向量仅 `pct < 100` 时为主、压实仅 `needCompact` 时为主、健康横幅的「去任务页」用普通按钮。

### 其它

- 补 `--lw-fg-4` 令牌（`.lw-table-wrap` 滚动条 hover 引用了它却从未定义，静默失效）。
- 补 `spark` 图标（向量化卡片一直传 `"spark"` 但 `ICONS` 里没有，渲染出空 `<svg>`，表现为标题前凭空留白）。
- 新增 `docs/adr/0006-panel-truthfulness.md`。
- 新增 `test/panel-e2e.mjs`（假 DOM 真跑 `panel.js`，40 项断言），覆盖「点压实不发请求」「Esc 后仍未发请求」「取消后焦点回到该行」。
- 新增 `test/preview.html` + `test/shot.mjs`：真 Chrome 在 1200/900/420 三档截真图并输出布局 metrics（`vw`/`rootWidth`/`compact`/`docScrollWidth`/溢出元素），`npm test` 之外的肉眼验收手段。截图抓到了两个假 DOM 探针抓不到的问题：历史页「摘要」列 60 行全是「—」，以及紧凑模式下状态胶囊被 grid 的 stretch 拉成整行色带（`.lw-table td > .lw-chip{justify-self:start}`）。

## 0.13.3 — 2026-11-08

**记忆库 9 MB 的锅不在表格竖线上：新增压实，实测省 51%。**

### 现象与归因纠正

用户反馈「同步记忆时切分出的分片里有大量表格竖线（`|`），200 条记忆就占 9 MB」。

实测把前提否掉了。9.65 MB 的构成：

| 成分 | 占文件 |
|---|---|
| 空闲页（560 × 4096） | 24% |
| `edges` 六个索引 | 31% |
| 软删条目向量（325 条） | 5.1% |
| 活条目正文 | 2.4% |

222 条活记忆里竖线一共 846 个，占正文 0.63‰——全删光省不到 0.1%。真正的三个大头是：`forget` 只写 `deleted_at`、SQLite 从不回收空闲页、每条记忆平均挂 21 条 `edges` 而边上有六个索引。

### 新增 `--compact`

`scripts/llm-wiki-pipeline.mjs` 新增子命令，三步：删软删条目 → 删悬空边 → `mnemon gc --compact`（VACUUM 必须走官方入口，WAL 模式下直接发 `VACUUM` 会失败）。

副本库实测 `9,654,272 → 4,677,632` 字节（**−51.5%**），活条目 222 条一条没少，`integrity_check` = ok。

- `--compact` **不进 `--all`**，避免每日全量管线无条件改写 9 MB 库。
- `--sync` 结束后跑 `shouldAutoCompact()`：空闲页 ≥ 15% 或软删 ≥ 200 条才动手；`LLM_WIKI_COMPACT_AUTO=0` 关闭。
- 有损分支 `LLM_WIKI_COMPACT_PRUNE_EDGES=1` 会额外裁 `importance<4` 的 entity 边（再省 1.66 MB，累计 −69%），但召回实测掉 13%，**默认关闭**。

### 新增正文清洗 `cleanChunkText()`

切块时对表格做视觉扁平化：代码围栏内不动；`|---|` 分隔行整行删；以竖线开头的行把 `| a | b |` 转成 `a · b`；连续空行折叠；`（来源: …）` 锚点不碰。

真实 222 条活记忆实测：字符 `134,890 → 133,819`（−0.79%），竖线 `846 → 124`（−85%）。**省不出空间，但检索命中的片段不再是表格骨架。**

### 面板

- 新增「存储占用」卡片：库大小、空闲页占比、待清理条目数，加一个「压实记忆库」按钮；空闲页 < 5% 且无软删时按钮置灰显示「无需压实」。
- `RUN_COMMANDS` 加 `compact`（标签「压实记忆库」），走同一互斥锁。

### 验证

- `--compact` 端到端（真起面板路由、POST `/api/run {command:"compact"}`、轮询到结束）：`9.21 MB → 4.46 MB`、`freePct 23.7% → 0%`、`softDeleted 325 → 0`、exit 0。
- UI 探针 11 项：四张卡片标题、统计值 `9.21 MB / 23.7% / 325`、按钮可点、点击发 `/api/run`、干净库时置灰。
- 检索兼容性 A/B（6 个查询 × 原库 / 清洗后副本库）：每个查询都命中 5 条，`FAILS=0`；分片 100% 带 `（来源: …）` 锚点，`parseSourceRel` 仍能反解页面路径。
- 自动压实阈值探针 6 项：未压实库触发、压实后不再触发、库不存在返回 null、`LLM_WIKI_COMPACT_AUTO=0` 关闭、软删 210 条触发。

### 决策记录

`docs/adr/0005-memory-footprint.md`：清软删几乎无损（可召回集合 Jaccard 0.577），裁边额外掉 13%（0.516）；同库同查询连跑两次就有 56% 的差异，单次召回结果不能作判据。


## 0.13.2 — 2026-10-31

**修掉「改计划任务时间必报错」以及它背后的两个隐患。**

### 现象

在面板里点计划任务行的「改」，填新时刻后保存，弹出乱码提示并且时间没变：

```
�޷��Բ�����Description��ִ�в�����֤������Ϊ Null ��ա����ṩһ����Ϊ Null ��յĲ�����Ȼ�����Ը����
```

还原成正常中文是：**「无法对参数"Description"执行参数验证。参数为 Null 或空。请提供一个不为 Null 或空的参数，然后重试该操作。」**

### 根因 1：任务本来就没有 Description

五个任务是 `install.ps1` 用 `schtasks /Create` 建的（`install.ps1:310-318`），这条命令不接受描述，所以任务的 `Description` 一直是 `$null`。实测五个全是 NULL：

```
LLM-Wiki Pipeline :: Description=NULL
Profile Distill   :: Description=NULL
（其余三个同）
```

而 `setTaskTime()` 走的是 `Register-ScheduledTask ... -Description $t.Description`，该参数声明了 `[ValidateNotNullOrEmpty]`，把 `$null` 传进去就是参数绑定阶段直接失败，连任务都没碰到。

改法：`$desc=$t.Description; if([string]::IsNullOrWhiteSpace($desc)){ $desc='<MANAGED_TASKS 里的 desc>' }`，顺带把原本空白的描述补成有意义的中文（「每日全量管线 + 健康快照」等）。

### 根因 2：星期会随每次修改往后漂

`$t.Triggers[0].DaysOfWeek` 在 CIM 里是 **UInt16 位掩码**（周日=1、周一=2、周二=4 … 周六=64），不是「星期几的序号」。原代码把这个数字直接喂给 `New-ScheduledTaskTrigger -DaysOfWeek`，PS 会把它当枚举值，于是每次保存都往后挪一天。实测连改两次：`Mask=1 → Mask=2 → Mask=4`（周日 → 周一 → 周二），而任务本身是「每周日」。

改法：先把掩码按位展开成枚举名数组再传：

```powershell
$map=@(@{bit=1;name='Sunday'},@{bit=2;name='Monday'},...,@{bit=64;name='Saturday'})
$mask=0; foreach($g in $t.Triggers){ $mask=$mask -bor [int]$g.DaysOfWeek }
$days=@(); foreach($m in $map){ if($mask -band $m.bit){ $days+=$m.name } }
$nt=New-ScheduledTaskTrigger -Weekly -At $time -DaysOfWeek $days
```

位掩码 → 枚举名 → 新掩码的 round-trip 实测 `1→1`、`3→3`、`127→127`、`0→1`（空掩码兜底成周日）。

### 根因 3：中文报错变成乱码

`runPowerShell()` 把 `powershell.exe` 的输出按 `utf8` 解码，但 PS 5.1 默认按系统代码页（简体中文是 936/GBK）写管道，于是中文报错全变成 `�`。这既让原错误不可读，也让人无法判断到底哪里错。修法是在 `-EncodedCommand` 前缀里显式设 `[Console]::OutputEncoding` 与 `$OutputEncoding` 为 UTF-8。

顺带补上 `-Principal $t.Principal`：原代码没传，重注册时任务的登录身份会退回默认值；实测加上后 `UserId`/`LogonType`/`RunLevel` 三者都保持原样。

### 验证

真机跑 `setTaskTime()`（不是模拟）：daily 任务 `10:00→10:03`、weekly 任务 `09:00→09:08`、再 `09:08→09:11` 确认星期掩码始终为 `1`（周日）不再漂移；非法时间 `25:99` 被拒（`时间格式必须是 HH:mm`）；改完再停用/启用，`State` 正确；全部还原后五个任务 `State=Ready`、时间与 `DaysOfWeek` 与改前完全一致。中文报错也已可读：`ERR 找不到任何"TaskName"属性等于"NoSuchTaskXyz"的 MSFT_ScheduledTask 对象。请验证属性值，然后重试。`

### 遗留

`install.ps1` 用 `schtasks /Create` 建任务，仍不会写描述。本次是在面板侧兜底（首次改时间时补上），没有改安装脚本——`/TR` 引号与 `/F` 覆盖语义在 `schtasks` 上更稳，换成 `Register-ScheduledTask` 需要另测 Principal 与 Settings 的等价性。

## 0.13.1 — 2026-10-31

**修掉「点了回填向量，覆盖率几乎没动」的缺陷。**

### 现象

配好 `SF_API_KEY` 后点「回填向量」，面板显示回填完成（`exitCode: 0`），但覆盖率只从 0% 涨到 30%（101/341），用户以为失败了。

### 根因

`mnemon embed --all` **单轮最多处理 100 条**。实测：

```
{"failed":0,"model":"BAAI/bge-m3","status":"backfill_complete","succeeded":100}
```

exit 0、`status: backfill_complete`、`failed: 0` —— 一切看起来都是"全部完成"，但库里一共 341 条。连跑三次才是 `101 → 201 → …`。`mnemon embed --help` 里**没有**可调这个上限的参数（只有 `--all` / `--status` / `--model` / `--readonly` / `--data-dir` / `--store`），所以只能由调用方循环。

### 改法

`startBackfill()` 改为一轮一轮跑到收敛，而不是跑一次就结束：

- 每轮结束读一次 `readEmbedStatus()`，比对 `embedded` 是否比上一轮多；
- 没到 100% 且有进展 → 打印 `第 N 轮完成，覆盖 X / Y（Z%），继续…` 再跑下一轮；
- 到了 100% → `回填完成：X / Y（Z%）`；
- **一轮零新增** → 停止，打印 `第 N 轮没有新增向量（X / Y），停止回填`（防死循环：key 失效或接口全挂时不该无限重试）；
- 某轮非 0 退出 → 直接停，不再重试。

整个过程中只持一次锁（`panel embed --all`），不是在每轮之间放手，避免被管线插队。

界面同步：`/api/embed` 的 `backfill` 增加 `round` / `embedded` / `total`，回填按钮旁显示「第 N 轮 · M / T」；`embWhy` 补充说明「mnemon 每轮最多处理 100 条，面板会自动接着跑下一轮」。

### 验证

端到端跑真实回填（`POST /api/embed` + 每秒轮询 `GET /api/embed`）：

```
t=0s  coverage=60%  embedded=206/341  round=1
t=8s  coverage=88%  embedded=300/341  round=1
t=9s  coverage=88%  embedded=300/341  round=2   ← 自动进入第二轮
t=13s coverage=100% embedded=341/341  round=2  finished=true exit=0
```

日志尾部：`第 1 轮完成，覆盖 300 / 341（88%），继续…` → `回填完成：341 / 341（100%）`。

数据库直查确认，不是状态文件骗人：

```
insights(未删)=341  有向量=341  1024维(float32=4096字节)=341
```

顺带确认了单条路径也是通的（`mnemon embed <id>` → `{"dimension":1024,"status":"embedded"}`），此前 0% 的根因只是轮次上限，不是 key 或端点问题。

## 0.13.0 — 2026-10-31

**面板新增凭据管理与向量化状态，配置项改为表单式布局。**

### 新增 1：凭据管理（SF_API_KEY）

`SF_API_KEY` 是硅基流动的 key，仓库里四处脚本都按 `~/.dsh/.credentials.yaml` 的 `refs` 读它（`scripts/llm-wiki-pipeline.mjs:1015` 的记忆体向量化、`scripts/wiki-router.mjs:132` 的会话语义索引、`scripts/profile-extract.mjs:27` 与 `scripts/profile-distill.mjs:168` 的模型降级兜底）。此前只能手改文件，现在面板可以填。

它和原有四项配置的本质区别决定了实现方式（ADR-0004）：**只写不读**。

- `plugin/panel/secret.mjs`（新建）：`readSecretState()` 只返回 `{configured, hint, length}`，`hint` 形如 `sk-…8gOE0`（首三位 + 省略号 + 末四位；长度 ≤8 时全打码）。明文永远不出进程，也不进 `/api/state` 的 JSON。
- `writeSecret()` 落盘前**先打一次真实接口验证**：`POST https://api.siliconflow.cn/v1/embeddings`，模型 `BAAI/bge-m3`，`input:["ping"]`，只有 200 才写。失败时抛出的 error 带 `status` / `apiCode` / `apiMessage`，`message` 拼成 `HTTP 401 · code 30014 · Token is invalid.` 形式——面板原样显示它，不吞成「保存失败」。
- 断网时可勾选「跳过验证」直接落盘（否则用户在网络异常时完全无法配置）。
- `clearSecret()` 整行删除该键，而不是写空串；界面提示「向量检索将降级为关键词匹配」。
- 三个凭据接口（`GET/POST/DELETE /api/secret`）与 `POST /api/reveal` 都检查 `req.socket.remoteAddress` 是否回环，非回环 403。其余接口不限制（不含密级数据）。
- 保存后提示「下一次管线运行即生效（无需重启）」——四处脚本都是进程启动时 `readFileSync` 读凭据文件，面板 `spawn` 的管线是新进程。这一点与配置项不同，界面上分开提示。

### 新增 2：向量化状态与回填

存了 key 不等于有向量：本机 341 条记忆的 `embedding` 全是 NULL（`mnemon embed --status` 报 `coverage: 0%`），不显式提示就只会让用户以为没生效。

- `plugin/panel/embed.mjs`（新建）：复刻管线的三件套并保持完全一致 —— `readEmbedKey()` 的三级回退、`mnemonCli()` 的 exe 探测（本机命中 `%APPDATA%\npm\node_modules\@mnemon-dev\mnemon\node_modules\@mnemon-dev\mnemon-win32-x64\bin\mnemon.exe`）、`embedEnv()` 注入 `MNEMON_EMBED_PROTOCOL=openai`（默认值 `ollama` 会去打不存在的 `nomic-embed-text`）。
- 面板显示「向量化覆盖率 / 已向量化 M/T / 模型 + 覆盖率条」，覆盖率 <100% 时给出「为什么配了 key 覆盖率还是 0」。
- 「回填向量」按钮 → `POST /api/embed` → `spawn mnemon embed --all`，走同一把 `.pipeline.lock`（有活锁返回 409），1s 轮询输出，跑完自动刷新覆盖率。

### 改进：配置项改为表单式布局

原先是表格 + 内联编辑，四项配置天然是表单而不是表格：`previewOrder` / `rulesOrder` 对用户毫无意义，不加说明就是两个神秘数字。

- `renderConfig()` 重写：每项一行 `键名（等宽）+ 灰色说明 + 值 + 操作`。四项都补了用途说明（vault「知识库根目录。改这里等于换一整座库…」等）。
- 数字项改用 `<input type="number" min="0" max="999">`，`vault` 行多一个「打开目录」按钮（`POST /api/reveal`，按平台调 `explorer.exe` / `open` / `xdg-open`）。

### 验证

- `plugin/panel/secret.mjs` + `embed.mjs` + 路由：临时探针 63 项全过（隔离 `DSH_HOME` + 假凭据文件，覆盖不回显明文、写入落盘、其他 refs 与 `records` 段未动、幂等、空值/含空白/未知凭据三类拒绝、真实 401 透出 `code 30014`、验证失败不落盘、清除只删该键、`embedEnv` 协议正确、POST 失败 body 带 `code`/`status`/`apiMessage`）。
- 界面渲染：临时探针 37 项全过（假 DOM 跑 `mount()`，覆盖表单行数、四项说明、凭据只显示尾部 4 位、编辑态出现 password 框且不再显示 hint、失败横幅含完整 `HTTP 401 · code 30014 · Token is invalid.` 且不含「保存失败」字样）。
- 两个探针均为临时文件，跑完即删。

需要重启 DSH 才看到新界面（`lib/client.js` 与 `web/panel.js` 要重建客户端 bundle）。

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
