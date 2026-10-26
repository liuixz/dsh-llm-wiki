#!/usr/bin/env bash
# dsh-llm-wiki 安装脚本（Linux / WSL）
#
# 默认「本地仓库 link」模式：把本仓库作为 link: 依赖注册进 DSH profile，
# 之后改仓库代码即生效（重启 dsh 即可），不必再往 ~/.dsh/bin 或 profile 里拷插件文件。
#
# 用法：
#   ./install.sh                  # link 安装 + 技能 + systemd
#   ./install.sh --no-systemd     # 跳过 systemd
#   ./install.sh --no-install     # 只改配置，不跑 pnpm install
#   DSH_PROFILE=web ./install.sh  # 装到别的 profile（默认 desktop）
#   ./install.sh --copy-mode      # 旧的手工部署方式（拷脚本到 ~/bin，不推荐）
#   ./install.sh --uninstall      # 卸载（可选保留 vault 数据）
set -euo pipefail

REPO=$(cd "$(dirname "$0")" && pwd)
VAULT=${LLM_WIKI_VAULT:-/mnt/d/学习/AI知识库/LLM-Wiki}
PROFILE=${DSH_PROFILE:-desktop}
DSH_HOME=${DSH_HOME:-$HOME/.dsh}
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
BIN=${DSH_BIN:-$HOME/bin}
LOG_DIR="$DSH_HOME/llm-wiki"
REPORTS=${LLM_WIKI_REPORTS:-$LOG_DIR/reports}
SCRIPTS="llm-wiki-pipeline.mjs wiki-retrieval.mjs wiki-router.mjs profile-extract.mjs profile-distill.mjs session-compile-candidates.mjs stale-review.mjs pipeline-health.mjs weekly-summary.mjs embed-proxy.mjs"

NO_SYSTEMD=0
NO_INSTALL=0
COPY_MODE=0
UNINSTALL=0
for a in "$@"; do
  case "$a" in
    --no-systemd) NO_SYSTEMD=1 ;;
    --no-install) NO_INSTALL=1 ;;
    --copy-mode)  COPY_MODE=1 ;;
    --uninstall)  UNINSTALL=1 ;;
    -h|--help)    sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知参数: $a" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- 卸载
if [ "$UNINSTALL" = 1 ]; then
  echo "==> 卸载 dsh-llm-wiki"
  node -e '
    const fs=require("fs"),p=process.argv[1];
    if(!fs.existsSync(p)) process.exit(0);
    const j=JSON.parse(fs.readFileSync(p,"utf8"));
    if(j.dependencies) delete j.dependencies["dsh-llm-wiki"];
    const b=j.dsh&&j.dsh.profile&&j.dsh.profile.bundles;
    if(Array.isArray(b)) j.dsh.profile.bundles=b.filter(x=>x!=="dsh-llm-wiki");
    fs.writeFileSync(p, JSON.stringify(j,null,2)+"\n");
    console.log("    已从 "+p+" 移除依赖与 bundle");
  ' "$PROFILE_DIR/package.json"
  rm -rf "$HOME/.agents/skills/wiki-search" "$HOME/.agents/skills/wiki-write"
  rm -f "$PROFILE_DIR/dsh-llm-wiki.mjs"
  for s in $SCRIPTS; do rm -f "$BIN/$s"; done
  rm -f "$BIN/profile-schema.json"
  for u in llm-wiki-pipeline.service llm-wiki-pipeline.timer llm-wiki-compile-candidates.service llm-wiki-compile-candidates.timer llm-wiki-stale-review.service llm-wiki-stale-review.timer llm-wiki-weekly-summary.service llm-wiki-weekly-summary.timer profile-distill.service profile-distill.timer embed-proxy.service; do
    systemctl --user disable --now "$u" 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/$u"
  done
  systemctl --user daemon-reload 2>/dev/null || true
  echo "    已移除文件与服务。如 profile 的 cordis.patch.yml 里还留有 llm-wiki 段，请手动删除。"
  echo "    如仍需要 node_modules 同步：pnpm --dir \"$PROFILE_DIR\" install"
  exit 0
fi

# ---------------------------------------------------------------- 旧手工模式
if [ "$COPY_MODE" = 1 ]; then
  echo "==> copy 模式（旧）：插件文件 -> profile 目录"
  mkdir -p "$PROFILE_DIR"
  cp "$REPO/plugin/dsh-llm-wiki.mjs" "$PROFILE_DIR/"
  PATCH="$PROFILE_DIR/cordis.patch.yml"
  if [ -f "$PATCH" ] && grep -q 'id: llm-wiki' "$PATCH"; then
    echo "     cordis.patch.yml 已含 llm-wiki，跳过"
  else
    [ -f "$PATCH" ] && cp "$PATCH" "$PATCH.bak-$(date +%Y%m%d-%H%M%S)"
    cat >> "$PATCH" <<'EOF'

# dsh-llm-wiki（LLM-Wiki 生命周期插件）
- insert:
    - id: llm-wiki
      name: ./dsh-llm-wiki.mjs
      config:
EOF
    echo "        vault: $VAULT" >> "$PATCH"
    echo "     已追加 insert（重启 dsh 生效）"
  fi
else
  # ------------------------------------------------------------ link 模式
  echo "==> 1/4 注册本地仓库 -> $PROFILE_DIR"
  mkdir -p "$PROFILE_DIR"
  [ -f "$PROFILE_DIR/package.json" ] || { echo "找不到 profile package.json: $PROFILE_DIR/package.json" >&2; exit 1; }
  BAK="$PROFILE_DIR/package.json.bak-link-$(date +%Y%m%d-%H%M%S)"
  cp "$PROFILE_DIR/package.json" "$BAK"
  echo "     备份: $BAK"
  node -e '
    const fs=require("fs");
    const [p, spec] = process.argv.slice(1);
    const j=JSON.parse(fs.readFileSync(p,"utf8"));
    j.dependencies = j.dependencies || {};
    j.dependencies["dsh-llm-wiki"] = spec;
    j.dsh = j.dsh || {};
    j.dsh.profile = j.dsh.profile || {};
    const b = Array.isArray(j.dsh.profile.bundles) ? j.dsh.profile.bundles.slice() : [];
    if(!b.includes("dsh-llm-wiki")) b.push("dsh-llm-wiki");
    j.dsh.profile.bundles = b;
    fs.writeFileSync(p, JSON.stringify(j,null,2)+"\n");
    console.log("    dependency: dsh-llm-wiki = "+spec);
    console.log("    bundle: dsh-llm-wiki");
  ' "$PROFILE_DIR/package.json" "link:$REPO"

  if [ "$NO_INSTALL" = 0 ]; then
    if command -v pnpm >/dev/null 2>&1; then
      echo "==> pnpm install（把 link 落到 node_modules）"
      pnpm --dir "$PROFILE_DIR" install || echo "     pnpm 非零退出；若 node_modules 里没有 dsh-llm-wiki 请手动重跑"
    else
      echo "    pnpm 不在 PATH；请手动执行: pnpm --dir \"$PROFILE_DIR\" install"
    fi
  fi

  echo "==> 2/4 配置覆盖 -> cordis.patch.yml"
  PATCH="$PROFILE_DIR/cordis.patch.yml"
  # 新标记以 "# llm-wiki:" 开头；旧手工部署的块以 "# dsh-llm-wiki" 开头，两者不重叠。
  MARK='# llm-wiki: config override (entry from this repo bundle patch)'
  if [ -f "$PATCH" ] && grep -qE 'name:[[:space:]]*\./dsh-llm-wiki\.mjs|^[[:space:]]*#[[:space:]]*dsh-llm-wiki' "$PATCH"; then
    cp "$PATCH" "$PATCH.bak-$(date +%Y%m%d-%H%M%S)"
    echo "     检测到旧的手工 insert 块，已备份，正在清理"
    node - "$PATCH" <<'JS'
// 删掉以 "# dsh-llm-wiki" 注释开头的 - insert: 块（连同其缩进子行）以及注释行本身
const fs = require('fs');
const p = process.argv[2];
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
const out = [];
let i = 0;
while (i < lines.length) {
  const ln = lines[i];
  if (/^\s*#\s*dsh-llm-wiki/.test(ln)) { i++; continue; }
  if (/^\s*-\s*insert:\s*$/.test(ln)) {
    let j = i + 1;
    const block = [];
    while (j < lines.length && /^\s{4,}\S/.test(lines[j])) { block.push(lines[j]); j++; }
    if (block.join('\n').includes('llm-wiki')) { i = j; continue; }
  }
  out.push(ln);
  i++;
}
fs.writeFileSync(p, out.join('\n').replace(/\s+$/, '') + '\n');
JS
  fi
  if [ -f "$PATCH" ] && grep -qE '^[[:space:]]*-[[:space:]]*id:[[:space:]]*llm-wiki[[:space:]]*$' "$PATCH"; then
    # 已存在：只确保 vault 是最新值，其余保持原样
    # vault 通过临时文件传入 node：Git-Bash/MSYS 会把形如 /x/y 的环境变量和参数
    # 自动改写成 Windows 路径（如 C:/Users/.../srv/vault），经文件传值可完全避开。
    VANIT="$(echo "$VAULT" | sed 's#\\#/#g')"
    VWANT_FILE="$(mktemp)"
    printf '%s' "$VANIT" > "$VWANT_FILE"
    UPDATED=$(node - "$PATCH" "$VWANT_FILE" <<'JS'
const fs = require('fs');
const p = process.argv[2];
const want = fs.readFileSync(process.argv[3], 'utf8');
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
let inBlock = false, changed = false;
const out = lines.map((ln) => {
  if (/^\s*-\s*id:\s*llm-wiki\s*$/.test(ln)) { inBlock = true; return ln; }
  if (/^\s*-\s*id:/.test(ln)) { inBlock = false; return ln; }
  if (inBlock && /^(\s+)vault:\s*/.test(ln)) {
    const want2 = RegExp.$1 + 'vault: ' + want;
    if (ln !== want2) { changed = true; return want2; }
  }
  return ln;
});
if (changed) {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  fs.copyFileSync(p, p + '.bak-' + ts);
  fs.writeFileSync(p, out.join('\n'));
}
process.stdout.write(changed ? 'yes' : 'no');
JS
)
    rm -f "$VWANT_FILE"
    if [ "$UPDATED" = "yes" ]; then
      echo "     已存在 id: llm-wiki，vault 已更新为 $VAULT"
    else
      echo "     已存在 id: llm-wiki 配置覆盖（vault 无需变更）"
    fi
  else
    {
      echo ''
      echo "$MARK"
      echo '# 入口由本仓库的 bundle patch 提供（name: dsh-llm-wiki -> plugin/dsh-llm-wiki.mjs），'
      echo '# 这里只做配置覆盖，不要重复 insert。'
      echo '- id: llm-wiki'
      echo '  config:'
      echo "    vault: ${VAULT//\\//}"
    } >> "$PATCH"
    echo "     已写入 id: llm-wiki 配置覆盖"
  fi
fi

# ---------------------------------------------------------------- 技能
echo "==> 3/4 技能 -> $HOME/.agents/skills/"
mkdir -p "$HOME/.agents/skills/wiki-search" "$HOME/.agents/skills/wiki-write"
cp "$REPO/skills/wiki-search/SKILL.md" "$HOME/.agents/skills/wiki-search/"
cp "$REPO/skills/wiki-write/SKILL.md"  "$HOME/.agents/skills/wiki-write/"

# ---------------------------------------------------------------- 定时任务
echo "==> 4/4 定时任务"
if [ "$COPY_MODE" = 1 ]; then
  echo "     脚本 -> $BIN"
  mkdir -p "$BIN"
  for s in $SCRIPTS; do cp "$REPO/scripts/$s" "$BIN/"; chmod +x "$BIN/$s"; done
  cp "$REPO/scripts/profile-schema.json" "$BIN/"
  SCRIPT_DIR="$BIN"
else
  SCRIPT_DIR="$REPO/scripts"
fi

if [ "$NO_SYSTEMD" = 1 ]; then
  echo "     已跳过（--no-systemd）"
elif ! command -v systemctl >/dev/null 2>&1; then
  echo "     无 systemd；请自行用 cron 调度 $SCRIPT_DIR/llm-wiki-pipeline.mjs --all"
else
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR" "$LOG_DIR" "$REPORTS"
  NODE_BIN=$(command -v node)
  install_unit() {  # $1=源文件名 $2=ExecStart 命令
    sed -e "s#@SCRIPT_DIR@#$SCRIPT_DIR#g" -e "s#@REPO@#$REPO#g" -e "s#@VAULT@#$VAULT#g" \
        -e "s#@LOGDIR@#$LOG_DIR#g" -e "s#@REPORTS@#$REPORTS#g" \
        -e "s#@EXEC@#$2#g" "$REPO/systemd/$1" > "$UNIT_DIR/$1"
  }
  # pipeline（每日）
  install_unit llm-wiki-pipeline.service "$NODE_BIN $SCRIPT_DIR/llm-wiki-pipeline.mjs --all"
  install_unit llm-wiki-pipeline.timer   ''
  # 其余周任务：生成 service+timer（内容较小，直接落盘）
  mk_weekly() {  # $1=名字 $2=描述 $3=命令 $4=OnCalendar
    cat > "$UNIT_DIR/$1.service" <<EOF
[Unit]
Description=$2
After=network.target

[Service]
Type=oneshot
Environment=LLM_WIKI_VAULT=$VAULT
Environment=LLM_WIKI_REPORTS=$REPORTS
ExecStart=$3
UMask=077
EOF
    cat > "$UNIT_DIR/$1.timer" <<EOF
[Unit]
Description=$2

[Timer]
OnCalendar=$4
Persistent=true
RandomizedDelaySec=600

[Install]
WantedBy=timers.target
EOF
  }
  NODE_BIN=$(command -v node)
  mk_weekly llm-wiki-compile-candidates "LLM-Wiki 编译候选清单（周）" "$NODE_BIN $SCRIPT_DIR/session-compile-candidates.mjs --out $REPORTS" "Sun *-*-* 09:20:00"
  mk_weekly llm-wiki-stale-review      "LLM-Wiki 保鲜复核（周）"      "$NODE_BIN $SCRIPT_DIR/stale-review.mjs --limit 20 --out $REPORTS" "Sun *-*-* 09:40:00"
  mk_weekly llm-wiki-weekly-summary    "LLM-Wiki 周报（周）"           "$NODE_BIN $SCRIPT_DIR/weekly-summary.mjs" "Sun *-*-* 09:50:00"
  mk_weekly profile-distill            "LLM-Wiki 画像蒸馏（周）"       "$NODE_BIN $SCRIPT_DIR/profile-distill.mjs --since 7d --out $REPORTS" "Sun *-*-* 09:00:00"
  install_unit embed-proxy.service "$NODE_BIN $SCRIPT_DIR/embed-proxy.mjs"
  systemctl --user daemon-reload 2>/dev/null || true
  for t in llm-wiki-pipeline.timer llm-wiki-compile-candidates.timer llm-wiki-stale-review.timer llm-wiki-weekly-summary.timer profile-distill.timer; do
    systemctl --user enable --now "$t" 2>/dev/null || echo "     （未能启用 $t，可稍后手动 systemctl --user enable --now $t）"
  done
  systemctl --user enable --now embed-proxy.service 2>/dev/null || true
  echo "     已安装 5 个 timer（Pipeline 10:00 / Profile 09:00 / Compile 09:20 / Stale 09:40 / Weekly 09:50）"
fi

echo ""
echo "安装完成。"
echo "  仓库:   $REPO"
echo "  vault:  $VAULT"
echo "  报告:   $REPORTS"
echo "  首次全量: node $SCRIPT_DIR/llm-wiki-pipeline.mjs --all"
echo "  健康快照: node $SCRIPT_DIR/pipeline-health.mjs"
echo "  重启 dsh 使插件生效"
