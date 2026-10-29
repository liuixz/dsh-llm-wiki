param(
  [string]$Version = '',
  [string]$Proxy = '',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
Set-Location $Repo

# 原生命令（git / node）会把进度和警告写到 stderr。Windows PowerShell 5.1 在
# $ErrorActionPreference='Stop' 下会把原生 stderr 当成终止性错误收进 ErrorRecord，
# 于是 git push 明明成功、Release 也建好了，脚本却以 exit 1 收场。
#
# 这里刻意不用管道（& exe ... 2>&1 | ...）：一来某些受限环境里连 CreatePipe 都会被
# 拒绝（“拒绝访问”），二来正是把 PowerShell 的错误流和子进程的 stderr 混进同一根
# 管道，才让“成功也报错”难以分辨。改成用 .NET Process 把两条流分开读回来、只看退出
# 码判成败——stderr 不再经过 PowerShell 的错误流，也就不可能被误当成失败。
function ConvertTo-CommandLineArg {
  param([string]$Value)
  if ($null -eq $Value) { return '""' }
  if ($Value -ne '' -and $Value -notmatch '[\s"]') { return $Value }
  # Windows 命令行转义：反斜杠只在引号前成对翻倍，末尾反斜杠也要翻倍。
  $b = $Value -replace '(\\*)"', '$1$1\"'
  $b = $b -replace '(\\+)$', '$1$1'
  return '"' + $b + '"'
}

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [string[]]$Arguments = @(),
    [string]$InputText = ''
  )
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Exe
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = $true
  $psi.StandardOutputEncoding = New-Object Text.UTF8Encoding $false
  $psi.StandardErrorEncoding = New-Object Text.UTF8Encoding $false
  $psi.Arguments = (@($Arguments) | ForEach-Object { ConvertTo-CommandLineArg $_ }) -join ' '
  $p = [System.Diagnostics.Process]::Start($psi)
  # 先挂异步读取再写 stdin，避免任一侧缓冲区写满造成互等。
  $outTask = $p.StandardOutput.ReadToEndAsync()
  $errTask = $p.StandardError.ReadToEndAsync()
  try {
    if ($InputText) { $p.StandardInput.Write($InputText) }
  } catch {
    # 进程可能已经退出，忽略“管道已关闭”这类写入失败。
  } finally {
    try { $p.StandardInput.Close() } catch { }
  }
  $p.WaitForExit()
  $out = $outTask.Result
  $err = $errTask.Result
  $code = $p.ExitCode
  $p.Dispose()
  $lines = @(($out + $err) -split "\r?\n" | Where-Object { $_.Trim() -ne '' })
  return [pscustomobject]@{ ExitCode = $code; Lines = $lines; StdOut = $out; StdErr = $err }
}

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [string[]]$Arguments = @(),
    [string]$What = ''
  )
  $r = Invoke-Native -Exe $Exe -Arguments $Arguments
  if ($r.ExitCode -ne 0) {
    $label = if ($What) { $What } else { $Exe + ' ' + ($Arguments -join ' ') }
    throw ($label + ' failed (exit ' + $r.ExitCode + ')' + [Environment]::NewLine + ($r.Lines -join [Environment]::NewLine))
  }
  return $r
}

$pkg = [IO.File]::ReadAllText((Join-Path $Repo 'package.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
if (-not $Version) { $Version = $pkg.version }
if ($pkg.version -ne $Version) { throw "package.json version ($($pkg.version)) != $Version" }
Write-Host ("==> version " + $Version)
Get-ChildItem 'scripts\*.mjs', 'plugin\*.mjs' | ForEach-Object {
  $chk = Invoke-Native -Exe node -Arguments @('--check', $_.FullName)
  if ($chk.ExitCode -ne 0) { throw ('syntax error: ' + $_.Name) }
}
$errs = $null; $toks = $null
[void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo 'install.ps1'), [ref]$toks, [ref]$errs)
if ($errs.Count -gt 0) { throw ('install.ps1 parse error: ' + $errs[0].Message) }
$leak = Select-String -Path 'scripts\*.mjs', 'plugin\*.mjs', 'install.ps1', 'README.md' -Pattern 'sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|C:\\Users\\[A-Za-z0-9_.-]+' -ErrorAction SilentlyContinue
if ($leak) { throw ('secret/path leak: ' + ($leak | Select-Object -First 1).Path) }
Write-Host '==> profile eval gate'
$evalRaw = ((Invoke-NativeChecked -Exe node -Arguments @((Join-Path $Repo 'scripts\eval-profile.mjs')) -What 'eval-profile').Lines) -join [Environment]::NewLine
$j0 = $evalRaw.IndexOf('{'); $j1 = $evalRaw.LastIndexOf('}')
if ($j0 -lt 0 -or $j1 -le $j0) { throw 'eval-profile produced no JSON' }
$ev = $evalRaw.Substring($j0, $j1 - $j0 + 1) | ConvertFrom-Json
if ([int]$ev.rate -ne 100) { throw ('profile eval gate failed: ' + $ev.rate + '%') }
Write-Host ('    eval ' + $ev.pass + '/' + $ev.cases)
$retRaw = ((Invoke-NativeChecked -Exe node -Arguments @((Join-Path $Repo 'scripts\eval-retrieval.mjs')) -What 'eval-retrieval').Lines) -join [Environment]::NewLine
$r0 = $retRaw.IndexOf('{'); $r1 = $retRaw.LastIndexOf('}')
if ($r0 -lt 0 -or $r1 -le $r0) { throw 'eval-retrieval produced no JSON' }
$rv = $retRaw.Substring($r0, $r1 - $r0 + 1) | ConvertFrom-Json
if ([int]$rv.rate -ne 100) { throw ('retrieval eval gate failed: ' + $rv.rate + '%') }
Write-Host ('    retrieval ' + $rv.pass + '/' + $rv.cases)

$cl = [IO.File]::ReadAllText((Join-Path $Repo 'CHANGELOG.md'), [Text.Encoding]::UTF8)
$m = [regex]::Match($cl, '(?ms)^## ' + [regex]::Escape($Version) + ' [^\r\n]*\r?\n(.*?)(?=^## |\z)')
if (-not $m.Success) { throw ('CHANGELOG missing section for ' + $Version) }
$notes = $m.Groups[1].Value.Trim()
if ($DryRun) { Write-Host 'DRYRUN OK'; Write-Host ('notes: ' + $notes.Substring(0, [Math]::Min(80, $notes.Length))); exit 0 }
Invoke-NativeChecked -Exe git -Arguments @('add', '-A') -What 'git add' | Out-Null
Invoke-NativeChecked -Exe git -Arguments @('-c', 'user.name=dsh', '-c', 'user.email=dsh@local', 'commit', '-m', ('release: v' + $Version), '--no-verify') -What 'git commit' | Out-Null
Invoke-NativeChecked -Exe git -Arguments @('tag', '-f', ('v' + $Version)) -What 'git tag' | Out-Null
# 仓库 slug 从 origin 推导，避免 fork 时把 Release 打到上游仓库
$originRun = Invoke-Native -Exe git -Arguments @('remote', 'get-url', 'origin')
$originUrl = ($originRun.Lines | Where-Object { $_ -and $_.Trim() } | Select-Object -First 1)
if ($originRun.ExitCode -ne 0 -or -not $originUrl) { throw 'no git remote origin' }
$originUrl = $originUrl.Trim()
$slug = $null
if ($originUrl -match 'github\.com[:/]+(?<owner>[^/]+)/(?<repo>[^/\s]+?)(?:\.git)?/?$') {
  $slug = $Matches['owner'] + '/' + $Matches['repo']
}
if (-not $slug) { throw ('cannot derive owner/repo from origin: ' + $originUrl) }
Write-Host ('==> release target ' + $slug)
$gp = @()
if ($Proxy) { $gp = @('-c', ('http.proxy=' + $Proxy), '-c', ('https.proxy=' + $Proxy)) }
foreach ($ref in @('main', ('v' + $Version))) {
  # push 的进度本来就走 stderr；这里原样回显到控制台，但只看退出码判成败。
  $push = Invoke-Native -Exe git -Arguments (@($gp) + @('push', 'origin', $ref))
  foreach ($l in $push.Lines) { Write-Host ('    ' + $l) }
  if ($push.ExitCode -ne 0) { throw ('git push ' + $ref + ' failed (exit ' + $push.ExitCode + ')') }
}
$credRun = Invoke-Native -Exe git -Arguments @('credential', 'fill') -InputText ("protocol=https`nhost=github.com`n`n")
$tok = (($credRun.Lines | Select-String '^password=') | Select-Object -First 1)
$tok = if ($tok) { ($tok.Line -replace '^password=', '').Trim() } else { '' }
if (-not $tok) { throw 'no GitHub token from git credential' }
$h = @{ 'User-Agent' = 'dsh-agent'; 'Authorization' = 'Bearer ' + $tok; 'Accept' = 'application/vnd.github+json' }
$payload = @{ tag_name = ('v' + $Version); name = ('v' + $Version); body = $notes; draft = $false; prerelease = $false } | ConvertTo-Json -Depth 4
$bodyBytes = [Text.Encoding]::UTF8.GetBytes($payload)
$rel = Invoke-RestMethod -Method Post -Uri ('https://api.github.com/repos/' + $slug + '/releases') -Headers $h -ContentType 'application/json; charset=utf-8' -Body $bodyBytes -TimeoutSec 40
$latest = Invoke-RestMethod -Uri ('https://api.github.com/repos/' + $slug + '/releases/latest') -Headers $h -TimeoutSec 30
if ($latest.tag_name -ne ('v' + $Version)) { throw ('latest release mismatch: ' + $latest.tag_name) }
Write-Host ('released ' + $Version + ' -> ' + $rel.html_url)
exit 0
