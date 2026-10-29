/**
 * plugin/panel/server.mjs —— 面板的 Host 半边（零外部依赖）
 *
 * 提供两条路由（同一个 prefix 注册，ADR-0001 的「降级页」）：
 *   GET  /llm-wiki-panel/            降级页（独立 HTML，slot 挂不上时用浏览器标签打开）
 *   GET  /llm-wiki-panel/panel.js    两端共用的界面代码
 *   GET  /llm-wiki-panel/api/state   一次性取全部数据（配置 / 计划任务 / 运行历史 / 锁）
 *   POST /llm-wiki-panel/api/config  改一个配置键
 *   POST /llm-wiki-panel/api/task    启用/停用、改时间
 *   POST /llm-wiki-panel/api/run     跑管线（拒绝并发）
 *   GET  /llm-wiki-panel/api/run     查当前这次运行的输出（面板轮询）
 *
 * 写入路径一律经过 config.mjs / tasks.mjs，本文件只做参数校验与 JSON 包装。
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { CONFIG_KEYS, detectProfile, readConfigState, writeConfigKey } from "./config.mjs";
import { MANAGED_TASKS, readTasks, setTaskEnabled, setTaskTime, IS_WINDOWS } from "./tasks.mjs";
import { buildHistory } from "./history.mjs";
import { readLock, describeLock, forceRelease, acquire, release, enqueue, readQueue, drainQueue } from "../../scripts/pipeline-lock.mjs";

export const PREFIX = "/llm-wiki-panel";
const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(HERE, "..", "..", "web");

/** 面板能跑的五个管线命令（用户决定） */
export const RUN_COMMANDS = [
  { id: "all", label: "全量", args: ["--all"], hint: "lint + index + usage + okf + sync 等全部阶段" },
  { id: "lint", label: "检查", args: ["--lint"], hint: "只查断链 / 孤立 / stale" },
  { id: "index", label: "重建索引", args: ["--index"], hint: "wiki/index.md 与分类索引页" },
  { id: "sync", label: "同步记忆", args: ["--sync"], hint: "写入 mnemon 向量库" },
  { id: "health", label: "体检", args: ["--health"], hint: "pipeline-health.mjs 健康快照" },
];

/** 当前这次由面板拉起的运行（内存里，进程重启即丢） */
let currentRun = null;

/** 面板上下文里的 vault 读取器（registerPanelRoutes 时注入，startRun 里用） */
let vaultReader = () => "";
function currentVault() {
  try {
    return vaultReader();
  } catch {
    return "";
  }
}

function pipelinePath() {
  const bundled = join(HERE, "..", "..", "scripts", "llm-wiki-pipeline.mjs");
  if (existsSync(bundled)) return bundled;
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || "", ".dsh");
  return join(home, "bin", "llm-wiki-pipeline.mjs");
}

function healthPath() {
  const bundled = join(HERE, "..", "..", "scripts", "pipeline-health.mjs");
  if (existsSync(bundled)) return bundled;
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || "", ".dsh");
  return join(home, "bin", "pipeline-health.mjs");
}

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function text(res, code, body, type) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
  res.writeHead(code, {
    "content-type": type || "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "content-length": buf.length,
  });
  res.end(buf);
}

async function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function publicState(ctx) {
  const vault = ctx.vault();
  const profile = ctx.profile();
  const cfg = readConfigState(vault, profile);
  const lock = readLock();
  return {
    ok: true,
    vault,
    profile,
    platform: process.platform,
    windows: IS_WINDOWS,
    configKeys: CONFIG_KEYS,
    effective: cfg.effective,
    layers: cfg.layers,
    drift: cfg.drift,
    runCommands: RUN_COMMANDS.map((c) => ({ id: c.id, label: c.label, hint: c.hint })),
    lock: lock
      ? { pid: lock.pid, command: lock.command, host: lock.host, stale: lock.stale, seconds: Math.round((Date.now() - lock.startedAt) / 1000), human: describeLock(lock) }
      : null,
    queue: readQueue().map((q) => ({ command: q.command, by: q.by, requestedAt: q.requestedAt })),
    run: currentRun
      ? {
          id: currentRun.id,
          command: currentRun.command,
          args: currentRun.args,
          startedAt: currentRun.startedAt,
          finished: currentRun.finished,
          exitCode: currentRun.exitCode,
          output: currentRun.lines.slice(-400),
        }
      : null,
    tasks: null, // 异步填
    history: null, // 异步填
  };
}

function startRun(commandId, by) {
  const def = RUN_COMMANDS.find((c) => c.id === commandId);
  if (!def) throw new Error("不认识的动作: " + commandId);
  if (currentRun && !currentRun.finished) throw new Error("面板已有一次运行在进行中");

  // 管线自己会抢锁（scripts/llm-wiki-pipeline.mjs 的 main()），面板不能再抢一次，
  // 否则子进程必然 EEXIST → exit 75。这里只做「占用了就拒绝」的预检。
  // health 是独立脚本、自己不加锁，所以由面板代为加锁。
  const isHealth = def.id === "health";
  const held = readLock();
  if (held && !held.stale) {
    return {
      ok: false,
      busy: true,
      reason: "管线正在运行（pid=" + held.pid + "，" + describeLock(held) + "）",
      holder: { pid: held.pid, command: held.command, human: describeLock(held) },
    };
  }
  let heldByPanel = false;
  if (isHealth) {
    const got = acquire("panel " + def.args.join(" "));
    if (!got.ok) {
      const h = got.holder;
      return {
        ok: false,
        busy: true,
        reason: h ? "管线正在运行（pid=" + h.pid + "，" + describeLock(h) + "）" : "管线锁被占用",
        holder: h ? { pid: h.pid, command: h.command, human: describeLock(h) } : null,
      };
    }
    heldByPanel = true;
  }

  const file = isHealth ? healthPath() : pipelinePath();
  const args = isHealth ? [] : def.args;
  const run = {
    id: randomUUID(),
    command: def.id,
    args: def.args,
    startedAt: Date.now(),
    finished: false,
    exitCode: null,
    lines: [],
    child: null,
  };
  currentRun = run;

  let child;
  try {
    child = spawn(process.execPath, [file, ...args], {
      cwd: dirname(file),
      env: { ...process.env, LLM_WIKI_PANEL: "1" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    if (heldByPanel) release();
    run.finished = true;
    run.exitCode = -1;
    run.lines.push("启动失败: " + (e && e.message ? e.message : String(e)));
    throw e;
  }
  run.child = child;
  const push = (chunk) => {
    const s = String(chunk);
    for (const line of s.split(/\r?\n/)) {
      if (line === "") continue;
      run.lines.push(line);
      if (run.lines.length > 2000) run.lines.splice(0, run.lines.length - 2000);
    }
  };
  child.stdout.on("data", push);
  child.stderr.on("data", push);
  child.on("error", (e) => push("进程错误: " + (e && e.message ? e.message : String(e))));
  child.on("close", (code) => {
    run.finished = true;
    run.exitCode = typeof code === "number" ? code : -1;
    if (heldByPanel) release();
    // 跑完把队列里的下一条拉起来（出队 + detached spawn，由子进程自己抢锁）
    try {
      const started = drainQueue(pipelinePath(), { vault: currentVault() });
      if (started) run.lines.push("已从队列启动下一条任务。");
    } catch (e) {
      run.lines.push("启动队列下一条失败: " + (e && e.message ? e.message : String(e)));
    }
    void by;
  });
  return { ok: true, run: { id: run.id, command: run.command, startedAt: run.startedAt } };
}

/**
 * 注册路由。返回 disposer（由 ctx.effect 收尾）。
 * @param {{ webServer:any, vault:()=>string, profile:()=>string, log:(msg:string)=>void }} ctx
 */
export function registerPanelRoutes(ctx) {
  const webServer = ctx.webServer;
  if (!webServer || typeof webServer.register !== "function") {
    throw new Error("llm-wiki 面板需要 DSH 的 webServer 服务（ctx.webServer.register）");
  }
  vaultReader = typeof ctx.vault === "function" ? ctx.vault : () => "";

  const handler = async (req, res) => {
    let url;
    try {
      url = new URL(req.url || "/", "http://127.0.0.1");
    } catch {
      return text(res, 400, "bad url");
    }
    const path = url.pathname;
    const sub = path.slice(PREFIX.length) || "/";

    try {
      // --- 静态：降级页与共用 JS ---
      if (sub === "/" || sub === "/index.html") {
        const file = join(WEB_DIR, "panel.html");
        if (!existsSync(file)) return text(res, 500, "panel.html 缺失: " + file);
        return text(res, 200, readFileSync(file), "text/html; charset=utf-8");
      }
      if (sub === "/panel.js") {
        const file = join(WEB_DIR, "panel.js");
        if (!existsSync(file)) return text(res, 500, "panel.js 缺失: " + file);
        return text(res, 200, readFileSync(file), "text/javascript; charset=utf-8");
      }
      if (sub === "/panel.css") {
        const file = join(WEB_DIR, "panel.css");
        if (!existsSync(file)) return text(res, 404, "");
        return text(res, 200, readFileSync(file), "text/css; charset=utf-8");
      }

      // --- API ---
      if (sub === "/api/state" && req.method === "GET") {
        const state = publicState(ctx);
        const tasks = await readTasks();
        state.tasks = tasks;
        try {
          state.history = buildHistory(ctx.vault());
        } catch (e) {
          state.history = { error: e && e.message ? e.message : String(e), entries: [], series: [] };
        }
        return json(res, 200, state);
      }

      if (sub === "/api/config" && req.method === "POST") {
        const body = await readBody(req);
        const key = String(body.key || "");
        if (!CONFIG_KEYS.includes(key)) return json(res, 400, { ok: false, reason: "不支持改这个键: " + key });
        const r = writeConfigKey(ctx.profile(), key, body.value);
        return json(res, 200, { ok: true, ...r, restartRequired: r.changed !== false });
      }

      if (sub === "/api/task" && req.method === "POST") {
        const body = await readBody(req);
        const name = String(body.name || "");
        if (!MANAGED_TASKS.some((t) => t.name === name)) return json(res, 400, { ok: false, reason: "不认识的任务: " + name });
        if (body.action === "enable") return json(res, 200, await setTaskEnabled(name, true));
        if (body.action === "disable") return json(res, 200, await setTaskEnabled(name, false));
        if (body.action === "time") return json(res, 200, await setTaskTime(name, String(body.time || "")));
        return json(res, 400, { ok: false, reason: "不认识的动作: " + String(body.action) });
      }

      if (sub === "/api/run" && req.method === "POST") {
        const body = await readBody(req);
        const r = startRun(String(body.command || ""), String(body.by || "panel"));
        return json(res, r.ok ? 200 : 409, r);
      }

      if (sub === "/api/run" && req.method === "GET") {
        if (!currentRun) return json(res, 200, { ok: true, run: null });
        return json(res, 200, {
          ok: true,
          run: {
            id: currentRun.id,
            command: currentRun.command,
            args: currentRun.args,
            startedAt: currentRun.startedAt,
            finished: currentRun.finished,
            exitCode: currentRun.exitCode,
            output: currentRun.lines.slice(-400),
          },
        });
      }

      if (sub === "/api/unlock" && req.method === "POST") {
        const ok = forceRelease();
        return json(res, 200, { ok, reason: ok ? "" : "删除锁文件失败" });
      }

      if (sub === "/api/queue" && req.method === "POST") {
        const body = await readBody(req);
        const def = RUN_COMMANDS.find((c) => c.id === String(body.command || "all"));
        if (!def) return json(res, 400, { ok: false, reason: "不认识的动作" });
        const len = enqueue(def.id, { args: def.args, by: "panel" });
        return json(res, 200, { ok: true, position: len });
      }

      return text(res, 404, "not found: " + sub);
    } catch (e) {
      try {
        ctx.log("[dsh-llm-wiki] panel error: " + (e && e.stack ? e.stack : e));
      } catch {}
      if (!res.headersSent) return json(res, 500, { ok: false, reason: e && e.message ? e.message : String(e) });
      try { res.destroy(); } catch {}
      return undefined;
    }
  };

  return webServer.register({ kind: "prefix", path: PREFIX, handler });
}
