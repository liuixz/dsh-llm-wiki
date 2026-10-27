# Changelog

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
