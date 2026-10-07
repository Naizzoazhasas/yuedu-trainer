@echo off
rem ============================================================
rem  YueDu Trainer - put the complete application on the Desktop
rem  and create convenient shortcuts for it.
rem
rem  Pure ASCII on purpose: cmd.exe reads .cmd files with the OEM
rem  code page, so Chinese text here would become bogus commands.
rem  The Chinese folder name is passed as base64 so it survives
rem  the trip through the command line intact.
rem ============================================================
setlocal
rem  base64 of "读谱训练器" (folder name) and "读谱训练器.html" (main file name)
set "YDT_FOLDER_NAME_B64=6K+76LCx6K6t57uD5Zmo"
set "YDT_HTML_NAME_B64=6K+76LCx6K6t57uD5ZmoLmh0bWw="
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-desktop.ps1" %*
exit /b %ERRORLEVEL%
