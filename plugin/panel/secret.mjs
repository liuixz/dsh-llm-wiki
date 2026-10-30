/**
 * plugin/panel/secret.mjs —— 凭据读写（零外部依赖）
 *
 * 凭据 ≠ 配置项（GLOSSARY.md）：
 *   - 配置项存在 profile 的 cordis.patch.yml，是普通 YAML 标量，可以明文回显
 *   - 凭据存在 ~/.dsh/.credentials.yaml 的 refs: 下，**只写不读**（ADR-0004）
 *
 * 三条硬规则（用户 m05302/m05307 决定）：
 *   1. 永不回显明文：/api/secret 只返回「已配置 + 尾部 4 位」
 *   2. 写前验证：默认先打一次真实的 /v1/embeddings 探针，200 才落盘
 *   3. 失败原样透出：接口的 HTTP 状态与 code/message 必须一字不改地报给用户
 *
 * 写入方式与 config.mjs 一致：**按行定位**，不做 YAML 对象化，
 * 只改 refs 块里的目标行，文件其余字节（records 里的 token 等）原样保留。
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";

import { dshHome } from "./config.mjs";

/** 面板能管理的凭据。目前只有硅基流动（向量化 + 会话语义索引共用）。 */
export const SECRET_KEYS = ["SF_API_KEY"];

export const SECRET_META = {
  SF_API_KEY: {
    label: "SF_API_KEY",
    service: "硅基流动 SiliconFlow",
    endpoint: "https://api.siliconflow.cn/v1",
    model: "BAAI/bge-m3",
    desc: "向量化与会话语义索引的 key。留空则召回降级为纯关键词匹配。",
    impact: "记忆体向量化（BAAI/bge-m3）· 会话语义索引 · 画像抽取的末位兜底",
  },
};

export function credentialsPath() {
  return join(dshHome(), ".credentials.yaml");
}

/** 尾部保留 4 位，其余打码。长度不足时整体打码。 */
function maskTail(value) {
  const s = String(value || "");
  if (s.length === 0) return "";
  if (s.length <= 8) return "•".repeat(s.length);
  return s.slice(0, 3) + "…" + s.slice(-4);
}

/**
 * 读 refs 块。返回 { exists, found, refs:{name:value}, lineStart, lineEnd }
 * 只认顶层 `refs:`，其子行缩进大于 refs 自身缩进。
 */
export function readRefsBlock(text) {
  const lines = String(text || "").split(/\r?\n/);
  const result = { exists: false, found: false, refs: {}, lineStart: -1, lineEnd: -1 };
  for (let i = 0; i < lines.length; i++) {
    if (!/^refs:\s*$/.test(lines[i].replace(/\s+$/, ""))) continue;
    result.found = true;
    result.lineStart = i;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const raw = lines[j];
      if (raw.trim() === "") continue;
      const indent = (raw.match(/^\s*/) || [""])[0].length;
      if (indent === 0) break; // 回到顶层的下个键（records:）
      const m = raw.match(/^\s+([A-Za-z_][\w.-]*):\s*(.*?)\s*$/);
      if (m) {
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        result.refs[m[1]] = v;
      }
    }
    result.lineEnd = j;
    break;
  }
  return result;
}

/**
 * 面板可见的凭据状态。**绝不返回明文**。
 * @returns {{ path, exists, items: Array<{key,label,service,desc,impact,configured,hint}> }}
 */
export function readSecretState() {
  const path = credentialsPath();
  let text = "";
  let exists = false;
  let error = "";
  try {
    exists = existsSync(path);
    if (exists) text = readFileSync(path, "utf8");
  } catch (e) {
    error = e && e.message ? e.message : String(e);
  }
  const blk = exists ? readRefsBlock(text) : { refs: {} };
  const items = SECRET_KEYS.map((key) => {
    const meta = SECRET_META[key];
    const raw = blk.refs[key];
    const configured = typeof raw === "string" && raw.trim() !== "";
    return {
      key,
      label: meta.label,
      service: meta.service,
      desc: meta.desc,
      impact: meta.impact,
      configured,
      hint: configured ? maskTail(raw) : "",
      length: configured ? raw.length : 0,
    };
  });
  return { path, exists, error, items };
}

/**
 * 用一次真实请求验证 key。成功返回 { ok:true }，失败抛出的 Error 带 code/message 原文。
 * @param {string} key
 * @param {{endpoint?:string, model?:string, timeoutMs?:number}} opts
 */
export async function verifyKey(key, opts = {}) {
  const endpoint = opts.endpoint || SECRET_META.SF_API_KEY.endpoint;
  const model = opts.model || SECRET_META.SF_API_KEY.model;
  const timeoutMs = opts.timeoutMs || 10000;
  const url = endpoint.replace(/\/+$/, "") + "/embeddings";

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + key },
      body: JSON.stringify({ model, input: ["ping"] }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch (e) {
    const name = e && e.name ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      const err = new Error("验证超时（" + timeoutMs + "ms 内未响应）· 端点 " + url);
      err.code = "TIMEOUT";
      throw err;
    }
    const err = new Error("无法连接验证端点 · " + (e && e.message ? e.message : String(e)) + " · 端点 " + url);
    err.code = "NETWORK";
    throw err;
  }

  const rawText = await res.text().catch(() => "");
  if (res.ok) return { ok: true, status: res.status, model };

  // 失败：把接口返回的 code / message 原样带出来（用户明确要求）
  let apiCode = "";
  let apiMessage = "";
  try {
    const body = JSON.parse(rawText);
    if (body && typeof body === "object") {
      if (body.code !== undefined && body.code !== null) apiCode = String(body.code);
      apiMessage = String(body.message || body.msg || body.error || "");
    }
  } catch {
    apiMessage = rawText.slice(0, 300);
  }
  const parts = ["HTTP " + res.status];
  if (apiCode) parts.push("code " + apiCode);
  if (apiMessage) parts.push(apiMessage);
  if (!apiCode && !apiMessage) parts.push(rawText.slice(0, 200) || "无响应体");
  const err = new Error(parts.join(" · "));
  err.code = apiCode || String(res.status);
  err.status = res.status;
  err.apiMessage = apiMessage;
  err.apiCode = apiCode;
  throw err;
}

/**
 * 写一个凭据。默认先验证；验证失败直接抛错且**不落盘**。
 * @returns {{ok:true, key:string, changed:boolean, verified:boolean, path:string}}
 */
export async function writeSecret(name, value, opts = {}) {
  if (!SECRET_KEYS.includes(name)) throw new Error("不支持管理这个凭据: " + name);
  const raw = String(value == null ? "" : value).trim();
  if (raw === "") throw new Error("凭据不能为空（要清空请用「清除」）");
  if (/\s/.test(raw)) throw new Error("凭据里不能有空白字符（可能多粘了一个换行或空格）");

  let verified = false;
  if (!opts.skipVerify) {
    await verifyKey(raw, opts); // 抛错即中止，不写文件
    verified = true;
  }

  const path = credentialsPath();
  if (!existsSync(path)) throw new Error("凭据文件不存在: " + path);

  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  const blk = readRefsBlock(text);
  if (!blk.found) throw new Error("凭据文件里没有 refs: 块: " + path);

  const want = '  ' + name + ': "' + raw.replace(/"/g, '\\"') + '"';

  // 1) refs 块里已有这个键 → 替换那一行
  for (let i = blk.lineStart + 1; i < blk.lineEnd; i++) {
    const m = lines[i].match(/^(\s+)([A-Za-z_][\w.-]*):/);
    if (m && m[2] === name) {
      if (lines[i] === want) return { ok: true, key: name, changed: false, verified, path };
      lines[i] = want;
      persistSecret(path, lines);
      return { ok: true, key: name, changed: true, verified, path };
    }
  }

  // 2) 没有 → 追加到 refs 块最后一行之后
  let insertAt = blk.lineStart + 1;
  for (let i = blk.lineStart + 1; i < blk.lineEnd; i++) {
    if (lines[i].trim() !== "") insertAt = i + 1;
  }
  lines.splice(insertAt, 0, want);
  persistSecret(path, lines);
  return { ok: true, key: name, changed: true, verified, path };
}

/**
 * 删除一个凭据（整个删掉这一行，不写空串）。
 * @returns {{ok:true, key:string, changed:boolean, path:string}}
 */
export function clearSecret(name) {
  if (!SECRET_KEYS.includes(name)) throw new Error("不支持管理这个凭据: " + name);
  const path = credentialsPath();
  if (!existsSync(path)) throw new Error("凭据文件不存在: " + path);

  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  const blk = readRefsBlock(text);
  if (!blk.found) throw new Error("凭据文件里没有 refs: 块: " + path);

  for (let i = blk.lineStart + 1; i < blk.lineEnd; i++) {
    const m = lines[i].match(/^\s+([A-Za-z_][\w.-]*):/);
    if (m && m[1] === name) {
      lines.splice(i, 1);
      persistSecret(path, lines);
      return { ok: true, key: name, changed: true, path };
    }
  }
  return { ok: true, key: name, changed: false, path };
}

function persistSecret(path, lines) {
  try {
    copyFileSync(path, path + ".bak-panel-" + stamp());
  } catch {}
  writeFileSync(path, lines.join("\n"), "utf8");
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
