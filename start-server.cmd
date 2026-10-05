@echo off
setlocal
title YueDu Trainer - Local Server
cd /d "%~dp0"

echo.
echo   ==================================================
echo      YueDu Trainer  (Du Pu Xun Lian Qi)  -  LOCAL
echo   ==================================================
echo.
echo   Starting a local web server so that the TUNER
echo   can use your microphone.  Browsers only allow
echo   the microphone on https:// or http://127.0.0.1
echo.
echo   Opening http://127.0.0.1:8099/ in your browser...
echo   Close this window (or press Ctrl+C) to stop.
echo.
echo   --------------------------------------------------
echo   Note: Chinese help is in    USAGE-zh.txt
echo         (same folder as this file)
echo   --------------------------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 goto NONODE

start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8099/"
node "%~dp0tools\serve.js" --port 8099

echo.
echo   Server stopped.
pause
exit /b 0

:NONODE
echo   [ERROR] Node.js was not found on this computer.
echo.
echo   Options:
echo     1) Install Node.js from  https://nodejs.org/
echo     2) Or use the shortcut "Offline" instead, which does
echo        not need Node.js, but the tuner will not work.
echo.
pause
exit /b 1
