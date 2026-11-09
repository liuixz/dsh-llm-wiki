# ADR-0008 vault 不可用时先预检，而不是让它崩在写索引那一步

状态：已采纳（0.13.7）

## 背景

新装插件的机器上点「全量」，报错：

```
LLM-Wiki pipeline | vault: D:/学习/AI知识库/LLM-Wiki
页面数: 0
== lint ==
问题: 0 | 孤立节点: 0 | stale: 0
按类型: {}
pipeline 失败: Error: ENOENT: no such file or directory, open '...\LLM-Wiki\wiki\index.md'
```

三件事叠在一起，才让这条错误如此难读：

1. **vault 指向了一个没有 `wiki/` 的目录**（换机器没同步、或 vault 填错）。
2. `collectPages()` 对不存在的目录**静默跳过**——`existsSync(dir) && isDirectory()` 不成立就不走进去。于是 `页面数: 0`、lint 三项全 0，**先给用户看一排「一切正常」**。
3. `--index` 写顶层索引时**没有建目录**：`writeFileSync(join(WIKI, "index.md"), md)`。同一个文件里的 `rebuildCategoryIndexes()` 一直是 `mkdirSync(dir, {recursive:true})` 之后才写的——分类索引会建目录，顶层不会。

结果：用户读到的信息顺序是「0 / 0 / 0」→ 一段堆栈。前一半让他放心，后一半让他去找 node 的源码。

实测三种 vault 状态：

| vault 状态 | 结果 |
|---|---|
| 目录完全不存在 | `ENOENT wiki\index.md`，exit 1 |
| 目录在、没有 `wiki/` | 同上，exit 1 |
| `wiki/` 在、内容为空 | `已重建 wiki/index.md`，**exit 0** |

八个非索引子命令（`--lint / --sync / --usage / --okf / --docs-sync / --prune-memory / --dsh-export / --compile-patterns`）都不会崩——它们不写顶层索引。所以这个缺陷只在**恰好需要重建索引**且**`wiki/` 不存在**时出现，两个条件都不罕见。

## 决策

### 一、管线自己预检，退出码 2

`body()` 在 `collectPages()` 之前调 `preflightVault()`，只对需要读页面的子命令生效（`--lint / --index / --sync / --usage / --okf / --compile-patterns`）。三种不通过各给各的话：

- vault 目录不存在 → 指出这通常是路径填错或换机器没同步，并给出两条改法（面板改 vault / 先 clone 仓库）。
- vault 不是目录 → 照实说。
- 没有 `wiki/` 子目录 → 说明正常结构是 `<vault>/wiki/<分类>/*.md`，并提示这个 vault 可能为空或不是 LLM-Wiki。

**退出码用 2，不用 1。** 1 留给「跑起来之后出错」。脚本与计划任务据此能分开「配置问题」（重试无用，要人改）与「运行问题」（可能重试有用）。

### 二、`--index` 前补 `mkdirSync(WIKI, {recursive:true})`

即便预检被绕过也不再撞 ENOENT。这是防御性的第二道，不是主修法。

### 三、面板在点击之前就知道

`plugin/panel/server.mjs` 新增 `probeVault(vault)`，随 `/api/state` 返回 `vaultProbe: {ok, state, vault, wikiPath, pages, pageDirs}`：

| state | 含义 |
|---|---|
| `novault` | 配置里 vault 为空 |
| `missing` | 目录不存在 |
| `notdir` | 路径不是目录 |
| `nowiki` | 目录在，没有 `wiki/` |
| `unreadable` | `wiki/` 读不了（权限） |
| `nopages` | `wiki/` 在，一页都没有 |
| `ok` | 有页面 |

只扫 `wiki/` 一层，不递归全文——面板不该为了显示一个红点去走一遍整库。

前端把它作为 `computeHealth()` 的**第 1 条判据**（排在计划任务之前），`bad` 级，文案按 state 分六种。

### 四、「去」按钮按原因跳转

原来 `renderHealth()` 的 bad 动作硬编码 `state.tab = "tasks"`。vault 坏了却把用户送到任务页，等于从坑边推到另一个坑。改为取第一条 `level === "bad"` 的原因上的 `scope`：

- vault 相关问题带 `scope: "config"` → 「去配置项」
- 任务停用照旧 → 「去任务页」

### 五、`nopages` 与 `missing` 分开说

两者的改法完全相反：「目录不存在」要改路径或同步仓库；「目录在但没页面」要导入页面或确认这个 vault 是不是真的 LLM-Wiki。混成一句会让用户去修一个没填错的路径。

## 被否的方案

**让 `collectPages()` 在目录不存在时报错。** 它的静默跳过在别处是有用的（某个分类目录暂时不存在是正常的）；把「vault 整体不可用」这件事压在它身上会让正常路径也变脆。预检放在更外层，职责更清楚。

**面板点「全量」时先探测再放行。** 那就变成运行时拦截：用户点下去、等一秒、被拒绝。状态已经在 `/api/state` 里了，红灯应该在他点之前就在那儿。

**把 exit 1 用于所有失败。** 计划任务与脚本无法区分「重试无用」与「重试可能有用」，会在配置问题上反复重试。

**在 `wiki/index.md` 失败时捕获并重试。** 掩盖了真正的问题（vault 是错的），下次换个子命令还是错。

## 验证

- `test/panel-e2e.mjs` **57 项**（原 52）：新增 8e 段断言横幅 `is-bad`、文案写明「不存在」、按钮指向配置项且**不出现**「去任务页」、`nopages` 与 `missing` 文案互相排斥。
- `test/preview.html` 加 `?vault=missing|nowiki|nopages`、`test/shot.mjs` 加 `--vault=<state>`，真 Chrome 截图验收红灯。
- 管线侧手工验：`LLM_WIKI_VAULT="<空目录>" node scripts/llm-wiki-pipeline.mjs --all --no-lock` → exit 2、无堆栈、给出可执行改法；`wiki/` 存在时照旧 exit 0。
