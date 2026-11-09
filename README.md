# dsh-llm-wiki

[![eval-profile](https://github.com/iwtown/dsh-llm-wiki/actions/workflows/eval.yml/badge.svg)](https://github.com/iwtown/dsh-llm-wiki/actions/workflows/eval.yml)

> 让 Agent 拥有一个**会自己长大、也会自己变老**的知识库。
> Karpathy LLM Wiki 模式 × DeepSeek Harness：模型写页、管线维护、记忆体召回、质量闭环。

基于 [Karpathy 的 LLM Wiki 理念](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)，对齐 [Google Research WikiSkill](https://arxiv.org/abs/2608.27454) 三层架构与 [OKF v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format) 知识格式。

---

## 它解决什么问题

- **Agent 会忘**：会话结束即失忆 → 把决策、排错、可复用结论编译成 wiki 页，形成持久证据。
- **旧答案反复出现**：没有保鲜机制 → stale 页面定期复核、降级、归档。
- **偏好要反复解释**：偏好散落在对话里 → 从会话抽取证据，蒸馏成 USER.md 规则（每轮注入）。

## 设计原则

1. **三层分工**：`raw/`（原始素材，永不删除）→ `wiki/`（模型维护的真相源）→ `schema.md`（写页/检索纪律）。
2. **低代码、零第三方依赖**：1 个插件 + 2 个技能 + 若干零依赖 Node 脚本；不引入向量库/数据库。
3. **只读优先**：蒸馏、stale 复核、编译候选都只产清单；写 USER.md / 归档页面必须经确认。
4. **可审计、可重建**：wiki 是 git 仓库；mnemon 索引可从 wiki 重建；每次自动化都写日志。

## 架构

```
写   wiki-write SKILL ──────────────► wiki/ 页面（frontmatter / wikilink / OKF v0.2）
管   llm-wiki-pipeline.mjs ─────────► lint / okf / index / sync / usage / compile-patterns
     ├─ 每日 10:00 计划任务            / docs-sync / dsh-export / prune / reconcile
     └─ 插件 session/disposed（增量）
记   mnemon（bge-m3 向量）◄────────── H2 块 + 语义边（可重建）
读   wiki-router.mjs → wiki-retrieval.mjs（BM25 + 向量融合 RRF）
     └─ session / live / docs / hot 四路分流
馈   --rate useful|outdated ────────► quality_score / queried_count
编   --compile-patterns ────────────► 孤立页聚类成 pattern 页
像   profile-extract → profile-distill ─► 候选 → USER.md（规则）/ 画像页（证据）
养   compile-candidates / stale-review / pipeline-health ─► 候选清单 / 复核清单 / 健康 CSV
```

## 组件

| 组件 | 文件 | 部署位置（link 安装） |
|---|---|---|
| 生命周期插件 | `plugin/dsh-llm-wiki.mjs` | 由本包 `cordis.patch.yml` 挂载，无需拷贝 |
| 写入技能 | `skills/wiki-write/SKILL.md` | `%USERPROFILE%\.agents\skills\wiki-write\`（由安装脚本拷贝） |
| 检索技能 | `skills/wiki-search/SKILL.md` | `%USERPROFILE%\.agents\skills\wiki-search\`（由安装脚本拷贝） |
| 管线 | `scripts/llm-wiki-pipeline.mjs` | 包内，插件从 `import.meta.url` 解析 |
| 管线互斥锁 | `scripts/pipeline-lock.mjs` | 同上（管线、计划任务、面板共用） |
| 管理面板（Host） | `plugin/panel/*.mjs` | 挂在插件上，经 `ctx.webServer` 暴露 `/llm-wiki-panel` |
| 管理面板（Client） | `lib/client.js` + `web/panel.*` | 由 `dsh.client` 声明，DSH 自动服务，无需拷贝 |
| 融合检索 | `scripts/wiki-retrieval.mjs` | 同上 |
| 查询路由 | `scripts/wiki-router.mjs` | 同上 |
| 画像抽取 | `scripts/profile-extract.mjs` | 同上 |
| 画像本体 | `scripts/profile-schema.json` | 同上（12 槽 = 6 域 × 2） |
| 决策评测 | `scripts/eval-profile.mjs` | 开发/CI 用，13 个隔离用例 |
| 检索评测 | `scripts/eval-retrieval.mjs` | 开发/CI 用，6 个 fixture 查询（BM25） |
| 画像蒸馏 | `scripts/profile-distill.mjs` | 同上 |
| 编译候选 | `scripts/session-compile-candidates.mjs` | 同上 |
| stale 复核 | `scripts/stale-review.mjs` | 同上 |
| 健康快照 | `scripts/pipeline-health.mjs` | 同上 |
| 向量代理（可选） | `scripts/embed-proxy.mjs` | 仅在 embedding 端点只认 Ollama 协议时需要 |
| 定时（Linux） | `systemd/*` | `~/.config/systemd/user/`，ExecStart 直接指向仓库内脚本 |
| 安装脚本 | `install.sh` / `install.ps1` | 注册 link 依赖 + 写配置覆盖 + 装技能 + 建计划任务 |

> link 安装下**脚本不落盘到 `~/.dsh/bin`**：计划任务、systemd unit 与插件都直接引用仓库里的 `scripts/`，改了仓库代码重启 dsh 即生效。加 `--copy-mode` / `-CopyMode` 才回到旧的手工拷贝方式。

## 安装

> **平台范围**：Windows 桌面版为优先支持路径（插件 + 技能 + 9 个脚本 + 5 个计划任务）。Linux/WSL 下 `install.sh` 覆盖插件、技能、管线与 5 个 systemd timer。

**方式 A：本地仓库 link（推荐，便于自己改代码）**

```bash
git clone https://github.com/iwtown/dsh-llm-wiki.git
cd dsh-llm-wiki && ./install.sh          # Linux / WSL
# 或
.\install.ps1                             # Windows（-NoSchedule 跳过定时任务）
```

做的事：把 `dsh-llm-wiki` 写成 profile `package.json` 的 `link:<本仓库>` 依赖并加入 `dsh.profile.bundles` → 在 profile `cordis.patch.yml` 里只写 `id: llm-wiki` 的配置覆盖（`vault` 等；插件入口由本包 `cordis.patch.yml` 提供，不重复 insert）→ 拷贝两个技能 → 建计划任务。脚本幂等，随时重跑；改 `-Vault` / `LLM_WIKI_VAULT` 再跑一次即可改 vault 路径。

然后重启 DSH 让插件生效，并首次全量同步：

```bash
node <仓库>/scripts/llm-wiki-pipeline.mjs --all
node <仓库>/scripts/pipeline-health.mjs   # 生成首份健康快照
```

**方式 B：bundle（只装插件，脚本走远端包）**

```bash
dsh plugin --profile desktop add github:iwtown/dsh-llm-wiki
```

**方式 C：手工拷贝（旧路径）**

```bash
./install.sh --copy-mode    # 或 .\install.ps1 -CopyMode
```

拷 `plugin/`、`scripts/`、`profile-schema.json` 到 `%USERPROFILE%\.dsh\profiles\desktop\` 与 `%USERPROFILE%\.dsh\bin\`，patch 里写完整 `insert` 块。仅在前两种方式不可用时使用。

### 计划任务（Windows）

| 任务 | 时间 | 作用 |
|---|---|---|
| LLM-Wiki Pipeline | 每日 10:00 | `--all` + 健康快照 |
| Profile Distill | 周日 09:00 | 画像候选 |
| LLM-Wiki Compile Candidates | 周日 09:20 | 未编译会话候选 |
| LLM-Wiki Stale Review | 周日 09:40 | stale Top20 复核清单 |
| LLM-Wiki Weekly Summary | 周日 09:50 | 周报（任务结果/健康变化/待办清单） |
| Mnemon Backup | 每日 10:30 | mnemon 快照（独立组件，不由本仓库安装） |

## 管理面板

安装（link 模式）后重启 dsh，在**设置页 → LLM-Wiki 分区**打开（`settings.section` 座位）。

界面代码只有一份（`web/panel.js`），降级路径：座位挂不上时，仍可用浏览器直接打开 `http://127.0.0.1:<webServer 端口>/llm-wiki-panel/?tab=tasks`（`?tab=config|tasks|history` 可直达某张表）。

打开后先看**顶部健康横幅**：它按三态（正常 / 需留意 / 正在腐化）告诉你知识库当前到底什么状态，判据是「计划任务有没有被停用 → 最新日志有多旧 → 最近一次 lint / 探针 / 向量覆盖」。点「为什么？」展开逐条依据。旁边那个绿色胶囊说的是另一件事——面板这一秒忙不忙。

| 区域 | 能做什么 |
|---|---|
| 配置项 | 表单式布局，每项带用途说明。改 `vault`（可「打开目录」）/ `previewOrder` / `rulesOrder` / `mainAgentOnly`（只写 profile 的 `cordis.patch.yml`，写完提示重启）；同时显示各层配置的生效值与漂移 |
| 凭据 | 填 / 换 / 清 `SF_API_KEY`（硅基流动，用于记忆体向量化与会话语义索引）。**只写不读**：界面只显示 `sk-…末 4 位`，明文不进浏览器；保存前先打一次真实 `POST /v1/embeddings` 验证，失败原样显示 `HTTP 401 · code 30014 · Token is invalid.`；写进 `~/.dsh/.credentials.yaml`，**无需重启**，下一次管线运行即生效。清除走内联二次确认 |
| 向量化状态 | 覆盖率 / 已向量化 M/T / 模型 + 覆盖率条。配了 key 但覆盖率仍是 0% 时给出原因，并提供「回填向量」按钮（`mnemon embed --all`，走同一把锁，1s 轮询输出）。覆盖率满时按钮不再是主色 |
| 存储占用 | 记忆库文件大小 / 空闲页占比 / 待清理条目数，加「压实记忆库」按钮（`--compact`）。这三项才是库变大的主因——活条目正文通常只占百分之几；空闲页 < 5% 且无软删时按钮置灰显示「无需压实」。**压实不可逆**，点了先弹一句「清除 N 条已删条目并压实？」，确认才执行，`Esc` 可退 |
| 计划任务 | 看五个任务的启用状态 / 上次结果 / 下次运行；启用、停用、改触发时刻（非 Windows 只读展示）。**已停用的任务不显示「下次运行」**——`Get-ScheduledTaskInfo` 对停用任务仍会返回一个未来时间，直接透出等于骗人 |
| 运行历史 | `log.md` 条目（「指标」列按 `facts` 渲染成胶囊：`compact` / `lint` / `sync` / `okf` / `prune`，异常项转色；「其它指标」列捡剩下的 `index` / `usage` / `docs` / `dsh` 等）+ `reports/health/health-YYYY-MM.csv` 趋势（每行带与上一行的 Δ 环比）。带「只看异常」开关，异常行加底色 |

顶部一个搜索框过滤各张表；六个运行按钮跑管线，旁边的「?」展开每条命令的说明（此前说明只在 `title` 里，悬停才见）；运行中 1s 轮询输出，跑完自动停。

**键盘与读屏**：三个分区是 `tablist`/`tab` + `aria-selected`，表头带 `scope="col"`，重绘后焦点会回到原来那个控件（`data-fk` 键），`Esc` 退出编辑态或关闭二次确认。窄于 560px 自动进紧凑模式（表格折叠成「标签 : 值」），由 `ResizeObserver` 自适应，不需要调用方传参。

**凭据的边界**：三个凭据接口（`GET/POST/DELETE /api/secret`）与 `POST /api/reveal` 只接受回环来源（`127.0.0.1` / `::1`），其它来源 403。其余接口不含密级数据，不加限制。

**并发**：管线自己持锁（`scripts/pipeline-lock.mjs`，锁文件 `~/.dsh/llm-wiki/.pipeline.lock`），面板只做预检。已有任务在跑时按钮变成「排队」与「强制解锁」，排队的那条会在前一条结束后自动拉起（`drainQueue`）。计划任务与面板共用同一把锁，所以两者不会撞车。

> 面板是**可选组件**：不想用就把 `package.json` 里的 `dsh.client` 与 `exports["./client"]` 去掉、删掉 `lib/` 与 `web/`，插件其余功能不受影响。

设计取舍见 `docs/adr/0001-panel-as-client-plugin.md`；写入哪一层见 `0002-config-write-target.md`；锁的语义见 `0003-pipeline-mutex.md`；凭据为何与配置项分开见 `0004-secret-config.md`；存储为什么这么大见 `0005-memory-footprint.md`；面板如何保证不说假话见 `0006-panel-truthfulness.md`；panel 怎么判定「我在哪个 profile」见 `0007-profile-detection.md`；术语见 `GLOSSARY.md`。

## 管线命令

| 命令 | 作用 |
|---|---|
| `--lint` | frontmatter / 双链 / 孤立 / stale / 断链（磁盘为准）/ 缺来源 |
| `--okf` | 补 OKF v0.2 字段（幂等） |
| `--index` | 重建导航与热投影 |
| `--sync` | wiki H2 块 → mnemon（哈希增量 + 语义边） |
| `--usage` | 回写召回热度 |
| `--compile-patterns` | 孤立页聚类成 pattern（证据门槛 3） |
| `--docs-sync` | mnemon Documents → wiki |
| `--dsh-export` | DSH 会话 → `raw/sessions/dsh/` |
| `--prune-memory` | 清理来源已消失的块 |
| `--compact` | 压实记忆库：删软删条目 → 删悬空边 → `mnemon gc --compact`（不进 `--all`，实测省 51%） |
| `--reconcile` | 邻域调和报告（只读，可开 LLM） |
| `--rate <页> --rating useful\|outdated` | 质量反馈 |
| `--all` / `--all --dry-run` | 全量 / 预览 |

## 检索路由

```bash
node <仓库>/scripts/wiki-router.mjs "上次怎么修 gnome 黑屏"   # 返回 route: wiki|session|live|docs|hot
node <仓库>/scripts/wiki-retrieval.mjs "关键词" --limit 5 --json
```

融合策略：BM25 + mnemon 向量 RRF（K=5，权重 1.0/0.5，标题加权 4）。调参用 `LLM_WIKI_RRF_K / _WB / _WM / TITLE_BOOST / CAT_WEIGHT`。

## 画像蒸馏（v3：本体 + 决策 + 保真）

```bash
node <仓库>/scripts/profile-extract.mjs --since 30d    # 3 角度抽取 + 行为事件
node <仓库>/scripts/profile-distill.mjs --since 30d    # 复核 → 候选 → USER.md diff
```

- **规则进 USER.md**（每轮注入，≤2KB 目标），**证据留画像页**（`profile_scope: evidence`）与记忆空间；
- 12 槽本体（6 域 × 2），抽取必须落槽，落不到记 unclassified 交复核；
- 引文保真：quote 必须是用户原话子串（≥6 字），否则丢弃（实测约 17%）；
- 决策标签 ADD/UPDATE/NOOP/CONFLICT/EXPIRE；CONFLICT 带 temporal/factual/contextual 类型；
- 抽取免费（Z.ai GLM-4-Flash 优先），复核固定 DeepSeek 官网 `deepseek-flash`；
- 候选按「红线 3 / 沟通 2 / 工作 5 / 其他 2」配额，上限 12 条；
- 应用只经 `mnemon_runtime_memory`，并回写画像页演变记录；
- 自测：node scripts/eval-profile.mjs（8 用例：时间更新/冲突/覆盖/弃权/过期/槽位）。

## 自动化与健康

- **同步分级**：`引用` 默认不入库；`发现` 只排除会话复盘/批量导入，排错/验证类纳入（`LLM_WIKI_SYNC_DISCOVERY=recap-only|all|off`）。
- **编译触发**：会话日志 ≥300KB 时插件写提示标记，下一轮注入一次；`session-compile-candidates.mjs` 每周产出候选清单（只读）。
- **保鲜**：`stale-review.mjs` 每周 Top20，按「质量低 + 最久未更新 + 被引用多」排序，附可执行 `--rate` 命令。
- **健康**：`pipeline-health.mjs` 每日写 `reports/health/health-YYYY-MM.csv`，含 6 条召回探针；每月生成对比月报。

## 配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `LLM_WIKI_VAULT` | `/mnt/d/学习/AI知识库/LLM-Wiki` | vault 路径（Windows 默认 `D:\学习\AI知识库\LLM-Wiki`） |
| `LLM_WIKI_STATE` | `~/.dsh/llm-wiki/pipeline-state.json` | 增量状态 |
| `LLM_WIKI_SYNC_EXCLUDE` | `引用` | 不入库分类 |
| `LLM_WIKI_SYNC_DISCOVERY` | `recap-only` | 发现类分级 |
| `LLM_WIKI_CHUNK_MIN / MAX / PER_PAGE / BATCH` | `40 / 1200 / 24 / 40` | 切块参数 |
| `MNEMON_EMBED_*` / `EMBED_KEY` / `EMBED_MODEL` | 读 `~/.dsh/.credentials.yaml` 的 SF key | 向量 |
| `LLM_WIKI_LLM_MODELS` | `glm-4-flash-250414,glm-4.7-flash,THUDM/GLM-4-9B-0414` | 抽取链（免费） |
| `LLM_WIKI_REVIEW_MODELS` | `deepseek-flash` | 复核链（官网） |
| `LLM_WIKI_REVIEW_ENDPOINT` | `https://api.deepseek.com/v1` | 官网端点 |
| `LLM_WIKI_REPORTS` | `~/.dsh/llm-wiki/reports` | 候选/清单/健康/周报输出目录（`<仓库>/scripts` 与插件默认值一致） |
| `PROFILE_MAX_ADD` | `12` | 单批候选上限 |
| `PROFILE_SCHEMA` | 同目录 profile-schema.json | 画像本体路径 |
| `PROFILE_REVIEW` | 开 | off 跳过复核（仅测试） |
| `LLM_WIKI_COMPILE_HINT` | 开 | 设 `off` 关闭会话编译提示 |
| `LLM_WIKI_RRF_K / _WB / _WM / TITLE_BOOST` | `5 / 1.0 / 0.5 / 4` | 融合检索调参 |

## 告警与周报

- 健康快照发现异常（同步页骤降 / stale 激增 / lint 激增 / 探针命中 <60%）时写 `reports/health/ALERT.md` 并返回码 2；任务包装据此弹窗。异常消失后自动消警。
- 召回探针**从本 vault 的页面标题按固定步长抽样**（最多 6 条），用标题做查询、期望命中同名页；因此换一个知识库也能得到有意义的 `probeHit`，不再依赖某个库里才有的页面名。vault 为空时退回两条内置样例。
- 周报：`reports/weekly/LATEST.md`（每周一页：任务结果、7 条健康变化、待处理清单）。

## 质量门槛

| 指标 | 目标 |
|---|---|
| 断链 | 0 |
| 同步覆盖（可入库页） | 100% |
| 会话编译率 | ≥70% |
| stale 处置 | 20 条/周 |
| 画像候选精度 / gold 覆盖 | ≥75% / ≥75% |
| 健康探针 hit@3 | 6/6 |

本地验收：`npm test` 跑四件事——`test/profile-detect.mjs`（profile 判定 16 项，用临时 `DSH_HOME` 造多 profile 布局）、`test/panel-e2e.mjs`（假 DOM 真跑 `web/panel.js`，52 项断言）、`scripts/eval-profile.mjs`（画像抽取 13 项）、`scripts/eval-retrieval.mjs`（检索 6 项）。界面的布局问题假 DOM 看不出来，再跑 `node test/shot.mjs 1200 900 420`（可加 `--tab=tasks|history`、`--confirm`、`--profile=unknown`）用真 Chrome 截图到 `test/shots/` 并打印 `compact` 是否触发、有没有横向溢出。

## 排错

- **Windows 上 mnemon 是 .cmd**：管线优先找 npm 全局包里的 `mnemon.exe`，找不到退回 `shell: true`。
- **会话日志是 zstd 多帧**：用 `zlib.zstdDecompressSync` 逐帧解，不依赖 zstd 命令。
- **LLM 429/1305**：免费模型高峰期限流，抽取链自动降级；复核固定官网模型不受影响。
- **代理**：默认不走代理；需要时只在单条命令显式指定，不要写进 DSH 环境或 git 配置。
- **mnemon 重建**：重跑 `--sync`；若整库重建，需重置远端同步分支。

## 仓库结构

```
dsh-llm-wiki/
├─ plugin/dsh-llm-wiki.mjs        # 注入 + 生命周期 + 编译提示
├─ plugin/panel/                  # 管理面板的 Host 半边（配置/凭据/向量化/任务/历史/管线/路由）
├─ lib/client.js                  # 管理面板的 Client 半边（设置页分区）
├─ web/panel.{html,js}            # 两端共用的界面（样式内建在 panel.js）
├─ locale/{zh,en}.json            # 面板的标语
├─ scripts/
│  ├─ llm-wiki-pipeline.mjs       # 维护管线
│  ├─ pipeline-lock.mjs           # 全局互斥锁（管线/计划任务/面板共用）
│  ├─ wiki-retrieval.mjs          # 融合检索
│  ├─ wiki-router.mjs             # 五路分流
│  ├─ profile-extract.mjs         # 会话 → 证据
│  ├─ profile-distill.mjs         # 证据 → 候选
│  ├─ session-compile-candidates.mjs
│  ├─ stale-review.mjs
│  ├─ pipeline-health.mjs
│  └─ embed-proxy.mjs
├─ skills/wiki-write · skills/wiki-search
├─ test/                          # panel-e2e.mjs（假 DOM 真跑界面）+ preview.html/shot.mjs（真 Chrome 截图）
├─ docs/adr/  GLOSSARY.md         # 设计决策与项目词汇
├─ systemd/  install.sh  install.ps1
├─ package.json（bundle 只含插件）
└─ CHANGELOG.md
```

## 版本

- `0.13.6`：修「面板读错 profile」——在别人的机器上，装好插件、在面板里改配置，改完不生效，因为写进的是**另一个 profile** 的 `cordis.patch.yml`。根因是 `detectProfile()` 里一句 `if (hits.includes("desktop")) return "desktop"`：`DSH_PROFILE` 只注入给模型 shell 调用（插件进程拿不到），按文本扫 `package.json` 又分不清「真装」与「符号链接借用」，最后硬编码兜底 desktop → **任何机器都判成 desktop**。修法：①四级链——env → **`ctx.profileContext.name`（DSH 提供的运行时真值，插件进程里唯一权威来源）** → `desktop-next.json` 的 `active` → 扫目录但用 realpath 排除借用（链接落在 `profiles/<别的>/` 内才算别人的，`link:D:/project/...` 这种工作区安装算自己的），都不成立返回 **null**（两个 profile 都真装了也返回 null，以前取字典序第一个等于掷骰子）；②null 一路传到底——真源层 `path` 留空并标 `unresolvable`、`writeConfigKey(null)` 直接抛错拒写、`/api/config` POST 返回 **409 + `PROFILE_UNKNOWN`**、面板显示「判不出 profile」并把原因摆出来；③面板 startRun 的 `spawn` env 补 `LLM_WIKI_VAULT: currentVault()`（原来只传 `LLM_WIKI_PANEL`，管线靠自己的 win32 兜底路径，可能和面板显示的 vault 不一致）。新增 `test/profile-detect.mjs` 16 项；端到端探针 44 → **52 项**，新增一整段专盯「判不出 profile」这个状态（页面写明、真源层路径是 `—` 不是 `profiles/null`、四个「改」按钮被按住且带 `title`）——这种状态最容易做成静默错误。
- `0.13.5`：`/impeccable polish` 一轮精修。都是 0.13.4 之后仍然存在的小毛病：①`fmtTime()` 只有定义零调用（死代码）——改为在输出面板显示运行开始时间，长时间运行里这条信息是刚需；`--lw-r-lg` 与 `--lw-shadow-2` 两个令牌定义了零引用，删掉。②`--lw-fg-3` 回退色 `#7d8590` 白底实测只有 **3.73:1**，而这一档被 `.lw-sub`/`.lw-card-hint`/`.lw-form-desc`/`.lw-empty`/`.lw-stat-k` 等 11–12px 小字大量使用——浅色改 `#667085`（4.97:1）、深色改 `#8b949e`（`--lw-bg-2` 上 5.26:1）。③任务表「上次运行」直接输出 PowerShell 区域化格式 `10/31/2026 02:50:50`，与页面其它 ISO 日期并存，新增 `fmtLocal()` 归一为 `2026-10-31 02:50`（解析失败原样返回）。④层表搜索过滤写 `matches(r.join(" "))` 而 `r` 含 DOM 节点 → `[object HTMLSpanElement]`，按状态文字搜必然零命中；⑤`renderEmbed`/`renderStorage` 搜索无匹配时整卡消失（用户以为被删），改为留「已按搜索过滤」空态；⑥「?」展开时加 `is-primary` 变成第二个蓝色主按钮，改用新增 `.lw-btn.is-on`。⑦刷新毫无反馈 → 顶栏「加载中…」+ 按钮旋转并禁用；搜索框 `Esc` 清空。⑧紧凑模式触控目标 28/24px 太薄，抬到 32/28px；「计划」列文字与「改」按钮糊成一串，补 2px 分隔。端到端探针 40 → **44 项**。
- `0.13.4`：面板说真话。一次 `/impeccable critique` 给 `web/panel.js` 打 **17/40**，最差三项「系统状态可见性 1 分 / 错误预防 1 分 / 帮助文档 1 分」，追下去全是**面板在骗人**：①五个计划任务全 `Disabled` 时顶栏仍是绿灯「● 空闲」（`applyState()` 只看 `run` 与 `lock`），新增独立的**健康三态横幅**（`ok`/`warn`/`bad`，判据：任务停用 → 日志 ≥3/≥7 天 → `lintIssues` → 探针命中 → 向量覆盖），带「为什么？」展开依据，与顶栏胶囊并存（胶囊说「这一秒忙不忙」，横幅说「知识库健不健康」）；②`Get-ScheduledTaskInfo` 对停用任务仍返回 `NextRunTime`，面板照抄成「下次运行 11/09」而它永远不会跑——`tasks.mjs` 改为先算 `enabled` 常量再决定是否透出，任务页对停用行显示「已停用」并整行灰化；③「压实记忆库」不可逆却零确认——改为卡片内联二次确认（`role="alertdialog"` + 红色填充按钮，`Esc` 可退，**不用 `window.confirm`**：嵌入式 webview 常被宿主拦截，拦了就是静默执行），清除凭据同模式；顺带修掉引用不存在的 `run.running`（`/api/state` 的 run 快照只有 `finished`，导致压实期间按钮从不进 loading）。历史页开始吃 `facts`（此前 UI 里 grep 0 命中）：列改 `[日期, 指标, 其它指标]`、删掉 60 行全是 `pipeline` 的 `kind` 列、指标渲染成 `compact/lint/sync/okf/prune` 胶囊、新增「只看异常」开关（60 条里 5 条）。`compact: false` 写死在 `lib/client.js` 与 `web/panel.html` 导致 30 行降级样式从未生效（420px 实测工具栏被裁到 5 个半按钮）→ 改 `ResizeObserver` 自适应（<560px 进紧凑），调用方传布尔则听它。无障碍：`tablist`/`tab` + `aria-selected`、`th[scope=col]`、`data-fk` 焦点保持（重绘后回到原控件）、`Esc` 退出、运行栏「?」展开命令说明（此前只在 `title`）。同屏只留一个主按钮（回填向量仅 `pct<100` 时为主）。另补 `--lw-fg-4` 令牌与 `spark` 图标（都引用了却从未定义）。决策记入 `docs/adr/0006-panel-truthfulness.md`，端到端探针 40 项全过。
- `0.13.3`：记忆库存储占用优化。实测纠正了「竖线占空间」的假设——222 条活记忆里竖线共 846 个，只占正文 0.63‰，全删光省不到 0.1%；9.65 MB 里真正的大头是**空闲页 24% + `edges` 六个索引 31% + 软删条目向量 5.1%**，活条目正文只占 2.4%。新增 `--compact` 子命令（删软删条目 → 删悬空边 → `mnemon gc --compact`，VACUUM 必须走官方入口否则 WAL 下失败），副本库实测 `9.65 MB → 4.68 MB`（**−51.5%**）且活条目一条没少、`integrity_check` = ok；不进 `--all`（避免每日管线无条件改写 9 MB 库），改由 `--sync` 后 `shouldAutoCompact()` 按「空闲页 ≥ 15% 或软删 ≥ 200」触发，`LLM_WIKI_COMPACT_AUTO=0` 可关。有损分支 `LLM_WIKI_COMPACT_PRUNE_EDGES=1` 再裁 `importance<4` 的 entity 边可累计省 69%，但召回掉 13%，默认关闭。另新增 `cleanChunkText()`：代码围栏不动、`|---|` 分隔行整行删、竖线行转 `a · b`、空行折叠、`（来源: …）` 锚点不碰——字符 −0.79%、竖线 −85%，省不出空间但片段可读。面板新增「存储占用」卡片与「压实记忆库」按钮（干净库置灰）。决策记入 `docs/adr/0005-memory-footprint.md`。
- `0.13.2`：修掉「改计划任务时间必报错」。三层原因：①`schtasks /Create` 建的任务 `Description` 是 `$null`，而 `Register-ScheduledTask -Description` 带 `[ValidateNotNullOrEmpty]`，参数绑定阶段就抛「无法对参数 Description 执行参数验证」；②`$t.Triggers[0].DaysOfWeek` 是 **UInt16 位掩码**（周日=1、周一=2、周二=4…）不是枚举序号，直接传给 `-DaysOfWeek` 会让星期每次保存往后漂一天（实测 `1→2→4`）；③`powershell.exe` 按系统代码页（936/GBK）写管道，而 JS 按 utf8 解码，中文报错全变乱码。改法：描述空则回退到任务定义里的中文描述、掩码按位展开成枚举名数组、`-EncodedCommand` 前缀显式设 `[Console]::OutputEncoding` 为 UTF-8，并补 `-Principal $t.Principal` 保证登录身份不被重置。真机验证 daily/weekly 改时间、二次修改不漂移、非法时间被拒、还原后五个任务 `State=Ready` 且掩码与时间与改前一致。
- `0.13.1`：修掉「点了回填向量，覆盖率几乎没动」。根因是 `mnemon embed --all` **单轮最多处理 100 条**——exit 0、`status: backfill_complete`、`failed: 0`，看起来全完了，实际库里 341 条只做了 100 条；`mnemon` 也没提供可调上限的参数。`startBackfill()` 改为循环跑到收敛：每轮结束比对 `embedded` 增量，有进展且未满 → 自动下一轮，满了 → `回填完成：X / Y（Z%）`，**一轮零新增或非 0 退出 → 停止**（防死循环）。整轮只持一次锁。界面显示「第 N 轮 · M / T」。端到端实测 206 → 300（第 1 轮）→ 341/341 = 100%（第 2 轮，13 秒），数据库直查 `有向量=341`、`1024维=341`。
- `0.13.0`：面板新增**凭据管理与向量化状态**，配置项改为表单式布局。① 新增 `SF_API_KEY` 凭据卡片：**只写不读**，界面只显示 `sk-…8gOE0`，明文不进 `/api/state`；保存前先打一次真实 `POST /v1/embeddings`（`BAAI/bge-m3`）验证，失败原样透出 `HTTP 401 · code 30014 · Token is invalid.` 而非笼统「保存失败」；可「跳过验证」落盘（断网用）；清除是整行删键不是写空串；三个凭据接口与 `POST /api/reveal` 限回环来源，非回环 403；写 `~/.dsh/.credentials.yaml`，**无需重启**（下一次管线运行即生效，与配置项不同）。② 新增「向量化状态」块：覆盖率 / 已向量化 M/T / 模型 + 覆盖率条；覆盖率为 0% 时说明原因，并提供「回填向量」按钮（`mnemon embed --all`，走同一把锁，1s 轮询）。③ 配置项重写为表单布局，每项带用途说明，数字项用 `number` 输入、`vault` 带「打开目录」。决策记入 `docs/adr/0004-secret-config.md`，术语补「配置项 / 凭据 / 向量化覆盖率」。临时探针验证 63 + 37 项全过。
- `0.12.4`：只保留设置页入口，并修掉两处界面缺陷。① `settings.section` 注册时补上 `label: () => "LLM-Wiki"`——设置页左侧导航靠它渲染分区名称，缺了只有内容没有名字；② 表格外包一层 `.lw-table-wrap`（`overflow-x:auto`）——`.lw-card` 是 `overflow:hidden` 的，任务表列多时超出部分被直接裁掉且无法滚动；紧凑模式下该层改为 `overflow-x:visible`，与键值折叠配合；③ 移除右栏 `sidebar.right.pane.tab` 座位（含 `SidebarPane`、`TAB_ID`、`ctx.sidebarRightTabs` 与 `package.json` 里的 `dsh-client-ui-sidebar-right` 注入），只留设置页一个入口。
- `0.12.3`：修掉**设置页关掉再打开就空白**的真 bug。`PanelHost` 的 cleanup 清掉了 `scriptPromise` 与 `window.__LLMWikiPanel`，但插入的 `<script>` 节点留在 `head`；第二次打开走 existing 分支给已 load 完的节点挂 `load` 监听，浏览器不会补发该事件 → Promise 永不 settle → 不 mount。改法：cleanup 只销毁实例，模块级加载状态保留；load 时打 `dataset.llmWikiLoaded` 标记，existing 分支见标记直接 resolve。同时修掉失败后 `scriptPromise` 永久缓存 rejected、失败节点不清理两个连带缺陷。用临时探针（假 DOM 模拟「已 load 不再补发」）验证 18 项全过。
- `0.12.2`：修掉桌面版启动时**管理面板根本没注册上**的真 bug。根因是 `apply()` 里同步取 `ctx.get("webServer")`，而插件静态注入只有 `["systemPrompt"]`，桌面版启动时 `webServer` 常晚于本插件就绪 → 走 skipped 分支且永不重试，设置页空白。改用 `ctx.inject(["webServer"], cb)` 等服务就绪后回调（生态同一写法），不把 `webServer` 写进静态 inject 数组（非 web 平台没有该服务，写进去会让整个插件不激活）。13 项探针验证，含「延迟出现后仍注册成功」与「随后 `/api/state` 真返回 200」。
- `0.12.1`：管理面板界面优化，并修掉一个真 bug——**样式在 slot 里根本没加载**（`web/panel.css` 只被降级页引用，设置页看到的是浏览器默认样式）。样式改为内建进 `web/panel.js`（首次 `mount()` 注入 `<style>`），删除 `panel.css`；配色改走 DSH 主题令牌三级回退（`--dsw-alias-*` → 主题底层变量 → 兜底色值），表格改成卡片分组、内联 SVG 图标、标签页改分段控件、状态改圆点+文字、趋势条重做；窄容器 `compact` 下表格降级为竖向键值卡（`td[data-label]`）。顺带补计划任务表缺的「状态」表头、超长日志摘要截断。
- `0.12.0`：新增**图形管理面板**——`settings.section` 座位（当时另有 `sidebar.right.pane.tab`，0.12.4 已移除），三张表（配置项 / 计划任务 / 运行历史）共用一份 `web/panel.js`，五个按钮一键跑管线，顶部一个搜索框；降级路径是 `ctx.webServer` 上的 `/llm-wiki-panel` 页面。配置只写 profile 的 `cordis.patch.yml` 并提示重启；新增 `scripts/pipeline-lock.mjs` 全局互斥锁（管线内部持锁，计划任务与面板共用，抢不到 exit 75，支持 `--queue` 排队与面板「强制解锁」）；面板只做锁预检而不自己抢锁，避免父子进程互锁。决策记入 `docs/adr/0001~0003`，术语记入 `GLOSSARY.md`。
- `0.11.2`：发版脚本不再假失败。`scripts/release.ps1` 的 `Invoke-Native` 改用 `System.Diagnostics.Process` 分开重定向 stdout/stderr/stdin，只看退出码判成败——修复 `git push` 成功却因 stderr 被 PowerShell 当成终止性错误而以 exit 1 收场；顺带修掉旧实现用临时 `.cmd` 导致 `%` 被展开、含引号参数直接抛错两个 Windows 专属坑（新的 `ConvertTo-CommandLineArg` 按 Windows 规则转义）；脚本本身改为 UTF-8 with BOM，避免 PowerShell 5.1 按 ANSI 读取中文注释后解析错位。另外补了幂等：同一版本重跑时没有可提交内容则跳过提交、Release 已存在则更新正文，不再因「nothing to commit」或 422 报失败。
- `0.11.1`：自动任务实跑暴露的四处损坏修复。`log.md` 不再被新条目顶出多层 frontmatter（`normalizeLog` 固定写「frontmatter → 标题 → 新到旧条目」）；页面 frontmatter 不再因 `setFmField` 只换首行而残留孤儿 `by:`/`at:` 行，也不再拼出双 T（新增 `isoAt` 与幂等清扫 `normalizeFmArtifacts`）；`parseFm` 认得块式写法，`--okf` 第二次起 `updated: 0`，不再假更新；健康快照的 `lintIssues` 只看最新一条日志，无 lint 段时写 `-1` 而非沿用旧值；`install.ps1` 生成计划任务包装 `.cmd` 改 UTF-8 无 BOM + `chcp 65001`，中文 vault 路径不再变成 `?`；`scripts/release.ps1` 的 Release 目标仓库改为从 `origin` 推导，fork 上发版不再打到上游。
- `0.11.0`：安装方式改为**本地仓库 link**（`link:` 依赖 + bundle patch，不再向 profile 拷贝插件）；插件优先使用包内 `scripts/`，改仓库代码重启即生效；vault 默认路径跨平台收敛（Windows `D:\学习\AI知识库\LLM-Wiki`，Linux `/mnt/d/学习/AI知识库/LLM-Wiki`）；`LLM_WIKI_REPORTS` 默认改为 `~/.dsh/llm-wiki/reports`；安装脚本幂等（重复运行不重复写 patch，改 vault 只改一行）并自动清理旧版手工 insert 块。
- `0.10.7`：预算淘汰建议（只读提案，受保护规则除外）。
- `0.10.6`：schema 关键词补充（候选方案对比）。
- `0.10.5`：schema 关键词补充（调研评估/目标验收/结论边界）。
- `0.10.4`：槽位回退 + 动作叙述过滤；评测 13 用例。
- `0.10.3`：CI 增加检索 fixture 评测（6 用例，BM25）+ 本地发版双门禁。
- `0.10.0`：画像本体（12 槽）+ 决策标签 + 引文保真 + 决策引擎评测 8/8；安装脚本同步 schema。
- `0.9.0`：检索路由 + 融合检索；画像 v3（证据管线/复核/预算）；编译候选、stale 复核、健康快照；发现分级同步；会话编译提示。
- `0.8.0`：DSH 桌面版适配（zstd、mnemon.exe、embedding 注入、Windows 任务）。

## 发布

发版流程见 [RELEASE.md](./RELEASE.md)：版本三处一致 → 自测 → commit/tag → push → `scripts/release.ps1` 创建 GitHub Release 并校验 latest。

## License

MIT
