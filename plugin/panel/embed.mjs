/**
 * plugin/panel/embed.mjs —— 向量化状态与回填（零外部依赖）
 *
 * 为什么面板要管这件事（ADR-0004 的补充）：
 *   存了 SF_API_KEY ≠ 有向量。已有的 341 条记忆体 embedding 是 NULL，
 *   `mnemon embed --status` 报 coverage 0%。用户配完 key 回来看覆盖率还是 0，
 *   会以为功能没做成。所以面板必须能显示覆盖率，并能一键回填。
 *
 * 回填为什么不能简单跑 `mnemon embed --all`：
 *   mnemon 自己读不到 DSH profile 的配置，必须由调用方注入
 *   MNEMON_EMBED_ENDPOINT / _MODEL / _PROTOCOL=openai / _API_KEY。
 *   漏掉 PROTOCOL 它会默认 ollama 去打 nomic-embed-text（本机没装）。
 *   本文件复刻 llm-wiki-pipeline.mjs 里 mnemonCli()/mnemonEnv() 的逻辑。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

import { dshHome } from "./config.mjs";

/** 与 llm-wiki-pipeline.mjs:1015 readEmbedKey() 保持完全一致的三级回退 */
export function readEmbedKey() {
  if (process.env.MNEMON_EMBED_API_KEY) return process.env.MNEMON_EMBED_API_KEY;
  if (process.env.EMBED_KEY) return process.env.EMBED_KEY;
  try {
    const cred = readFileSync(join(dshHome(), ".credentials.yaml"), "utf8");
    const m = cred.match(/^\s*SF_API_KEY:\s*(\S+)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  } catch {}
  try {
    const legacy = JSON.parse(readFileSync(join(homedir(), ".modlens", "config.json"), "utf8"));
    return legacy.apiKey || legacy.key || "";
  } catch {}
  return "";
}

/** 与 llm-wiki-pipeline.mjs:1031 mnemonCli() 一致 */
export function mnemonCli() {
  if (process.env.MNEMON_CLI_PATH && existsSync(process.env.MNEMON_CLI_PATH)) {
    return { command: process.env.MNEMON_CLI_PATH, shell: false };
  }
  const bin = process.platform === "win32" ? "mnemon.exe" : "mnemon";
  const pkg = process.platform === "win32" ? "mnemon-win32-x64" : "mnemon-linux-x64";
  const rel = ["@mnemon-dev", "mnemon", "node_modules", "@mnemon-dev", pkg, "bin", bin];
  const roots = [];
  if (process.env.APPDATA) roots.push(join(process.env.APPDATA, "npm", "node_modules"));
  if (process.env.ProgramFiles) roots.push(join(process.env.ProgramFiles, "nodejs", "node_modules"));
  if (process.env.NVM_HOME) roots.push(join(process.env.NVM_HOME, "node_modules"));
  if (process.env.LOCALAPPDATA) roots.push(join(process.env.LOCALAPPDATA, "npm", "node_modules"));
  for (const dir of (process.env.PATH || "").split(process.platform === "win32" ? ";" : ":")) {
    if (!dir) continue;
    roots.push(join(dir, "node_modules"));
    roots.push(join(dir, "..", "lib", "node_modules"));
  }
  for (const r of roots) {
    const p = join(r, ...rel);
    if (existsSync(p)) return { command: p, shell: false };
  }
  return { command: "mnemon", shell: process.platform === "win32" };
}

/** 与 llm-wiki-pipeline.mjs:1052 mnemonEnv() 一致 */
export function embedEnv() {
  const endpoint = process.env.MNEMON_EMBED_ENDPOINT || process.env.EMBED_ENDPOINT || "https://api.siliconflow.cn/v1";
  const env = {
    ...process.env,
    MNEMON_EMBED_ENDPOINT: endpoint,
    MNEMON_EMBED_MODEL: process.env.MNEMON_EMBED_MODEL || process.env.EMBED_MODEL || "BAAI/bge-m3",
    MNEMON_EMBED_PROTOCOL: process.env.MNEMON_EMBED_PROTOCOL || "openai",
  };
  const key = readEmbedKey();
  if (key) env.MNEMON_EMBED_API_KEY = key;
  return env;
}

/**
 * 读向量化状态。**只读，不改库**。
 * @returns {{available:boolean, coverage:string, embedded:number, total:number, pct:number,
 *            model:string, protocol:string, embeddingAvailable:boolean, ollamaAvailable:boolean,
 *            keyConfigured:boolean, reason:string}}
 */
export function readEmbedStatus() {
  const keyConfigured = readEmbedKey() !== "";
  const base = {
    available: false,
    coverage: "",
    embedded: 0,
    total: 0,
    pct: 0,
    model: "",
    protocol: "",
    embeddingAvailable: false,
    ollamaAvailable: false,
    keyConfigured,
    reason: "",
  };
  let cli;
  try {
    cli = mnemonCli();
  } catch (e) {
    return { ...base, reason: "找不到 mnemon 命令: " + (e && e.message ? e.message : String(e)) };
  }
  let r;
  try {
    r = spawnSync(cli.command, ["embed", "--status"], {
      env: embedEnv(),
      shell: cli.shell === true,
      encoding: "utf8",
      timeout: 20000,
      windowsHide: true,
    });
  } catch (e) {
    return { ...base, reason: "调用 mnemon 失败: " + (e && e.message ? e.message : String(e)) };
  }
  const out = String((r && r.stdout) || "");
  const errOut = String((r && r.stderr) || "");
  if (r && r.error) return { ...base, reason: "调用 mnemon 失败: " + r.error.message };
  let parsed = null;
  const at = out.indexOf("{");
  if (at >= 0) {
    try {
      parsed = JSON.parse(out.slice(at));
    } catch {
      parsed = null;
    }
  }
  if (!parsed) {
    return { ...base, reason: "mnemon embed --status 输出无法解析 · " + (errOut || out).slice(0, 200) };
  }
  const total = Number(parsed.total_insights || 0);
  const embedded = Number(parsed.embedded || 0);
  const pct = total > 0 ? Math.round((embedded / total) * 100) : 0;
  return {
    available: true,
    coverage: String(parsed.coverage || pct + "%"),
    embedded,
    total,
    pct,
    model: String(parsed.model || ""),
    protocol: String(parsed.protocol || ""),
    embeddingAvailable: !!parsed.embedding_available,
    ollamaAvailable: !!parsed.ollama_available,
    keyConfigured,
    reason: "",
    ...readDbFootprint(),
  };
}

/**
 * 记忆库的实际占用与可回收空间（ADR-0005）。
 * 用户看到的「9 MB」里，活条目正文只占 2.4%，大头是空闲页 + 软删行留下的向量 + edges 索引，
 * 所以面板必须把这三个数分开摆，否则「优化」就变成了删内容。
 */
export function readDbFootprint() {
  const dbPath = join(process.env.MNEMON_DATA_DIR || join(homedir(), ".mnemon"), "data", "default", "mnemon.db");
  if (!existsSync(dbPath)) return { dbPath: "", dbBytes: 0, dbHuman: "", freePct: 0, softDeleted: 0 };
  let db;
  try { db = new DatabaseSync(dbPath, { readOnly: true }); } catch { return { dbPath, dbBytes: 0, dbHuman: "", freePct: 0, softDeleted: 0 }; }
  try {
    const freelist = Number(db.prepare("PRAGMA freelist_count").get().freelist_count) || 0;
    const pageCount = Number(db.prepare("PRAGMA page_count").get().page_count) || 0;
    const softDeleted = Number(db.prepare("SELECT COUNT(*) c FROM insights WHERE deleted_at IS NOT NULL").get().c) || 0;
    const bytes = statSync(dbPath).size;
    return {
      dbPath,
      dbBytes: bytes,
      dbHuman: humanBytes(bytes),
      freePct: pageCount ? Math.round((freelist / pageCount) * 1000) / 10 : 0,
      softDeleted,
    };
  } catch {
    return { dbPath, dbBytes: 0, dbHuman: "", freePct: 0, softDeleted: 0 };
  } finally { try { db.close(); } catch {} }
}

function humanBytes(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
  return n + " B";
}

/** 回填命令的参数（供 server.mjs 的 startRun 用） */
export function backfillArgs() {
  return ["embed", "--all"];
}

/** 回填用的可执行文件（区别于管线脚本） */
export function embedCommand() {
  const cli = mnemonCli();
  return { command: cli.command, shell: cli.shell === true };
}
