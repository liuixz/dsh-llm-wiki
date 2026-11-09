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
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { homedir } from "node:os";

export const CONFIG_KEYS = ["vault", "previewOrder", "rulesOrder", "mainAgentOnly"];

export function dshHome() {
  return process.env.DSH_HOME || join(process.env.USERPROFILE || homedir(), ".dsh");
}

/**
 * 找到**当前真正在跑**的 profile 目录名。判定不了就返回 null，绝不猜。
 *
 * 为什么不能只看环境变量：`DSH_PROFILE` 只注入给「模型 shell 调用」（dsh-shell-env 插件的
 * 内置项），插件进程自己的 process.env 里通常没有它。以前这里写了
 * `if (hits.includes("desktop")) return "desktop"` 兜底，于是**任何机器、任何 active profile
 * 都会被判成 desktop** —— 面板于是读 desktop 的 cordis.patch.yml 当「真源」，保存配置时
 * 也写进那个文件，改了不生效。
 *
 * 四级判定（前一级拿到答案就不看后面的）：
 *  1. `DSH_PROFILE` / `DSH_PROFILE_DIR`：shell 派生进程与 CI 场景下最准。
 *  2. `hint`：调用方从 DSH 的 `ctx.profileContext.name` 传进来的**运行时真值**
 *     （桌面版 launcher 提供的 profile 事实，见 dsh-plugin-guide）。这是插件进程里
 *     唯一可信的权威来源，优先级高于任何文件推断。
 *  3. `$DSH_HOME/desktop-next.json` 的 `active`：桌面版重启后仍在的「用户选了哪个 profile」。
 *     缺这个文件时 DSH 自己也会回退到 desktop，但那是 DSH 的选择，不该由我们硬编码。
 *  4. 扫 `profiles/<n>/package.json` 里谁依赖本包 —— 但要**排除符号链接**：
 *     `profiles/desktop/node_modules/dsh-llm-wiki` 指向另一个 profile 时，desktop 的
 *     package.json 里同样有 "dsh-llm-wiki" 字样，纯粹按文本匹配会把两个都算命中。
 *     判据是 realpath 之后仍落在**该 profile 自己**的 node_modules 下。
 *
 * 全都不成立 → null（调用方报「无法判定 profile」，而不是静默用 desktop）。
 */
export function detectProfile(packageRoot, hint) {
  // 1) 环境变量
  const fromEnv = profileNameOf(process.env.DSH_PROFILE);
  if (fromEnv) return fromEnv;
  const fromDir = profileNameOf(process.env.DSH_PROFILE_DIR ? baseName(process.env.DSH_PROFILE_DIR) : "");
  if (fromDir) return fromDir;

  // 2) 调用方给的运行时真值（ctx.profileContext.name）
  const fromHint = profileNameOf(hint);
  if (fromHint) return fromHint;

  const home = dshHome();
  const profilesDir = join(home, "profiles");

  // 3) 桌面版记录的 active profile
  const fromNext = readDesktopNextActive(home);
  if (fromNext && existsSync(join(profilesDir, fromNext))) return fromNext;

  // 4) 扫依赖本包的 profile，排除指向别处的符号链接
  const hits = profilesDependingOn(packageRoot);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    // 多个都真正装了本包：无法判定，交给调用方报错（以前这里取字典序第一个，
    // 等价于掷骰子 —— 选错 profile 就是写错配置文件）
    return null;
  }
  return null;
}

/** profile 名合法化（与 DSH 自己的 profileName() 同规则），不合法返回空串 */
function profileNameOf(value) {
  const s = String(value == null ? "" : value).trim();
  if (!s) return "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(s)) return "";
  if (/^(?:node_modules|con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) return "";
  return s;
}

function baseName(p) {
  const parts = String(p || "").split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

function readDesktopNextActive(home) {
  try {
    const file = join(home, "desktop-next.json");
    if (!existsSync(file)) return "";
    const obj = JSON.parse(readFileSync(file, "utf8") || "{}");
    return profileNameOf(obj && obj.active);
  } catch {
    return "";
  }
}

/**
 * 哪些 profile 是**真的**装了本包（不是指向别处的符号链接）。
 * @returns {string[]} profile 名数组
 */
function profilesDependingOn(packageRoot) {
  void packageRoot;
  const profilesDir = join(dshHome(), "profiles");
  if (!existsSync(profilesDir)) return [];
  const out = [];
  for (const name of readdirSafe(profilesDir)) {
    if (!profileNameOf(name)) continue;
    const dir = join(profilesDir, name);
    const pkg = join(dir, "package.json");
    if (!existsSync(pkg)) continue;
    let text = "";
    try {
      text = readFileSync(pkg, "utf8");
    } catch {
      continue;
    }
    if (!text.includes("dsh-llm-wiki")) continue;
    if (installedOwnCopy(dir, name, profilesDir)) out.push(name);
  }
  return out;
}

/**
 * 这个 profile 的 node_modules/dsh-llm-wiki 是真的（自己的安装），而不是指向**另一个 profile**。
 *
 * 关键：`link:D:/project/...` 这种开发安装，realpath 落在 `profiles/` 之外，这是合法的，
 * 不能当成「别处的」拒掉。真正要拒的只有一种：真实路径落在 `profiles/<别的>/` 里面
 * —— 那说明这个 profile 只是借用了另一个 profile 的安装（方案文档里 desktop → tctwork 的情形）。
 */
function installedOwnCopy(profileDir, name, profilesDir) {
  void name;
  const link = join(profileDir, "node_modules", "dsh-llm-wiki");
  let real = "";
  try {
    real = realpathSync(link);
  } catch {
    return true; // 没有这个目录：不构成「指向别处」的证据，保守算自己的
  }
  const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  const selfDir = (() => {
    try {
      return realpathSync(profileDir);
    } catch {
      return profileDir;
    }
  })();
  const a = norm(real);
  // 落在本 profile 目录内 → 自己的
  if (a === norm(selfDir) || a.startsWith(norm(selfDir + sep))) return true;
  // 落在 profiles/ 之外（工作区 link 安装、全局安装）→ 也算自己的
  let root = profilesDir;
  try {
    root = realpathSync(profilesDir);
  } catch {}
  if (!a.startsWith(norm(root + sep))) return true;
  // 落在 profiles/ 之内但不在自己目录下 → 借用了别的 profile
  return false;
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
  if (!profile) {
    // 判定不出 profile：真源那一层的路径留空，读取时展开成一条明确的错误，
    // 而不是拼出 profiles/null/cordis.patch.yml 去读一个不存在的文件。
    return [
      { id: "profile", label: "profile 的 cordis.patch.yml（真源）", writable: true, path: "", unresolvable: true },
      { id: "global", label: "$DSH_HOME/cordis.patch.yml", writable: false, path: join(home, "cordis.patch.yml") },
    ];
  }
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
    if (layer.unresolvable) {
      // 判定不出当前 profile：这一层给出明确的不可用原因，而不是指向一个瞎猜的文件
      err = "无法判定当前 profile，因此不知道真源在哪（见下方「profile 判定」）";
    } else {
      try {
        exists = existsSync(layer.path);
        if (exists) raw = readFileSync(layer.path, "utf8");
      } catch (e) {
        err = e && e.message ? e.message : String(e);
      }
    }
    const blk = exists ? readPluginBlock(raw) : { found: false, disabled: false, keys: {} };
    out.push({
      id: layer.id,
      label: layer.label,
      path: layer.path,
      writable: layer.writable,
      exists,
      error: err,
      unresolvable: !!layer.unresolvable,
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
  if (!profile) {
    // 判定不出 profile 时**绝不落笔**：以前这里会拼出 profiles/null/... 或者更糟，
    // 硬编码成 desktop 去改另一个 profile 的配置，用户改了不生效还找不到原因。
    throw new Error("无法判定当前 profile，已拒绝写入（避免改错配置文件）。请检查 DSH 的 profile 状态后重试。");
  }
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
