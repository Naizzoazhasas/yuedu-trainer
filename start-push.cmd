@echo off
setlocal
title YueDu Trainer - Push to GitHub
cd /d "%~dp0"

echo.
echo   ==================================================
echo      YueDu Trainer  -  Push to GitHub
echo   ==================================================
echo.
echo   This window will push the local commits to
echo     https://github.com/Naizzoazhasas/yuedu-trainer
echo.
echo   The first time, a browser window will open and ask
echo   you to sign in to GitHub.  After that, Windows
echo   remembers the credential, so it will not ask again.
echo.

set "GIT=D:\文档\deepseek-harness\default-workspace\_tools\git\cmd\git.exe"
if not exist "%GIT%" (
  where git >nul 2>nul
  if errorlevel 1 (
    echo   [ERROR] git not found.
    echo   Expected portable git at:
    echo     %GIT%
    echo   Install Git or fix the path in this .cmd file.
    echo.
    pause
    exit /b 1
  )
  set "GIT=git"
)

echo   Using: %GIT%
echo.
echo   --------------------------------------------------
echo   Pulling remote changes first (if any)...
"%GIT%" pull --rebase --autostash origin main
echo   --------------------------------------------------
echo   Pushing...
echo.
"%GIT%" push -u origin main
set "CODE=%ERRORLEVEL%"

echo.
echo   --------------------------------------------------
if "%CODE%"=="0" (
  echo   Done.  All commits are now on GitHub:
  echo     https://github.com/Naizzoazhasas/yuedu-trainer/commits/main
  echo.
  echo   GitHub Pages will rebuild automatically in 1-2 minutes:
  echo     https://naizzoazhasas.github.io/yuedu-trainer/
) else (
  echo   Push FAILED (exit code %CODE%).
  echo   If it asked for a username/password, use your GitHub
  echo   account and a Personal Access Token as the password.
) 
echo   --------------------------------------------------
echo.
pause
exit /b %CODE%
