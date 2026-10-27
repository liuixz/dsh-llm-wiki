---
name: 'wiki-write'
description: '向 LLM-Wiki 知识库（D:\\学习\\AI知识库\\LLM-Wiki）写入新知识，并在页面改名/合并或 frontmatter 被写坏时完成收尾：同步 title 与正文旧 wikilink、用管线 --lint --index 重建索引、--all 全链同步。当会话中学到新知识、做出决策、发现踩坑经验、用户要求记录/保存知识到 wiki、重命名或合并 wiki 页面、或发现页面 frontmatter 损坏（双 T、孤儿 by:/at: 续行）时使用。写入纪律：先查重、选对分类、frontmatter 完整（OKF v0.2）、wikilink>=2、中文标题。'
---

# LLM-Wiki 知识写入

> 生产端规范：模型在会话中直接写 wiki（Obsidian vault 就是磁盘上的 md 文件），管线脚本自动做 lint/索引/记忆体同步。写入纪律：**先查重、后写入、引用旧知识、不制造孤立节点**；改完名字或 frontmatter 必须跑到管线重新生成索引，页面才算真正落地。

## 分类决策树（新知识进哪个分类）

| 知识类型 | 分类 | 目录 | 示例 |
|---|---|---|---|
| 架构选型/技术决策/明确取舍 | **决策** | wiki/决策/ | 子代理模型选型；ADR |
| 踩坑经验/性能优化/验证结果/修复记录 | **发现** | wiki/发现/ | 安装踩坑、性能验证 |
| 领域概念/名词解释/理念 | **概念** | wiki/概念/ | LLM-Wiki 理念 |
| 项目知识/项目级决策 | **项目** | wiki/项目/ | 项目概览 |
| 操作流程/工作流 | **流程** | wiki/流程/ | 知识编译、日常开发 |
| 常用命令/工具用法 | **命令** | wiki/命令/ | 常用命令 |
| 红线规则/安全约束 | **规则** | wiki/规则/ | 操作红线 |
| 高质量提示词 | **提示** | wiki/提示/ | 提示词集 |
| 网页剪藏/外部引用 | **引用** | wiki/引用/ | 只建摘要+链接，不复制全文 |
| 不确定 | **先问用户** | — | 不猜分类 |

## 步骤（写入新页）

1. **查重**：先用 wiki-search SKILL 搜关键词——已有相同/相似页面则**更新它**，不新建（更新优先于新建，防止孤立节点）。
2. **定分类**：按决策树选分类；不确定时问用户。
3. **写文件**：路径 `wiki/<分类>/<中文标题>.md`；frontmatter 按下方模板。
4. **关联**：body 里 >=2 条 [[wikilinks]] 指向相关旧页面（`related` 字段也填）；用 `grep` 工具找可关联的旧页。
5. **汇报**：告知用户写入路径 + 关联了哪些旧页。
6. **同步与经验**：写入后运行管线（见「写入后」）；若本次还产生了 wiki 装不下的可复用经验（判断依据、踩坑教训），再单独 `mnemon_remember` 一条，内容自包含并带上本页路径。

## 改名与合并页面（收尾纪律）

改了文件名、title 或结论，索引和引用不会自己跟着变，**必须按下面顺序做到 --lint --index 与 --all 都通过**才算完：

1. **改名文件**（PowerShell，先锁 UTF-8 输出，避免中文乱码）：

   ```powershell
   [Console]::OutputEncoding=[Text.Encoding]::UTF8
   $d='D:\学习\AI知识库\LLM-Wiki\wiki\决策'
   Move-Item -LiteralPath (Join-Path $d '旧标题.md') -Destination (Join-Path $d '新标题.md')
   ```

   用 `Move-Item -LiteralPath`（标题里有空格与全角括号），不要「新建一页再删旧页」。

2. **同步 title**：read 新文件头 25 行，确认 `title:` 仍是旧标题（改文件名不会改 frontmatter），再用 edit 换成新标题——**与文件名逐字一致**。
3. **替换正文里的旧 wikilink**：用 `grep` 工具搜旧标题（path `D:\学习\AI知识库\LLM-Wiki`，include `*.md`），对每个命中页 read 该段落后 edit 把 `[[wiki/<分类>/旧标题]]` 换成新标题。
   - `wiki/index.md` 与 `wiki/<分类>/index.md` 是管线生成物：**不要手改**，交给第 4 步重建。
   - `log.md` 是历史日志，保留旧名是正常的，不要为了 grep 干净去改历史。
4. **重建索引 + lint**：

   ```powershell
   $env:PYTHONIOENCODING='utf-8'
   cd 'D:\project\dsh-plugin\dsh-llm-wiki'
   node scripts/llm-wiki-pipeline.mjs --lint --index; "EXIT=$LASTEXITCODE"
   ```

   装到本机时用 `node "$env:USERPROFILE\.dsh\bin\llm-wiki-pipeline.mjs" --lint --index`（WSL 为 `~/bin/...`）。期望输出 `问题: 0 | 孤立节点: 0 | stale: 0`、`已重建 wiki/index.md`、`分类索引页: ...`、`EXIT=0`。
5. **全链同步**：`node scripts/llm-wiki-pipeline.mjs --all`，期望 `回写: {...}`、`OKF 对齐: {"aligned":0,...}`、`同步: {"synced":N,...}`、`完成。`、EXIT=0。
6. **合并页面**：先把被合并页的内容并进目标页并补 [[wikilink]]（按「更新已有页面」），再给被合并页加 `status: archived`、`superseded_by` 指向目标页，然后照样跑第 4、5 步。

## frontmatter 体检与交给管线自愈

历史页可能带着被外部编辑器写坏的 frontmatter，改到它之前先体检，别在坏 YAML 上叠加修改。

**症状**

- 双 T：`at: 2026-10-27T19:52T00:00:00Z`（日期里出现两个 `T`）。
- 孤儿续行：`generated:` 被压成单行内联后，原来的块式续行 `  by: agent/dsh-llm-wiki` / `  at: ...` 残留成孤立行，整段 frontmatter 不再是合法 YAML。

**成因**：Obsidian 会把 `updated` 写成带时分的 `2026-10-27T19:52`，而管线的 OKF 对齐假设它只到日期，于是又追加了一次 `T00:00:00Z`；同时字段设置只替换首行，没人管续行。

**检查**（两种都做，命中后 read 该页 1–30 行确认是否在 frontmatter 内）

- `grep` 工具：pattern `T\d{2}:\d{2}T`，path `D:\学习\AI知识库\LLM-Wiki\wiki`，include `*.md` → 命中即双 T。
- `grep` 工具：pattern `^\s+(by|at):`，path 同上，include `*.md` → 疑似块式字段残留。

**处理**：不要手工拼一个「看起来合法」的时间戳，交给管线自愈——`node scripts/llm-wiki-pipeline.mjs --okf` 重排 frontmatter，`--all` 也会带上这一步。修完**必须再跑一次**：第一次 `aligned:17` → 第二次 `aligned:0` 才说明幂等、历史残留已清。若某页仍报错，read 该页头 → edit 手工修正该字段，**连同残留下来的 `by:`/`at:` 续行一起替换或删除**。

## 归档与退出同步

- 页面不再维护但要保留内容：frontmatter 加 `status: archived`。archived 页不参与 lint / orphan / stale 统计，也不进入 mnemon 同步，但仍可被 grep 检索。
- 个人画像、敏感偏好等不该进入记忆空间的页面：加 `recall: false`，内容只留在 wiki。
- 归档不删除内容；要彻底移除先确认用户。

## frontmatter 模板（OKF v0.2）

```yaml
---
title: "<中文标题>"
tags: [wiki/<分类>, compiled]
type: "<分类>"
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
project: "<项目名，可选>"
description: "<一句话摘要>"
related:
  - "[[wiki/分类/相关页]]"
  - "[[wiki/分类/另一个相关页]]"
sources:
  - resource: "<URL 或 vault 内相对路径>"
cssclasses: [<分类>]
---
```

> OKF v0.2 要求 `sources` 的每一项是对象（`resource` 必填）；只写字符串也能被管线 `--okf` 自动规范化为对象。
> 不要手写 `quality_score`/`generated`/`verified`/`stale_after`——管线自动维护；`updated` 只写到日期，带时分的值留给 Obsidian 自己写。

## 正文写作规则

- 中文标题与正文；决策页带背景/选项/结论/理由结构。
- 每条知识自包含：即使脱离来源也能读懂（管线会把 raw 会话归档）。
- 涉及密钥/凭据：绝不写入 wiki；涉及路径写相对 vault 路径。
- 剪藏/引用类：只写摘要 + 原文链接，不复制全文。

## 更新已有页面

- 找到旧页 → read → 在原文基础上增补（新信息、更正、标注 superseded）。
- 决策被推翻：旧页加 `superseded_by` 标记，不删除。
- 旧结论失效时正文要一起改：只改 frontmatter 的 `description` 不改小节标题/结论，会让页面自相矛盾（历史小节可保留，但加「后续更新/已修正」标注，别让它冒充当前结论）。

## 坑（Pitfalls）

- edit 报 `file changed since it was read`：Obsidian 与管线会回写文件。**先 read（必要时只读目标段落）再重试同一次 edit**，不要原样重试，也不要整篇覆盖写。
- 只改文件名不改 `title`：文件名与 frontmatter title 不一致，索引、lint 与检索都会对不上。改名后必须走第 2 步。
- 手改 `wiki/index.md` 或分类 index 页：下次 `--index` 直接覆盖，白改且容易与页名漂移；索引一律由管线重建。
- 为让 grep 干净去改 `log.md`：历史日志保留旧名是正常的，不要重写历史。
- 手写 `generated`/时间戳：这正是双 T 与孤儿 `by:`/`at:` 的来源，字段交回管线。
- 只跑 `--lint --index` 就收工：索引对了但记忆体与 OKF 还没同步，最后要跑一次 `--all`。

## 验证（Verification）

1. 旧文件名已不存在、新文件名与 frontmatter `title` 逐字一致（read 页面头确认）。
2. `grep` 旧标题（path `D:\学习\AI知识库\LLM-Wiki`，include `*.md`）→ 除 `log.md` 外无残留指向旧页名的 wikilink。
3. `node scripts/llm-wiki-pipeline.mjs --lint --index` 退出码 0，且 `问题: 0 | 孤立节点: 0 | stale: 0`。
4. read `wiki/index.md` 与 `wiki/<分类>/index.md`，两处都指向新页名。
5. `node scripts/llm-wiki-pipeline.mjs --all` 退出码 0；再跑一次 `--okf` 得到 `{"aligned":0,...}`（幂等，说明没有残留损坏）。
6. 向用户汇报：改了哪些文件、重建了哪些索引、关联/更新了哪些页面。
