# 读谱训练器 — 桌面应用启动器
#
# 作用：把网页版变成一个「双击就能用的独立应用窗口」。
#   1. 用 .NET HttpListener 在 http://127.0.0.1:<随机端口> 上提供 dist/yuedu-trainer.html
#      （之所以要本地服务器而不是直接开 file:// —— 浏览器规定只有 https / localhost
#       才是「安全上下文」，file:// 下麦克风不可用，调音器会失效）；
#   2. 用 Edge/Chrome 的 --app 模式打开：没有地址栏、没有标签页、任务栏是独立图标，
#      看起来和用起来都跟原生应用一样；
#   3. 窗口关掉后服务器自动结束。
#
# 运行：双击「读谱训练器.cmd」，或  powershell -ExecutionPolicy Bypass -File tools\desktop-app.ps1

param(
    [string]$AppFile = "",
    [int]$Port = 0,
    [switch]$NoWait          # 只负责启动，不等待窗口关闭（便于脚本化调用）
)

$ErrorActionPreference = 'Stop'

# ---------- 定位应用文件 ----------
if (-not $AppFile -or $AppFile.Length -eq 0) {
    $candidates = @(
        $env:YDT_APP_FILE,
        (Join-Path $PSScriptRoot 'dist\yuedu-trainer.html'),
        (Join-Path $PSScriptRoot 'yuedu-trainer.html'),
        (Join-Path $PSScriptRoot 'YueDuTrainer.html'),
        (Join-Path $PSScriptRoot '读谱训练器.html'),
        (Join-Path (Split-Path $PSScriptRoot -Parent) 'dist\yuedu-trainer.html'),
        (Join-Path (Split-Path $PSScriptRoot -Parent) 'yuedu-trainer.html'),
        (Join-Path (Split-Path $PSScriptRoot -Parent) 'YueDuTrainer.html'),
        (Join-Path (Split-Path $PSScriptRoot -Parent) '读谱训练器.html')
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) { $AppFile = $c; break }
    }
}
if (-not $AppFile -or -not (Test-Path -LiteralPath $AppFile)) {
    Write-Host ""
    Write-Host "  [错误] 找不到网页主程序（读谱训练器.html 或 dist\yuedu-trainer.html）" -ForegroundColor Red
    Write-Host "         请确认本文件夹里有 读谱训练器.html，或先运行 node tools\build.js。" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "  按回车退出"
    exit 1
}
$AppFile = (Resolve-Path -LiteralPath $AppFile).Path

# ---------- 找一个可用的浏览器（优先 Edge，其次 Chrome） ----------
function Find-Browser {
    $cands = @()
    if ($env:YDT_BROWSER) { $cands += $env:YDT_BROWSER }
    $cands += @(
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($c in $cands) {
        if ($c -and (Test-Path -LiteralPath $c)) { return $c }
    }
    try {
        foreach ($root in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe',
                            'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe')) {
            if (Test-Path $root) {
                $p = (Get-ItemProperty $root).'(default)'
                if ($p -and (Test-Path -LiteralPath $p)) { return $p }
            }
        }
    } catch { }
    return $null
}

$browser = Find-Browser
if (-not $browser) {
    Write-Host ""
    Write-Host "  [错误] 没有找到 Microsoft Edge 或 Google Chrome。" -ForegroundColor Red
    Write-Host "         本应用需要其中之一来提供应用窗口（Windows 10/11 都自带 Edge）。" -ForegroundColor Yellow
    Write-Host "         也可设置环境变量 YDT_BROWSER 指向浏览器 exe。" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "  按回车退出"
    exit 1
}

# ---------- 选端口并起服务 ----------
$chosenPort = $Port
if ($chosenPort -le 0) {
    $tmp = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
    $tmp.Start()
    $chosenPort = ([System.Net.IPEndPoint]$tmp.LocalEndpoint).Port
    $tmp.Stop()
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$chosenPort/")
try {
    $listener.Start()
} catch {
    Write-Host "  [错误] 无法在本机端口 $chosenPort 上启动服务：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host "         请重试，或指定别的端口： powershell -File tools\desktop-app.ps1 -Port 9600" -ForegroundColor Yellow
    Read-Host "  按回车退出"
    exit 1
}

$url = "http://127.0.0.1:$chosenPort/index.html"

Write-Host ""
Write-Host "  读谱训练器（桌面应用）" -ForegroundColor Cyan
Write-Host "  ----------------------------------------"
Write-Host "  应用文件： $AppFile"
Write-Host "  本地地址： $url"
Write-Host "  浏览器：   $browser"
Write-Host "  提示：关闭应用窗口即可退出。"
Write-Host ""

# ---------- 在独立 Runspace 里处理请求 ----------
# 关键：主线程要等窗口关闭，不能自己跑服务循环；但 HttpListener 的 GetContext
# 必须在另一个不被阻塞的线程上执行，所以开一个 Runspace 专门做 accept/响应。
# 这里用单引号 here-string：脚本全文不做变量展开，$listener / $file 由 Runspace
# 的 SessionStateProxy 预先注入。
$serverScript = @'
$ErrorActionPreference = 'SilentlyContinue'
$bytes = [System.IO.File]::ReadAllBytes($file)
while ($true) {
    try {
        $ctx = $listener.GetContext()
    } catch {
        break          # 监听器被停止 -> 退出循环
    }
    try {
        $ctx.Response.StatusCode = 200
        $ctx.Response.ContentType = 'text/html; charset=utf-8'
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.Headers.Add('Cache-Control', 'no-store')
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $ctx.Response.OutputStream.Close()
    } catch { }
}
'@

$runspace = [runspacefactory]::CreateRunspace()
$runspace.ApartmentState = 'STA'
$runspace.ThreadOptions = 'ReuseThread'
$runspace.Open()
# 把监听器与文件路径注入 Runspace 的会话变量，供上面的脚本使用
$runspace.SessionStateProxy.SetVariable('listener', $listener)
$runspace.SessionStateProxy.SetVariable('file', $AppFile)

$ps = [powershell]::Create()
$ps.Runspace = $runspace
$null = $ps.AddScript($serverScript)
$serverHandle = $ps.BeginInvoke()

# ---------- 启动应用窗口 ----------
$profileDir = Join-Path $env:LOCALAPPDATA 'YueDuTrainer\browser-profile'
if (-not (Test-Path -LiteralPath $profileDir)) { $null = New-Item -ItemType Directory -Path $profileDir -Force }

$winArgs = @(
    "--app=$url",
    "--user-data-dir=$profileDir",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1200,860"
)

$proc = $null
try {
    $proc = Start-Process -FilePath $browser -ArgumentList $winArgs -PassThru
    if (-not $NoWait) {
        $proc.WaitForExit()
    } else {
        Write-Host "  已在应用窗口中启动（本进程不等待）。" -ForegroundColor Green
    }
} finally {
    # ---------- 清理 ----------
    try { if ($listener -and $listener.IsListening) { $listener.Stop() } } catch { }
    try { if ($listener) { $listener.Close() } } catch { }
    try {
        if ($ps) {
            if ($ps.InvocationStateInfo.State -eq 'Running') { $ps.Stop() }
            $ps.Dispose()
        }
        if ($runspace) { $runspace.Close(); $runspace.Dispose() }
    } catch { }
    Write-Host "  已退出。" -ForegroundColor DarkGray
}
