# YueDu Trainer - Desktop installer
#
# Copies the whole application folder to the Desktop and creates two shortcuts.
# This file is intentionally PURE ASCII: Windows PowerShell 5 reads .ps1 without
# a BOM using the system ANSI code page, so non-ASCII text here would be mangled.
# (User-facing Chinese strings are written by the Node script instead.)
#
# Usage:  powershell -ExecutionPolicy Bypass -File tools\install-desktop.ps1
#         powershell -ExecutionPolicy Bypass -File tools\install-desktop.ps1 -Dest "D:\some\dir"

param(
    [string]$Dest = "",
    [switch]$SkipZip
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent

# ---------- destination ----------
if (-not $Dest -or $Dest.Length -eq 0) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    if (-not $desktop) { $desktop = "$env:USERPROFILE\Desktop" }
    # Folder name travels as base64 for the same reason (see YDT_HTML_NAME_B64).
    $folderName = 'YueDuTrainer'
    if ($env:YDT_FOLDER_NAME_B64) {
        try {
            $folderName = [System.Text.Encoding]::UTF8.GetString(
                [System.Convert]::FromBase64String($env:YDT_FOLDER_NAME_B64))
        } catch { }
    }
    $Dest = Join-Path $desktop $folderName
}

Write-Host ""
Write-Host "  YueDu Trainer - desktop install"
Write-Host "  --------------------------------"
Write-Host "  source: $Root"
Write-Host "  target: $Dest"
Write-Host ""

function Need([string]$p) {
    if (-not (Test-Path -LiteralPath $p)) {
        Write-Host "  [ERROR] missing: $p" -ForegroundColor Red
        exit 1
    }
}

Need (Join-Path $Root 'dist\yuedu-trainer.html')

if (Test-Path -LiteralPath $Dest) {
    Write-Host "  removing previous copy..."
    Remove-Item -LiteralPath $Dest -Recurse -Force
}
$null = New-Item -ItemType Directory -Path $Dest -Force

# ---------- 1. the app itself (single file) ----------
# The file name travels as base64 so it survives this pure-ASCII script.
$appHtmlName = 'YueDuTrainer.html'
if ($env:YDT_HTML_NAME_B64) {
    try {
        $appHtmlName = [System.Text.Encoding]::UTF8.GetString(
            [System.Convert]::FromBase64String($env:YDT_HTML_NAME_B64))
    } catch { }
}
Copy-Item -LiteralPath (Join-Path $Root 'dist\yuedu-trainer.html') -Destination (Join-Path $Dest $appHtmlName) -Force
# Also keep an ASCII-named copy so scripts/command lines can refer to it easily.
if ($appHtmlName -ne 'YueDuTrainer.html') {
    Copy-Item -LiteralPath (Join-Path $Root 'dist\yuedu-trainer.html') -Destination (Join-Path $Dest 'YueDuTrainer.html') -Force
}

# ---------- 2. multi-file site version ----------
$siteDir = Join-Path $Dest 'site'
$null = New-Item -ItemType Directory -Path $siteDir -Force
if (Test-Path -LiteralPath (Join-Path $Root 'dist\site')) {
    Copy-Item -Path (Join-Path $Root 'dist\site\*') -Destination $siteDir -Recurse -Force
}

# ---------- 3. launcher + icon ----------
$toolsDir = Join-Path $Dest 'tools'
$null = New-Item -ItemType Directory -Path $toolsDir -Force
Copy-Item -LiteralPath (Join-Path $Root 'tools\desktop-app.ps1') -Destination $toolsDir -Force

$iconDir = Join-Path $Dest 'icons'
$null = New-Item -ItemType Directory -Path $iconDir -Force
foreach ($f in @('yuedu.ico', 'icon-192.png', 'icon-512.png')) {
    $src = Join-Path $Root "icons\$f"
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $iconDir -Force }
}

$launcher = Join-Path $Dest 'Start YueDu Trainer.cmd'
$cmdText = @"
@echo off
rem YueDu Trainer - double-click to open the app in its own window.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\desktop-app.ps1" %*
exit /b %ERRORLEVEL%
"@
$cmdText | Set-Content -LiteralPath $launcher -Encoding ASCII

# ---------- 4. Android APK ----------
$apkDir = Join-Path $Dest 'android-apk'
$null = New-Item -ItemType Directory -Path $apkDir -Force
$apkSrc = Join-Path $Root 'dist\android\yuedu-trainer.apk'
if (Test-Path -LiteralPath $apkSrc) {
    Copy-Item -LiteralPath $apkSrc -Destination (Join-Path $apkDir 'YueDuTrainer.apk') -Force
}

# ---------- 5. docs ----------
foreach ($f in @('README.md', 'USAGE-zh.txt')) {
    $src = Join-Path $Root $f
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $Dest -Force }
}

# ---------- 6. README + shortcuts via Node (handles Chinese + UTF-8 properly) ----------
$desktop = Split-Path $Dest -Parent
$env:YDT_INSTALL_DEST = $Dest
$env:YDT_INSTALL_DESKTOP = $desktop
$env:YDT_INSTALL_ROOT = $Root

$finish = Join-Path $Root 'tools\install-desktop-finish.js'
if (Test-Path -LiteralPath $finish) {
    Write-Host "  writing README and shortcuts..."
    & node $finish
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [WARN] README/shortcuts step exited with $LASTEXITCODE" -ForegroundColor Yellow
    }
} else {
    Write-Host "  [WARN] tools\install-desktop-finish.js not found, skipping README/shortcuts" -ForegroundColor Yellow
}

# ---------- 7. portable zip ----------
if (-not $SkipZip) {
    $zip = Join-Path $desktop 'YueDuTrainer-portable.zip'
    if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
    try {
        Compress-Archive -Path (Join-Path $Dest '*') -DestinationPath $zip -Force
        Write-Host ("  portable zip: {0} ({1:N1} MB)" -f $zip, ((Get-Item -LiteralPath $zip).Length / 1MB))
    } catch {
        Write-Host "  [WARN] could not create zip: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# ---------- summary ----------
Write-Host ""
Write-Host "  ================ DONE ================" -ForegroundColor Green
Write-Host "  folder: $Dest"
Write-Host ("  size:   {0:N1} MB" -f ((Get-ChildItem -LiteralPath $Dest -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB))
Write-Host ""
Write-Host "  Double-click the desktop shortcut, or run:"
Write-Host "    $launcher"
Write-Host ""
