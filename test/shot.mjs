/**
 * 用真 Chrome 把 test/preview.html 渲染出来，在三种宽度下截真图，
 * 用来肉眼验收面板（假 DOM 探针只能验结构，验不了布局）。
 *
 *   node test/shot.mjs            默认 1200 / 900 / 420
 *   node test/shot.mjs 1200 420   自定义宽度
 *
 * 产物落在 test/shots/（已被 .gitignore 忽略）。
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(HERE, "shots");
mkdirSync(OUT, { recursive: true });

const widths = process.argv.slice(2).map(Number).filter((n) => n > 0);
if (widths.length === 0) widths.push(1200, 900, 420);
// 只截某个标签页：node test/shot.mjs 1200 --tab=tasks（默认只截配置页）
const tabArg = (process.argv.slice(2).find((a) => a.startsWith("--tab=")) || "").slice(6);
// --confirm：自动点一下「压实记忆库」，把内联二次确认的样子也截下来
const confirmArg = process.argv.includes("--confirm");
// --profile=unknown：截「判不出当前 profile」这个状态（0.13.6）
const profileArg = (process.argv.slice(2).find((a) => a.startsWith("--profile=")) || "").slice(10);

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let file;
  if (url.pathname === "/" || url.pathname === "/index.html") file = join(HERE, "preview.html");
  else if (url.pathname === "/fixture.js") {
    const state = readFileSync(join(HERE, "fixtures", "panel-state.json"), "utf8");
    res.writeHead(200, { "content-type": MIME[".js"] });
    res.end("window.__FIXTURE__ = " + state + ";");
    return;
  } else if (url.pathname === "/panel.js") file = join(ROOT, "web", "panel.js");
  else { res.writeHead(404); res.end("no"); return; }
  try {
    const buf = readFileSync(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch (e) {
    res.writeHead(500); res.end(String(e && e.message));
  }
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
console.log("preview server on http://127.0.0.1:" + port);

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));
if (!CHROME) { console.error("没找到 Chrome/Edge"); server.close(); process.exit(1); }

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(CHROME, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    p.on("close", (code) => resolve({ code, out }));
    p.on("error", reject);
  });
}

const profile = join(tmpdir(), "llmwiki-shot-" + Date.now());

// preview.html 会在页面里塞一行 METRICS={...}，这里顺手抓出来：
// 截图能看出"丑"，但看不出"有没有横向溢出"和"紧凑模式到底触发没有"。
function readMetrics(html) {
  const m = /METRICS=(\{[\s\S]*?\})<\/pre>/.exec(html);
  return m ? m[1] : "";
}

// Chrome 的 --window-size 最小只到 ~500px，420/360 档靠 ?w= 把容器压窄来模拟。
function pageUrl(w) {
  const q = [];
  if (w < 500) q.push("w=" + w);
  if (tabArg) q.push("tab=" + tabArg);
  if (confirmArg) q.push("confirm=1");
  if (profileArg) q.push("profile=" + profileArg);
  return "http://127.0.0.1:" + port + "/" + (q.length ? "?" + q.join("&") : "");
}

for (const w of widths) {
  const file = join(OUT, "w" + w + (tabArg ? "-" + tabArg : "") + (confirmArg ? "-confirm" : "") + (profileArg ? "-" + profileArg : "") + ".png");
  const common = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--user-data-dir=" + profile,
    "--window-size=" + Math.max(w, 520) + ",1500",
  ];
  const shot = await run([...common, "--screenshot=" + file, "--virtual-time-budget=2500", pageUrl(w)]);
  if (shot.code !== 0) console.log("w" + w + " screenshot exit=" + shot.code + " " + shot.out.slice(-200));
  else console.log("wrote " + file);

  const dom = await run([...common, "--dump-dom", "--virtual-time-budget=2500", pageUrl(w)]);
  console.log("w" + w + " metrics " + (readMetrics(dom.out) || "(未取到)"));
}

server.close();
console.log("shots in " + OUT);
