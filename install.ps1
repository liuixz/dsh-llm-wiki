# dsh-llm-wiki installer for DSH on Windows.
#
# Default = LINK mode: this repo is registered as a "link:" dependency of the DSH
# profile, so editing files in this repo takes effect on the next DSH restart.
# No more copying the plugin or the scripts into ~/.dsh.
#
# Usage (PowerShell):
#   .\install.ps1                    # link install + skills + scheduled tasks
#   .\install.ps1 -NoSchedule        # skip the scheduled tasks
#   .\install.ps1 -NoInstall         # only rewrite config, do not run pnpm
#   .\install.ps1 -ProfileName web   # install into another DSH profile
#   .\install.ps1 -CopyMode          # legacy manual deploy (copies files, not recommended)
#   .\install.ps1 -Uninstall         # remove dependency/skills/tasks (vault data kept)
#
# Windows PowerShell 5.1 reads this file with the ANSI code page when it has no BOM,
# so this script is deliberately pure ASCII: keep it that way.
param(
  [switch]$NoSchedule,
  [switch]$NoInstall,
  [switch]$Uninstall,
  [switch]$CopyMode,
  [string]$ProfileName = 'desktop',
  [string]$TaskPrefix = '',
  [string]$Vault = ''
)
$ErrorActionPreference = 'Stop'
$q = [char]34
$Repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$Home2 = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $Home2 '.dsh' }
$ProfileDir = Join-Path (Join-Path $DshHome 'profiles') $ProfileName
$Bin = Join-Path $DshHome 'bin'
$LogDir = Join-Path $DshHome 'llm-wiki'
$Reports = if ($env:LLM_WIKI_REPORTS) { $env:LLM_WIKI_REPORTS } else { Join-Path $LogDir 'reports' }

# Vault resolution: -Vault wins, then LLM_WIKI_VAULT, then whatever the profile
# cordis.patch.yml already states, then ./vault next to this repo (the sample).
function Get-ConfiguredVault() {
  $patch = Join-Path $ProfileDir 'cordis.patch.yml'
  if (-not (Test-Path $patch)) { return $null }
  $inLlmWiki = $false
  foreach ($ln in (Get-Content $patch -Encoding UTF8)) {
    if ($ln -match '^\s*-\s*id:\s*llm-wiki\s*$') { $inLlmWiki = $true; continue }
    if ($ln -match '^\s*-\s*id:\s*') { $inLlmWiki = $false; continue }
    if ($inLlmWiki -and ($ln -match '^\s+vault:\s*(.+?)\s*$')) {
      return ($Matches[1] -replace '^["'']', '' -replace '["'']$', '')
    }
  }
  return $null
}
if (-not $Vault) { $Vault = $env:LLM_WIKI_VAULT }
if (-not $Vault) { $Vault = Get-ConfiguredVault }
if (-not $Vault) { $Vault = Join-Path $Repo 'vault' }
$Scripts = @('llm-wiki-pipeline.mjs','wiki-retrieval.mjs','wiki-router.mjs','profile-extract.mjs','profile-distill.mjs','session-compile-candidates.mjs','stale-review.mjs','pipeline-health.mjs','weekly-summary.mjs','embed-proxy.mjs')
$Wrappers = @('llm-wiki-cron.cmd','profile-distill-cron.cmd','compile-candidates.cmd','stale-review.cmd','weekly-summary.cmd')
$T1 = $TaskPrefix + 'LLM-Wiki Pipeline'
$T2 = $TaskPrefix + 'Profile Distill'
$T3 = $TaskPrefix + 'LLM-Wiki Compile Candidates'
$T4 = $TaskPrefix + 'LLM-Wiki Stale Review'
$T5 = $TaskPrefix + 'LLM-Wiki Weekly Summary'
$Tasks = @($T1,$T2,$T3,$T4,$T5)
$Marker = '# llm-wiki: config override (plugin entry comes from this repo bundle patch)'
# Markers written by earlier versions of this installer, whose insert blocks must go.
$LegacyMarkers = @(
  '# dsh-llm-wiki (LLM-Wiki lifecycle plugin)',
  '# dsh-llm-wiki (LLM-Wiki',
  '# dsh-llm-wiki install'
)

function Remove-IfExists($path) { if (Test-Path $path) { Remove-Item $path -Recurse -Force } }
function Read-Json($path) { return Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json }
function Write-Json($path, $obj) {
  $json = $obj | ConvertTo-Json -Depth 32
  [IO.File]::WriteAllText($path, $json + [Environment]::NewLine, (New-Object Text.UTF8Encoding $false))
}
# Always go through .NET for text so the ANSI code page never touches the content:
# cordis.patch.yml must stay UTF-8 without BOM, whatever the console code page is.
function Read-TextUtf8($path) {
  $t = [IO.File]::ReadAllText($path, [Text.UTF8Encoding]::new($false))
  if ($t.Length -gt 0 -and $t[0] -eq [char]0xFEFF) { $t = $t.Substring(1) }
  return $t
}
function Write-TextUtf8($path, $text) {
  $t = $text -replace "`r`n", "`n"
  if (-not $t.EndsWith("`n")) { $t += "`n" }
  [IO.File]::WriteAllText($path, $t, (New-Object Text.UTF8Encoding $false))
}
function Backup-File($path) {
  try {
    $b = $path + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Copy-Item $path $b -Force
    Write-Host ('    backup: ' + $b)
  } catch {
    Write-Host ('    WARN cannot write a backup next to ' + $path + ': ' + $_.Exception.Message)
  }
}
# Fail early, with a clear message, when the target directory is not writable
# (usual cause: the agent sandbox keeps ~/.dsh outside the workspace).
function Assert-Writable($path) {
  $dir = if (Test-Path $path -PathType Leaf) { Split-Path -Parent $path } else { $path }
  if (-not (Test-Path $dir)) { return }
  $probe = Join-Path $dir ('.write-probe-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
  try {
    [IO.File]::WriteAllText($probe, 'x')
    Remove-Item $probe -Force
  } catch {
    throw ('Cannot write to ' + $dir + '. Run the installer outside the agent sandbox, or grant it full access. Original error: ' + $_.Exception.Message)
  }
}
# Scheduled tasks always run the scripts inside this repo (single source of truth).
function RepoScript([string]$name) { return (Join-Path (Join-Path $Repo 'scripts') $name) }

if ($Uninstall) {
  Write-Host '==> Uninstalling dsh-llm-wiki'
  $pkgPath = Join-Path $ProfileDir 'package.json'
  if (Test-Path $pkgPath) {
    $pkg = Read-Json $pkgPath
    if ($pkg.dependencies -and ($pkg.dependencies.PSObject.Properties.Name -contains 'dsh-llm-wiki')) {
      $pkg.dependencies.PSObject.Properties.Remove('dsh-llm-wiki')
    }
    $kept = @()
    if ($pkg.dsh -and $pkg.dsh.profile -and $pkg.dsh.profile.bundles) {
      $kept = @($pkg.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-llm-wiki' })
    }
    if ($pkg.dsh -and $pkg.dsh.profile) { $pkg.dsh.profile.bundles = $kept }
    Write-Json $pkgPath $pkg
    Write-Host ('    removed dependency + bundle from ' + $pkgPath)
  }
  Remove-IfExists (Join-Path $Home2 '.agents\skills\wiki-search')
  Remove-IfExists (Join-Path $Home2 '.agents\skills\wiki-write')
  # leftovers of the old manual deploy
  Remove-IfExists (Join-Path $ProfileDir 'dsh-llm-wiki.mjs')
  foreach ($s in $Scripts) { Remove-IfExists (Join-Path $Bin $s) }
  Remove-IfExists (Join-Path $Bin 'profile-schema.json')
  foreach ($w in $Wrappers) { Remove-IfExists (Join-Path $Bin $w) }
  foreach ($t in $Tasks) { schtasks /Delete /TN $t /F 2>$null | Out-Null }
  Write-Host ('    Files and tasks removed. If ' + (Join-Path $ProfileDir 'cordis.patch.yml') + ' still carries an llm-wiki block, delete it by hand.')
  Write-Host ('    To sync node_modules: pnpm --dir ' + $q + $ProfileDir + $q + ' install')
  exit 0
}

if ($CopyMode) {
  Write-Host '==> copy mode (legacy): plugin file -> profile dir'
  New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
  Assert-Writable $ProfileDir
  Copy-Item (Join-Path $Repo 'plugin\dsh-llm-wiki.mjs') (Join-Path $ProfileDir 'dsh-llm-wiki.mjs') -Force
  $Patch = Join-Path $ProfileDir 'cordis.patch.yml'
  if ((Test-Path $Patch) -and (Select-String -Path $Patch -Pattern 'id: llm-wiki' -Quiet)) {
    Write-Host '    cordis.patch.yml already has llm-wiki, skipped'
  } else {
    if (Test-Path $Patch) { Backup-File $Patch }
    $vaultYaml = $Vault -replace '\\', '/'
    $nl = [Environment]::NewLine
    $insert = $nl + $Marker + $nl + '- insert:' + $nl + '    - id: llm-wiki' + $nl + '      name: ./dsh-llm-wiki.mjs' + $nl + '      config:' + $nl + '        vault: ' + $vaultYaml
    Add-Content -Path $Patch -Value $insert -Encoding utf8
    Write-Host '    appended insert to cordis.patch.yml (restart DSH to load)'
  }
} else {
  # ---- LINK mode: register this repo as a link: dependency + bundle of the profile ----
  Write-Host ('==> 1/4 register local repo -> ' + $ProfileDir)
  New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
  Assert-Writable $ProfileDir
  $pkgPath = Join-Path $ProfileDir 'package.json'
  if (-not (Test-Path $pkgPath)) { throw ('profile package.json not found: ' + $pkgPath) }
  Backup-File $pkgPath
  $pkg = Read-Json $pkgPath
  $linkSpec = 'link:' + ($Repo -replace '\\', '/')
  if (-not $pkg.dependencies) { $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force }
  $pkg.dependencies | Add-Member -NotePropertyName 'dsh-llm-wiki' -NotePropertyValue $linkSpec -Force
  if (-not $pkg.dsh) { $pkg | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) -Force }
  if (-not $pkg.dsh.profile) { $pkg.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) -Force }
  $bundles = @()
  if ($pkg.dsh.profile.bundles) { $bundles = @($pkg.dsh.profile.bundles) }
  if ($bundles -notcontains 'dsh-llm-wiki') { $bundles += 'dsh-llm-wiki' }
  $pkg.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue $bundles -Force
  Write-Json $pkgPath $pkg
  Write-Host ('    dependency: dsh-llm-wiki = ' + $linkSpec)
  Write-Host '    bundle: dsh-llm-wiki (entry point comes from the repo cordis.patch.yml)'

  if (-not $NoInstall) {
    Write-Host '==> pnpm install (materialise the link into node_modules)'
    $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
    if (-not $pnpmCmd) {
      Write-Host ('    pnpm is not on PATH; run it yourself: pnpm --dir ' + $q + $ProfileDir + $q + ' install')
    } else {
      & $pnpmCmd.Source --dir $ProfileDir install 2>&1 | ForEach-Object { '    ' + $_ }
      if ($LASTEXITCODE -ne 0) { Write-Host ('    pnpm exited ' + $LASTEXITCODE + '; re-run it by hand if node_modules lacks dsh-llm-wiki') }
    }
  }

  # ---- profile cordis.patch.yml keeps only the config override; the old local insert goes away ----
  Write-Host '==> 2/4 config override -> cordis.patch.yml'
  $Patch = Join-Path $ProfileDir 'cordis.patch.yml'
  $vaultYaml = (($Vault -replace '\\', '/') -replace '"', '')
  $nl = "`n"
  $blockText = @(
    '',
    $Marker,
    '# Config override only: the plugin entry point comes from this repo bundle patch',
    '# (name dsh-llm-wiki -> plugin/dsh-llm-wiki.mjs). Do not add another insert block here.',
    '- id: llm-wiki',
    '  config:',
    ('    vault: ' + $vaultYaml)
  ) -join $nl

  if (-not (Test-Path $Patch)) {
    Write-TextUtf8 $Patch ($blockText + $nl)
    Write-Host '    created cordis.patch.yml with the id: llm-wiki config override'
  } else {
    $text = Read-TextUtf8 $Patch
    $lines = @($text -split "`r?`n")

    $legacy = ($text -match 'name:\s*\./dsh-llm-wiki\.mjs')
    foreach ($m in $LegacyMarkers) { if ($text -match [regex]::Escape($m)) { $legacy = $true } }
    if ($legacy) {
      Backup-File $Patch
      Write-Host '    legacy local insert block found, cleaning it up'
      $out = New-Object System.Collections.Generic.List[string]
      $i = 0
      while ($i -lt $lines.Count) {
        $ln = $lines[$i]
        $isLegacyComment = $false
        foreach ($m in $LegacyMarkers) { if ($ln.Trim().StartsWith($m)) { $isLegacyComment = $true } }
        if ($isLegacyComment) { $i++; continue }
        if ($ln -match '^\s*-\s*insert:\s*$') {
          $j = $i + 1
          $body = @()
          while ($j -lt $lines.Count -and ($lines[$j] -match '^\s{4,}\S')) { $body += $lines[$j]; $j++ }
          if (($body -join $nl) -match 'llm-wiki') { $i = $j; continue }
        }
        $out.Add($ln); $i++
      }
      $text = ($out -join $nl)
      $lines = @($text -split "`r?`n")
    }

    if ($text -notmatch 'id:\s*llm-wiki') {
      Write-TextUtf8 $Patch ($text.TrimEnd() + $nl + $blockText + $nl)
      Write-Host '    appended the id: llm-wiki config override'
    } else {
      # Already configured: keep the file's shape, only make sure the vault path is current.
      $inLlmWiki = $false
      $changed = $false
      $fixed = @()
      foreach ($ln in $lines) {
        if ($ln -match '^\s*-\s*id:\s*llm-wiki\s*$') { $inLlmWiki = $true; $fixed += $ln; continue }
        if ($ln -match '^\s*-\s*id:\s*') { $inLlmWiki = $false; $fixed += $ln; continue }
        if ($inLlmWiki -and ($ln -match '^(\s+)vault:\s*')) {
          $want = $Matches[1] + 'vault: ' + $vaultYaml
          if ($ln -ne $want) { $fixed += $want; $changed = $true } else { $fixed += $ln }
          continue
        }
        $fixed += $ln
      }
      if ($changed) {
        Backup-File $Patch
        Write-TextUtf8 $Patch (($fixed -join $nl))
        Write-Host ('    id: llm-wiki already present; vault updated to ' + $vaultYaml)
      } else {
        Write-Host '    id: llm-wiki config override already present and current'
      }
    }
  }
}

Write-Host ('==> 3/4 skills -> ' + $Home2 + '\.agents\skills')
Assert-Writable (Join-Path $Home2 '.agents')
foreach ($s in @('wiki-search','wiki-write')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Home2 ('.agents\skills\' + $s)) | Out-Null
  Copy-Item (Join-Path $Repo ('skills\' + $s + '\SKILL.md')) (Join-Path $Home2 ('.agents\skills\' + $s + '\SKILL.md')) -Force
}

Write-Host '==> 4/4 scheduled tasks'
if ($CopyMode) {
  Write-Host ('    scripts -> ' + $Bin)
  New-Item -ItemType Directory -Force -Path $Bin | Out-Null
  foreach ($s in $Scripts) { Copy-Item (Join-Path $Repo ('scripts\' + $s)) (Join-Path $Bin $s) -Force }
  Copy-Item (Join-Path $Repo 'scripts\profile-schema.json') (Join-Path $Bin 'profile-schema.json') -Force
}
$pipelinePath = if ($CopyMode) { Join-Path $Bin 'llm-wiki-pipeline.mjs' } else { RepoScript 'llm-wiki-pipeline.mjs' }
$healthPath = if ($CopyMode) { Join-Path $Bin 'pipeline-health.mjs' } else { RepoScript 'pipeline-health.mjs' }
if ($NoSchedule) {
  Write-Host '    skipped (-NoSchedule)'
} else {
  $node = (Get-Command node -ErrorAction SilentlyContinue)
  if (-not $node) {
    Write-Host '    node not found on PATH; scheduled tasks skipped'
  } else {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    New-Item -ItemType Directory -Force -Path $Bin | Out-Null
    $nodeExe = $node.Source
    function New-Wrapper($name, $cmds) {
      $log = Join-Path $LogDir ($name + '.log')
      $lines = @('@echo off', ('echo [%DATE% %TIME%] start >> ' + $q + $log + $q))
      foreach ($c in $cmds) { $lines += ($c + ' >> ' + $q + $log + $q + ' 2>&1') }
      $lines += ('echo [%DATE% %TIME%] exit=%ERRORLEVEL% >> ' + $q + $log + $q)
      $lines += 'if errorlevel 1 start "" mshta "javascript:alert(''LLM-Wiki task failed - see reports/health/ALERT.md'');close()"'
      $path = Join-Path $Bin ($name + '.cmd')
      Set-Content -Path $path -Value $lines -Encoding ascii
      return $path
    }
    $envPrefix = 'set LLM_WIKI_VAULT=' + $Vault + '&& set LLM_WIKI_REPORTS=' + $Reports + '&& '
    $w1 = New-Wrapper 'llm-wiki-cron' @(($envPrefix + $q + $nodeExe + $q + ' ' + $q + $pipelinePath + $q + ' --all'), ($q + $nodeExe + $q + ' ' + $q + $healthPath + $q))
    schtasks /Create /TN $T1 /TR ($q + $w1 + $q) /SC DAILY /ST 10:00 /F | Out-Null
    $w2 = New-Wrapper 'profile-distill-cron' @(($envPrefix + $q + $nodeExe + $q + ' ' + $q + (RepoScript 'profile-distill.mjs') + $q + ' --since 7d --out ' + $q + $Reports + $q))
    schtasks /Create /TN $T2 /TR ($q + $w2 + $q) /SC WEEKLY /D SUN /ST 09:00 /F | Out-Null
    $w3 = New-Wrapper 'compile-candidates' @(($envPrefix + $q + $nodeExe + $q + ' ' + $q + (RepoScript 'session-compile-candidates.mjs') + $q + ' --out ' + $q + $Reports + $q))
    schtasks /Create /TN $T3 /TR ($q + $w3 + $q) /SC WEEKLY /D SUN /ST 09:20 /F | Out-Null
    $w4 = New-Wrapper 'stale-review' @(($envPrefix + $q + $nodeExe + $q + ' ' + $q + (RepoScript 'stale-review.mjs') + $q + ' --limit 20 --out ' + $q + $Reports + $q))
    schtasks /Create /TN $T4 /TR ($q + $w4 + $q) /SC WEEKLY /D SUN /ST 09:40 /F | Out-Null
    $w5 = New-Wrapper 'weekly-summary' @(($envPrefix + $q + $nodeExe + $q + ' ' + $q + (RepoScript 'weekly-summary.mjs') + $q))
    schtasks /Create /TN $T5 /TR ($q + $w5 + $q) /SC WEEKLY /D SUN /ST 09:50 /F | Out-Null
    Write-Host '    5 tasks created (Pipeline 10:00, Profile 09:00, Compile 09:20, Stale 09:40, Weekly 09:50)'
  }
}

Write-Host ''
Write-Host 'Done.'
Write-Host ('  repo:    ' + $Repo)
Write-Host ('  vault:   ' + $Vault)
Write-Host ('  reports: ' + $Reports)
Write-Host ('  first full run: node ' + $q + $pipelinePath + $q + ' --all')
Write-Host ('  health check:   node ' + $q + $healthPath + $q)
Write-Host '  restart DSH so the plugin loads'
