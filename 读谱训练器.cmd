@echo off
rem ============================================================
rem  YueDu Trainer - Desktop App launcher
rem  Double-click this file to open the app in its own window.
rem  (This file is intentionally pure ASCII: cmd.exe reads .cmd
rem   files with the OEM code page, so non-ASCII text here would
rem   be turned into bogus commands.)
rem ============================================================
setlocal
set "SCRIPT=%~dp0tools\desktop-app.ps1"
if not exist "%SCRIPT%" set "SCRIPT=%~dp0desktop-app.ps1"
if not exist "%SCRIPT%" (
  echo.
  echo   [ERROR] Cannot find tools\desktop-app.ps1 next to this file.
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
exit /b %ERRORLEVEL%
