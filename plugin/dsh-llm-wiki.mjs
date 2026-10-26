/**
 * dsh-llm-wiki.mjs —— LLM-Wiki 生命周期插件（P3）
 *
 * 安装方式：作为 DSH bundle 挂载（本包 cordis.patch.yml 里 `insert: - id: llm-wiki / name: dsh-llm-wiki`），
 * profile 的 cordis.patch.yml 只做配置覆盖（vault 等），不重复 insert。
 * 零外部依赖（不 import dsh-tools；只用 node 内置 + ctx）。
 *
 * 功能：
 *  1. systemPrompt 注入：schema.md 守则 + 知识预览（index.md，管线产物）
 *  2. session/disposed → 异步触发 P2 管线（防重入 + 冷却）
 *
 * 配置（cordis.patch.yml config）:
 *  vault:        vault 路径（默认按平台：Windows D:\学习\AI知识库\LLM-Wiki，其他 /mnt/d/学习/AI知识库/LLM-Wiki）
 *  previewOrder: 知识预览 section 顺序（默认 138）
 *  rulesOrder:   守则 section 顺序（默认 139）
 *  mainAgentOnly: 只给主 Agent 注入知识库（默认 true；spawn/fork 出来的子代理不加载）
 *
 * 跨平台说明：
 *  - 管线位置优先取本包自带的 scripts/llm-wiki-pipeline.mjs（从 import.meta.url 解析），
 *    只有它不存在时才回退到 $DSH_HOME/bin/llm-wiki-pipeline.mjs。
 *    这样「本地仓库 link 安装」时改仓库里的 scripts 立即生效，不必再往 ~/.dsh/bin 拷一份。
 *  - 子进程用 process.execPath 启动；DSH Host 设置 ELECTRON_RUN_AS_NODE=1，因此 Electron
 *    exe 会以 Node 方式运行 .mjs。若将来该环境变量消失，可改为显式解析内置 node.exe。
 */
import { readFileSync, statSync, existsSync, readdirSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

export const name = "dsh-llm-wiki";
export const inject = ["systemPrompt"];

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const DSH_HOME = process.env.DSH_HOME || join(process.env.USERPROFILE || homedir(), ".dsh");
const DEFAULT_VAULT = process.platform === "win32"
  ? "D:\\学习\\AI知识库\\LLM-Wiki"
  : "/mnt/d/学习/AI知识库/LLM-Wiki";
// 优先用包内自带脚本（link 安装时即本地仓库），回退到 ~/.dsh/bin 的历史布局
const PIPELINE_BUNDLED = join(PLUGIN_DIR, "..", "scripts", "llm-wiki-pipeline.mjs");
const PIPELINE = existsSync(PIPELINE_BUNDLED) ? PIPELINE_BUNDLED : join(DSH_HOME, "bin", "llm-wiki-pipeline.mjs");
const SESSIONS_ROOT = join(DSH_HOME, "sessions");
const HINT_DIR = join(DSH_HOME, "llm-wiki");
const HINT_FILE = join(HINT_DIR, "compile-hint.json");
const HINT_STATE = join(HINT_DIR, "hint-state.json");
const CACHE_TTL = 60_000; // 读文件缓存 60s

function cached(file, ttl = CACHE_TTL) {
  let last = 0, data = "";
  return () => {
    try {
      const st = statSync(file);
      if (Date.now() - last < ttl && data) return data;
      data = readFileSync(file, "utf8");
      last = Date.now();
      return data;
    } catch { return data || ""; }
  };
}

export function apply(ctx, config = {}) {
  const vault = config.vault && String(config.vault).length > 0 ? config.vault : DEFAULT_VAULT;
  const previewOrder = Number.isInteger(config.previewOrder) ? config.previewOrder : 138;
  const rulesOrder = Number.isInteger(config.rulesOrder) ? config.rulesOrder : 139;
  const rulesFile = join(vault, "schema.md");
  const previewFile = join(vault, "wiki", "index.md");
  const readRules = cached(rulesFile);
  const readPreview = cached(previewFile);
  // 只给主 Agent 注入：子代理（记忆任务 Agent 等）不加载 6KB 知识库，
  // 既省 token，也避免守则干扰子代理自己的专用协议。
  // 判定用 agents.roots()（无 owner 的顶层 agent）；取不到服务时退回旧行为。
  const mainAgentOnly = config.mainAgentOnly !== false;
  const isMainAgent = (context) => {
    if (!mainAgentOnly) return true;
    const agent = context && context.agent;
    if (!agent) return true;
    try {
      const agents = ctx.get("agents");
      if (!agents || typeof agents.roots !== "function") return true;
      const roots = agents.roots();
      if (roots.length === 0) return true;
      return roots.some((item) => item.id === agent.id);
    } catch { return true; }
  };
  try { console.log("[dsh-llm-wiki] apply() vault=" + vault + " rules=" + existsSync(rulesFile) + " preview=" + existsSync(previewFile) + " pipeline=" + existsSync(PIPELINE)); } catch {}

  // ── 1) systemPrompt 注入 ──
  // 知识预览（先于守则，order 更低先出现）
  ctx.effect(() => ctx.systemPrompt.section({
    name: "llm-wiki:preview",
    order: previewOrder,
    text: (context) => {
      if (!isMainAgent(context)) return "";
      const idx = readPreview();
      if (!idx) return "";
      return "\n---\n# LLM-Wiki 知识库（管线自动维护）\n\n" + idx + takeCompileHint() +
        "\n\n**检索入口**：先跑 wiki-router.mjs 分流 → wiki 走 wiki-retrieval 融合检索 / session 走会话语义 / live 直接实测 / docs 走 Documents / hot 看热记忆。\n---\n";
    },
  }), "dsh-llm-wiki.prompt.preview");

  // schema 守则
  ctx.effect(() => ctx.systemPrompt.section({
    name: "llm-wiki:rules",
    order: rulesOrder,
    text: (context) => {
      if (!isMainAgent(context)) return "";
      const schema = readRules();
      if (!schema) return "";
      return "\n---\n# LLM-Wiki 知识库运行规则\n\n" + schema + "\n---\n";
    },
  }), "dsh-llm-wiki.prompt.rules");

  // ── 2) session/disposed → 触发管线 ──
  let lastRun = 0;
  let running = false;
  const COOLDOWN_MS = 60_000;

  const markCompileHint = (session) => {
    try {
      if (process.env.LLM_WIKI_COMPILE_HINT === "off") return;
      const h = (session && (session.header || session.meta || session)) || {};
      const id = h.id || h.sessionId || (session && session.id);
      if (!id) return;
      let logSize = 0;
      for (const rootDir of [SESSIONS_ROOT]) {
        if (!existsSync(rootDir)) continue;
        for (const proj of readdirSync(rootDir)) {
          const dir = join(rootDir, proj, "session-" + id);
          const f = join(dir, "session.v4.jsonl.zstd");
          try { if (existsSync(f)) { logSize = statSync(f).size; break; } } catch {}
        }
      }
      if (logSize < 300 * 1024) return; // 小于 ~300KB 视为短会话，不提示
      mkdirSync(HINT_DIR, { recursive: true });
      writeFileSync(HINT_FILE, JSON.stringify({ sessionId: id, sizeKB: Math.round(logSize / 1024), at: Date.now() }), "utf8");
    } catch {}
  };
  const takeCompileHint = () => {
    try {
      if (!existsSync(HINT_FILE)) return "";
      const h = JSON.parse(readFileSync(HINT_FILE, "utf8") || "{}");
      if (!h || !h.at || Date.now() - h.at > 48 * 3600 * 1000) { try { unlinkSync(HINT_FILE); } catch {} return ""; }
      let st = {};
      try { st = JSON.parse(readFileSync(HINT_STATE, "utf8") || "{}"); } catch {}
      if (st.lastShown && st.lastShown >= h.at) return "";
      mkdirSync(HINT_DIR, { recursive: true });
      writeFileSync(HINT_STATE, JSON.stringify({ lastShown: h.at }), "utf8");
      try { unlinkSync(HINT_FILE); } catch {}
      return "\n> 上个会话较大（约 " + h.sizeKB + "KB），可能有可编译内容：运行 session-compile-candidates.mjs 生成候选，再用 wiki-write 落页（只写决策/排错/可复用结论）。";
    } catch { return ""; }
  };

  const runPipeline = () => {
    if (running) return;
    if (!existsSync(PIPELINE)) {
      try { console.log("[dsh-llm-wiki] pipeline not found, skipped: " + PIPELINE); } catch {}
      return;
    }
    const now = Date.now();
    if (now - lastRun < COOLDOWN_MS) return;
    running = true;
    lastRun = now;
    // 会话结束只做增量同步；全量巡检交给每日 10:00 的计划任务
    const child = spawn(process.execPath, [PIPELINE, "--sync"], {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
      // 管线自身的默认 vault 是 WSL 路径，必须显式传入
      env: { ...process.env, LLM_WIKI_VAULT: vault },
    });
    child.on("exit", (code) => {
      running = false;
      try { console.log("[dsh-llm-wiki] pipeline exit code=" + code); } catch {}
    });
    child.on("error", (e) => {
      running = false;
      try { console.log("[dsh-llm-wiki] pipeline spawn error: " + e.message); } catch {}
    });
    child.unref();
  };

  // 子代理（记忆写入/审查等）结束不需要跑整条管线，避免一次写入触发全量 --all。
  const isSubSession = (session) => {
    if (!session || typeof session !== "object") return false;
    const header = session.header || session.meta || session;
    return header.origin === "subagent" || header.parentSession !== undefined;
  };
  ctx.on("session/disposed", (session) => {
    if (isSubSession(session)) return;
    try { markCompileHint(session); runPipeline(); } catch (e) { try { console.log("[dsh-llm-wiki] hook error: " + e.message); } catch {} }
  });
}
