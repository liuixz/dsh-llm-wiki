# ADR-0004：凭据与配置项分开管理

## 状态

已采纳（2026-10-31）

## 背景

面板原本只有「配置项」一个概念：从 profile 的 `cordis.patch.yml` 读出四项（`vault` / `previewOrder` / `rulesOrder` / `mainAgentOnly`），经 `/api/state` 原样送到浏览器，界面上以表格逐行内联编辑。

现在要新增 `SF_API_KEY`（硅基流动的 key，用于记忆体向量化与会话语义索引）。它和前四项有本质区别：

- **存放位置不同**：前四项在 `cordis.patch.yml`，它必须写在 `~/.dsh/.credentials.yaml` 的 `refs` 里——仓库里四处脚本（`llm-wiki-pipeline.mjs:1015`、`wiki-router.mjs:132`、`profile-extract.mjs:27`、`profile-distill.mjs:168`）都是按这个位置读它的。
- **密级不同**：前四项公开无害，它是真凭据。
- **写入需要验证**：前四项写错只影响功能，它写错会让向量化静默失败（`mnemon import` 在无 embedding 时仍报 `errors:0`，只是 `embedding` 存 NULL）。

如果把 `SF_API_KEY` 直接加进 `CONFIG_KEYS`，按现有逻辑走 `/api/state` 会**把明文送到前端**。而 DSH 桌面版的 `webServer` 没有全局鉴权（官方 README 明说 `Binding a non-loopback address still exposes unprotected routes`），同机任何进程打 `127.0.0.1:<port>` 都能读到那个 JSON。

## 决策

**凭据与配置项分成两个概念、两条链路、两套接口。**

1. **配置项**（`CONFIG_KEYS`）继续走 `cordis.patch.yml`，`/api/state` 正常回显，界面上改为表单式布局（每项一行：键名 + 灰色说明 + 值 + 操作）。
2. **凭据**（`SECRET_KEYS = ["SF_API_KEY"]`）走 `~/.dsh/.credentials.yaml`，**只写不读**：
   - `GET /api/secret` 只返回 `{key, label, service, desc, impact, configured, hint, length}`，其中 `hint` 是 `sk-…8gOE0` 形式（首三位 + 省略号 + 末四位，长度 ≤8 时全打码）。明文永远不出进程。
   - `POST /api/secret` 接收新值，**先打一次真实接口验证**（`POST https://api.siliconflow.cn/v1/embeddings`，模型 `BAAI/bge-m3`，`input:["ping"]`），只有拿到 200 才落盘。
   - `DELETE /api/secret` 整行删除该键（不是写空串），并提示「向量检索将降级为关键词匹配」。
3. **三个凭据接口 + `POST /api/reveal` 限定回环来源**：检查 `req.socket.remoteAddress` 是否为 `127.0.0.1` / `::1` / `::ffff:127.0.0.1`，否则 403。其余接口（`/api/state`、`/api/run` 等）不加限制——它们不含密级数据。
4. **失败必须原样透出接口的 code 与 message**：形如 `HTTP 401 · code 30014 · Token is invalid.`，而不是笼统的「保存失败」。

## 后果

- 面板上「凭据」和「配置项」是两个分开的卡片，视觉与语义都不混。
- 用户换 key 时看不到旧 key 的任何片段（除了末四位），符合凭据最小暴露原则。
- **保存凭据不需要重启 DSH**：四处脚本都是每次进程启动时 `readFileSync` 读凭据文件，面板 `spawn` 管线是新进程，写完下一次运行就生效。这一点与配置项（改 `cordis.patch.yml` 要重启）不同，界面上必须分别提示。
- **存了 key 不等于有向量**：现有 341 条记忆的 `embedding` 全是 NULL（`mnemon embed --status` 报 `coverage: 0%`），必须另跑 `mnemon embed --all` 回填。所以面板同时提供「向量化状态」块与「回填向量」按钮，否则用户配完 key 看不出任何变化。
- 回填走面板自己的进程管理（`spawn` + 共用同一把 `.pipeline.lock`），避免与管线运行撞车。
- 验证接口需要联网。断网时允许勾选「跳过验证」直接落盘——用户自己承担风险，但至少不会被卡死无法配置。

## 考虑过的其他方案

- **把 key 放进 `cordis.patch.yml` 的新 config 键**：写入链路现成，但要改四处脚本的读取逻辑，且明文会进 `/api/state`。否决。
- **独立的 `.secrets.json`**：多一个文件、多一处备份与迁移负担，而现有脚本一个都不认它。否决。
- **默认掩码 + 「显示」按钮**：桌面版无 server-wide 鉴权，点一下就能拿到明文，等于没有保护。否决。
- **只做格式检查不做真实验证**：`sk-` 前缀谁都编得出来，格式对但 key 是死的照样静默失败。否决。
