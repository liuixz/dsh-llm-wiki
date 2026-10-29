/**
 * pipeline-lock.mjs —— 管线全局互斥锁 + 可选排队（零外部依赖）
 *
 * 谁在用：
 *  - scripts/llm-wiki-pipeline.mjs（计划任务、插件 session 结束同步）
 *  - plugin/panel/server.mjs（面板「一键跑管线」）
 * 三条入口共用同一把锁，否则面板与计划任务会同时写同一个 vault。
 *
 * 锁文件：<STATE_DIR>/.pipeline.lock
 *   内容 JSON：{ pid, command, startedAt, host }
 *   STATE_DIR 默认 ~/.dsh/llm-wiki（与管线其它状态同目录，可用 LLM_WIKI_STATE 覆盖口径）
 *
 * 排队：<STATE_DIR>/.pipeline.queue
 *   内容 JSON 数组：[{ command, args?, requestedAt, by }]
 *   当前跑完由 runQueueDrain 取出下一条并 spawn。
 *
 * 陈旧锁：持有者 pid 已不存在 → 视为陈旧，直接接管（记录一条 warn 到 stderr）。
 * 注意：pid 复用会有极小概率误判为存活，此时锁最多被当成一直被占用；
 * 面板提供「强制解锁」不受此影响（强制解锁只在用户明确点击时调用）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir, hostname } from "node:os";
import { spawn } from "node:child_process";

export const STATE_DIR = process.env.LLM_WIKI_STATE_DIR || join(homedir(), ".dsh", "llm-wiki");
export const LOCK_FILE = join(STATE_DIR, ".pipeline.lock");
export const QUEUE_FILE = join(STATE_DIR, ".pipeline.queue");

function ensureDir() {
  try { mkdirSync(STATE_DIR, { recursive: true }); } catch {}
}

/** pid 是否还活着。EPERM 说明进程存在但不属于我们，也算活着。 */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === "EPERM";
  }
}

/** 读锁（不判断陈旧）。返回 null 或 { pid, command, startedAt, host, stale } */
export function readLock() {
  try {
    if (!existsSync(LOCK_FILE)) return null;
    const raw = JSON.parse(readFileSync(LOCK_FILE, "utf8") || "{}");
    if (!raw || typeof raw !== "object") return null;
    const st = Number(raw.startedAt) || 0;
    return {
      pid: Number(raw.pid) || 0,
      command: String(raw.command || ""),
      startedAt: st,
      host: String(raw.host || ""),
      stale: !isAlive(Number(raw.pid) || 0),
    };
  } catch {
    return null;
  }
}

/**
 * 抢锁。成功返回 { ok:true, lock }；被占用返回 { ok:false, holder }。
 * stale 的锁会被接管。
 */
export function acquire(command) {
  ensureDir();
  const now = Date.now();
  const mine = { pid: process.pid, command: String(command || ""), startedAt: now, host: safeHost() };

  for (let attempt = 0; attempt < 2; attempt++) {
    const holder = readLock();
    if (holder && !holder.stale) return { ok: false, holder };
    if (holder && holder.stale) {
      try { process.stderr.write("[pipeline-lock] 接管陈旧锁 pid=" + holder.pid + " command=" + holder.command + "\n"); } catch {}
    }
    // O_EXCL 语义：先写临时文件再 link/rename 不是原子的，这里用 flag:"wx" 直接独占创建
    try {
      writeFileSync(LOCK_FILE, JSON.stringify(mine), { encoding: "utf8", flag: "wx" });
      return { ok: true, lock: mine };
    } catch (e) {
      if (e && e.code === "EEXIST") {
        // 竞态：别人刚建好。重读一次判断是否陈旧，陈旧则删掉重试一次。
        const again = readLock();
        if (again && !again.stale) return { ok: false, holder: again };
        try { rmSync(LOCK_FILE, { force: true }); } catch {}
        continue;
      }
      return { ok: false, holder: null, error: e };
    }
  }
  return { ok: false, holder: readLock() };
}

/** 释放锁。只删自己持有的（pid 匹配），避免误删别人的。 */
export function release() {
  const holder = readLock();
  if (holder && holder.pid && holder.pid !== process.pid) return false;
  try { rmSync(LOCK_FILE, { force: true }); return true; } catch { return false; }
}

/** 用户明确点「强制解锁」时才调用：不看 pid，直接删。 */
export function forceRelease() {
  try { rmSync(LOCK_FILE, { force: true }); return true; } catch { return false; }
}

/** 读队列 */
export function readQueue() {
  try {
    if (!existsSync(QUEUE_FILE)) return [];
    const arr = JSON.parse(readFileSync(QUEUE_FILE, "utf8") || "[]");
    return Array.isArray(arr) ? arr.filter((x) => x && typeof x === "object") : [];
  } catch {
    return [];
  }
}

function writeQueue(arr) {
  ensureDir();
  try {
    const tmp = QUEUE_FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(arr), "utf8");
    renameSync(tmp, QUEUE_FILE);
  } catch {}
}

/** 入队。返回入队后的队列长度。 */
export function enqueue(command, { args = [], by = "panel" } = {}) {
  const q = readQueue();
  q.push({ command: String(command || ""), args: Array.isArray(args) ? args : [], requestedAt: Date.now(), by: String(by || "panel") });
  writeQueue(q);
  return q.length;
}

/** 出队一条（FIFO）。没有则返回 null。 */
export function dequeue() {
  const q = readQueue();
  if (q.length === 0) return null;
  const head = q.shift();
  writeQueue(q);
  return head;
}

export function clearQueue() {
  writeQueue([]);
}

/**
 * 跑完一条后把队列里的下一条拉起来。
 * 返回 true 表示确实 spawn 了下一条。
 * 注意：spawn 出去的进程会自己抢锁，所以这里必须**先释放锁**再调用。
 */
export function drainQueue(pipelinePath, { vault, cwd } = {}) {
  const next = dequeue();
  if (!next) return false;
  const args = [pipelinePath, ...(Array.isArray(next.args) && next.args.length ? next.args : [next.command])];
  const env = { ...process.env };
  if (vault) env.LLM_WIKI_VAULT = vault;
  try {
    const child = spawn(process.execPath, args, {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
      cwd: cwd || undefined,
      env,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function safeHost() {
  try { return hostname(); } catch { return ""; }
}

/** 供 CLI/面板显示：人类可读的持锁时长 */
export function describeLock(lock) {
  if (!lock) return "";
  const secs = Math.max(0, Math.round((Date.now() - lock.startedAt) / 1000));
  const mins = Math.floor(secs / 60);
  return mins > 0 ? mins + " 分 " + (secs % 60) + " 秒" : secs + " 秒";
}
