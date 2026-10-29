/**
 * plugin/panel/config.mjs —— 配置层读取 / 漂移计算 / 真源写入（零外部依赖）
 *
 * 真源 = profile 的 cordis.patch.yml（ADR-0002）。
 * 其余三层（包内 bundle patch、$DSH_HOME/cordis.patch.yml、--patch）只读展示为「漂移」。
 *
 * 本文件不做 YAML 解析成对象（避免引入依赖），而是**按行定位** `- id: llm-wiki`
 * 那个块，读出它的 config 子键。写入时只替换目标键那一行，其余字节原样保留。
 *
 * 已知限制（写入时）：
 *  - 目标键不存在 → 在该块 config: 之下追加一行
 *  - 该块没有 config: → 新建 config: 并补键
 *  - 同一文件里若有多个 `- id: llm-wiki`，只改**第一个**并报 drift（说明配置重复）
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const CONFIG_KEYS = ["vault", "previewOrder", "rulesOrder", "mainAgentOnly"];

export function dshHome() {
  return process.env.DSH_HOME || join(process.env.USERPROFILE || homedir(), ".dsh");
}

/** 找到运行中的 profile 目录名。优先 env，其次探测哪个 profiles/<n>/package.json 依赖本包。 */
export function detectProfile(packageRoot) {
  if (process.env.DSH_PROFILE) return process.env.DSH_PROFILE;
  const profilesDir = join(dshHome(), "profiles");
  try {
    if (existsSync(profilesDir)) {
      const names = readdirSafe(profilesDir);
      const hits = [];
      for (const name of names) {
        const pkg = join(profilesDir, name, "package.json");
        if (!existsSync(pkg)) continue;
        try {
          const text = readFileSync(pkg, "utf8");
          if (text.includes("dsh-llm-wiki")) hits.push(name);
        } catch {}
      }
      // desktop 是本机实际在跑的那个；没有则取字典序第一个
      if (hits.includes("desktop")) return "desktop";
      if (hits.length > 0) return hits[0];
    }
  } catch {}
  void packageRoot;
  return "desktop";
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** 四层 patch 文件的绝对路径（存在的才返回） */
export function configLayers(profile) {
  const home = dshHome();
  const layers = [
    { id: "profile", label: "profile 的 cordis.patch.yml（真源）", writable: true, path: join(home, "profiles", profile, "cordis.patch.yml") },
    { id: "global", label: "$DSH_HOME/cordis.patch.yml", writable: false, path: join(home, "cordis.patch.yml") },
  ];
  return layers;
}

/**
 * 从一段 YAML 文本里抠出 `- id: llm-wiki` 块的 config 子键。
 * 返回 { found, disabled, keys:{...}, lineStart, lineEnd, configLine } （行号 0-based）
 */
export function readPluginBlock(text, id = "llm-wiki") {
  const lines = String(text || "").split(/\r?\n/);
  const result = { found: false, disabled: false, keys: {}, lineStart: -1, lineEnd: -1, configLine: -1, count: 0 };
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*-\s+id:\s*["']?llm-wiki["']?\s*$/.test(lines[i].replace(/\s+$/, ""))) continue;
    // 允许 id 名不同（未来改名）——只认传入的 id
    if (!new RegExp("^\\s*-\\s+id:\\s*[\"']?" + id + "[\"']?\\s*$").test(lines[i].replace(/\s+$/, ""))) continue;
    result.count++;
    if (result.found) continue; // 只解析第一个，其余计数用于漂移提示
    result.found = true;
    const itemIndent = (lines[i].match(/^\s*/) || [""])[0].length;
    let j = i + 1;
    let inConfig = false;
    let configIndent = -1;
    for (; j < lines.length; j++) {
      const raw = lines[j];
      const trimmed = raw.replace(/\s+$/, "");
      if (trimmed.trim() === "") continue;
      const indent = (raw.match(/^\s*/) || [""])[0].length;
      // 同级或更浅的新 `- ` 条目 → 块结束
      if (indent <= itemIndent && /^\s*-\s/.test(raw)) break;
      if (!inConfig) {
        if (/^\s*config:\s*$/.test(trimmed)) {
          inConfig = true;
          configIndent = indent;
          result.configLine = j;
          continue;
        }
        if (/^\s*disabled:\s*true\b/.test(trimmed)) result.disabled = true;
        continue;
      }
      if (indent <= configIndent) break;
      const m = trimmed.match(/^\s*([A-Za-z_][\w-]*):\s*(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        result.keys[m[1]] = v;
      }
    }
    result.lineEnd = j;
  }
  return result;
}

/** 读所有层，算出每层对四个可改键的取值 + 与真源的漂移 */
export function readConfigState(vaultPath, profile) {
  const layers = configLayers(profile);
  const out = [];
  for (const layer of layers) {
    let raw = "";
    let exists = false;
    let err = "";
    try {
      exists = existsSync(layer.path);
      if (exists) raw = readFileSync(layer.path, "utf8");
    } catch (e) {
      err = e && e.message ? e.message : String(e);
    }
    const blk = exists ? readPluginBlock(raw) : { found: false, disabled: false, keys: {} };
    out.push({
      id: layer.id,
      label: layer.label,
      path: layer.path,
      writable: layer.writable,
      exists,
      error: err,
      found: blk.found,
      disabled: !!blk.disabled,
      duplicateEntries: Math.max(0, (blk.count || 0) - 1),
      keys: blk.keys,
    });
  }
  // 真源（profile 层）实际生效值：缺省时退回插件默认
  const src = out.find((l) => l.id === "profile") || {};
  const effective = {
    vault: src.keys && src.keys.vault ? src.keys.vault : vaultPath,
    previewOrder: src.keys && src.keys.previewOrder !== undefined ? Number(src.keys.previewOrder) : 138,
    rulesOrder: src.keys && src.keys.rulesOrder !== undefined ? Number(src.keys.rulesOrder) : 139,
    mainAgentOnly: src.keys && src.keys.mainAgentOnly !== undefined ? String(src.keys.mainAgentOnly) !== "false" : true,
  };
  // 漂移：某非真源层也写了这个键，且值与真源不同
  const drift = [];
  for (const layer of out) {
    if (layer.id === "profile") continue;
    for (const k of CONFIG_KEYS) {
      if (layer.keys && Object.prototype.hasOwnProperty.call(layer.keys, k)) {
        if (String(layer.keys[k]) !== String(effective[k])) {
          drift.push({ layer: layer.id, label: layer.label, key: k, value: layer.keys[k], effective: effective[k] });
        }
      }
    }
  }
  const profileLayer = out.find((l) => l.id === "profile");
  if (profileLayer && profileLayer.duplicateEntries > 0) {
    drift.push({ layer: "profile", label: profileLayer.label, key: "(块重复)", value: String(profileLayer.duplicateEntries + 1) + " 处 - id: llm-wiki", effective: "1 处" });
  }
  if (profileLayer && profileLayer.disabled) {
    drift.push({ layer: "profile", label: profileLayer.label, key: "disabled", value: "true", effective: "false" });
  }
  return { effective, layers: out, drift };
}

function yamlScalar(key, value) {
  if (key === "mainAgentOnly") return value === true || String(value) === "true" ? "true" : "false";
  if (key === "previewOrder" || key === "rulesOrder") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(key + " 必须是整数");
    return String(Math.trunc(n));
  }
  // vault：统一成正斜杠，去掉可能与 YAML 冲突的引号
  const s = String(value).replace(/\\/g, "/").replace(/"/g, "").trim();
  if (s.length === 0) throw new Error("vault 不能为空");
  return s;
}

/**
 * 只改 profile 层的一行。成功返回 { ok, changed, backup }。
 * 不做备份（用户选择「直接写」），但为安全仍留一份 .bak-panel-<ts>（可关闭）。
 */
export function writeConfigKey(profile, key, value, { vault } = {}) {
  void vault;
  if (!CONFIG_KEYS.includes(key)) throw new Error("不支持改这个键: " + key);
  const layers = configLayers(profile);
  const target = layers.find((l) => l.id === "profile");
  if (!target) throw new Error("找不到 profile 层");
  if (!existsSync(target.path)) throw new Error("profile 的 cordis.patch.yml 不存在: " + target.path);

  const raw = readFileSync(target.path, "utf8");
  const lines = raw.split(/\r?\n/);
  const blk = readPluginBlock(raw);
  const scalar = yamlScalar(key, value);

  if (!blk.found) throw new Error("profile 的 cordis.patch.yml 里没有 `- id: llm-wiki` 配置覆盖块");

  // 1) config 块里已经有这个键 → 替换那一行
  if (blk.configLine >= 0) {
    let configIndent = (lines[blk.configLine].match(/^\s*/) || [""])[0].length;
    for (let i = blk.configLine + 1; i < blk.lineEnd; i++) {
      const indent = (lines[i].match(/^\s*/) || [""])[0].length;
      if (lines[i].trim() === "") continue;
      if (indent <= configIndent) break;
      const m = lines[i].match(/^(\s*)([A-Za-z_][\w-]*):/);
      if (m && m[2] === key) {
        const newLine = m[1] + key + ": " + scalar;
        if (lines[i] === newLine) return { ok: true, changed: false, path: target.path };
        lines[i] = newLine;
        return persist(target.path, lines, { changed: true });
      }
    }
    // 2) config 存在但没这个键 → 追加到 config 块的最后一个子行之后
    let insertAt = blk.configLine + 1;
    let childIndent = "  ".repeat(Math.floor(configIndent / 2) + 1);
    for (let i = blk.configLine + 1; i < blk.lineEnd; i++) {
      if (lines[i].trim() === "") continue;
      const indent = (lines[i].match(/^\s*/) || [""])[0].length;
      if (indent <= configIndent) break;
      insertAt = i + 1;
      childIndent = (lines[i].match(/^\s*/) || [""])[0];
    }
    lines.splice(insertAt, 0, childIndent + key + ": " + scalar);
    return persist(target.path, lines, { changed: true });
  }

  // 3) 没有 config: → 在 id 行之后插入 config: 与键
  const itemIndent = (lines[blk.lineStart].match(/^\s*/) || [""])[0].length;
  const pad = " ".repeat(itemIndent);
  lines.splice(blk.lineStart + 1, 0, pad + "  config:", pad + "    " + key + ": " + scalar);
  return persist(target.path, lines, { changed: true });
}

function persist(path, lines, extra) {
  try {
    copyFileSync(path, path + ".bak-panel-" + stamp());
  } catch {}
  writeFileSync(path, lines.join("\n"), "utf8");
  return { ok: true, path, ...extra };
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
