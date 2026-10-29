/**
 * plugin/panel/history.mjs —— 运行历史（log.md 条目 + health CSV 趋势）
 *
 * 数据源两个（用户要求把 health 的 CSV 也读进来做趋势）：
 *  1. <vault>/log.md          每条 `## [YYYY-MM-DD] pipeline | <摘要>`，新→旧
 *  2. ~/.dsh/llm-wiki/reports/health/health-YYYY-MM.csv
 *     列：date,pages,archived,rawSessions,compiled,compileRatePct,stale,lintIssues,
 *         syncPages,syncChunks,coveragePct,userEntries,userBytes,profileCandidates,probeHit
 *
 * 只读，不写任何文件。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const HEALTH_DIR = join(process.env.DSH_HOME || join(process.env.USERPROFILE || homedir(), ".dsh"), "llm-wiki", "reports", "health");

/** 解析 log.md 的条目行（只认 `## [date] pipeline | 摘要`，也容忍 `## [date] 其它 | 摘要`） */
export function parseLogEntries(text) {
  const out = [];
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^##\s*\[(\d{4}-\d{2}-\d{2})\]\s*([^|]*?)\s*\|\s*(.*)$/);
    if (!m) continue;
    out.push({ date: m[1], kind: m[2].trim() || "pipeline", summary: m[3].trim() });
  }
  return out;
}

/** 把 "lint:0问题/0孤立/0stale | index:重建 | sync:12条" 拆成结构化字段 */
export function parseSummary(summary) {
  const facts = {};
  const parts = String(summary || "").split("|").map((s) => s.trim()).filter(Boolean);
  const rest = [];
  for (const part of parts) {
    const m = part.match(/^([a-z][\w-]*):(.*)$/i);
    if (m) facts[m[1]] = m[2].trim();
    else rest.push(part);
  }
  return { facts, rest };
}

function readCsvRows(file) {
  try {
    const text = readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 2) return [];
    const head = lines[0].split(",").map((s) => s.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",");
      const row = {};
      for (let c = 0; c < head.length; c++) row[head[c]] = (cells[c] || "").trim();
      rows.push(row);
    }
    return rows;
  } catch {
    return [];
  }
}

/** 读全部 health CSV（跨月），按日期升序 */
export function readHealthRows(dir = HEALTH_DIR) {
  if (!existsSync(dir)) return { dir, rows: [], files: [] };
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => /^health-\d{4}-\d{2}\.csv$/.test(f)).sort();
  } catch {
    return { dir, rows: [], files: [] };
  }
  const rows = [];
  for (const f of files) {
    for (const r of readCsvRows(join(dir, f))) rows.push(r);
  }
  rows.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  return { dir, rows, files };
}

const NUMERIC = ["pages", "archived", "rawSessions", "compiled", "compileRatePct", "stale", "lintIssues", "syncPages", "syncChunks", "coveragePct", "userEntries", "userBytes", "profileCandidates"];

/** 把 CSV 行转成数值 + probeHit 命中率，供前端画趋势 */
export function healthSeries(rows) {
  const points = rows.map((r) => {
    const p = { date: r.date || "" };
    for (const k of NUMERIC) {
      const v = Number(r[k]);
      p[k] = Number.isFinite(v) ? v : null;
    }
    const hit = String(r.probeHit || "");
    const m = hit.match(/^(\d+)\s*\/\s*(\d+)$/);
    p.probeHit = m ? Number(m[1]) : null;
    p.probeTotal = m ? Number(m[2]) : null;
    p.probePct = m && Number(m[2]) > 0 ? Math.round((Number(m[1]) / Number(m[2])) * 100) : null;
    return p;
  });
  // 环比：与上一条有效值比较
  for (let i = 0; i < points.length; i++) {
    const cur = points[i];
    const prev = i > 0 ? points[i - 1] : null;
    cur.delta = {};
    for (const k of NUMERIC) {
      if (cur[k] === null || !prev || prev[k] === null) { cur.delta[k] = null; continue; }
      cur.delta[k] = cur[k] - prev[k];
    }
    cur.delta.probePct = cur.probePct !== null && prev && prev.probePct !== null ? cur.probePct - prev.probePct : null;
  }
  return points;
}

/** 面板运行历史表：合并 log.md 条目与 health 行 */
export function buildHistory(vault, { limit = 200 } = {}) {
  const logPath = join(vault, "log.md");
  let logText = "";
  let logExists = false;
  let logError = "";
  try {
    logExists = existsSync(logPath);
    if (logExists) logText = readFileSync(logPath, "utf8");
  } catch (e) {
    logError = e && e.message ? e.message : String(e);
  }
  const entries = parseLogEntries(logText).slice(0, limit).map((e, i) => {
    const { facts, rest } = parseSummary(e.summary);
    return { index: i, date: e.date, kind: e.kind, summary: e.summary, facts, rest };
  });

  const health = readHealthRows();
  const series = healthSeries(health.rows);
  const latest = series.length > 0 ? series[series.length - 1] : null;

  return {
    logPath,
    logExists,
    logError,
    entryCount: entries.length,
    entries,
    healthDir: health.dir,
    healthFiles: health.files,
    series,
    latest,
  };
}
