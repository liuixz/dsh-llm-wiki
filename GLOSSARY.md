# dsh-llm-wiki

一个 DeepSeek Harness 插件，把 Karpathy 式的 LLM Wiki（本地 Markdown 知识库 + 向量召回 + 会话归档）接进 DSH：Host 半边注入系统提示与管线命令，另有若干零依赖脚本负责索引、体检、同步与计划任务。本文件只定义这个项目自己的词汇。

## Language

**面板（Panel）**：
DSH 界面里由本插件注册的一块常驻 UI，用来查看与修改本插件的配置、计划任务和运行记录。
_Avoid_: 控制台、管理后台、dashboard

**配置层（Config Layer）**：
保存同一配置项的一个物理位置。本插件的 `vault` 同时存在于 profile 的 `cordis.patch.yml`、5 个计划任务包装脚本、安装脚本默认值和各脚本硬编码默认值四个层里。
_Avoid_: 配置源、配置位置

**真源（Source of Truth）**：
唯一被读取、其余层只作参考的那个配置层。本项目的真源是 profile 的 `cordis.patch.yml`。
_Avoid_: 主配置、原始配置

**漂移（Drift）**：
某一配置层的值与真源不一致的状态。面板只展示漂移，不代为修正。
_Avoid_: 冲突、不一致

**管线运行（Pipeline Run）**：
一次 `llm-wiki-pipeline.mjs` 的进程执行，可能是 `--all` 全链，也可能是 `--lint`、`--index`、`--sync`、`--okf` 等单步。
_Avoid_: 任务、job、同步

**计划任务（Scheduled Task）**：
由操作系统调度器（Windows 任务计划程序 / systemd timer）按时间触发的管线运行，共五个。
_Avoid_: 定时器、cron

**运行历史（Run History）**：
从 vault 的 `log.md` 中解析出的历次管线运行记录，含时间、动作与结果摘要。
_Avoid_: 日志、审计

**降级（Degraded Mode）**：
面板无法注册进 DSH 界面时，改由右栏浏览器标签承载同一份页面的状态。
_Avoid_: 回退、fallback
