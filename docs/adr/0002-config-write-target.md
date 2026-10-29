# 面板只写 profile 的 cordis.patch.yml，其余配置层只展示漂移

`vault` 这个值现在躺在四个地方：profile 的 `cordis.patch.yml`、五个计划任务包装脚本（`.cmd` / systemd unit）、`install.ps1` 的四级回退默认值、以及六个脚本各自的硬编码默认值。用户要求面板能改配置，但没说改哪一层。

决定只写 profile 的 `cordis.patch.yml`。理由是只有这一层真的被插件读到——Host 半边在 `apply()` 时读它，再把 vault 覆盖成子进程的 `LLM_WIKI_VAULT`；其余三层要么只在安装时用过一次，要么只是脚本单独运行时的兜底。写第二层（`.cmd`）意味着面板要去改系统调度器生成的包装脚本，风险与收益不成比例。

## Consequences

- 面板改完配置后，`.cmd` 里的旧路径仍然存在。这不是 bug，是「漂移」，面板把它列出来供人看见，但不代为修正。
- 改动要重启 DSH 才生效（`apply()` 只在加载时读 config），面板写完必须明说这一点。
- `install.ps1 -Vault` 目前只同步前两层，这条不一致仍然存在，属于安装脚本的已知限制，不归面板管。

## Considered Options

- **写 profile + 同步五个 `.cmd`**：一致性好，但面板就得修改计划任务生成的包装脚本，出错会连带把任务弄坏。
- **全部只读**：最安全，但用户要的「配置管理」就没了。
