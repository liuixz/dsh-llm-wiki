#!/usr/bin/env node
// pipeline-health.mjs — 每日健康快照（CSV）+ 召回探针
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
const VAULT = process.env.LLM_WIKI_VAULT || "D:/学习/AI知识库/LLM-Wiki";
const OUT = process.env.LLM_WIKI_HEALTH_DIR || (process.env.LLM_WIKI_REPORTS || ((process.env.USERPROFILE || "") + "/.dsh/llm-wiki/reports")) + "/health";
const STATE = process.env.LLM_WIKI_STATE || path.join(process.env.USERPROFILE || "", ".dsh", "llm-wiki", "pipeline-state.json");
const USERMD = process.env.USER_MD || path.join(process.env.USERPROFILE || "", ".mnemon", "runtime", "USER.md");
// 检索脚本默认取本脚本同目录（link 安装下即仓库/scripts），找不到再回退历史布局 ~/.dsh/bin
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_BIN = path.join(process.env.USERPROFILE || "", ".dsh", "bin");
const BIN = process.env.LLM_WIKI_BIN || (fs.existsSync(path.join(SELF_DIR, "wiki-retrieval.mjs")) ? SELF_DIR : LEGACY_BIN);
const TODAY = new Date().toISOString().slice(0,10);
const read = p => { try { return fs.readFileSync(p,"utf8"); } catch { return ""; } };
const pages=[]; const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()){walk(p);continue;}if(!e.name.endsWith(".md")||e.name==="index.md")continue;pages.push({rel:path.relative(VAULT,p).replace(/\\/g,"/"),text:read(p)});}}; walk(path.join(VAULT,"wiki"));
const archived=pages.filter(p=>/status:\s*archived/.test(p.text.slice(0,1500))).length;
const rawDir=path.join(VAULT,"raw/sessions/dsh"); const raws=fs.existsSync(rawDir)?fs.readdirSync(rawDir).filter(f=>f.endsWith(".md")):[];
const allText=pages.map(p=>p.text).join("\n");
let compiled=0; for(const f of raws){ const short=(f.match(/([0-9a-f]{8})\.md$/)||[])[1]||""; if((short&&allText.includes(short))||allText.includes(f)) compiled++; }
const stale=pages.filter(p=>{ if(/status:\s*archived/.test(p.text.slice(0,1500))) return false; const m=p.text.slice(0,1500).match(/^updated:\s*(\S+)/m)||p.text.slice(0,1500).match(/^created:\s*(\S+)/m); if(!m) return false; return (Date.now()-new Date(m[1]).getTime())/864e5>90; }).length;
// lint 问题数只看「最新一条」pipeline 日志。
// 旧实现用 matchAll 取全文第一个 lint:N 命中：条目按新→旧排列时恰好是最新一条，
// 但只要最新那次运行不带 lint 段（例如只跑 --sync），就会把上一次的陈旧数字
// 当成今天的状态。这里显式取最新条目，取不到就报 -1（未知），不冒充旧值。
const logTxt=read(path.join(VAULT,"log.md"));
const newestEntry=(logTxt.split(/\r?\n/).find(l=>/^##\s*\[/.test(l))||"");
const mlog=newestEntry.match(/lint:(\d+)问题/);
const lintIssues=mlog?Number(mlog[1]):-1;
let syncPages=0, syncChunks=0; try{ const st=JSON.parse(read(STATE)); for(const k of Object.keys(st)) if(k.startsWith("wiki")){ syncPages++; syncChunks+=(st[k].chunks||[]).length; } }catch{}
const userMd=read(USERMD); const userEntries=(userMd.match(/\n§\n/g)||[]).length+(userMd.trim()?1:0); const userBytes=Buffer.byteLength(userMd,"utf8");
const REPORTS = (process.env.LLM_WIKI_REPORTS || ((process.env.USERPROFILE || "") + "/.dsh/llm-wiki/reports"));
const candFile=path.join(REPORTS,"profile-candidate-"+TODAY+".jsonl"); const candCount=fs.existsSync(candFile)?read(candFile).trim().split(/\r?\n/).filter(Boolean).length:0;
// 召回探针：从本 vault 的页面标题里取样，避免写死某个知识库里才存在的页面名。
// 取页面数按固定步长抽样（最多 6 条），用标题里的实词做查询、期望命中同名页面。
const sampleTitles = [];
if (pages.length) {
  const step = Math.max(1, Math.floor(pages.length / 6));
  for (let i = 0; i < pages.length && sampleTitles.length < 6; i += step) {
    const t = (pages[i].text.match(/^title:\s*"?([^"\n]+)/m) || [])[1];
    if (t) sampleTitles.push([t, t]);
  }
}
const probes = sampleTitles.length
  ? sampleTitles
  : [["mnemon 备份策略","Mnemon 记忆栈运维"],["LLM-Wiki 记忆层改造","记忆层改造方案"]];
let hit=0; for(const pr of probes){ try{ const out=execFileSync("node",[path.join(BIN,"wiki-retrieval.mjs"),pr[0],"--json","--limit","3","--no-mnemon"],{encoding:"utf8",timeout:30000}); const j=JSON.parse(out); const ok=(j.results||[]).slice(0,3).some(r=>String((r.rel||"")+(r.title||"")).toLowerCase().includes(String(pr[1]).toLowerCase())); if(ok) hit++; }catch{} }
const row=[TODAY,pages.length,archived,raws.length,compiled,raws.length?Math.round(compiled/raws.length*100):0,stale,lintIssues,syncPages,syncChunks,pages.length?Math.round(syncPages/pages.length*100):0,userEntries,userBytes,candCount,hit+"/"+probes.length].join(",");
fs.mkdirSync(OUT,{recursive:true}); const csv=path.join(OUT,"health-"+TODAY.slice(0,7)+".csv");
const header="date,pages,archived,rawSessions,compiled,compileRatePct,stale,lintIssues,syncPages,syncChunks,coveragePct,userEntries,userBytes,profileCandidates,probeHit";
if(!fs.existsSync(csv)) fs.writeFileSync(csv,header+"\n"+row+"\n","utf8"); else { const lines=read(csv).trim().split(/\r?\n/); const rest=lines.slice(1).filter(l=>!l.startsWith(TODAY+",")); fs.writeFileSync(csv,[header,...rest,row].join("\n")+"\n","utf8"); }
try {
  const lines=read(csv).trim().split(/\r?\n/); const head=lines[0].split(","); const rows=lines.slice(1).map(l=>l.split(","));
  if(rows.length){
    const first=rows[0], last=rows[rows.length-1];
    const md=["# 健康月报 "+TODAY.slice(0,7),"","> 数据来源: "+csv,"","| 指标 | 月初 | 最新 | 变化 |","|---|---|---|---|"];
    const cols={pages:"页面",archived:"归档",compiled:"已编译",stale:"stale",lintIssues:"lint问题",syncPages:"同步页",syncChunks:"同步块",coveragePct:"覆盖%",userEntries:"USER条目",profileCandidates:"画像候选",probeHit:"探针"};
    for(const [k,name] of Object.entries(cols)){ const i=head.indexOf(k); if(i<0) continue; const a=first[i], b=last[i]; const d=(Number(b)-Number(a)); md.push("| "+name+" | "+a+" | "+b+" | "+(isNaN(d)?(a===b?"-":"变化"):(d>0?"+"+d:String(d)))+" |"); }
    fs.writeFileSync(path.join(OUT,"health-"+TODAY.slice(0,7)+".md"),md.join("\n")+"\n","utf8");
  }
} catch {}
// ── 异常判定 → ALERT ──
const anomalies = [];
{
  const lines = read(csv).trim().split(/\r?\n/);
  const head = (lines[0] || "").split(",");
  const rows = lines.slice(1).map(l => l.split(","));
  const cur = rows[rows.length - 1] || [], prev = rows.length > 1 ? rows[rows.length - 2] : null;
  const idx = k => head.indexOf(k);
  const val = (r, k) => idx(k) >= 0 ? Number(r[idx(k)]) : NaN;
  if (prev) {
    if (val(cur, "syncPages") < val(prev, "syncPages") - 5) anomalies.push("syncPages 下降 (" + val(prev, "syncPages") + " → " + val(cur, "syncPages") + ")");
    if (val(cur, "stale") > val(prev, "stale") + 30) anomalies.push("stale 增加 (" + val(prev, "stale") + " → " + val(cur, "stale") + ")");
    if (val(cur, "lintIssues") > val(prev, "lintIssues") + 20) anomalies.push("lint 问题增加 (" + val(prev, "lintIssues") + " → " + val(cur, "lintIssues") + ")");
  }
  const hitStr = String((rows[rows.length - 1] || [])[idx("probeHit")] || "");
  const [hv, hn] = hitStr.split("/").map(Number);
  if (hn && hv / hn < 0.6) anomalies.push("召回探针下降 (" + hitStr + ")");
  if (process.env.LLM_WIKI_FORCE_ALERT === "1") anomalies.push("强制测试告警");
}
const alertFile = path.join(OUT, "ALERT.md");
if (anomalies.length) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(alertFile, "# LLM-Wiki ALERT " + TODAY + "\n\n- " + anomalies.join("\n- ") + "\n\n> 查看 reports/health/health-" + TODAY.slice(0,7) + ".csv 与 ~/.dsh/llm-wiki/*.log\n", "utf8");
  fs.appendFileSync(path.join(OUT, "alerts.log"), TODAY + " " + anomalies.join("; ") + "\n");
  process.exitCode = 2;
} else if (fs.existsSync(alertFile)) {
  try { fs.renameSync(alertFile, path.join(OUT, "ALERT.resolved.md")); } catch {}
  console.log(JSON.stringify({ resolved: true }));
}
console.log(JSON.stringify({date:TODAY,pages:pages.length,archived,compiled,rawSessions:raws.length,stale,syncPages,syncChunks,userEntries,userBytes,candCount,probeHit:hit+"/"+probes.length,csv}));