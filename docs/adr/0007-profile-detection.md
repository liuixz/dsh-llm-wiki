# ADR-0007 面板的 profile 判定：不猜，猜不出就报错

状态：已采纳（0.13.6）

## 背景

在别人的机器上，插件装好后在设置面板里改配置，改完不生效——因为写进的是**另一个 profile** 的 `cordis.patch.yml`。

`plugin/panel/config.mjs` 的 `detectProfile()` 原来按「env → 扫 profile 目录 → 兜底 desktop」判定，三处缺陷叠加：

1. **`DSH_PROFILE` 通常拿不到。** 这个变量由 `dsh-shell-env` 注入给**模型 shell 调用**，插件进程自己的 `process.env` 里没有。判定于是几乎总是走到后面的猜测。
2. **按文本匹配分不清真装与借用。** 判据是 `profiles/<n>/package.json` 里含 `"dsh-llm-wiki"` 字样。但 `profiles/desktop/node_modules/dsh-llm-wiki` 若是指向 `profiles/tctwork/...` 的符号链接，desktop 自己的 package.json 里同样有这几个字，两个都算命中。
3. **`if (hits.includes("desktop")) return "desktop"`。** 命中里只要有 desktop 就直接返回——**任何机器、任何 active profile 都会被判成 desktop**。

后果分三档，严重度递增：

| 功能 | 后果 |
|---|---|
| 「全量」等管线运行 | 侥幸正确——`scripts/llm-wiki-pipeline.mjs` 在 win32 有自己的兜底 vault 路径，刚好和真实 vault 撞上 |
| 面板显示的 profile / vault / 漂移 | 错——读的是 desktop 的 patch，里面可能是 WSL 风格的 `/mnt/d/...` 路径 |
| **面板保存配置** | **写错文件**——`/api/config` 用 `ctx.profile()` 拼路径，改动落进从不生效的那个 profile |

## 决策

### 1）四级判定链，每一级都有明确理由

`detectProfile(packageRoot, hint)`：

| 级 | 来源 | 为什么在这一级 |
|---|---|---|
| 1 | `DSH_PROFILE` / `DSH_PROFILE_DIR` | shell 派生进程与 CI 下最准；虽然插件进程常拿不到，拿到就是权威 |
| 2 | `hint` = `ctx.profileContext.name` | **桌面版 launcher 提供的运行时 profile 事实**，插件进程里唯一权威来源。优先级必须高于任何文件推断 |
| 3 | `$DSH_HOME/desktop-next.json` 的 `active` | 「用户上次选了哪个 profile」，重启后仍在。文件缺省、`active` 指向不存在的目录、名字非法（`../evil`、`con`）都忽略 |
| 4 | 扫 `profiles/<n>/package.json` 依赖本包 | 兜底发现；但必须用 realpath 排除「借用了别的 profile 的安装」 |

第 4 级的判据是**不能只看文本**：`realpathSync(node_modules/dsh-llm-wiki)` 之后，落在 `profiles/<别的>/` 之内 → 那是别人的；落在 `profiles/` 之外（`link:D:/project/...` 工作区开发安装）或落在自己目录内 → 算自己的。

### 2）判不出来返回 `null`，不返回任何猜测值

- 多个 profile 都真装了本包 → `null`。以前取字典序第一个，等价于掷骰子。
- 一级都不同时命中 → `null`。

### 3）`null` 一路传到底，不留半截

| 位置 | 行为 |
|---|---|
| `readConfigState(vault, null)` | 真源层 `path` 留空、`unresolvable: true`、带 `error` 说明；不拼 `profiles/null/cordis.patch.yml` |
| `writeConfigKey(null, ...)` | 直接抛错，**不做任何落盘** |
| `POST /api/config` | 返回 **409 + `reasonCode: "PROFILE_UNKNOWN"`** |
| 面板 | `data.profile` 为空时卡片提示「判不出 profile」，下面多一张警示卡解释原因与影响范围（写明「管线运行照常」） |

### 4）子进程显式传 vault

`server.mjs` 面板 startRun 的 `spawn` env 补 `LLM_WIKI_VAULT: currentVault()`。原来只传 `LLM_WIKI_PANEL`，管线只能靠自己的 win32 兜底路径——「面板显示的 vault」与「实际写入的 vault」不一致时，用户会以为配置生效了。`session/disposed` 那条路径早已显式传，现在两条一致。

### 5）profile 服务现场取，不在 apply 时缓存

`ctx.get("profileContext")` 可能晚于本插件挂载（和 `webServer` 同理），所以 `currentProfileName()` 每次调用时重新取，而不是 apply 时取一次存起来。也**不**把 `profileContext` 写进静态 `inject` 数组：非桌面平台可能没有这个服务，写进去会让整个插件（含提示词注入）都不激活。

## 被否方案

### 否：仍然兜底 desktop，只加一条漂移提示

用户看不出「漂移提示」和「配置真的生效了」的区别，改错文件的损失远大于一次显式报错的摩擦。

### 否：拿 `process.cwd()` 推断 profile

`cwd` 是**工作区**，不是 profile。同一个 profile 可以开多个工作区，同一个工作区也能在不同 profile 下打开。

### 否：把 `profileContext` 写进静态 `inject`

非桌面平台（headless / web）没有这个服务，静态 inject 会让插件整体不激活，连带提示词注入一起失效。

### 否：让 `writeConfigKey` 自己兜底找 profile

写入是**不可逆副作用**。让副作用自己去猜目标文件，是最危险的一种「方便」。判定必须发生在读的时候、由调用方明确传入。

## 后果

- 新增 `test/profile-detect.mjs`（16 项）：临时 `DSH_HOME` 造 `alpha`（唯一真装）/ `beta`（junction 借用 alpha）/ `gamma`（第二个真装）三种布局，逐条验四级链、null 传播、非法名拒绝、hint 优先级。`npm test` 里排第一。
- 这台机器（`desktop` 唯一 active、`link:D:/project/...` 安装）判定结果为 `desktop`，与修复前一致——所以本机**复现不出症状**，改动靠测试套保证。
- 用户若在某些环境下看到「判不出 profile」，管线运行与历史查看不受影响，只是暂时改不了配置。
