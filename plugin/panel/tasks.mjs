/**
 * plugin/panel/tasks.mjs —— 计划任务状态读取与有限改写（零外部依赖）
 *
 * 职责（按用户决定）：
 *  - 只读展示：名称 / 状态 / 上次运行 / 上次结果 / 下次运行 / 触发时间 / 命令
 *  - 允许：启用 / 停用、改触发时间（每日任务的时刻、每周任务的时刻）
 *  - 不允许：新建、删除、改命令、改计划类型
 *  - Linux：只读展示，写操作一律返回 { ok:false, reason:"只读" }，不报错
 *
 * Windows 实现走 PowerShell 的 ScheduledTasks 模块（Get-ScheduledTask / Get-ScheduledTaskInfo /
 * Enable-ScheduledTask / Disable-ScheduledTask / New-ScheduledTaskTrigger + Register-ScheduledTask），
 * 因为 schtasks.exe 的本地化输出难以稳定解析。脚本以 -EncodedCommand 传入，避免引号与编码问题。
 */
import { execFile } from "node:child_process";

/** 面板管理的五个任务（与 install.ps1 的 $TaskPrefix 默认值一致：无前缀） */
export const MANAGED_TASKS = [
  { name: "LLM-Wiki Pipeline", schedule: "daily", time: "10:00", script: "llm-wiki-cron.cmd", desc: "每日全量管线 + 健康快照" },
  { name: "Profile Distill", schedule: "weekly", time: "09:00", script: "profile-distill-cron.cmd", desc: "画像候选蒸馏" },
  { name: "LLM-Wiki Compile Candidates", schedule: "weekly", time: "09:20", script: "compile-candidates.cmd", desc: "未编译会话候选" },
  { name: "LLM-Wiki Stale Review", schedule: "weekly", time: "09:40", script: "stale-review.cmd", desc: "stale 页面复核清单" },
  { name: "LLM-Wiki Weekly Summary", schedule: "weekly", time: "09:50", script: "weekly-summary.cmd", desc: "周报" },
];

export const IS_WINDOWS = process.platform === "win32";

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    // [Console]::OutputEncoding 必须显式设成 UTF-8：powershell.exe 默认按系统代码页（简体中文是 936/GBK）
    // 管道输出，而我们按 utf8 解码，中文报错就会变成「锟斤拷」式乱码，看不出到底哪里错。
    const prefix =
      "$ProgressPreference='SilentlyContinue'\n" +
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8\n" +
      "$OutputEncoding=[Text.Encoding]::UTF8\n";
    const encoded = Buffer.from(prefix + script, "utf16le").toString("base64");
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-EncodedCommand", encoded],
      { encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 30000 },
      (err, stdout) => {
        if (err) return reject(new Error(String((err && err.message) || err) + (stdout ? " | " + stdout.slice(0, 400) : "")));
        resolve(String(stdout || ""));
      },
    );
  });
}

/** 把 Windows 的 LastTaskResult 转成人话（只覆盖常见值） */
export function explainResult(code) {
  const n = Number(code);
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "成功";
  if (n === 267008) return "就绪";
  if (n === 267009) return "正在运行";
  if (n === 267010) return "未排定";
  if (n === 267011) return "尚未运行";
  if (n === 267012) return "没有更多计划";
  if (n === 267013) return "没有有效触发器";
  if (n === 267014) return "任务已禁用";
  if (n === 2147946720) return "上次运行未正常结束（0x800710E0）";
  // 0x8007xxxx = HRESULT from Win32
  if (n >= 2147483648) {
    const win32 = (n >>> 0) - 0x80070000;
    if (win32 === 2) return "文件未找到";
    if (win32 === 5) return "拒绝访问";
    if (win32 === 1058) return "任务已禁用";
    return "0x" + (n >>> 0).toString(16) + "（失败）";
  }
  return String(n);
}

/** 读五个任务的状态。Linux 或 PowerShell 不可用时返回 available:false，不抛。 */
export async function readTasks() {
  if (!IS_WINDOWS) {
    return { available: false, platform: process.platform, reason: "当前平台不支持计划任务管理（只读展示为空）", tasks: [] };
  }
  const list = MANAGED_TASKS.map((t) => '"' + t.name.replace(/"/g, '""') + '"').join(",");
  const script = [
    "$names=@(" + list + ")",
    "$out=@()",
    "foreach($n in $names){",
    "  $t=Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue",
    "  if($null -eq $t){ $out+=[pscustomobject]@{name=$n;exists=$false}; continue }",
    "  $i=Get-ScheduledTaskInfo -TaskName $n -ErrorAction SilentlyContinue",
    "  $tr=$null; $kind=''; $time=''",
    "  foreach($g in $t.Triggers){",
    "    if($g.CimClass.CimClassName -match 'Daily'){ $kind='daily' } elseif($g.CimClass.CimClassName -match 'Weekly'){ $kind='weekly' }",
    "    if($g.StartBoundary){ $bd=[datetime]$g.StartBoundary; $time=$bd.ToString('HH:mm') }",
    "  }",
    "  $act=''; foreach($a in $t.Actions){ $act=$a.Execute }",
    "  $out+=[pscustomobject]@{name=$n;exists=$true;state=[string]$t.State;enabled=([string]$t.State -ne 'Disabled');kind=$kind;time=$time;action=$act;lastRun=[string]$i.LastRunTime;lastResult=$i.LastTaskResult;nextRun=[string]$i.NextRunTime}",
    "}",
    "$out | ConvertTo-Json -Depth 4 -Compress",
  ].join("\n");

  let raw = "";
  try {
    raw = await runPowerShell(script);
  } catch (e) {
    return { available: false, platform: process.platform, reason: "读取计划任务失败：" + (e && e.message ? e.message : String(e)), tasks: [] };
  }
  const jsonLine = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("[") || l.startsWith("{")).pop();
  let parsed = [];
  try {
    parsed = JSON.parse(jsonLine || "[]");
  } catch {
    return { available: false, platform: process.platform, reason: "计划任务输出无法解析", tasks: [] };
  }
  if (!Array.isArray(parsed)) parsed = [parsed];
  const byName = new Map(parsed.map((x) => [String(x && x.name || ""), x]));
  const tasks = MANAGED_TASKS.map((def) => {
    const live = byName.get(def.name) || { exists: false };
    const exists = live.exists !== false;
    return {
      name: def.name,
      desc: def.desc,
      script: def.script,
      schedule: exists && live.kind ? live.kind : def.schedule,
      time: exists && live.time ? live.time : def.time,
      exists,
      enabled: exists ? live.enabled !== false && String(live.state || "") !== "Disabled" : false,
      state: exists ? String(live.state || "") : "未注册",
      lastRun: exists && live.lastRun && live.lastRun !== "0001-01-01 00:00:00" && !/^1\/1\/1 /.test(live.lastRun) ? live.lastRun : "",
      lastResult: exists ? Number(live.lastResult) : null,
      lastResultText: exists ? explainResult(live.lastResult) : "",
      nextRun: exists && live.nextRun && !/^1\/1\/1 /.test(live.nextRun) ? live.nextRun : "",
      action: exists ? String(live.action || "") : "",
    };
  });
  return { available: true, platform: process.platform, reason: "", tasks };
}

/** 启用/停用。Linux 返回只读拒绝。 */
export async function setTaskEnabled(name, enabled) {
  const def = MANAGED_TASKS.find((t) => t.name === name);
  if (!def) throw new Error("不认识的任务: " + name);
  if (!IS_WINDOWS) return { ok: false, reason: "当前平台只读展示，不支持启用/停用" };
  const verb = enabled ? "Enable-ScheduledTask" : "Disable-ScheduledTask";
  const script = [
    "$ErrorActionPreference='Stop'",
    "try{",
    "  " + verb + " -TaskName " + psStr(def.name) + " | Out-Null",
    "  'OK'",
    "}catch{ 'ERR ' + $_.Exception.Message }",
  ].join("\n");
  const out = await runPowerShell(script).catch((e) => "ERR " + (e && e.message ? e.message : String(e)));
  const text = String(out).trim();
  if (text.startsWith("OK")) return { ok: true };
  return { ok: false, reason: text.replace(/^ERR\s*/, "") || "未知错误" };
}

/** 改触发时刻（只改时间，不换计划类型）。 */
export async function setTaskTime(name, hhmm) {
  const def = MANAGED_TASKS.find((t) => t.name === name);
  if (!def) throw new Error("不认识的任务: " + name);
  if (!IS_WINDOWS) return { ok: false, reason: "当前平台只读展示，不支持改触发时间" };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(hhmm || ""))) throw new Error("时间格式必须是 HH:mm");
  const script = [
    "$ErrorActionPreference='Stop'",
    "try{",
    "  $t=Get-ScheduledTask -TaskName " + psStr(def.name) + " -ErrorAction Stop",
    "  $kind=''",
    "  foreach($g in $t.Triggers){ if($g.CimClass.CimClassName -match 'Daily'){$kind='daily'} elseif($g.CimClass.CimClassName -match 'Weekly'){$kind='weekly'} }",
    "  if($kind -eq ''){ throw '任务的触发器类型不受支持（既非每日也非每周）' }",
    "  $time=" + psStr(String(hhmm)),
    "  if($kind -eq 'daily'){",
    "    $nt=New-ScheduledTaskTrigger -Daily -At $time",
    "  } else {",
    // DaysOfWeek 是 UInt16 位掩码（周日=1 周一=2 … 周六=64），不是枚举下标。
    // 直接把这个数字交给 -DaysOfWeek 会被当成星期几的序号，写回去天数就整体错位。
    "    $map=@(@{bit=1;name='Sunday'},@{bit=2;name='Monday'},@{bit=4;name='Tuesday'},@{bit=8;name='Wednesday'},@{bit=16;name='Thursday'},@{bit=32;name='Friday'},@{bit=64;name='Saturday'})",
    "    $mask=0; foreach($g in $t.Triggers){ $mask=$mask -bor [int]$g.DaysOfWeek }",
    "    $days=@(); foreach($m in $map){ if($mask -band $m.bit){ $days+=$m.name } }",
    "    if($days.Count -eq 0){ $days=@('Sunday') }",
    "    $nt=New-ScheduledTaskTrigger -Weekly -At $time -DaysOfWeek $days",
    "  }",
    "  $settings=$t.Settings",
    // schtasks /Create 建出来的任务 Description 是 NULL，而 -Description 带 ValidateNotNullOrEmpty，
    // 传 $null 会抛「无法对参数 Description 执行参数验证。参数为 Null 或空」。这里给回退值。
    "  $desc=$t.Description; if([string]::IsNullOrWhiteSpace($desc)){ $desc=" + psStr(def.desc) + " }",
    "  Register-ScheduledTask -TaskName " + psStr(def.name) + " -Trigger $nt -Action $t.Actions -Settings $settings -Principal $t.Principal -Description $desc -Force | Out-Null",
    "  'OK'",
    "}catch{ 'ERR ' + $_.Exception.Message }",
  ].filter(Boolean).join("\n");
  const out = await runPowerShell(script).catch((e) => "ERR " + (e && e.message ? e.message : String(e)));
  const text = String(out).trim();
  if (text.startsWith("OK")) return { ok: true };
  return { ok: false, reason: text.replace(/^ERR\s*/, "") || "未知错误" };
}

function psStr(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}
