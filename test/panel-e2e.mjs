/**
 * 端到端探针：用假 DOM 把 web/panel.js 真跑一遍三个 tab。
 * 目的不是像素正确，而是「渲染路径不抛错、关键节点真的出现」。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/* ---------------- 极简假 DOM ---------------- */
let nodeCount = 0;
const htmlUses = [];

class TextNode {
  constructor(text) {
    this.nodeType = 3;
    this.nodeValue = String(text);
    this.parentNode = null;
  }
  get textContent() { return this.nodeValue; }
  set textContent(v) { this.nodeValue = String(v); }
}

class El {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag || "div").toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.style = {};
    this.listeners = {};
    this._text = "";
    this._classes = new Set();
    this.dataset = {};
    this.disabled = false;
    this.checked = false;
    this.value = "";
    this.type = "";
    this.title = "";
    nodeCount++;
    const self = this;
    this.classList = {
      add(...c) { c.forEach((x) => x && self._classes.add(x)); },
      remove(...c) { c.forEach((x) => self._classes.delete(x)); },
      contains(c) { return self._classes.has(c); },
      toggle(c, on) {
        const want = on === undefined ? !self._classes.has(c) : !!on;
        if (want) self._classes.add(c); else self._classes.delete(c);
        return want;
      }
    };
  }
  get className() { return [...this._classes].join(" "); }
  set className(v) {
    this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  appendChild(n) {
    if (!n) throw new Error("appendChild(null) on <" + this.tagName + ">");
    n.parentNode = this;
    this.children.push(n);
    return n;
  }
  insertBefore(n, ref) {
    n.parentNode = this;
    const i = this.children.indexOf(ref);
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    return n;
  }
  removeChild(n) {
    const i = this.children.indexOf(n);
    if (i >= 0) this.children.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  setAttribute(k, v) {
    if (v === undefined || v === null) throw new Error("setAttribute(" + k + ", " + v + ")");
    this.attributes[k] = String(v);
  }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const a = this.listeners[type] || [];
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }
  dispatch(type, ev) {
    (this.listeners[type] || []).forEach((fn) => fn(ev || { type, stopPropagation() {}, preventDefault() {} }));
  }
  focus() { doc.activeElement = this; }
  blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
  getBoundingClientRect() { return { width: 900, height: 600, top: 0, left: 0, right: 900, bottom: 600 }; }
  get textContent() {
    if (this._text) return this._text;
    return this.children.map((c) => c.textContent || "").join("");
  }
  set textContent(v) {
    this.children.forEach((c) => { c.parentNode = null; });
    this.children = [];
    this._text = v === undefined || v === null ? "" : String(v);
  }
  get innerHTML() { return this._html || ""; }
  set innerHTML(v) {
    // panel.js 只对静态 SVG 图标用 innerHTML（常量字符串，不拼用户数据），
    // 其余全部走 textContent。这里记录下来供检查，不当错误。
    this._html = String(v || "");
    if (/<(script|img|iframe)/i.test(this._html)) throw new Error("innerHTML 里出现危险标签: " + this._html.slice(0, 80));
    htmlUses.push(this._html.slice(0, 40));
  }
  contains(n) {
    if (!n) return false;
    if (n === this) return true;
    return this.children.some((c) => c.contains && c.contains(n));
  }
  querySelector(sel) {
    const m = /^\[data-fk="(.*)"\]$/.exec(sel);
    if (!m) throw new Error("querySelector 只支持 [data-fk=...]，收到 " + sel);
    const want = m[1];
    let hit = null;
    const walk = (node) => {
      if (hit) return;
      if (node.nodeType === 1) {
        if (node.getAttribute("data-fk") === want) { hit = node; return; }
        node.children.forEach(walk);
      }
    };
    walk(this);
    return hit;
  }
  querySelectorAll(sel) {
    const out = [];
    const m = /^\[data-fk="(.*)"\]$/.exec(sel);
    if (!m) throw new Error("querySelectorAll 只支持 [data-fk=...]，收到 " + sel);
    const want = m[1];
    const walk = (node) => {
      if (node.nodeType === 1) {
        if (node.getAttribute("data-fk") === want) out.push(node);
        node.children.forEach(walk);
      }
    };
    walk(this);
    return out;
  }
}

const doc = {
  activeElement: null,
  body: null,
  createElement(tag) { return new El(tag); },
  createTextNode(t) { return new TextNode(t); },
  querySelector() { return null; },
  head: null
};
doc.body = new El("body");
doc.head = new El("head");
doc.activeElement = doc.body;

globalThis.document = doc;
globalThis.window = {
  innerWidth: 900,
  addEventListener() {},
  removeEventListener() {},
  matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; }
};
globalThis.ResizeObserver = class {
  constructor(fn) { this.fn = fn; }
  observe() {}
  disconnect() { this.disconnected = true; }
};

/* ---------------- 装载 panel.js ---------------- */
const src = readFileSync(join(ROOT, "web/panel.js"), "utf8");
// 顶层是 IIFE，直接 eval 到全局；它只依赖 document/window
new Function(src)();
const api = globalThis.window.__LLMWikiPanel || globalThis.__LLMWikiPanel;
if (!api || typeof api.mount !== "function") throw new Error("window.__LLMWikiPanel 没挂上");

/* ---------------- 假 fetch ---------------- */
const realState = JSON.parse(readFileSync(join(HERE, "fixtures", "panel-state.json"), "utf8"));
const calls = [];
globalThis.fetch = function (url, opts) {
  const path = String(url).replace(/^.*?\/api/, "/api");
  calls.push((opts && opts.method ? opts.method : "GET") + " " + path);
  let body = { ok: true };
  if (path === "/api/state") body = realState;
  else if (path === "/api/embed") body = { ok: true, embed: realState.embed, backfill: null };
  else if (path === "/api/secret") body = { ok: true, items: realState.secrets || [] };
  return Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body)
  });
};

/* ---------------- 跑三 tab ---------------- */
const root = doc.createElement("div");
root.className = "llmwiki-panel";
doc.body.appendChild(root);

const handle = api.mount(root, { base: "/llm-wiki-panel", locale: "zh" });

function walk(node, fn) {
  if (node.nodeType === 1) {
    fn(node);
    node.children.forEach((c) => walk(c, fn));
  }
}
function texts(node) {
  const out = [];
  walk(node, (n) => { if (n._text) out.push(n._text); });
  return out;
}
function find(root2, cls) {
  const hits = [];
  walk(root2, (n) => { if (n.classList && n.classList.contains(cls)) hits.push(n); });
  return hits;
}

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: extra || "" });
}

await new Promise((r) => setTimeout(r, 60));

// 1) 首屏 = 配置页
const d = api.DICT.zh;
check("首屏渲染出设置卡片", find(root, "lw-card").length >= 3, "cards=" + find(root, "lw-card").length);
check("健康横幅已渲染", find(root, "lw-health").length === 1 || find(root, "lw-healthwrap").length === 1);
check("运行栏有 6 个命令 + ?", find(root, "lw-runbar")[0].children.length >= 7, "btns=" + find(root, "lw-runbar")[0].children.length);

// 2) 切到任务页
const tabBtns = find(root, "lw-tab");
check("三个 tab 有 role=tab", tabBtns.length === 3 && tabBtns.every((b) => b.getAttribute("role") === "tab"));
check("tablist 有 aria-label", find(root, "lw-tabs")[0].getAttribute("aria-label") === d.ariaTabs);
tabBtns[1].dispatch("click");
await new Promise((r) => setTimeout(r, 20));

const taskRows = find(root, "lw-table")[0].children.filter((c) => c.tagName === "TBODY")[0].children;
check("任务页有 5 行", taskRows.length === 5, "rows=" + taskRows.length);
check("停用行打上 is-off", taskRows.every((r) => r.classList.contains("is-off")), "classes=" + taskRows.map((r) => r.className).join("|"));
const offNext = texts(taskRows[0]);
check("停用任务的「下次运行」不再显示未来时间", !offNext.some((t) => /2026\//.test(t)), offNext.join(" / "));
check("表头有 scope=col", find(root, "lw-table").length > 0 &&
  find(root, "lw-table").every((tb) => tb.children[0].children[0].children.every((th) => th.getAttribute("scope") === "col")));
// PowerShell 的 LastRunTime 走系统区域设置（fixture 里是 10/31/2026 02:50:50），
// 同一张表里混两种日期格式，读的人要先猜哪段是月。
// texts() 会把「任务名 + 描述 + 状态胶囊」都摊平，列下标对不上，直接按内容断言。
const allTaskTexts = taskRows.map((r) => texts(r).join(" / "));
check("上次运行时间已归一为 ISO 风格",
  allTaskTexts.some((t) => /2026-10-31 02:50/.test(t)) && !allTaskTexts.some((t) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(t)),
  allTaskTexts[0]);
// 3) 切到历史页
tabBtns[2].dispatch("click");
await new Promise((r) => setTimeout(r, 20));
check("历史页有「只看异常」开关", find(root, "lw-switch").length === 1);
const histTables = find(root, "lw-table");
check("历史页有两张表（趋势 + 日志）", histTables.length === 2, "tables=" + histTables.length);
const logHead = texts(histTables[1].children[0]);
check("日志表不再有 kind 列", !logHead.includes("kind"), logHead.join("|"));
check("日志表有「指标」列", logHead.includes(d.facts), logHead.join("|"));
check("日志表第三列不是空标题", logHead.filter(Boolean).length === 3, logHead.join("|"));
const logBody = histTables[1].children[1];
check("日志表渲染了 60 行", logBody.children.length === 60, "rows=" + logBody.children.length);
check("日志行渲染出事实胶囊", find(root, "lw-facts").length > 0, "facts=" + find(root, "lw-facts").length);
// log.md 的摘要全是 key:value，rest 恒为空；第三列必须改从 facts 里捡 FACT_ORDER 之外的键，
// 否则 60 行摘要全是「—」。
const noteCells = logBody.children.map((r) => texts(r)[2] || "");
check("摘要列不再是清一色「—」", noteCells.filter((t) => t !== "—").length > 0,
  "dash=" + noteCells.filter((t) => t === "—").length + "/" + noteCells.length);
check("有异常的行打了 is-stale", logBody.children.some((r) => r.classList.contains("is-stale")),
  "stale=" + logBody.children.filter((r) => r.classList.contains("is-stale")).length);

// 4) 「只看异常」过滤
const sw = find(root, "lw-switch")[0];
const cb = sw.children.find((c) => c.tagName === "INPUT");
cb.checked = true;
cb.dispatch("change");
await new Promise((r) => setTimeout(r, 20));
const logBody2 = find(root, "lw-table")[1].children[1];
check("只看异常后行数变少", logBody2.children.length < 60 && logBody2.children.length > 0, "rows=" + logBody2.children.length);

// 6) 回配置页，验压实二次确认
tabBtns[0].dispatch("click");
await new Promise((r) => setTimeout(r, 20));

// 6a) 健康横幅说的是实话（五个任务全停 → bad，且写明 5 个）
const hb = find(root, "lw-health")[0];
check("健康横幅是 bad 态", hb.classList.contains("is-bad"), "classes=" + hb.className);
const hbText = hb.textContent;
check("健康横幅点出 5 个任务停用", /5/.test(hbText) && /停用/.test(hbText), hbText);
check("健康横幅 role=alert", hb.getAttribute("role") === "alert");
check("健康横幅有「为什么？」", texts(hb).some((t) => t === d.hShowWhy) || texts(hb).some((t) => t === d.hHideWhy), texts(hb).join("|"));

// 6b) 展开「为什么？」
const whyBtn = find(hb, "lw-btn").find((b) => b.textContent === d.hShowWhy);
whyBtn.dispatch("click");
await new Promise((r) => setTimeout(r, 10));
const hb2 = find(root, "lw-health")[0];
check("展开后显示依据列表", find(hb2, "lw-health-list").length === 1 && hb2.textContent.length > hbText.length, "len " + hbText.length + " → " + hb2.textContent.length);

// 6c) 压实：点一下只提问，不执行
// 注意：运行栏里也有一个「压实记忆库」命令按钮，必须限定在存储卡片内找。
function storageCard() {
  return find(root, "lw-card").find((c) => c.textContent.indexOf(d.dbTitle) === 0);
}
function storageCompactBtn() {
  return find(storageCard(), "lw-btn").find((b) => b.textContent === d.dbCompact || b.textContent === d.dbCompacting);
}
const compactBtn = storageCompactBtn();
check("存储卡里有压实按钮", !!compactBtn, "card=" + (storageCard() ? "yes" : "no"));
const before = calls.length;
compactBtn.dispatch("click");
await new Promise((r) => setTimeout(r, 10));
check("点压实不立刻发请求", calls.length === before, "calls " + before + " → " + calls.length);
const cfBox = find(root, "lw-confirm")[0];
check("出现内联二次确认", !!cfBox);
check("确认框写明条数", /325/.test(cfBox.textContent), cfBox.textContent);
check("确认框 role=alertdialog", cfBox.getAttribute("role") === "alertdialog");
check("确认框有确认与取消两键", find(cfBox, "lw-btn").length === 2);

// 6d) Esc 取消确认
root.dispatch("keydown", { key: "Escape", stopPropagation() {} });
await new Promise((r) => setTimeout(r, 10));
check("Esc 关闭二次确认", find(root, "lw-confirm").length === 0);
check("Esc 后仍未发请求", calls.length === before, "calls=" + calls.length);

// 6e) 真正确认才执行
storageCompactBtn().dispatch("click");
await new Promise((r) => setTimeout(r, 10));
const yesBtn = find(root, "lw-confirm")[0].children.find((c) => c.classList.contains("is-danger-fill"));
yesBtn.dispatch("click");
await new Promise((r) => setTimeout(r, 20));
check("确认后才 POST /api/run", calls.some((c) => c === "POST /api/run"), calls.join(","));

// 7) 焦点保持：点「改」→ 出现输入框并聚焦 → 取消 → 焦点回到「改」
await new Promise((r) => setTimeout(r, 20));
const editBtn = find(root, "lw-btn").find((b) => b.getAttribute("data-fk") === "cfg:vault:edit");
check("配置行「改」按钮有焦点键", !!editBtn);
if (editBtn) {
  editBtn.dispatch("click");
  await new Promise((r) => setTimeout(r, 10));
  const input = find(root, "lw-input").find((n) => n.getAttribute("data-fk") === "cfg:vault:input");
  check("进入编辑态出现输入框", !!input);
  if (input) input.focus();
  const cancel = find(root, "lw-btn").find((b) => b.getAttribute("data-fk") === "cfg:vault:cancel");
  cancel.dispatch("click");
  await new Promise((r) => setTimeout(r, 10));
  check("取消后焦点回到该行「改」", doc.activeElement && doc.activeElement.getAttribute("data-fk") === "cfg:vault:edit",
    "active=" + (doc.activeElement && doc.activeElement.getAttribute && doc.activeElement.getAttribute("data-fk")));
}

// 8) 命令说明展开/收起
const helpBtn = find(root, "lw-runbar")[0].children.find((b) => b.textContent === "?");
helpBtn.dispatch("click");
await new Promise((r) => setTimeout(r, 20));
check("命令说明面板展开", find(root, "lw-cmdhelp").length === 1);
check("命令说明有 6 行", find(root, "lw-cmdhelp-row").length === 6, "rows=" + find(root, "lw-cmdhelp-row").length);
// 展开态此前用 is-primary：同屏「全量」也是实心蓝，两个主按钮互相抵消。
check("「?」展开时不抢主按钮的实心蓝",
  !find(root, "lw-runbar")[0].children.find((b) => b.textContent === "?").classList.contains("is-primary"));
const helpBtn2 = find(root, "lw-runbar")[0].children.find((b) => b.textContent === "?");
helpBtn2.dispatch("click");
await new Promise((r) => setTimeout(r, 20));
check("再点收起", find(root, "lw-cmdhelp").length === 0);

// 8b) 搜索无匹配：卡片不能被整张删掉（用户会以为功能没了）
const searchBox = find(root, "lw-search")[0];
searchBox.value = "zzz-no-such-thing";
searchBox.dispatch("input");
await new Promise((r) => setTimeout(r, 20));
const cardsAfterFilter = find(root, "lw-card").length;
check("搜索无匹配时卡片仍占位", cardsAfterFilter >= 2 && find(root, "lw-empty").length > 0, "cards=" + cardsAfterFilter);
searchBox.value = "";
searchBox.dispatch("input");
await new Promise((r) => setTimeout(r, 20));

// 8c) 输出面板：fmtTime 曾被定义却零调用（死代码），输出面板也从不显示运行开始时间。
realState.run = {
  id: "run-1",
  command: "sync",
  startedAt: Date.UTC(2026, 10, 8, 13, 30, 0),
  finished: true,
  exitCode: 0,
  output: ["sync 239 条", "done"]
};
await handle.refresh();
await new Promise((r) => setTimeout(r, 40));
const footTime = find(root, "lw-foot-time")[0];
check("输出面板显示运行开始时间", !!footTime && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(footTime.textContent),
  footTime && footTime.textContent);
realState.run = null;
await handle.refresh();
await new Promise((r) => setTimeout(r, 40));

// 8d) profile 判不出来时（0.13.6）：不能假装正常，要明说原因
// 背景：detectProfile 曾硬编码兜底 desktop，于是任何机器都判成 desktop，
// 保存配置写进错的文件。现在判不出来就返回 null，前端必须把这件事说出来。
const savedProfile = realState.profile;
const savedLayers = realState.layers;
realState.profile = null;
realState.layers = [
  {
    id: "profile",
    label: "profile 的 cordis.patch.yml（真源）",
    path: "",
    writable: true,
    exists: false,
    error: "无法判定当前 profile，因此不知道真源在哪（见下方「profile 判定」）",
    unresolvable: true,
    found: false,
    disabled: false,
    duplicateEntries: 0,
    keys: {}
  },
  savedLayers[1]
];
await handle.refresh();
await new Promise((r) => setTimeout(r, 40));

const body = find(root, "lw-body")[0] || root;
const allText = body.textContent || "";
check("判不出 profile 时页面上写明了", allText.indexOf(d.profileUnknown) >= 0, "has=" + (allText.indexOf(d.profileUnknown) >= 0));
check("判不出 profile 时有解释卡", find(root, "lw-profwarn").length === 1,
  "count=" + find(root, "lw-profwarn").length);
check("解释里说明写入被拒绝", /拒绝/.test(allText) && /profile/i.test(allText));
// 层表：真源层显示「判不出 profile」，而不是「不存在」——用户能采取的动作完全不同
const layerCodes = find(root, "lw-code").map((n) => n.textContent || "");
check("真源层路径显示为占位而不是 profiles/null", layerCodes.indexOf("—") >= 0 && !layerCodes.some((t) => t.indexOf("null") >= 0),
  JSON.stringify(layerCodes.slice(0, 3)));
check("真源层胶囊写的是「判不出 profile」", allText.indexOf(d.profileUnknown) >= 0 && allText.indexOf("不存在") !== allText.indexOf(d.profileUnknown));
// 服务端会 409 拒绝写入；与其让用户改完再吃错误，不如一开始就按住按钮
const editBtns = find(root, "lw-btn").filter((b) => b.textContent === d.edit && b.getAttribute("data-fk"));
check("判不出 profile 时「改」按钮被按住", editBtns.length > 0 && editBtns.every((b) => b.disabled === true),
  "btn=" + editBtns.length + " disabled=" + editBtns.filter((b) => b.disabled).length);
check("按住时按钮带解释（title）", editBtns.every((b) => !!b.title), "titled=" + editBtns.filter((b) => !!b.title).length);

realState.profile = savedProfile;
realState.layers = savedLayers;
await handle.refresh();
await new Promise((r) => setTimeout(r, 40));
check("profile 恢复后解释卡消失", find(root, "lw-profwarn").length === 0,
  "count=" + find(root, "lw-profwarn").length);

// 8e) vault 不可用（0.13.7）：用户点「全量」报 ENOENT 之前，面板就该先红
// 背景：collectPages() 对不存在的目录静默跳过，于是坏 vault 先渲染成一排 0，
// 然后崩在 writeFileSync(join(WIKI,"index.md")) 的堆栈里。现在服务端先探一次，
// 前端据此出红灯，并且「去」按钮要指向配置项而不是任务页。
const savedProbe = realState.vaultProbe;
realState.vaultProbe = {
  ok: false,
  state: "missing",
  vault: "D:\\vault\\LLM-Wiki",
  wikiPath: "D:\\vault\\LLM-Wiki\\wiki",
  pages: 0,
  pageDirs: 0
};
await handle.refresh();
await new Promise((r) => setTimeout(r, 40));
const vb = find(root, "lw-health")[0];
check("vault 坏了健康横幅是 bad", !!vb && vb.classList.contains("is-bad"), vb ? vb.className : "no banner");
const vbText = vb ? vb.textContent : "";
check("横幅写明 vault 目录不存在", /vault/i.test(vbText) && /不存在/.test(vbText), vbText);
// 指错页面等于把用户从坑边推到另一个坑：vault 问题要去配置项，不是任务页
const vbBtns = vb ? texts(vb) : [];
check("vault 坏时「去」按钮指向配置项",
  vbBtns.indexOf(d.hGoConfig) >= 0 && vbBtns.indexOf(d.hGoTasks) < 0, vbBtns.join("|"));

// 另一档：vault 在、wiki/ 也在，但一页都没有（装完没导入 / 指错目录）
realState.vaultProbe = {
  ok: false,
  state: "nopages",
  vault: "D:\\vault\\LLM-Wiki",
  wikiPath: "D:\\vault\\LLM-Wiki\\wiki",
  pages: 0,
  pageDirs: 2
};
await handle.refresh();
await new Promise((r) => setTimeout(r, 40));
const vb2 = find(root, "lw-health")[0];
check("空 vault 也是 bad", !!vb2 && vb2.classList.contains("is-bad"), vb2 ? vb2.className : "no banner");
check("空 vault 的文案与「不存在」区分开",
  vb2 && /一页都没有/.test(vb2.textContent) && !/不存在/.test(vb2.textContent), vb2 ? vb2.textContent : "");

realState.vaultProbe = savedProbe;
await handle.refresh();
await new Promise((r) => setTimeout(r, 40));

// 9) 销毁
handle.destroy();
check("destroy 清空 root", root.children.length === 0);

/* ---------------- 输出 ---------------- */
const bad = results.filter((r) => !r.ok);
for (const r of results) console.log((r.ok ? "PASS " : "FAIL ") + r.name + (r.extra ? "  [" + r.extra + "]" : ""));
console.log("---");
console.log("total=" + results.length + " pass=" + results.filter((r) => r.ok).length + " fail=" + bad.length);
console.log("api calls=" + calls.length + " nodes=" + nodeCount);
process.exitCode = bad.length === 0 ? 0 : 1;
